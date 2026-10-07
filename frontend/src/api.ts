import type { DataSource, Insights, Kpi, Plant, ScenarioResult, Site } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadAll(): Promise<{ plant: Plant; site: Site; kpi: Kpi; insights: Insights }> {
  const [plant, site, kpi, insights] = await Promise.all([
    get<Plant>('/api/plant'),
    get<Site>('/api/site'),
    get<Kpi>('/api/kpi'),
    get<Insights>('/api/insights'),
  ])
  return { plant, site, kpi, insights }
}

export async function runScenario(body: { levers: string[]; shifts: number; days: number; extraShifts: number }, signal?: AbortSignal): Promise<ScenarioResult> {
  const res = await fetch('/api/scenario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) throw new Error(`/api/scenario: HTTP ${res.status}`)
  return res.json() as Promise<ScenarioResult>
}

export const loadData = () => Promise.all([get<Kpi>('/api/kpi'), get<Insights>('/api/insights'), get<DataSource>('/api/data/source')])
export const loadSource = () => get<DataSource>('/api/data/source')
export const TEMPLATE_URL = '/api/data/template'

async function post<T>(path: string, body?: BodyInit): Promise<T> {
  const res = await fetch(path, { method: 'POST', body })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const errors: string[] = json?.detail?.errors ?? [typeof json?.detail === 'string' ? json.detail : `${path}: HTTP ${res.status}`]
    throw Object.assign(new Error(errors.join('\n')), { errors })
  }
  return json as T
}

export function importFile(file: File, mode: 'merge' | 'replace') {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  return post<DataSource & { imported: Record<string, number> }>('/api/data/import', form)
}
export const resetData = () => post<DataSource>('/api/data/reset')
export const setLive = (on: boolean) => post<DataSource>(`/api/live/${on ? 'start' : 'stop'}`)
