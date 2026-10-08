import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadAll, loadData } from './api'
import { Scene, outdoorShot, overviewShot, zoneShot, type Shot } from './scene/Scene'
import { hallToWorld } from './scene/geo'
import { buildTour } from './scene/tour'
import type { Alert, DataSource, Insights, Kpi, Level, LiveState, OutdoorZone, Plant, Selection, Site, Zone } from './types'
import { TopBar, KpiCards, SimulationKpiCards, fmtDate } from './ui/TopBar'
import { Icon } from './ui/Icon'
import { SceneBoundary } from './ui/SceneBoundary'
import type { LightMood } from './scene/Lighting'
import { TourBar } from './ui/TourBar'
import { ZoneList } from './ui/ZoneList'
import { ZonePanel } from './ui/ZonePanel'
import { AnalyticsPanel } from './ui/AnalyticsPanel'
import { DecisionsPanel } from './ui/DecisionsPanel'
import { SourcePanel } from './ui/SourcePanel'
import { LiveStrip } from './ui/LiveStrip'
import { useSimulation } from './simulation/useSimulation'
import { SimulationPanel, SimulationTransport } from './ui/SimulationPanel'
import type { Stage } from './simulation/types'
import type { Object3D } from 'three'
import { cycleOf, unitOf, type CarSelection, type UnitPlace } from './scene/carUnits'
import { CarPanel } from './ui/CarPanel'
import { useAlarmSummaryKey } from './hmi/scada'

const STEP_MS = 9000
/** Машины внутри корпуса: под кровлей они не отображаются. */
const INTERIOR = new Set<UnitPlace>(['welding', 'paint', 'pbs', 'assembly', 'qc'])
type WorkspaceView = 'factory' | 'analytics' | 'decisions' | 'sources'
const VIEW_TITLES: Record<WorkspaceView, string> = { factory: 'Завод в 3D', analytics: 'Аналитика', decisions: 'Центр решений', sources: 'Источники данных' }

