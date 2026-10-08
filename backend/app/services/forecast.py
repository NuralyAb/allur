"""Сценарная студия: вероятностный прогноз месяца по данным завода.

Одна модель на весь двойник. Параметры калибруются по тем же данным, что и центр решений (insights.area_base):
    темп участка в часы работы = фактический выпуск / (480 − средний простой за смену)
    годные = выпуск × (1 − брак): брак занимает мощность участка (кузов уходит на доработку)
    отказы — по журналу простоев: частота на смену и средняя длительность для каждой единицы оборудования
Без случайности модель точно воспроизводит детерминированный расчёт центра решений; Монте-Карло добавляет
то, чего в нём нет: отказы случаются в случайное время и длятся случайно, буферы между участками конечны,
поэтому остановка одного участка через время буфера останавливает соседние.

Поток — жидкостная (fluid) модель с шагом DT минут, векторизованная по прогонам: сотни месяцев за доли секунды.
Узкое место прогона — участок, который дольше всех работал «без оглядки на соседей» (не ждал кузовов
и не упирался в полный буфер): метод активных периодов.
"""
from dataclasses import dataclass, field, replace
from itertools import combinations
from math import ceil

import numpy as np

from . import insights, kpi, settings

SHIFT_MIN = 480
DT = 2.0  # шаг модели, мин
DURATION_CV = 0.5  # разброс длительности внепланового простоя (коэффициент вариации), допущение
BUFFER_DEFAULT = 10  # кузовов в каждом межучастковом буфере (≈40 мин такта), допущение
BUFFER_START = 0.5  # буферы заполнены наполовину в начале месяца
FAST_REPAIR = 0.5  # «быстрый ремонт» сокращает длительность внеплановых простоев вдвое
SPEEDUP = 1.05  # «ускорение такта» узкого места на 5 %
MAX_EXTRA_SHIFTS = 20  # больше смен в выходные за месяц не бывает (≈ 4–5 выходных × 2 смены × 2 дня)

# Стоимость мероприятий, ₸ в месяц. Это оценки по умолчанию для демонстрации, не данные Allur:
# руководитель задаёт свои значения в запросе.
COSTS = {
    "planned": 3_000_000,  # сверхурочные ремонтной службы в межсменное окно
    "quality": 8_000_000,  # аудит процесса, расходные материалы, обучение — на участок
    "predictive": 5_000_000,  # датчики, сервис мониторинга
    "fastRepair": 4_000_000,  # дежурный слесарь, запасные цепи и узлы у линии
    "speedup": 15_000_000,  # балансировка линии на узком месте
    "extraShift": 12_000_000,  # одна дополнительная смена в выходной
}


@dataclass(frozen=True)
class Failure:
    equipment: str
    area: str
    reason: str
    planned: bool
    rate: float  # событий на смену
    minutes: float  # средняя длительность


@dataclass(frozen=True)
class Stage:
    area: str
    rate: float  # годных кузовов в минуту работы
    output: float  # выпуск за смену в среднем (до брака)
    cap: float  # предел выпуска за смену (до брака), как в центре решений: max(план, факт)
    defect: float
    down: float  # средний простой за смену, мин
    failures: tuple[Failure, ...]


@dataclass(frozen=True)
class Scenario:
    """Что меняет руководитель. Пустой сценарий — текущий темп завода."""

    defect: dict = field(default_factory=dict)  # участок -> доля брака
    plannedOutside: bool = False  # плановые работы вне смены
    predictive: float = 0.0  # доля предотвращённых внеплановых отказов
    repair: dict = field(default_factory=dict)  # оборудование -> средняя длительность ремонта, мин
    speed: dict = field(default_factory=dict)  # участок -> множитель темпа
    buffer: int = BUFFER_DEFAULT
    shifts: int | None = None
    days: int | None = None
    extraShifts: int = 0

    def key(self):
        return (tuple(sorted(self.defect.items())), self.plannedOutside, self.predictive,
                tuple(sorted(self.repair.items())), tuple(sorted(self.speed.items())),
                self.buffer, self.shifts, self.days, self.extraShifts)


