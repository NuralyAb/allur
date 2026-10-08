"""Реестр контроллеров: какие ПЛК есть на линиях, как до них достучаться и какие у них теги.

Конфигурация — data/controllers.json (путь меняется переменной SCADA_CONFIG). Ошибки конфигурации
обнаруживаются при запуске, а не в момент команды оператора.
"""
import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_CONFIG = Path(os.environ.get("SCADA_CONFIG", Path(__file__).resolve().parents[1] / "data" / "controllers.json"))

# теги, которые SCADA читает у каждого ПЛК (PackTags); значения параметров добавляются по конфигурации
STATUS_TAGS = ["Status.StateCurrent", "Status.UnitModeCurrent", "Status.CurMachSpeed", "Status.MachSpeed",
               "Status.Heartbeat", "Admin.ProdProcessedCount", "Admin.ProdDefectiveCount", "Admin.StopReason",
               "Interlock.Remote", "Interlock.SafetyOk"]
COMMAND_TAGS = ["Command.CntrlCmd", "Command.CmdChangeRequest", "Command.UnitMode", "Command.UnitModeChangeRequest",
                "Command.MachSpeed"]
LIMIT_KINDS = ("lolo", "lo", "hi", "hihi", "dev")
RAW_SPAN = 27648  # шкала аналогового входа ПЛК (4–20 мА → 0…27648, как у SIMATIC)
SIGNAL_KINDS = ("DI", "DO", "AI", "AO")
# дискретные сигналы, которые ПЛК формирует из своей логики; AI/AO привязаны к параметру процесса или заданию скорости
DI_SOURCES = ("estop", "guard", "remote", "run_fb", "fault_fb", "photoeye", "on", "ready")
DO_SOURCES = ("run_cmd", "lamp_green", "lamp_red", "lamp_yellow", "horn", "valve")


@dataclass
class Param:
    id: str
    name: str
    unit: str
    decimals: int
    range: tuple[float, float]
    sp: dict | None = None  # {"value", "min", "max", "maxStep"} — параметр с уставкой
    nominal: float | None = None
    ambient: float = 0
    active: str = "execute"  # когда параметр «в работе» и тревоги по нему имеют смысл: execute | on
    tau: float = 1
    noise: float = 0
    drift: float = 0  # ед./мин в работе — износ, загрязнение
    start: float | None = None
    resetTo: float | None = None
    alarms: dict = field(default_factory=dict)
    trip: dict | None = None
    permissive: dict | None = None


@dataclass
class Signal:
    """Полевой сигнал на клеммах шкафа: датчик или исполнительное устройство, подключённое к модулю ввода-вывода ПЛК."""
    id: str
    name: str
    kind: str  # DI | DO | AI | AO
    address: str  # адрес в ПЛК, например %I0.3 или %IW64
    device: str  # что стоит в поле: тип датчика, привода, лампы
    src: str | None = None  # для DI/DO — что ПЛК сюда пишет; для AO — speed_ref (задание скорости)
    param: str | None = None  # для AI/AO — параметр процесса
    unit: str = ""
    range: tuple[float, float] = (0, 1)

    def scale(self, raw) -> float | bool | None:
        """Инженерное значение из сырого: DI/DO — логика, AI/AO — линейная шкала 0…27648 → диапазон."""
        if raw is None:
            return None
        if self.kind in ("DI", "DO"):
            return bool(raw)
        lo, hi = self.range
        return lo + (hi - lo) * float(raw) / RAW_SPAN


@dataclass
class Cabinet:
    id: str
    location: str
    plc: str
    io: str
    drive: str | None = None


@dataclass
class Controller:
    id: str
    equipment: str
    name: str
    zone: str
    area: str
    connection: str
    path: str
    speed: dict
    params: list[Param]
    faults: dict[int, str]
    sim: dict = field(default_factory=dict)
    map: dict = field(default_factory=dict)
    writeEnabled: bool = True
    cabinet: Cabinet | None = None
    io: list[Signal] = field(default_factory=list)

    def param(self, pid: str) -> Param | None:
        return next((p for p in self.params if p.id == pid), None)

    def signal(self, sid: str) -> Signal | None:
        return next((s for s in self.io if s.id == sid), None)

    def read_tags(self) -> list[str]:
        tags = list(STATUS_TAGS)
        for p in self.params:
            tags.append(f"Status.Parameter.{p.id}")
            if p.sp:
                tags.append(f"Status.Setpoint.{p.id}")
        tags += [f"IO.{s.id}" for s in self.io]
        return tags

    def write_tags(self) -> list[str]:
        return COMMAND_TAGS + [f"Command.Parameter.{p.id}" for p in self.params if p.sp]

    def speed_writable(self) -> bool:
        return "min" in self.speed and "max" in self.speed


@dataclass
class Connection:
    id: str
    name: str
    protocol: str
    endpoint: str
    namespace: str | None = None
    security: str | None = None
    user: str | None = None
    passwordEnv: str | None = None
    publishingMs: int = 250


