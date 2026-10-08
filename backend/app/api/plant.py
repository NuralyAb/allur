from fastapi import APIRouter

from ..services import plant

router = APIRouter(prefix="/api", tags=["plant"])


@router.get("/site")
def get_site() -> dict:
    """Геометрия территории и зданий (локальные метры, x — восток, y — север)."""
    return plant.site()


@router.get("/plant")
def get_plant() -> dict:
    """Паспорт завода: факты, система координат корпуса, производственные зоны."""
    return plant.plant()
