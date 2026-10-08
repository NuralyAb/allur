/** Вызовы API цифрового двойника: паспорт завода, показатели, решения, источник данных. */
import type { DataSource, Insights, Kpi, Plant, ScenarioResult, Site } from '../types'
import { get, post, postJson } from './client'

export async function loadAll(): Promise<{ plant: Plant; site: Site; kpi: Kpi; insights: Insights }> {
  const [plant, site, kpi, insights] = await Promise.all([
    get<Plant>('/api/plant'),
    get<Site>('/api/site'),
    get<Kpi>('/api/kpi'),
    get<Insights>('/api/insights'),
  ])
  return { plant, site, kpi, insights }
}

export const runScenario = (body: { levers: string[]; shifts: number; days: number; extraShifts: number }, signal?: AbortSignal) =>
  postJson<ScenarioResult>('/api/scenario', body, signal)

export const loadData = () => Promise.all([get<Kpi>('/api/kpi'), get<Insights>('/api/insights'), get<DataSource>('/api/data/source')])
export const loadSource = () => get<DataSource>('/api/data/source')
export const TEMPLATE_URL = '/api/data/template'

export function importFile(file: File, mode: 'merge' | 'replace') {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  return post<DataSource & { imported: Record<string, number> }>('/api/data/import', form)
}
export const resetData = () => post<DataSource>('/api/data/reset')
export const setLive = (on: boolean) => post<DataSource>(`/api/live/${on ? 'start' : 'stop'}`)
