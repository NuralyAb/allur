"""Настройки двойника, которые меняет администратор: цели, допущения расчётов, сцена по умолчанию,
правки паспорта завода. Хранятся в таблице settings; отсутствующее значение — из DEFAULTS.
"""
import re
from copy import deepcopy

from ..repositories import store

DEFAULT_TARGETS = {
    "oee": 85.0,  # %, не менее
    "defect": 2.0,  # %, не более
    "downtime_critical": 60,  # мин/сутки на единицу критического оборудования
    "monthly_output": 5500,  # авто/месяц, не менее
    "shifts": 2,
}
DEFAULTS = {
    "targets": DEFAULT_TARGETS,
    "calc": {
        "workDays": 21,  # рабочих дней в месяце прогноза
        "predictiveCut": 0.5,  # доля внеплановых простоев, которые предотвращает предиктивное обслуживание
        "windowDays": 7,  # сколько последних дней данных задают темп участков
        "marginKzt": 0,  # маржинальный доход на автомобиль; 0 — не задан
    },
    "scene": {"mood": "day", "detailed": True, "labels": False, "roof": True},
}
# что администратор может править в паспорте завода
ZONE_FIELDS = ("name", "short", "rect", "color", "kpiArea", "description")
OUTDOOR_FIELDS = ("name", "short", "center", "size", "color", "description")
KPI_AREAS = (None, "Сварка", "Окраска", "Сборка")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

RANGES = {
    ("targets", "oee"): (1, 100), ("targets", "defect"): (0, 100), ("targets", "downtime_critical"): (1, 1440),
    ("targets", "monthly_output"): (1, 100_000), ("targets", "shifts"): (1, 3),
    ("calc", "workDays"): (1, 31), ("calc", "predictiveCut"): (0, 1), ("calc", "windowDays"): (1, 90),
    ("calc", "marginKzt"): (0, 100_000_000),
}
INTS = {("targets", "downtime_critical"), ("targets", "monthly_output"), ("targets", "shifts"), ("calc", "workDays"), ("calc", "windowDays")}


class Invalid(ValueError):
    pass


def _store(st: store.Store | None) -> store.Store:
    return st or store.default()


def current(st: store.Store | None = None) -> dict:
    """Все секции с подстановкой значений по умолчанию."""
    saved = _store(st).settings_all()
    out = deepcopy(DEFAULTS)
    for section, values in saved.items():
        if section in out and isinstance(values, dict):
            out[section].update({k: v for k, v in values.items() if k in out[section]})
    return out


def targets(st: store.Store | None = None) -> dict:
    return current(st)["targets"]


def calc(st: store.Store | None = None) -> dict:
    return current(st)["calc"]


def scene(st: store.Store | None = None) -> dict:
    return current(st)["scene"]


def _check_number(section: str, key: str, value) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Invalid(f"{section}.{key}: нужно число")
    lo, hi = RANGES[(section, key)]
    if not lo <= value <= hi:
        raise Invalid(f"{section}.{key}: допустимо от {lo:g} до {hi:g}")
    return int(value) if (section, key) in INTS else float(value)


def update(patch: dict, st: store.Store | None = None) -> dict:
    """Проверить и сохранить изменённые поля секций targets, calc, scene. Возвращает актуальные настройки."""
    st = _store(st)
    cur = current(st)
    for section, values in patch.items():
        if section not in DEFAULTS or not isinstance(values, dict):
            raise Invalid(f"Неизвестная секция «{section}»")
        merged = dict(cur[section])
        for key, value in values.items():
            if key not in DEFAULTS[section]:
                raise Invalid(f"Неизвестное поле {section}.{key}")
            if (section, key) in RANGES:
                merged[key] = _check_number(section, key, value)
            elif key == "mood":
                if value not in ("day", "sunset"):
                    raise Invalid("scene.mood: day или sunset")
                merged[key] = value
            else:
                if not isinstance(value, bool):
                    raise Invalid(f"{section}.{key}: нужно true/false")
                merged[key] = value
        st.set_setting(section, merged)
    return current(st)


def reset(section: str | None = None, st: store.Store | None = None) -> dict:
    st = _store(st)
    for name in ([section] if section else list(DEFAULTS)):
        if name not in DEFAULTS:
            raise Invalid(f"Неизвестная секция «{name}»")
        st.delete_setting(name)
    return current(st)


