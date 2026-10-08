from pydantic import BaseModel, ConfigDict, Field

from ..services import forecast


class ForecastRequest(BaseModel):
    """Сценарий студии: что меняет руководитель. Пустой запрос — текущий темп завода."""

    model_config = ConfigDict(extra="forbid")
    defect: dict[str, float] = Field(default_factory=dict, description="участок -> брак, %")
    plannedOutside: bool = False
    predictive: float = Field(0, ge=0, le=0.9)
    repair: dict[str, float] = Field(default_factory=dict, description="оборудование -> длительность ремонта, мин")
    speed: dict[str, float] = Field(default_factory=dict, description="участок -> множитель темпа")
    buffer: int = Field(forecast.BUFFER_DEFAULT, ge=1, le=60)
    shifts: int | None = Field(None, ge=1, le=3)
    days: int | None = Field(None, ge=1, le=31)
    extraShifts: int = Field(0, ge=0, le=forecast.MAX_EXTRA_SHIFTS)
    runs: int = Field(400, ge=50, le=1000)
    seed: int = Field(1, ge=0, le=1_000_000)

    def scenario(self) -> forecast.Scenario:
        for value in self.defect.values():
            if not 0 <= value <= 20:
                raise ValueError("Брак участка — от 0 до 20 %")
        for value in self.repair.values():
            if not 0 <= value <= 240:
                raise ValueError("Длительность ремонта — от 0 до 240 мин")
        for value in self.speed.values():
            if not 0.8 <= value <= 1.3:
                raise ValueError("Темп участка — от 0,8 до 1,3 от текущего")
        return forecast.Scenario(
            defect={a: v / 100 for a, v in self.defect.items()}, plannedOutside=self.plannedOutside,
            predictive=self.predictive, repair=dict(self.repair), speed=dict(self.speed), buffer=self.buffer,
            shifts=self.shifts, days=self.days, extraShifts=self.extraShifts,
        )


class PlanRequest(BaseModel):
    """Подбор плана: цель, требуемая уверенность, стоимость мероприятий и маржа на автомобиль."""

    model_config = ConfigDict(extra="forbid")
    target: int | None = Field(None, ge=1, le=100_000)
    confidence: float = Field(0.8, ge=0.5, le=0.99)
    costs: dict[str, float] = Field(default_factory=dict)
    margin: float = Field(0, ge=0, le=100_000_000)
    runs: int = Field(300, ge=50, le=800)
