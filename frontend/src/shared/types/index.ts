export type XY = [number, number]

export interface Fact {
  label: string
  value: string
  source?: string
}

export interface HallFrame {
  origin: XY
  angle: number
  length: number
  width: number
  height: number
}

export interface Zone {
  id: string
  name: string
  short: string
  rect: [number, number, number, number] // u0, u1, v0, v1
  color: string
  kpiArea: string | null
  /** ndv — положение подтверждено проектом НДВ; logic — размещено по технологической логике */
  basis: 'ndv' | 'logic'
  description: string
  facts: Fact[]
}

export interface OutdoorZone {
  id: string
  name: string
  short: string
  center: XY
  size: XY
  color: string
  description: string
  facts: Fact[]
}

export interface Plant {
  name: string
  address: string
  facts: Fact[]
  hall: HallFrame
  zones: Zone[]
  outdoor: OutdoorZone[]
  sources: Record<string, { title: string; url: string }>
}

export interface Site {
  source: string
  site: XY[]
  hall: XY[]
  buildings: { id: number; name: string; polygon: XY[] }[]
}

export interface LineRow {
  date: string
  line: string
  area: string
  plan: number
  fact: number
  hours: number
  load: number
  availability: number
  performance: number
  quality: number
  oee: number
  defects: number
  defectRate: number
  downtime: number
}

export interface Kpi {
  targets: { oee: number; defect: number; downtime_critical: number; monthly_output: number; shifts: number }
  date: string
  rows: LineRow[]
  areas: Record<string, LineRow[]>
  plant: { basis: string; plan: number; fact: number; good: number; oee: number; defectRate: number; downtime: number }
  flowMinimum: { area: string; fact: number }
  downtimeEvents: { date: string; area: string; equipment: string; reason: string; minutes: number; dailyMinutes: number; limit: number; overLimit: boolean }[]
  monthPlan: { models: { model: string; plan: number }[]; total: number; target: number; gap: number }
  meta: { demo: boolean; source: string; shiftHours: number; methodology: string[]; issues: { date: string; line: string; message: string }[] }
}

/** Выбранный объект: зона корпуса или открытая площадка. */
export type Selection = { kind: 'zone'; zone: Zone } | { kind: 'outdoor'; zone: OutdoorZone } | null

export type Level = 'bad' | 'warn' | 'ok'

export interface ScenarioResult {
  levers: string[]
  shifts: number
  days: number
  extraShifts: number
  areas: Record<string, { output: number; good: number; defectRate: number }>
  bottleneck: string
  perShift: number
  month: number
  plan: number
  target: number
  vsPlan: number
  vsTarget: number
  extraShiftsForTarget: number
  requiredPerShift: number
}

export interface Lever {
  id: string
  area: string | null
  title: string
  detail: string
  /** прирост выпуска за месяц, если включить только это мероприятие */
  effect: number
  bottleneckAfter: string
}

export interface Alert {
  level: Level
  area: string | null
  /** live — простой, который идёт прямо сейчас (из потока симулятора или линии); ai — прогноз отказа или аномалия от моделей ИИ */
  kind: 'bottleneck' | 'quality' | 'flow' | 'equipment' | 'plan' | 'live' | 'ai'
  title: string
  text: string
}

export interface Risk {
  date: string
  area: string
  equipment: string
  reason: string
  minutes: number
  dailyMinutes: number
  limit: number
  planned: boolean
  shareOfLimit: number
  onBottleneck: boolean
  carsLost: number
  plantCarsLost: number
  level: 'high' | 'medium' | 'low'
  action: string
}

export interface Insights {
  assumptions: string[]
  workDays: number
  base: ScenarioResult
  best: ScenarioResult
  levers: Lever[]
  risks: Risk[]
  alerts: Alert[]
  status: Record<string, Level>
  flow: { area: string; plan: number; fact: number; good: number; takt: number }[]
  lostPerMonth: number
  nominalCapacity: number
}

export interface DataSource {
  source: string
  updatedAt: string | null
  version: number
  counts: { lines: number; downtime: number; quality: number; monthPlan: number }
  dates: [string, string] | null
  live: boolean
}

export interface LiveShift {
  date: string
  elapsed: number
  length: number
  areas: Record<string, { done: number; defects: number; plan: number; stopped: boolean }>
  active: { area: string; equipment: string; reason: string; minutes: number; start: number }[]
  finished: { area: string; equipment: string; reason: string; minutes: number }[]
}

/** Сообщение потока /api/stream. */
export interface LiveState {
  running: boolean
  shift: LiveShift | null
  version: number
}
