"""Фоновый движок ИИ: раз в 5 с снимает параметры всех контроллеров из SCADA и пересчитывает прогнозы.

Время ряда — «время в работе» параметра: пока линия стоит, износ не идёт, и простой не должен растягивать
тренд. После пуска и смены уставки параметр выходит на режим (3 постоянные времени) — эти точки детектор
аномалий не видит. После ремонта (скачок к норме больше 10 % диапазона) окно тренда начинается заново.

Модели обучаются при запуске в отдельном потоке (несколько секунд); пока идёт обучение, API отвечает
статусом «training». AI_MODE=off выключает движок.
"""
import asyncio
import logging
import os
import threading
import time
from collections import deque

import numpy as np

from ..scada.drivers import key
from ..scada.packml import State
from . import maintenance as mt
from . import quality

TICK_S = 5.0
KEEP_S = 20 * 60
log = logging.getLogger("ai")


class Engine:
    def __init__(self):
        self.lock = threading.Lock()
        self.buf: dict[tuple[str, str], deque] = {}  # (контроллер, параметр) -> (время в работе, значение, уставка)
        self.clock: dict[tuple[str, str], float] = {}
        self.seen: dict[tuple[str, str], float] = {}
        self.was_on: dict[tuple[str, str], bool] = {}
        self.settle: dict[tuple[str, str], float] = {}
        self.last_sp: dict[tuple[str, str], float | None] = {}
        self.hits: dict[tuple[str, str], int] = {}
        self.failure_model = None
        self.anomaly_model = None
        self.anomaly_threshold = 0.0
        self.quality_models: dict[str, quality.QualityModel] = {}
        self.metrics: dict = {}
        self.status = "idle"
        self.error: str | None = None
        self.trained_at: float | None = None
        self.predictions: list[dict] = []
        self.anomalies: list[dict] = []
        self.updated: float | None = None
        self.task: asyncio.Task | None = None
        self.registry = None

    # --- обучение -------------------------------------------------------------------------------
    def train(self, registry):
        self.status, self.registry = "training", registry
        t0 = time.perf_counter()
        try:
            failure, fm = mt.train_failure_model()
            anomaly, threshold, am = mt.train_anomaly_model()
            qmodels = {c.id: quality.train(c) for c in registry.controllers.values() if c.sim.get("quality")}
            with self.lock:
                self.failure_model, self.anomaly_model, self.anomaly_threshold = failure, anomaly, threshold
                self.quality_models = qmodels
                self.metrics = {"failure": fm, "anomaly": am,
                                "quality": {cid: q.metrics for cid, q in qmodels.items()},
                                "trainSeconds": round(time.perf_counter() - t0, 1)}
            self.trained_at, self.status = time.time(), "ready"
            log.info("Модели ИИ обучены за %.1f с", time.perf_counter() - t0)
        except Exception as e:  # движок ИИ не должен ронять двойник
            log.exception("Обучение моделей ИИ")
            self.status, self.error = "error", str(e)

    @property
    def ready(self) -> bool:
        return self.status == "ready"

    # --- сбор сигналов --------------------------------------------------------------------------
    def sample(self, scada, now: float):
        """Снять текущие значения параметров; now — время опроса (в тестах — модельное)."""
        for c in scada.registry.controllers.values():
            if scada.comm(c)[0] != "good":
                continue
            state = scada.state(c)
            for p in c.params:
                k = (c.id, p.id)
                on = state == State.EXECUTE or (p.active == "on" and state not in (
                    State.STOPPED, State.ABORTED, State.ABORTING, State.CLEARING, State.UNDEFINED))
                val = scada.values.get(key(c.id, f"Status.Parameter.{p.id}"))
                sp = scada.v(c.id, f"Status.Setpoint.{p.id}") if p.sp else None
                with self.lock:
                    buf = self.buf.setdefault(k, deque())
                    prev, seen = self.clock.get(k, 0.0), self.seen.get(k)
                    self.seen[k] = now
                    if not on or not val or val[1] != "good" or val[0] is None:
                        self.was_on[k] = False
                        continue
                    t = self.clock[k] = prev + (min(now - seen, 60.0) if self.was_on.get(k) and seen else 0.0)
                    v = float(val[0])
                    restart = not self.was_on.get(k) and not p.drift
                    sp_changed = p.sp is not None and self.last_sp.get(k) not in (None, sp)
                    span = p.range[1] - p.range[0]
                    # скачок к норме: колпачки заменили, фильтр сменили — износ начинается заново
                    repaired = bool(buf) and any(
                        lim.direction * (buf[-1][1] - v) > 0.1 * span for lim in mt.limits(p))
                    if restart or sp_changed or repaired:
                        buf.clear()
                        self.hits[k] = 0
                        if not p.drift:
                            self.settle[k] = t + 3 * p.tau + TICK_S
                    self.was_on[k], self.last_sp[k] = True, sp
                    if t < self.settle.get(k, 0.0):
                        continue
                    buf.append((t, v, sp))
                    while buf and buf[0][0] < t - KEEP_S:
                        buf.popleft()

    def series(self, k) -> tuple[mt.Series, float] | None:
        with self.lock:
            rows = list(self.buf.get(k, ()))
        if not rows:
            return None
        arr = np.array([(r[0], r[1]) for r in rows])
        sps = np.array([r[2] for r in rows], dtype=float) if rows[0][2] is not None else None
        return mt.Series(arr[:, 0], arr[:, 1], sps), float(arr[-1, 0])

    # --- прогнозы --------------------------------------------------------------------------------
    def evaluate(self, registry, now: float):
        if not self.ready:
            return
        preds, anomalies = [], []
        for c in registry.controllers.values():
            for p in c.params:
                k = (c.id, p.id)
                got = self.series(k) if self.was_on.get(k) else None  # стоит — прогноз по старому окну не показываем
                if got is None:
                    self.hits[k] = 0
                    continue
                s, t = got
                if mt.limits(p):
                    pred = mt.predict_failure(self.failure_model, c, p, s, t)
                    if pred:
                        preds.append(pred)
                a = mt.detect_anomaly(self.anomaly_model, self.anomaly_threshold, c, p, s, t)
                self.hits[k] = self.hits.get(k, 0) + 1 if a and a["anomalous"] else 0
                if a and self.hits[k] >= mt.ANOMALY_PERSIST:
                    anomalies.append({**a, "since": now - (self.hits[k] - 1) * TICK_S})
        order = {"bad": 0, "warn": 1, "ok": 2}
        preds.sort(key=lambda r: (order[r["severity"]], -r["probability"], r["etaMin"] if r["etaMin"] is not None else 1e9))
        anomalies.sort(key=lambda a: -a["score"])
        with self.lock:
            self.predictions, self.anomalies, self.updated = preds, anomalies, now

    def tick(self, scada, now: float):
        self.sample(scada, now)
        self.evaluate(scada.registry, now)

    # --- фоновый цикл -----------------------------------------------------------------------------
    async def start(self):
        if os.environ.get("AI_MODE") == "off":
            self.status = "off"
            return
        from ..scada import runtime as scada_rt
        if scada_rt.rt.scada is None:
            self.status, self.error = "off", "SCADA не запущена — сигналов для моделей нет"
            return
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, self.train, scada_rt.rt.scada.registry)
        self.task = loop.create_task(self._loop())

    async def _loop(self):
        from ..scada import runtime as scada_rt
        while True:
            await asyncio.sleep(TICK_S)
            try:
                if scada_rt.rt.scada is not None:
                    self.tick(scada_rt.rt.scada, time.time())
            except Exception:
                log.exception("Цикл ИИ")

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    # --- снимки для API ---------------------------------------------------------------------------
    def signals(self) -> dict:
        with self.lock:
            return {"series": sum(1 for b in self.buf.values() if b), "points": sum(len(b) for b in self.buf.values()),
                    "running": sum(1 for v in self.was_on.values() if v)}

    def snapshot(self) -> dict:
        with self.lock:
            return {"status": self.status, "error": self.error, "updated": self.updated,
                    "predictions": list(self.predictions), "anomalies": list(self.anomalies)}

    def current_values(self, scada, cid: str) -> tuple[dict, dict]:
        c = scada.registry.controllers[cid]
        values = {p.id: scada.v(cid, f"Status.Parameter.{p.id}") for p in c.params}
        sps = {p.id: scada.v(cid, f"Status.Setpoint.{p.id}") for p in c.params if p.sp}
        return values, sps


_engine: Engine | None = None


def default() -> Engine:
    global _engine
    if _engine is None:
        _engine = Engine()
    return _engine
