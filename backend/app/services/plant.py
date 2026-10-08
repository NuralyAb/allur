"""Паспорт завода: система координат главного корпуса и производственные зоны.

Контур корпуса и территории — OpenStreetMap (см. tools/build_site.py).
Состав цехов и технологические факты — открытые источники (ссылки в SOURCES).
Расстановка цехов внутри корпуса — по карте-схеме источников выбросов из проекта
нормативов допустимых выбросов (НДВ) ТОО «СарыаркаАвтоПром», 2022 (ecoportal.kz):
у каждого источника указан цех и координаты; карта привязана к спутниковому снимку,
точность ≈10–15 м. Цеха без выбросов (склад, ОТК, буфер) размещены по технологической логике.
"""
import json
import math
from functools import lru_cache

from ..config import DATA_DIR as DATA

SOURCES = {
    "nur": {
        "title": "nur.kz — Мелкоузловая сборка и высокоточные испытания на заводе Allur",
        "url": "https://www.nur.kz/nurfin/economy/2126985-melkouzlovaya-sborka-i-vysokotochnye-ispytaniya-kak-vypuskayut-legkovye-avtomobili-na-avtomobilnom-zavode-allur/",
    },
    "nur_special": {
        "title": "nur.kz — От импорта к локализации: как Allur повышает качество",
        "url": "https://special.nur.kz/madeinkz-allur",
    },
    "tengri_robots": {
        "title": "Tengrinews — Новые роботы на автозаводе Allur (лазерная сварка)",
        "url": "https://tengrinews.kz/kazakhstan_news/novyie-robotyi-poyavilis-avtomobilnom-zavode-allur-kostanae-516740/",
    },
    "wiki": {"title": "Википедия — Allur", "url": "https://ru.wikipedia.org/wiki/Allur"},
    "osm": {"title": "OpenStreetMap — way 164635123 (корпус Allur)", "url": "https://www.openstreetmap.org/way/164635123"},
    "ndv": {
        "title": "Проект НДВ ТОО «СарыаркаАвтоПром», 2022 — карта-схема источников выбросов (прил. 2)",
        "url": "https://ecoportal.kz/Public/PubHearings/PublicHearingDetail?hearingId=8996",
    },
}

PLANT = {
    "name": "Автомобильный завод Allur",
    "address": "Костанай, ул. Промышленная, 41",
    "facts": [
        {"label": "Территория", "value": "≈356 тыс. м²", "source": "wiki"},
        {"label": "Производственные площади", "value": "86–104 тыс. м²", "source": "nur"},
        {"label": "Главный корпус (OSM)", "value": "360 × 227 м, 85 197 м²", "source": "osm"},
        {"label": "Мощность", "value": "до 125 000 авто/год", "source": "wiki"},
        {"label": "Выпуск", "value": "до 400 авто/сутки", "source": "tengri_robots"},
        {"label": "Персонал завода", "value": "≈3 500 человек", "source": "nur_special"},
    ],
}


@lru_cache
def site() -> dict:
    return json.loads((DATA / "site.json").read_text(encoding="utf-8"))


@lru_cache
def hall_frame() -> dict:
    """Локальная система корпуса: u — вдоль длинной стены (W→S угол), v — поперёк (SW→NE).

    Начало — западный угол корпуса. Угол — направление оси u в мировых
    координатах (x на восток, y на север).
    """
    hall = site()["hall"]
    w = hall[0]  # западный угол
    s = hall[-1]  # южный угол
    n = hall[1]  # северный угол
    du = (s[0] - w[0], s[1] - w[1])
    length = math.hypot(*du)
    ux, uy = du[0] / length, du[1] / length
    vx, vy = -uy, ux
    width = (n[0] - w[0]) * vx + (n[1] - w[1]) * vy
    return {
        "origin": w,
        "angle": math.atan2(uy, ux),
        "length": round(length, 1),
        "width": round(width, 1),
        "height": 14.0,
    }


