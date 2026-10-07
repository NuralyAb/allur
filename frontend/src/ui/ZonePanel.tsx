import type { Kpi, LineRow, Plant, Selection } from '../types'

const fmtDate = (d: string) => d.slice(8, 10) + '.' + d.slice(5, 7)

export function ZonePanel({ plant, kpi, selection, onClose }: { plant: Plant; kpi: Kpi; selection: Selection; onClose: () => void }) {
  if (!selection) return null
  const z = selection.zone
  const area = selection.kind === 'zone' && selection.zone.kpiArea ? kpi.areas[selection.zone.kpiArea] : undefined

  return (
    <aside className="zonepanel" aria-label={`Участок: ${z.name}`} style={{ borderTopColor: z.color }}>
      <div className="zonepanel-heading">
        <button className="close icon-button" onClick={onClose} aria-label="Закрыть карточку участка">
          ×
        </button>
        <div className="zp-kind">{selection.kind === 'zone' ? 'Главный корпус' : 'Открытая площадка'}</div>
        <h2>{z.name}</h2>
      </div>
      <div className="zonepanel-content">
        {selection.kind === 'zone' && (
          <div className={`basis basis-${selection.zone.basis}`}>
            {selection.zone.basis === 'ndv' ? 'Положение по карте-схеме проекта НДВ' : 'Положение — по технологической логике'}
          </div>
        )}
        <p className="zp-desc">{z.description}</p>

        {area && <AreaKpi rows={area} kpi={kpi} />}

        {z.facts.length > 0 && (
          <>
            <div className="panel-caption">Факты из открытых источников</div>
            <dl className="facts">
              {z.facts.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.value}
                    {f.source && plant.sources[f.source] && (
                      <a href={plant.sources[f.source].url} target="_blank" rel="noreferrer" title={plant.sources[f.source].title}>
                        ↗
                      </a>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </aside>
  )
}

function AreaKpi({ rows, kpi }: { rows: LineRow[]; kpi: Kpi }) {
  const last = rows[rows.length - 1]
  const t = kpi.targets
  return (
    <>
      <div className="panel-caption">
        {last.line} · {fmtDate(last.date)}
      </div>
      <div className="kpi-grid">
        <Tile label="Факт / план" value={`${last.fact} / ${last.plan}`} status={last.fact >= last.plan ? 'ok' : 'warn'} />
        <Tile label="Загрузка" value={`${last.load}%`} status="neutral" />
        <Tile label="Условный OEE" value={`${last.oee}%`} status={last.oee >= t.oee ? 'ok' : 'bad'} sub={`демо · цель ≥ ${t.oee}%`} />
        <Tile label="Брак" value={`${last.defectRate}%`} status={last.defectRate <= t.defect ? 'ok' : 'bad'} sub={`норма ≤ ${t.defect}%`} />
        <Tile label="Время работы" value={`${last.hours} ч`} status="neutral" sub="период записи не уточнён" />
        <Tile label="Журнал простоев" value={`${last.downtime} мин`} status="neutral" sub="сумма событий участка" />
      </div>
      <div className="oee-breakdown">
        <Bar label="Работа / 8 ч (демо)" value={last.availability} />
        <Bar label="Выполнение плана" value={last.performance} />
        <Bar label="Качество" value={last.quality} />
      </div>
      <table className="days">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Факт</th>
            <th>OEE, демо</th>
            <th>Брак</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <td>{fmtDate(r.date)}</td>
              <td>{r.fact}</td>
              <td className={r.oee >= t.oee ? 'ok' : 'bad'}>{r.oee}%</td>
              <td className={r.defectRate <= t.defect ? 'ok' : 'bad'}>{r.defectRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function Tile({ label, value, sub, status }: { label: string; value: string; sub?: string; status: string }) {
  return (
    <div className={`tile metric-${status}`}>
      <div className="metric-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="metric-hint">{sub}</div>}
    </div>
  )
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <b>{value}%</b>
    </div>
  )
}
