from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from ..config import MAX_UPLOAD
from ..services import data_source

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/source")
def get_source() -> dict:
    """Откуда сейчас данные, сколько строк и за какой период."""
    return data_source.summary()


@router.post("/import")
async def post_import(file: UploadFile = File(...), mode: str = Form("merge")) -> dict:
    """Загрузить DOCX/XLSX в формате таблиц кейса. merge — даты из файла заменяют такие же даты."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, {"errors": ["Файл больше 10 МБ"]})
    try:
        counts = data_source.import_file(file.filename or "", data, mode)
    except data_source.ImportRejected as e:
        raise HTTPException(422, {"errors": e.errors})
    return {"imported": counts, **data_source.summary()}


@router.post("/reset")
def post_reset() -> dict:
    """Вернуть тестовые данные кейса."""
    data_source.reset()
    return data_source.summary()


@router.get("/template")
def get_template() -> Response:
    """XLSX-шаблон в формате кейса, заполненный текущими данными — его же можно загрузить обратно."""
    return Response(
        data_source.template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=allur_twin_data.xlsx"},
    )
