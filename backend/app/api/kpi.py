from fastapi import APIRouter

from ..schemas.kpi import Scenario
from ..services import insights, kpi

router = APIRouter(prefix="/api", tags=["kpi"])


@router.get("/kpi")
def get_kpi() -> dict:
    """Показатели линий за последние сутки и по дням, OEE, план месяца."""
    return kpi.summary()


@router.get("/insights")
def get_insights() -> dict:
    """Узкое место, отклонения, риски оборудования и мероприятия с эффектом в автомобилях."""
    return insights.summary()


@router.post("/scenario")
def post_scenario(s: Scenario) -> dict:
    """Прогноз месяца при выбранных мероприятиях и календаре смен."""
    return insights.simulate(s.levers, s.shifts, s.days, s.extraShifts)
