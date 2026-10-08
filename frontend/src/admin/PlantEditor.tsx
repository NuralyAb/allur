import { useEffect, useMemo, useState } from 'react'
import type { Fact, OutdoorZone, Zone } from '../shared/types'
import { Icon } from '../shared/ui/Icon'
import type { Notify } from './AdminApp'
import { api, type PlantAdmin } from './api'

type ZoneDraft = Pick<Zone, 'name' | 'short' | 'rect' | 'color' | 'kpiArea' | 'description'>
type OutdoorDraft = Pick<OutdoorZone, 'name' | 'short' | 'center' | 'size' | 'color' | 'description'>
const ZONE_KEYS: (keyof ZoneDraft)[] = ['name', 'short', 'rect', 'color', 'kpiArea', 'description']
const OUTDOOR_KEYS: (keyof OutdoorDraft)[] = ['name', 'short', 'center', 'size', 'color', 'description']

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const pick = <T, K extends keyof T>(o: T, keys: K[]): Pick<T, K> => Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>

/**
 * Патч — только поля, отличающиеся от того, что видит двойник сейчас. Значение, совпадающее с исходным
 * паспортом, отправляется пустым: сервер снимает правку, а не хранит копию исходного.
 */
function diff<T extends object>(draft: Record<string, T>, current: Record<string, T>, original: Record<string, T>, keys: (keyof T)[]) {
  const patch: Record<string, Record<string, unknown>> = {}
  for (const id of Object.keys(draft)) {
    for (const k of keys) {
      if (same(draft[id][k], current[id][k])) continue
      patch[id] = { ...patch[id], [k as string]: same(draft[id][k], original[id][k]) ? '' : draft[id][k] }
    }
  }
  return patch
}

