"""Вероятностный прогноз выпуска месяца: метод Монте-Карло поверх модели потока из services.insights.

Детерминированный прогноз отвечает «сколько при среднем темпе». Руководителю важнее «с какой вероятностью
выполним план» и «что чаще всего его срывает». Для этого месяц проигрывается тысячи раз по сменам:
  • мощность участка за смену — из фактических смен окна (бутстреп) с разбросом между сменами;
  • внеплановые простои — пуассоновский поток событий с частотой и длительностями из журнала простоев;
  • брак — биномиальный по доле брака участка в выбранную смену;
  • выпуск завода за смену — минимум годных среди участков (последовательная линия, как в insights).
Сценарий «с ИИ» убирает отказы, которые видны по датчикам заранее (тренд к порогу), и переносит замену
фильтров по прогнозу в межсменное окно.
"""
import hashlib
import json

import numpy as np

from ..services import insights, kpi, settings

RUNS = 4000
# простои, которые модель обслуживания видит заранее: развиваются по измеряемому параметру
PREDICTABLE = {
    "Обрыв цепи": "натяжение цепи конвейера растёт до порога",
    "Перегрузка привода": "ток привода уходит от номинала",
    "Износ электродов": "износ колпачков считается до порога",
    "Перегрев ванны": "температура ванны идёт к пределу",
    "Перегрев печи": "температура печи идёт к пределу",
    "Нет охлаждения": "расход охлаждения падает",
}
# плановые работы, которые прогноз позволяет вынести из смены: срок известен заранее
SCHEDULABLE = {"Замена фильтра": "перепад давления на фильтре — срок замены известен за десятки минут"}
RECALL = 0.9  # допущение: доля предсказуемых отказов, предупреждённых вовремя (в проверке на симуляторе — все)


def _area_samples(ds: dict, base: dict) -> tuple[list[str], dict]:
    dates = sorted({r["date"] for r in ds["lines"]})
    out = {}
    for area, b in base.items():
        rows = {r["date"]: r for r in ds["lines"] if r["area"] == area}
        qual = {q["date"]: q for q in ds["quality"] if q["area"] == area}
        cap, defect, unplanned_min, sched_min = [], [], [], []
        for d in dates:
            r = rows.get(d)
            if r is None:
                continue
            events = [e for e in ds["downtime"] if e["date"] == d and e["area"] == area]
            unpl = sum(e["minutes"] for e in events if not insights.REASONS.get(e["reason"], insights.UNKNOWN_REASON)["planned"])
            sched = sum(e["minutes"] for e in events if e["reason"] in SCHEDULABLE)
            # мощность смены без внеплановых остановок: их разыгрываем отдельно
            cap.append(r["fact"] + unpl / b["takt"])
            q = qual.get(d)
            defect.append(q["defects"] / q["output"] if q and q["output"] else b["defectRate"])
            unplanned_min.append(unpl)
            sched_min.append(sched)
        events = [e for e in ds["downtime"] if e["area"] == area and not insights.REASONS.get(e["reason"], insights.UNKNOWN_REASON)["planned"]]
        out[area] = {
            "cap": np.array(cap), "defect": np.array(defect), "sched": np.array(sched_min),
            "takt": b["takt"], "plan": b["plan"],
            "events": [{"minutes": e["minutes"], "predictable": e["reason"] in PREDICTABLE} for e in events],
            "shifts": len(cap),
        }
    return list(base), out


