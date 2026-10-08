"""API ИИ-подсистемы: прогноз отказов, аномалии, причины брака, прогноз месяца, ассистент."""
from fastapi import APIRouter, HTTPException

from ..ai import assistant, service
from ..scada import runtime as scada_rt
from ..schemas.ai import ChatBody, DemoBody

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def get_status() -> dict:
    """Готовность моделей, их метрики на отложенной выборке и режим ассистента (OpenAI или офлайн)."""
    return service.status()


@router.get("/maintenance")
def get_maintenance() -> dict:
    """Прогноз отказов по трендам параметров и аномалии; сценарии износа для демонстрации на симуляторе."""
    return service.maintenance()


@router.get("/quality")
def get_quality() -> dict:
    return service.quality()


@router.get("/forecast")
def get_forecast() -> dict:
    return service.month()


@router.get("/scene")
def get_scene() -> list[dict]:
    """Короткая сводка для 3D-модели: прогнозы отказов и аномалии, требующие внимания."""
    return service.scene()


@router.post("/chat")
def post_chat(body: ChatBody) -> dict:
    if body.messages[-1].role != "user":
        raise HTTPException(422, "Последним должно быть сообщение пользователя")
    return assistant.chat([m.model_dump() for m in body.messages])


@router.post("/report")
def post_report() -> dict:
    """Сменный отчёт для начальника производства по живым данным двойника."""
    return assistant.report()


@router.post("/demo")
def post_demo(body: DemoBody) -> dict:
    """Только симулятор: запустить развивающуюся неисправность из списка сценариев или отремонтировать узел."""
    sim, s = scada_rt.rt.sim, scada_rt.rt.scada
    if sim is None or s is None:
        raise HTTPException(404, "Есть только при работе с симулятором")
    demo = next((d for d in service.DEMOS if d["id"] == body.id), None)
    if demo is None:
        raise HTTPException(404, "Сценарий не найден")
    if body.action == "start":
        sim.degrade(demo["controller"], demo["param"], demo["rate"])
        text = f"Симуляция износа: {demo['title']}"
    else:
        sim.repair(demo["controller"])
        text = f"Симуляция: узел отремонтирован ({demo['title']})"
    s.db.audit("field", "система", "", demo["controller"], text, {"demo": demo["id"]}, "ok")
    return {"ok": True, "active": service.maintenance()["active"]}
