from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import kpi, plant

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
