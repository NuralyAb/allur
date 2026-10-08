"""HTTP/WebSocket API SCADA и запуск среды.

SCADA_MODE:
  opcua-sim (по умолчанию) — в процессе поднимается OPC UA-сервер симулятора ПЛК, SCADA подключается к нему
                             по сети тем же клиентом, что и к заводу (адрес — PLCSIM_ENDPOINT);
  sim        — симулятор в памяти без сети (тесты; запасной вариант, если порт OPC UA занят);
  plant      — только подключения из controllers.json, симулятора нет;
  off        — SCADA выключена.
Читать состояние может любой клиент в сети; команды, квитирование и уставки — только после входа.
"""
import asyncio
import logging
import os
import time

from fastapi import APIRouter, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field

from . import auth, registry
from .core import DEFAULT_DB, CommandError, Db, Scada
from .packml import COMMAND_RU, MODE_RU, OPERATOR_COMMANDS, SAFE_COMMANDS, STATE_RU, Mode
from .plcsim import PlcSim, serve_opcua

log = logging.getLogger("scada")
router = APIRouter(prefix="/api/scada", tags=["scada"])


class Runtime:
    scada: Scada | None = None
    users: auth.Auth | None = None
    sim: PlcSim | None = None
    server: asyncio.Task | None = None
    note: str = ""


rt = Runtime()


async def start(mode: str | None = None, db_path=None):
    mode = mode or os.environ.get("SCADA_MODE", "opcua-sim")
    if mode == "off":
        rt.note = "SCADA выключена (SCADA_MODE=off)"
        return
    reg = registry.load()
    rt.users = auth.Auth()
    sim = None
    if mode in ("opcua-sim", "sim"):
        sim = PlcSim(reg)
    if mode == "opcua-sim":
        endpoint = os.environ.get("PLCSIM_ENDPOINT", next(iter(reg.connections.values())).endpoint)
        namespace = next(iter(reg.connections.values())).namespace or "urn:allur:plcsim"
        ready = asyncio.Event()
        rt.server = asyncio.get_running_loop().create_task(serve_opcua(sim, endpoint, namespace, ready))
        waiter = asyncio.create_task(ready.wait())
        await asyncio.wait({rt.server, waiter}, timeout=10, return_when=asyncio.FIRST_COMPLETED)
        waiter.cancel()
        if not ready.is_set():
            err = rt.server.exception() if rt.server.done() and not rt.server.cancelled() else "таймаут"
            rt.server.cancel()
            rt.server = None
            log.warning("OPC UA-сервер симулятора не запущен (%s) — симулятор в памяти", err)
            rt.note = f"OPC UA-порт недоступен ({err}); симулятор подключён без сети"
            mode = "sim"
        else:
            for conn in reg.connections.values():  # все контроллеры симулятора живут на одном сервере
                conn.endpoint, conn.namespace = endpoint, namespace
            rt.note = f"Симулятор ПЛК опубликован как OPC UA-сервер {endpoint}"
    elif mode == "plant":
        rt.note = "Подключение к контроллерам завода"
    rt.sim = sim
    rt.scada = Scada(reg, Db(db_path or DEFAULT_DB), mode=mode, sim=sim)
    await rt.scada.start()


async def stop():
    if rt.scada:
        await rt.scada.stop()
        rt.scada.db.close()
    if rt.server:
        rt.server.cancel()
        try:
            await rt.server
        except (asyncio.CancelledError, Exception):
            pass
    rt.scada = rt.server = rt.sim = None


def scada() -> Scada:
    if rt.scada is None:
        raise HTTPException(503, rt.note or "SCADA не запущена")
    return rt.scada


def token_of(authorization: str | None) -> str | None:
    return authorization[7:] if authorization and authorization.startswith("Bearer ") else None


def user_of(authorization: str | None, need: str = "operator") -> auth.User:
    if rt.users is None:
        raise HTTPException(503, "SCADA не запущена")
    user = rt.users.user(token_of(authorization))
    if user is auth.GUEST:
        raise HTTPException(401, "Войдите, чтобы управлять оборудованием")
    if not auth.allows(user.role, need):
        raise HTTPException(403, f"Нужна роль «{auth.ROLE_RU[need]}»")
    return user


