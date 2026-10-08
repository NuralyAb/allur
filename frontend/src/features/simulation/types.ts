export type StageId = 'welding' | 'paint' | 'assembly' | 'qc'
export type EquipmentState = 'RUN' | 'FAULT' | 'BLOCKED' | 'STARVED'
export interface SimulationConfig {
  repairMinutes: number
  assemblyCycle: number
  bufferCapacity: number
  defectPercent: number
  seed: number
}
export const DEFAULT_CONFIG: SimulationConfig = { repairMinutes: 55, assemblyCycle: 3.6, bufferCapacity: 6, defectPercent: 2, seed: 42 }
export interface Stage {
  id: string; stage: StageId; name: string; position: [number, number, number]; zone: string
  label: string; state: EquipmentState; cycleMinutes: number; processed: number
  queue: number; capacity: number; progress: number; durations: Record<EquipmentState, number>
}
export interface Vehicle {
  id: string; model: 'onix' | 'cobalt' | 'j7'; stage: StageId
  status: 'processing' | 'queued'; progress: number; start?: number; end?: number; queueIndex?: number
}
export interface EngineSnapshot {
  time: number; horizon: number; completed: boolean
  config: SimulationConfig; stages: Stage[]; vehicles: Vehicle[]
  finishedVehicles: { id: string; model: Vehicle['model']; finishedAt: number }[]
  started: number; good: number; rejected: number; wip: number; faultUntil: number | null; nextEventAt: number
  events: { id: number; time: number; kind: string; message: string; assetId: string | null }[]
  assumptions: string[]
}
export interface SimulationSnapshot extends EngineSnapshot {
  sessionId: string; version: number; running: boolean; speed: number
}
export interface CompareParameters extends SimulationConfig {
  alternativeRepair: number; workingDays: number; contributionMargin: number; interventionCost: number
}
export interface Comparison {
  parameters: CompareParameters; baseline: EngineSnapshot; alternative: EngineSnapshot
  healthyGood: number; deltaGood: number; savedMinutes: number; effectKzt: number
  month: { baseline: number; alternative: number; target: number; days: number; shiftsPerDay: number; runs: number; probTarget: [number, number] }
  causes: { assetId: string; text: string }[]; assumptions: string[]
  bottleneck: { assetId: string; label: string; extraGood: number; method: string; trials: { assetId: string; label: string; extraGood: number }[] }
}
export type ControlAction = 'resume' | 'pause' | 'advance' | 'fault' | 'reset' | 'speed'
export const STATE_LABELS: Record<EquipmentState, string> = { RUN: 'В работе', FAULT: 'Отказ', BLOCKED: 'Буфер заполнен', STARVED: 'Нет подачи' }
export const formatTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`
