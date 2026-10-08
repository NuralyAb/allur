"""Deterministic discrete-event demonstration; parameters are not factory measurements.

Time is in working minutes. One resource per aggregate stage, finite FIFO buffers,
blocking after service, an assembly failure once per shift, and deterministic quality.
No production state lives in a browser or in a scene component.
"""
from collections import deque
from dataclasses import dataclass, field
import heapq
import random
from threading import RLock
import time
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class SimulationConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    repairMinutes: float = Field(default=55, ge=0, le=180)
    assemblyCycle: float = Field(default=3.6, ge=2, le=12)
    bufferCapacity: int = Field(default=6, ge=1, le=12, strict=True)
    defectPercent: float = Field(default=2, ge=0, le=20)
    seed: int = Field(default=42, ge=0, le=1_000_000, strict=True)


class CompareRequest(SimulationConfig):
    alternativeRepair: float = Field(default=20, ge=0, le=180)
    workingDays: int = Field(default=23, ge=1, le=31, strict=True)
    contributionMargin: float = Field(default=150_000, ge=0, le=10_000_000)
    interventionCost: float = Field(default=30_000, ge=0, le=100_000_000)


ASSETS = [
    {"id": "ABB-01", "stage": "welding", "name": "Сварочный робот", "position": [102, 68, 0], "zone": "welding"},
    {"id": "Камера-02", "stage": "paint", "name": "Камера окраски", "position": [290, 142, 0], "zone": "paint"},
    {"id": "Конвейер-03", "stage": "assembly", "name": "Сборочный конвейер", "position": [136, 122, 0], "zone": "assembly"},
    {"id": "ОТК-01", "stage": "qc", "name": "Контроль качества", "position": [205, 48, 0], "zone": "qc"},
]
NAMES = ["Сварка", "Окраска", "Сборка", "ОТК"]
MODEL_MIX = ["onix"] * 25 + ["cobalt"] * 18 + ["j7"] * 5
# Spread models without changing the 25:18:5 ratio of the source monthly plan.
random.Random(7).shuffle(MODEL_MIX)
ASSUMPTIONS = [
    "Сценарная модель, не телеметрия MES. Позиции оборудования демонстрационные.",
    "Четыре агрегированных ресурса; маршруты внутри цехов показывают этап обработки.",
    "Такт сварки 3,2 мин, окраски 3,4 мин, ОТК 3,0 мин; такт сборки задаётся отдельно.",
    "Три конечных FIFO-буфера. PBS представлен буфером перед сборкой.",
    "Начальный WIP нулевой; подача CKD не ограничена. Микс 25:18:5 взят из месячного плана, ограничения спроса не моделируются.",
    "Межцеховой транспорт мгновенный; внутри каждого этапа маршрут показывает прогресс агрегированной операции.",
    "Отказ Конвейера-03 на 30-й рабочей минуте каждой смены; длительность ремонта — параметр.",
    "Смена 480 рабочих минут без перерывов; две смены в рабочий день. Месяц — непрерывная цепочка рабочих минут.",
    "Брак определяется при ОТК по seed; дефектные изделия выводятся в карантин, переделка не моделируется.",
    "MTBF, MTTR, запасы, календарь и экономические значения не подтверждены заводом.",
]


@dataclass
class Station:
    cycle: float
    queue: deque = field(default_factory=deque)
    body: dict | None = None
    start: float = 0
    end: float = 0
    remaining: float = 0
    ready: bool = False
    failed: bool = False
    generation: int = 0
    processed: int = 0
    durations: dict = field(default_factory=lambda: {k: 0.0 for k in ("RUN", "FAULT", "BLOCKED", "STARVED")})

    def state(self):
        if self.failed:
            return "FAULT"
        if self.ready:
            return "BLOCKED"
        return "RUN" if self.body is not None else "STARVED"


