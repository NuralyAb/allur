from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# параметры смены и сравнения сценариев описаны рядом с движком: они задают его поведение
from ..services.simulation import CompareRequest, SimulationConfig

__all__ = ["CompareRequest", "SimulationConfig", "SimulationControl"]


class SimulationControl(BaseModel):
    """Команда сценарной смене: пуск, пауза, шаг вперёд, отказ, сброс, скорость."""

    model_config = ConfigDict(extra="forbid")
    action: Literal["resume", "pause", "advance", "fault", "reset", "speed"]
    minutes: float = Field(default=15, gt=0, le=480)
    speed: Literal[60, 120, 300] = 120