# Прямоугольники зон в координатах корпуса (u0, u1, v0, v1), метры.
# basis: "ndv" — положение подтверждено картой-схемой проекта НДВ; "logic" — по технологической логике.
ZONES = [
    {
        "id": "ckd",
        "name": "Склад CKD-комплектов",
        "short": "Склад",
        "rect": [60, 200, 195, 227],
        "color": "#4f8cff",
        "kpiArea": None,
        "basis": "logic",
        "description": "Приёмка машинокомплектов и подача на линии. Пристройка со светлой кровлей вдоль "
        "северо-восточной стены — со стороны контейнерного терминала. Два склада вмещают около 500 комплектов.",
        "facts": [
            {"label": "Ёмкость складов", "value": "≈500 машинокомплектов", "source": "nur"},
            {"label": "Поставка", "value": "морские контейнеры, ж/д ветка", "source": "osm"},
        ],
    },
    {
        "id": "welding",
        "name": "Цех сварки кузовов (ЦСК)",
        "short": "Сварка",
        "rect": [60, 155, 5, 80],
        "color": "#ff8a3d",
        "kpiArea": "Сварка",
        "basis": "ndv",
        "description": "Сварочные линии по моделям: кузов ≈90 деталей, около 3 000 сварочных точек. "
        "На линии Chevrolet Onix крыша приваривается лазером восемью роботами. В конце — рихтовка и контроль геометрии.",
        "facts": [
            {"label": "Положение", "value": "источники 0001–0007", "source": "ndv"},
            {"label": "Сварочных линий", "value": "4 (по одной на модель)", "source": "nur"},
            {"label": "Сварочных точек на кузов", "value": "≈3 000", "source": "nur_special"},
            {"label": "Лазерная сварка крыши Onix", "value": "8 роботов, впервые в РК", "source": "tengri_robots"},
        ],
    },
    {
        "id": "paint",
        "name": "Цех окраски кузовов (ЦОК)",
        "short": "Окраска",
        "rect": [248, 330, 90, 202],
        "color": "#22c3a6",
        "kpiArea": "Окраска",
        "basis": "ndv",
        "description": "Подготовка поверхности в 13 ваннах, 10-я — катафорез (печь ED). Герметизация, "
        "печи вторичного грунта, базы и лака, роботизированная окраска.",
        "facts": [
            {"label": "Положение", "value": "источники 0013–0022", "source": "ndv"},
            {"label": "Печи по НДВ", "value": "ED, УГД, USB, грунт, база+лак", "source": "ndv"},
            {"label": "Ванн подготовки", "value": "13, №10 — катафорез", "source": "nur"},
            {"label": "Цветов в гамме", "value": "5", "source": "nur"},
        ],
    },
    {
        "id": "plastic",
        "name": "Цех окраски пластика",
        "short": "Пластик",
        "rect": [220, 244, 95, 152],
        "color": "#38bdf8",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Роботизированная окраска бамперов и пластиковых деталей, сушильная камера.",
        "facts": [
            {"label": "Положение", "value": "источники 0023–0024", "source": "ndv"},
            {"label": "Роботов", "value": "6", "source": "nur"},
            {"label": "Мощность", "value": "≈6 000 комплектов/год", "source": "nur"},
        ],
    },
    {
        "id": "pbs",
        "name": "Буфер окрашенных кузовов",
        "short": "Буфер",
        "rect": [300, 356, 10, 85],
        "color": "#94a3b8",
        "kpiArea": None,
        "basis": "logic",
        "description": "Накопитель окрашенных кузовов на выходе из окраски: сглаживает разницу темпов цехов.",
        "facts": [],
    },
    {
        "id": "assembly",
        "name": "Цех сборки (Chevrolet, Kia)",
        "short": "Сборка",
        "rect": [62, 215, 86, 190],
        "color": "#facc15",
        "kpiArea": "Сборка",
        "basis": "ndv",
        "description": "Сборочные линии в центре корпуса: салон, проводка, стёкла, «свадьба» кузова с силовым "
        "агрегатом, колёса. В конце линий — ТРК заправки топливом (источники НДВ). Главный конвейер — 59 постов.",
        "facts": [
            {"label": "Положение", "value": "источники 0043–0046 (ТРК)", "source": "ndv"},
            {"label": "Рабочих постов", "value": "59", "source": "nur_special"},
        ],
    },
    {
        "id": "qc",
        "name": "Контроль качества (ОТК)",
        "short": "ОТК",
        "rect": [160, 245, 5, 80],
        "color": "#f472b6",
        "kpiArea": None,
        "basis": "logic",
        "description": "Сход-развал, регулировка фар, тормозной стенд, дождевальная камера (герметичность) "
        "и световой туннель финальной инспекции — сразу после окончания сборочных линий.",
        "facts": [
            {"label": "Испытания", "value": "герметичность, тормоза, управляемость", "source": "nur_special"},
        ],
    },
    {
        "id": "cud",
        "name": "Цех устранения дефектов (ЦУД)",
        "short": "ЦУД",
        "rect": [2, 55, 108, 136],
        "color": "#fb923c",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Доработка автомобилей с замечаниями ОТК: ремонтные посты, окрасочная и сушильные камеры.",
        "facts": [{"label": "Положение", "value": "источники 0008–0012", "source": "ndv"}],
    },
    {
        "id": "small_parts",
        "name": "Мелкоузловая сборка (ЦМУС, ЦМУС-2)",
        "short": "Мелкие узлы",
        "rect": [2, 55, 138, 190],
        "color": "#a78bfa",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Два цеха мелкоузловой сборки: сварка и окраска узлов кузова из локальных деталей.",
        "facts": [
            {"label": "Положение", "value": "источники 0025–0027, 0031–0033", "source": "ndv"},
            {"label": "Операций на модель", "value": "800–1 400", "source": "nur"},
        ],
    },
    {
        "id": "cskt",
        "name": "Цех сборки коммерческой техники (ЦСКТ)",
        "short": "ЦСКТ",
        "rect": [2, 55, 76, 106],
        "color": "#84cc16",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Сборка коммерческих автомобилей и шасси на отдельной линии.",
        "facts": [{"label": "Положение", "value": "источники 0028–0030", "source": "ndv"}],
    },
    {
        "id": "ric",
        "name": "Ремонтно-инструментальный цех и лаборатория",
        "short": "РИЦ",
        "rect": [196, 246, 160, 200],
        "color": "#e879f9",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Металлообработка и ремонт оснастки (РИЦ), центральная заводская лаборатория.",
        "facts": [{"label": "Положение", "value": "источники 0035–0037, 0047–0048", "source": "ndv"}],
    },
    {
        "id": "boiler",
        "name": "Котельная",
        "short": "Котельная",
        "rect": [165, 360, -24, 0],
        "color": "#cbd5e1",
        "kpiArea": None,
        "basis": "ndv",
        "description": "Пристройка вдоль юго-западной стены: котельная (четыре дымовые трубы по проекту НДВ).",
        "facts": [{"label": "Положение", "value": "источники 0038–0041", "source": "ndv"}],
    },
]