class Engine:
    def __init__(self, config: SimulationConfig, horizon=480.0, cycles=None):
        self.config = config
        self.horizon = float(horizon)
        self.now = 0.0
        self.stations = [Station(c) for c in (cycles or (3.2, 3.4, config.assemblyCycle, 3.0))]
        self.events = []
        self.serial = 0
        self.journal = deque(maxlen=24)
        self.started = self.good = self.rejected = 0
        self.finished_bodies = deque(maxlen=8)
        self.fault_until = None
        self.quality = random.Random(config.seed)
        for shift in range(int((horizon - 1e-9) // 480) + 1):
            self._schedule(shift * 480 + 30, "fault", 2, 0)
        self._pump()

    def _schedule(self, at, kind, station, generation):
        self.serial += 1
        heapq.heappush(self.events, (at, self.serial, kind, station, generation))

    def _log(self, kind, message, asset=None):
        self.journal.append({"id": self.serial, "time": round(self.now, 3), "kind": kind,
                             "message": message, "assetId": asset})

    def _start(self, i, body):
        s = self.stations[i]
        s.body, s.start, s.end, s.ready = body, self.now, self.now + s.cycle, False
        s.remaining = s.cycle
        s.generation += 1
        self._schedule(s.end, "done", i, s.generation)

    def _pump(self):
        changed = True
        while changed:
            changed = False
            for i in range(3, -1, -1):
                s = self.stations[i]
                if s.failed:
                    continue
                if s.ready and (i == 3 or len(self.stations[i + 1].queue) < self.config.bufferCapacity):
                    body = s.body
                    s.body, s.ready = None, False
                    s.processed += 1
                    if i == 3:
                        rejected = self.quality.random() < self.config.defectPercent / 100
                        self.rejected += int(rejected)
                        self.good += int(not rejected)
                        if not rejected:
                            self.finished_bodies.append({**body, "finishedAt": self.now})
                    else:
                        self.stations[i + 1].queue.append(body)
                    changed = True
                if s.body is None and self.now < self.horizon:
                    if i == 0:
                        self.started += 1
                        self._start(i, {"id": f"BODY-{self.started:05d}", "model": MODEL_MIX[(self.started - 1) % 48]})
                        changed = True
                    elif s.queue:
                        self._start(i, s.queue.popleft())
                        changed = True

    def _elapse(self, until):
        delta = until - self.now
        for s in self.stations:
            s.durations[s.state()] += delta
        self.now = until

    def advance(self, until):
        until = min(max(float(until), self.now), self.horizon)
        while self.events and self.events[0][0] <= until:
            at, _, kind, i, generation = heapq.heappop(self.events)
            self._elapse(at)
            s = self.stations[i]
            if kind == "done":
                if generation != s.generation or s.failed or s.body is None:
                    continue
                s.ready = True
            elif kind == "fault":
                if self.config.repairMinutes == 0:
                    continue
                s.failed = True
                s.remaining = max(0, s.end - self.now) if s.body and not s.ready else 0
                s.generation += 1
                self.fault_until = self.now + self.config.repairMinutes
                self._schedule(self.fault_until, "repair", i, s.generation)
                self._log("fault", "Обрыв цепи: сборочный конвейер остановлен", "Конвейер-03")
            elif kind == "repair":
                s.failed = False
                self.fault_until = None
                if s.body and not s.ready:
                    # Keep completed progress: the repair interval adds no processing.
                    s.end = self.now + s.remaining
                    s.start = s.end - s.cycle
                    self._schedule(s.end, "done", i, s.generation)
                self._log("repair", "Ремонт завершён: обработка возобновлена", "Конвейер-03")
            self._pump()
        self._elapse(until)

    def snapshot(self):
        vehicles, stages = [], []
        for i, s in enumerate(self.stations):
            asset = ASSETS[i]
            progress = (1 - s.remaining / s.cycle) if s.failed and not s.ready else (self.now - s.start) / s.cycle
            progress = min(1, max(0, progress)) if s.body else 0
            if s.body:
                vehicles.append({**s.body, "stage": asset["stage"], "status": "processing",
                                 "progress": progress, "start": s.start, "end": s.end})
            for j, body in enumerate(s.queue):
                vehicles.append({**body, "stage": asset["stage"], "status": "queued", "queueIndex": j, "progress": 0})
            stages.append({**asset, "label": NAMES[i], "state": s.state(), "cycleMinutes": s.cycle,
                           "processed": s.processed, "queue": len(s.queue), "capacity": self.config.bufferCapacity,
                           "progress": round(progress, 4),
                           "durations": {k: round(v, 3) for k, v in s.durations.items()}})
        wip = len(vehicles)
        return {"time": round(self.now, 4), "horizon": self.horizon, "completed": self.now >= self.horizon,
                "config": self.config.model_dump(), "stages": stages, "vehicles": vehicles,
                "finishedVehicles": list(self.finished_bodies), "started": self.started, "good": self.good,
                "rejected": self.rejected, "wip": wip,
                "faultUntil": self.fault_until, "events": list(reversed(self.journal)),
                "nextEventAt": min((e[0] for e in self.events if e[0] >= self.now), default=self.horizon),
                "assumptions": ASSUMPTIONS}


class Session:
    def __init__(self, config):
        self.id = str(uuid4())
        self.engine = Engine(config)
        self.running = False
        self.speed = 120
        self.updated = self.touched = time.monotonic()
        self.version = 0
        self.lock = RLock()

    def _update(self):
        now = time.monotonic()
        if self.running:
            self.engine.advance(self.engine.now + (now - self.updated) * self.speed / 60)
            if self.engine.now >= self.engine.horizon:
                self.running = False
        self.updated = self.touched = now

    def snapshot(self):
        with self.lock:
            self._update()
            self.version += 1
            return {**self.engine.snapshot(), "sessionId": self.id, "running": self.running,
                    "speed": self.speed, "version": self.version}

    def control(self, action, minutes=15, speed=120):
        with self.lock:
            self._update()
            if action == "resume":
                self.running = self.engine.now < self.engine.horizon
            elif action == "pause":
                self.running = False
            elif action == "advance":
                self.running = False
                self.engine.advance(self.engine.now + minutes)
            elif action == "fault":
                self.running = False
                self.engine.advance(max(self.engine.now, 30))
            elif action == "reset":
                self.running = False
                self.engine = Engine(self.engine.config)
            elif action == "speed":
                self.speed = speed
            return self.snapshot()


SESSIONS = {}
SESSIONS_LOCK = RLock()


def create_session(config):
    with SESSIONS_LOCK:
        now = time.monotonic()
        for key in list(SESSIONS):
            if now - SESSIONS[key].touched > 3600:
                del SESSIONS[key]
        if len(SESSIONS) >= 128:
            del SESSIONS[min(SESSIONS, key=lambda key: SESSIONS[key].touched)]
        session = Session(config)
        SESSIONS[session.id] = session
        return session.snapshot()


def get_session(session_id):
    with SESSIONS_LOCK:
        return SESSIONS.get(session_id)


def compare(request: CompareRequest):
    base = SimulationConfig(**{key: getattr(request, key) for key in SimulationConfig.model_fields})
    alternative = base.model_copy(update={"repairMinutes": request.alternativeRepair})
    def run(config, horizon):
        engine = Engine(config, horizon)
        engine.advance(horizon)
        return engine.snapshot()
    baseline, improved = run(base, 480), run(alternative, 480)
    month_horizon = request.workingDays * 2 * 480
    month_base, month_improved = run(base, month_horizon), run(alternative, month_horizon)
    healthy = run(base.model_copy(update={"repairMinutes": 0}), 480)
    healthy_config = base.model_copy(update={"repairMinutes": 0})
    trials = []
    for i, asset in enumerate(ASSETS):
        cycles = [3.2, 3.4, base.assemblyCycle, 3.0]
        cycles[i] *= 0.9
        trial = Engine(healthy_config, cycles=cycles)
        trial.advance(480)
        trials.append({"assetId": asset['id'], "label": NAMES[i], "extraGood": trial.good - healthy['good']})
    constraint = max(trials, key=lambda trial: trial['extraGood'])
    delta = improved["good"] - baseline["good"]
    durations = baseline["stages"]
    loss = healthy["good"] - baseline["good"]
    return {
        "parameters": request.model_dump(), "baseline": baseline, "alternative": improved,
        "healthyGood": healthy["good"], "deltaGood": delta,
        "bottleneck": {**constraint, "trials": trials,
                       "method": "Поочерёдное сокращение такта каждого ресурса на 10% в контрольной смене без отказа."},
        "savedMinutes": baseline["stages"][2]["durations"]["FAULT"] - improved["stages"][2]["durations"]["FAULT"],
        "effectKzt": round(delta * request.contributionMargin - request.interventionCost),
        "month": {"baseline": month_base["good"], "alternative": month_improved["good"], "target": 5500,
                  "days": request.workingDays, "shiftsPerDay": 2},
        "causes": [
            {"assetId": "Конвейер-03", "text": f"Отказ сборки: {durations[2]['durations']['FAULT']:.0f} мин без обработки."},
            {"assetId": "Камера-02", "text": f"Окраска заблокирована {durations[1]['durations']['BLOCKED']:.1f} мин: на {durations[1]['durations']['BLOCKED'] - healthy['stages'][1]['durations']['BLOCKED']:.1f} мин больше контрольного прогона без отказа."},
            {"assetId": "ОТК-01", "text": f"ОТК без подачи {durations[3]['durations']['STARVED']:.1f} мин: на {durations[3]['durations']['STARVED'] - healthy['stages'][3]['durations']['STARVED']:.1f} мин больше контроля. Время включает запуск и паузы между изделиями."},
            {"assetId": "Конвейер-03", "text": f"Контрольный прогон без отказа: {healthy['good']} годных; разница с базой — {loss} авто за смену."},
        ],
        "assumptions": ASSUMPTIONS + [
            "Месячный результат рассчитан отдельным прогоном, а не умножением одной смены.",
            "Экономический эффект относится к одной смене; маржинальный доход и цена вмешательства заданы пользователем.",
        ],
    }
