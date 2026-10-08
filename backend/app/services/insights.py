"""Логика решений: узкое место потока, потери в автомобилях, прогноз месяца и сценарии «что если».

Модель смены по каждому участку (строка тестовых данных трактуется как одна смена, как и в условном OEE):
    выпуск = min(мощность, план − простои / такт − прочие потери)
    годные = выпуск × (1 − доля брака)
Прочие потери подбираются так, чтобы базовый сценарий точно воспроизводил средний факт участка.
Линия последовательная, поэтому устойчивый выпуск завода = минимум годных среди участков (узкое место).
"""
from math import ceil

from . import kpi, settings

FLOW = ["Сварка", "Окраска", "Сборка"]
# будни октября 2026 без 26.10 (перенос выходного за День Республики, выпавший на воскресенье)
# значения по умолчанию; действующие — из настроек администратора (services.settings)
WORK_DAYS = 21
PREDICTIVE_CUT = 0.5  # допущение: предиктивное обслуживание предотвращает половину внеплановых простоев

REASONS = {
    "Плановое ТО": {
        "planned": True,
        "action": "Перенести ТО в межсменное окно или на выходной; не ставить в смену на участке узкого места.",
    },
    "Замена фильтра": {
        "planned": True,
        "action": "Менять фильтр по датчику перепада давления между сменами; держать запасной комплект у кабины.",
    },
    "Ошибка датчика": {
        "planned": False,
        "action": "Проверить датчик и разъёмы, вести счётчик повторов; при повторе — замена и резервный датчик.",
    },
    "Засор форсунки": {
        "planned": False,
        "action": "Промывка форсунок по графику расхода краски; контроль давления подачи в реальном времени.",
    },
    "Отказ инструмента": {
        "planned": False,
        "action": "Резервный гайковёрт на посту; учёт циклов затяжки и замена до ресурса.",
    },
    "Обрыв цепи": {
        "planned": False,
        "action": "Еженедельный контроль вытяжки и натяжения цепи, вибродиагностика привода, запасная цепь на складе.",
    },
}
UNKNOWN_REASON = {"planned": False, "action": "Разобрать причину (5 почему) и назначить ответственного."}


GENITIVE = {"Сварка": "сварки", "Окраска": "окраски", "Сборка": "сборки"}


def _r(x: float, n: int = 1) -> float:
    return round(x, n)


def _n(x: float) -> str:
    """Число для текста: десятичная запятая, без лишнего нуля."""
    return f"{_r(x):g}".replace(".", ",")


def window(ds: dict) -> dict:
    """Последние WINDOW_DAYS дней: решения принимаются по свежему темпу, а не по всей истории."""
    dates = set(sorted({r["date"] for r in ds["lines"]})[-kpi.window_days():])
    return {**ds, **{k: [r for r in ds[k] if r["date"] in dates] for k in ("lines", "downtime", "quality")}}


def flow(ds: dict) -> list[str]:
    present = {r["area"] for r in ds["lines"]}
    return [a for a in FLOW if a in present]


def area_base(ds: dict) -> dict:
    """Средние за окно показатели участков в расчёте на смену."""
    out = {}
    for area in flow(ds):
        rows = [r for r in ds["lines"] if r["area"] == area]
        quality = [q for q in ds["quality"] if q["area"] == area]
        n = len(rows)
        plan = sum(r["plan"] for r in rows) / n
        fact = sum(r["fact"] for r in rows) / n
        takt = kpi.SHIFT_HOURS * 60 / plan
        events = [d for d in ds["downtime"] if d["area"] == area]
        planned = sum(d["minutes"] for d in events if REASONS.get(d["reason"], UNKNOWN_REASON)["planned"]) / n
        unplanned = sum(d["minutes"] for d in events) / n - planned
        out[area] = {
            "plan": plan,
            "fact": fact,
            "takt": takt,
            "defectRate": sum(q["defects"] for q in quality) / sum(q["output"] for q in quality),
            "plannedMin": planned,
            "unplannedMin": unplanned,
            "otherLoss": plan - fact - (planned + unplanned) / takt,
            "cap": max(plan, fact),
        }
    return out