def calibrate(ds: dict | None = None) -> dict:
    """Параметры модели из данных: участки, оборудование, календарь, план и цель."""
    ds = insights.window(ds or kpi.current())
    base = insights.area_base(ds)
    stages = []
    for area, a in base.items():
        shifts_seen = sum(1 for r in ds["lines"] if r["area"] == area)
        events = {}
        for d in ds["downtime"]:
            if d["area"] == area:
                events.setdefault((d["equipment"], d["reason"]), []).append(d["minutes"])
        failures = tuple(
            Failure(equipment, area, reason, insights.REASONS.get(reason, insights.UNKNOWN_REASON)["planned"],
                    len(m) / shifts_seen, sum(m) / len(m))
            for (equipment, reason), m in sorted(events.items())
        )
        down = a["plannedMin"] + a["unplannedMin"]
        output = a["fact"]
        stages.append(Stage(area, output * (1 - a["defectRate"]) / max(1.0, SHIFT_MIN - down), output, a["cap"], a["defectRate"], down,
                            failures))
    return {
        "stages": stages,
        "shifts": kpi.targets()["shifts"],
        "days": settings.calc()["workDays"],
        "plan": sum(m["plan"] for m in ds["monthPlan"]),
        "target": kpi.targets()["monthly_output"],
        "period": [min(r["date"] for r in ds["lines"]), max(r["date"] for r in ds["lines"])],
    }


def _apply(stage: Stage, sc: Scenario) -> tuple[float, float, list[tuple[float, float, bool, int]]]:
    """Темп годных, предел годных за смену и отказы участка при сценарии: (частота, длительность, плановый, номер)."""
    gross = stage.rate / (1 - stage.defect)  # темп выпуска до брака
    defect = sc.defect.get(stage.area, stage.defect)
    speed = sc.speed.get(stage.area, 1.0)
    rate = gross * (1 - defect) * speed
    cap = stage.cap * (1 - defect) * speed
    failures = []
    for n, f in enumerate(stage.failures):
        if f.planned and sc.plannedOutside:
            continue
        rate_f = f.rate if f.planned else f.rate * (1 - sc.predictive)
        failures.append((rate_f, sc.repair.get(f.equipment, f.minutes), f.planned, n))
    return rate, cap, failures


def deterministic(cal: dict, sc: Scenario) -> dict:
    """Средние значения без случайности — то, что считает центр решений."""
    shifts = (sc.shifts or cal["shifts"]) * (sc.days or cal["days"]) + sc.extraShifts
    good = {}
    for s in cal["stages"]:
        rate, cap, failures = _apply(s, sc)
        good[s.area] = min(cap, rate * (SHIFT_MIN - sum(r * m for r, m, _, _ in failures)))
    bottleneck = min(good, key=good.get)
    return {"perShift": good[bottleneck], "areas": good, "bottleneck": bottleneck, "month": good[bottleneck] * shifts,
            "shifts": shifts}


def _downtime(seed: list[int], runs: int, steps: int, shifts: int, failures) -> np.ndarray:
    """Маска простоя [steps, runs]: случайные отказы в каждой смене.

    У каждой единицы оборудования свой поток случайных чисел, поэтому сценарий, который убирает или меняет один
    отказ, не сдвигает остальные — сравнение сценариев остаётся на общих случайных числах.
    """
    diff = np.zeros((runs, steps + 1), dtype=np.int32)
    per_shift = SHIFT_MIN / DT
    for rate, minutes, planned, n in failures:
        if rate <= 0 or minutes <= 0:
            continue
        rng = np.random.default_rng(seed + [n])
        if planned:
            # плановые работы: событие в смене с вероятностью rate (≤ 1), длительность фиксирована
            count = (rng.random((runs, shifts)) < min(rate, 1.0)).astype(np.int64) * max(1, round(rate))
        else:
            count = rng.poisson(rate, (runs, shifts))
        n = int(count.sum())
        if n == 0:
            continue
        run_idx = np.repeat(np.repeat(np.arange(runs), shifts), count.ravel())
        shift_idx = np.repeat(np.tile(np.arange(shifts), runs), count.ravel())
        if planned:
            dur = np.full(n, minutes)
        else:
            sigma = np.sqrt(np.log(1 + DURATION_CV ** 2))
            dur = rng.lognormal(np.log(minutes) - sigma ** 2 / 2, sigma, n)
        start = shift_idx * per_shift + rng.random(n) * per_shift
        a = np.minimum(np.floor(start).astype(np.int64), steps)
        b = np.minimum(np.floor(start + dur / DT).astype(np.int64) + 1, steps)
        np.add.at(diff, (run_idx, a), 1)
        np.add.at(diff, (run_idx, b), -1)
    return (np.cumsum(diff[:, :steps], axis=1) > 0).T


