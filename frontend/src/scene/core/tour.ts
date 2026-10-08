import type { Vector3 } from 'three'
import type { HallFrame } from '../../shared/types'
import { hallToWorld, world } from './geo'

export interface TourStop {
  title: string
  text: string
  /** зона, которая подсвечивается и открывается в панели */
  zone?: string
  /** кровля корпуса видна (внешний вид) */
  roof: boolean
  camera: Vector3
  target: Vector3
}

type Pt = { hall: [number, number, number] } | { world: [number, number, number] }

interface StopDef {
  title: string
  text: string
  zone?: string
  roof?: boolean
  camera: Pt
  target: Pt
}

/** Маршрут экскурсии по технологическому потоку: от контейнера до готового автомобиля. */
const STOPS: StopDef[] = [
  {
    title: 'Автозавод Allur, Костанай',
    text: 'Главный корпус — 360 × 227 м, ≈85 тыс. м² (контур из OpenStreetMap). Цеха расставлены по карте-схеме проекта НДВ 2022 года.',
    roof: true,
    camera: { world: [-330, -380, 330] },
    target: { world: [90, 40, 0] },
  },
  {
    title: 'Контейнерный терминал',
    text: 'Машинокомплекты CKD приходят в морских контейнерах по железнодорожной ветке и автотранспортом.',
    zone: 'containers',
    roof: true,
    camera: { world: [-210, 190, 95] },
    target: { world: [-60, 340, 0] },
  },
  {
    title: 'Склад CKD-комплектов',
    text: 'Пристройка вдоль северо-восточной стены: доки смотрят на контейнерный терминал. Около 500 машинокомплектов на хранении.',
    zone: 'ckd',
    roof: false,
    camera: { hall: [105, 150, 34] },
    target: { hall: [130, 211, 2] },
  },
  {
    title: 'Мелкоузловая сборка — ЦМУС и ЦМУС-2',
    text: 'Два цеха в северо-западном торце корпуса: сварка и окраска узлов кузова, от 800 до 1 400 операций на модель.',
    zone: 'small_parts',
    roof: false,
    camera: { hall: [80, 150, 26] },
    target: { hall: [28, 164, 0] },
  },
  {
    title: 'Цех сварки кузовов',
    text: 'У юго-западной стены — сварочные линии по моделям. Кузов собирают из ~90 деталей, около 3 000 сварочных точек.',
    zone: 'welding',
    roof: false,
    camera: { hall: [150, 110, 42] },
    target: { hall: [100, 40, 0] },
  },
  {
    title: 'Лазерная сварка крыши Chevrolet Onix',
    text: 'Восемь роботов приваривают крышу лазером. Это первая такая установка в Казахстане.',
    zone: 'welding',
    roof: false,
    camera: { hall: [110, 92, 13] },
    target: { hall: [122, 68, 1] },
  },
  {
    title: 'Контроль геометрии',
    text: 'В конце линии кузов рихтуют и проверяют лазерным сканером на соответствие геометрии.',
    zone: 'welding',
    roof: false,
    camera: { hall: [166, 62, 14] },
    target: { hall: [150, 42, 1] },
  },
  {
    title: 'Цех окраски: 13 ванн',
    text: 'Кузов последовательно окунают в 13 ванн. Ключевая — 10-я: катодное электроосаждение грунта, за ней печь ED.',
    zone: 'paint',
    roof: false,
    camera: { hall: [238, 140, 18] },
    target: { hall: [258, 160, 0] },
  },
  {
    title: 'Роботизированная окраска',
    text: 'Роботы наносят грунт, базовую эмаль (5 цветов гаммы) и лак. По проекту НДВ — печи вторичного грунта, базы и лака.',
    zone: 'paint',
    roof: false,
    camera: { hall: [274, 128, 12] },
    target: { hall: [290, 146, 1] },
  },
  {
    title: 'Цех окраски пластика',
    text: 'Рядом с окраской кузовов: шесть роботов окрашивают бамперы и пластиковые детали — около 6 000 комплектов в год.',
    zone: 'plastic',
    roof: false,
    camera: { hall: [205, 108, 18] },
    target: { hall: [232, 124, 0] },
  },
  {
    title: 'Сборочные линии',
    text: 'В центре корпуса — 59 постов: салон и проводка, подвесной конвейер со стёклами, «свадьба» кузова с агрегатом, колёса.',
    zone: 'assembly',
    roof: false,
    camera: { hall: [150, 62, 42] },
    target: { hall: [136, 122, 0] },
  },
  {
    title: 'Пост крупным планом',
    text: 'В конце линий — ТРК заправки топливом: по ним в проекте НДВ видно, где заканчиваются линии Chevrolet и Kia.',
    zone: 'assembly',
    roof: false,
    camera: { hall: [182, 84, 6] },
    target: { hall: [198, 98, 1.5] },
  },
  {
    title: 'Контроль качества',
    text: 'Сход-развал, фары, тормозной стенд, дождевальная камера и световой туннель — каждая машина проходит все посты.',
    zone: 'qc',
    roof: false,
    camera: { hall: [180, 100, 36] },
    target: { hall: [205, 45, 0] },
  },
  {
    title: 'ЦУД и коммерческая техника',
    text: 'В северо-западном торце — цех устранения дефектов с окрасочной камерой и линия сборки коммерческой техники.',
    zone: 'cud',
    roof: false,
    camera: { hall: [80, 108, 30] },
    target: { hall: [28, 110, 0] },
  },
  {
    title: 'Испытательная площадка',
    text: 'Проверка управляемости и тормозов: имитация дорожных покрытий и экстренных ситуаций.',
    zone: 'testtrack',
    roof: true,
    camera: { world: [-255, 225, 55] },
    target: { world: [-168, 305, 0] },
  },
  {
    title: 'Готовая продукция',
    text: 'Автомобили выезжают из ворот ОТК и объезжают корпус к площадке отгрузки дилерам.',
    zone: 'finished',
    roof: true,
    camera: { world: [420, 150, 110] },
    target: { world: [240, 290, 0] },
  },
]

export function buildTour(frame: HallFrame): TourStop[] {
  const resolve = (p: Pt) => ('hall' in p ? hallToWorld(frame, p.hall[0], p.hall[1], p.hall[2]) : world(p.world[0], p.world[1], p.world[2]))
  return STOPS.map((s) => ({
    title: s.title,
    text: s.text,
    zone: s.zone,
    roof: s.roof ?? true,
    camera: resolve(s.camera),
    target: resolve(s.target),
  }))
}
