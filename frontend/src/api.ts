import type { Kpi, Plant, Site } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export async function loadAll(): Promise<{ plant: Plant; site: Site; kpi: Kpi }> {
  const [plant, site, kpi] = await Promise.all([
    get<Plant>('/api/plant'),
    get<Site>('/api/site'),
    get<Kpi>('/api/kpi'),
  ])
  return { plant, site, kpi }
}
