import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..repositories import store
from ..scada.auth import User
from ..services import accounts, data_source

router = APIRouter(prefix="/api", tags=["live"])


@router.post("/live/{action}")
async def post_live(action: str, user: User = Depends(accounts.admin_user)) -> dict:
    """Запустить или остановить симулятор линии. Только администратор."""
    if action not in ("start", "stop"):
        raise HTTPException(404)
    data_source.set_live(action == "start")
    store.default().audit(user.login, user.role, f"live.{action}")
    return data_source.summary()


@router.get("/stream")
async def stream() -> StreamingResponse:
    """Server-Sent Events: ход смены раз в секунду; version меняется, когда в хранилище записаны новые данные."""

    async def events():
        while True:
            yield f"data: {json.dumps(data_source.live_progress(), ensure_ascii=False)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
