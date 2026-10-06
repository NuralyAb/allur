# Allur — цифровой двойник автомобильного завода

Кейс №2 Qostanai Industry Hackathon (АО «Группа компаний АЛЛЮР»).
Интерактивная 3D-модель завода Allur в Костанае (ул. Промышленная, 41) с экскурсией по технологическому потоку
и показателями производства.

## Что внутри

- **Реальная площадка.** Контур главного корпуса (360 × 227 м, 85 197 м²) и соседние здания взяты из
  OpenStreetMap, земля — спутниковый снимок Esri World Imagery. Корпус, контейнерный терминал, площадка готовой
  продукции и испытательная площадка стоят там же, где на снимке.
- **Цеха по технологическому потоку:** склад CKD-комплектов → мелкоузловая сборка → 4 сварочные линии
  (лазерная сварка крыши Onix) → окраска (13 ванн, №10 — катафорез; кабины грунта, эмали, лака; печи) →
  окраска пластика (6 роботов) → буфер кузовов → главный конвейер на 59 постов → ОТК (сход-развал, фары,
  тормозной стенд, дождевальная камера, световой туннель) → площадка отгрузки.
- **Живой поток:** кузова тактово идут по сварке, окунаются в ванны, меняют цвет при окраске,
  на сборке получают стёкла и колёса, проходят ОТК и уезжают на площадку.
- **3D-экскурсия** из 15 шагов с автопереходом; прямая ссылка на шаг: `?step=5`.
- **KPI по тестовым данным кейса:** план/факт, загрузка, OEE (доступность × производительность × качество),
  брак, простои; цели — OEE ≥ 85 %, брак ≤ 2 %.

Внутренняя планировка цехов — реконструкция: поэтажный план завода не публикуется. Состав цехов и цифры
взяты из открытых источников, ссылки на них есть в карточке каждого цеха.

## Запуск

```bash
# бэкенд (FastAPI) — порт 8000
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload

# фронтенд (React + Three.js) — порт 5173, /api проксируется на бэкенд
cd frontend
npm install
npm run dev
```

Откройте http://localhost:5173. `?perf` в адресе выводит в консоль FPS и число draw calls.

## Структура

```
backend/app/
  main.py         API: /api/site, /api/plant, /api/kpi
  plant.py        система координат корпуса, зоны, факты и источники
  kpi.py          тестовые данные кейса, расчёт OEE
  data/site.json  геометрия площадки из OSM
frontend/src/
  scene/          3D: Ground, Hall, Welding, Paint, Assembly, Logistics, Outdoor, tour
  ui/             панели: KPI, список цехов, карточка цеха, экскурсия
tools/build_site.py  пересборка site.json из OpenStreetMap (Overpass API)
```

## Источники

- OpenStreetMap, way [164635123](https://www.openstreetmap.org/way/164635123) — корпус Allur; way 164635178 — территория
- [nur.kz — как выпускают автомобили на заводе Allur](https://www.nur.kz/nurfin/economy/2126985-melkouzlovaya-sborka-i-vysokotochnye-ispytaniya-kak-vypuskayut-legkovye-avtomobili-na-avtomobilnom-zavode-allur/)
- [nur.kz — От импорта к локализации](https://special.nur.kz/madeinkz-allur)
- [Tengrinews — лазерная сварка на Allur](https://tengrinews.kz/kazakhstan_news/novyie-robotyi-poyavilis-avtomobilnom-zavode-allur-kostanae-516740/)
- [Википедия — Allur](https://ru.wikipedia.org/wiki/Allur)
