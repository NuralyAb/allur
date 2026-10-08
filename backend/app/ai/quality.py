"""Модель причин брака: какие параметры режима поднимают вероятность брака кузова и насколько.

Для каждого контроллера с влиянием режима на качество обучается классификатор (градиентный бустинг)
«параметры процесса в момент обработки кузова → брак». Данные — синтетические кузова из модели оборудования
двойника: режим выбирается случайно в пределах от нормы до аварийных порогов, брак разыгрывается по закону
симулятора. Признаки — все параметры контроллера, в том числе не влияющие на брак: модель сама находит
значимые. На заводе вместо синтетики — паспорт кузова (параметры процесса по VIN) и результат ОТК.

Объяснение: важность признаков перестановкой (permutation importance) на отложенной выборке и порог,
за которым вероятность брака удваивается (по кривой частичной зависимости от режима нормы).
"""
from dataclasses import dataclass, field

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score

from ..scada.plcsim import defect_probability
from ..scada.registry import Controller, Param


def reference(p: Param) -> float:
    """Режим нормы: уставка, номинал, а для параметров износа — состояние после обслуживания."""
    if p.sp:
        return p.sp["value"]
    if p.nominal is not None:
        return p.nominal
    if p.resetTo is not None:
        return p.resetTo
    return p.start if p.start is not None else (p.range[0] + p.range[1]) / 2


def bounds(c: Controller, p: Param) -> tuple[float, float]:
    """Диапазон режимов для обучения: от нормы до аварийных порогов и крайних тревог."""
    ref = reference(p)
    lo, hi = ref - 6 * (p.noise or 0.01 * (p.range[1] - p.range[0])), ref + 6 * (p.noise or 0.01 * (p.range[1] - p.range[0]))
    a = p.alarms
    if "dev" in a:
        lo, hi = min(lo, ref - 2.5 * a["dev"]), max(hi, ref + 2.5 * a["dev"])
    for kind in ("hihi", "hi"):
        if kind in a:
            hi = max(hi, a[kind] * 1.03)
            break
    for kind in ("lolo", "lo"):
        if kind in a:
            lo = min(lo, a[kind] * 0.97)
            break
    if p.trip:
        if "above" in p.trip:
            hi = p.trip["above"]
        if "below" in p.trip:
            lo = p.trip["below"]
    for f in c.sim.get("quality", []):
        if f["param"] != p.id:
            continue
        if f["kind"] == "dev":
            lo, hi = min(lo, ref - 3 * f["scale"]), max(hi, ref + 3 * f["scale"])
        elif f["kind"] == "above":
            hi = max(hi, f["ref"] + 2.5 * f["scale"])
        else:
            lo = min(lo, f["ref"] - 2.5 * f["scale"])
    if p.drift:
        lo = min(lo, ref)
    return max(p.range[0], lo), min(p.range[1], hi)


@dataclass
class QualityModel:
    controller: str
    params: list[str]
    names: dict[str, str]
    units: dict[str, str]
    decimals: dict[str, int]
    bounds: dict[str, tuple[float, float]]
    nominal: dict[str, float]
    model: HistGradientBoostingClassifier
    metrics: dict
    importance: dict[str, float]
    drivers: list[dict] = field(default_factory=list)  # значимые параметры: порог удвоения и кривая риска

    def _x(self, values: dict[str, float | None]) -> np.ndarray:
        return np.array([[values.get(p) if values.get(p) is not None else self.nominal[p] for p in self.params]], dtype=float)

    def predict(self, values: dict[str, float | None]) -> float:
        return float(self.model.predict_proba(self._x(values))[0, 1])

    def explain(self, values: dict[str, float | None]) -> dict:
        """Текущий риск брака и вклад каждого параметра: насколько риск упал бы, верни мы параметр в норму."""
        risk = self.predict(values)
        base = self.predict(self.nominal)
        contrib = []
        for p in self.params:
            if self.importance.get(p, 0) < 0.03:
                continue
            fixed = self.predict({**values, p: self.nominal[p]})
            contrib.append({"param": p, "name": self.names[p], "unit": self.units[p],
                            "value": None if values.get(p) is None else round(float(values[p]), self.decimals[p] + 1),
                            "nominal": round(self.nominal[p], self.decimals[p] + 1), "delta": round(risk - fixed, 4)})
        contrib.sort(key=lambda r: -r["delta"])
        return {"risk": round(risk, 4), "baseline": round(base, 4), "factors": contrib}