export function PlantEditor({ notify }: { notify: Notify }) {
  const [data, setData] = useState<PlantAdmin | null>(null)
  const [zones, setZones] = useState<Record<string, ZoneDraft>>({})
  const [outdoor, setOutdoor] = useState<Record<string, OutdoorDraft>>({})
  const [head, setHead] = useState({ name: '', address: '' })
  const [facts, setFacts] = useState<Fact[]>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = () => api.plant().then((d) => {
    setData(d)
    setZones(Object.fromEntries(d.plant.zones.map((z) => [z.id, pick(z, ZONE_KEYS)])))
    setOutdoor(Object.fromEntries(d.plant.outdoor.map((z) => [z.id, pick(z, OUTDOOR_KEYS)])))
    setHead({ name: d.plant.name, address: d.plant.address })
    setFacts(d.plant.facts.map((f) => ({ ...f })))
  }, (e: Error) => notify({ kind: 'bad', text: e.message }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const current = useMemo(() => ({
    zones: Object.fromEntries((data?.plant.zones ?? []).map((z) => [z.id, pick(z, ZONE_KEYS)])),
    outdoor: Object.fromEntries((data?.plant.outdoor ?? []).map((z) => [z.id, pick(z, OUTDOOR_KEYS)])),
  }), [data])
  const original = useMemo(() => ({
    zones: Object.fromEntries((data?.original.zones ?? []).map((z) => [z.id, pick(z, ZONE_KEYS)])),
    outdoor: Object.fromEntries((data?.original.outdoor ?? []).map((z) => [z.id, pick(z, OUTDOOR_KEYS)])),
  }), [data])

  if (!data) return <p className="muted">Загрузка…</p>

  const patch = {
    zones: diff(zones, current.zones, original.zones, ZONE_KEYS),
    outdoor: diff(outdoor, current.outdoor, original.outdoor, OUTDOOR_KEYS),
    ...(head.name !== data.plant.name && { name: head.name === data.original.name ? '' : head.name }),
    ...(head.address !== data.plant.address && { address: head.address === data.original.address ? '' : head.address }),
    ...(!same(facts, data.plant.facts) && { facts: same(facts, data.original.facts) ? null : facts }),
  }
  const dirty = Object.keys(patch.zones).length > 0 || Object.keys(patch.outdoor).length > 0 || 'name' in patch || 'address' in patch || 'facts' in patch
  const changedFromOriginal = (id: string, group: 'zones' | 'outdoor') => !same((group === 'zones' ? zones : outdoor)[id], original[group][id])

  const save = async () => {
    setBusy(true)
    try {
      await api.savePlant(patch as Parameters<typeof api.savePlant>[0])
      notify({ kind: 'ok', text: 'Паспорт завода сохранён. Двойник применит правки после обновления страницы.' })
      await load()
    } catch (e) {
      notify({ kind: 'bad', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    if (!window.confirm('Вернуть паспорт завода к данным из открытых источников? Все правки будут удалены.')) return
    setBusy(true)
    try { await api.resetPlant(); notify({ kind: 'ok', text: 'Паспорт возвращён к исходному' }); await load() } catch (e) { notify({ kind: 'bad', text: (e as Error).message }) } finally { setBusy(false) }
  }
  const setZone = (id: string, field: keyof ZoneDraft, value: unknown) => setZones((z) => ({ ...z, [id]: { ...z[id], [field]: value } }))
  const setOut = (id: string, field: keyof OutdoorDraft, value: unknown) => setOutdoor((z) => ({ ...z, [id]: { ...z[id], [field]: value } }))
  const numAt = (arr: number[], i: number, v: string) => arr.map((x, j) => (j === i ? Number(v) : x))
  const hall = data.plant.hall

  return (
    <>
      <div className="toolbar">
        <p className="muted">Правки хранятся отдельно от исходного паспорта (OpenStreetMap, проект НДВ, открытые источники) и накладываются сверху. Координаты участков — в системе корпуса: u вдоль длинной стены 0–{hall.length} м, v поперёк 0–{hall.width} м.</p>
        <div className="row">
          <button className="button-primary" disabled={!dirty || busy} onClick={save}><Icon name="check" size={15} />Сохранить</button>
          <button className="button-secondary" disabled={!dirty || busy} onClick={load}>Отменить</button>
          <button className="text-button danger" disabled={busy || !data.plant.customized} onClick={reset}><Icon name="rotate" size={14} />Сбросить к источникам</button>
          <a className="button-secondary" href="/" target="_blank" rel="noreferrer"><Icon name="box" size={14} />Открыть двойник</a>
        </div>
      </div>
      <section className="panel">
        <h2>Завод</h2>
        <div className="grid-2">
          <label>Название<input value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} maxLength={120} /></label>
          <label>Адрес<input value={head.address} onChange={(e) => setHead({ ...head, address: e.target.value })} maxLength={120} /></label>
        </div>
        <h3>Факты в карточке завода</h3>
        <table className="table editable">
          <thead><tr><th>Показатель</th><th>Значение</th><th>Источник</th><th /></tr></thead>
          <tbody>
            {facts.map((f, i) => (
              <tr key={i}>
                <td><input value={f.label} onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={60} /></td>
                <td><input value={f.value} onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} maxLength={120} /></td>
                <td><select value={f.source ?? ''} onChange={(e) => setFacts(facts.map((x, j) => (j === i ? { ...x, source: e.target.value || undefined } : x)))}><option value="">—</option>{Object.entries(data.plant.sources).map(([k, s]) => <option key={k} value={k}>{s.title.slice(0, 40)}</option>)}</select></td>
                <td><button className="icon-button" aria-label="Удалить факт" onClick={() => setFacts(facts.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="text-button" disabled={facts.length >= 12} onClick={() => setFacts([...facts, { label: '', value: '' }])}>+ Добавить факт</button>
      </section>
      <section className="panel">
        <h2>Участки корпуса <small className="muted">{data.plant.zones.length}</small></h2>
        <table className="table editable">
          <thead><tr><th>Участок</th><th>Короткое</th><th>KPI-участок</th><th>Цвет</th><th>u0</th><th>u1</th><th>v0</th><th>v1</th><th /></tr></thead>
          <tbody>
            {data.plant.zones.map((z) => {
              const d = zones[z.id]
              const changed = changedFromOriginal(z.id, 'zones')
              return [
                <tr key={z.id} className={changed ? 'changed' : ''}>
                  <td><input value={d.name} onChange={(e) => setZone(z.id, 'name', e.target.value)} maxLength={80} /><small className="muted">{z.id} · {z.basis === 'ndv' ? 'по НДВ' : 'по логике'}{changed && ' · изменено'}</small></td>
                  <td><input value={d.short} onChange={(e) => setZone(z.id, 'short', e.target.value)} maxLength={80} className="narrow" /></td>
                  <td><select value={d.kpiArea ?? ''} onChange={(e) => setZone(z.id, 'kpiArea', e.target.value || null)}><option value="">—</option>{data.kpiAreas.map((a) => <option key={a} value={a}>{a}</option>)}</select></td>
                  <td><input type="color" value={d.color} onChange={(e) => setZone(z.id, 'color', e.target.value)} aria-label={`Цвет: ${d.name}`} /></td>
                  {d.rect.map((v, i) => <td key={i}><input type="number" value={v} onChange={(e) => setZone(z.id, 'rect', numAt(d.rect, i, e.target.value))} className="num" step={1} /></td>)}
                  <td><button className="icon-button" aria-expanded={open === z.id} aria-label="Описание" onClick={() => setOpen(open === z.id ? null : z.id)}><Icon name={open === z.id ? 'close' : 'info'} size={14} /></button></td>
                </tr>,
                open === z.id && <tr key={`${z.id}-desc`} className="desc"><td colSpan={9}><label>Описание<textarea value={d.description} onChange={(e) => setZone(z.id, 'description', e.target.value)} maxLength={400} rows={3} /></label></td></tr>,
              ]
            })}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Открытые площадки <small className="muted">{data.plant.outdoor.length}</small></h2>
        <table className="table editable">
          <thead><tr><th>Площадка</th><th>Короткое</th><th>Цвет</th><th>Центр x</th><th>Центр y</th><th>Длина</th><th>Ширина</th><th /></tr></thead>
          <tbody>
            {data.plant.outdoor.map((z) => {
              const d = outdoor[z.id]
              const changed = changedFromOriginal(z.id, 'outdoor')
              return [
                <tr key={z.id} className={changed ? 'changed' : ''}>
                  <td><input value={d.name} onChange={(e) => setOut(z.id, 'name', e.target.value)} maxLength={80} /><small className="muted">{z.id}{changed && ' · изменено'}</small></td>
                  <td><input value={d.short} onChange={(e) => setOut(z.id, 'short', e.target.value)} maxLength={80} className="narrow" /></td>
                  <td><input type="color" value={d.color} onChange={(e) => setOut(z.id, 'color', e.target.value)} aria-label={`Цвет: ${d.name}`} /></td>
                  {d.center.map((v, i) => <td key={`c${i}`}><input type="number" value={v} onChange={(e) => setOut(z.id, 'center', numAt(d.center, i, e.target.value))} className="num" /></td>)}
                  {d.size.map((v, i) => <td key={`s${i}`}><input type="number" value={v} onChange={(e) => setOut(z.id, 'size', numAt(d.size, i, e.target.value))} className="num" min={1} /></td>)}
                  <td><button className="icon-button" aria-expanded={open === z.id} aria-label="Описание" onClick={() => setOpen(open === z.id ? null : z.id)}><Icon name={open === z.id ? 'close' : 'info'} size={14} /></button></td>
                </tr>,
                open === z.id && <tr key={`${z.id}-desc`} className="desc"><td colSpan={8}><label>Описание<textarea value={d.description} onChange={(e) => setOut(z.id, 'description', e.target.value)} maxLength={400} rows={3} /></label></td></tr>,
              ]
            })}
          </tbody>
        </table>
        <p className="muted small">Координаты площадок — в метрах от точки привязки площадки: x на восток, y на север. Модели автомобилей, оборудование и GLB-файлы задаются в коде сцены и манифесте моделей (<code>frontend/public/models/manifest.json</code>).</p>
      </section>
    </>
  )
}
