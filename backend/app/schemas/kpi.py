from pydantic import BaseModel, Field

from ..services import insights


class Scenario(BaseModel):
    """Сценарий «что если»: выбранные мероприятия и календарь смен."""

    levers: list[str] = []
    shifts: int = Field(2, ge=1, le=3)
    days: int = Field(insights.WORK_DAYS, ge=1, le=31)
    extraShifts: int = Field(0, ge=0, le=20)
