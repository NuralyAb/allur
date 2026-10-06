import type { Kpi, Plant } from '../types'

const fmtDate = (d: string) => d.split('-').reverse().join('.')

export function TopBar({ plant, kpi }: { plant: Plant; kpi: Kpi }) {
  const p = kpi.plant
  const t = kpi.targets
  const mp = kpi.monthPlan
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">allur</span>
        <div>
          <div className="brand-title">Цифровой двойник завода</div>
          <div className="brand-sub">{plant.address}</div>
        </div>
      </div>
      <div className="kpis">
        <Metric label={`Выпуск ${fmtDate(kpi.date)}`} value={`${p.fact} / ${p.plan}`} hint="факт / план, авто" status={p.fact >= p.plan ? 'ok' : 'warn'} />
        <Metric label="OEE завода" value={`${p.oee}%`} hint={`цель ≥ ${t.oee}%`} status={p.oee >= t.oee ? 'ok' : 'bad'} />
        <Metric label="Брак" value={`${p.defectRate}%`} hint={`норма ≤ ${t.defect}%`} status={p.defectRate <= t.defect ? 'ok' : 'bad'} />
        <Metric label="Простои" value={`${p.downtime} мин`} hint="за сутки, все участки" status="neutral" />
        <Metric
          label="План месяца"
          value={mp.total.toLocaleString('ru-RU')}
          hint={`цель ≥ ${mp.target.toLocaleString('ru-RU')}`}
          status={mp.total >= mp.target ? 'ok' : 'warn'}
        />
      </div>
    </header>
  )
}

function Metric({ label, value, hint, status }: { label: string; value: string; hint: string; status: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <div className={`metric metric-${status}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint">{hint}</div>
    </div>
  )
}
