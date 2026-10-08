import { useCallback, useEffect, useRef, useState } from 'react'

export interface Limits { value: number; min: number; max: number; maxStep?: number }
export interface ParamDef {
  id: string; name: string; unit: string; decimals: number; range: [number, number]
  sp: Limits | null; alarms: Partial<Record<'lolo' | 'lo' | 'hi' | 'hihi' | 'dev', number>>
  trip: { above?: number; below?: number; code: number } | null
  permissive: { command: string; belowSp: number; text?: string } | null
}
export interface SignalDef {
  id: string; name: string; kind: 'DI' | 'DO' | 'AI' | 'AO'; address: string; device: string
  src: string | null; param: string | null; unit: string; range: [number, number]
}
export interface CabinetDef { id: string; location: string; plc: string; io: string; drive: string | null }
export interface Station { name?: string; location?: string; server?: string; network?: string; redundancy?: string }
export interface ControllerDef {
  id: string; equipment: string; name: string; zone: string; area: string; connection: string; path: string
  speed: { value: number; min?: number; max?: number; maxStep?: number; unit: string }
  writeEnabled: boolean; faults: Record<string, string>; params: ParamDef[]
  cabinet: CabinetDef | null; io: SignalDef[]
}
export interface ScadaConfig {
  writeEnabled: boolean; mode: string; note: string; simulator: boolean
  connections: { id: string; name: string; protocol: string; endpoint: string }[]
  lines: { id: string; name: string; controllers: string[]; bufferSeconds: number[] }[]
  controllers: ControllerDef[]
  states: Record<string, string>
  modes: Record<string, { value: number; label: string }>
  commands: { name: string; label: string; confirm: boolean; role: string }[]
  lineCommands: { name: 'START' | 'STOP' | 'HOLD'; label: string; confirm: boolean }[]
  roles: Record<string, string>
  station: Station
}
export interface ControllerState {
  comm: 'good' | 'stale' | 'bad'; commText: string; state: number; stateName: string; mode: number | null
  speed: number | null; speedSp: number | null; processed: number | null; defective: number | null
  stopReason: number; stopText: string; remote: boolean | null; safety: boolean | null
  params: Record<string, { pv: number | null; q: string; sp: number | null }>
  io: Record<string, { raw: number | boolean | null; value: number | boolean | null; q: string }>
  commands: Record<string, { blocked: string | null; confirm: boolean }>
  modeBlocked: string | null; writeBlocked: string | null
}
export interface Alarm {
  id: string; controller: string; kind: string; priority: 1 | 2 | 3; message: string; value: number | null
  /** короткий заголовок без текущих значений — для меток на 3D-модели */
  title: string
  active: boolean; acked: boolean; since: number; rtnAt: number | null; ackBy: string | null; ackAt: number | null
  shelvedUntil: number | null; shelvedBy: string | null; shelveReason: string | null
}
export interface Command {
  id: string; controller: string; kind: 'packml' | 'mode' | 'setpoint' | 'speed' | 'line'; name: string; value: number | null
  label: string; user: string; role: string; reason: string
  status: 'new' | 'armed' | 'sent' | 'done' | 'failed' | 'rejected' | 'expired' | 'cancelled'
  message: string; created: number; updated: number; expires: number | null
  steps: { controller: string; label: string; status: 'done' | 'failed' | 'rejected' | 'skipped'; message: string }[]
}
export interface ServerStatus {
  started: number; uptime: number; mode: string; tags: number; values: number; signals: number
  controllers: number; online: number; connections: number; connectionsOk: number
  updatesPerSec: number; updates: number; scanMs: number; clients: number
  alarmsActive: number; alarmsUnacked: number; commandsPending: number; lineRuns: number
  historyRows?: number; auditRows?: number; dbBytes?: number; writeEnabled: boolean; station: Station
}
export interface IoRow {
  controller: string; equipment: string; area: string; cabinet: string; id: string; name: string; kind: SignalDef['kind']
  address: string; device: string; tag: string; raw: number | boolean | null; value: number | boolean | null; unit: string; q: string; ts: number | null
}
export interface ScadaState {
  ts: number; version: number; mode: string; writeEnabled: boolean
  connections: { id: string; ok: boolean; text: string; since: number }[]
  controllers: Record<string, ControllerState>
  alarms: Alarm[]; commands: Command[]
  buffers: { up: string; down: string; size: number; fill: number }[]
  server: ServerStatus
}
export interface User { login: string; name: string; role: 'viewer' | 'operator' | 'engineer'; roleName: string; guest?: boolean }
export interface AuditRow { seq: number; ts: number; kind: string; user: string; role: string; controller: string; action: string; detail: Record<string, unknown>; status: string; hash: string }
export interface DowntimeEvent { id: number; controller: string; equipment: string; area: string; state: string; reason: string; start: number; end: number | null; minutes: number }

