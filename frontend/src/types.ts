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
  plant: { plan: number; fact: number; oee: number; defectRate: number; downtime: number }
  monthPlan: { models: { model: string; plan: number }[]; total: number; target: number }
}

/** Выбранный объект: зона корпуса или открытая площадка. */
export type Selection = { kind: 'zone'; zone: Zone } | { kind: 'outdoor'; zone: OutdoorZone } | null
