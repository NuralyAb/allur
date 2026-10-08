"""Предиктивное обслуживание: прогноз отказа по тренду параметра и детектор аномалий.

Прогноз отказа. Для каждого параметра с порогом аварии (trip) или крайней тревогой:
  1. по последним 15 мин измерений строится линейный тренд (МНК): уровень, скорость, шум, t-статистика наклона;
  2. по тренду считается время до порога с интервалом по стандартной ошибке наклона;
  3. классификатор (градиентный бустинг) оценивает вероятность выхода за порог в ближайшие 60 мин.
Классификатор обучается при запуске на синтетических траекториях деградации: начальный запас до порога,
скорость износа, её изменение и шум датчика выбираются случайно, разметка — фактический выход за порог
в следующие 60 мин. Признаки безразмерны (в долях диапазона параметра), поэтому одна модель служит
всем узлам: фильтрам, электродам, цепи конвейера. На заводе модель дообучается на журнале простоев.

Детектор аномалий. Признаки окна 2 мин в единицах шума датчика: z-оценка среднего отклонения от режима,
t-оценка наклона, отношение разброса к паспортному шуму. Модель нормальной работы — робастная ковариация (MCD),
оценка — расстояние Махаланобиса, порог — квантиль с долей ложных срабатываний 1e-4 на окно. Поэтому детектор
видит развивающуюся неисправность (подшипник привода, засор), пока до тревоги ПЛК ещё далеко.
"""
import math
from dataclasses import dataclass

import numpy as np
from sklearn.covariance import MinCovDet
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score

from ..scada.registry import Controller, Param

WINDOW_S = 15 * 60  # окно тренда
MIN_SPAN_S = 120  # тренд строится не раньше, чем через 2 мин наблюдений
HORIZON_MIN = 60  # горизонт вероятности отказа
ANOMALY_WINDOW_S = 120
ANOMALY_PERSIST = 3  # столько опросов подряд, прежде чем показать аномалию
ANOMALY_FPR = 1e-4  # доля ложных срабатываний одного окна на нормальной работе
FEATURES = ["Запас до порога", "Скорость к порогу", "Шум", "t-статистика наклона", "Оценка времени, ч", "Длина окна, ч"]

# что делать, если узел идёт к аварии: по коду неисправности ПЛК
ACTIONS = {
    102: "Заменить колпачки электродов в ближайший перерыв; проверить счётчик точек.",
    103: "Проверить контур охлаждения клещей: расход, фильтр, утечки.",
    106: "Очистить защитное стекло, проверить охлаждение оптики.",
    201: "Заменить фильтр в межсменное окно; держать запасной комплект у камеры.",
    203: "Проверить теплообменник и регулятор температуры ванны.",
    205: "Проверить регулятор горелок и датчик температуры печи.",
    301: "Проверить натяжение и вытяжку цепи; подготовить замену в ближайший перерыв.",
    302: "Проверить привод конвейера: подшипники, смазку, заклинивание тележек.",
    502: "Дать остыть двигателям роликов, проверить вентиляцию стенда.",
}
# типичная длительность внепланового ремонта, мин — для перевода прогноза в потерянные автомобили
REPAIR_MIN = {102: 25, 103: 30, 106: 35, 201: 40, 203: 45, 205: 50, 301: 55, 302: 40, 502: 30}
DEFAULT_REPAIR_MIN = 30


@dataclass
class Limit:
    direction: int  # +1 — авария при росте, −1 — при падении
    value: float
    kind: str  # trip | hihi | hi | lolo | lo
    code: int | None


def limits(p: Param) -> list[Limit]:
    """Пороги, к которым параметр может уйти: авария ПЛК, а без неё — крайняя тревога."""
    out = []
    if p.trip and "above" in p.trip:
        out.append(Limit(1, p.trip["above"], "trip", p.trip["code"]))
    elif "hihi" in p.alarms or "hi" in p.alarms:
        kind = "hihi" if "hihi" in p.alarms else "hi"
        out.append(Limit(1, p.alarms[kind], kind, None))
    if p.trip and "below" in p.trip:
        out.append(Limit(-1, p.trip["below"], "trip", p.trip["code"]))
    elif "lolo" in p.alarms or "lo" in p.alarms:
        kind = "lolo" if "lolo" in p.alarms else "lo"
        out.append(Limit(-1, p.alarms[kind], kind, None))
    return out


def expected(p: Param, sp: float | None) -> float | None:
    """Режимное значение: уставка, а без неё — номинал. Параметры износа (drift) режима не имеют."""
    if p.drift:
        return None
    if p.sp:
        return sp if sp is not None else p.sp["value"]
    return p.nominal


def _fit(t: np.ndarray, y: np.ndarray) -> tuple[float, float, float, float]:
    """МНК по строкам: наклон, уровень в последней точке, СКО остатков, стандартная ошибка наклона."""
    tm = t.mean(axis=-1, keepdims=True)
    ym = y.mean(axis=-1, keepdims=True)
    sxx = ((t - tm) ** 2).sum(axis=-1)
    slope = ((t - tm) * (y - ym)).sum(axis=-1) / sxx
    level = ym[..., 0] + slope * (t[..., -1] - tm[..., 0])
    resid = y - (ym + slope[..., None] * (t - tm))
    dof = max(t.shape[-1] - 2, 1)
    sd = np.sqrt((resid ** 2).sum(axis=-1) / dof)
    return slope, level, sd, sd / np.sqrt(sxx)


