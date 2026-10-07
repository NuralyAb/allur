import type { Insights, Kpi, Plant } from '../types'
import { Icon, type IconName } from './Icon'

export const fmtDate = (d: string) => d.split('-').reverse().join('.')

export function TopBar({ plant, kpi, sourceLabel, live, navigation, onNavigation, onAnalytics, onDecisions, onSource }: { plant: Plant; kpi: Kpi; insights: Insights; sourceLabel: string; live: boolean; navigation: boolean; onNavigation: () => void; onAnalytics: () => void; onDecisions: () => void; onSource: () => void }) {
  return (
    <header className="topbar" inert={navigation}>
      <div className="header-context">
        <button className="icon-button navigation-toggle" aria-label="Открыть участки завода" aria-expanded={navigation} aria-controls="plant-navigation" onClick={onNavigation}><Icon name="menu" /></button>
        <span className="mobile-brand brand-logo">allur<span>®</span></span>
        <span className="breadcrumb">Рабочее пространство <Icon name="chevron-right" size={13} /><strong>Цифровой двойник</strong></span>
      </div>
      <div className="header-actions">
        <span className="location-label" title={plant.address}><Icon name="pin" size={14} />Костанай, Казахстан</span>
        <button className={`demo-badge source-badge${live ? ' live' : ''}`} onClick={onSource} title="Источник данных: загрузка, live, шаблон"><span />{sourceLabel}</button>
        <button className="icon-button header-chart" onClick={onAnalytics} aria-label="Данные и аналитика"><Icon name="chart" /></button>
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

function Metric({ label, value, unit, hint, status, icon, progress, badge, onClick }: { label: string; value: string; unit: string; hint: string; status: 'ok' | 'warn' | 'bad' | 'neutral'; icon: IconName; progress?: number; badge: string; onClick: () => void }) {
  return <button className={`metric metric-${status}`} onClick={onClick}>
    <span className="metric-top"><span className="metric-label">{label}</span><Icon name={icon} size={16} /></span>
    <span className="metric-value">{value}<small>{unit}</small></span>
    <span className="metric-hint">{hint}</span>
    <span className="metric-bottom"><span className="metric-badge">{status !== 'neutral' && <span className="status-dot" />}{badge}</span>{progress !== undefined && <span className="metric-progress"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></span>}</span>
  </button>
}
