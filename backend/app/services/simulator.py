"""Симулятор линии: живой источник данных вместо MES/SCADA, пока нет доступа к системам завода.

Смена (480 мин) проигрывается ускоренно: за секунду проходит MINUTES_PER_TICK минут. Исход смены
разыгрывается заранее по профилю участков, затем раскрывается по ходу времени — счётчики растут,
простои начинаются и заканчиваются. В конце смены строки пишутся в хранилище тем же форматом, что импорт
файлов, поэтому KPI и центр решений пересчитываются без отдельной логики.
"""
import asyncio
import random
from datetime import date, timedelta

from ..repositories import store
from . import kpi

SHIFT_MIN = int(kpi.SHIFT_HOURS * 60)
MINUTES_PER_TICK = 20  # 480 мин смены ≈ 24 с
PLAN = 120

# оборудование участка: (ID, причина, вероятность события за смену, минимум и максимум минут)
EQUIPMENT = {
    "Сварка": [("ABB-01", "Ошибка датчика", 0.35, 10, 35), ("ABB-04", "Плановое ТО", 0.2, 30, 30),
               ("ABB-02", "Ошибка датчика", 0.15, 10, 25)],
    "Окраска": [("Камера-02", "Замена фильтра", 0.4, 30, 45), ("Камера-01", "Засор форсунки", 0.2, 15, 35)],
    "Сборка": [("Конвейер-03", "Обрыв цепи", 0.15, 30, 80), ("Гайковёрт-07", "Отказ инструмента", 0.25, 10, 25)],
}
LINE_NAMES = {"Сварка": "Сварка-1", "Окраска": "Окраска-1", "Сборка": "Сборка-1"}


class Simulator:
    def __init__(self, st: store.Store | None = None, seed: int | None = None):
        self.store = st or store.default()
        self.rng = random.Random(seed)
        self.running = False
        self.task: asyncio.Task | None = None
        self.shift: dict | None = None
        self.elapsed = 0
        # брак окраски дрейфует: двойник должен заметить ухудшение раньше, чем оно станет проблемой
        self.defect = {"Сварка": 0.022, "Окраска": 0.043, "Сборка": 0.012}

    def _next_date(self) -> str:
        dates = [r["date"] for r in self.store.dataset()["lines"]]
        d = date.fromisoformat(max(dates)) if dates else date.today()
        d += timedelta(days=1)
        while d.weekday() >= 5:  # выходные пропускаем
            d += timedelta(days=1)
        return d.isoformat()

    def plan_shift(self) -> dict:
        """Разыграть исход смены: простои с моментом начала, факт и брак по участкам."""
        rng = self.rng
        day = self._next_date()
        self.defect["Окраска"] = min(0.08, max(0.01, self.defect["Окраска"] + rng.uniform(-0.006, 0.009)))
        areas, events = {}, []
        for area, equipment in EQUIPMENT.items():
            down = 0
            for eq, reason, p, lo, hi in equipment:
                if rng.random() < p:
                    minutes = rng.randint(lo, hi)
                    start = rng.randint(30, SHIFT_MIN - minutes - 10)
                    events.append({"date": day, "area": area, "equipment": eq, "reason": reason,
                                   "minutes": minutes, "start": start})
                    down += minutes
            takt = SHIFT_MIN / PLAN
            fact = max(0, round(PLAN - down / takt - rng.uniform(0, 4)))
            defects = sum(rng.random() < self.defect[area] for _ in range(fact))
            hours = round((SHIFT_MIN - down) / 60, 1)
            areas[area] = {"fact": fact, "defects": defects, "hours": hours}
        return {"date": day, "areas": areas, "events": events}

    def progress(self) -> dict:
        """Состояние текущей смены на момент elapsed — то, что видит диспетчер."""
        if not self.shift:
            return {"running": self.running, "shift": None}
        t = self.elapsed
        active = [e for e in self.shift["events"] if e["start"] <= t < e["start"] + e["minutes"]]
        done = {}
        for area, a in self.shift["areas"].items():
            share = min(1.0, t / SHIFT_MIN)
            done[area] = {"done": round(a["fact"] * share), "defects": round(a["defects"] * share),
                          "plan": round(PLAN * share), "stopped": any(e["area"] == area for e in active)}
        return {
            "running": self.running,
            "shift": {"date": self.shift["date"], "elapsed": t, "length": SHIFT_MIN, "areas": done,
                      "active": [{k: e[k] for k in ("area", "equipment", "reason", "minutes", "start")} for e in active],
                      "finished": [{k: e[k] for k in ("area", "equipment", "reason", "minutes")}
                                   for e in self.shift["events"] if e["start"] + e["minutes"] <= t]},
        }

    def commit(self) -> None:
        s = self.shift
        lines, quality = [], []
        for area, a in s["areas"].items():
            lines.append({"date": s["date"], "line": LINE_NAMES[area], "area": area, "plan": PLAN, "fact": a["fact"],
                          "hours": a["hours"], "load": round(a["hours"] / kpi.SHIFT_HOURS * 100)})
            quality.append({"date": s["date"], "area": area, "output": a["fact"], "defects": a["defects"]})
        downtime = [{k: e[k] for k in ("date", "area", "equipment", "reason", "minutes")}
                    for e in sorted(s["events"], key=lambda e: e["start"])]
        self.store.write({"lines": lines, "quality": quality, "downtime": downtime}, source="Симулятор линии (live)")

    def step(self) -> bool:
        """Один такт симуляции. True — смена закончилась и записана."""
        if not self.shift:
            self.shift, self.elapsed = self.plan_shift(), 0
        self.elapsed += MINUTES_PER_TICK
        if self.elapsed >= SHIFT_MIN:
            self.elapsed = SHIFT_MIN
            self.commit()
            self.shift = None
            return True
        return False

    async def _run(self) -> None:
        while self.running:
            self.step()
            await asyncio.sleep(1)

    def start(self) -> None:
        if not self.running:
            self.running = True
            self.task = asyncio.get_running_loop().create_task(self._run())

    def stop(self) -> None:
        self.running = False
        self.shift = None
        if self.task:
            self.task.cancel()
            self.task = None


_sim: Simulator | None = None


def default() -> Simulator:
    global _sim
    if _sim is None:
        _sim = Simulator()
    return _sim
