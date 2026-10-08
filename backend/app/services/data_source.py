"""Источник производственных данных: откуда они сейчас, импорт выгрузок, сброс к файлу кейса."""
from ..repositories import store
from . import importers, simulator

CASE_SOURCE = f"Файл кейса · {importers.CASE_FILE.name}"


class ImportRejected(ValueError):
    """Файл не принят: список причин для пользователя."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def seed_if_empty() -> None:
    """Первый запуск: хранилище заполняется таблицами из DOCX кейса."""
    if store.default().empty():
        store.default().write(importers.case_dataset(), CASE_SOURCE, mode="replace")


def summary() -> dict:
    """Откуда данные, период, число строк в каждой таблице, идёт ли live-симулятор."""
    ds = store.default().dataset()
    dates = sorted({r["date"] for r in ds["lines"]})
    return {
        "source": ds["source"],
        "updatedAt": ds["updatedAt"],
        "version": store.default().version,
        "counts": {name: len(ds[name]) for name in store.TABLES},
        "dates": [dates[0], dates[-1]] if dates else None,
        "live": simulator.default().running,
    }


def import_file(filename: str, data: bytes, mode: str) -> dict:
    """Записать DOCX/XLSX в формате кейса. merge — даты из файла заменяют такие же даты, replace — всё заново."""
    if mode not in ("merge", "replace"):
        raise ImportRejected(["mode: merge или replace"])
    batch, errors = importers.read(filename, data)
    if errors:
        raise ImportRejected(errors)
    simulator.default().stop()
    return store.default().write(batch, f"Импорт · {filename}", mode=mode)


def reset() -> None:
    """Вернуть тестовые данные кейса."""
    simulator.default().stop()
    store.default().write(importers.case_dataset(), CASE_SOURCE, mode="replace")


def template() -> bytes:
    """XLSX-шаблон в формате кейса, заполненный текущими данными."""
    return importers.template(store.default().dataset())


def set_live(on: bool) -> None:
    sim = simulator.default()
    if on:
        sim.start()
    else:
        sim.stop()


def live_progress() -> dict:
    """Ход текущей смены симулятора и версия хранилища — одно сообщение потока событий."""
    return {**simulator.default().progress(), "version": store.default().version}
