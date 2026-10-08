/** Клиент админки: токен администратора хранится в localStorage и общий с двойником (один origin). */
import type { DataSource, Fact, Insights, Kpi, OutdoorZone, Plant, Zone } from '../shared/types'

export const TOKEN_KEY = 'allur-admin-token'
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function setToken(token: string | null) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch { /* приватный режим */ }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors?: string[]) { super(message) }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
    headers: { ...(init.body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = json?.detail
    const errors: string[] | undefined = detail?.errors
    const text = typeof detail === 'string' ? detail : errors ? errors.join('; ') : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).join('; ') : `HTTP ${res.status}`
    throw new ApiError(text, res.status, errors)
  }
  return json as T
}

export interface Me { login: string; name: string; role: string; roleName: string; guest: boolean; admin: boolean }
export interface AdminUser { login: string; name: string; role: string; roleName: string; blocked: boolean }
export interface Targets { oee: number; defect: number; downtime_critical: number; monthly_output: number; shifts: number }
export interface Calc { workDays: number; predictiveCut: number; windowDays: number; marginKzt: number }
export interface SceneDefaults { mood: 'day' | 'sunset'; detailed: boolean; labels: boolean; roof: boolean }
export interface Settings { targets: Targets; calc: Calc; scene: SceneDefaults }
export interface SettingsPayload extends Settings { defaults: Settings }
export interface ScadaSummary {
  running: boolean
  mode?: string
  note?: string
  controllers?: number
  states?: Record<string, number>
  alarms?: { active: number; unacked: number; byPriority: Record<string, number> }
}
export interface Overview {
  source: DataSource
  kpi: Kpi
  insights: Insights
  downtime: { byReason: { reason: string; minutes: number }[]; byEquipment: { equipment: string; minutes: number }[]; total: number }
  scada: ScadaSummary | null
  users: number
  settings: Settings
  plantCustomized: boolean
}
export type ZoneOverride = Partial<Pick<Zone, 'name' | 'short' | 'rect' | 'color' | 'kpiArea' | 'description'>>
export type OutdoorOverride = Partial<Pick<OutdoorZone, 'name' | 'short' | 'center' | 'size' | 'color' | 'description'>>
export interface PlantOverrides { name?: string; address?: string; facts?: Fact[]; zones?: Record<string, ZoneOverride>; outdoor?: Record<string, OutdoorOverride> }
export interface PlantAdmin { plant: Plant & { customized?: boolean }; overrides: PlantOverrides; original: Plant; kpiAreas: string[] }
export interface AuditRow { id: number; ts: string; user: string; role: string; action: string; details: Record<string, unknown> }

export const api = {
  me: () => call<Me>('/api/admin/me'),
  async login(login: string, password: string) {
    const r = await call<{ token: string; user: Me }>('/api/admin/login', { body: { login, password } })
    setToken(r.token)
    return r.user
  },
  async logout() {
    await call('/api/admin/logout', { body: {} }).catch(() => null)
    setToken(null)
  },
  overview: () => call<Overview>('/api/admin/overview'),
  settings: () => call<SettingsPayload>('/api/admin/settings'),
  saveSettings: (patch: Partial<Record<keyof Settings, Record<string, unknown>>>) => call<SettingsPayload>('/api/admin/settings', { method: 'PUT', body: patch }),
  resetSettings: (section?: keyof Settings) => call<SettingsPayload>(`/api/admin/settings${section ? `?section=${section}` : ''}`, { method: 'DELETE' }),
  plant: () => call<PlantAdmin>('/api/admin/plant'),
  savePlant: (patch: PlantOverrides & { zones?: Record<string, Record<string, unknown>>; outdoor?: Record<string, Record<string, unknown>> }) =>
    call<{ plant: Plant; overrides: PlantOverrides }>('/api/admin/plant', { method: 'PUT', body: patch }),
  resetPlant: () => call<{ plant: Plant; overrides: PlantOverrides }>('/api/admin/plant', { method: 'DELETE' }),
  users: () => call<{ users: AdminUser[]; roles: { role: string; label: string }[] }>('/api/admin/users'),
  createUser: (body: { login: string; name: string; role: string; password: string }) => call<AdminUser>('/api/admin/users', { body }),
  patchUser: (login: string, body: { role?: string; blocked?: boolean; name?: string }) => call<AdminUser>(`/api/admin/users/${encodeURIComponent(login)}`, { method: 'PATCH', body }),
  resetPassword: (login: string, password: string) => call<AdminUser>(`/api/admin/users/${encodeURIComponent(login)}/password`, { body: { password } }),
  deleteUser: (login: string) => call<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(login)}`, { method: 'DELETE' }),
  audit: (limit = 300) => call<AuditRow[]>(`/api/admin/audit?limit=${limit}`),
  source: () => call<DataSource>('/api/data/source'),
  importFile(file: File, mode: 'merge' | 'replace') {
    const form = new FormData()
    form.append('file', file)
    form.append('mode', mode)
    return call<DataSource & { imported: Record<string, number> }>('/api/data/import', { form })
  },
  resetData: () => call<DataSource>('/api/data/reset', { body: {} }),
  setLive: (on: boolean) => call<DataSource>(`/api/live/${on ? 'start' : 'stop'}`, { body: {} }),
}

export const fmtDate = (d: string) => d.split('-').reverse().join('.')
export const fmtTs = (ts: string) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const num = (x: number, digits = 1) => x.toLocaleString('ru-RU', { maximumFractionDigits: digits })