def monte_carlo(cal: dict, scenarios: list[Scenario], runs: int, seed: int = 1) -> list[dict]:
    """Прогоны месяца для набора сценариев одним векторизованным расчётом.

    У всех сценариев общие случайные числа (одинаковый seed на сценарий), поэтому разница между ними —
    эффект решения, а не шум.
    """
    stages = cal["stages"]
    k = len(stages)
    total_shifts = [(sc.shifts or cal["shifts"]) * (sc.days or cal["days"]) + sc.extraShifts for sc in scenarios]
    shifts = max(total_shifts)
    steps = int(shifts * SHIFT_MIN / DT)
    batch = runs * len(scenarios)
    rate = np.empty((batch, k))
    shift_cap = np.empty((batch, k))
    buffer = np.empty(batch)
    end = np.empty(batch, dtype=np.int64)
    down = np.zeros((steps, batch, k), dtype=bool)
    for j, sc in enumerate(scenarios):
        cols = slice(j * runs, (j + 1) * runs)
        buffer[cols] = sc.buffer
        end[cols] = int(total_shifts[j] * SHIFT_MIN / DT)
        for i, s in enumerate(stages):
            r, c, failures = _apply(s, sc)
            rate[cols, i] = r * DT
            shift_cap[cols, i] = c
            # одинаковый seed для всех сценариев: общие случайные числа
            down[:, cols, i] = _downtime([seed, i], runs, steps, shifts, failures)
    up = ~down
    rate = np.maximum(rate, 1e-9)
    per_shift = int(SHIFT_MIN / DT)
    buf = np.tile(buffer * BUFFER_START, (k - 1, 1)).T  # [batch, k-1]
    made = np.zeros((batch, k))  # выпущено в текущей смене — для предела за смену
    good = np.zeros(batch)
    busy = np.zeros((batch, k))  # доля шага, когда участок работал или стоял в простое (метод активных периодов)
    downtime = np.zeros((batch, k))
    starved = np.zeros((batch, k))
    blocked = np.zeros((batch, k))
    p = np.empty((batch, k))
    for t in range(steps):
        if t % per_shift == 0:
            made[:] = 0
        live = (t < end)[:, None]
        is_down = ~up[t] & live
        avail = np.minimum(rate * (up[t] & live), shift_cap - made)
        # от последнего участка к первому: каждый берёт из буфера перед собой и кладёт в буфер после себя
        lack_in = np.zeros((batch, k))
        lack_out = np.zeros((batch, k))
        for i in range(k - 1, -1, -1):
            x = avail[:, i]
            if i > 0:
                y = np.minimum(x, buf[:, i - 1])
                lack_in[:, i] = x - y
                x = y
            if i < k - 1:
                y = np.minimum(x, buffer - buf[:, i])
                lack_out[:, i] = x - y
                x = y
                buf[:, i] += x
            if i > 0:
                buf[:, i - 1] -= x
            p[:, i] = x
        made += p
        good += p[:, k - 1]
        downtime += is_down
        # доли шага: недогруз из-за пустого буфера перед участком и из-за полного буфера после него
        starved += lack_in / rate
        blocked += lack_out / rate
        busy += is_down + p / rate
    out = []
    names = [s.area for s in stages]
    for j, sc in enumerate(scenarios):
        cols = slice(j * runs, (j + 1) * runs)
        n = total_shifts[j]
        bn = np.argmax(busy[cols], axis=1)
        out.append({
            "scenario": sc,
            "month": good[cols],
            "shifts": n,
            "bottleneckShare": {names[i]: float(np.mean(bn == i)) for i in range(k)},
            "minutesPerShift": {
                names[i]: {"down": float(downtime[cols, i].mean() * DT / n), "starved": float(starved[cols, i].mean() * DT / n),
                           "blocked": float(blocked[cols, i].mean() * DT / n)}
                for i in range(k)
            },
        })
    return out


