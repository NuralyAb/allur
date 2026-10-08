import type { Alert, Level } from '../../shared/types'
import { SPECS, type CarModelId } from '../../scene/vehicles/carModels'
import type { CarSelection, CarUnit, UnitPlace } from '../../scene/vehicles/carUnits'
import { formatTime, type SimulationSnapshot, type StageId } from '../simulation/types'

/*
 * Карточка машины: кто она (VIN, модель, цвет, заказ), где и в каком состоянии, сколько осталось
 * и что мешает. В сценарном режиме подключения к MES нет: VIN, заказ и сроки строятся
 * детерминированно из положения машины в сцене. В симуляции этап, очередь, отказы и прогноз
 * выхода берутся из движка.
 */

export type StepState = 'done' | 'active' | 'waiting' | 'todo' | 'issue'
export interface Issue { level: 'bad' | 'warn'; title: string; text: string }
export interface Passport {
  vin: string
  model: string
  colorName: string
  status: { level: Level | 'done' | 'neutral'; title: string; detail: string }
  /** зона или площадка — для перехода к карточке участка */
  zone: string | null
  progress: number
  released: boolean
  steps: { label: string; state: StepState; note: string }[]
  dates: { label: string; value: string; note?: string; level?: Level }[]
  issues: Issue[]
  source: string
  /** машина на месте: за ней можно следить камерой */
  live: boolean
}
/** Положение машины в сцене на этот момент (из userData её корня). */
export interface UnitLive { progress: number; station: number; cycle: number }

const COLOR_NAMES: Record<string, string> = { '#f4f5f7': 'Белый', '#1b1d22': 'Чёрный', '#a9b0b8': 'Серебристый', '#b3202a': 'Красный', '#1e4f9c': 'Синий' }
const STEPS = ['Сварка', 'Окраска', 'Сборка', 'ОТК', 'Отгрузка']
const HOUR = 3_600_000
const DAY = 24 * HOUR

/* ---------- VIN по ISO 3779: WMI · VDS · контрольный знак · год · завод · серийный номер ---------- */

const WMI = 'KZA' // условный код изготовителя: настоящий WMI завода в данных нет
const VDS: Record<CarModelId, string> = { onix: 'JN19T', cobalt: 'JC15A', j7: 'JJ715' }
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789' // 2010 = A
const TRANSLIT: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 }
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function makeVin(model: CarModelId, serial: number, year: number) {
  const raw = `${WMI}${VDS[model]}0${YEAR_CODES[(year - 2010) % 30]}K${String(serial % 1_000_000).padStart(6, '0')}`
  const sum = [...raw].reduce((acc, ch, i) => acc + (ch >= '0' && ch <= '9' ? Number(ch) : TRANSLIT[ch]) * WEIGHTS[i], 0)
  const check = sum % 11 === 10 ? 'X' : String(sum % 11)
  return raw.slice(0, 8) + check + raw.slice(9)
}

