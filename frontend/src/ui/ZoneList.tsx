import { useEffect, useRef, useState } from 'react'
import type { Insights, Level, OutdoorZone, Plant, Selection, Zone } from '../types'
import { Icon } from './Icon'

const FLOW = ['containers', 'ckd', 'small_parts', 'welding', 'paint', 'plastic', 'pbs', 'assembly', 'qc', 'cud', 'testtrack', 'finished', 'cskt', 'ric', 'boiler']
const SUPPORT = ['cskt', 'ric', 'boiler']

export function ZoneList({ plant, status, selection, insights, open, onZone, onOutdoor, onClose, onOverview, onAnalytics, onDecisions }: {
  plant: Plant; status: Record<string, Level>; selection: Selection; insights: Insights; open: boolean
  onZone: (z: Zone) => void; onOutdoor: (z: OutdoorZone) => void; onClose: () => void
  onOverview: () => void; onAnalytics: () => void; onDecisions: () => void
}) {
  const [query, setQuery] = useState('')
  const sidebar = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return
      if (window.matchMedia('(min-width: 961px)').matches || open) {
        event.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [open])
  useEffect(() => {
    if (!open || !sidebar.current) return
    const previous = document.activeElement
    const panel = sidebar.current
    panel.querySelector<HTMLButtonElement>('.navigation-close')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href]')].filter(el => el.getClientRects().length)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    panel.addEventListener('keydown', trap)
    return () => { panel.removeEventListener('keydown', trap); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [open])
  const items = FLOW.flatMap((id) => {
    const z = plant.zones.find((x) => x.id === id)
    if (z) return [{ id, name: z.name, level: z.kpiArea ? status[z.kpiArea] : undefined, pick: () => onZone(z) }]
    const o = plant.outdoor.find((x) => x.id === id)
    return o ? [{ id, name: o.name, level: undefined, pick: () => onOutdoor(o) }] : []
  })
  const filtered = items.filter(it => it.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const alerts = insights.alerts.filter(a => a.level === 'bad').length
  return (
    <aside ref={sidebar} role={open ? 'dialog' : undefined} aria-modal={open || undefined} className="zonelist" id="plant-navigation" aria-label="Навигация по заводу">
      <div className="sidebar-brand"><span className="brand-logo">allur<span>®</span></span><span className="brand-product">DIGITAL TWIN</span><button className="navigation-close icon-button" onClick={onClose} aria-label="Закрыть список участков"><Icon name="close" /></button></div>
      <div className="plant-switch"><span className="plant-icon"><Icon name="factory" size={20} /></span><div><strong>Завод Allur</strong><span>Костанай · Казахстан</span></div><span className="plant-indicator" /></div>
      <nav className="primary-nav" aria-label="Основные разделы">
        <button className={!selection ? 'active' : ''} aria-current={!selection ? 'page' : undefined} onClick={onOverview}><Icon name="box" />Обзор завода<span className="nav-pill">3D</span></button>
        <button onClick={onAnalytics}><Icon name="chart" />Данные и аналитика</button>
        <button onClick={onDecisions}><Icon name="layers" />Центр решений{alerts > 0 && <span className="nav-count">{alerts}</span>}</button>
      </nav>
      <div className="navigation-heading"><h2>Участки завода</h2><span>{items.length}</span></div>
      <label className="zone-search"><Icon name="search" size={15} /><input ref={search} type="search" placeholder="Найти участок…" aria-label="Найти участок завода" value={query} onChange={e => setQuery(e.target.value)} /><kbd>/</kbd></label>
      <nav className="zone-scroll" aria-label="Производственные участки">
        {([false, true] as const).map(support => {
          const group = filtered.filter(it => SUPPORT.includes(it.id) === support)
          if (!group.length) return null
          return <div key={String(support)}><p className="panel-caption">{support ? 'Инфраструктура' : 'Производственный поток'}</p><ol>{group.map(it => <li key={it.id}>
            <button className={`zone-link${selection?.zone.id === it.id ? ' active' : ''}`} aria-current={selection?.zone.id === it.id ? 'location' : undefined} onClick={it.pick}>
              <span className="zl-num">{String(items.indexOf(it) + 1).padStart(2, '0')}</span><span className="zl-name">{it.name}</span>
              {it.level && <span className={`zl-status zl-${it.level}`} title={it.level === 'ok' ? 'В пределах нормы' : 'Есть отклонения'}><span className="sr-only">{it.level === 'ok' ? 'В пределах нормы' : 'Есть отклонения'}</span></span>}
            </button>
          </li>)}</ol></div>
        })}
        {!filtered.length && <div className="search-empty">Участки не найдены.<br /><button onClick={() => setQuery('')}>Сбросить поиск</button></div>}
      </nav>
      <div className="sidebar-footer"><span className="sidebar-footer-icon"><Icon name="info" size={18} /></span><div><strong>Демонстрационная модель</strong><span>На основе данных кейса Allur</span></div></div>
    </aside>
  )
}
