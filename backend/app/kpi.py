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


def downtime_events() -> list[dict]:
    """Daily equipment totals, rather than comparing an area's sum to the limit."""
    return [
        {
            **event,
            "dailyMinutes": sum(d["minutes"] for d in DOWNTIME
                                if (d["date"], d["equipment"]) == (event["date"], event["equipment"])),
            "limit": TARGETS["downtime_critical"],
            "overLimit": sum(d["minutes"] for d in DOWNTIME
                             if (d["date"], d["equipment"]) == (event["date"], event["equipment"])) > TARGETS["downtime_critical"],
        }
        for event in DOWNTIME
    ]


def summary() -> dict:
    rows = [line_metrics(r) for r in LINES]
    last_date = max(r["date"] for r in rows)
    last = [r for r in rows if r["date"] == last_date]
    assembly = next(r for r in last if r["area"] == "Сборка")
    lowest = min(last, key=lambda r: r["fact"])
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
            "basis": assembly["line"],
            "plan": assembly["plan"],
            "fact": assembly["fact"],
            "good": assembly["fact"] - assembly["defects"],
            "oee": assembly["oee"],  # conditional demo indicator, not plant-wide OEE
            "defectRate": assembly["defectRate"],
            "downtime": sum(r["downtime"] for r in last),
        },
        "flowMinimum": {"area": lowest["area"], "fact": lowest["fact"]},
        "downtimeEvents": downtime_events(),
        "monthPlan": {"models": MONTH_PLAN, "total": month_plan, "target": TARGETS["monthly_output"],
                      "gap": max(0, TARGETS["monthly_output"] - month_plan)},
        "meta": {
            "demo": True,
            "source": "Кейс_Цифровой_двойник_Тестовые_данные.docx",
            "shiftHours": SHIFT_HOURS,
            "methodology": [
                "Факт выпуска и брак в сводке относятся к Сборке-1. Данные приёмки ОТК отсутствуют.",
                "Условный OEE = min(время работы / 8 ч, 1) × min(факт / план, 1) × доля годных. Это демонстрационная оценка: идеальный такт отсутствует.",
                "В кейсе указаны 2 смены по 8 часов. Период строк не уточнён; только для условного OEE строка трактуется как одна смена.",
                "Минимальный факт участка не равен выпуску завода и не доказывает наличие узкого места: остатки между участками неизвестны.",
                "Простои — исторические события. Критичность оборудования не указана; сравнение с 60 мин/сутки условное.",
                "Данные статичны, а движение оборудования в 3D иллюстративно. Текущего мониторинга и прогноза в этом режиме нет.",
            ],
            "issues": [
                {"date": r["date"], "line": r["line"],
                 "message": f"Работа {round(r['hours'] * 60)} мин + журнал простоев {r['downtime']} мин = {round(r['hours'] * 60) + r['downtime']} мин, больше 480 мин. Нельзя считать эти записи одной сменой без уточнения периода."}
                for r in rows if round(r["hours"] * 60) + r["downtime"] > SHIFT_HOURS * 60
            ],
        },
    }
