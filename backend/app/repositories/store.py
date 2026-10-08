"""Хранилище производственных данных (SQLite).

Все источники — файл кейса, выгрузки MES/1С в XLSX, симулятор линии, в будущем коннекторы OPC UA/MQTT —
пишут в одни и те же четыре таблицы. Расчёты KPI и решений читают только отсюда.
"""
import json
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
            self._db.execute("CREATE TABLE IF NOT EXISTS settings (key PRIMARY KEY, value)")
            self._db.execute("CREATE TABLE IF NOT EXISTS audit (ts, user, role, action, details)")

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


    # --- настройки администратора (JSON по секциям) ---------------------------------------------

    def setting(self, key: str):
        with self._lock:
            row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def settings_all(self) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT key, value FROM settings").fetchall()
        return {k: json.loads(v) for k, v in rows}

    def set_setting(self, key: str, value) -> None:
        with self._lock, self._db:
            self._db.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, json.dumps(value, ensure_ascii=False)))
            self.version += 1  # интерфейс перечитывает показатели и решения по версии

    def delete_setting(self, key: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM settings WHERE key = ?", (key,))
            self.version += 1

    # --- аудит действий в двойнике --------------------------------------------------------------

    def audit(self, user: str, role: str, action: str, details: dict | None = None) -> None:
        with self._lock, self._db:
            self._db.execute("INSERT INTO audit VALUES (?, ?, ?, ?, ?)",
                             (datetime.now(timezone.utc).isoformat(timespec="seconds"), user, role, action, json.dumps(details or {}, ensure_ascii=False)))

    def audit_rows(self, limit: int = 200) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT rowid, ts, user, role, action, details FROM audit ORDER BY rowid DESC LIMIT ?", (limit,)).fetchall()
        return [{"id": r[0], "ts": r[1], "user": r[2], "role": r[3], "action": r[4], "details": json.loads(r[5])} for r in rows]


_default: Store | None = None


def default() -> Store:
    global _default
    if _default is None:
        _default = Store()
    return _default
