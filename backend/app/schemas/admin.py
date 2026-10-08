from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Login(BaseModel):
    login: str = Field(max_length=64)
    password: str = Field(max_length=128)


class SettingsPatch(BaseModel):
    """Частичное обновление секций настроек; проверка значений — в services.settings."""

    model_config = ConfigDict(extra="forbid")
    targets: dict[str, Any] | None = None
    calc: dict[str, Any] | None = None
    scene: dict[str, Any] | None = None


class PlantPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    address: str | None = None
    facts: list[dict[str, Any]] | None = None
    zones: dict[str, dict[str, Any]] | None = None
    outdoor: dict[str, dict[str, Any]] | None = None


class UserCreate(BaseModel):
    login: str = Field(max_length=64)
    name: str = Field(max_length=80)
    role: str = Field(max_length=16)
    password: str = Field(max_length=128)


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: str | None = Field(None, max_length=16)
    blocked: bool | None = None
    name: str | None = Field(None, max_length=80)


class PasswordReset(BaseModel):
    password: str = Field(max_length=128)
