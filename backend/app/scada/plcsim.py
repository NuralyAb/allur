"""Симулятор ПЛК линий — замена реальным контроллерам, пока нет доступа к сети завода.

Каждый контроллер ведёт себя как ПЛК с PackML-интерфейсом: цикл сканирования, машина состояний,
рукопожатие команд (CntrlCmd + CmdChangeRequest), собственные блокировки (ключ «Местный/Дистанционный»,
цепь безопасности, разрешение пуска), ограничение уставок, динамика процесса, износ и аварийные срабатывания.
Контроллеры одной линии связаны буферами: стоит сборка — окраска через время буфера приостанавливается.

Симулятор публикуется настоящим OPC UA-сервером (serve_opcua), поэтому SCADA работает с ним тем же клиентом,
что и с ПЛК завода. Проверки ПЛК дублируют проверки SCADA: защита не держится на одном уровне.
"""
import asyncio
import logging
import math
import random

from .packml import ACTING, ENERGIZING, MODE_CHANGE_STATES, SAFE_COMMANDS, TRANSITIONS, Command, Mode, State, allowed
from .registry import RAW_SPAN, Controller, Registry, Signal

SCAN_S = 0.2
ACTING_S = 1.5  # длительность переходных состояний (Запуск, Сброс, Остановка…)
ESTOP_CODE, SCADA_ABORT_CODE = 900, 910
log = logging.getLogger("scada.plcsim")


