import type { OutdoorZone, Plant, Selection, Zone } from '../types'

/** Порядок по технологическому потоку. */
const FLOW = ['containers', 'ckd', 'small_parts', 'welding', 'paint', 'plastic', 'pbs', 'assembly', 'qc', 'testtrack', 'finished']

export function ZoneList({
  plant,
  selection,
  onZone,
  onOutdoor,
}: {
  plant: Plant
  selection: Selection
  onZone: (z: Zone) => void
  onOutdoor: (z: OutdoorZone) => void
}) {
  const items = FLOW.map((id) => {
    const z = plant.zones.find((x) => x.id === id)
    if (z) return { id, name: z.name, color: z.color, pick: () => onZone(z) }
    const o = plant.outdoor.find((x) => x.id === id)
    if (o) return { id, name: o.name, color: o.color, pick: () => onOutdoor(o) }
    return null
  }).filter((x) => x !== null)

  return (
    <nav className="zonelist">
      <div className="panel-caption">Производственный поток</div>
      <ol>
        {items.map((it, i) => (
          <li key={it.id}>
            <button className={selection?.zone.id === it.id ? 'active' : ''} onClick={it.pick}>
              <span className="zl-num" style={{ background: it.color }}>
                {i + 1}
              </span>
              {it.name}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
