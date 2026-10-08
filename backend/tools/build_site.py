"""Собирает backend/app/data/site.json из OpenStreetMap (запуск из корня: python backend/tools/build_site.py).

Источник: OSM way 164635178 (территория Allur) и здания вокруг,
ул. Промышленная, 41, Костанай. Координаты переводятся в локальные метры
(x — на восток, y — на север) относительно точки LAT0/LON0.

Запуск:  python tools/build_site.py [сохранённый_ответ_overpass.json]
"""
import json
import math
import pathlib
import sys
import urllib.parse
import urllib.request

LAT0, LON0 = 53.2485, 63.5900
BBOX = (53.2440, 63.5830, 53.2535, 63.5975)  # south, west, north, east
SITE_WAY = 164635178
HALL_WAY = 164635123
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# скрипт лежит в backend/tools, корень репозитория — на два уровня выше
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "backend" / "app" / "data" / "site.json"


def to_xy(lat: float, lon: float) -> list[float]:
    x = (lon - LON0) * 111320 * math.cos(math.radians(LAT0))
    y = (lat - LAT0) * 110540
    return [round(x, 2), round(y, 2)]


def fetch() -> dict:
    s, w, n, e = BBOX
    query = (
        f"[out:json][timeout:60];(way[\"building\"]({s},{w},{n},{e});"
        f"way({SITE_WAY}););out body geom;"
    )
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "allur-twin/1.0"})
            return json.loads(urllib.request.urlopen(req, timeout=90).read())
        except Exception as exc:  # noqa: BLE001 — пробуем следующее зеркало
            last = exc
    raise RuntimeError(f"Overpass недоступен: {last}")


def main() -> None:
    if len(sys.argv) > 1:
        osm = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        osm = fetch()
    site, hall, buildings = None, None, []
    for el in osm["elements"]:
        pts = [to_xy(p["lat"], p["lon"]) for p in el.get("geometry", [])]
        if pts and pts[0] == pts[-1]:
            pts = pts[:-1]
        tags = el.get("tags", {})
        if el["id"] == SITE_WAY:
            site = pts
        elif el["id"] == HALL_WAY:
            hall = pts
        elif "building" in tags:
            buildings.append({"id": el["id"], "name": tags.get("name", ""), "polygon": pts})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "origin": {"lat": LAT0, "lon": LON0},
                "source": "© OpenStreetMap contributors (ODbL)",
                "site": site,
                "hall": hall,
                "buildings": buildings,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"site.json: hall {len(hall)} pts, {len(buildings)} buildings")


if __name__ == "__main__":
    main()
