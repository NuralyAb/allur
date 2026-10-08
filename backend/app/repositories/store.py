"""Хранилище производственных данных (SQLite).

Все источники — файл кейса, выгрузки MES/1С в XLSX, симулятор линии, в будущем коннекторы OPC UA/MQTT —
пишут в одни и те же четыре таблицы. Расчёты KPI и решений читают только отсюда.
"""
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

TABLES = {
    "lines": ("date", "line", "area", "plan", "fact", "hours", "load"),
    "downtime": ("date", "area", "equipment", "reason", "minutes"),
    "quality": ("date", "area", "output", "defects"),
    "monthPlan": ("model", "plan"),
}
# таблицы с датой: при слиянии даты из нового пакета заменяют уже сохранённые
DATED = ("lines", "downtime", "quality")

from ..config import TWIN_DB as DEFAULT_DB


class Store:
    def __init__(self, path: str | Path = DEFAULT_DB):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self.version = 0
        with self._lock, self._db:
            for name, cols in TABLES.items():
                self._db.execute(f'CREATE TABLE IF NOT EXISTS "{name}" ({", ".join(cols)})')
            self._db.execute("CREATE TABLE IF NOT EXISTS meta (key PRIMARY KEY, value)")

    def empty(self) -> bool:
        with self._lock:
            return self._db.execute('SELECT COUNT(*) FROM "lines"').fetchone()[0] == 0

    def dataset(self) -> dict:
        with self._lock:
            ds = {name: [dict(r) for r in self._db.execute(f'SELECT * FROM "{name}" ORDER BY rowid')]
                  for name in TABLES}
            meta = dict(self._db.execute("SELECT key, value FROM meta").fetchall())
        ds["source"] = meta.get("source", "—")
        ds["updatedAt"] = meta.get("updatedAt")
        return ds

    def write(self, batch: dict, source: str, mode: str = "merge") -> dict:
        """Записать пакет. replace — очистить всё; merge — даты из пакета заменяют такие же даты в хранилище."""
        counts = {}
        with self._lock, self._db:
            for name, cols in TABLES.items():
                rows = batch.get(name) or []
                if mode == "replace":
                    self._db.execute(f'DELETE FROM "{name}"')
                elif rows and name in DATED:
                    dates = sorted({r["date"] for r in rows})
                    self._db.execute(f'DELETE FROM "{name}" WHERE date IN ({",".join("?" * len(dates))})', dates)
                elif rows:
                    self._db.execute(f'DELETE FROM "{name}"')
                self._db.executemany(
                    f'INSERT INTO "{name}" VALUES ({",".join("?" * len(cols))})',
                    [tuple(r[c] for c in cols) for r in rows],
                )
                counts[name] = len(rows)
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            self._db.executemany("INSERT OR REPLACE INTO meta VALUES (?, ?)", [("source", source), ("updatedAt", now)])
            self.version += 1
        return counts


_default: Store | None = None


def default() -> Store:
    global _default
    if _default is None:
        _default = Store()
    return _default
