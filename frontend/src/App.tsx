import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadAll, loadData } from './api'
import { Scene, outdoorShot, overviewShot, zoneShot, type Shot } from './scene/Scene'
import { hallToWorld } from './scene/geo'
import { buildTour } from './scene/tour'
import type { Alert, DataSource, Insights, Kpi, LiveState, OutdoorZone, Plant, Selection, Site, Zone } from './types'
import { TopBar, KpiCards, fmtDate } from './ui/TopBar'
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

const STEP_MS = 9000

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
  const [sourceOpen, setSourceOpen] = useState(false)
  const live = useLive()
  const refresh = useCallback(() => {
    loadData().then(([k, i, s]) => setData({ kpi: k, insights: i, source: s }), () => {})
  }, [])
  // новая запись в хранилище (смена симулятора, импорт, сброс) — перечитать показатели и решения
  const version = live?.version
  useEffect(() => { refresh() }, [version, live?.running, refresh])
  // активные простои меняются редко, а ход смены — каждую секунду: сцена зависит только от первых
  const activeKey = JSON.stringify(live?.shift?.active.map((e) => [e.area, e.equipment, e.reason]) ?? [])
  const [sceneAlerts, sceneStatus] = useMemo(() => {
    const active = JSON.parse(activeKey) as [string, string, string][]
    const liveAlerts: Alert[] = active.map(([area, equipment, reason]) => ({ level: 'bad', area, kind: 'live', title: `Простой: ${equipment}`, text: reason }))
    return [[...liveAlerts, ...insights.alerts], { ...insights.status, ...Object.fromEntries(active.map(([area]) => [area, 'bad' as const])) }]
  }, [activeKey, insights])
  const sourceLabel = live?.running ? 'Live · симулятор' : source?.source.startsWith('Импорт') ? 'Импорт' : source?.source.startsWith('Симулятор') ? 'Данные симулятора' : 'Данные кейса'
  const tour = useMemo(() => buildTour(plant.hall), [plant])
  const [selection, setSelection] = useState<Selection>(null)
  const [roof, setRoof] = useState(false)
  const [mood, setMood] = useState<LightMood>('day')
  const [detailed, setDetailed] = useState(true)
  const [help, setHelp] = useState(false)
  const [labels, setLabels] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [decisions, setDecisions] = useState(false)
  const [navigation, setNavigation] = useState(false)

  useEffect(() => {
    if (analytics || decisions || sourceOpen) return
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (navigation) setNavigation(false)
      else if (help) setHelp(false)
      else setSelection(null)
    }
    window.addEventListener('keydown', closePanel)
    return () => window.removeEventListener('keydown', closePanel)
  }, [analytics, decisions, sourceOpen, navigation, help])

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
      setNavigation(false)
      setStep(i)
      setRoof(s.roof)
      setSelection(findSelection(s.zone))
      setShot({ camera: s.camera, target: s.target })
    },
    [tour, findSelection],
  )

  // прямая ссылка на шаг экскурсии: ?step=5; произвольный ракурс в координатах корпуса:
  // ?cam=u,v,h,u2,v2,h2 (камера → цель), &roof=1 — с кровлей
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const n = Number(q.get('step'))
    if (n >= 1 && n <= tour.length) goTo(n - 1)
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
    setNavigation(false)
    setStep(null)
    setPlaying(false)
    setRoof(false)
    setSelection({ kind: 'zone', zone: z })
    setShot(zoneShot(plant, z))
  }
  const showArea = (area: string) => {
    const zone = plant.zones.find((z) => z.kpiArea === area)
    if (zone) { setAnalytics(false); setDecisions(false); selectZone(zone) }
  }
  const selectOutdoor = (z: OutdoorZone) => {
    setNavigation(false)
    setStep(null)
    setPlaying(false)
    setSelection({ kind: 'outdoor', zone: z })
    setShot(outdoorShot(z))
  }

  const overview = () => { setNavigation(false); setPlaying(false); setStep(null); setSelection(null); setShot(overviewShot(plant)) }
  const openAnalytics = () => { setNavigation(false); setPlaying(false); setAnalytics(true) }
  const openDecisions = () => { setNavigation(false); setPlaying(false); setDecisions(true) }
  // сцена тяжёлая: пересоздаём элемент только при изменении её входов, а не на каждом сообщении потока
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scene = useMemo(() => <Scene plant={plant} site={site} roof={roof} labels={labels} selection={selection} status={sceneStatus} alerts={sceneAlerts} shot={shot} mood={mood} detailed={detailed} onSelectZone={selectZone} onSelectOutdoor={selectOutdoor} onUserMove={() => setPlaying(false)} />, [plant, site, roof, labels, selection, sceneStatus, sceneAlerts, shot, mood, detailed])
  const bottleneck = plant.zones.find(z => z.kpiArea === insights.base.bottleneck)

  return (
    <div className={`app${navigation ? ' navigation-open' : ''}`}>
      <a className="skip-link" href="#main-content">Перейти к рабочей области</a>
      {navigation && <button className="navigation-backdrop" aria-label="Закрыть навигацию" onClick={() => setNavigation(false)} />}
      <ZoneList open={navigation} plant={plant} status={insights.status} insights={insights} selection={selection} onZone={selectZone} onOutdoor={selectOutdoor} onClose={() => setNavigation(false)} onOverview={overview} onAnalytics={openAnalytics} onDecisions={openDecisions} />
      <TopBar plant={plant} kpi={kpi} insights={insights} sourceLabel={sourceLabel} live={!!live?.running} onSource={() => { setPlaying(false); setSourceOpen(true) }} onDecisions={openDecisions} navigation={navigation} onNavigation={() => { setPlaying(false); setNavigation(v => !v) }} onAnalytics={openAnalytics} />
      <main inert={navigation} className="dashboard" id="main-content">
        <div className="page-heading"><div><div className="page-eyebrow"><span />ПРОИЗВОДСТВЕННАЯ ПЛОЩАДКА</div><h1>Завод в деталях<span className="heading-dot">.</span></h1><p>Производство, процессы и решения — в одном пространстве.</p></div><div className="page-actions"><span className="date-chip"><Icon name="clock" size={15} />{fmtDate(kpi.date)}<span className="date-divider" />{sourceLabel}</span><button className="button-primary" onClick={openAnalytics}><Icon name="chart" size={16} />Аналитика<Icon name="arrow-right" size={15} /></button></div></div>
        <KpiCards kpi={kpi} insights={insights} onAnalytics={openAnalytics} onDecisions={openDecisions} />
        {live?.shift && <LiveStrip shift={live.shift} onArea={showArea} />}
        <section className={`scene-stage${selection ? ' has-selection' : ''}${step !== null ? ' touring' : ''}`} aria-label="Интерактивная 3D-модель завода">
          <div className="scene-canvas"><SceneBoundary>{scene}</SceneBoundary></div>
          <div className="stage-toolbar"><div className="stage-title"><span className="stage-icon"><Icon name="box" size={18} /></span><div><strong>Цифровой двойник</strong><span>Интерактивная модель площадки</span></div><span className="stage-badge">3D</span></div><div className="stage-modes" role="group" aria-label="Отображение завода"><button aria-pressed={roof} className={roof ? 'active' : ''} onClick={() => { setPlaying(false); setRoof(true) }}><Icon name="roof" size={15} />Площадка</button><button aria-pressed={!roof} className={!roof ? 'active' : ''} onClick={() => { setPlaying(false); setRoof(false) }}><Icon name="layers" size={15} />Цеха</button></div><div className="stage-actions"><button className="icon-button" aria-label={mood === 'day' ? 'Включить вечернее освещение' : 'Включить дневное освещение'} title={mood === 'day' ? 'Свет: день' : 'Свет: золотой час'} onClick={() => setMood(mood === 'day' ? 'sunset' : 'day')}><Icon name={mood === 'day' ? 'sun' : 'moon'} /></button><button className={`icon-button${detailed ? ' selected' : ''}`} aria-pressed={detailed} aria-label="Детальное качество изображения" title={detailed ? 'Качество: высокое. Нажмите для экономичного режима' : 'Качество: экономичное. Нажмите для высокого качества'} onClick={() => setDetailed(v => !v)}><Icon name="settings" /></button><button className={`icon-button${help ? ' selected' : ''}`} aria-label="Как управлять моделью" aria-expanded={help} aria-controls="scene-help" onClick={() => setHelp(v => !v)}><Icon name="info" /></button></div></div>
          {help && <div className="scene-help" id="scene-help"><strong>Исследуйте завод</strong><p>Перетаскивание — поворот камеры.<br />Колесо мыши — приближение.<br />Правая кнопка — перемещение.</p><p>На телефоне: один палец — поворот,<br />два пальца — масштаб и перемещение.</p><span>Выберите участок, чтобы увидеть детали.</span><button className="text-button" onClick={() => setHelp(false)}>Понятно <Icon name="check" size={14} /></button></div>}
          <div className="scene-topline"><span className="model-note"><span />{roof ? 'Внешний вид площадки' : 'Внутреннее устройство'}<span className="model-note-divider">/</span>Реконструкция</span>{bottleneck && <button className="bottleneck-chip" onClick={() => selectZone(bottleneck)}><Icon name="alert" size={13} />Узкое место: {insights.base.bottleneck.toLowerCase()}<Icon name="chevron-right" size={13} /></button>}</div>
          <div className="scene-panels"><ZonePanel key={selection?.zone.id} plant={plant} kpi={kpi} insights={insights} onDecisions={openDecisions} selection={selection} onClose={() => setSelection(null)} /></div>
          <div className="scene-bottom"><div className="scene-legend"><span><i className="legend-ok" />В норме</span><span><i className="legend-warn" />Внимание</span><span><i className="legend-bad" />Отклонение</span></div><TourBar stops={tour} index={step} playing={playing} roof={roof} labels={labels} onPlay={() => { setPlaying(true); goTo(step === null || step >= tour.length - 1 ? 0 : step) }} onStop={() => setPlaying(false)} onStep={goTo} onRoof={() => { setPlaying(false); setRoof(r => !r) }} onLabels={() => setLabels(l => !l)} onOverview={overview} /><div className="scene-hint"><Icon name="rotate" size={13} />Вращайте · приближайте · исследуйте</div></div>
        </section>
        <footer className="workspace-footer"><span><span className="footer-dot" />{source?.source ?? 'Данные кейса'} · {fmtDate(kpi.date)}<span className="footer-separator">|</span>Движение в сцене — симуляция</span><span className="attrib">© OpenStreetMap · Esri World Imagery<span className="footer-separator">|</span>Расстановка: НДВ, 2022</span></footer>
      </main>
      {analytics && <AnalyticsPanel kpi={kpi} onClose={() => setAnalytics(false)} onArea={showArea} />}
      {decisions && <DecisionsPanel insights={insights} onClose={() => setDecisions(false)} onArea={showArea} />}
      {sourceOpen && source && <SourcePanel source={source} onClose={() => setSourceOpen(false)} onChanged={refresh} />}
    </div>
  )
}