def features(t_h: np.ndarray, y: np.ndarray, limit: float, direction: int, span: float) -> np.ndarray:
    """Признаки окна для классификатора: всё в долях диапазона параметра и в часах."""
    slope, level, sd, se = _fit(t_h, y)
    margin = direction * (limit - level) / span
    rate = direction * slope / span
    tstat = np.clip(direction * slope / np.maximum(se, 1e-12), -50, 50)
    eta = np.where(rate > 1e-6, np.clip(margin / np.maximum(rate, 1e-6), 0, 10), 10.0)
    length = t_h[..., -1] - t_h[..., 0]  # короткое окно — наклон известен хуже, модель это учитывает
    return np.stack([margin, rate, sd / span, tstat, eta, length], axis=-1)


def train_failure_model(n: int = 24000, seed: int = 11) -> tuple[HistGradientBoostingClassifier, dict]:
    """Синтетические траектории деградации → классификатор «выход за порог в ближайший час»."""
    rng = np.random.default_rng(seed)
    dt_h = 5 / 3600
    horizon = np.arange(1, int(HORIZON_MIN * 60 / 5) + 1) * dt_h
    xs, ys = [], []
    for w in (24, 48, 96, 180):  # окно наблюдений: 2, 4, 8 и 15 мин
        m = n // 4
        t = (np.arange(w) - (w - 1)) * dt_h  # прошлое: t ≤ 0, сейчас — 0
        margin0 = rng.uniform(0.005, 0.8, m)
        # большинство параметров в работе стабильны; износ — у части, со скоростью от 0,02 до 3 диапазонов в час
        drift = np.where(rng.random(m) < 0.6, 0.0, np.exp(rng.normal(np.log(0.25), 1.1, m)))
        drift *= np.where(rng.random(m) < 0.1, -1, 1)
        accel = rng.normal(0, 0.25, m) * (rng.random(m) < 0.5)
        noise = np.exp(rng.uniform(np.log(0.0008), np.log(0.04), m))
        # расстояние до порога в долях диапазона; порог = 1, параметр растёт к нему
        dist = lambda tt: margin0[:, None] - drift[:, None] * tt - 0.5 * accel[:, None] * tt ** 2  # noqa: E731
        y = 1 - dist(t[None, :]) + rng.normal(0, 1, (m, w)) * noise[:, None]
        xs.append(features(np.broadcast_to(t, (m, w)), y, 1.0, 1, 1.0))
        ys.append((dist(horizon[None, :]).min(axis=1) <= 0).astype(int))
    x, yl = np.concatenate(xs), np.concatenate(ys)
    idx = rng.permutation(len(x))
    cut = int(0.8 * len(x))
    train, test = idx[:cut], idx[cut:]
    model = HistGradientBoostingClassifier(max_iter=250, learning_rate=0.08, max_leaf_nodes=31, random_state=seed)
    model.fit(x[train], yl[train])
    p = model.predict_proba(x[test])[:, 1]
    metrics = {"samples": int(len(x)), "positiveShare": round(float(yl.mean()), 3),
               "auc": round(float(roc_auc_score(yl[test], p)), 3), "brier": round(float(brier_score_loss(yl[test], p)), 4)}
    return model, metrics


def anomaly_features(t_s: np.ndarray, y: np.ndarray, ref: float, noise: float) -> np.ndarray:
    """Признаки окна в единицах шума: z среднего отклонения от режима, t наклона, разброс к паспортному шуму."""
    n = y.shape[-1]
    slope, _, sd, se = _fit(t_s, y)
    mean_z = (y.mean(axis=-1) - ref) / (noise / math.sqrt(n))
    slope_t = slope / np.maximum(se, 1e-12)
    return np.stack([np.clip(mean_z, -60, 60), np.clip(slope_t, -60, 60), sd / noise], axis=-1)


def _normal_windows(rng, n: int) -> np.ndarray:
    w = ANOMALY_WINDOW_S // 5
    return anomaly_features(np.broadcast_to(np.arange(w) * 5.0, (n, w)), rng.normal(0, 1, (n, w)), 0.0, 1.0)


def train_anomaly_model(n: int = 10000, calib: int = 200000, seed: int = 5) -> tuple[MinCovDet, float, dict]:
    """Нормальная работа: белый шум датчика вокруг режима → робастная ковариация (MCD) признаков окна.

    Оценка аномальности — квадрат расстояния Махаланобиса; порог — квантиль на независимой выборке нормальных окон
    с долей ложных срабатываний ANOMALY_FPR.
    """
    rng = np.random.default_rng(seed)
    model = MinCovDet(random_state=seed).fit(_normal_windows(rng, n))
    threshold = float(np.quantile(model.mahalanobis(_normal_windows(rng, calib)), 1 - ANOMALY_FPR))
    return model, threshold, {"samples": n, "calibration": calib, "falseAlarmPerWindow": ANOMALY_FPR}


