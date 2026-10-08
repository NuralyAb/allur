"""Админка: вход, сводная статистика, настройки, правки паспорта завода, пользователи, аудит.

Чтение сводки и настроек открыто (их показывает и двойник); всё, что меняет состояние, — только администратору.
"""
from fastapi import APIRouter, Depends, Header, HTTPException

from ..repositories import store
from ..scada import auth
from ..schemas.admin import Login, PasswordReset, PlantPatch, SettingsPatch, UserCreate, UserPatch
from ..services import accounts, data_source, insights, kpi, plant, settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _audit(user: auth.User, action: str, details: dict | None = None) -> None:
    store.default().audit(user.login, user.role, action, details or {})


def _settings_payload() -> dict:
    return {**settings.current(), "defaults": settings.DEFAULTS}


# --- вход ---------------------------------------------------------------------------------------

@router.post("/login")
def post_login(body: Login) -> dict:
    try:
        token, user = accounts.service().login(body.login.strip().lower(), body.password)
    except auth.Forbidden as e:
        store.default().audit(body.login[:64], "", "login.rejected", {"reason": str(e)})
        raise HTTPException(401, str(e))
    if not auth.allows(user.role, "admin"):
        accounts.service().logout(token)
        raise HTTPException(403, "Вход в админку только для администраторов")
    _audit(user, "login")
    return {"token": token, "user": {**user.__dict__, "roleName": auth.ROLE_RU[user.role]}}


@router.post("/logout")
def post_logout(authorization: str | None = Header(None)) -> dict:
    user = accounts.user_of(authorization)
    if user is not auth.GUEST:
        _audit(user, "logout")
    accounts.service().logout(accounts.token_of(authorization) or "")
    return {"ok": True}


@router.get("/me")
def get_me(authorization: str | None = Header(None)) -> dict:
    user = accounts.user_of(authorization)
    return {**user.__dict__, "roleName": auth.ROLE_RU[user.role], "guest": user is auth.GUEST, "admin": auth.allows(user.role, "admin")}


# --- сводка -------------------------------------------------------------------------------------

def _scada_summary() -> dict | None:
    try:
        from ..scada import runtime
    except Exception:
        return None
    s = runtime.rt.scada
    if s is None:
        return {"running": False, "note": runtime.rt.note}
    snapshot = s.snapshot()
    controllers = snapshot.get("controllers", {})
    states: dict[str, int] = {}
    for c in controllers.values() if isinstance(controllers, dict) else controllers:
        label = c.get("stateName") or str(c.get("state"))
        states[label] = states.get(label, 0) + 1
    alarms = [a for a in s.alarms.values() if a.active and not a.shelvedUntil]
    return {
        "running": True, "mode": s.mode, "note": runtime.rt.note, "controllers": len(s.registry.controllers), "states": states,
        "alarms": {"active": len(alarms), "unacked": sum(1 for a in alarms if not a.acked),
                   "byPriority": {p: sum(1 for a in alarms if a.priority == p) for p in (1, 2, 3)}},
    }


@router.get("/overview")
def get_overview() -> dict:
    """Всё для первого экрана админки: источник, KPI по дням, решения, простои по причинам, SCADA, пользователи."""
    ds = store.default().dataset()
    summary = kpi.summary(ds)
    reasons: dict[str, int] = {}
    equipment: dict[str, int] = {}
    for d in ds["downtime"]:
        reasons[d["reason"]] = reasons.get(d["reason"], 0) + d["minutes"]
        equipment[d["equipment"]] = equipment.get(d["equipment"], 0) + d["minutes"]
    return {
        "source": data_source.summary(),
        "kpi": summary,
        "insights": insights.summary(ds),
        "downtime": {
            "byReason": sorted(({"reason": k, "minutes": v} for k, v in reasons.items()), key=lambda r: -r["minutes"]),
            "byEquipment": sorted(({"equipment": k, "minutes": v} for k, v in equipment.items()), key=lambda r: -r["minutes"]),
            "total": sum(reasons.values()),
        },
        "scada": _scada_summary(),
        "users": len(accounts.list_users()),
        "settings": settings.current(),
        "plantCustomized": bool(settings.plant_overrides()),
    }


