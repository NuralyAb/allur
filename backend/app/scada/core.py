"""Ядро SCADA: текущие значения тегов, тревоги, команды операторов, журнал аудита и историк.

Порядок команды: проверка прав и блокировок → (для команд, запускающих движение) второй шаг подтверждения
не позднее 20 с с повторной проверкой → запись в ПЛК → ожидание подтверждения по обратной связи ПЛК.
Каждый шаг записывается в журнал аудита со сквозным хешем — запись нельзя незаметно изменить или удалить.
Тревоги — по ISA-18.2: активна/квитирована/вернулась в норму, приоритеты, отложение (shelving),
подавление по состоянию (тревоги процесса не возникают у остановленного оборудования).
"""
import asyncio
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from uuid import uuid4

from . import auth
from .drivers import Driver, OpcUaDriver, SimDriver, key
from .packml import (COMMAND_RU, ENERGIZING, MODE_CHANGE_STATES, MODE_RU, OPERATOR_COMMANDS, SAFE_COMMANDS, STATE_RU,
                     TRANSITIONS, Command, Mode, State, allowed, hint)
from .registry import Controller, Registry

DEFAULT_DB = Path(os.environ.get("SCADA_DB", Path(__file__).resolve().parents[2] / "data" / "scada.db"))
ARM_SECONDS = 20  # время на подтверждение второго шага
FEEDBACK_SECONDS = 10  # ПЛК должен подтвердить команду изменением состояния
STALE_SECONDS = 5  # счётчик жизни ПЛК не меняется дольше — связь считается потерянной
log = logging.getLogger("scada")
HISTORY_DAYS = float(os.environ.get("SCADA_HISTORY_DAYS", 7))
PRIORITY_RU = {1: "Высокий", 2: "Средний", 3: "Низкий"}
LIMIT_TEXT = {"hihi": ("Очень высокое значение", 1), "hi": ("Высокое значение", 2), "lo": ("Низкое значение", 2),
              "lolo": ("Очень низкое значение", 1), "dev": ("Отклонение от уставки", 2)}


class CommandError(Exception):
    def __init__(self, reason: str, status: int = 409):
        super().__init__(reason)
        self.reason, self.status = reason, status


@dataclass
class Alarm:
    id: str
    controller: str
    kind: str
    priority: int
    message: str
    value: float | None = None
    title: str = ""  # коротко, без текущих значений: для меток на 3D-модели
    active: bool = True
    acked: bool = False
    since: float = field(default_factory=time.time)
    rtnAt: float | None = None
    ackBy: str | None = None
    ackAt: float | None = None
    shelvedUntil: float | None = None
    shelvedBy: str | None = None
    shelveReason: str | None = None


@dataclass
class Cmd:
    id: str
    controller: str
    kind: str  # packml | mode | setpoint | speed
    name: str  # команда PackML, режим или id параметра
    value: float | None
    label: str
    user: str
    role: str
    reason: str
    status: str  # new | armed | sent | done | failed | rejected | expired | cancelled
    message: str = ""
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    expires: float | None = None
    guard: dict = field(default_factory=dict)