def _levers(base: dict) -> list[dict]:
    """Мероприятия, которые можно включить в сценарий. Каждое меняет параметры модели участков."""
    target = kpi.targets()["defect"] / 100
    levers = []
    for area, a in base.items():
        if a["defectRate"] > target:
            levers.append({
                "id": f"quality:{area}",
                "area": area,
                "title": f"Брак {GENITIVE[area]} до нормы {kpi.targets()['defect']:g}%",
                "detail": f"Сейчас {_n(a['defectRate'] * 100)}%. Каждый дефект — кузов, не прошедший участок с первого раза.",
                "set": {area: {"defectRate": target}},
            })
    moved = {area: {"plannedMin": 0} for area, a in base.items() if a["plannedMin"] > 0}
    if moved:
        levers.append({
            "id": "planned",
            "area": None,
            "title": "Плановые работы — вне смены",
            "detail": "Плановое ТО и замена фильтров переносятся в межсменное окно; такт в смену не теряется.",
            "set": moved,
        })
    predictive_cut = settings.calc()["predictiveCut"]
    cut = {area: {"unplannedMin": a["unplannedMin"] * (1 - predictive_cut)} for area, a in base.items() if a["unplannedMin"] > 0}
    if cut:
        levers.append({
            "id": "predictive",
            "area": None,
            "title": "Предиктивное обслуживание",
            "detail": f"Мониторинг датчиков и цепей предотвращает {round(predictive_cut * 100)}% внеплановых остановок (допущение).",
            "set": cut,
        })
    return levers


def simulate(lever_ids: list[str] | None = None, shifts: int | None = None, days: int | None = None,
             extra_shifts: int = 0, ds: dict | None = None) -> dict:
    ds = window(ds or kpi.current())
    base = area_base(ds)
    shifts = kpi.targets()["shifts"] if shifts is None else shifts
    days = settings.calc()["workDays"] if days is None else days
    areas = {a: dict(v) for a, v in base.items()}
    for lever in _levers(base):
        if lever["id"] in (lever_ids or []):
            for area, changes in lever["set"].items():
                areas[area].update(changes)
    result = {}
    for area, a in areas.items():
        output = min(a["cap"], a["plan"] - (a["plannedMin"] + a["unplannedMin"]) / a["takt"] - a["otherLoss"])
        result[area] = {"output": output, "good": output * (1 - a["defectRate"]), "defectRate": a["defectRate"]}
    bottleneck = min(result, key=lambda area: result[area]["good"])
    per_shift = result[bottleneck]["good"]
    total_shifts = shifts * days + extra_shifts
    month = per_shift * total_shifts
    plan = sum(m["plan"] for m in ds["monthPlan"])
    target = kpi.targets()["monthly_output"]
    gap = max(0.0, target - month)
    return {
        "levers": lever_ids or [],
        "shifts": shifts,
        "days": days,
        "extraShifts": extra_shifts,
        "areas": {a: {"output": _r(v["output"]), "good": _r(v["good"]), "defectRate": _r(v["defectRate"] * 100)}
                  for a, v in result.items()},
        "bottleneck": bottleneck,
        "perShift": _r(per_shift),
        "month": round(month),
        "plan": plan,
        "target": target,
        "vsPlan": round(month - plan),
        "vsTarget": round(month - target),
        # сколько дополнительных смен нужно при этом темпе, чтобы выйти на цель
        "extraShiftsForTarget": ceil(gap / per_shift) if gap > 0 else 0,
        # такой выпуск годных за смену нужен на узком месте для цели без дополнительных смен
        "requiredPerShift": _r(target / total_shifts),
    }


def _risks(base: dict, bottleneck: str, ds: dict) -> list[dict]:
    limit = kpi.targets()["downtime_critical"]
    risks = []
    for e in kpi.downtime_events(ds):
        if e["area"] not in base:
            continue
        info = REASONS.get(e["reason"], UNKNOWN_REASON)
        share = e["dailyMinutes"] / limit
        on_bottleneck = e["area"] == bottleneck
        if not info["planned"] and share >= 0.75:
            level = "high"
        elif not info["planned"] or on_bottleneck:
            level = "medium"
        else:
            level = "low"
        cars = e["minutes"] / base[e["area"]]["takt"]
        risks.append({
            **e,
            "planned": info["planned"],
            "shareOfLimit": _r(share * 100, 0),
            "onBottleneck": on_bottleneck,
            "carsLost": _r(cars),
            # простой влияет на выпуск завода, только если стоит узкое место
            "plantCarsLost": _r(cars) if on_bottleneck else 0,
            "level": level,
            "action": info["action"],
        })
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(risks, key=lambda r: (order[r["level"]], -r["minutes"]))