def _simulate(areas: list[str], data: dict, shifts_total: int, rng, ai: bool) -> tuple[np.ndarray, dict]:
    runs = RUNS
    good_by_area = np.empty((len(areas), runs, shifts_total))
    for i, area in enumerate(areas):
        a = data[area]
        n = len(a["cap"])
        idx = rng.integers(0, n, (runs, shifts_total))
        spread = max(float(a["cap"].std()), 0.02 * a["plan"])
        cap = a["cap"][idx] + rng.normal(0, spread, (runs, shifts_total))
        if ai:  # плановую замену по прогнозу делают между сменами — мощность смены не теряется
            cap = cap + a["sched"][idx] / a["takt"]
        cap = np.clip(cap, 0, 1.08 * a["plan"])
        events = [e for e in a["events"] if not (ai and e["predictable"])]
        lost = np.zeros((runs, shifts_total))
        if events:
            rate = len(events) / max(a["shifts"], 1)
            if ai:  # предсказуемые отказы, которые не успели предупредить
                missed = [e for e in a["events"] if e["predictable"]]
                rate += (1 - RECALL) * len(missed) / max(a["shifts"], 1)
                events = events + missed
            count = rng.poisson(rate, (runs, shifts_total))
            minutes = np.array([e["minutes"] for e in events], dtype=float)
            # длительность каждого события — из журнала; сумма за смену ≈ число событий × случайная длительность
            lost = count * rng.choice(minutes, (runs, shifts_total)) / a["takt"]
        output = np.clip(cap - lost, 0, None)
        p = a["defect"][idx]
        defects = rng.binomial(np.round(output).astype(int), np.clip(p, 0, 1))
        good_by_area[i] = output - defects
    plant = good_by_area.min(axis=0)
    month = plant.sum(axis=1)
    who = good_by_area.argmin(axis=0)
    shares = {area: round(float((who == i).mean()), 3) for i, area in enumerate(areas)}
    return month, shares


def monthly(ds: dict | None = None) -> dict:
    ds = insights.window(ds or kpi.current())
    base = insights.area_base(ds)
    det = insights.simulate(ds=ds)
    shifts, days = kpi.targets()["shifts"], settings.calc()["workDays"]
    total = shifts * days
    areas, data = _area_samples(ds, base)
    # воспроизводимость: одинаковые данные — одинаковый прогноз, без скачков при обновлении страницы
    seed = int(hashlib.sha256(json.dumps([ds["lines"], ds["downtime"], ds["quality"], total], sort_keys=True,
                                         ensure_ascii=False).encode()).hexdigest()[:8], 16)
    plan, target = det["plan"], det["target"]
    scen = []
    months = {}
    for sid, title, ai in (("base", "Текущий темп", False), ("ai", "С предиктивным обслуживанием ИИ", True)):
        month, shares = _simulate(areas, data, total, np.random.default_rng(seed), ai)
        months[sid] = month
        scen.append({
            "id": sid, "title": title,
            "mean": round(float(month.mean())), "p10": round(float(np.quantile(month, 0.1))),
            "p50": round(float(np.quantile(month, 0.5))), "p90": round(float(np.quantile(month, 0.9))),
            "pPlan": round(float((month >= plan).mean()), 3), "pTarget": round(float((month >= target).mean()), 3),
            "bottleneck": shares,
        })
    allm = np.concatenate(list(months.values()))
    lo, hi = np.quantile(allm, 0.002), np.quantile(allm, 0.998)
    edges = np.linspace(lo, hi, 25)
    for s in scen:
        counts, _ = np.histogram(np.clip(months[s["id"]], lo, hi), edges)
        s["hist"] = [round(float(c) / RUNS, 4) for c in counts]
    unplanned = [e for a in data.values() for e in a["events"]]
    total_min = sum(e["minutes"] for e in unplanned)
    pred_min = sum(e["minutes"] for e in unplanned if e["predictable"])
    return {
        "runs": RUNS, "shifts": total, "plan": plan, "target": target, "deterministic": det["month"],
        "bins": [round(float(x)) for x in edges], "scenarios": scen,
        "predictableShare": round(pred_min / total_min, 3) if total_min else 0.0,
        "predictable": sorted({e["reason"] for e in ds["downtime"] if e["reason"] in PREDICTABLE | SCHEDULABLE}),
        "assumptions": [
            f"{RUNS} проигрышей месяца по {total} сменам ({shifts} смены × {days} дн.).",
            "Мощность смены — бутстреп фактических смен окна с разбросом между сменами (не меньше 2 % плана).",
            "Внеплановые простои — пуассоновский поток с частотой и длительностями из журнала простоев.",
            "Выпуск завода за смену — минимум годных среди участков, как в детерминированной модели.",
            f"С ИИ: {round(RECALL * 100)}% отказов, видимых по датчикам заранее ({', '.join(PREDICTABLE)}), предупреждаются; "
            "замена фильтров по прогнозу переносится в межсменное окно.",
        ],
    }
