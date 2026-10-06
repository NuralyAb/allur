"""Паспорт завода: система координат главного корпуса и производственные зоны.

Контур корпуса и территории — OpenStreetMap (см. tools/build_site.py).
Состав цехов и технологические факты — открытые источники (ссылки в SOURCES).
Внутренняя расстановка цехов — реконструкция по технологическому потоку:
поэтажный план завода публично не опубликован.
"""
import json
import math
import pathlib
from functools import lru_cache

DATA = pathlib.Path(__file__).parent / "data"

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
ZONES = [
    {
        "id": "ckd",
        "name": "Склад CKD-комплектов",
        "short": "Склад",
        "rect": [0, 48, 0, 227],
        "color": "#4f8cff",
        "kpiArea": None,
        "description": "Приёмка машинокомплектов из контейнерного терминала, хранение и подача на линии. "
        "Два склада вмещают порядка 500 комплектов.",
        "facts": [
            {"label": "Ёмкость складов", "value": "≈500 машинокомплектов", "source": "nur"},
            {"label": "Поставка", "value": "морские контейнеры, ж/д ветка", "source": "osm"},
        ],
    },
    {
        "id": "small_parts",
        "name": "Участок мелкоузловой сборки",
        "short": "Мелкие узлы",
        "rect": [52, 150, 0, 52],
        "color": "#a78bfa",
        "kpiArea": None,
        "description": "Сварка мелких узлов кузова из локальных деталей. Запущен в начале 2023 года.",
        "facts": [
            {"label": "Запуск", "value": "начало 2023 г.", "source": "nur"},
            {"label": "Операций на модель", "value": "800–1 400", "source": "nur"},
        ],
    },
    {
        "id": "welding",
        "name": "Цех сварки кузовов",
        "short": "Сварка",
        "rect": [52, 155, 58, 227],
        "color": "#ff8a3d",
        "kpiArea": "Сварка",
        "description": "Четыре сварочные линии — по одной на модель. Кузов собирается из ~90 деталей, "
        "около 3 000 сварочных точек. На линии Chevrolet Onix крыша приваривается лазером восемью роботами. "
        "В конце линии — рихтовка и лазерный контроль геометрии.",
        "facts": [
            {"label": "Сварочных линий", "value": "4 (по одной на модель)", "source": "nur"},
            {"label": "Сварочных точек на кузов", "value": "≈3 000", "source": "nur_special"},
            {"label": "Лазерная сварка крыши Onix", "value": "8 роботов, впервые в РК", "source": "tengri_robots"},
        ],
    },
    {
        "id": "paint",
        "name": "Цех окраски кузовов",
        "short": "Окраска",
        "rect": [160, 268, 100, 227],
        "color": "#22c3a6",
        "kpiArea": "Окраска",
        "description": "Подготовка поверхности и антикоррозийная обработка в 13 ваннах, ключевая — 10-я "
        "(катафорезный грунт). Далее герметизация, грунт, базовая эмаль, лак и сушка. Окраска — роботами.",
        "facts": [
            {"label": "Ванн подготовки", "value": "13, №10 — катафорез", "source": "nur"},
            {"label": "Цветов в гамме", "value": "5", "source": "nur"},
        ],
    },
    {
        "id": "plastic",
        "name": "Окраска пластиковых деталей",
        "short": "Пластик",
        "rect": [160, 222, 0, 52],
        "color": "#38bdf8",
        "kpiArea": None,
        "description": "Роботизированная окраска бамперов и пластиковых деталей.",
        "facts": [
            {"label": "Роботов", "value": "6", "source": "nur"},
            {"label": "Мощность", "value": "≈6 000 комплектов/год", "source": "nur"},
        ],
    },
    {
        "id": "pbs",
        "name": "Буфер окрашенных кузовов",
        "short": "Буфер",
        "rect": [160, 222, 56, 96],
        "color": "#94a3b8",
        "kpiArea": None,
        "description": "Накопитель окрашенных кузовов между окраской и сборкой: сглаживает разницу темпов цехов.",
        "facts": [],
    },
    {
        "id": "assembly",
        "name": "Цех сборки",
        "short": "Сборка",
        "rect": [226, 356, 0, 95],
        "color": "#facc15",
        "kpiArea": "Сборка",
        "description": "Главный конвейер из 59 рабочих постов: салон, проводка, стёкла, «свадьба» кузова "
        "с шасси, колёса, заправка технологическими жидкостями.",
        "facts": [{"label": "Рабочих постов", "value": "59", "source": "nur_special"}],
    },
    {
        "id": "qc",
        "name": "Контроль качества (ОТК)",
        "short": "ОТК",
        "rect": [272, 356, 100, 227],
        "color": "#f472b6",
        "kpiArea": None,
        "description": "Сход-развал, регулировка фар, роликовый тормозной стенд, дождевальная камера "
        "(проверка герметичности) и световой туннель финальной инспекции.",
        "facts": [
            {"label": "Испытания", "value": "герметичность, тормоза, управляемость", "source": "nur_special"},
        ],
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
