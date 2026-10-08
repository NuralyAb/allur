/** Клиент API ИИ-подсистемы: прогноз отказов, аномалии, причины брака, прогноз месяца, ассистент. */
import { useEffect, useState } from 'react'
import { get, postJson } from '../../shared/api/client'
import type { Level } from '../../shared/types'

export interface ModelMetrics { samples: number; auc: number | null; brier?: number; positiveShare?: number }
export interface AiStatus {
  status: 'idle' | 'training' | 'ready' | 'error' | 'off'
  error: string | null
  trainedAt: number | null
  updated: number | null
  metrics: { failure?: ModelMetrics; anomaly?: { samples: number; falseAlarmPerWindow: number }; quality?: Record<string, ModelMetrics & { defectShare: number }>; trainSeconds?: number }
  signals: { series: number; points: number; running: number }
  llm: { mode: 'unknown' | 'llm' | 'offline'; error: string | null; model: string }
  simulator: boolean
}

export interface Prediction {
  controller: string; equipment: string; area: string; zone: string
  param: string; paramName: string; unit: string; decimals: number
  value: number; trend: number; slopePerMin: number; limit: number; limitKind: string; direction: 'up' | 'down'
  probability: number; etaMin: number | null; etaRangeMin: [number | null, number | null]
  failure: string; code: number | null; action: string; repairMin: number; severity: Level
  points: number; windowMin: number; carsAtRisk: number | null; onBottleneck: boolean
}
export interface Anomaly {
  controller: string; equipment: string; area: string; zone: string
  param: string; paramName: string; unit: string; decimals: number
  value: number; expected: number; shift: number; shiftSigma: number; slopeT: number; spread: number
  score: number; threshold: number; strength: number; since: number
}
export interface Demo { id: string; controller: string; param: string; rate: number; title: string; detail: string }
export interface Maintenance {
  status: AiStatus['status']; updated: number | null; predictions: Prediction[]; anomalies: Anomaly[]
  bottleneck: string; demos: Demo[]; active: string[]
}

export interface Driver { param: string; name: string; unit: string; importance: number; nominal: number; doubleAbove: number | null; doubleBelow: number | null; curve: [number, number][] }
export interface Factor { param: string; name: string; unit: string; value: number | null; nominal: number; delta: number }
export interface QualityController {
  controller: string; equipment: string; name: string; running: boolean; risk: number; baseline: number
  factors: Factor[]; drivers: Driver[]; metrics: ModelMetrics & { defectShare: number }
  observed: { processed: number; defective: number; rate: number | null }
}
export interface QualityArea { area: string; zone: string; risk: number; baseline: number; worst: string; caseRate: number | null; controllers: QualityController[] }
export interface Quality { status: string; target?: number; areas: QualityArea[] }

export interface ForecastScenario { id: 'base' | 'ai'; title: string; mean: number; p10: number; p50: number; p90: number; pPlan: number; pTarget: number; bottleneck: Record<string, number>; hist: number[] }
export interface Forecast { runs: number; shifts: number; plan: number; target: number; deterministic: number; bins: number[]; scenarios: ForecastScenario[]; predictableShare: number; predictable: string[]; assumptions: string[] }

export interface SceneItem { area: string; zone: string; controller: string; level: Level; kind: 'forecast' | 'anomaly'; title: string; text: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatReply { reply: string; tools: string[]; mode: 'llm' | 'offline'; reason?: string; model: string | null; seconds: number }

export const ai = {
  status: () => get<AiStatus>('/api/ai/status'),
  maintenance: () => get<Maintenance>('/api/ai/maintenance'),
  quality: () => get<Quality>('/api/ai/quality'),
  forecast: () => get<Forecast>('/api/ai/forecast'),
  chat: (messages: ChatMessage[]) => postJson<ChatReply>('/api/ai/chat', { messages }),
  report: () => postJson<ChatReply>('/api/ai/report', {}),
  demo: (id: string, action: 'start' | 'repair') => postJson<{ ok: boolean; active: string[] }>('/api/ai/demo', { id, action }),
}

/** Опрос ресурса с интервалом; ошибка сети не стирает последние данные. */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    const run = () => load().then((d) => { if (alive) { setData(d); setError(false) } }, () => { if (alive) setError(true) })
    run()
    const t = setInterval(run, intervalMs)
    return () => { alive = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps])
  return { data, error, refresh: () => setTick((n) => n + 1) }
}

/**
 * Прогнозы ИИ для 3D-модели. Возвращает строку-ключ, которая меняется только при появлении, снятии
 * или смене уровня предупреждения: тяжёлая сцена не перерисовывается на каждом опросе.
 */
export function useAiSceneKey(intervalMs = 5000) {
  const [key, setKey] = useState('[]')
  useEffect(() => {
    let alive = true
    const tick = () => get<SceneItem[]>('/api/ai/scene').then((list) => {
      // время до отказа в заголовке округляется до 5 мин, чтобы метка не обновлялась каждые 5 с
      if (alive) setKey(JSON.stringify(list.map((a) => ({ area: a.area, level: a.level, kind: a.kind, title: a.title
        .replace(/~(\d+) мин/, (_, m) => `~${Math.max(5, Math.round(Number(m) / 5) * 5)} мин`)
        .replace(/вероятность (\d+)%/, (_, p) => `вероятность ${Math.round(Number(p) / 10) * 10}%`) }))))
    }, () => null)
    tick()
    const t = setInterval(tick, intervalMs)
    return () => { alive = false; clearInterval(t) }
  }, [intervalMs])
  return key
}
