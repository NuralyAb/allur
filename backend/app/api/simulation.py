import asyncio

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..schemas.simulation import CompareRequest, SimulationConfig, SimulationControl
from ..services import simulation

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


def require_session(session_id: str):
    session = simulation.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Сессия не найдена. Создайте новую смену.")
    return session


@router.post("/sessions")
def start_simulation(config: SimulationConfig) -> dict:
    return simulation.create_session(config)


@router.get("/sessions/{session_id}")
def simulation_state(session_id: str) -> dict:
    return require_session(session_id).snapshot()


@router.post("/sessions/{session_id}/control")
def simulation_control(session_id: str, command: SimulationControl) -> dict:
    return require_session(session_id).control(command.action, command.minutes, command.speed)


@router.post("/compare")
def compare_simulations(request: CompareRequest) -> dict:
    return simulation.compare(request)


@router.websocket("/sessions/{session_id}/stream")
async def simulation_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        while True:
            session = simulation.get_session(session_id)
            if session is None:
                await websocket.close(code=1008, reason="Сессия истекла")
                return
            await websocket.send_json(session.snapshot())
            await asyncio.sleep(0.5)
    except (WebSocketDisconnect, RuntimeError):
        return
