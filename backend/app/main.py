"""Точка входа API: `uvicorn app.main:app`.

Слои: api — контроллеры (роутеры FastAPI), schemas — модели запросов, services — бизнес-логика,
repositories — хранилище, scada — подсистема управления контроллерами, ai — модели прогнозов и ассистент,
config — пути и окружение.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai import engine as ai
from .api import include_routers
from .scada import runtime as scada
from .services import data_source, simulator


@asynccontextmanager
async def lifespan(_: FastAPI):
    data_source.seed_if_empty()
    await scada.start()
    await ai.default().start()  # модели обучаются в фоне, двойник доступен сразу
    yield
    await ai.default().stop()
    simulator.default().stop()
    await scada.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Allur Digital Twin API", version="0.3.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    include_routers(app)
    return app


app = create_app()
