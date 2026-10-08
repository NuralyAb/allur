from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["service"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}