def _histogram(values: np.ndarray, bins: int = 24) -> list[dict]:
    lo, hi = float(values.min()), float(values.max())
    if hi - lo < 1:
        hi = lo + 1
    counts, edges = np.histogram(values, bins=bins, range=(lo, hi))
    return [{"from": round(float(edges[i])), "to": round(float(edges[i + 1])), "share": round(float(c) / len(values), 4)}
            for i, c in enumerate(counts)]


def summarize(cal: dict, mc: dict) -> dict:
    sc: Scenario = mc["scenario"]
    month = mc["month"]
    det = deterministic(cal, sc)
    p10, p50, p90 = (float(np.percentile(month, q)) for q in (10, 50, 90))
    return {
        "runs": len(month),
        "shifts": mc["shifts"],
        "deterministic": round(det["month"]),
        "mean": round(float(month.mean())),
        "p10": round(p10),
        "p50": round(p50),
        "p90": round(p90),
        # цена нестабильности: сколько авто съедают случайные отказы и конечные буферы
        "variabilityLoss": round(det["month"] - float(month.mean())),
        "probPlan": round(float(np.mean(month >= cal["plan"])), 3),
        "probTarget": round(float(np.mean(month >= cal["target"])), 3),
        "plan": cal["plan"],
        "target": cal["target"],
        "perShift": round(float(month.mean()) / mc["shifts"], 1),
        "bottleneck": det["bottleneck"],
        "bottleneckShare": {a: round(v, 3) for a, v in mc["bottleneckShare"].items()},
        "areas": {a: {"goodPerShift": round(det["areas"][a], 1),
                      **{k: round(v, 1) for k, v in mc["minutesPerShift"][a].items()}} for a in det["areas"]},
        "histogram": _histogram(month),
    }


def describe(cal: dict) -> dict:
    """Калибровка для интерфейса: что модель знает о заводе и что можно менять."""
    return {
        "period": cal["period"],
        "shifts": cal["shifts"],
        "days": cal["days"],
        "plan": cal["plan"],
        "target": cal["target"],
        "buffer": BUFFER_DEFAULT,
        "predictiveDefault": settings.calc()["predictiveCut"],
        "defectTarget": kpi.targets()["defect"],
        "costs": COSTS,
        "stages": [{"area": s.area, "goodPerShift": round(min(s.cap * (1 - s.defect), s.rate * (SHIFT_MIN - s.down)), 1),
                    "defect": round(s.defect * 100, 2),
                    "downPerShift": round(s.down, 1),
                    "failures": [{"equipment": f.equipment, "reason": f.reason, "planned": f.planned,
                                  "perShift": round(f.rate, 3), "minutes": round(f.minutes, 1)} for f in s.failures]}
                   for s in cal["stages"]],
        "assumptions": [
            f"Калибровка по данным за {cal['period'][0]} — {cal['period'][1]}: темп, брак и простои каждого участка.",
            "Строка данных — одна смена; темп участка в часы работы — фактический выпуск, делённый на время без простоев.",
            "Брак занимает мощность участка: кузов уходит на доработку, а годный выпуск снижается.",
            "Внеплановые отказы — пуассоновский поток с частотой из журнала, длительность — логнормальная "
            f"со средним из журнала и разбросом {round(DURATION_CV * 100)}%. Плановые работы — с фиксированной длительностью.",
            f"Буферы между участками — {BUFFER_DEFAULT} кузовов, в начале месяца заполнены наполовину; подача CKD не ограничена.",
            "Выпуск участка за смену не выше max(план, факт) — как в центре решений.",
            "Узкое место прогона — участок с наибольшей долей времени в работе или в простое, то есть не ждавший "
            "соседей (метод активных периодов).",
            "Стоимость мероприятий — оценки по умолчанию, не данные завода; задаются руководителем.",
        ],
    }


