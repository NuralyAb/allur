"""Среда выполнения SCADA: запуск симулятора ПЛК и OPC UA-сервера, подключения, сессии пользователей.

HTTP-эндпоинты — в api/scada.py.

SCADA_MODE:
  opcua-sim (по умолчанию) — в процессе поднимается OPC UA-сервер симулятора ПЛК, SCADA подключается к нему
                             по сети тем же клиентом, что и к заводу (адрес — PLCSIM_ENDPOINT);
  sim        — симулятор в памяти без сети (тесты; запасной вариант, если порт OPC UA занят);
  plant      — только подключения из controllers.json, симулятора нет;
  off        — SCADA выключена.
"""
import asyncio
import logging
import os

from fastapi import HTTPException

from . import auth, registry
from .core import DEFAULT_DB, CommandError, Db, Scada
from .plcsim import PlcSim, serve_opcua

log = logging.getLogger("scada")


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

