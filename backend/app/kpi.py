"""Производственные показатели по тестовым данным кейса и расчёт OEE."""

SHIFT_HOURS = 8.0

TARGETS = {
    "oee": 85.0,  # %, не менее
    "defect": 2.0,  # %, не более
    "downtime_critical": 60,  # мин/сутки на единицу критического оборудования
    "monthly_output": 5500,  # авто/месяц, не менее
    "shifts": 2,
}

LINES = [
    {"date": "2026-10-01", "line": "Сварка-1", "area": "Сварка", "plan": 120, "fact": 118, "hours": 7.8, "load": 98},
    {"date": "2026-10-01", "line": "Окраска-1", "area": "Окраска", "plan": 120, "fact": 115, "hours": 7.5, "load": 94},
    {"date": "2026-10-01", "line": "Сборка-1", "area": "Сборка", "plan": 120, "fact": 121, "hours": 8.0, "load": 100},
    {"date": "2026-10-02", "line": "Сварка-1", "area": "Сварка", "plan": 120, "fact": 111, "hours": 7.2, "load": 91},
    {"date": "2026-10-02", "line": "Окраска-1", "area": "Окраска", "plan": 120, "fact": 116, "hours": 7.7, "load": 96},
    {"date": "2026-10-02", "line": "Сборка-1", "area": "Сборка", "plan": 120, "fact": 119, "hours": 7.9, "load": 99},
]

DOWNTIME = [
    {"date": "2026-10-01", "area": "Сварка", "equipment": "ABB-01", "reason": "Ошибка датчика", "minutes": 25},
    {"date": "2026-10-01", "area": "Окраска", "equipment": "Камера-02", "reason": "Замена фильтра", "minutes": 40},
    {"date": "2026-10-02", "area": "Сборка", "equipment": "Конвейер-03", "reason": "Обрыв цепи", "minutes": 55},
    {"date": "2026-10-02", "area": "Сварка", "equipment": "ABB-04", "reason": "Плановое ТО", "minutes": 30},
]

QUALITY = [
    {"date": "2026-10-01", "area": "Сварка", "output": 118, "defects": 2},
    {"date": "2026-10-01", "area": "Окраска", "output": 115, "defects": 4},
    {"date": "2026-10-01", "area": "Сборка", "output": 121, "defects": 1},
    {"date": "2026-10-02", "area": "Сварка", "output": 111, "defects": 3},
    {"date": "2026-10-02", "area": "Окраска", "output": 116, "defects": 6},
    {"date": "2026-10-02", "area": "Сборка", "output": 119, "defects": 2},
]

MONTH_PLAN = [
    {"model": "Chevrolet Onix", "plan": 2500},
    {"model": "Chevrolet Cobalt", "plan": 1800},
    {"model": "JAC J7", "plan": 500},
]


def _pct(x: float) -> float:
    return round(x * 100, 1)


def line_metrics(row: dict) -> dict:
    q = next(r for r in QUALITY if r["date"] == row["date"] and r["area"] == row["area"])
    availability = row["hours"] / SHIFT_HOURS
    performance = row["fact"] / row["plan"]
    quality = 1 - q["defects"] / q["output"]
    downtime = sum(d["minutes"] for d in DOWNTIME if d["date"] == row["date"] and d["area"] == row["area"])
    return {
        **row,
        "availability": _pct(availability),
        "performance": _pct(performance),
        "quality": _pct(quality),
        # производительность выше плана не завышает OEE
        "oee": _pct(min(availability, 1) * min(performance, 1) * quality),
        "defects": q["defects"],
        "defectRate": _pct(q["defects"] / q["output"]),
        "downtime": downtime,
    }


def summary() -> dict:
    rows = [line_metrics(r) for r in LINES]
    last_date = max(r["date"] for r in rows)
    last = [r for r in rows if r["date"] == last_date]
    areas = {}
    for r in rows:
        areas.setdefault(r["area"], []).append(r)
    month_plan = sum(m["plan"] for m in MONTH_PLAN)
    return {
        "targets": TARGETS,
        "date": last_date,
        "rows": rows,
        "areas": {a: sorted(v, key=lambda r: r["date"]) for a, v in areas.items()},
        "plant": {
            "plan": max(r["plan"] for r in last),  # переделы последовательны: план завода = план линии
            "fact": min(r["fact"] for r in last),  # выпуск завода ограничен самым медленным переделом
            "oee": round(sum(r["oee"] for r in last) / len(last), 1),
            "defectRate": round(sum(r["defects"] for r in last) / sum(r["fact"] for r in last) * 100, 1),
            "downtime": sum(r["downtime"] for r in last),
        },
        "monthPlan": {"models": MONTH_PLAN, "total": month_plan, "target": TARGETS["monthly_output"]},
    }
