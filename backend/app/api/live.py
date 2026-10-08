import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..services import data_source

router = APIRouter(prefix="/api", tags=["live"])


@router.post("/live/{action}")
async def post_live(action: str) -> dict:
    """Запустить или остановить симулятор линии."""
    if action not in ("start", "stop"):
        raise HTTPException(404)
    data_source.set_live(action == "start")
    return data_source.summary()


@router.get("/stream")
async def stream() -> StreamingResponse:
    """Server-Sent Events: ход смены раз в секунду; version меняется, когда в хранилище записаны новые данные."""

    async def events():
        while True:
            yield f"data: {json.dumps(data_source.live_progress(), ensure_ascii=False)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
