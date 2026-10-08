import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Prio, StateChip } from './parts'
import { api, type ScadaConfig, type ScadaState } from './scada'
import './zone-controllers.css'

let configPromise: Promise<ScadaConfig> | null = null
const loadConfig = () => (configPromise ??= api.config().catch((e) => { configPromise = null; throw e }))

/** Контроллеры участка в карточке цифрового двойника: состояние ПЛК, тревоги и переход в пульт HMI. */
export function ZoneControllers({ zone }: { zone: string }) {
  const [config, setConfig] = useState<ScadaConfig | null>(null)
  const [state, setState] = useState<ScadaState | null>(null)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let alive = true
    loadConfig().then((c) => alive && setConfig(c), () => alive && setOffline(true))
    const tick = () => api.state().then((s) => { if (alive) { setState(s); setOffline(false) } }, () => alive && setOffline(true))
    tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  const items = config?.controllers.filter((c) => c.zone === zone) ?? []
  if (!items.length) return null
  return (
    <section className="panel-section zc">
      <div className="zc-head"><h3 className="panel-caption">Оборудование и управление</h3><span className="zc-source">{offline ? 'нет связи со SCADA' : `ПЛК · ${config?.mode === 'plant' ? 'завод' : 'симулятор'}`}</span></div>
      <ul className="zc-list">
        {items.map((c) => {
          const alarms = (state?.alarms ?? []).filter((a) => a.controller === c.id && !a.shelvedUntil).sort((a, b) => a.priority - b.priority)
          return (
            <li key={c.id}>
              <a href={`/hmi.html?c=${encodeURIComponent(c.id)}`} target="allur-hmi" title={`Открыть пульт: ${c.name}`}>
                <span className="zc-name"><b>{c.equipment}</b><small>{c.name}</small></span>
                {alarms[0] && <span className="zc-alarm"><Prio alarm={alarms[0]} compact />{alarms[0].message.split('.')[0]}</span>}
                <StateChip st={state?.controllers[c.id]} />
              </a>
            </li>
          )
        })}
      </ul>
      <a className="zc-open" href="/hmi.html" target="allur-hmi">Пульт управления линиями<Icon name="arrow-right" size={14} /></a>
    </section>
  )
}