@dataclass
class Registry:
    connections: dict[str, Connection]
    controllers: dict[str, Controller]
    lines: list[dict]
    faults: dict[int, str]
    write_enabled: bool
    station: dict = field(default_factory=dict)  # центральный пульт: где стоит сервер, сеть, резервирование

    def fault_text(self, controller: Controller, code: int) -> str:
        if not code:
            return ""
        return controller.faults.get(code) or self.faults.get(code) or f"Код {code}"

    def public(self) -> dict:
        """Статическая часть для HMI: имена, единицы, диапазоны, уставки и коды неисправностей."""
        return {
            "writeEnabled": self.write_enabled, "station": self.station,
            "connections": [{k: getattr(c, k) for k in ("id", "name", "protocol", "endpoint")} for c in self.connections.values()],
            "lines": self.lines,
            "controllers": [{
                "id": c.id, "equipment": c.equipment, "name": c.name, "zone": c.zone, "area": c.area,
                "connection": c.connection, "path": c.path, "speed": c.speed, "writeEnabled": c.writeEnabled,
                "faults": {str(k): v for k, v in {**self.faults, **c.faults}.items()},
                "cabinet": asdict(c.cabinet) if c.cabinet else None,
                "io": [asdict(s) for s in c.io],
                "params": [{"id": p.id, "name": p.name, "unit": p.unit, "decimals": p.decimals, "range": p.range,
                            "sp": p.sp, "alarms": p.alarms, "trip": p.trip, "permissive": p.permissive} for p in c.params],
            } for c in self.controllers.values()],
        }


def parse(raw: dict) -> Registry:
    errors = []
    connections = {c["id"]: Connection(**c) for c in raw["connections"]}
    controllers = {}
    for c in raw["controllers"]:
        params = [Param(**{**p, "range": tuple(p["range"])}) for p in c.pop("params")]
        faults = {int(k): v for k, v in c.pop("faults", {}).items()}
        cabinet = Cabinet(**c.pop("cabinet")) if c.get("cabinet") else None
        io = [Signal(**s) for s in c.pop("io", [])]
        ctrl = Controller(**c, params=params, faults=faults, cabinet=cabinet, io=io)
        errors += _check_io(ctrl)
        if ctrl.id in controllers:
            errors.append(f"{ctrl.id}: повторный id")
        if ctrl.connection not in connections:
            errors.append(f"{ctrl.id}: неизвестное подключение {ctrl.connection}")
        for p in params:
            if p.sp and not (p.sp["min"] <= p.sp["value"] <= p.sp["max"]):
                errors.append(f"{ctrl.id}.{p.id}: уставка вне диапазона")
            if set(p.alarms) - set(LIMIT_KINDS):
                errors.append(f"{ctrl.id}.{p.id}: неизвестный вид тревоги {set(p.alarms) - set(LIMIT_KINDS)}")
            if "dev" in p.alarms and not p.sp:
                errors.append(f"{ctrl.id}.{p.id}: тревога отклонения без уставки")
        controllers[ctrl.id] = ctrl
    for line in raw.get("lines", []):
        missing = [cid for cid in line["controllers"] if cid not in controllers]
        if missing:
            errors.append(f"линия {line['id']}: нет контроллеров {missing}")
        if len(line.get("bufferSeconds", [])) != len(line["controllers"]) - 1:
            errors.append(f"линия {line['id']}: bufferSeconds — по одному на каждую связь")
    if errors:
        raise ValueError("Ошибка конфигурации SCADA: " + "; ".join(errors))
    env = os.environ.get("SCADA_WRITE")
    write_enabled = raw.get("writeEnabled", False) if env is None else env not in ("0", "false", "no")
    return Registry(connections, controllers, raw.get("lines", []),
                    {int(k): v for k, v in raw.get("commonFaults", {}).items()}, write_enabled, raw.get("station", {}))


def _check_io(ctrl: Controller) -> list[str]:
    """Проверка перечня сигналов и привязка AI/AO к шкале параметра или скорости."""
    errors, seen = [], set()
    for s in ctrl.io:
        if s.id in seen:
            errors.append(f"{ctrl.id}.io: повторный сигнал {s.id}")
        seen.add(s.id)
        if s.kind not in SIGNAL_KINDS:
            errors.append(f"{ctrl.id}.io.{s.id}: вид сигнала {s.kind} (нужен DI, DO, AI или AO)")
        elif s.kind == "DI" and s.src not in DI_SOURCES or s.kind == "DO" and s.src not in DO_SOURCES:
            errors.append(f"{ctrl.id}.io.{s.id}: неизвестный источник {s.src}")
        elif s.kind in ("AI", "AO"):
            if s.param:
                p = ctrl.param(s.param)
                if p is None:
                    errors.append(f"{ctrl.id}.io.{s.id}: нет параметра {s.param}")
                else:
                    s.unit, s.range = p.unit, p.range
            elif s.src == "speed_ref":
                s.unit, s.range = ctrl.speed.get("unit", ""), (0.0, float(ctrl.speed.get("max", ctrl.speed["value"] * 1.25)))
            else:
                errors.append(f"{ctrl.id}.io.{s.id}: аналоговому сигналу нужен param или src=speed_ref")
    return errors


def load(path: str | Path = DEFAULT_CONFIG) -> Registry:
    return parse(json.loads(Path(path).read_text(encoding="utf-8")))
