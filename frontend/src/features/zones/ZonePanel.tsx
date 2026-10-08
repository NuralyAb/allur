import type { Insights, Kpi, LineRow, Plant, Selection } from '../../shared/types'
import { Icon } from '../../shared/ui/Icon'
import { ZoneControllers } from '../scada/ZoneControllers'

const fmtDate = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7)
const num = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })

export function ZonePanel({ plant, kpi, insights, selection, onClose, onDecisions }: { plant: Plant; kpi: Kpi; insights: Insights; selection: Selection; onClose: () => void; onDecisions: () => void }) {
  if (!selection) return null
  const z = selection.zone
  const area = selection.kind === 'zone' && selection.zone.kpiArea ? kpi.areas[selection.zone.kpiArea] : undefined

  return (
    <aside className="zonepanel" aria-labelledby="zonepanel-title" style={{ borderTopColor: z.color }}>
      <div className="zonepanel-heading">
        <button type="button" className="close icon-button" onClick={onClose} aria-label="Закрыть карточку участка"><Icon name="close" /></button>
        <div className="zp-kind"><Icon name={selection.kind === 'zone' ? 'factory' : 'pin'} />{selection.kind === 'zone' ? 'Главный корпус / Участок' : 'Территория / Площадка'}</div>
        <h2 id="zonepanel-title">{z.name}</h2>
        {selection.kind === 'zone' && <div className={`basis basis-${selection.zone.basis}`}><Icon name={selection.zone.basis === 'ndv' ? 'check' : 'info'} />{selection.zone.basis === 'ndv' ? 'Расположение по карте-схеме НДВ' : 'Размещение по технологической логике'}</div>}
      </div>
      <div className="zonepanel-content">
        <p className="zp-desc">{z.description}</p>
        {area && area.length > 0 && <AreaKpi rows={area} kpi={kpi} insights={insights} area={selection.kind === 'zone' ? selection.zone.kpiArea : undefined} />}
        {selection.kind === 'zone' && selection.zone.kpiArea && (!area || area.length === 0) && <p className="empty-state">Производственные показатели этого участка пока не представлены в исходных данных.</p>}
        {selection.kind === 'zone' && selection.zone.kpiArea && <AreaAlerts area={selection.zone.kpiArea} insights={insights} onDecisions={onDecisions} />}
        {selection.kind === 'zone' && <ZoneControllers zone={selection.zone.id} />}
        {z.facts.length > 0 && (
          <section className="panel-section">
            <h3 className="panel-caption">Об участке</h3>
            <p className="section-meta">Факты из открытых источников</p>
            <dl className="facts">
              {z.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}{f.source && plant.sources[f.source] && <a className="source-link" href={plant.sources[f.source].url} target="_blank" rel="noreferrer" aria-label={`Источник: ${plant.sources[f.source].title} (откроется в новой вкладке)`} title={plant.sources[f.source].title}><Icon name="arrow-right" /></a>}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </aside>
  )
}

function AreaAlerts({ area, insights, onDecisions }: { area: string; insights: Insights; onDecisions: () => void }) {
  const alerts = insights.alerts.filter((a) => a.area === area)
  const risks = insights.risks.filter((r) => r.area === area && r.level !== 'low')
  if (!alerts.length && !risks.length) return null
  return (
    <section className="panel-section">
      <h3 className="panel-caption">Требует внимания</h3>
      <ul className="alerts compact">
        {alerts.map((a) => <li key={a.title} className={`alert alert-${a.level}`}><b>{a.title}</b><span>{a.text}</span></li>)}
        {risks.map((r, i) => <li key={`${r.equipment}-${i}`} className={`alert alert-${r.level === 'high' ? 'bad' : 'warn'}`}><b>{r.equipment}: {r.reason.toLowerCase()}</b><span>{r.action}</span></li>)}
      </ul>
      <button type="button" className="zp-decisions" onClick={onDecisions}>Открыть центр решений<Icon name="arrow-right" /></button>
    </section>
  )
}

function AreaKpi({ rows, kpi, insights, area }: { rows: LineRow[]; kpi: Kpi; insights: Insights; area?: string | null }) {
  const last = [...rows].sort((a, b) => a.date.localeCompare(b.date))[rows.length - 1]
  const t = kpi.targets
  // годные за смену — та же величина, что в центре решений: среднее за окно расчёта без брака
  const flow = insights.flow.find((f) => f.area === area)
  const bottleneck = area === insights.base.bottleneck
  return (
    <section className="panel-section">
      <div className="section-heading"><h3 className="panel-caption">Показатели участка</h3><span className="section-meta">{fmtDate(last.date)}</span></div>
      <p className="section-meta">{last.line} · данные кейса</p>
      <div className="kpi-grid">
        {flow
          ? <Tile label="Годных за смену / план" value={`${num(flow.good)} / ${num(flow.plan)}`} status={flow.good >= flow.plan ? 'ok' : bottleneck ? 'bad' : 'warn'} sub={bottleneck ? 'узкое место · без брака' : 'без брака · среднее'} />
          : <Tile label="Факт / план" value={`${num(last.fact)} / ${num(last.plan)}`} status={last.fact >= last.plan ? 'ok' : 'warn'} sub={last.fact >= last.plan ? 'план выполнен' : `до плана ${num(last.plan - last.fact)} авто`} />}
        <Tile label="Загрузка" value={`${num(last.load)}%`} status="neutral" sub="по исходным данным" />
        <Tile label="Условный OEE" value={`${num(last.oee)}%`} status={last.oee >= t.oee ? 'ok' : 'bad'} sub={`демо · цель ≥ ${t.oee}%`} />
        <Tile label="Брак" value={`${num(last.defectRate)}%`} status={last.defectRate <= t.defect ? 'ok' : 'bad'} sub={`норма ≤ ${t.defect}%`} />
        <Tile label="Время работы" value={`${num(last.hours)} ч`} status="neutral" sub="период записи не уточнён" />
        <Tile label="Простои" value={`${num(last.downtime)} мин`} status="neutral" sub="сумма событий участка" />
      </div>
      <div className="oee-breakdown" aria-label="Составляющие условного OEE">
        <Bar label={`Работа / ${kpi.meta.shiftHours} ч (демо)`} value={last.availability} />
        <Bar label="Выполнение плана" value={last.performance} />
        <Bar label="Качество" value={last.quality} />
      </div>
      <table className="days" aria-label="Динамика показателей участка по датам">
        <thead><tr><th scope="col">Дата</th><th scope="col">Факт, авто</th><th scope="col">OEE, демо</th><th scope="col">Брак</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={`${r.date}-${r.line}`}><td>{fmtDate(r.date)}</td><td>{num(r.fact)}</td><td className={r.oee >= t.oee ? 'ok' : 'bad'}>{num(r.oee)}%</td><td className={r.defectRate <= t.defect ? 'ok' : 'bad'}>{num(r.defectRate)}%</td></tr>)}</tbody>
      </table>
    </section>
  )
}

function Tile({ label, value, sub, status }: { label: string; value: string; sub?: string; status: string }) {
  return <div className={`tile metric-${status}`}><div className="metric-label">{label}</div><div className="tile-value">{value}</div>{sub && <div className="metric-hint">{sub}</div>}</div>
}

function Bar({ label, value }: { label: string; value: number }) {
  return <div className="bar"><span>{label}</span><div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div><b>{num(value)}%</b></div>
}
