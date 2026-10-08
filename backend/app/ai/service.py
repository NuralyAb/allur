"""Отчёты ИИ для API и ассистента: прогноз отказов, аномалии, причины брака, прогноз месяца, сводка для 3D."""
import time

from ..scada import runtime as scada_rt
from ..services import insights, kpi
from . import engine, forecast

# сценарии развивающихся неисправностей для демонстрации на симуляторе: что ИИ увидит раньше тревоги ПЛК
DEMOS = [
    {"id": "bearing", "controller": "conveyor-03", "param": "MotorCurrent", "rate": 1.5,
     "title": "Износ подшипника привода конвейера", "detail": "Ток привода растёт на 1,5 А/мин. Тревога ПЛК — через ~10 мин, авария — через ~19 мин."},
    {"id": "bath", "controller": "ed-10", "param": "BathTemp", "rate": 0.25,
     "title": "Отказ теплообменника ванны катафореза", "detail": "Температура ванны растёт на 0,25 °C/мин. Брак грунта растёт раньше аварии."},
    {"id": "optics", "controller": "laser-01", "param": "OpticsTemp", "rate": 0.8,
     "title": "Загрязнение защитного стекла лазера", "detail": "Температура оптики растёт на 0,8 °C/мин до аварийного порога 60 °C."},
    {"id": "rollers", "controller": "brake-01", "param": "MotorTemp", "rate": 1.2,
     "title": "Перегрев двигателей тормозного стенда", "detail": "Температура двигателей роликов растёт на 1,2 °C/мин."},
]


def _flow() -> tuple[dict, str]:
    ds = insights.window(kpi.current())
    base = insights.area_base(ds)
    return base, insights.simulate(ds=ds)["bottleneck"]


def status() -> dict:
    from . import assistant
    e = engine.default()
    return {"status": e.status, "error": e.error, "trainedAt": e.trained_at, "metrics": e.metrics,
            "updated": e.updated, "signals": e.signals(), "llm": assistant.state(), "simulator": scada_rt.rt.sim is not None}


def maintenance() -> dict:
    """Прогнозы отказов с переводом в потерянные автомобили и аномалии параметров."""
    snap = engine.default().snapshot()
    base, bottleneck = _flow()
    for p in snap["predictions"]:
        takt = base.get(p["area"], {}).get("takt")
        p["carsAtRisk"] = round(p["repairMin"] / takt, 1) if takt else None
        p["onBottleneck"] = p["area"] == bottleneck
    return {**snap, "bottleneck": bottleneck, "demos": DEMOS if scada_rt.rt.sim is not None else [],
            "active": _active_demos()}


def _active_demos() -> list[str]:
    sim = scada_rt.rt.sim
    if sim is None:
        return []
    return [d["id"] for d in DEMOS if d["param"] in sim.plcs[d["controller"]].wear]


def quality() -> dict:
    """Риск брака при текущем режиме по участкам: модель, главные факторы и пороги, факт с ПЛК и данные кейса."""
    e = engine.default()
    s = scada_rt.rt.scada
    if not e.ready:
        return {"status": e.status, "areas": []}
    target = kpi.targets()["defect"]
    ds = insights.window(kpi.current())
    base = insights.area_base(ds)
    areas: dict[str, dict] = {}
    for cid, q in e.quality_models.items():
        c = e.registry.controllers[cid]
        values, sps = e.current_values(s, cid) if s else ({}, {})
        running = bool(s) and s.comm(c)[0] == "good" and s.state(c).name == "EXECUTE"
        ex = q.explain(values if running else q.nominal)
        processed = s.v(cid, "Admin.ProdProcessedCount", 0) if s else 0
        defective = s.v(cid, "Admin.ProdDefectiveCount", 0) if s else 0
        a = areas.setdefault(c.area, {"area": c.area, "zone": c.zone, "controllers": []})
        a["controllers"].append({
            "controller": cid, "equipment": c.equipment, "name": c.name, "running": running,
            "risk": ex["risk"], "baseline": ex["baseline"], "factors": ex["factors"][:4],
            "drivers": q.drivers, "metrics": q.metrics,
            "observed": {"processed": processed, "defective": defective,
                         "rate": round(defective / processed, 4) if processed else None},
        })
    out = []
    for area, a in areas.items():
        # уровень брака в паспорте задан на узел, поэтому участок характеризует узел с наибольшим риском
        a["controllers"].sort(key=lambda c: -c["risk"])
        top = a["controllers"][0]
        a["risk"], a["baseline"], a["worst"] = top["risk"], top["baseline"], top["equipment"]
        a["caseRate"] = round(base[area]["defectRate"] * 100, 2) if area in base else None
        out.append(a)
    order = {a: i for i, a in enumerate(insights.FLOW)}
    out.sort(key=lambda a: order.get(a["area"], 9))
    return {"status": e.status, "target": target, "areas": out}