def forecast(sc: Scenario, runs: int = 400, seed: int = 1, ds: dict | None = None) -> dict:
    """Распределение выпуска месяца при сценарии и, для сравнения, при текущем темпе на тех же случайных числах."""
    cal = calibrate(ds)
    current = Scenario()
    runs_out = monte_carlo(cal, [current, sc] if sc.key() != current.key() else [sc], runs, seed)
    result = summarize(cal, runs_out[-1])
    base = summarize(cal, runs_out[0])
    result["base"] = {k: base[k] for k in ("mean", "p10", "p50", "p90", "probPlan", "probTarget", "deterministic", "bottleneck")}
    result["gain"] = result["mean"] - base["mean"]
    return result


# ---------- мероприятия: общий каталог для чувствительности и подбора плана ----------

def actions(cal: dict) -> list[dict]:
    """Мероприятия, применимые к текущим данным, с параметрами сценария."""
    target = kpi.targets()["defect"] / 100
    out = []
    if any(f.planned for s in cal["stages"] for f in s.failures):
        out.append({"id": "planned", "title": "Плановые работы — вне смены", "cost": COSTS["planned"],
                    "apply": {"plannedOutside": True}})
    for s in cal["stages"]:
        if s.defect > target:
            out.append({"id": f"quality:{s.area}", "title": f"Брак {insights.GENITIVE[s.area]} до {target * 100:g}%",
                        "cost": COSTS["quality"], "apply": {"defect": {s.area: target}}})
    unplanned = [f for s in cal["stages"] for f in s.failures if not f.planned]
    if unplanned:
        cut = settings.calc()["predictiveCut"]
        out.append({"id": "predictive", "title": f"Предиктивное ТО: −{round(cut * 100)}% внеплановых отказов",
                    "cost": COSTS["predictive"], "apply": {"predictive": cut}})
        out.append({"id": "fastRepair", "title": f"Быстрый ремонт: −{round(FAST_REPAIR * 100)}% длительности отказов",
                    "cost": COSTS["fastRepair"],
                    "apply": {"repair": {f.equipment: f.minutes * (1 - FAST_REPAIR) for f in unplanned}}})
    bn = deterministic(cal, Scenario())["bottleneck"]
    out.append({"id": f"speed:{bn}", "title": f"Темп {insights.GENITIVE[bn]} +{round((SPEEDUP - 1) * 100)}% (балансировка линии)",
                "cost": COSTS["speedup"], "apply": {"speed": {bn: SPEEDUP}}})
    return out


def _combine(base: Scenario, chosen: list[dict]) -> Scenario:
    sc = base
    for a in chosen:
        upd = {}
        for k, v in a["apply"].items():
            upd[k] = {**getattr(sc, k), **v} if isinstance(v, dict) else v
        sc = replace(sc, **upd)
    return sc


def sensitivity(runs: int = 250, seed: int = 1, ds: dict | None = None) -> dict:
    """Эффект каждого мероприятия по отдельности и одной доп. смены — для диаграммы «что сильнее влияет»."""
    cal = calibrate(ds)
    acts = actions(cal)
    scenarios = [Scenario()] + [_combine(Scenario(), [a]) for a in acts] + [Scenario(extraShifts=1)]
    res = monte_carlo(cal, scenarios, runs, seed)
    base = res[0]["month"]
    items = []
    for a, r in zip(acts + [{"id": "extraShift", "title": "Одна смена в выходной", "cost": COSTS["extraShift"]}], res[1:]):
        delta = r["month"] - base
        items.append({"id": a["id"], "title": a["title"], "cost": a["cost"],
                      "gain": round(float(delta.mean())), "gainP10": round(float(np.percentile(delta, 10))),
                      "gainP90": round(float(np.percentile(delta, 90))),
                      "probTarget": round(float(np.mean(r["month"] >= cal["target"])), 3)})
    items.sort(key=lambda x: -x["gain"])
    return {"base": round(float(base.mean())), "runs": runs, "items": items}