@dataclass
class Series:
    """Окно измерений одного параметра: время, значения, уставка (если есть)."""
    ts: np.ndarray
    values: np.ndarray
    sps: np.ndarray | None


def predict_failure(model, c: Controller, p: Param, s: Series, now: float) -> dict | None:
    """Прогноз выхода параметра за порог; None — данных ещё мало."""
    keep = s.ts >= now - WINDOW_S
    ts, ys = s.ts[keep], s.values[keep]
    if len(ts) < 12 or ts[-1] - ts[0] < MIN_SPAN_S:
        return None
    span = p.range[1] - p.range[0]
    t_h = (ts - ts[-1]) / 3600
    best = None
    for lim in limits(p):
        x = features(t_h[None, :], ys[None, :], lim.value, lim.direction, span)[0]
        prob = float(model.predict_proba(x[None, :])[0, 1])
        slope, level, sd, se = (float(v[0]) for v in _fit(t_h[None, :], ys[None, :]))
        toward = lim.direction * slope  # ед./ч к порогу
        eta = eta_lo = eta_hi = None
        if toward > 0 and toward > 3 * se:
            dist = lim.direction * (lim.value - level)
            eta = max(0.0, dist / toward * 60)
            eta_lo = max(0.0, dist / (toward + 2 * se) * 60)
            eta_hi = dist / (toward - 2 * se) * 60 if toward > 2 * se else None
        if best is None or prob > best["probability"]:
            best = {"limit": lim, "probability": prob, "eta": eta, "etaRange": [eta_lo, eta_hi],
                    "level": level, "slope": slope / 60, "noise": sd}
    lim = best["limit"]
    eta = best["eta"]
    prob = best["probability"]
    window_min = (ts[-1] - ts[0]) / 60
    if eta is not None:
        severity = "bad" if prob >= 0.7 or eta < 30 else "warn" if prob >= 0.35 or eta < 90 else "ok"
    else:  # тренда к порогу нет: вероятность по короткому окну неустойчива, ждём 8 мин наблюдений
        severity = "ok" if window_min < 8 else "bad" if prob >= 0.8 else "warn" if prob >= 0.5 else "ok"
    fault = c.faults.get(lim.code) if lim.code else None
    return {
        "controller": c.id, "equipment": c.equipment, "area": c.area, "zone": c.zone,
        "param": p.id, "paramName": p.name, "unit": p.unit, "decimals": p.decimals,
        "value": round(float(ys[-1]), p.decimals + 1), "trend": round(best["level"], p.decimals + 1),
        "slopePerMin": round(best["slope"], p.decimals + 2), "limit": lim.value, "limitKind": lim.kind,
        "direction": "up" if lim.direction > 0 else "down",
        "probability": round(prob, 3), "etaMin": None if eta is None else round(eta, 1),
        "etaRangeMin": [None if v is None else round(v, 1) for v in best["etaRange"]],
        "failure": fault or ("Авария" if lim.kind == "trip" else "Выход за предел тревоги"),
        "code": lim.code, "action": ACTIONS.get(lim.code, "Осмотреть узел и проверить датчик до выхода за предел."),
        "repairMin": REPAIR_MIN.get(lim.code, DEFAULT_REPAIR_MIN), "severity": severity,
        "points": len(ts), "windowMin": round((ts[-1] - ts[0]) / 60, 1),
    }


def detect_anomaly(model, threshold: float, c: Controller, p: Param, s: Series, now: float) -> dict | None:
    """Аномалия параметра с режимом (уставкой или номиналом) за последние 2 мин; None — не оценивается."""
    if not p.noise:
        return None
    keep = s.ts >= now - ANOMALY_WINDOW_S
    ts, ys = s.ts[keep], s.values[keep]
    if len(ts) < 18:
        return None
    sps = s.sps[keep] if s.sps is not None else None
    if sps is not None and np.ptp(sps) > 0:
        return None  # уставку меняли в окне — переходный процесс, не аномалия
    ref = expected(p, float(sps[-1]) if sps is not None else None)
    if ref is None:
        return None
    x = anomaly_features(ts[None, :], ys[None, :], ref, p.noise)
    score = float(model.mahalanobis(x)[0])
    mean_z, slope_t, spread = (float(v) for v in x[0])
    shift = float(ys.mean() - ref)
    return {
        "controller": c.id, "equipment": c.equipment, "area": c.area, "zone": c.zone,
        "param": p.id, "paramName": p.name, "unit": p.unit, "decimals": p.decimals,
        "value": round(float(ys[-1]), p.decimals + 1), "expected": ref, "shift": round(shift, p.decimals + 1),
        "shiftSigma": round(shift / p.noise, 1), "slopeT": round(slope_t, 1), "spread": round(spread, 2),
        "score": round(score, 1), "threshold": round(threshold, 1), "anomalous": score > threshold,
        # насколько окно необычнее порога: 0 — на пороге, 1 — втрое дальше
        "strength": round(min(1.0, max(0.0, (score - threshold) / (2 * threshold))), 2),
    }