def fail(e: Exception):
    if isinstance(e, CommandError):
        raise HTTPException(e.status, e.reason)
    if isinstance(e, auth.Forbidden):
        raise HTTPException(403, str(e))
    raise e


@router.get("/config")
def get_config() -> dict:
    """Статическое описание: контроллеры, параметры, коды неисправностей, команды и роли."""
    s = scada()
    return {
        **s.registry.public(), "mode": s.mode, "note": rt.note,
        "states": {int(k): v for k, v in STATE_RU.items()}, "modes": {m.name: {"value": int(m), "label": MODE_RU[m]} for m in Mode},
        "commands": [{"name": c.name, "label": COMMAND_RU[c], "confirm": c not in SAFE_COMMANDS, "role": "operator"} for c in OPERATOR_COMMANDS],
        "roles": auth.ROLE_RU, "simulator": rt.sim is not None,
    }


@router.get("/state")
def get_state() -> dict:
    return scada().snapshot()


@router.get("/alarms")
def get_alarms() -> list[dict]:
    """Короткая сводка активных тревог по участкам — для цифрового двойника."""
    s = scada()
    return [{"id": a.id, "controller": a.controller, "equipment": s.registry.controllers[a.controller].equipment,
             "area": s.registry.controllers[a.controller].area, "zone": s.registry.controllers[a.controller].zone,
             "priority": a.priority, "title": a.title, "acked": a.acked}
            for a in sorted(s.alarms.values(), key=lambda a: (a.priority, a.since)) if a.active and not a.shelvedUntil]


class Login(BaseModel):
    login: str = Field(max_length=64)
    password: str = Field(max_length=128)


@router.post("/login")
def post_login(body: Login) -> dict:
    scada()
    try:
        token, user = rt.users.login(body.login.strip(), body.password)
    except auth.Forbidden as e:
        rt.scada.db.audit("auth", body.login[:64], "", "", "Вход отклонён", {}, "rejected")
        raise HTTPException(401, str(e))
    rt.scada.db.audit("auth", user.login, user.role, "", "Вход", {}, "ok")
    return {"token": token, "user": {**user.__dict__, "roleName": auth.ROLE_RU[user.role]}}


@router.post("/logout")
def post_logout(authorization: str | None = Header(None)) -> dict:
    if rt.users:
        user = rt.users.user(token_of(authorization))
        if user is not auth.GUEST:
            rt.scada.db.audit("auth", user.login, user.role, "", "Выход", {}, "ok")
        rt.users.logout(token_of(authorization) or "")
    return {"ok": True}


@router.get("/me")
def get_me(authorization: str | None = Header(None)) -> dict:
    scada()
    user = rt.users.user(token_of(authorization))
    return {**user.__dict__, "roleName": auth.ROLE_RU[user.role], "guest": user is auth.GUEST}


class CommandBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    controller: str = Field(max_length=64)
    kind: str = Field(pattern="^(packml|mode|setpoint|speed)$")
    name: str = Field(max_length=64)
    value: float | None = None
    reason: str = Field("", max_length=300)


@router.post("/commands")
async def post_command(body: CommandBody, authorization: str | None = Header(None)) -> dict:
    """Подать команду. Команды в безопасную сторону выполняются сразу, остальные ждут подтверждения."""
    user = user_of(authorization, "operator")
    try:
        cmd = await scada().request(user, body.controller, body.kind, body.name, body.value, body.reason)
    except Exception as e:
        fail(e)
    return Scada._public_cmd(cmd)


class ConfirmBody(BaseModel):
    reason: str = Field("", max_length=300)


@router.post("/commands/{command_id}/confirm")
async def post_confirm(command_id: str, body: ConfirmBody | None = None, authorization: str | None = Header(None)) -> dict:
    """Второй шаг: ПЛК получает команду, только если состояние не изменилось с момента выбора."""
    user = user_of(authorization, "operator")
    try:
        return Scada._public_cmd(await scada().confirm(user, command_id, body.reason if body else ""))
    except Exception as e:
        fail(e)


