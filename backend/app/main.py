import asyncio
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from . import kpi, plant, simulation

app = FastAPI(title="Allur Digital Twin API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/site")
def get_site() -> dict:
    """Геометрия территории и зданий (локальные метры, x — восток, y — север)."""
    return plant.site()


@app.get("/api/plant")
def get_plant() -> dict:
    """Паспорт завода: факты, система координат корпуса, производственные зоны."""
    return plant.plant()


@app.get("/api/kpi")
def get_kpi() -> dict:
    """Показатели линий за последние сутки и по дням, OEE, план месяца."""
    return kpi.summary()


class SimulationControl(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['resume', 'pause', 'advance', 'fault', 'reset', 'speed']
    minutes: float = Field(default=15, gt=0, le=480)
    speed: Literal[60, 120, 300] = 120


def require_session(session_id):
    session = simulation.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='Сессия не найдена. Создайте новую смену.')
    return session


@app.post('/api/simulation/sessions')
def start_simulation(config: simulation.SimulationConfig) -> dict:
    return simulation.create_session(config)


@app.get('/api/simulation/sessions/{session_id}')
def simulation_state(session_id: str) -> dict:
    return require_session(session_id).snapshot()


@app.post('/api/simulation/sessions/{session_id}/control')
def simulation_control(session_id: str, command: SimulationControl) -> dict:
    return require_session(session_id).control(command.action, command.minutes, command.speed)


@app.post('/api/simulation/compare')
def compare_simulations(request: simulation.CompareRequest) -> dict:
    return simulation.compare(request)


@app.websocket('/api/simulation/sessions/{session_id}/stream')
async def simulation_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        while True:
            session = simulation.get_session(session_id)
            if session is None:
                await websocket.close(code=1008, reason='Сессия истекла')
                return
            await websocket.send_json(session.snapshot())
            await asyncio.sleep(0.5)
    except (WebSocketDisconnect, RuntimeError):
        return
