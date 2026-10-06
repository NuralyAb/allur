import type { Vector3 } from 'three'
import type { HallFrame } from '../types'
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
    text: 'Главный корпус — 360 × 227 м, ≈85 тыс. м² (контур из OpenStreetMap). Мощность — до 125 000 автомобилей в год.',
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
    text: 'Контейнеры разгружают через доковые шлюзы в торце корпуса. Два склада вмещают около 500 машинокомплектов.',
    zone: 'ckd',
    roof: false,
    camera: { hall: [70, 70, 38] },
    target: { hall: [20, 120, 0] },
  },
  {
    title: 'Мелкоузловая сборка',
    text: 'Сварка мелких узлов кузова: от 800 до 1 400 операций на модель. Участок запущен в 2023 году.',
    zone: 'small_parts',
    roof: false,
    camera: { hall: [120, 72, 22] },
    target: { hall: [95, 25, 0] },
  },
  {
    title: 'Цех сварки кузовов',
    text: 'Четыре сварочные линии, по одной на модель. Кузов собирают из ~90 деталей, около 3 000 сварочных точек.',
    zone: 'welding',
    roof: false,
    camera: { hall: [40, 40, 45] },
    target: { hall: [105, 140, 0] },
  },
  {
    title: 'Лазерная сварка крыши Chevrolet Onix',
    text: 'Восемь роботов приваривают крышу лазером. Это первая такая установка в Казахстане.',
    zone: 'welding',
    roof: false,
    camera: { hall: [100, 176, 13] },
    target: { hall: [112, 200, 1] },
  },
  {
    title: 'Контроль геометрии',
    text: 'В конце линии кузов рихтуют и проверяют лазерным сканером на соответствие геометрии.',
    zone: 'welding',
    roof: false,
    camera: { hall: [130, 102, 14] },
    target: { hall: [144, 140, 1] },
  },
  {
    title: 'Подготовка поверхности: 13 ванн',
    text: 'Кузов последовательно окунают в 13 ванн. Ключевая — 10-я: катодное электроосаждение грунта (катафорез).',
    zone: 'paint',
    roof: false,
    camera: { hall: [205, 188, 16] },
    target: { hall: [225, 212, 0] },
  },
  {
    title: 'Роботизированная окраска',
    text: 'Роботы наносят грунт, базовую эмаль (5 цветов гаммы) и лак. После этого — сушка в печи.',
    zone: 'paint',
    roof: false,
    camera: { hall: [196, 125, 13] },
    target: { hall: [214, 145, 1] },
  },
  {
    title: 'Окраска пластиковых деталей',
    text: 'Шесть роботов окрашивают бамперы и пластиковые детали — около 6 000 комплектов в год.',
    zone: 'plastic',
    roof: false,
    camera: { hall: [175, 60, 18] },
    target: { hall: [190, 25, 0] },
  },
  {
    title: 'Главный конвейер — 59 постов',
    text: 'Салон и проводка, подвесной конвейер со стёклами, «свадьба» кузова с силовым агрегатом, колёса, заправка.',
    zone: 'assembly',
    roof: false,
    camera: { hall: [250, 110, 42] },
    target: { hall: [292, 45, 0] },
  },
  {
    title: 'Пост крупным планом',
    text: 'Темп конвейера задаёт ритм всего завода: до 400 автомобилей в сутки.',
    zone: 'assembly',
    roof: false,
    camera: { hall: [262, 34, 5] },
    target: { hall: [280, 46, 1.5] },
  },
  {
    title: 'Контроль качества',
    text: 'Сход-развал, фары, тормозной стенд, дождевальная камера и световой туннель — каждая машина проходит все посты.',
    zone: 'qc',
    roof: false,
    camera: { hall: [262, 130, 36] },
    target: { hall: [315, 165, 0] },
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
    text: 'Автомобили выезжают из ворот ОТК на площадку отгрузки дилерам.',
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
