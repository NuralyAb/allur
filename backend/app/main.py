import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from . import importers, insights, kpi, plant, simulator, store

CASE_SOURCE = f"Файл кейса · {importers.CASE_FILE.name}"
MAX_UPLOAD = 10 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    # первый запуск: хранилище заполняется таблицами из DOCX кейса
    if store.default().empty():
        store.default().write(importers.case_dataset(), CASE_SOURCE, mode="replace")
    yield
    simulator.default().stop()


app = FastAPI(title="Allur Digital Twin API", version="0.2.0", lifespan=lifespan)
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


class Scenario(BaseModel):
    levers: list[str] = []
    shifts: int = Field(2, ge=1, le=3)
    days: int = Field(insights.WORK_DAYS, ge=1, le=31)
    extraShifts: int = Field(0, ge=0, le=20)


@app.get("/api/insights")
def get_insights() -> dict:
    """Узкое место, отклонения, риски оборудования и мероприятия с эффектом в автомобилях."""
    return insights.summary()


@app.post("/api/scenario")
def post_scenario(s: Scenario) -> dict:
    """Прогноз месяца при выбранных мероприятиях и календаре смен."""
    return insights.simulate(s.levers, s.shifts, s.days, s.extraShifts)


def _source() -> dict:
    ds = store.default().dataset()
    dates = sorted({r["date"] for r in ds["lines"]})
    return {
        "source": ds["source"],
        "updatedAt": ds["updatedAt"],
        "version": store.default().version,
        "counts": {name: len(ds[name]) for name in store.TABLES},
        "dates": [dates[0], dates[-1]] if dates else None,
        "live": simulator.default().running,
    }


@app.get("/api/data/source")
def get_source() -> dict:
    """Откуда сейчас данные, сколько строк и за какой период."""
    return _source()


@app.post("/api/data/import")
async def post_import(file: UploadFile = File(...), mode: str = Form("merge")) -> dict:
    """Загрузить DOCX/XLSX в формате таблиц кейса. merge — даты из файла заменяют такие же даты."""
    if mode not in ("merge", "replace"):
        raise HTTPException(422, {"errors": ["mode: merge или replace"]})
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, {"errors": ["Файл больше 10 МБ"]})
    batch, errors = importers.read(file.filename or "", data)
    if errors:
        raise HTTPException(422, {"errors": errors})
    simulator.default().stop()
    counts = store.default().write(batch, f"Импорт · {file.filename}", mode=mode)
    return {"imported": counts, **_source()}


@app.post("/api/data/reset")
def post_reset() -> dict:
    """Вернуть тестовые данные кейса."""
    simulator.default().stop()
    store.default().write(importers.case_dataset(), CASE_SOURCE, mode="replace")
    return _source()


@app.get("/api/data/template")
def get_template() -> Response:
    """XLSX-шаблон в формате кейса, заполненный текущими данными — его же можно загрузить обратно."""
    return Response(
        importers.template(store.default().dataset()),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=allur_twin_data.xlsx"},
    )


@app.post("/api/live/{action}")
async def post_live(action: str) -> dict:
    """Запустить или остановить симулятор линии."""
    sim = simulator.default()
    if action == "start":
        sim.start()
    elif action == "stop":
        sim.stop()
    else:
        raise HTTPException(404)
    return _source()


@app.get("/api/stream")
async def stream() -> StreamingResponse:
    """Server-Sent Events: ход смены раз в секунду; version меняется, когда в хранилище записаны новые данные."""

    async def events():
        while True:
            payload = {**simulator.default().progress(), "version": store.default().version}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