class SimPlc:
    """Один ПЛК: память тегов (image) по суффиксам PackTags и логика цикла."""

    def __init__(self, c: Controller, rng: random.Random):
        self.c, self.rng = c, rng
        s = c.sim
        self.state = State(s.get("state", State.EXECUTE))
        self.mode = Mode(s.get("mode", Mode.PRODUCTION))
        self.remote = s.get("remote", True)
        self.safety_ok = True
        self.stop_reason = s.get("stopReason", 0)
        self.defect_rate = s.get("defectRate", 0.0)
        self.speed_sp = c.speed["value"]
        self.speed = self.speed_sp if self.state == State.EXECUTE else 0.0
        self.processed = self.defective = 0
        self.progress = 0.0
        self.acting_left = 0.0
        self.target: State | None = None
        self.heartbeat = 0
        self.true = {}  # истинные значения процесса (без шума измерения)
        self.on_for: dict[str, float] = {}  # сколько секунд параметр «в работе»: защита по нижнему пределу ждёт выхода на режим
        self.sp = {}
        for p in c.params:
            if p.sp:
                self.sp[p.id] = p.sp["value"]
            on = self._active(p)
            self.true[p.id] = p.start if p.start is not None else (self._target(p) if on else p.ambient)
        self.image: dict[str, object] = {}
        self.image.update({"Command.CntrlCmd": 0, "Command.CmdChangeRequest": False, "Command.UnitMode": int(self.mode),
                           "Command.UnitModeChangeRequest": False, "Command.MachSpeed": float(self.speed_sp)})
        for pid, v in self.sp.items():
            self.image[f"Command.Parameter.{pid}"] = float(v)
        self._publish()

    # --- логика ПЛК ---------------------------------------------------------------------------
    def _active(self, p) -> bool:
        if p.active == "on":
            return self.state not in (State.STOPPED, State.ABORTED, State.ABORTING, State.CLEARING, State.UNDEFINED)
        return self.state == State.EXECUTE

    def _target(self, p) -> float:
        return self.sp[p.id] if p.sp else (p.nominal if p.nominal is not None else p.ambient)

    def _go(self, command: Command):
        _, acting, final = TRANSITIONS[command]
        self.state, self.target, self.acting_left = acting, final, ACTING_S

    def abort(self, code: int):
        if self.state not in (State.ABORTING, State.ABORTED):
            self.stop_reason = code
            self._go(Command.ABORT)

    def _accept(self, cmd: int) -> bool:
        """Собственные проверки ПЛК: SCADA могла ошибиться или команда пришла в обход неё."""
        if cmd not in Command._value2member_map_ or not allowed(self.state, cmd):
            return False
        cmd = Command(cmd)
        if not self.remote and cmd not in SAFE_COMMANDS:
            return False
        if self.mode == Mode.MANUAL and cmd not in SAFE_COMMANDS:
            return False
        if cmd in ENERGIZING and not self.safety_ok:
            return False
        if cmd == Command.START:
            for p in self.c.params:
                perm = p.permissive
                if perm and perm.get("command") == "START" and self.true[p.id] < self.sp.get(p.id, 0) - perm["belowSp"]:
                    return False
        return True

    def _commands(self):
        img = self.image
        if img["Command.CmdChangeRequest"]:
            cmd = int(img["Command.CntrlCmd"])
            if self._accept(cmd):
                if cmd == Command.ABORT:
                    self.stop_reason = SCADA_ABORT_CODE
                self._go(Command(cmd))
            img["Command.CmdChangeRequest"] = False
            img["Command.CntrlCmd"] = 0
        if img["Command.UnitModeChangeRequest"]:
            mode = int(img["Command.UnitMode"])
            if mode in Mode._value2member_map_ and self.remote and self.state in MODE_CHANGE_STATES:
                self.mode = Mode(mode)
            img["Command.UnitModeChangeRequest"] = False
            img["Command.UnitMode"] = int(self.mode)
        # уставки ПЛК ограничивает сам — диапазоном из паспорта оборудования
        if "min" in self.c.speed:
            self.speed_sp = min(self.c.speed["max"], max(self.c.speed["min"], float(img["Command.MachSpeed"])))
        for p in self.c.params:
            if p.sp:
                self.sp[p.id] = min(p.sp["max"], max(p.sp["min"], float(img[f"Command.Parameter.{p.id}"])))

    def scan(self, dt: float):
        self.heartbeat = (self.heartbeat + 1) % 2_147_483_647
        self._commands()
        if not self.safety_ok:
            self.abort(ESTOP_CODE)
        if self.state in ACTING:
            self.acting_left -= dt
            if self.acting_left <= 0:
                finished, self.state, self.target = self.state, self.target, None
                if finished == State.CLEARING:
                    # причина аварии устранена на месте: колпачки заменены, фильтр сменён, цепь натянута
                    for p in self.c.params:
                        if p.resetTo is not None and p.trip and p.trip["code"] == self.stop_reason:
                            self.true[p.id] = p.resetTo
                if self.state == State.IDLE:
                    self.stop_reason = 0
        k_speed = 1 - math.exp(-dt / 2)
        goal = self.speed_sp if self.state == State.EXECUTE else 0.0
        self.speed += (goal - self.speed) * k_speed
        for p in self.c.params:
            on = self._active(p)
            self.on_for[p.id] = self.on_for.get(p.id, 0.0) + dt if on else 0.0
            if p.drift:
                if on:
                    self.true[p.id] = min(p.range[1], self.true[p.id] + p.drift * dt / 60)
            else:
                target = self._target(p) if on else p.ambient
                self.true[p.id] += (target - self.true[p.id]) * (1 - math.exp(-dt / max(p.tau, 1e-3)))
            if p.trip and on and self._tripped(p):
                self.abort(p.trip["code"])
        if self.state == State.EXECUTE:
            self.progress += self.speed / 3600 * dt
            while self.progress >= 1:
                self.progress -= 1
                self.processed += 1
                self.defective += self.rng.random() < self.defect_rate
        self._publish()

    def _tripped(self, p) -> bool:
        v, t = self.true[p.id], p.trip
        # нижний предел (расход, давление) проверяется после выхода на режим — как таймер пуска насоса в настоящем ПЛК
        settled = self.on_for.get(p.id, 0.0) >= 3 * p.tau
        return ("above" in t and v > t["above"]) or ("below" in t and settled and v < t["below"])

    def _publish(self):
        img = self.image
        img["Status.StateCurrent"] = int(self.state)
        img["Status.UnitModeCurrent"] = int(self.mode)
        img["Status.CurMachSpeed"] = round(self.speed, 3)
        img["Status.MachSpeed"] = float(self.speed_sp)
        img["Status.Heartbeat"] = self.heartbeat
        img["Admin.ProdProcessedCount"] = self.processed
        img["Admin.ProdDefectiveCount"] = int(self.defective)
        img["Admin.StopReason"] = int(self.stop_reason)
        img["Interlock.Remote"] = bool(self.remote)
        img["Interlock.SafetyOk"] = bool(self.safety_ok)
        for p in self.c.params:
            noise = self.rng.gauss(0, p.noise) if p.noise else 0.0
            v = min(p.range[1], max(p.range[0], self.true[p.id] + noise))
            img[f"Status.Parameter.{p.id}"] = round(v, p.decimals + 1)
            if p.sp:
                img[f"Status.Setpoint.{p.id}"] = float(self.sp[p.id])
        for sig in self.c.io:
            img[f"IO.{sig.id}"] = self._signal(sig)

    def _signal(self, sig: Signal):
        """Образ процесса на клеммах: то, что модули ввода-вывода видят в поле, и что ПЛК выставляет на выходы."""
        st, img = self.state, self.image
        running = st in (State.EXECUTE, State.STARTING, State.UNHOLDING, State.UNSUSPENDING)
        if sig.kind == "AI":
            return self._raw(sig, img[f"Status.Parameter.{sig.param}"])
        if sig.kind == "AO":
            if sig.src == "speed_ref":
                return self._raw(sig, self.speed_sp if st == State.EXECUTE else 0.0)
            p = self.c.param(sig.param)
            target = self._target(p) if self._active(p) else p.ambient
            return self._raw(sig, target)
        on = st not in (State.STOPPED, State.ABORTED, State.ABORTING, State.CLEARING, State.UNDEFINED)
        return {
            "estop": self.safety_ok, "guard": self.safety_ok, "remote": self.remote,
            "run_fb": self.speed > 0.05 * max(self.speed_sp, 1e-6), "fault_fb": st in (State.ABORTED, State.ABORTING),
            "photoeye": st == State.EXECUTE and self.progress < 0.35, "on": on, "ready": st in (State.IDLE, State.EXECUTE, State.SUSPENDED, State.HELD),
            "run_cmd": running, "lamp_green": st == State.EXECUTE, "lamp_red": st in (State.ABORTED, State.ABORTING),
            "lamp_yellow": st in (State.HELD, State.SUSPENDED, State.IDLE, State.STOPPED), "horn": st in (State.STARTING, State.ABORTING),
            "valve": st == State.EXECUTE,
        }[sig.src]

    @staticmethod
    def _raw(sig: Signal, value: float) -> int:
        lo, hi = sig.range
        return int(min(RAW_SPAN, max(0, round((value - lo) / (hi - lo) * RAW_SPAN))))

    def write(self, suffix: str, value):
        """Запись извне (из SCADA или OPC UA-клиента) — только в область команд, как в настоящем ПЛК."""
        if not suffix.startswith("Command.") or suffix not in self.image:
            raise KeyError(f"{self.c.id}: тег {suffix} недоступен для записи")
        old = self.image[suffix]
        self.image[suffix] = bool(value) if isinstance(old, bool) else type(old)(value)