def month() -> dict:
    return forecast.monthly()


def scene() -> list[dict]:
    """Короткая сводка для 3D-модели и списка участков: только то, что требует внимания."""
    snap = engine.default().snapshot()
    out = []
    for p in snap["predictions"]:
        if p["severity"] == "ok":
            continue
        when = f"через ~{round(p['etaMin'])} мин" if p["etaMin"] is not None else f"вероятность {round(p['probability'] * 100)}% за час"
        out.append({"area": p["area"], "zone": p["zone"], "controller": p["controller"], "level": p["severity"],
                    "kind": "forecast", "title": f"ИИ: {p['equipment']} — {p['failure'].lower()} {when}",
                    "text": f"{p['paramName']} {p['value']:g} {p['unit']} → порог {p['limit']:g}. {p['action']}"})
    for a in snap["anomalies"]:
        out.append({"area": a["area"], "zone": a["zone"], "controller": a["controller"], "level": "warn", "kind": "anomaly",
                    "title": f"ИИ: аномалия — {a['equipment']}, {a['paramName'].lower()}",
                    "text": f"Отклонение от режима {a['shiftSigma']:+g}σ ({a['value']:g} {a['unit']} при норме {a['expected']:g})."})
    return out


def equipment() -> dict:
    """Сжатое состояние оборудования для ассистента: состояние, параметры, активные тревоги."""
    s = scada_rt.rt.scada
    if s is None:
        return {"error": "SCADA не запущена"}
    snap = s.snapshot()
    ctrls = []
    for c in s.registry.controllers.values():
        st = snap["controllers"][c.id]
        ctrls.append({
            "id": c.id, "equipment": c.equipment, "name": c.name, "area": c.area, "state": st["stateName"],
            "stopReason": st["stopText"] or None, "speed": st["speed"], "processed": st["processed"], "defective": st["defective"],
            "params": {p.name: {"value": st["params"][p.id]["pv"], "unit": p.unit, "setpoint": st["params"][p.id]["sp"],
                                "alarms": p.alarms, "trip": p.trip} for p in c.params},
        })
    alarms = [{"equipment": s.registry.controllers[a["controller"]].equipment, "priority": a["priority"], "message": a["message"],
               "acked": a["acked"], "minutesAgo": round((time.time() - a["since"]) / 60, 1)} for a in snap["alarms"] if a["active"]]
    return {"controllers": ctrls, "alarms": alarms, "buffers": snap["buffers"]}


def history(controller: str, param: str, minutes: float = 60) -> dict:
    s = scada_rt.rt.scada
    if s is None:
        return {"error": "SCADA не запущена"}
    c = s.registry.controllers.get(controller)
    p = c.param(param) if c else None
    if p is None:
        return {"error": f"Нет параметра {controller}/{param}"}
    k = f"{controller}/Status.Parameter.{param}"
    since = time.time() - min(minutes, 24 * 60) * 60
    series = s.db.history([k], since, points=40)[k]
    return {"equipment": c.equipment, "param": p.name, "unit": p.unit,
            "points": [[round((t - time.time()) / 60, 1), v] for t, v in series], "note": "время — минут назад (отрицательное)"}
