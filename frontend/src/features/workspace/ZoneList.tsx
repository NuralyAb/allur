import { useCallback, useEffect, useRef, useState } from 'react'
import type { Insights, Level, OutdoorZone, Plant, Selection, Zone } from '../../shared/types'
import { Icon, type IconName } from '../../shared/ui/Icon'
import './Sidebar.css'

type WorkspaceView = 'factory' | 'analytics' | 'decisions' | 'ai' | 'sources'
const GROUPS: { id: string; title: string; icon: IconName; ids: string[] }[] = [
  { id: 'supply', title: 'Поставка и склад', icon: 'box', ids: ['containers', 'ckd'] },
  { id: 'body', title: 'Кузов и окраска', icon: 'layers', ids: ['small_parts', 'welding', 'paint', 'plastic', 'pbs'] },
  { id: 'assembly', title: 'Сборка и качество', icon: 'target', ids: ['assembly', 'qc', 'cud', 'testtrack'] },
  { id: 'shipping', title: 'Готовые автомобили', icon: 'arrow-right', ids: ['finished'] },
  { id: 'support', title: 'Инфраструктура', icon: 'settings', ids: ['cskt', 'ric', 'boiler'] },
]
const LABELS: Record<string, string> = {
  containers: 'Контейнерный терминал', ckd: 'Склад комплектов', small_parts: 'Мелкоузловая сборка',
  welding: 'Сварка кузовов', paint: 'Окраска кузовов', plastic: 'Окраска пластика',
  pbs: 'Буфер кузовов', assembly: 'Сборка автомобилей', qc: 'Контроль качества',
  cud: 'Устранение дефектов', testtrack: 'Испытательная площадка', finished: 'Площадка отгрузки',
  cskt: 'Коммерческая техника', ric: 'Ремонт и лаборатория', boiler: 'Котельная',
}
const STATUS: Record<Level, string> = { ok: 'В норме', warn: 'Требует внимания', bad: 'Есть отклонение' }