/** Состояния PackML: Работа, Авария, Остановлен… — те же коды, что на сервере. */
export const S = { STOPPED: 2, IDLE: 4, SUSPENDED: 5, EXECUTE: 6, ABORTING: 8, ABORTED: 9, HELD: 11 } as const
export const ROLE_RANK = { viewer: 0, operator: 1, engineer: 2 } as const
export const can = (user: User | null, need: keyof typeof ROLE_RANK) => !!user && !user.guest && ROLE_RANK[user.role] >= ROLE_RANK[need]

const TOKEN_KEY = 'allur-scada-token'
export function getToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
}
function setToken(token: string | null) {
  try { if (token) sessionStorage.setItem(TOKEN_KEY, token); else sessionStorage.removeItem(TOKEN_KEY) } catch { /* приватный режим */ }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(`/api/scada${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = json?.detail
    const text = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).join('; ') : `HTTP ${res.status}`
    throw new ApiError(text, res.status)
  }
  return json as T
}

export const api = {
  config: () => call<ScadaConfig>('/config'),
  state: () => call<ScadaState>('/state'),
  me: () => call<User>('/me'),
  async login(login: string, password: string) {
    const r = await call<{ token: string; user: User }>('/login', { login, password })
    setToken(r.token)
    return r.user
  },
  async logout() {
    await call('/logout', {}).catch(() => null)
    setToken(null)
  },
  command: (controller: string, kind: Command['kind'], name: string, value?: number) =>
    call<Command>('/commands', { controller, kind, name, ...(value !== undefined && { value }) }),
  lineCommand: (line: string, name: 'START' | 'STOP' | 'HOLD') => call<Command>(`/lines/${encodeURIComponent(line)}/commands`, { name }),
  server: () => call<ServerStatus>('/server'),
  io: () => call<IoRow[]>('/io'),
  confirm: (id: string, reason: string) => call<Command>(`/commands/${id}/confirm`, { reason }),
  cancel: (id: string) => call<Command>(`/commands/${id}/cancel`, {}),
  ack: (id?: string, controller?: string) => call<{ acked: number }>('/alarms/ack', { id, controller }),
  shelve: (id: string, minutes: number, reason: string) => call('/alarms/shelve', { id, minutes, reason }),
  history: (keys: string[], minutes: number) => call<{ since: number; series: Record<string, [number, number][]> }>(`/history?keys=${encodeURIComponent(keys.join(','))}&minutes=${minutes}`),
  audit: (controller?: string) => call<AuditRow[]>(`/audit?limit=200${controller ? `&controller=${encodeURIComponent(controller)}` : ''}`),
  verify: () => call<{ ok: boolean; rows: number; brokenAt?: number }>('/audit/verify'),
  events: () => call<DowntimeEvent[]>('/events?limit=100'),
  field: (controller: string, action: 'fault' | 'estop' | 'release' | 'local' | 'remote', code?: number) =>
    call(`/sim/${controller}`, { action, code }),
}

/**
 * Общий источник состояния SCADA для цифрового двойника: один опрос на страницу, сколько бы
 * подписчиков ни было (метки оборудования в 3D, список контроллеров в карточке цеха).
 * Пульт HMI пользуется потоком useScadaState — там нужна частота два раза в секунду.
 */
const feed = {
  config: null as ScadaConfig | null,
  state: null as ScadaState | null,
  offline: false,
  subs: new Set<() => void>(),
  timer: undefined as ReturnType<typeof setInterval> | undefined,
}

function feedNotify() {
  for (const fn of feed.subs) fn()
}

function feedTick() {
  if (!feed.config) api.config().then((c) => { feed.config = c; feedNotify() }, () => null)
  api.state().then(
    (s) => { feed.state = s; feed.offline = false; feedNotify() },
    () => { feed.offline = true; feedNotify() },
  )
}

export function useScadaFeed(enabled = true) {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const fn = () => bump((n) => n + 1)
    feed.subs.add(fn)
    if (!feed.timer) {
      feedTick()
      feed.timer = setInterval(feedTick, 2500)
    } else if (feed.state) {
      fn()
    }
    return () => {
      feed.subs.delete(fn)
      if (feed.subs.size === 0) {
        clearInterval(feed.timer)
        feed.timer = undefined
      }
    }
  }, [enabled])
  return { config: feed.config, state: feed.state, offline: feed.offline }
}

export type Link = 'ws' | 'http' | 'offline'

/** Поток состояния: WebSocket с переподключением; пока его нет — опрос HTTP раз в 2 с. */
export function useScadaState(enabled = true) {
  const [state, setState] = useState<ScadaState | null>(null)
  const [link, setLink] = useState<Link>('offline')
  const offset = useRef(0) // серверное время − время браузера, мс
  const accept = useCallback((s: ScadaState) => {
    offset.current = s.ts * 1000 - Date.now()
    setState(s)
  }, [])
  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let poll: ReturnType<typeof setInterval> | undefined
    let attempt = 0
    const startPolling = () => {
      if (poll) return
      const tick = () => api.state().then((s) => { accept(s); setLink((l) => (l === 'ws' ? l : 'http')) }, () => setLink((l) => (l === 'ws' ? l : 'offline')))
      tick()
      poll = setInterval(tick, 2000)
    }
    const stopPolling = () => { clearInterval(poll); poll = undefined }
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/scada/stream`)
      ws.onopen = () => { attempt = 0; stopPolling(); setLink('ws') }
      ws.onmessage = (e) => { try { accept(JSON.parse(e.data) as ScadaState) } catch { /* повреждённый пакет — ждём следующий */ } }
      ws.onclose = () => {
        if (closed) return
        setLink((l) => (l === 'ws' ? 'http' : l))
        startPolling()
        retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++))
      }
    }
    startPolling()
    connect()
    return () => { closed = true; clearTimeout(retry); stopPolling(); ws?.close() }
  }, [enabled, accept])
  const serverNow = useCallback(() => (Date.now() + offset.current) / 1000, [])
  return { state, link, serverNow }
}