class Db:
    """SQLite: аудит (только добавление, сквозной хеш), история значений, события простоев."""

    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, kind TEXT, user TEXT,
                    role TEXT, controller TEXT, action TEXT, detail TEXT, status TEXT, hash TEXT);
                CREATE TABLE IF NOT EXISTS history (ts REAL, key TEXT, value REAL);
                CREATE INDEX IF NOT EXISTS history_key_ts ON history (key, ts);
                CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, controller TEXT, equipment TEXT,
                    area TEXT, state TEXT, reason TEXT, start REAL, end REAL);
            """)

    def close(self):
        with self.lock:
            self.db.close()

    def audit(self, kind, user, role, controller, action, detail: dict, status) -> dict:
        with self.lock, self.db:
            prev = self.db.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
            row = {"ts": round(time.time(), 3), "kind": kind, "user": user, "role": role, "controller": controller,
                   "action": action, "detail": json.dumps(detail, ensure_ascii=False, sort_keys=True), "status": status}
            digest = hashlib.sha256(((prev[0] if prev else "") + json.dumps(row, ensure_ascii=False, sort_keys=True)).encode()).hexdigest()
            cur = self.db.execute("INSERT INTO audit (ts, kind, user, role, controller, action, detail, status, hash) "
                                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (*row.values(), digest))
            return {"seq": cur.lastrowid, **row, "hash": digest}

    def audit_rows(self, limit=200, controller=None) -> list[dict]:
        q, args = "SELECT * FROM audit", []
        if controller:
            q, args = q + " WHERE controller = ?", [controller]
        with self.lock:
            rows = [dict(r) for r in self.db.execute(q + " ORDER BY seq DESC LIMIT ?", [*args, limit])]
        for r in rows:
            r["detail"] = json.loads(r["detail"])
        return rows

    def verify(self) -> dict:
        prev, n = "", 0
        with self.lock:
            for r in self.db.execute("SELECT * FROM audit ORDER BY seq"):
                row = {k: r[k] for k in ("ts", "kind", "user", "role", "controller", "action", "detail", "status")}
                digest = hashlib.sha256((prev + json.dumps(row, ensure_ascii=False, sort_keys=True)).encode()).hexdigest()
                if digest != r["hash"]:
                    return {"ok": False, "rows": n, "brokenAt": r["seq"]}
                prev, n = digest, n + 1
        return {"ok": True, "rows": n}

    def history_add(self, rows: list[tuple[float, str, float]]):
        with self.lock, self.db:
            self.db.executemany("INSERT INTO history VALUES (?, ?, ?)", rows)

    def history(self, keys: list[str], since: float, points: int = 300) -> dict[str, list]:
        out = {}
        with self.lock:
            for k in keys:
                rows = self.db.execute("SELECT ts, value FROM history WHERE key = ? AND ts >= ? ORDER BY ts", (k, since)).fetchall()
                step = max(1, len(rows) // points)
                out[k] = [[round(r[0], 2), r[1]] for r in rows[::step]]
        return out

    def prune(self, before: float):
        with self.lock, self.db:
            self.db.execute("DELETE FROM history WHERE ts < ?", (before,))

    def event_open(self, c: Controller, state: str, reason: str, start: float) -> int:
        with self.lock, self.db:
            return self.db.execute("INSERT INTO events (controller, equipment, area, state, reason, start) VALUES (?, ?, ?, ?, ?, ?)",
                                   (c.id, c.equipment, c.area, state, reason, start)).lastrowid

    def event_close(self, eid: int, end: float):
        with self.lock, self.db:
            self.db.execute("UPDATE events SET end = ? WHERE id = ?", (end, eid))

    def events(self, limit=100) -> list[dict]:
        with self.lock:
            rows = [dict(r) for r in self.db.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))]
        for r in rows:
            r["minutes"] = round(((r["end"] or time.time()) - r["start"]) / 60, 1)
        return rows


class Scada:
    def __init__(self, registry: Registry, db: Db, mode: str = "sim", sim=None):
        self.registry, self.db, self.mode, self.sim = registry, db, mode, sim
        self.values: dict[str, tuple[object, str, float]] = {}
        self.conn: dict[str, dict] = {cid: {"ok": False, "text": "Подключение…", "since": time.time()}
                                      for cid in registry.connections}
        self.alarms: dict[str, Alarm] = {}
        self.commands: dict[str, Cmd] = {}
        self.recent: deque[str] = deque(maxlen=30)
        self.heartbeat: dict[str, tuple[object, float]] = {}
        self.open_events: dict[str, tuple[int, int]] = {}  # контроллер -> (id события, состояние)
        self.hist_last: dict[str, tuple[float, float]] = {}
        self.drivers: dict[str, Driver] = {}
        self.version = 0
        self.task: asyncio.Task | None = None

    # --- связь с драйверами --------------------------------------------------------------------
    def _on_values(self, batch):
        self.values.update(batch)
        self.version += 1

    def _on_status(self, conn_id, ok, text):
        st = self.conn[conn_id]
        if st["ok"] != ok:
            st["since"] = time.time()
            if not ok:  # все теги подключения — без связи
                for c in self.registry.controllers.values():
                    if c.connection == conn_id:
                        for suffix in c.read_tags():
                            v = self.values.get(key(c.id, suffix))
                            self.values[key(c.id, suffix)] = (v[0] if v else None, "bad", time.time())
        st["ok"], st["text"] = ok, text
        self.version += 1

    def build_drivers(self):
        for conn in self.registry.connections.values():
            ctrls = [c for c in self.registry.controllers.values() if c.connection == conn.id]
            if self.mode == "sim":
                d = SimDriver(conn, ctrls, self._on_values, self._on_status, self.sim)
            elif conn.protocol == "opcua":
                d = OpcUaDriver(conn, ctrls, self._on_values, self._on_status)
            else:
                raise ValueError(f"{conn.id}: протокол {conn.protocol} не поддерживается — подключите его через OPC UA-шлюз")
            self.drivers[conn.id] = d

    async def start(self):
        self.build_drivers()
        for d in self.drivers.values():
            d.start()
        self.task = asyncio.get_running_loop().create_task(self._loop())

    async def stop(self):
        for d in self.drivers.values():
            await d.stop()
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def _loop(self):
        tick = 0
        while True:
            await asyncio.sleep(0.5)
            tick += 1
            try:  # цикл тревог не должен останавливаться из-за одной ошибки
                self.evaluate()
                if tick % 4 == 0:
                    self.record_history()
                if tick % 7200 == 0:
                    self.db.prune(time.time() - HISTORY_DAYS * 86400)
            except Exception:
                log.exception("Ошибка цикла SCADA")

    # --- чтение -------------------------------------------------------------------------------
    def v(self, cid: str, suffix: str, default=None):
        val = self.values.get(key(cid, suffix))
        return default if val is None or val[0] is None else val[0]

    def comm(self, c: Controller) -> tuple[str, str]:
        """good | stale | bad и пояснение — для блокировок и тревоги «нет связи»."""
        conn = self.conn[c.connection]
        if not conn["ok"]:
            return "bad", f"Нет связи: {conn['text']}"
        state = self.values.get(key(c.id, "Status.StateCurrent"))
        if state is None or state[1] != "good":
            return "bad", "Нет данных от ПЛК (проверьте адрес узла)"
        hb = self.heartbeat.get(c.id)
        if hb and time.time() - hb[1] > STALE_SECONDS:
            return "stale", f"Счётчик жизни ПЛК не меняется {time.time() - hb[1]:.0f} с"
        return "good", ""

    def state(self, c: Controller) -> State:
        s = self.v(c.id, "Status.StateCurrent", 0)
        return State(s) if s in State._value2member_map_ else State.UNDEFINED

    # --- тревоги ------------------------------------------------------------------------------
    def _conditions(self, c: Controller) -> dict[str, tuple[int, str, float | None, str]]:
        """Активные условия тревог контроллера: вид → (приоритет, текст, значение, короткий заголовок)."""
        out = {}
        low = lambda text: text[:1].lower() + text[1:]  # noqa: E731
        quality, why = self.comm(c)
        if quality != "good":
            out["comm"] = (1, f"Нет связи с контроллером. {why}", None, f"{c.equipment}: нет связи")
            return out  # остальные условия по недостоверным данным не оцениваются
        state = self.state(c)
        if not self.v(c.id, "Interlock.SafetyOk", True):
            out["safety"] = (1, "Разомкнута цепь безопасности: аварийная кнопка или ограждение", None,
                             f"{c.equipment}: цепь безопасности")
        if state in (State.ABORTING, State.ABORTED):
            code = int(self.v(c.id, "Admin.StopReason", 0))
            text = self.registry.fault_text(c, code) or "причина не передана"
            out["fault"] = (1, f"Авария: {text} (код {code})", code, f"{c.equipment}: {low(text)}")
        mode = self.v(c.id, "Status.UnitModeCurrent", Mode.PRODUCTION)
        if mode != Mode.PRODUCTION:
            return out  # обслуживание и ручной режим: тревоги процесса подавлены
        for p in c.params:
            on = state == State.EXECUTE or (p.active == "on" and state not in (State.STOPPED, State.ABORTED, State.ABORTING, State.CLEARING))
            pv = self.v(c.id, f"Status.Parameter.{p.id}")
            if not on or pv is None:
                continue
            band = 0.01 * (p.range[1] - p.range[0])  # зона нечувствительности для возврата в норму
            for kind, limit in p.alarms.items():
                aid = f"{p.id}.{kind}"
                held = aid in self.alarms_for(c.id)
                margin = band if held else 0
                if kind == "dev":
                    sp = self.v(c.id, f"Status.Setpoint.{p.id}", p.sp["value"])
                    hit = abs(pv - sp) > limit - margin
                    text = f"{p.name}: {pv:.{p.decimals}f} {p.unit}, уставка {sp:.{p.decimals}f} ± {limit:g}"
                elif kind in ("hi", "hihi"):
                    hit = pv > limit - margin
                    text = f"{p.name}: {pv:.{p.decimals}f} {p.unit} > {limit:g}"
                else:
                    hit = pv < limit + margin
                    text = f"{p.name}: {pv:.{p.decimals}f} {p.unit} < {limit:g}"
                if hit:
                    label, prio = LIMIT_TEXT[kind]
                    out[aid] = (prio, f"{label}. {text}", pv, f"{c.equipment}: {low(p.name)}")
        return out

    def alarms_for(self, cid: str) -> set[str]:
        return {a.kind for a in self.alarms.values() if a.controller == cid and a.active}

    def evaluate(self):
        now = time.time()
        for c in self.registry.controllers.values():
            hb = self.v(c.id, "Status.Heartbeat")
            if hb is not None and (c.id not in self.heartbeat or self.heartbeat[c.id][0] != hb):
                self.heartbeat[c.id] = (hb, now)
            conds = self._conditions(c)
            for kind, (prio, text, value, title) in conds.items():
                aid = f"{c.id}:{kind}"
                a = self.alarms.get(aid)
                if a is None or (not a.active and a.acked):
                    self.alarms[aid] = Alarm(aid, c.id, kind, prio, text, value, title)
                    self.db.audit("alarm", "система", "", c.id, "Тревога", {"alarm": aid, "text": text, "priority": prio}, "active")
                elif not a.active:  # повторное срабатывание до квитирования
                    a.active, a.rtnAt, a.since, a.message, a.value = True, None, now, text, value
                else:
                    a.message, a.value = text, value
            for aid, a in list(self.alarms.items()):
                if a.controller != c.id or not a.active or a.kind in conds:
                    continue
                a.active, a.rtnAt = False, now
                if a.acked:
                    del self.alarms[aid]
            for a in self.alarms.values():
                if a.shelvedUntil and a.shelvedUntil < now:
                    a.shelvedUntil = a.shelvedBy = a.shelveReason = None
            self._track_event(c, now)
        self._feedback(now)
        self.version += 1

    def ack(self, user: auth.User, aid: str | None = None, controller: str | None = None) -> int:
        auth.require(user, "operator")
        ids = [aid] if aid else [a.id for a in self.alarms.values() if not a.acked and (not controller or a.controller == controller)]
        n = 0
        for i in ids:
            a = self.alarms.get(i)
            if a is None:
                if aid:
                    raise CommandError("Тревога не найдена", 404)
                continue
            if a.acked:
                continue
            a.acked, a.ackBy, a.ackAt = True, user.login, time.time()
            self.db.audit("alarm", user.login, user.role, a.controller, "Квитирование", {"alarm": a.id, "text": a.message}, "ack")
            if not a.active:
                del self.alarms[i]
            n += 1
        self.version += 1
        return n

    def shelve(self, user: auth.User, aid: str, minutes: float, reason: str):
        auth.require(user, "engineer")
        a = self.alarms.get(aid)
        if a is None:
            raise CommandError("Тревога не найдена", 404)
        if not reason.strip():
            raise CommandError("Укажите причину отложения тревоги", 422)
        if minutes <= 0:
            a.shelvedUntil = a.shelvedBy = a.shelveReason = None
            action = "Возврат из отложенных"
        else:
            a.shelvedUntil, a.shelvedBy, a.shelveReason = time.time() + min(minutes, 480) * 60, user.login, reason.strip()
            action = f"Отложена на {min(minutes, 480):g} мин"
        self.db.audit("alarm", user.login, user.role, a.controller, action, {"alarm": aid, "reason": reason}, "shelve")
        self.version += 1

    # --- простои: переходы из «Работы» с причиной ---------------------------------------------
    def _track_event(self, c: Controller, now: float):
        if self.comm(c)[0] == "bad":
            return
        state = self.state(c)
        current = self.open_events.get(c.id)
        if state == State.EXECUTE or state in (State.STARTING, State.UNHOLDING, State.UNSUSPENDING):
            if current:
                self.db.event_close(current[0], now)
                del self.open_events[c.id]
            return
        if state in (State.ABORTED, State.HELD, State.SUSPENDED, State.STOPPED) and (not current or current[1] != state):
            if current:
                self.db.event_close(current[0], now)
            code = int(self.v(c.id, "Admin.StopReason", 0))
            reason = {State.SUSPENDED: "Блокировка/голодание: стоит соседний участок",
                      State.HELD: "Удержание оператором"}.get(state) or self.registry.fault_text(c, code) or "Остановлен"
            self.open_events[c.id] = (self.db.event_open(c, STATE_RU[state], reason, now), state)

    # --- команды ------------------------------------------------------------------------------
    def check(self, c: Controller, kind: str, name: str, value=None, role: str | None = None) -> str | None:
        """Причина, по которой команда сейчас невозможна, или None. Те же правила проверяет и ПЛК."""
        need = "engineer" if kind in ("mode", "setpoint", "speed") else "operator"
        if role is not None and not auth.allows(role, need):
            return f"Нужна роль «{auth.ROLE_RU[need]}»"
        if not self.registry.write_enabled or not c.writeEnabled:
            return "Управление выключено: режим только чтения (ввод в эксплуатацию)"
        quality, why = self.comm(c)
        if quality != "good":
            return why
        state = self.state(c)
        mode = self.v(c.id, "Status.UnitModeCurrent", 0)
        remote = self.v(c.id, "Interlock.Remote", False)
        safety = self.v(c.id, "Interlock.SafetyOk", False)
        if kind == "packml":
            cmd = Command[name]
            if not remote and cmd not in SAFE_COMMANDS:
                return "Пульт оборудования в режиме «Местный» — управление только на месте"
            if mode == Mode.MANUAL and cmd not in SAFE_COMMANDS:
                return "Ручной режим: со SCADA доступны только «Стоп» и аварийная остановка"
            if not allowed(state, cmd):
                return hint(state, cmd)
            if cmd in ENERGIZING and not safety:
                return "Разомкнута цепь безопасности — восстановите на месте"
            if cmd == Command.START:
                for p in c.params:
                    perm = p.permissive
                    if perm and perm.get("command") == "START":
                        pv = self.v(c.id, f"Status.Parameter.{p.id}", 0)
                        sp = self.v(c.id, f"Status.Setpoint.{p.id}", p.sp["value"] if p.sp else 0)
                        if pv < sp - perm["belowSp"]:
                            return f"{perm.get('text', 'Блокировка пуска')}: {p.name} {pv:.{p.decimals}f} < {sp - perm['belowSp']:g} {p.unit}"
            return None
        if not remote:
            return "Пульт оборудования в режиме «Местный» — управление только на месте"
        if kind == "mode":
            if name not in Mode.__members__:
                return "Неизвестный режим"
            if state not in MODE_CHANGE_STATES:
                return "Режим меняют в состоянии «Остановлен», «Готов» или «Авария»"
            if Mode[name] == mode:
                return "Этот режим уже установлен"
            return None
        if kind == "speed":
            if not c.speed_writable():
                return "Скорость задаётся ведущим конвейером"
            lim, current = c.speed, self.v(c.id, "Status.MachSpeed", c.speed["value"])
        else:
            p = c.param(name)
            if p is None or not p.sp:
                return "У параметра нет уставки"
            lim, current = p.sp, self.v(c.id, f"Status.Setpoint.{p.id}", p.sp["value"])
        if value is None or not isinstance(value, (int, float)) or value != value:
            return "Введите число"
        if not lim["min"] <= value <= lim["max"]:
            return f"Допустимо {lim['min']:g}…{lim['max']:g}"
        if "maxStep" in lim and abs(value - current) > lim["maxStep"] + 1e-9:
            return f"За одну команду — не более ±{lim['maxStep']:g} (сейчас {current:g})"
        return None

    def _label(self, c: Controller, kind, name, value) -> str:
        if kind == "packml":
            return COMMAND_RU[Command[name]]
        if kind == "mode":
            return f"Режим: {MODE_RU[Mode[name]]}"
        if kind == "speed":
            return f"Скорость → {value:g} {c.speed.get('unit', '')}"
        p = c.param(name)
        return f"{p.name} → {value:g} {p.unit}"

    def _guard(self, c: Controller, kind, name) -> dict:
        g = {"state": int(self.state(c)), "mode": self.v(c.id, "Status.UnitModeCurrent")}
        if kind == "setpoint":
            g["sp"] = self.v(c.id, f"Status.Setpoint.{name}")
        elif kind == "speed":
            g["sp"] = self.v(c.id, "Status.MachSpeed")
        return g

    def _audit_cmd(self, cmd: Cmd, status: str, extra: dict | None = None):
        self.db.audit("command", cmd.user, cmd.role, cmd.controller, cmd.label,
                      {"command": cmd.id, "kind": cmd.kind, "name": cmd.name, "value": cmd.value, "reason": cmd.reason,
                       "guard": cmd.guard, "message": cmd.message, **(extra or {})}, status)

    def needs_confirm(self, kind: str, name: str) -> bool:
        return kind != "packml" or Command[name] not in SAFE_COMMANDS

    async def request(self, user: auth.User, cid: str, kind: str, name: str, value=None, reason: str = "") -> Cmd:
        c = self.registry.controllers.get(cid)
        if c is None:
            raise CommandError("Контроллер не найден", 404)
        if kind not in ("packml", "mode", "setpoint", "speed"):
            raise CommandError("Неизвестный вид команды", 422)
        if kind == "packml" and (name not in Command.__members__ or Command[name] not in OPERATOR_COMMANDS):
            raise CommandError("Команда не поддерживается", 422)
        if kind == "mode" and name not in Mode.__members__:
            raise CommandError("Неизвестный режим", 422)
        if kind == "setpoint" and not (c.param(name) and c.param(name).sp):
            raise CommandError("У параметра нет уставки", 422)
        if kind in ("setpoint", "speed"):
            if value is None or value != value:
                raise CommandError("Введите число", 422)
            value = float(value)
        label = self._label(c, kind, name, value)
        cmd = Cmd(uuid4().hex[:12], cid, kind, name, value, label, user.login, user.role, reason.strip(), "new",
                  guard=self._guard(c, kind, name))
        blocked = self.check(c, kind, name, value, user.role)
        if blocked:
            cmd.status, cmd.message = "rejected", blocked
            self._remember(cmd)
            self._audit_cmd(cmd, "rejected")
            raise CommandError(blocked)
        self._remember(cmd)
        if self.needs_confirm(kind, name):
            cmd.status, cmd.expires = "armed", time.time() + ARM_SECONDS
            cmd.message = "Ожидает подтверждения"
            self._audit_cmd(cmd, "armed")
            return cmd
        await self._execute(c, cmd)
        return cmd

    async def confirm(self, user: auth.User, command_id: str, reason: str = "") -> Cmd:
        cmd = self.commands.get(command_id)
        if cmd is None:
            raise CommandError("Команда не найдена", 404)
        if cmd.user != user.login:
            raise CommandError("Подтвердить может только тот, кто подал команду", 403)
        if cmd.status != "armed":
            raise CommandError(f"Команда уже в статусе «{cmd.status}»")
        cmd.reason = reason.strip() or cmd.reason
        if cmd.kind != "packml" and not cmd.reason:
            raise CommandError("Укажите причину изменения — она попадёт в журнал", 422)
        c = self.registry.controllers[cmd.controller]
        if time.time() > cmd.expires:
            self._finish(cmd, "expired", "Время подтверждения истекло")
            raise CommandError("Время подтверждения истекло — подайте команду заново")
        if self._guard(c, cmd.kind, cmd.name) != cmd.guard:
            self._finish(cmd, "rejected", "Состояние оборудования изменилось после выбора команды")
            raise CommandError("Состояние оборудования изменилось — проверьте и подайте команду заново")
        blocked = self.check(c, cmd.kind, cmd.name, cmd.value, user.role)
        if blocked:
            self._finish(cmd, "rejected", blocked)
            raise CommandError(blocked)
        await self._execute(c, cmd)
        return cmd

    def cancel(self, user: auth.User, command_id: str) -> Cmd:
        cmd = self.commands.get(command_id)
        if cmd is None or cmd.user != user.login or cmd.status != "armed":
            raise CommandError("Нечего отменять", 404)
        self._finish(cmd, "cancelled", "Отменена оператором")
        return cmd

    async def _execute(self, c: Controller, cmd: Cmd):
        drv = self.drivers[c.connection]
        try:
            if cmd.kind == "packml":
                await drv.write(c.id, "Command.CntrlCmd", int(Command[cmd.name]))
                await drv.write(c.id, "Command.CmdChangeRequest", True)
            elif cmd.kind == "mode":
                await drv.write(c.id, "Command.UnitMode", int(Mode[cmd.name]))
                await drv.write(c.id, "Command.UnitModeChangeRequest", True)
            elif cmd.kind == "speed":
                await drv.write(c.id, "Command.MachSpeed", cmd.value)
            else:
                await drv.write(c.id, f"Command.Parameter.{cmd.name}", cmd.value)
        except Exception as e:
            self._finish(cmd, "failed", f"Запись в ПЛК не выполнена: {e}")
            raise CommandError(cmd.message, 502)
        cmd.status, cmd.message, cmd.updated = "sent", "Отправлена в ПЛК, ждём подтверждения", time.time()
        cmd.expires = time.time() + FEEDBACK_SECONDS
        self._audit_cmd(cmd, "sent")
        self.version += 1

    def _done(self, c: Controller, cmd: Cmd) -> bool:
        if cmd.kind == "packml":
            _, acting, final = TRANSITIONS[Command[cmd.name]]
            # пуск на линии, где сосед ещё стоит, сразу переходит в «Приостановлен» — это тоже выполнение
            return self.state(c) in (acting, final) or (final == State.EXECUTE and self.state(c) == State.SUSPENDED)
        if cmd.kind == "mode":
            return self.v(c.id, "Status.UnitModeCurrent") == int(Mode[cmd.name])
        tag = "Status.MachSpeed" if cmd.kind == "speed" else f"Status.Setpoint.{cmd.name}"
        v = self.v(c.id, tag)
        return v is not None and abs(v - cmd.value) < 1e-6 * max(1, abs(cmd.value))

    def _feedback(self, now: float):
        for cmd in self.commands.values():
            if cmd.status == "armed" and now > cmd.expires:
                self._finish(cmd, "expired", "Не подтверждена за 20 с")
            elif cmd.status == "sent":
                c = self.registry.controllers[cmd.controller]
                if self._done(c, cmd):
                    self._finish(cmd, "done", "Выполнена: ПЛК подтвердил")
                elif now > cmd.expires:
                    self._finish(cmd, "failed", "ПЛК не подтвердил выполнение за 10 с — проверьте блокировки на месте")

    def _finish(self, cmd: Cmd, status: str, message: str):
        cmd.status, cmd.message, cmd.updated = status, message, time.time()
        self._audit_cmd(cmd, status)
        self.version += 1

    def _remember(self, cmd: Cmd):
        self.commands[cmd.id] = cmd
        self.recent.appendleft(cmd.id)
        for old in list(self.commands):
            if old not in self.recent:
                del self.commands[old]
        self.version += 1

    # --- историк -----------------------------------------------------------------------------
    def record_history(self):
        now, rows = time.time(), []
        for c in self.registry.controllers.values():
            for suffix, span in [("Status.CurMachSpeed", c.speed.get("max", c.speed["value"]))] + \
                                [(f"Status.Parameter.{p.id}", p.range[1] - p.range[0]) for p in c.params] + \
                                [(f"Status.Setpoint.{p.id}", p.range[1] - p.range[0]) for p in c.params if p.sp]:
                val = self.values.get(key(c.id, suffix))
                if not val or val[1] != "good" or val[0] is None:
                    continue
                k, v = key(c.id, suffix), float(val[0])
                last = self.hist_last.get(k)
                # запись по изменению больше 0,5 % диапазона, но не реже раза в минуту
                if last is None or abs(v - last[1]) > 0.005 * span or now - last[0] > 60:
                    rows.append((now, k, v))
                    self.hist_last[k] = (now, v)
        if rows:
            self.db.history_add(rows)

    # --- снимок для HMI ------------------------------------------------------------------------
    def snapshot(self) -> dict:
        now = time.time()
        ctrls = {}
        for c in self.registry.controllers.values():
            quality, why = self.comm(c)
            state = self.state(c)
            params = {}
            for p in c.params:
                pv = self.values.get(key(c.id, f"Status.Parameter.{p.id}"))
                params[p.id] = {"pv": pv[0] if pv else None, "q": pv[1] if pv else "bad",
                                "sp": self.v(c.id, f"Status.Setpoint.{p.id}") if p.sp else None}
            commands = {}
            for cmd in OPERATOR_COMMANDS:
                commands[cmd.name] = {"blocked": self.check(c, "packml", cmd.name), "confirm": self.needs_confirm("packml", cmd.name)}
            mode_block = None if self.state(c) in MODE_CHANGE_STATES else "Режим меняют в состоянии «Остановлен», «Готов» или «Авария»"
            ctrls[c.id] = {
                "comm": quality, "commText": why, "state": int(state), "stateName": STATE_RU[state],
                "mode": self.v(c.id, "Status.UnitModeCurrent"), "speed": self.v(c.id, "Status.CurMachSpeed"),
                "speedSp": self.v(c.id, "Status.MachSpeed"), "processed": self.v(c.id, "Admin.ProdProcessedCount"),
                "defective": self.v(c.id, "Admin.ProdDefectiveCount"), "stopReason": self.v(c.id, "Admin.StopReason", 0),
                "stopText": self.registry.fault_text(c, int(self.v(c.id, "Admin.StopReason", 0) or 0)),
                "remote": self.v(c.id, "Interlock.Remote"), "safety": self.v(c.id, "Interlock.SafetyOk"),
                "params": params, "commands": commands, "modeBlocked": mode_block,
                "writeBlocked": None if self.registry.write_enabled and c.writeEnabled else "Режим только чтения",
            }
        alarms = sorted(self.alarms.values(), key=lambda a: (a.acked, a.priority, -a.since))
        return {
            "ts": now, "version": self.version, "mode": self.mode, "writeEnabled": self.registry.write_enabled,
            "connections": [{"id": cid, **st} for cid, st in self.conn.items()],
            "controllers": ctrls,
            "alarms": [asdict(a) for a in alarms],
            "commands": [self._public_cmd(self.commands[i]) for i in self.recent if i in self.commands],
            "buffers": self.sim.buffers() if self.sim else [],
        }

    @staticmethod
    def _public_cmd(cmd: Cmd) -> dict:
        d = asdict(cmd)
        d.pop("guard")
        return d