@router.post("/commands/{command_id}/cancel")
def post_cancel(command_id: str, authorization: str | None = Header(None)) -> dict:
    user = user_of(authorization, "operator")
    try:
        return Scada._public_cmd(scada().cancel(user, command_id))
    except Exception as e:
        fail(e)


class AckBody(BaseModel):
    id: str | None = Field(None, max_length=128)
    controller: str | None = Field(None, max_length=64)


@router.post("/alarms/ack")
def post_ack(body: AckBody, authorization: str | None = Header(None)) -> dict:
    user = user_of(authorization, "operator")
    try:
        return {"acked": scada().ack(user, body.id, body.controller)}
    except Exception as e:
        fail(e)


class ShelveBody(BaseModel):
    id: str = Field(max_length=128)
    minutes: float = Field(ge=0, le=480)
    reason: str = Field("", max_length=300)


@router.post("/alarms/shelve")
def post_shelve(body: ShelveBody, authorization: str | None = Header(None)) -> dict:
    user = user_of(authorization, "engineer")
    try:
        scada().shelve(user, body.id, body.minutes, body.reason)
    except Exception as e:
        fail(e)
    return {"ok": True}


@router.get("/history")
def get_history(keys: str = Query(..., max_length=2000), minutes: float = Query(30, gt=0, le=7 * 24 * 60)) -> dict:
    """Тренды: ключи через запятую, например conveyor-03/Status.Parameter.ChainTension."""
    return {"since": time.time() - minutes * 60,
            "series": scada().db.history([k for k in keys.split(",") if k][:12], time.time() - minutes * 60)}


@router.get("/audit")
def get_audit(limit: int = Query(200, ge=1, le=1000), controller: str | None = None) -> list[dict]:
    return scada().db.audit_rows(limit, controller)


@router.get("/audit/verify")
def get_audit_verify() -> dict:
    """Проверка целостности журнала: цепочка хешей не должна прерываться."""
    return scada().db.verify()


@router.get("/events")
def get_events(limit: int = Query(100, ge=1, le=1000)) -> list[dict]:
    """Простои по данным ПЛК: уход из «Работы» с причиной и длительностью."""
    return scada().db.events(limit)


class FieldBody(BaseModel):
    action: str = Field(pattern="^(fault|estop|release|local|remote)$")
    code: int | None = None


@router.post("/sim/{cid}")
def post_field(cid: str, body: FieldBody, authorization: str | None = Header(None)) -> dict:
    """Только симулятор: события на линии — отказ, аварийная кнопка, ключ «Местный/Дистанционный»."""
    s = scada()
    if rt.sim is None:
        raise HTTPException(404, "Есть только при работе с симулятором")
    c = s.registry.controllers.get(cid)
    if c is None:
        raise HTTPException(404, "Контроллер не найден")
    if body.action == "fault":
        code = body.code or next(iter(c.faults), 0)
        if code not in c.faults:
            raise HTTPException(422, "Неизвестный код неисправности")
        rt.sim.inject_fault(cid, code)
    elif body.action in ("estop", "release"):
        rt.sim.set_safety(cid, body.action == "release")
    else:
        rt.sim.set_remote(cid, body.action == "remote")
    user = rt.users.user(token_of(authorization))
    labels = {"fault": f"Симуляция отказа: {s.registry.fault_text(c, body.code or next(iter(c.faults), 0))}",
              "estop": "Симуляция: нажата аварийная кнопка", "release": "Симуляция: аварийная кнопка отжата",
              "local": "Симуляция: ключ «Местный»", "remote": "Симуляция: ключ «Дистанционный»"}
    s.db.audit("field", user.login, user.role, cid, labels[body.action], {"code": body.code}, "ok")
    return {"ok": True}


@router.websocket("/stream")
async def stream(ws: WebSocket):
    """Снимок состояния два раза в секунду."""
    await ws.accept()
    try:
        while True:
            if rt.scada is None:
                await ws.close(code=1013, reason="SCADA не запущена")
                return
            await ws.send_json(rt.scada.snapshot())
            await asyncio.sleep(0.5)
    except (WebSocketDisconnect, RuntimeError):
        return

