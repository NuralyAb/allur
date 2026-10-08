from fastapi import APIRouter, HTTPException

from ..schemas.forecast import ForecastRequest, PlanRequest
from ..services import forecast

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


@router.get("/model")
def forecast_model() -> dict:
    """Калибровка модели по данным завода: участки, оборудование, допущения, стоимость мероприятий."""
    cal = forecast.calibrate()
    return {**forecast.describe(cal), "actions": forecast.actions(cal)}


@router.post("")
def forecast_month(request: ForecastRequest) -> dict:
    """Распределение выпуска месяца при сценарии: P10/P50/P90, вероятность плана и цели, узкие места."""
    try:
        scenario = request.scenario()
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return forecast.forecast(scenario, request.runs, request.seed)


@router.get("/sensitivity")
def forecast_sensitivity() -> dict:
    """Эффект каждого мероприятия на выпуск месяца с разбросом — что сильнее влияет."""
    return forecast.sensitivity()


@router.post("/plan")
def forecast_plan(request: PlanRequest) -> dict:
    """Самые дешёвые наборы мероприятий, при которых цель выполняется с заданной вероятностью."""
    unknown = set(request.costs) - set(forecast.COSTS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Неизвестные статьи затрат: {', '.join(sorted(unknown))}")
    return forecast.plan_to_target(request.target, request.confidence, request.costs, request.margin, request.runs)