def _alerts(base: dict, sim: dict, risks: list[dict], ds: dict) -> list[dict]:
    alerts = []
    bn = sim["bottleneck"]
    alerts.append({
        "level": "bad", "area": bn, "kind": "bottleneck",
        "title": f"Узкое место — {bn.lower()}",
        "text": f"{_n(sim['areas'][bn]['good'])} годных за смену при плане {round(base[bn]['plan'])}. "
                f"Выпуск завода ограничен этим участком.",
    })
    target = kpi.targets()["defect"]
    for area in base:
        rows = sorted((q for q in ds["quality"] if q["area"] == area), key=lambda q: q["date"])
        rates = [q["defects"] / q["output"] * 100 for q in rows]
        if rates[-1] > target:
            rising = len(rates) > 1 and rates[-1] > rates[-2]
            rates = rates[-3:]
            alerts.append({
                "level": "bad" if rising else "warn", "area": area, "kind": "quality",
                "title": f"Брак {GENITIVE[area]} {_n(rates[-1])}% при норме {target:g}%",
                "text": ("Растёт: " + " → ".join(f"{_n(x)}%" for x in rates) + " по дням.") if rising else "Выше нормы.",
            })
    areas = list(base)
    for up, down in zip(areas, areas[1:]):
        delta = sim["areas"][up]["good"] - base[down]["fact"]
        if delta < 0:
            alerts.append({
                "level": "warn", "area": down, "kind": "flow",
                "title": f"Буфер {up.lower()} → {down.lower()} тает",
                "text": f"{down} берёт на {_n(-delta)} кузова за смену больше, чем {up.lower()} выдаёт годных с первого раза. "
                        f"Разница покрывается запасом или доработкой, такой темп не устойчив.",
            })
    for r in risks:
        if r["level"] == "high":
            alerts.append({
                "level": "bad", "area": r["area"], "kind": "equipment",
                "title": f"{r['equipment']}: {r['dailyMinutes']} из {r['limit']} мин",
                "text": f"{r['reason']} — внеплановый простой, {r['shareOfLimit']:g}% суточного лимита.",
            })
    if sim["vsTarget"] < 0:
        alerts.append({
            "level": "warn", "area": None, "kind": "plan",
            "title": f"Прогноз месяца {sim['month']:,} при цели {sim['target']:,}".replace(",", " "),
            "text": f"Не хватает {-sim['vsTarget']} авто при текущем темпе узкого места.",
        })
    return alerts


def summary(ds: dict | None = None) -> dict:
    ds = window(ds or kpi.current())
    base = area_base(ds)
    sim = simulate(ds=ds)
    levers = _levers(base)
    for lever in levers:
        alone = simulate([lever["id"]], ds=ds)
        lever["effect"] = alone["month"] - sim["month"]
        lever["bottleneckAfter"] = alone["bottleneck"]
        del lever["set"]
    levers.sort(key=lambda lever: -lever["effect"])
    best = simulate([lever["id"] for lever in levers], ds=ds)
    risks = _risks(base, sim["bottleneck"], ds)
    alerts = _alerts(base, sim, risks, ds)
    status = {area: "ok" for area in base}
    for a in alerts:
        if a["area"] in status and status[a["area"]] != "bad":
            status[a["area"]] = a["level"]
    bn = base[sim["bottleneck"]]
    return {
        "assumptions": [
            f"Темп участков — среднее за последние {kpi.WINDOW_DAYS} дн. данных ({min(r['date'] for r in ds['lines'])} — {max(r['date'] for r in ds['lines'])}).",
            "Строка данных — одна смена; в сутках 2 смены.",
            f"{settings.calc()['workDays']} рабочих дней в месяце прогноза (по умолчанию 21: будни октября 2026 без 26.10).",
            "Брак участка — кузов, не прошедший участок с первого раза; доработанные кузова в прогноз не входят.",
            f"Предиктивное обслуживание предотвращает {round(settings.calc()['predictiveCut'] * 100)}% внеплановых простоев.",
            "Эффект мероприятий считается через узкое место: улучшение другого участка выпуск не увеличивает.",
        ],
        "workDays": settings.calc()["workDays"],
        "marginKzt": settings.calc()["marginKzt"],
        "base": sim,
        "best": best,
        "levers": levers,
        "risks": risks,
        "alerts": alerts,
        "status": status,
        "flow": [{"area": a, "plan": _r(base[a]["plan"]), "fact": _r(base[a]["fact"]), "good": sim["areas"][a]["good"],
                  "takt": _r(base[a]["takt"], 2)} for a in base],
        # потери узкого места к плану за месяц — это недовыпуск завода
        "lostPerMonth": round((bn["plan"] - sim["perShift"]) * sim["shifts"] * sim["days"]),
        # номинальная мощность при плановом такте и 2 сменах: цель 5500 выше неё
        "nominalCapacity": round(bn["plan"] * sim["shifts"] * sim["days"]),
    }