/** Детерминированное число 0–1 по строке (FNV-1a). */
function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/* ---------- даты ---------- */

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)
const hm = (ms: number) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dm = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
function dayWord(ms: number, now: number) {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY)
  return days === 0 ? 'сегодня' : days === -1 ? 'вчера' : days === 1 ? 'завтра' : dm(ms)
}
const when = (ms: number, now: number) => `${dayWord(ms, now)}, ${hm(ms)}`
/** Коротко для шкалы этапов: время — сегодня, день недели и время — в пределах недели, иначе дата. */
function short(ms: number, now: number) {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY)
  if (days === 0) return hm(ms)
  return Math.abs(days) < 7 ? `${new Date(ms).toLocaleDateString('ru-RU', { weekday: 'short' })} ${hm(ms)}` : dm(ms)
}
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many
}
const days = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`
const minutes = (n: number) => n >= 90 ? `${(n / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч` : `${Math.round(n)} мин`

/* ---------- сценарный режим ---------- */

/** Участок маршрута: этап шкалы и нормативная длительность, ч. Буфер PBS — ожидание перед сборкой. */
const SEGMENTS: { step: number; hours: number }[] = [
  { step: 0, hours: 4 }, { step: 1, hours: 7 }, { step: 2, hours: 2 }, { step: 2, hours: 7 }, { step: 3, hours: 1.5 },
]
const SEGMENT: Partial<Record<UnitPlace, number>> = { welding: 0, paint: 1, pbs: 2, assembly: 3, qc: 4, testtrack: 4 }
const ZONE: Record<UnitPlace, string | null> = { welding: 'welding', paint: 'paint', pbs: 'pbs', assembly: 'assembly', qc: 'qc', testtrack: 'testtrack', outbound: 'finished', finished: 'finished', sim: null }
const KPI_AREA: Partial<Record<UnitPlace, string>> = { welding: 'Сварка', paint: 'Окраска', assembly: 'Сборка' }
const NEXT: Partial<Record<UnitPlace, string>> = { welding: 'окраску', paint: 'буфер окрашенных кузовов', assembly: 'контроль качества', qc: 'ходовые испытания', testtrack: 'площадку отгрузки', outbound: 'площадку отгрузки' }
const DEALERS: [string, number][] = [['Алматы', 0.3], ['Астана', 0.22], ['Шымкент', 0.12], ['Караганда', 0.08], ['Актобе', 0.06], ['Костанай', 0.06], ['Усть-Каменогорск', 0.06], ['Атырау', 0.05], ['Павлодар', 0.05]]
const SERIAL_BASE: Record<UnitPlace, number> = { finished: 46000, outbound: 47400, testtrack: 47420, qc: 47430, assembly: 47460, pbs: 47540, paint: 47640, welding: 47720, sim: 48000 }

export const PAINT_STATIONS = ['Переход между участками', 'Подготовка поверхности · ванны 1–9', 'Катафорез · ванна 10', 'Промывка после катафореза',
  'Печь сушки катафореза', 'Герметизация швов', 'Кабина грунта', 'Кабина базовой эмали', 'Кабина лака', 'Печь финишной сушки', 'Контроль ЛКП']
export const QC_STATIONS = ['Переезд между постами', 'Сход-развал', 'Регулировка фар', 'Тормозной стенд', 'Дождевальная камера · герметичность', 'Световой туннель · финальная инспекция', 'Выезд из цеха']

/** Редкие отклонения по участкам — с ними машина задерживается. */
const RISKS: Partial<Record<UnitPlace, (Issue & { delay: number })[]>> = {
  welding: [{ level: 'warn', title: 'Геометрия кузова вне допуска', text: 'Контроль геометрии: проём задней двери +0,7 мм при допуске 0,5 мм. Кузов уйдёт на рихтовку.', delay: 25 }],
  paint: [{ level: 'warn', title: 'Включение в ЛКП', text: 'Сорность на капоте после кабины базовой эмали. Нужна полировка на посту доработки.', delay: 20 }],
  assembly: [{ level: 'bad', title: 'Не хватает комплектующих', text: 'Жгут проводки салона не подан из CKD-комплекта. Монтаж перенесён на конец линии.', delay: 45 }],
  qc: [
    { level: 'bad', title: 'Замечание ОТК: герметичность', text: 'Подтёк в дождевальной камере у уплотнителя крышки багажника. Машина пойдёт в цех устранения дефектов.', delay: 70 },
    { level: 'warn', title: 'Замечание ОТК: свет фар', text: 'Наклон пучка вне допуска. Повторная регулировка на посту.', delay: 15 },
  ],
}

function stationText(place: UnitPlace, station: number, line?: number) {
  switch (place) {
    case 'welding': return station >= 10 ? 'Рихтовка и контроль геометрии' : `Пост ${station} из 9 · ${line === 0 && (station === 6 || station === 7) ? 'лазерная сварка крыши' : 'точечная сварка'}`
    case 'paint': return PAINT_STATIONS[station] ?? PAINT_STATIONS[0]
    case 'assembly': return station === 0 ? 'Переход между ветками конвейера'
      : `Пост ${station} из 59 · ${station <= 20 ? 'салон и проводка' : station <= 40 ? 'стёкла, магистрали' : '«свадьба», колёса, заправка'}`
    case 'qc': return QC_STATIONS[station] ?? QC_STATIONS[0]
    case 'testtrack': return 'Испытательная площадка · тормоза и управляемость'
    case 'pbs': return 'Буфер окрашенных кузовов (PBS)'
    case 'outbound': return 'Перегон к площадке готовой продукции'
    case 'finished': return 'Площадка готовой продукции'
    default: return ''
  }
}

export function scenePassport(selection: CarSelection, live: UnitLive | null, alerts: Alert[]): Passport {
  const { unit, at } = selection
  const seed = `${unit.key}:${selection.cycle}`
  const h = (salt: string) => hash(`${seed}:${salt}`)
  const serial = SERIAL_BASE[unit.place] + (unit.line ?? 0) * 17 + unit.index + selection.cycle * 211
  let r = h('dealer')
  const dealer = DEALERS.find(([, share]) => (r -= share) < 0)?.[0] ?? DEALERS[0][0]
  // машина на следующем круге петли — уже другая: эта ушла дальше по маршруту
  const handed = !!live && live.cycle !== selection.cycle
  const shownProgress = handed ? 1 : live?.progress ?? selection.progress
  // доля участка маршрута: ОТК — 85 % его времени, полигон — остаток; в буфере PBS кузов уже отстоял своё
  const local = (p: number) => unit.place === 'testtrack' ? 0.85 + 0.15 * p : unit.place === 'qc' ? 0.85 * p : unit.place === 'pbs' ? 1 : p

  const issues: Issue[] = []
  let delay = 0
  const risks = RISKS[unit.place]
  if (risks && h('risk') < 0.07) {
    const risk = risks[Math.floor(h('which') * risks.length)]
    issues.push({ level: risk.level, title: risk.title, text: risk.text })
    delay += risk.delay
  }
  const area = KPI_AREA[unit.place]
  const stopped = alerts.filter((alert) => alert.kind === 'live' && area && alert.area === area && !handed)
  for (const alert of stopped) issues.push({ level: 'bad', title: alert.title, text: `${alert.text}. Выпуск машины сдвигается, пока участок стоит.` })

  // Длительности участков ±15 % от нормы: у каждой машины свои.
  const durations = SEGMENTS.map((s, i) => s.hours * HOUR * (0.88 + 0.27 * h(`d${i}`)))
  durations[2] = (0.4 + 2.2 * h('pbs')) * HOUR
  if (unit.place === 'pbs') durations[2] = (0.3 + 4.6 * h('pbs')) * HOUR
  const ends: number[] = []
  let releaseAt: number
  let current = SEGMENT[unit.place]
  if (current !== undefined) {
    const start = at - local(selection.progress) * durations[current]
    for (let i = current - 1, t = start; i >= 0; i--) { ends[i] = t; t -= durations[i] }
    for (let i = current, t = start; i < SEGMENTS.length; i++) { t += durations[i] + (i === current ? delay * 60_000 : 0); ends[i] = t }
    releaseAt = ends[SEGMENTS.length - 1]
  } else {
    // выпущенные: перегон идёт ~10 мин, на площадке — от нескольких часов до полутора недель
    releaseAt = unit.place === 'outbound' ? at - selection.progress * 10 * 60_000 : at - (0.15 + 9 * h('dwell') ** 1.6) * DAY
    for (let i = SEGMENTS.length - 1, t = releaseAt; i >= 0; i--) { ends[i] = t; t -= durations[i] }
    current = SEGMENTS.length
  }
  const startAt = ends[0] - durations[0]
  const released = current >= SEGMENTS.length
  const shipAt = startOfDay(releaseAt + (2 + 4 * h('ship')) * DAY) + 10 * HOUR

  // этапы шкалы: конец этапа — конец его последнего участка
  const stepEnd = (step: number) => ends[SEGMENTS.map((s) => s.step).lastIndexOf(step)]
  const currentStep = released ? 4 : SEGMENTS[current].step
  const stepOf = (i: number): StepState => {
    if (i < currentStep) return 'done'
    if (i > currentStep) return 'todo'
    // ОТК продолжается на полигоне, после перегона машина ждёт отгрузки
    if (handed) return unit.place === 'qc' ? 'active' : unit.place === 'outbound' ? 'waiting' : 'done'
    if (issues.length) return 'issue'
    return unit.place === 'pbs' || unit.place === 'finished' ? 'waiting' : 'active'
  }
  const steps = STEPS.map((label, i) => {
    const state = stepOf(i)
    const note = i === 4
      ? (unit.place === 'outbound' && !handed ? 'перегон' : `план ${dm(shipAt)}`)
      : state === 'done' ? (i === currentStep ? 'готово' : short(stepEnd(i), at))
      : state === 'todo' ? short(stepEnd(i), at)
      : unit.place === 'pbs' ? 'в буфере' : unit.place === 'testtrack' ? 'испытания' : 'сейчас'
    return { label, state, note }
  })

  const dwellDays = Math.floor((at - releaseAt) / DAY)
  const overdue = released && unit.place === 'finished' && shipAt < at
  if (overdue) {
    const late = Math.max(1, Math.ceil((at - shipAt) / DAY))
    issues.push({ level: late > 2 ? 'bad' : 'warn', title: `Отгрузка просрочена на ${days(late)}`, text: `Машина на площадке ${days(Math.max(1, dwellDays))}. Уточните у логистики автовоз или вагон до дилера в г. ${dealer}.` })
  }
  if (unit.place === 'pbs' && durations[2] > 3 * HOUR)
    issues.push({ level: 'warn', title: 'Долго в буфере PBS', text: `Кузов ждёт сборки ${minutes(durations[2] / 60_000)} при норме до 3 ч. Проверьте последовательность запуска на сборку.` })

  const worst: Passport['status']['level'] = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : released ? 'done' : 'ok'
  const titles: Record<UnitPlace, string> = {
    welding: `Сварка кузова · линия ${(unit.line ?? 0) + 1}`, paint: 'Окраска кузова', pbs: 'Ожидает сборки', assembly: 'Сборка на главном конвейере',
    qc: 'Контроль качества', testtrack: 'Ходовые испытания', outbound: 'Выпущен · перегон', finished: overdue ? 'Ожидает отгрузки' : 'Готов к отгрузке', sim: '',
  }
  const status = handed
    ? { level: 'ok' as const, title: 'Участок пройден', detail: `Машина ушла на ${NEXT[unit.place]}` }
    : { level: worst, title: titles[unit.place], detail: stationText(unit.place, live?.station ?? selection.station, unit.line) }

  const progress = released ? 1 : (() => {
    const total = durations.reduce((a, b) => a + b, 0)
    const segment = SEGMENT[unit.place]!
    const before = durations.slice(0, segment).reduce((a, b) => a + b, 0)
    return Math.min(1, (before + local(shownProgress) * durations[segment]) / total)
  })()

  const dates: Passport['dates'] = [{ label: 'Дилер', value: dealer }, { label: 'Запуск в производство', value: when(startAt, at) }]
  if (released) {
    dates.push({ label: 'Выпуск', value: when(releaseAt, at) })
    if (unit.place === 'finished') dates.push({ label: 'На площадке', value: dwellDays < 1 ? 'меньше суток' : days(dwellDays), level: dwellDays > 7 ? 'warn' : undefined })
    dates.push({ label: 'Отгрузка дилеру, план', value: dayWord(shipAt, at), note: overdue ? 'просрочена' : undefined, level: overdue ? 'bad' : undefined })
  } else {
    dates.push({ label: 'Выпуск, прогноз', value: when(releaseAt, at), note: stopped.length ? 'под угрозой: участок стоит' : delay ? `+${minutes(delay)}` : 'по графику', level: stopped.length ? 'bad' : delay ? 'warn' : 'ok' })
    dates.push({ label: 'Отгрузка дилеру, план', value: dayWord(shipAt, at) })
  }

  return {
    vin: makeVin(unit.model, serial, new Date(startAt).getFullYear()),
    model: SPECS[unit.model].name,
    colorName: COLOR_NAMES[unit.color] ?? 'Цвет по заказу',
    status, zone: ZONE[unit.place], progress, released, steps, dates, issues,
    source: 'Демо-данные: VIN, заказ и сроки сформированы для иллюстрации. Подключения к MES нет.',
    live: !!live && !handed,
  }
}

/* ---------- симуляция ---------- */

const SIM_STAGES: StageId[] = ['welding', 'paint', 'assembly', 'qc']
const SIM_STEPS = ['Сварка', 'Окраска', 'Сборка', 'ОТК', 'Выпуск']
const SIM_ZONE: Record<StageId, string> = { welding: 'welding', paint: 'paint', assembly: 'assembly', qc: 'qc' }

/** Что карточка видела о кузове раньше: выпущенный кузов уходит из списка движка, бракованный — сразу. */
export interface SimMemory { stage?: StageId; finishedAt?: number }

export function simPassport(unit: CarUnit, s: SimulationSnapshot | null, memory: SimMemory): Passport {
  const id = unit.body ?? ''
  const number = Number(id.replace(/\D/g, '')) || 0
  const base = {
    vin: makeVin(unit.model, SERIAL_BASE.sim + number, new Date().getFullYear()),
    model: SPECS[unit.model].name,
    colorName: COLOR_NAMES[unit.color] ?? 'Цвет по заказу',
    source: 'Симуляция: этап, очередь и прогноз — из движка сценария. VIN условный.',
  }
  const vehicle = s?.vehicles.find((v) => v.id === id)
  const finished = s?.finishedVehicles.find((v) => v.id === id)
  const finishedAt = finished?.finishedAt ?? memory.finishedAt
  if (!s || !vehicle) {
    const good = finishedAt !== undefined
    const rejected = !good && memory.stage === 'qc'
    return {
      ...base, zone: good ? null : rejected ? 'qc' : null, progress: good || rejected ? 1 : 0, released: good, live: good,
      status: good ? { level: 'done', title: 'Принят ОТК · годный', detail: `Выпущен в ${formatTime(finishedAt!)} по времени смены` }
        : rejected ? { level: 'bad', title: 'Брак на ОТК', detail: 'Изделие выведено в карантин' }
        : { level: 'neutral', title: 'Нет данных о кузове', detail: 'Кузов не найден в текущей смене' },
      steps: SIM_STEPS.map((label, i) => ({ label, state: good ? 'done' : rejected && i === 3 ? 'issue' : rejected && i < 3 ? 'done' : 'todo', note: good && i === 4 ? formatTime(finishedAt!) : '' })),
      dates: [{ label: 'Кузов в симуляции', value: id }, ...good ? [{ label: 'Выпуск', value: formatTime(finishedAt!), note: 'время смены' }] : []],
      issues: rejected ? [{ level: 'bad', title: 'Не прошёл ОТК', text: 'Брак выявлен на контроле качества. Переделка в модели не предусмотрена — кузов в карантине.' }] : [],
    }
  }

  const si = SIM_STAGES.indexOf(vehicle.stage)
  const stage = s.stages[si]
  const queued = vehicle.status === 'queued'
  const faultLeft = s.faultUntil !== null ? Math.max(0, s.faultUntil - s.time) : 0
  const issues: Issue[] = []
  // остаток на своём этапе: ожидание очереди, остаток операции и ремонт, если этап стоит
  let rest = queued ? ((vehicle.queueIndex ?? 0) + 1) * stage.cycleMinutes + stage.cycleMinutes : (1 - vehicle.progress) * stage.cycleMinutes
  if (stage.state === 'FAULT') rest += faultLeft
  const ends: number[] = []
  let t = s.time + rest
  ends[si] = t
  for (let i = si + 1; i < 4; i++) {
    // кузов дойдёт до сборки раньше конца ремонта — ждёт
    if (i === 2 && s.stages[2].state === 'FAULT') t = Math.max(t, s.time + faultLeft)
    t += s.stages[i].cycleMinutes
    ends[i] = t
  }
  const eta = ends[3]

  if (stage.state === 'FAULT') issues.push({ level: 'bad', title: `Отказ: ${stage.id}`, text: `Ремонт до ${formatTime(s.faultUntil ?? s.time)}. ${queued ? 'Кузов ждёт в очереди' : 'Кузов стоит на посту'} — выпуск сдвигается на ${minutes(faultLeft)}.` })
  else if (stage.state === 'BLOCKED' && !queued) issues.push({ level: 'warn', title: 'Нет места в следующем буфере', text: `Операция завершена, но очередь «${s.stages[si + 1]?.label ?? 'выпуск'}» заполнена (${s.stages[si + 1]?.queue ?? 0} / ${s.config.bufferCapacity}). Кузов держит пост.` })
  if (si < 2 && s.stages[2].state === 'FAULT') issues.push({ level: 'warn', title: 'Впереди остановка сборки', text: `Конвейер-03 в ремонте до ${formatTime(s.faultUntil ?? s.time)}. Буфер PBS перед сборкой: ${s.stages[2].queue} / ${s.config.bufferCapacity}.` })
  if (eta > s.horizon) issues.push({ level: 'warn', title: 'Не успеет в эту смену', text: `Прогноз выхода с ОТК — ${formatTime(eta)}, смена заканчивается в ${formatTime(s.horizon)}.` })

  const level: Passport['status']['level'] = issues.some((i) => i.level === 'bad') ? 'bad' : issues.length ? 'warn' : 'ok'
  const steps = SIM_STEPS.map((label, i) => {
    const state: StepState = i < si ? 'done' : i > si ? 'todo' : stage.state === 'FAULT' ? 'issue' : queued || stage.state === 'BLOCKED' ? 'waiting' : 'active'
    const note = i < si ? 'готово' : i === 4 ? formatTime(eta) : i > si ? formatTime(ends[i]) : queued ? `очередь ${(vehicle.queueIndex ?? 0) + 1}` : `${Math.round(vehicle.progress * 100)}%`
    return { label, state, note }
  })
  const dates: Passport['dates'] = [{ label: 'Кузов в симуляции', value: id }]
  if (!queued && vehicle.start !== undefined && vehicle.end !== undefined) {
    dates.push({ label: 'Операция', value: `${formatTime(vehicle.start)}–${formatTime(stage.state === 'FAULT' ? vehicle.end + faultLeft : vehicle.end)}`, note: `такт ${stage.cycleMinutes.toLocaleString('ru-RU')} мин` })
  }
  dates.push({ label: 'Выход с ОТК, прогноз', value: formatTime(eta), note: 'время смены', level: issues.length ? 'warn' : 'ok' })
  return {
    ...base, zone: SIM_ZONE[vehicle.stage], released: false, live: true, issues, steps, dates,
    progress: (si + (queued ? 0 : vehicle.progress)) / 4,
    status: {
      level,
      title: queued ? (vehicle.stage === 'assembly' ? 'Ожидает сборки в буфере PBS' : `Ожидает: ${stage.label.toLowerCase()}`) : `${stage.label}: ${stage.state === 'FAULT' ? 'остановлена' : stage.state === 'BLOCKED' ? 'ждёт места дальше' : 'идёт операция'}`,
      detail: queued ? `${(vehicle.queueIndex ?? 0) + 1}-й в очереди из ${stage.queue} · ${stage.id}` : `${stage.id} · ${Math.round(vehicle.progress * 100)}% операции`,
    },
  }
}