# --- паспорт завода -------------------------------------------------------------------------------

def plant_overrides(st: store.Store | None = None) -> dict:
    return _store(st).setting("plant") or {}


def _check_text(name: str, value, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Invalid(f"{name}: текст до {limit} символов")
    return value.strip()


def _check_numbers(name: str, value, count: int, lo: float, hi: float) -> list[float]:
    if not isinstance(value, list) or len(value) != count or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in value):
        raise Invalid(f"{name}: нужно {count} числа")
    if any(not lo <= v <= hi for v in value):
        raise Invalid(f"{name}: значения от {lo:g} до {hi:g}")
    return [float(v) for v in value]


def update_plant(patch: dict, hall: dict, zone_ids: set[str], outdoor_ids: set[str], st: store.Store | None = None) -> dict:
    """Сохранить правки паспорта: name, address, facts, zones{id: поля}, outdoor{id: поля}. Пустое значение поля снимает правку."""
    st = _store(st)
    cur = plant_overrides(st)
    for key in ("name", "address"):
        if key in patch:
            if patch[key] in (None, ""):
                cur.pop(key, None)
            else:
                cur[key] = _check_text(key, patch[key], 120)
    if "facts" in patch:
        facts = patch["facts"]
        if facts is None:
            cur.pop("facts", None)
        else:
            if not isinstance(facts, list) or len(facts) > 12:
                raise Invalid("facts: список до 12 фактов")
            cur["facts"] = [{"label": _check_text("facts.label", f.get("label"), 60), "value": _check_text("facts.value", f.get("value"), 120),
                             **({"source": f["source"]} if isinstance(f.get("source"), str) and f["source"] else {})} for f in facts]
    for group, ids, fields in (("zones", zone_ids, ZONE_FIELDS), ("outdoor", outdoor_ids, OUTDOOR_FIELDS)):
        for zone_id, values in (patch.get(group) or {}).items():
            if zone_id not in ids:
                raise Invalid(f"{group}: неизвестный участок «{zone_id}»")
            if not isinstance(values, dict):
                raise Invalid(f"{group}.{zone_id}: нужен объект полей")
            entry = dict(cur.get(group, {}).get(zone_id, {}))
            for field, value in values.items():
                if field not in fields:
                    raise Invalid(f"{group}.{zone_id}: поле «{field}» не редактируется")
                if value is None or value == "":
                    entry.pop(field, None)
                    continue
                if field in ("name", "short", "description"):
                    entry[field] = _check_text(f"{group}.{zone_id}.{field}", value, 400 if field == "description" else 80)
                elif field == "color":
                    if not isinstance(value, str) or not COLOR.match(value):
                        raise Invalid(f"{group}.{zone_id}.color: цвет вида #RRGGBB")
                    entry[field] = value.lower()
                elif field == "kpiArea":
                    if value not in KPI_AREAS:
                        raise Invalid(f"{group}.{zone_id}.kpiArea: один из {', '.join(a for a in KPI_AREAS if a)}")
                    entry[field] = value
                elif field == "rect":
                    u0, u1, v0, v1 = _check_numbers(f"{group}.{zone_id}.rect", value, 4, 0, max(hall["length"], hall["width"]))
                    if not (u0 < u1 <= hall["length"] and v0 < v1 <= hall["width"]):
                        raise Invalid(f"{group}.{zone_id}.rect: u0 < u1 ≤ {hall['length']:g}, v0 < v1 ≤ {hall['width']:g}")
                    entry[field] = [u0, u1, v0, v1]
                elif field == "center":
                    entry[field] = _check_numbers(f"{group}.{zone_id}.center", value, 2, -2000, 2000)
                elif field == "size":
                    entry[field] = _check_numbers(f"{group}.{zone_id}.size", value, 2, 1, 2000)
            cur.setdefault(group, {})[zone_id] = entry
            if not entry:
                cur[group].pop(zone_id)
    cur = {k: v for k, v in cur.items() if v}
    if cur:
        st.set_setting("plant", cur)
    else:
        st.delete_setting("plant")
    return cur


def reset_plant(st: store.Store | None = None) -> None:
    _store(st).delete_setting("plant")