class PlcSim:
    """Все ПЛК завода и связи между ними через буферы линии."""

    def __init__(self, registry: Registry, seed: int | None = 7):
        rng = random.Random(seed)
        self.registry = registry
        self.plcs = {cid: SimPlc(c, random.Random(rng.random())) for cid, c in registry.controllers.items()}
        # межучастковые буферы: уровень заполнения в секундах работы, в начале смены — наполовину
        self.links = [{"up": ids[i], "down": ids[i + 1], "size": line["bufferSeconds"][i], "fill": line["bufferSeconds"][i] / 2}
                      for line in registry.lines for ids in [line["controllers"]] for i in range(len(ids) - 1)]

    def scan(self, dt: float = SCAN_S):
        for plc in self.plcs.values():
            plc.scan(dt)
        self._couple(dt)

    def _couple(self, dt: float):
        """Буфер полон — верхний участок заблокирован, пуст — нижний голодает: PackML Suspended до восстановления."""
        stuck = dict.fromkeys(self.plcs, False)
        for link in self.links:
            u, d = self.plcs[link["up"]], self.plcs[link["down"]]
            flow = (u.state == State.EXECUTE) - (d.state == State.EXECUTE)
            link["fill"] = min(link["size"], max(0.0, link["fill"] + flow * dt))
            hysteresis = 0.1 * link["size"]
            if link["fill"] >= link["size"] - (hysteresis if u.state == State.SUSPENDED else 0):
                stuck[link["up"]] = True
            if link["fill"] <= (hysteresis if d.state == State.SUSPENDED else 0):
                stuck[link["down"]] = True
        for cid, plc in self.plcs.items():
            if plc.state == State.EXECUTE and stuck[cid]:
                plc._go(Command.SUSPEND)
            elif plc.state == State.SUSPENDED and not stuck[cid]:
                plc._go(Command.UNSUSPEND)

    def buffers(self) -> list[dict]:
        return [{"up": l["up"], "down": l["down"], "size": l["size"], "fill": round(l["fill"], 1)} for l in self.links]

    # --- действия «на линии», а не со SCADA: для демонстрации ---------------------------------
    def inject_fault(self, cid: str, code: int):
        self.plcs[cid].abort(code)

    def set_safety(self, cid: str, ok: bool):
        self.plcs[cid].safety_ok = ok

    def set_remote(self, cid: str, remote: bool):
        self.plcs[cid].remote = remote

    def read(self, cid: str, suffix: str):
        return self.plcs[cid].image[suffix]

    def write(self, cid: str, suffix: str, value):
        self.plcs[cid].write(suffix, value)