export default function App() {
  const [data, setData] = useState<{ plant: Plant; site: Site; kpi: Kpi; insights: Insights } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    loadAll().then(setData, (e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  if (error) return <div className="splash"><div className="brand-logo">allur<span>®</span></div><span className="splash-kicker">DIGITAL TWIN PLATFORM</span><div className="splash-card"><Icon name="alert" size={32} /><h1>Данные временно недоступны</h1><p>Не удалось подключиться к серверу завода.<br />Проверьте соединение и попробуйте ещё раз.</p><button className="button-primary" onClick={load}><Icon name="rotate" size={16} />Повторить загрузку</button><details><summary>Подробности подключения</summary><p>{error}</p></details></div></div>
  if (!data) return <div className="splash" role="status"><div className="brand-logo">allur<span>®</span></div><span className="splash-kicker">DIGITAL TWIN PLATFORM</span><div className="loading-line" /><p>Подготавливаем цифровой двойник…</p></div>
  return <Twin {...data} />
}

/** Подписка на поток /api/stream: ход смены и версия хранилища. */
function useLive() {
  const [live, setLiveState] = useState<LiveState | null>(null)
  useEffect(() => {
    const es = new EventSource('/api/stream')
    let last = ''
    // без симуляции сервер шлёт одно и то же раз в секунду — не перерисовываем
    es.onmessage = (e) => { if (e.data !== last) { last = e.data; setLiveState(JSON.parse(e.data) as LiveState) } }
    return () => es.close()
  }, [])
  return live
}

function Twin({ plant, site, ...initial }: { plant: Plant; site: Site; kpi: Kpi; insights: Insights }) {
  const [{ kpi, insights, source }, setData] = useState<{ kpi: Kpi; insights: Insights; source: DataSource | null }>({ ...initial, source: null })
  const [view, setView] = useState<WorkspaceView>('factory')
  const [sourceError, setSourceError] = useState(false)
  const live = useLive()
  const refresh = useCallback(() => {
    setSourceError(false)
    loadData().then(([k, i, s]) => setData({ kpi: k, insights: i, source: s }), () => setSourceError(true))
  }, [])
  // новая запись в хранилище (смена симулятора, импорт, сброс) — перечитать показатели и решения
  const version = live?.version
  useEffect(() => { refresh() }, [version, live?.running, refresh])
  // активные простои меняются редко, а ход смены — каждую секунду: сцена зависит только от первых
  const activeKey = JSON.stringify(live?.shift?.active.map((e) => [e.area, e.equipment, e.reason]) ?? [])
  // тревоги ПЛК из SCADA: приоритет 1 — отклонение, 2–3 — внимание; статус участка только повышается
  const plcKey = useAlarmSummaryKey()
  const [sceneAlerts, sceneStatus] = useMemo(() => {
    const active = JSON.parse(activeKey) as [string, string, string][]
    const plc = JSON.parse(plcKey) as { area: string; priority: number; title: string }[]
    const liveAlerts: Alert[] = active.map(([area, equipment, reason]) => ({ level: 'bad', area, kind: 'live', title: `Простой: ${equipment}`, text: reason }))
    const plcAlerts: Alert[] = plc.map((a) => ({ level: a.priority === 1 ? 'bad' : 'warn', area: a.area, kind: 'live', title: a.title, text: 'Тревога ПЛК' }))
    const status: Record<string, Level> = { ...insights.status }
    const rank = { ok: 0, warn: 1, bad: 2 }
    for (const a of plcAlerts) if (a.area && rank[a.level] > rank[status[a.area] ?? 'ok']) status[a.area] = a.level
    for (const [area] of active) status[area] = 'bad'
    return [[...liveAlerts, ...plcAlerts, ...insights.alerts], status]
  }, [activeKey, plcKey, insights])
  const sourceLabel = live?.running ? 'Live · симулятор' : source?.source.startsWith('Импорт') ? 'Импорт' : source?.source.startsWith('Симулятор') ? 'Данные симулятора' : 'Данные кейса'
  const tour = useMemo(() => buildTour(plant.hall), [plant])
  const [selection, setSelection] = useState<Selection>(null)
  const [roof, setRoof] = useState(true)
  const [mood, setMood] = useState<LightMood>('day')
  const [detailed, setDetailed] = useState(true)
  const [help, setHelp] = useState(false)
  const [sceneFocused, setSceneFocused] = useState(false)
  const [labels, setLabels] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [car, setCar] = useState<CarSelection | null>(null)
  const [follow, setFollow] = useState(false)
  const closeCar = useCallback(() => { setCar(null); setFollow(false) }, [])
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [navigation, setNavigation] = useState(false)
  const closeNavigation = useCallback(() => setNavigation(false), [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('allur.sidebar.collapsed') === 'true' }
    catch { return false }
  })
  const toggleSidebar = useCallback(() => setSidebarCollapsed(value => !value), [])
  const expandSidebar = useCallback(() => setSidebarCollapsed(false), [])
  useEffect(() => {
    try { localStorage.setItem('allur.sidebar.collapsed', String(sidebarCollapsed)) }
    catch { /* The menu still works when browser storage is unavailable. */ }
  }, [sidebarCollapsed])
  const [simulationMode, setSimulationMode] = useState(false)
  const [simulationPanel, setSimulationPanel] = useState(true)
  const simulation = useSimulation(simulationMode)

  useEffect(() => {
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (navigation) { setNavigation(false); return }
      if (view !== 'factory') return
      if (car) { closeCar(); return }
      if (sceneFocused) { setSceneFocused(false); return }
      if (simulationMode) { setSimulationPanel(false); return }
      if (help) setHelp(false)
      else setSelection(null)
    }
    window.addEventListener('keydown', closePanel)
    return () => window.removeEventListener('keydown', closePanel)
  }, [view, navigation, help, simulationMode, sceneFocused, car, closeCar])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 961px)')
    const closeOnDesktop = () => { if (desktop.matches) setNavigation(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  const findSelection = useCallback(
    (id?: string): Selection => {
      if (!id) return null
      const z = plant.zones.find((x) => x.id === id)
      if (z) return { kind: 'zone', zone: z }
      const o = plant.outdoor.find((x) => x.id === id)
      return o ? { kind: 'outdoor', zone: o } : null
    },
    [plant],
  )

  const goTo = useCallback(
    (i: number) => {
      const s = tour[i]
      if (!s || !Number.isInteger(i)) return
      setView('factory')
      setNavigation(false)
      setStep(i)
      setRoof(s.roof)
      setSelection(findSelection(s.zone))
      closeCar()
      setShot({ camera: s.camera, target: s.target })
    },
    [tour, findSelection, closeCar],
  )

  // прямая ссылка на шаг экскурсии: ?step=5; произвольный ракурс в координатах корпуса:
  // ?cam=u,v,h,u2,v2,h2 (камера → цель), &roof=1 — с кровлей
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const n = Number(q.get('step'))
    if (Number.isInteger(n) && n >= 1 && n <= tour.length) goTo(n - 1)
    const cam = q.get('cam')?.split(',').map(Number)
    if (cam?.length === 6 && cam.every(Number.isFinite)) {
      setRoof(q.get('roof') === '1')
      setShot({ camera: hallToWorld(plant.hall, cam[0], cam[1], cam[2]), target: hallToWorld(plant.hall, cam[3], cam[4], cam[5]) })
    }
  }, [tour, goTo, plant])

  // автопереход шагов экскурсии
  useEffect(() => {
    if (!playing || step === null) return
    if (step >= tour.length - 1) {
      const t = setTimeout(() => setPlaying(false), STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => goTo(step + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [playing, step, tour.length, goTo])

  const selectZone = (z: Zone) => {
    setView('factory')
    setNavigation(false)
    setStep(null)
    setPlaying(false)
    setRoof(false)
    setSelection({ kind: 'zone', zone: z })
    closeCar()
    setShot(zoneShot(plant, z))
  }
  const showArea = (area: string) => {
    const zone = plant.zones.find((z) => z.kpiArea === area)
    if (zone) { setSimulationMode(false); selectZone(zone) }
  }
  const selectOutdoor = (z: OutdoorZone) => {
    setView('factory')
    setRoof(true)
    setNavigation(false)
    setStep(null)
    setPlaying(false)
    setSelection({ kind: 'outdoor', zone: z })
    closeCar()
    setShot(outdoorShot(z))
  }
  const openZone = (id: string) => {
    const zone = plant.zones.find((z) => z.id === id)
    if (zone) { selectZone(zone); return }
    const area = plant.outdoor.find((z) => z.id === id)
    if (area) selectOutdoor(area)
  }
  const pickCar = (root: Object3D) => {
    const unit = unitOf(root)
    if (!unit) return
    setView('factory'); setNavigation(false); setPlaying(false); setStep(null); setHelp(false); setSelection(null); setFollow(false)
    setCar({ unit, root, cycle: cycleOf(root), progress: root.userData.progress ?? 0, station: root.userData.station ?? 0, at: Date.now() })
  }

  const selectAsset = (stage: Stage) => {
    setRoof(false); setPlaying(false); setStep(null); setFollow(false)
    const [u, v] = stage.position
    setShot(stage.stage === 'assembly'
      ? { camera: hallToWorld(plant.hall, 100, -130, 210), target: hallToWorld(plant.hall, 210, 95, 0) }
      : { camera: hallToWorld(plant.hall, u - 35, v - 50, 42), target: hallToWorld(plant.hall, u, v, 2) })
  }
  const toggleSimulation = async () => {
    if (simulation.busy) return
    // A running scenario remains a server process while other workspaces are open.
    // Returning to it does not accidentally toggle it off.
    if (view !== 'factory' && simulationMode) { setView('factory'); return }
    setView('factory')
    closeCar()
    if (simulationMode) {
      if (simulation.snapshot && !await simulation.control('pause')) {
        setSimulationPanel(true)
        return
      }
      setSimulationMode(false); setShot(overviewShot(plant)); setRoof(true)
    } else {
      setPlaying(false); setStep(null); setSelection(null); setNavigation(false)
      setSimulationPanel(true); setSimulationMode(true); setRoof(false)
      const area = plant.zones.find((z) => z.id === 'assembly')!
      setShot(zoneShot(plant, area))
    }
  }

  const overview = () => { setView('factory'); setNavigation(false); setPlaying(false); setStep(null); setSelection(null); closeCar(); setShot(overviewShot(plant)) }
  const changeRoof = (visible: boolean) => {
    setPlaying(false)
    setRoof(visible)
    // Под кровлей машины цехов не видны. Кузова симуляции карточка ведёт по данным движка.
    if (visible && car && INTERIOR.has(car.unit.place)) closeCar()
  }
  const openWorkspace = (next: WorkspaceView) => { setNavigation(false); setPlaying(false); setHelp(false); setView(next) }
  const openAnalytics = () => openWorkspace('analytics')
  const openDecisions = () => openWorkspace('decisions')
  const openSources = () => { openWorkspace('sources'); if (!source) refresh() }
  // сцена тяжёлая: пересоздаём элемент только при изменении её входов, а не на каждом сообщении потока
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => <Scene plant={plant} site={site} roof={roof} labels={labels} selection={selection} status={sceneStatus} alerts={sceneAlerts} shot={shot} mood={mood} detailed={detailed} paused={view !== 'factory'} onSelectZone={selectZone} onSelectOutdoor={selectOutdoor} simulation={simulationMode ? simulation.snapshot : null} onSelectAsset={selectAsset} car={car} follow={follow} onSelectCar={pickCar} onUserMove={() => { setPlaying(false); setFollow(false) }} />, [plant, site, roof, labels, selection, sceneStatus, sceneAlerts, shot, mood, detailed, view, simulationMode, simulation.snapshot, car, follow])
  const bottleneck = plant.zones.find(z => z.kpiArea === insights.base.bottleneck)

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${navigation ? ' navigation-open' : ''}${view === 'factory' && sceneFocused ? ' scene-focused' : ''}`}>
      <a className="skip-link" href="#main-content">Перейти к рабочей области</a>
      {navigation && <button className="navigation-backdrop" aria-label="Закрыть навигацию" onClick={() => setNavigation(false)} />}
      <ZoneList view={view} open={navigation} collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} onExpand={expandSidebar} plant={plant} status={insights.status} insights={insights} selection={selection} onZone={selectZone} onOutdoor={selectOutdoor} onClose={closeNavigation} onOverview={overview} onAnalytics={openAnalytics} onDecisions={openDecisions} onSource={openSources} />
      <TopBar factoryView={view === 'factory'} sectionTitle={VIEW_TITLES[view]} plant={plant} kpi={kpi} insights={insights} sourceLabel={sourceLabel} live={!!live?.running} onSource={openSources} onDecisions={openDecisions} simulationMode={simulationMode} connected={simulation.connected} busy={simulation.busy} onSimulation={() => void toggleSimulation()} navigation={navigation} onNavigation={() => { setPlaying(false); setNavigation(v => !v) }} onAnalytics={openAnalytics} />
      <main inert={navigation} className={`dashboard${view !== 'factory' ? ' workspace-view' : ''}`} id="main-content">
        {/* 3D-сцена не размонтируется при переходе в другие разделы: пересоздание WebGL, шейдеров и моделей
            давало рывок 200–300 мс при каждом возврате. Скрытая сцена стоит на паузе. */}
        <div className="factory-view" style={{ display: view === 'factory' ? 'contents' : 'none' }}>
        <div className="page-heading"><div><div className="page-eyebrow"><span />ПРОИЗВОДСТВЕННАЯ ПЛОЩАДКА</div><h1>Завод в деталях<span className="heading-dot">.</span></h1><p>Производство, процессы и решения — в одном пространстве.</p></div><div className="page-actions"><span className="date-chip"><Icon name="clock" size={15} />{fmtDate(kpi.date)}<span className="date-divider" />{sourceLabel}</span><button className="button-primary" onClick={openAnalytics}><Icon name="chart" size={16} />Аналитика<Icon name="arrow-right" size={15} /></button></div></div>
        {simulationMode ? <SimulationKpiCards simulation={simulation.snapshot} /> : <KpiCards kpi={kpi} insights={insights} onAnalytics={openAnalytics} onDecisions={openDecisions} />}
        {!simulationMode && live?.shift && <LiveStrip shift={live.shift} onArea={showArea} />}
        <section className={`scene-stage${selection || car ? ' has-selection' : ''}${step !== null ? ' touring' : ''}`} aria-label="Интерактивная 3D-модель завода">
          <div className="scene-canvas"><SceneBoundary>{scene}</SceneBoundary></div>
          <div className="stage-toolbar"><div className="stage-title"><span className="stage-icon"><Icon name="box" size={18} /></span><div><strong>Цифровой двойник</strong><span>Интерактивная модель площадки</span></div><span className="stage-badge">3D</span></div><div className="stage-modes" role="group" aria-label="Отображение завода"><button aria-pressed={roof} className={roof ? 'active' : ''} onClick={() => changeRoof(true)}><Icon name="roof" size={15} />Площадка</button><button aria-pressed={!roof} className={!roof ? 'active' : ''} onClick={() => changeRoof(false)}><Icon name="layers" size={15} />Цеха</button></div><div className="stage-actions"><button className="icon-button" aria-label={mood === 'day' ? 'Включить вечернее освещение' : 'Включить дневное освещение'} title={mood === 'day' ? 'Свет: день' : 'Свет: золотой час'} onClick={() => setMood(mood === 'day' ? 'sunset' : 'day')}><Icon name={mood === 'day' ? 'sun' : 'moon'} /></button><button className={`icon-button${detailed ? ' selected' : ''}`} aria-pressed={detailed} aria-label="Детальное качество изображения" title={detailed ? 'Качество: высокое. Нажмите для экономичного режима' : 'Качество: экономичное. Нажмите для высокого качества'} onClick={() => setDetailed(v => !v)}><Icon name="settings" /></button><button className={`icon-button${sceneFocused ? ' selected' : ''}`} aria-label={sceneFocused ? 'Свернуть 3D-сцену' : 'Развернуть 3D-сцену'} aria-pressed={sceneFocused} title={sceneFocused ? 'Вернуть показатели · Escape' : 'Развернуть 3D-сцену'} onClick={() => setSceneFocused(v => !v)}><Icon name="expand" /></button><button className={`icon-button${help ? ' selected' : ''}`} aria-label="Как управлять моделью" aria-expanded={help} aria-controls="scene-help" onClick={() => setHelp(v => !v)}><Icon name="info" /></button></div></div>
          {help && <div className="scene-help" id="scene-help"><strong>Исследуйте завод</strong><p>Перетаскивание — поворот камеры.<br />Колесо мыши — приближение.<br />Правая кнопка — перемещение.</p><p>На телефоне: один палец — поворот,<br />два пальца — масштаб и перемещение.</p><span>Нажмите на участок или машину, чтобы увидеть детали.</span><button className="text-button" onClick={() => setHelp(false)}>Понятно <Icon name="check" size={14} /></button></div>}
          <div className="scene-topline"><span className="model-note"><span />{roof ? 'Внешний вид площадки' : 'Внутреннее устройство'}<span className="model-note-divider">/</span>Реконструкция</span>{bottleneck && <button className="bottleneck-chip" onClick={() => selectZone(bottleneck)}><Icon name="alert" size={13} />Узкое место: {insights.base.bottleneck.toLowerCase()}<Icon name="chevron-right" size={13} /></button>}</div>
          <div className="scene-panels">{car ? <CarPanel key={`${car.unit.key}@${car.at}`} car={car} alerts={sceneAlerts} simulation={simulationMode ? simulation.snapshot : null} following={follow} onFollow={setFollow} onZone={simulationMode ? undefined : openZone} onClose={closeCar} /> : simulationMode ? simulationPanel && <SimulationPanel simulation={simulation} onAsset={selectAsset} onHide={() => setSimulationPanel(false)} /> : <ZonePanel key={selection?.zone.id} plant={plant} kpi={kpi} insights={insights} onDecisions={openDecisions} selection={selection} onClose={() => setSelection(null)} />}</div>
          <div className="scene-bottom"><div className="scene-legend"><span><i className="legend-ok" />В норме</span><span><i className="legend-warn" />Внимание</span><span><i className="legend-bad" />Отклонение</span></div>{simulationMode ? <SimulationTransport simulation={simulation} panel={simulationPanel} onPanel={() => setSimulationPanel((v) => !v)} roof={roof} onRoof={() => changeRoof(!roof)} onOverview={() => { overview(); changeRoof(true) }} /> : <TourBar stops={tour} index={step} playing={playing} roof={roof} labels={labels} onPlay={() => { setPlaying(true); goTo(step === null || step >= tour.length - 1 ? 0 : step) }} onStop={() => setPlaying(false)} onStep={goTo} onRoof={() => changeRoof(!roof)} onLabels={() => setLabels(l => !l)} onOverview={overview} />}<div className="scene-hint"><Icon name="rotate" size={13} />Вращайте · приближайте · исследуйте</div></div>
        </section>
        <footer className="workspace-footer"><span><span className="footer-dot" />{source?.source ?? 'Данные кейса'} · {fmtDate(kpi.date)}<span className="footer-separator">|</span>Движение в сцене — симуляция</span><span className="attrib">Геометрия: © OpenStreetMap<span className="footer-separator">|</span>Расстановка: НДВ, 2022<span className="footer-separator">|</span><a href="/models/credits.html" target="_blank" rel="noopener noreferrer">3D-модели</a></span></footer>
        </div>
        {view === 'analytics' ? <AnalyticsPanel kpi={kpi} onClose={() => openWorkspace('factory')} onArea={showArea} />
          : view === 'decisions' ? <DecisionsPanel insights={insights} onClose={() => openWorkspace('factory')} onArea={showArea} />
          : view !== 'sources' ? null
          : source ? <SourcePanel source={source} onClose={() => openWorkspace('factory')} onChanged={refresh} />
          : <section className="workspace-empty" aria-live="polite"><Icon name={sourceError ? 'alert' : 'grid'} size={32} /><h1>Источники данных</h1><p>{sourceError ? 'Не удалось загрузить сведения об источнике.' : 'Загружаем сведения об источнике…'}</p>{sourceError && <button className="button-primary" onClick={refresh}>Повторить загрузку</button>}</section>}
      </main>
    </div>
  )
}
