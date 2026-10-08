import { useEffect, useRef, useState } from 'react'
import type { Alert } from '../../shared/types'
import { attached, cycleOf, type CarSelection } from '../../scene/vehicles/carUnits'
import type { SimulationSnapshot } from '../simulation/types'
import { scenePassport, simPassport, type SimMemory, type UnitLive } from './carPassport'
import { Icon } from '../../shared/ui/Icon'
import './CarPanel.css'

const STATUS_COLOR = { ok: '#278261', warn: '#c48a1c', bad: '#d94b3f', done: '#3d6fb6', neutral: '#8a94a3' }

/** Карточка выбранной машины: идентификация, где она, сколько осталось и что мешает. */
export function CarPanel({ car, alerts, simulation, following, onFollow, onZone, onClose }: {
  car: CarSelection
  alerts: Alert[]
  simulation: SimulationSnapshot | null
  following: boolean
  onFollow: (on: boolean) => void
  /** переход к карточке участка; нет в режиме симуляции */
  onZone?: (id: string) => void
  onClose: () => void
}) {
  // Машина движется по сцене: положение читается из её корня дважды в секунду.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  const memory = useRef<SimMemory>({})
  useEffect(() => {
    const id = car.unit.body
    if (!simulation || !id) return
    const vehicle = simulation.vehicles.find((v) => v.id === id)
    if (vehicle) memory.current.stage = vehicle.stage
    const finished = simulation.finishedVehicles.find((v) => v.id === id)
    if (finished) memory.current.finishedAt = finished.finishedAt
  }, [simulation, car.unit.body])

  const root = car.root
  const live: UnitLive | null = root && attached(root) ? { progress: root.userData.progress ?? 0, station: root.userData.station ?? 0, cycle: cycleOf(root) } : null
  const p = car.unit.place === 'sim' ? simPassport(car.unit, simulation, memory.current) : scenePassport(car, live, alerts)
  const percent = Math.round(p.progress * 100)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t) }, [copied])
  const copy = () => { void navigator.clipboard?.writeText(p.vin).then(() => setCopied(true), () => undefined) }

  return (
    <aside className="zonepanel carpanel" aria-labelledby="carpanel-title" style={{ borderTopColor: STATUS_COLOR[p.status.level] }} data-testid="car-panel">
      <div className="zonepanel-heading">
        <div className="car-heading-actions">
          {p.live && <button type="button" className={`icon-button${following ? ' selected' : ''}`} aria-pressed={following} onClick={() => onFollow(!following)} aria-label="Следить камерой за машиной" title={following ? 'Камера следует за машиной. Нажмите, чтобы остановить' : 'Следить камерой за машиной'}><Icon name="target" /></button>}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть карточку автомобиля"><Icon name="close" /></button>
        </div>
        <div className="zp-kind"><Icon name="car" />Автомобиль</div>
        <h2 id="carpanel-title">{p.model}</h2>
        <div className="car-ident">
          <span className="car-color"><i style={{ background: car.unit.color }} />{p.colorName}</span>
          <span className="car-vin">
            <span>VIN</span>
            <code title={p.vin}>{p.vin.slice(0, 9)}<b>{p.vin.slice(9)}</b></code>
            <button type="button" className={`car-copy${copied ? ' copied' : ''}`} onClick={copy} aria-label="Скопировать VIN" title={copied ? 'Скопировано' : 'Скопировать VIN'}><Icon name={copied ? 'check' : 'copy'} size={13} /></button>
          </span>
        </div>
      </div>
      <div className="zonepanel-content">
        <div className={`car-status car-status-${p.status.level}`} role="status">
          <span className="car-status-dot" />
          <div><strong>{p.status.title}</strong>{p.status.detail && <span>{p.status.detail}</span>}</div>
          {p.zone && onZone && <button type="button" className="car-zone" onClick={() => onZone(p.zone!)} aria-label="Открыть карточку участка" title="Карточка участка"><Icon name="chevron-right" size={15} /></button>}
        </div>

        {p.issues.length > 0 && <section>
          <h3 className="panel-caption">Требует внимания</h3>
          <ul className="alerts compact">
            {p.issues.map((issue) => <li key={issue.title} className={`alert alert-${issue.level}`}><b>{issue.title}</b><span>{issue.text}</span></li>)}
          </ul>
        </section>}

        <section className="car-route" aria-label="Маршрут по заводу">
          <div className="car-progress-top"><span>{p.released ? 'Производство завершено' : 'Готовность'}</span><b>{percent}%</b></div>
          <div className="car-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Готовность автомобиля"><span style={{ width: `${percent}%`, background: STATUS_COLOR[p.status.level] }} /></div>
          <ol className="car-steps">
            {p.steps.map((step) => <li key={step.label} className={`step-${step.state}`} style={step.state === 'issue' ? { color: STATUS_COLOR[p.status.level] } : undefined}>
              <i aria-hidden="true">{step.state === 'done' ? <Icon name="check" size={10} /> : null}</i>
              <span>{step.label}</span>
              <small>{step.note}</small>
            </li>)}
          </ol>
        </section>

        {p.dates.length > 0 && <section>
          <h3 className="panel-caption">Заказ и сроки</h3>
          <dl className="facts car-dates">
            {p.dates.map((d) => <div key={d.label}><dt>{d.label}</dt><dd className={d.level ? `is-${d.level}` : undefined}>{d.value}{d.note && <small>{d.note}</small>}</dd></div>)}
          </dl>
        </section>}
        <p className="car-source"><Icon name="info" size={12} />{p.source}</p>
      </div>
    </aside>
  )
}