def plan_to_target(target: int | None = None, confidence: float = 0.8, costs: dict | None = None, margin: float = 0,
                   runs: int = 300, seed: int = 1, ds: dict | None = None) -> dict:
    """Самые дешёвые наборы мероприятий, при которых цель выполняется с заданной вероятностью.

    1. Все комбинации мероприятий оцениваются детерминированной моделью: сколько выходных смен нужно добавить.
    2. Самые дешёвые разные по составу кандидаты прогоняются Монте-Карло одним расчётом.
    3. Число смен уточняется по квантилю: смена в конце месяца добавляет почти постоянный выпуск, поэтому
       вероятность цели при n сменах — доля прогонов, где выпуск + (n − n₀) × выпуск смены ≥ цели.
    """
    cal = calibrate(ds)
    target = target or cal["target"]
    price = {**COSTS, **(costs or {})}
    acts = actions(cal)
    for a in acts:
        a["cost"] = price.get(a["id"].split(":")[0], a["cost"])
    shift_cost = price["extraShift"]
    candidates = []
    for n in range(len(acts) + 1):
        for chosen in combinations(acts, n):
            det = deterministic(cal, _combine(Scenario(), list(chosen)))
            extra = max(0, ceil((target - det["month"]) / det["perShift"]))
            if extra <= MAX_EXTRA_SHIFTS:
                candidates.append((sum(a["cost"] for a in chosen) + extra * shift_cost, list(chosen), extra))
    candidates.sort(key=lambda c: c[0])
    picked = candidates[:6]
    if not picked:
        return {"target": target, "confidence": confidence, "plans": [], "shiftCost": shift_cost, "margin": margin,
                "base": round(deterministic(cal, Scenario())["month"]), "baseProb": 0.0}
    scenarios = [Scenario()] + [_combine(Scenario(extraShifts=extra), chosen) for _, chosen, extra in picked]
    results = monte_carlo(cal, scenarios, runs, seed)
    base = results[0]["month"]
    plans = []
    for (_, chosen, extra0), r in zip(picked, results[1:]):
        month = r["month"]
        per_shift = float(month.mean()) / r["shifts"]
        extra = extra0
        # убираем лишние смены, пока вероятность держится, и добавляем недостающие
        while extra > 0 and np.mean(month + (extra - 1 - extra0) * per_shift >= target) >= confidence:
            extra -= 1
        while extra < MAX_EXTRA_SHIFTS and np.mean(month + (extra - extra0) * per_shift >= target) < confidence:
            extra += 1
        final = month + (extra - extra0) * per_shift
        prob = float(np.mean(final >= target))
        plans.append({
            "actions": [{"id": a["id"], "title": a["title"], "cost": a["cost"]} for a in chosen],
            "extraShifts": extra,
            "cost": sum(a["cost"] for a in chosen) + extra * shift_cost,
            "mean": round(float(final.mean())),
            "p10": round(float(np.percentile(final, 10))),
            "probTarget": round(prob, 3),
            "reached": prob >= confidence,
        })
    base_mean = float(base.mean())
    unique = {}
    for p in sorted(plans, key=lambda p: (not p["reached"], p["cost"])):
        unique.setdefault((tuple(a["id"] for a in p["actions"]), p["extraShifts"]), p)
    plans = list(unique.values())[:4]
    for p in plans:
        p["gain"] = p["mean"] - round(base_mean)
        p["net"] = round(p["gain"] * margin - p["cost"]) if margin else None
    return {"target": target, "confidence": confidence, "base": round(base_mean),
            "baseProb": round(float(np.mean(base >= target)), 3), "plans": plans, "shiftCost": shift_cost,
            "margin": margin, "runs": runs}