# Открытые площадки: центр (x, y) в мировых метрах, размеры вдоль/поперёк оси корпуса.
OUTDOOR = [
    {
        "id": "containers",
        "name": "Контейнерный терминал CKD",
        "short": "Контейнеры",
        "center": [-70, 345],
        "size": [300, 105],
        "color": "#60a5fa",
        "description": "Морские контейнеры с машинокомплектами поступают по ж/д ветке и автотранспортом.",
        "facts": [],
    },
    {
        "id": "finished",
        "name": "Площадка готовой продукции",
        "short": "Готовые авто",
        "center": [240, 290],
        "size": [210, 110],
        "color": "#4ade80",
        "description": "Отгрузочная площадка готовых автомобилей перед отправкой дилерам.",
        "facts": [],
    },
    {
        "id": "testtrack",
        "name": "Испытательная площадка",
        "short": "Полигон",
        "center": [-168, 305],
        "size": [95, 60],
        "color": "#fb7185",
        "description": "Проверка управляемости и тормозов, имитация дорожных покрытий и экстренных ситуаций.",
        "facts": [
            {"label": "Испытания", "value": "покрытия, экстренные ситуации", "source": "nur"},
        ],
    },
]


def plant() -> dict:
    return {**PLANT, "hall": hall_frame(), "zones": ZONES, "outdoor": OUTDOOR, "sources": SOURCES}
