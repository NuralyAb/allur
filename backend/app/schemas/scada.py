from pydantic import BaseModel, ConfigDict, Field


class Login(BaseModel):
    login: str = Field(max_length=64)
    password: str = Field(max_length=128)


class CommandBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    controller: str = Field(max_length=64)
    kind: str = Field(pattern="^(packml|mode|setpoint|speed)$")
    name: str = Field(max_length=64)
    value: float | None = None
    reason: str = Field("", max_length=300)


class ConfirmBody(BaseModel):
    reason: str = Field("", max_length=300)


class AckBody(BaseModel):
    id: str | None = Field(None, max_length=128)
    controller: str | None = Field(None, max_length=64)


class ShelveBody(BaseModel):
    id: str = Field(max_length=128)
    minutes: float = Field(ge=0, le=480)
    reason: str = Field("", max_length=300)


class FieldBody(BaseModel):
    action: str = Field(pattern="^(fault|estop|release|local|remote)$")
    code: int | None = None


class LineCommandBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern="^(START|STOP|HOLD)$")
    reason: str = Field("", max_length=300)