def train(c: Controller, n: int = 8000, seed: int = 3) -> QualityModel:
    rng = np.random.default_rng(seed + sum(map(ord, c.id)))
    params = [p.id for p in c.params]
    bnds = {p.id: bounds(c, p) for p in c.params}
    x = np.column_stack([rng.uniform(*bnds[p], n) for p in params])
    prob = np.array([defect_probability(c, dict(zip(params, row))) for row in x])
    y = (rng.random(n) < prob).astype(int)
    cut = int(0.8 * n)
    model = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.06, max_depth=4, random_state=seed)
    model.fit(x[:cut], y[:cut])
    p_test = model.predict_proba(x[cut:])[:, 1]
    auc = float(roc_auc_score(y[cut:], p_test)) if 0 < y[cut:].sum() < len(y) - cut else None
    imp = permutation_importance(model, x[cut:], y[cut:], scoring="roc_auc", n_repeats=4, random_state=seed)
    raw = np.clip(imp.importances_mean, 0, None)
    share = raw / raw.sum() if raw.sum() > 0 else raw
    q = QualityModel(
        controller=c.id, params=params, names={p.id: p.name for p in c.params}, units={p.id: p.unit for p in c.params},
        decimals={p.id: p.decimals for p in c.params}, bounds=bnds, nominal={p.id: reference(p) for p in c.params},
        model=model, importance={p: round(float(s), 3) for p, s in zip(params, share)},
        metrics={"samples": n, "defectShare": round(float(y.mean()), 4),
                 "auc": None if auc is None else round(auc, 3),
                 # проверка на правдоподобие: средняя предсказанная вероятность против фактической доли брака
                 "meanPredicted": round(float(p_test.mean()), 4), "meanActual": round(float(y[cut:].mean()), 4)},
    )
    q.drivers = _drivers(q)
    return q


def _drivers(q: QualityModel) -> list[dict]:
    """Для значимых параметров — кривая риска брака и порог, за которым риск вдвое выше нормы."""
    base = q.predict(q.nominal)
    out = []
    for p in q.params:
        if q.importance[p] < 0.05:
            continue
        lo, hi = q.bounds[p]
        grid = np.linspace(lo, hi, 41)
        rows = np.repeat(q._x(q.nominal), len(grid), axis=0)
        rows[:, q.params.index(p)] = grid
        risk = q.model.predict_proba(rows)[:, 1]
        ref = q.nominal[p]
        hot = risk >= 2 * base
        # порог — с него и дальше от нормы риск двойной хотя бы в 80 % точек (не меньше трёх): выбросы кривой не в счёт
        held = lambda part: len(part) >= 3 and part.mean() >= 0.8 and part[0]  # noqa: E731
        above = [g for i, g in enumerate(grid) if g > ref and held(hot[i:])]
        below = [g for i, g in enumerate(grid) if g < ref and held(hot[:i + 1][::-1])]
        out.append({
            "param": p, "name": q.names[p], "unit": q.units[p], "importance": q.importance[p], "nominal": round(ref, q.decimals[p] + 1),
            "doubleAbove": round(float(min(above)), q.decimals[p]) if above else None,
            "doubleBelow": round(float(max(below)), q.decimals[p]) if below else None,
            "curve": [[round(float(g), q.decimals[p] + 1), round(float(r) * 100, 2)] for g, r in zip(grid, risk)],
        })
    out.sort(key=lambda d: -d["importance"])
    return out
