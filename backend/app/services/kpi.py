"""Производственные показатели и расчёт OEE по данным из хранилища. Цели и окно расчёта — из настроек администратора."""
from ..repositories import store
from . import settings

SHIFT_HOURS = 8.0

TARGETS = settings.DEFAULT_TARGETS  # значения по умолчанию; действующие — targets()


def targets() -> dict:
    return settings.targets()

# окно для сводки по участкам: при живом источнике история растёт (по умолчанию; действующее — window_days())
WINDOW_DAYS = 7


def window_days() -> int:
    return settings.calc()["windowDays"]


def current() -> dict:
    """Текущий набор данных из хранилища (файл кейса, импорт или симулятор)."""
    return store.default().dataset()


def _pct(x: float) -> float:
    return round(x * 100, 1)


def line_metrics(row: dict, ds: dict) -> dict:
    q = next(r for r in ds["quality"] if r["date"] == row["date"] and r["area"] == row["area"])
    availability = row["hours"] / SHIFT_HOURS
    performance = row["fact"] / row["plan"]
    quality = 1 - q["defects"] / q["output"]
    downtime = sum(d["minutes"] for d in ds["downtime"] if d["date"] == row["date"] and d["area"] == row["area"])
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


def downtime_events(ds: dict) -> list[dict]:
    """Daily equipment totals, rather than comparing an area's sum to the limit."""
    limit = targets()["downtime_critical"]
    return [
        {
            **event,
            "dailyMinutes": sum(d["minutes"] for d in ds["downtime"]
                                if (d["date"], d["equipment"]) == (event["date"], event["equipment"])),
            "limit": limit,
            "overLimit": sum(d["minutes"] for d in ds["downtime"]
                             if (d["date"], d["equipment"]) == (event["date"], event["equipment"])) > limit,
        }
        for event in ds["downtime"]
    ]


def summary(ds: dict | None = None) -> dict:
    ds = ds or current()
    rows = [line_metrics(r, ds) for r in ds["lines"]]
    last_date = max(r["date"] for r in rows)
    last = [r for r in rows if r["date"] == last_date]
    assembly = next((r for r in last if r["area"] == "Сборка"), last[-1])
    lowest = min(last, key=lambda r: r["fact"])
    areas = {}
    recent = sorted({r["date"] for r in rows})[-window_days():]
    for r in rows:
        if r["date"] in recent:
            areas.setdefault(r["area"], []).append(r)
    month_plan = sum(m["plan"] for m in ds["monthPlan"])
    t = targets()
    return {
        "targets": t,
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
        "downtimeEvents": downtime_events(ds),
        "monthPlan": {"models": ds["monthPlan"], "total": month_plan, "target": t["monthly_output"],
                      "gap": max(0, t["monthly_output"] - month_plan)},
        "meta": {
            "demo": True,
            "source": ds["source"],
            "updatedAt": ds["updatedAt"],
            "shiftHours": SHIFT_HOURS,
            "methodology": [
                "Факт выпуска и брак в сводке относятся к Сборке-1. Данные приёмки ОТК отсутствуют.",
                "Условный OEE = min(время работы / 8 ч, 1) × min(факт / план, 1) × доля годных. Это демонстрационная оценка: идеальный такт отсутствует.",
                "В кейсе указаны 2 смены по 8 часов. Период строк не уточнён; только для условного OEE строка трактуется как одна смена.",
                "Минимальный факт участка не равен выпуску завода и не доказывает наличие узкого места: остатки между участками неизвестны.",
                "Простои — исторические события. Критичность оборудования не указана; сравнение с 60 мин/сутки условное.",
            ],
            "issues": [
                {"date": r["date"], "line": r["line"],
                 "message": f"Работа {round(r['hours'] * 60)} мин + журнал простоев {r['downtime']} мин = {round(r['hours'] * 60) + r['downtime']} мин, больше 480 мин. Нельзя считать эти записи одной сменой без уточнения периода."}
                for r in rows if round(r["hours"] * 60) + r["downtime"] > SHIFT_HOURS * 60
            ],
        },
    }
