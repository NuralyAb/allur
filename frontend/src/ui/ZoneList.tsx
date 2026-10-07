import type { OutdoorZone, Plant, Selection, Zone } from '../types'

/** Порядок по технологическому потоку. */
const FLOW = ['containers', 'ckd', 'small_parts', 'welding', 'paint', 'plastic', 'pbs', 'assembly', 'qc', 'cud', 'testtrack', 'finished', 'cskt', 'ric', 'boiler']

export function ZoneList({
  plant,
  selection,
  onZone,
  onOutdoor,
  onClose,
}: {
  plant: Plant
  selection: Selection
  onZone: (z: Zone) => void
  onOutdoor: (z: OutdoorZone) => void
  onClose: () => void
}) {
  const items = FLOW.map((id) => {
    const z = plant.zones.find((x) => x.id === id)
    if (z) return { id, name: z.name, color: z.color, pick: () => onZone(z) }
    const o = plant.outdoor.find((x) => x.id === id)
    if (o) return { id, name: o.name, color: o.color, pick: () => onOutdoor(o) }
    return null
  }).filter((x) => x !== null)

  return (
    <nav className="zonelist" id="plant-navigation" aria-label="Участки завода">
      <div className="navigation-heading"><div><span className="eyebrow">Навигация по заводу</span><h2>Участки</h2></div><button className="navigation-close icon-button" onClick={onClose} aria-label="Закрыть список участков">×</button></div>
      <div className="panel-caption">Производственный поток · {items.length}</div>
      <ol>
        {items.map((it, i) => (
          <li key={it.id}>
            <button className={selection?.zone.id === it.id ? 'active' : ''} aria-current={selection?.zone.id === it.id ? 'location' : undefined} onClick={it.pick}>
              <span className="zl-num" style={{ color: it.color }}>
                {i + 1}
              </span>
              <span className="zl-name">{it.name}</span><span className="zl-arrow" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
