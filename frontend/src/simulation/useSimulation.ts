import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, type Comparison, type CompareParameters, type ControlAction, type SimulationConfig, type SimulationSnapshot } from './types'

async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal })
  if (!response.ok) throw new Error(response.status === 404 ? 'Сессия истекла. Начните новую смену.' : `Не удалось выполнить действие (${response.status}). Попробуйте ещё раз.`)
  return response.json()
}

export function useSimulation(active: boolean) {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null)
  const latest = useRef<SimulationSnapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [comparing, setComparing] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const accept = useCallback((next: SimulationSnapshot, replace = false) => {
    if (!validSnapshot(next)) throw new Error('Получено некорректное состояние. Восстанавливаем связь…')
    const previous = latest.current
    if (previous && previous.sessionId !== next.sessionId && !replace) return
    if (previous?.sessionId === next.sessionId && previous.version > next.version) return
    latest.current = next
    if (mounted.current) setSnapshot(next)
  }, [])
  const create = useCallback(async (config: SimulationConfig = DEFAULT_CONFIG) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(null)
    try {
      const next = await request<SimulationSnapshot>('/api/simulation/sessions', config)
      accept(next, true); setComparison(null)
    } catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }, [accept])
  useEffect(() => { if (active && !latest.current) void create() }, [active, create])

  const control = useCallback(async (action: ControlAction, extra?: { minutes?: number; speed?: number }) => {
    if (!latest.current || pending.current) return false
    pending.current = true; setBusy(true); setError(null)
    try {
      accept(await request<SimulationSnapshot>(`/api/simulation/sessions/${latest.current.sessionId}/control`, { action, ...extra }))
      return true
    }
    catch (e) { if (mounted.current) setError((e as Error).message); return false }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }, [accept])

  const sessionId = snapshot?.sessionId
  useEffect(() => {
    if (!active || !sessionId) { setConnected(false); return }
    let disposed = false, socket: WebSocket | null = null, reconnect: ReturnType<typeof setTimeout> | undefined
    let polling = false, expired = false
    const open = () => {
      if (disposed || expired) return
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/simulation/sessions/${sessionId}/stream`)
      socket.onopen = () => { if (!disposed) setConnected(true) }
      socket.onmessage = (event) => {
        if (disposed) return
        try { const data = JSON.parse(event.data) as SimulationSnapshot; if (data.sessionId === sessionId) { accept(data); setError((previous) => previous?.startsWith('Получено некорректное') ? null : previous) } }
        catch { setError('Получено некорректное состояние. Восстанавливаем связь…') }
      }
      socket.onclose = (event) => { if (!disposed) { setConnected(false); if (event.code === 1008) { expired = true; setError('Сессия истекла. Начните новую смену.') } else reconnect = setTimeout(open, 1500) } }
      socket.onerror = () => socket?.close()
    }
    open()
    const fallback = setInterval(async () => {
      if (disposed || expired || socket?.readyState === WebSocket.OPEN || polling) return
      polling = true
      try { const next = await request<SimulationSnapshot>(`/api/simulation/sessions/${sessionId}`); if (!disposed) accept(next) }
      catch (e) { if (!disposed) setError((e as Error).message) }
      finally { polling = false }
    }, 1500)
    return () => { disposed = true; clearInterval(fallback); clearTimeout(reconnect); socket?.close() }
  }, [active, sessionId, accept])

  const compare = useCallback(async (parameters: CompareParameters) => {
    setComparing(true); setError(null)
    try { const result = await request<Comparison>('/api/simulation/compare', parameters); if (mounted.current) setComparison(result) }
    catch (e) { if (mounted.current) setError((e as Error).message) }
    finally { if (mounted.current) setComparing(false) }
  }, [])
  return { snapshot, connected, busy, error, comparison, comparing, create, control, compare }
}

function validSnapshot(value: SimulationSnapshot): boolean {
  if (!value || typeof value.sessionId !== 'string' || !Number.isInteger(value.version) || !Number.isFinite(value.time)
    || !Number.isFinite(value.horizon) || value.time < 0 || value.time > value.horizon || typeof value.running !== 'boolean'
    || !Number.isFinite(value.speed) || !Number.isFinite(value.nextEventAt) || !value.config
    || !Number.isFinite(value.config.bufferCapacity) || !Array.isArray(value.stages) || value.stages.length !== 4
    || !Array.isArray(value.vehicles) || !Array.isArray(value.finishedVehicles) || !Array.isArray(value.events) || !Array.isArray(value.assumptions)) return false
  const states = ['RUN', 'FAULT', 'BLOCKED', 'STARVED'], stages = ['welding', 'paint', 'assembly', 'qc']
  if (![value.started, value.good, value.rejected, value.wip].every((n) => Number.isInteger(n) && n >= 0)
    || value.started !== value.good + value.rejected + value.wip) return false
  return value.stages.every((stage, i) => stage && stage.stage === stages[i] && states.includes(stage.state)
    && typeof stage.id === 'string' && stage.durations && states.every((state) => Number.isFinite(stage.durations[state as keyof typeof stage.durations]))
    && Array.isArray(stage.position) && stage.position.length === 3 && stage.position.every(Number.isFinite)
    && Number.isFinite(stage.queue) && stage.queue >= 0 && stage.queue <= stage.capacity)
    && value.vehicles.every((vehicle) => vehicle && typeof vehicle.id === 'string' && stages.includes(vehicle.stage)
      && ['onix', 'cobalt', 'j7'].includes(vehicle.model) && ['processing', 'queued'].includes(vehicle.status) && Number.isFinite(vehicle.progress))
}
