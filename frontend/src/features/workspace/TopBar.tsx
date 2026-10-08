import type { Insights, Kpi, Plant } from '../../shared/types'
import { formatTime, type SimulationSnapshot } from '../simulation/types'
import { Icon, type IconName } from '../../shared/ui/Icon'

import { fmtDate } from '../../shared/lib/format'

export function TopBar({ sectionTitle, factoryView, plant, kpi, sourceLabel, live, navigation, onNavigation, onAnalytics, onDecisions, onAi, onSource, simulationMode, connected, busy, onSimulation }: { sectionTitle: string; factoryView: boolean; plant: Plant; kpi: Kpi; insights: Insights; sourceLabel: string; live: boolean; navigation: boolean; onNavigation: () => void; onAnalytics: () => void; onDecisions: () => void; onAi: () => void; onSource: () => void; simulationMode: boolean; connected: boolean; busy: boolean; onSimulation: () => void }) {
  return (
    <header className="topbar" inert={navigation}>
      <div className="header-context">
        <button className="icon-button navigation-toggle" aria-label="Открыть навигацию" aria-expanded={navigation} aria-controls="plant-navigation" onClick={onNavigation}><Icon name="menu" /></button>
        <span className="mobile-brand brand-logo">allur<span>®</span></span>
        <span className="breadcrumb">Рабочее пространство <Icon name="chevron-right" size={13} /><strong>{sectionTitle}</strong></span>
      </div>
      <div className="header-actions">
        <span className="location-label" title={plant.address}><Icon name="pin" size={14} />Костанай, Казахстан</span>
        {simulationMode
          ? <span className="demo-badge"><span />{connected ? 'Сценарный поток' : 'Сценарий · HTTP'}</span>
          : <button className={`demo-badge source-badge${live ? ' live' : ''}`} onClick={onSource} title="Источник данных: загрузка, live, шаблон"><span />{sourceLabel}</button>}
        <button className={`simulation-launch${simulationMode ? ' active' : ''}`} disabled={busy} aria-pressed={simulationMode} onClick={onSimulation}><Icon name={simulationMode ? 'arrow-left' : 'play'} size={14} />{simulationMode ? (factoryView ? 'Вернуться к обзору' : 'К сценарию') : 'Сценарии производства'}</button>
        <button className="icon-button header-chart" onClick={onAnalytics} aria-label={simulationMode ? 'Данные кейса' : 'Данные и аналитика'}><Icon name="chart" /></button>
        <button className="icon-button" onClick={onAi} aria-label="ИИ-аналитик: прогноз отказов и ассистент" title="ИИ-аналитик"><Icon name="spark" /></button>
        <button className="icon-button" onClick={onDecisions} aria-label={`Центр решений · данные за ${fmtDate(kpi.date)}`} title="Центр решений"><Icon name="layers" /></button>
      </div>
    </header>
  )
}

export function KpiCards({ kpi, insights, onAnalytics, onDecisions }: { kpi: Kpi; insights: Insights; onAnalytics: () => void; onDecisions: () => void }) {
  const p = kpi.plant
  const t = kpi.targets
  const f = insights.base
  return <section className="kpis" aria-label={`Показатели производства за ${fmtDate(kpi.date)}`}>
    <Metric label="Выпуск сборки" value={p.fact.toLocaleString('ru-RU')} unit={`/ ${p.plan}`} hint="автомобилей · факт / план" status={p.fact >= p.plan ? 'ok' : 'warn'} icon="factory" progress={p.fact / p.plan * 100} badge={`${(p.fact / p.plan * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% плана`} onClick={onAnalytics} />
    <Metric label="Эффективность · OEE" value={p.oee.toLocaleString('ru-RU')} unit="%" hint={`условная оценка · цель ≥ ${t.oee}%`} status={p.oee >= t.oee ? 'ok' : 'warn'} icon="chart" progress={p.oee} badge={p.oee >= t.oee ? 'В пределах цели' : 'Ниже цели'} onClick={onAnalytics} />
    <Metric label="Уровень брака" value={p.defectRate.toLocaleString('ru-RU')} unit="%" hint={`сборка · допустимо ≤ ${t.defect}%`} status={p.defectRate <= t.defect ? 'ok' : 'bad'} icon="check" badge={p.defectRate <= t.defect ? 'В пределах нормы' : 'Выше нормы'} onClick={onAnalytics} />
    <Metric label="Простои за сутки" value={p.downtime.toLocaleString('ru-RU')} unit="мин" hint="суммарно по всем участкам" status="neutral" icon="clock" badge="Журнал событий" onClick={onAnalytics} />
    <Metric label="Прогноз на месяц" value={f.month.toLocaleString('ru-RU')} unit="авто" hint={`месячный план · ${f.plan.toLocaleString('ru-RU')} авто`} status={f.vsPlan >= 0 ? 'ok' : 'bad'} icon="target" progress={f.month / f.plan * 100} badge={`${f.vsPlan > 0 ? '+' : ''}${f.vsPlan.toLocaleString('ru-RU')} к плану`} onClick={onDecisions} />
  </section>
}

/** Показатели сценарной смены — заменяют KPI кейса в режиме «Сценарии производства». */
export function SimulationKpiCards({ simulation }: { simulation: SimulationSnapshot | null }) {
  const s = simulation
  return <section className="kpis simulation-kpis" aria-label="Показатели сценарной смены">
    <Metric label="Годные · приёмка ОТК" value={s ? String(s.good) : '—'} unit="авто" hint="сценарная смена" status="ok" icon="check" badge="Приняты ОТК" />
    <Metric label="В производстве" value={s ? String(s.wip) : '—'} unit="шт" hint="кузова и очереди" status="neutral" icon="factory" badge="Незавершённое производство" />
    <Metric label="Карантин" value={s ? String(s.rejected) : '—'} unit="авто" hint="не прошли ОТК" status="warn" icon="alert" badge="На доработку" />
    <Metric label="Простой сборки" value={s ? String(Math.floor(s.stages[2].durations.FAULT)) : '—'} unit="мин" hint="накоплено в этой смене" status={s?.faultUntil ? 'bad' : 'neutral'} icon="clock" badge={s?.faultUntil ? 'Идёт ремонт' : 'Без отказа'} />
    <Metric label="Время смены" value={s ? formatTime(s.time) : '—'} unit="" hint={s?.completed ? 'смена завершена' : s?.running ? 'идёт симуляция' : 'симуляция на паузе'} status="neutral" icon="target" badge="Сценарий" />
  </section>
}

function Metric({ label, value, unit, hint, status, icon, progress, badge, onClick }: { label: string; value: string; unit: string; hint: string; status: 'ok' | 'warn' | 'bad' | 'neutral'; icon: IconName; progress?: number; badge: string; onClick?: () => void }) {
  return <button className={`metric metric-${status}`} onClick={onClick}>
    <span className="metric-top"><span className="metric-label">{label}</span><Icon name={icon} size={16} /></span>
    <span className="metric-value">{value}<small>{unit}</small></span>
    <span className="metric-hint">{hint}</span>
    <span className="metric-bottom"><span className="metric-badge">{status !== 'neutral' && <span className="status-dot" />}{badge}</span>{progress !== undefined && <span className="metric-progress"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></span>}</span>
  </button>
}