export function ZoneList({ view, plant, status, selection, insights, open, collapsed, onToggleCollapse, onExpand, onZone, onOutdoor, onClose, onOverview, onAnalytics, onDecisions, onAi, onSource }: {
  view: WorkspaceView; plant: Plant; status: Record<string, Level>; selection: Selection; insights: Insights; open: boolean
  collapsed: boolean; onToggleCollapse: () => void; onExpand: () => void
  onZone: (z: Zone) => void; onOutdoor: (z: OutdoorZone) => void; onClose: () => void
  onOverview: () => void; onAnalytics: () => void; onDecisions: () => void; onAi: () => void; onSource: () => void
}) {
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const sidebar = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const pendingSearch = useRef(false)
  const closeNavigation = useRef(onClose)
  closeNavigation.current = onClose
  const factory = view === 'factory'
  const openSearch = useCallback(() => {
    pendingSearch.current = true
    if (window.matchMedia('(min-width: 961px)').matches && collapsed) onExpand()
    if (!factory) onOverview()
    else if (search.current?.getClientRects().length) {
      search.current.focus()
      pendingSearch.current = false
    }
  }, [collapsed, factory, onExpand, onOverview])
  useEffect(() => {
    if (factory && pendingSearch.current && search.current?.getClientRects().length) {
      search.current.focus()
      pendingSearch.current = false
    }
  }, [factory, collapsed, open])
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return
      if (window.matchMedia('(min-width: 961px)').matches || open) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [open, openSearch])
  useEffect(() => {
    if (!open || !sidebar.current) return
    const previous = document.activeElement
    const panel = sidebar.current
    panel.querySelector<HTMLButtonElement>('.navigation-close')?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeNavigation.current(); return }
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
  useEffect(() => {
    if (!selection) return
    const group = GROUPS.find((entry) => entry.ids.includes(selection.zone.id))
    if (group) setOpenGroups((current) => new Set([...current, group.id]))
  }, [selection])
  const items = GROUPS.flatMap((group) => group.ids).flatMap((id) => {
    const zone = plant.zones.find((candidate) => candidate.id === id)
    if (zone) return [{ id, name: zone.name, label: LABELS[id] ?? zone.short, level: zone.kpiArea ? status[zone.kpiArea] : undefined, pick: () => onZone(zone) }]
    const outdoor = plant.outdoor.find((candidate) => candidate.id === id)
    return outdoor ? [{ id, name: outdoor.name, label: LABELS[id] ?? outdoor.short, level: undefined, pick: () => onOutdoor(outdoor) }] : []
  })
  const term = query.trim().toLocaleLowerCase('ru')
  const filtered = items.filter(item => (item.name + ' ' + item.label).toLocaleLowerCase('ru').includes(term))
  const alerts = insights.alerts.filter(alert => alert.level === 'bad').length
  const sections: { id: WorkspaceView; title: string; subtitle: string; icon: IconName; pick: () => void }[] = [
    { id: 'factory', title: 'Завод в 3D', subtitle: 'Цеха и территория', icon: 'box', pick: onOverview },
    { id: 'analytics', title: 'Аналитика', subtitle: 'Показатели и простои', icon: 'chart', pick: onAnalytics },
    { id: 'decisions', title: 'Центр решений', subtitle: 'Отклонения и сценарии', icon: 'layers', pick: onDecisions },
    { id: 'ai', title: 'ИИ-аналитик', subtitle: 'Прогноз отказов и ассистент', icon: 'spark', pick: onAi },
    { id: 'sources', title: 'Источники данных', subtitle: 'Импорт и подключения', icon: 'grid', pick: onSource },
  ]
  const toggle = (id: string) => setOpenGroups((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  return (
    <aside ref={sidebar} role={open ? 'dialog' : undefined} aria-modal={open || undefined} className={`zonelist${factory ? ' zonelist-factory' : ''}`} id="plant-navigation" aria-label="Навигация по заводу">
      <div className="sidebar-brand">
        <div className="sidebar-wordmark"><span className="brand-logo">allur<span>®</span></span><span className="sidebar-product">Цифровой двойник</span></div>
        <button className="sidebar-collapse" onClick={onToggleCollapse} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'} aria-expanded={!collapsed} aria-controls="sidebar-content"><Icon name={collapsed ? 'arrow-right' : 'arrow-left'} size={18} /></button>
        <button className="navigation-close icon-button" onClick={onClose} aria-label="Закрыть навигацию"><Icon name="close" /></button>
      </div>
      <div className="plant-switch"><span className="plant-icon"><Icon name="factory" size={20} /></span><div><strong>Автомобильный завод</strong><span>Костанай · Казахстан</span></div></div>
      <div className="sidebar-content" id="sidebar-content">
        <p className="sidebar-section-label">Рабочее пространство</p>
        <nav className="primary-nav" aria-label="Основные разделы">
          {sections.map(section => <button key={section.id} className={view === section.id ? 'active' : ''} aria-label={section.title} aria-describedby={section.id === 'decisions' && alerts > 0 ? 'sidebar-alert-count' : undefined} title={section.title} aria-current={view === section.id ? 'page' : undefined} onClick={section.pick}>
            <span className="sidebar-nav-icon"><Icon name={section.icon} size={19} /></span>
            <span className="sidebar-nav-copy"><strong>{section.title}</strong><small>{section.subtitle}</small></span>
            {section.id === 'decisions' && alerts > 0 ? <span className="nav-count" id="sidebar-alert-count" aria-label={`Критических отклонений: ${alerts}`}>{alerts}</span> : view === section.id && <span className="sidebar-active-mark" />}
          </button>)}
        </nav>
        <button className="sidebar-compact-search" onClick={openSearch} aria-label="Найти участок завода" title="Найти участок завода · /"><Icon name="search" size={19} /></button>
        {factory ? <section className="sidebar-zones" aria-labelledby="sidebar-zones-title">
          <div className="navigation-heading"><h2 id="sidebar-zones-title">Участки завода</h2><span>{items.length}</span></div>
          <div className="zone-search"><Icon name="search" size={17} /><input ref={search} type="search" placeholder="Найти участок" aria-label="Найти участок завода" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button className="sidebar-search-clear" onClick={() => { setQuery(''); search.current?.focus() }} aria-label="Очистить поиск"><Icon name="close" size={15} /></button> : <kbd>/</kbd>}</div>
          <nav className="zone-scroll" aria-label="Производственные участки">
            {GROUPS.map(group => {
              const groupItems = filtered.filter(item => group.ids.includes(item.id))
              if (!groupItems.length) return null
              const expanded = !!term || openGroups.has(group.id)
              const heading = <><Icon name={group.icon} size={16} /><span>{group.title}</span><span className="sidebar-group-count">{groupItems.length}</span>{!term && <Icon className={expanded ? 'sidebar-chevron expanded' : 'sidebar-chevron'} name="chevron-right" size={14} />}</>
              return <div className="sidebar-zone-group" key={group.id}>
                {term ? <h3 className="sidebar-group-toggle">{heading}</h3> : <button className="sidebar-group-toggle" aria-expanded={expanded} aria-controls={`sidebar-group-${group.id}`} onClick={() => toggle(group.id)}>{heading}</button>}
                <ol id={`sidebar-group-${group.id}`} hidden={!expanded}>{groupItems.map(item => <li key={item.id}>
                  <button className={`zone-link${selection?.zone.id === item.id ? ' active' : ''}`} title={item.name} aria-current={selection?.zone.id === item.id ? 'location' : undefined} onClick={item.pick}>
                    <span className="sidebar-zone-stem" /><span className="zl-name">{item.label}</span>
                    {item.level && <span className={`zl-status zl-${item.level}`} title={STATUS[item.level]}><span className="sr-only">{STATUS[item.level]}</span></span>}
                  </button>
                </li>)}</ol>
              </div>
            })}
            {!filtered.length && <div className="search-empty">По запросу «{query}» ничего не найдено.<button onClick={() => setQuery('')}>Показать все участки</button></div>}
          </nav>
          <div className="sidebar-status-key" aria-label="Статусы участков"><span><i className="zl-ok" />В норме</span><span><i className="zl-warn" />Внимание</span><span><i className="zl-bad" />Отклонение</span></div>
        </section> : <div className="sidebar-workspace-hint"><Icon name="pin" size={19} /><p>Участки и территория доступны в разделе <button onClick={onOverview}>«Завод в 3D»<Icon name="arrow-right" size={14} /></button></p></div>}
      </div>
      <div className="sidebar-footer" title="Демонстрационная модель · Данные кейса Allur"><span className="sidebar-footer-icon"><Icon name="info" size={18} /></span><div><strong>Демонстрационная модель</strong><span>Данные кейса Allur</span></div></div>
    </aside>
  )
}