# --- настройки ----------------------------------------------------------------------------------

@router.get("/settings")
def get_settings() -> dict:
    return _settings_payload()


@router.put("/settings")
def put_settings(body: SettingsPatch, user: auth.User = Depends(accounts.admin_user)) -> dict:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        settings.update(patch)
    except settings.Invalid as e:
        raise HTTPException(422, str(e))
    _audit(user, "settings.update", patch)
    return _settings_payload()


@router.delete("/settings")
def delete_settings(section: str | None = None, user: auth.User = Depends(accounts.admin_user)) -> dict:
    try:
        settings.reset(section)
    except settings.Invalid as e:
        raise HTTPException(422, str(e))
    _audit(user, "settings.reset", {"section": section})
    return _settings_payload()


# --- паспорт завода -----------------------------------------------------------------------------

@router.get("/plant")
def get_plant() -> dict:
    """Паспорт как видит двойник плюс сохранённые правки и исходные значения для сравнения."""
    return {"plant": plant.plant(), "overrides": settings.plant_overrides(), "original": plant.original(), "kpiAreas": [a for a in settings.KPI_AREAS if a]}


@router.put("/plant")
def put_plant(body: PlantPatch, user: auth.User = Depends(accounts.admin_user)) -> dict:
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        overrides = settings.update_plant(patch, plant.hall_frame(), {z["id"] for z in plant.ZONES}, {z["id"] for z in plant.OUTDOOR})
    except settings.Invalid as e:
        raise HTTPException(422, str(e))
    _audit(user, "plant.update", patch)
    return {"plant": plant.plant(), "overrides": overrides}


@router.delete("/plant")
def delete_plant(user: auth.User = Depends(accounts.admin_user)) -> dict:
    settings.reset_plant()
    _audit(user, "plant.reset")
    return {"plant": plant.plant(), "overrides": {}}


# --- пользователи -------------------------------------------------------------------------------

@router.get("/users")
def get_users(_: auth.User = Depends(accounts.admin_user)) -> dict:
    return {"users": accounts.list_users(), "roles": [{"role": r, "label": auth.ROLE_RU[r]} for r in auth.ROLES]}


@router.post("/users")
def post_user(body: UserCreate, user: auth.User = Depends(accounts.admin_user)) -> dict:
    try:
        created = accounts.create_user(body.login, body.name, body.role, body.password)
    except accounts.AccountError as e:
        raise HTTPException(422, str(e))
    _audit(user, "user.create", {"login": created["login"], "role": created["role"]})
    return created


@router.patch("/users/{login}")
def patch_user(login: str, body: UserPatch, user: auth.User = Depends(accounts.admin_user)) -> dict:
    try:
        updated = accounts.update_user(login, user.login, body.role, body.blocked, body.name)
    except accounts.AccountError as e:
        raise HTTPException(422, str(e))
    _audit(user, "user.update", {"login": login, **body.model_dump(exclude_none=True)})
    return updated


@router.post("/users/{login}/password")
def post_password(login: str, body: PasswordReset, user: auth.User = Depends(accounts.admin_user)) -> dict:
    try:
        updated = accounts.reset_password(login, body.password)
    except accounts.AccountError as e:
        raise HTTPException(422, str(e))
    _audit(user, "user.password", {"login": login})
    return updated


@router.delete("/users/{login}")
def delete_user(login: str, user: auth.User = Depends(accounts.admin_user)) -> dict:
    try:
        accounts.delete_user(login, user.login)
    except accounts.AccountError as e:
        raise HTTPException(422, str(e))
    _audit(user, "user.delete", {"login": login})
    return {"ok": True}


# --- аудит --------------------------------------------------------------------------------------

@router.get("/audit")
def get_audit(limit: int = 200, _: auth.User = Depends(accounts.admin_user)) -> list[dict]:
    return store.default().audit_rows(max(1, min(limit, 1000)))