# --- OPC UA-сервер поверх симулятора ------------------------------------------------------------
async def serve_opcua(sim: PlcSim, endpoint: str, namespace: str, ready: asyncio.Event | None = None):
    """Публикует память всех ПЛК как адресное пространство OPC UA: ns=<namespace>;s=<path>.<тег>."""
    from asyncua import Server, ua

    for name in ("asyncua", "asyncua.server", "asyncua.server.address_space", "asyncua.server.uaprocessor"):
        logging.getLogger(name).setLevel(logging.ERROR)
    server = Server()
    await server.init()
    server.set_endpoint(endpoint)
    server.set_server_name("Allur PLC simulator (PackML)")
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    idx = await server.register_namespace(namespace)
    root = await server.nodes.objects.add_folder(ua.NodeId("Allur", idx), "Allur")
    folders, nodes = {}, {}  # (cid, suffix) -> node
    vtypes = {bool: ua.VariantType.Boolean, int: ua.VariantType.Int32, float: ua.VariantType.Double}
    for cid, plc in sim.plcs.items():
        area, unit = plc.c.path.split(".", 1)
        if area not in folders:
            folders[area] = await root.add_folder(ua.NodeId(f"{area}", idx), area)
        obj = await folders[area].add_object(ua.NodeId(plc.c.path, idx), unit)
        groups = {}
        for suffix, value in plc.image.items():
            group = suffix.rsplit(".", 1)[0]
            if group not in groups:
                parent = obj
                for part_i, part in enumerate(group.split(".")):
                    key = ".".join(group.split(".")[:part_i + 1])
                    if key not in groups:
                        groups[key] = await parent.add_folder(ua.NodeId(f"{plc.c.path}.{key}", idx), part)
                    parent = groups[key]
            var = await groups[group].add_variable(ua.NodeId(f"{plc.c.path}.{suffix}", idx), suffix.rsplit(".", 1)[1],
                                                   ua.Variant(value, vtypes[type(value)]))
            if suffix.startswith("Command."):
                await var.set_writable()
            nodes[(cid, suffix)] = var
    known = {key: plc_value for key, plc_value in ((k, sim.plcs[k[0]].image[k[1]]) for k in nodes)}
    async with server:
        log.info("PLC simulator OPC UA server at %s", endpoint)
        if ready:
            ready.set()
        loop = asyncio.get_running_loop()
        last = loop.time()
        # рукопожатие PackML: клиент пишет CntrlCmd, затем CmdChangeRequest. Флаги запроса читаем первыми, а применяем
        # последними: если флаг уже поднят, код команды гарантированно записан раньше него
        command_nodes = sorted(((k, n) for k, n in nodes.items() if k[1].startswith("Command.")),
                               key=lambda item: not item[0][1].endswith("ChangeRequest"))
        while True:
            # 1. записи клиентов в область команд → память ПЛК
            seen = [(k, (await n.read_data_value()).Value.Value) for k, n in command_nodes]
            for (cid, suffix), value in sorted(seen, key=lambda item: item[0][1].endswith("ChangeRequest")):
                if value != known[(cid, suffix)]:
                    sim.write(cid, suffix, value)
                    known[(cid, suffix)] = sim.plcs[cid].image[suffix]
            now = loop.time()
            sim.scan(min(1.0, now - last))
            last = now
            # 2. память ПЛК → адресное пространство (только изменившиеся значения)
            for (cid, suffix), node in nodes.items():
                value = sim.plcs[cid].image[suffix]
                if value != known[(cid, suffix)]:
                    await server.write_attribute_value(node.nodeid, ua.DataValue(ua.Variant(value, vtypes[type(value)])))
                    known[(cid, suffix)] = value
            await asyncio.sleep(SCAN_S)