export function fmt(value: number | null | undefined, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
export const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const dateTime = (ts: number) => new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Следующий шаг оператора по состоянию PackML — подсказка на панели. */
export function nextStep(state: number): string | null {
  if (state === S.ABORTED) return 'CLEAR'
  if (state === S.STOPPED) return 'RESET'
  if (state === S.IDLE) return 'START'
  if (state === S.HELD) return 'UNHOLD'
  return null
}

export interface AlarmSummary { id: string; controller: string; equipment: string; area: string; zone: string; priority: 1 | 2 | 3; title: string; acked: boolean }

/**
 * Активные тревоги ПЛК для цифрового двойника. Возвращает строку-ключ (участок, приоритет, заголовок):
 * она меняется только при появлении или снятии тревоги, поэтому тяжёлая 3D-сцена не перерисовывается на каждом опросе.
 */
export function useAlarmSummaryKey(intervalMs = 3000) {
  const [key, setKey] = useState('[]')
  useEffect(() => {
    let alive = true
    const tick = () => fetch('/api/scada/alarms').then((r) => (r.ok ? r.json() : [])).then((list: AlarmSummary[]) => {
      if (alive) setKey(JSON.stringify(list.map((a) => ({ area: a.area, priority: a.priority, title: a.title }))))
    }, () => null)
    tick()
    const t = setInterval(tick, intervalMs)
    return () => { alive = false; clearInterval(t) }
  }, [intervalMs])
  return key
}
