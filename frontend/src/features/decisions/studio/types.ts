/** Сценарная студия: вероятностный прогноз месяца (/api/forecast). */

export interface ForecastRequest {
  defect?: Record<string, number> // участок -> брак, %
  plannedOutside?: boolean
  predictive?: number // доля предотвращённых внеплановых отказов
  repair?: Record<string, number> // оборудование -> длительность ремонта, мин
  speed?: Record<string, number> // участок -> множитель темпа
  buffer?: number
  shifts?: number
  days?: number
  extraShifts?: number
  runs?: number
}

export interface ForecastAction {
  id: string
  title: string
  cost: number
  apply: { plannedOutside?: boolean; predictive?: number; defect?: Record<string, number>; repair?: Record<string, number>; speed?: Record<string, number> }
}

export interface ForecastModel {
  period: [string, string]
  shifts: number
  days: number
  plan: number
  target: number
  buffer: number
  predictiveDefault: number
  defectTarget: number
  costs: Record<string, number>
  stages: {
    area: string; goodPerShift: number; defect: number; downPerShift: number
    failures: { equipment: string; reason: string; planned: boolean; perShift: number; minutes: number }[]
  }[]
  actions: ForecastAction[]
  assumptions: string[]
}

export interface Distribution {
  mean: number; p10: number; p50: number; p90: number; probPlan: number; probTarget: number; deterministic: number; bottleneck: string
}

export interface Forecast extends Distribution {
  runs: number
  shifts: number
  variabilityLoss: number
  plan: number
  target: number
  perShift: number
  bottleneckShare: Record<string, number>
  areas: Record<string, { goodPerShift: number; down: number; starved: number; blocked: number }>
  histogram: { from: number; to: number; share: number }[]
  base: Distribution
  gain: number
}

export interface Sensitivity {
  base: number
  runs: number
  items: { id: string; title: string; cost: number; gain: number; gainP10: number; gainP90: number; probTarget: number }[]
}

export interface TargetPlan {
  actions: { id: string; title: string; cost: number }[]
  extraShifts: number
  cost: number
  mean: number
  p10: number
  probTarget: number
  reached: boolean
  gain: number
  net: number | null
}

export interface PlanResult {
  target: number
  confidence: number
  base: number
  baseProb: number
  plans: TargetPlan[]
  shiftCost: number
  margin: number
  runs: number
}
