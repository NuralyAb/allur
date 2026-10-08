"""Контроллеры HTTP API: по роутеру на область, бизнес-логика — в services."""
from fastapi import FastAPI

from . import admin, data, forecast, health, kpi, live, plant, scada, simulation

ROUTERS = (health.router, plant.router, kpi.router, forecast.router, data.router, live.router, simulation.router, scada.router, admin.router)


def include_routers(app: FastAPI) -> None:
    for router in ROUTERS:
        app.include_router(router)
