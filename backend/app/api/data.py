from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from ..config import MAX_UPLOAD
from ..repositories import store
from ..scada.auth import User
from ..services import accounts, data_source

router = APIRouter(prefix="/api/data", tags=["data"])


@router.get("/source")
def get_source() -> dict:
    """Откуда сейчас данные, сколько строк и за какой период."""
    return data_source.summary()


@router.post("/import")
async def post_import(file: UploadFile = File(...), mode: str = Form("merge"), user: User = Depends(accounts.admin_user)) -> dict:
    """Загрузить DOCX/XLSX в формате таблиц кейса. merge — даты из файла заменяют такие же даты. Только администратор."""
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, {"errors": ["Файл больше 10 МБ"]})
    try:
        counts = data_source.import_file(file.filename or "", data, mode)
    except data_source.ImportRejected as e:
        store.default().audit(user.login, user.role, "data.import.rejected", {"file": file.filename, "errors": e.errors[:5]})
        raise HTTPException(422, {"errors": e.errors})
    store.default().audit(user.login, user.role, "data.import", {"file": file.filename, "mode": mode, "rows": counts})
    return {"imported": counts, **data_source.summary()}


@router.post("/reset")
def post_reset(user: User = Depends(accounts.admin_user)) -> dict:
    """Вернуть тестовые данные кейса. Только администратор."""
    data_source.reset()
    store.default().audit(user.login, user.role, "data.reset")
    return data_source.summary()


@router.get("/template")
def get_template() -> Response:
    """XLSX-шаблон в формате кейса, заполненный текущими данными — его же можно загрузить обратно."""
    return Response(
        data_source.template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=allur_twin_data.xlsx"},
    )
