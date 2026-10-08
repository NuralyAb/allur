import { useEffect, useState } from 'react'
import { Icon } from '../shared/ui/Icon'
import type { LineRow } from '../shared/types'
import type { Notify } from './AdminApp'
import { api, fmtDate, num, type Overview as OverviewData } from './api'
import { ACCENT, Bars, Chart, GroupedColumns, Meter } from './charts'

/** Порядок серий закреплён за участками: цвет следует за участком, а не за позицией в выборке. */
const AREAS = ['Сварка', 'Окраска', 'Сборка']
const STATUS_RU = { ok: 'В норме', warn: 'Внимание', bad: 'Отклонение' } as const

function useOverview(notify: Notify) {
  const [data, setData] = useState<OverviewData | null>(null)
  const load = () => api.overview().then(setData, (e: Error) => notify({ kind: 'bad', text: `Сводка не загружена: ${e.message}` }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, reload: load }
}

function byDate(rows: LineRow[], pick: (r: LineRow) => number) {
  const dates = [...new Set(rows.map((r) => r.date))].sort().slice(-10)
  return dates.map((d) => ({ label: fmtDate(d).slice(0, 5), values: AREAS.map((a) => rows.find((r) => r.date === d && r.area === a)).map((r) => (r ? pick(r) : null)) }))
}

function Tile({ label, value, unit, hint, level, icon }: { label: string; value: string; unit?: string; hint: string; level?: 'ok' | 'warn' | 'bad'; icon: Parameters<typeof Icon>[0]['name'] }) {
  return (
    <div className={`tile${level ? ` tile-${level}` : ''}`}>
      <span className="tile-top"><span>{label}</span><Icon name={icon} size={15} /></span>
      <strong>{value}{unit && <small> {unit}</small>}</strong>
      <span className="tile-hint">{level && <i className="dot" aria-hidden="true" />}{level ? `${STATUS_RU[level]} · ` : ''}{hint}</span>
    </div>
  )
}

export function Overview({ notify }: { notify: Notify }) {
  const { data, reload } = useOverview(notify)
  if (!data) return <p className="muted">Загрузка…</p>
  const { kpi, insights, downtime, scada, source } = data
  const t = kpi.targets
  const p = kpi.plant
  const base = insights.base
  const flowRows = insights.flow.map((f) => ({ label: f.area, value: f.good, note: `выпуск ${num(f.fact)} · план ${num(f.plan)}` }))
  return (
    <>
      <div className="tiles">
        <Tile label="Прогноз месяца" value={num(base.month, 0)} unit="авто" hint={`план ${num(base.plan, 0)} · цель ${num(base.target, 0)}`} level={base.vsTarget >= 0 ? 'ok' : base.vsPlan >= 0 ? 'warn' : 'bad'} icon="target" />
        <Tile label="Узкое место" value={base.bottleneck} hint={`${num(base.perShift)} годных за смену`} level="bad" icon="alert" />
        <Tile label="Недовыпуск к такту" value={num(insights.lostPerMonth, 0)} unit="авто/мес" hint={`мощность при плановом такте ${num(insights.nominalCapacity, 0)}`} icon="factory" />
        <Tile label={`OEE сборки · ${fmtDate(kpi.date)}`} value={num(p.oee)} unit="%" hint={`цель ≥ ${t.oee}%`} level={p.oee >= t.oee ? 'ok' : 'bad'} icon="chart" />
        <Tile label="Брак сборки" value={num(p.defectRate)} unit="%" hint={`норма ≤ ${t.defect}%`} level={p.defectRate <= t.defect ? 'ok' : 'bad'} icon="check" />
        <Tile label="Простои за сутки" value={num(p.downtime, 0)} unit="мин" hint={`лимит ${t.downtime_critical} мин на единицу`} icon="clock" />
      </div>
      <div className="strip">
        <div><span className="eyebrow">Источник данных</span><strong>{source.source}</strong><small>{source.dates ? `${fmtDate(source.dates[0])} — ${fmtDate(source.dates[1])}` : 'нет данных'} · {source.counts.lines} смен{source.live ? ' · live идёт' : ''}</small></div>
        <div><span className="eyebrow">SCADA</span><strong>{scada?.running ? `${scada.controllers} контроллеров · ${scada.mode}` : 'выключена'}</strong><small>{scada?.running ? `тревог: ${scada.alarms?.active ?? 0}, без квитирования: ${scada.alarms?.unacked ?? 0}` : scada?.note || 'SCADA_MODE=off'}</small></div>
        <div><span className="eyebrow">Настройки</span><strong>{data.plantCustomized ? 'Паспорт завода изменён' : 'Паспорт по источникам'}</strong><small>пользователей: {data.users} · рабочих дней: {data.settings.calc.workDays}</small></div>
        <button className="button-secondary" onClick={reload}><Icon name="rotate" size={14} />Обновить</button>
      </div>
      <div className="charts">
        <Chart title="OEE по участкам" subtitle={`условный OEE за смену, % · цель ≥ ${t.oee}%`}>
          <GroupedColumns title="OEE по участкам по дням" groups={byDate(kpi.rows, (r) => r.oee)} series={AREAS} unit="%" target={{ value: t.oee, label: `цель ${t.oee}%` }} />
        </Chart>
        <Chart title="Брак по участкам" subtitle={`доля дефектов за смену, % · норма ≤ ${t.defect}%`}>
          <GroupedColumns title="Брак по участкам по дням" groups={byDate(kpi.rows, (r) => r.defectRate)} series={AREAS} unit="%" target={{ value: t.defect, label: `норма ${t.defect}%` }} />
        </Chart>
        <Chart title="Простои по причинам" subtitle={`минуты за весь период · всего ${num(downtime.total, 0)} мин`}>
          <Bars title="Простои по причинам" rows={downtime.byReason.map((r) => ({ label: r.reason, value: r.minutes }))} unit=" мин" />
        </Chart>
        <Chart title="Годные кузова за смену" subtitle="темп участков за окно расчёта · выделено узкое место">
          <Bars title="Годные кузова за смену по участкам" rows={flowRows} unit="" digits={1} highlight={(r) => r.label === base.bottleneck} max={Math.max(...insights.flow.map((f) => f.plan))} />
          <Meter value={base.month} max={base.target} label={`Прогноз ${num(base.month, 0)} из цели ${num(base.target, 0)} авто`} />
        </Chart>
      </div>
    </>
  )
}

export function Production({ notify }: { notify: Notify }) {
  const { data } = useOverview(notify)
  if (!data) return <p className="muted">Загрузка…</p>
  const { insights, scada, kpi } = data
  const levelClass = (l: string) => (l === 'bad' || l === 'high' ? 'bad' : l === 'warn' || l === 'medium' ? 'warn' : 'ok')
  const RISK = { high: 'Высокий', medium: 'Средний', low: 'Низкий' } as const
  return (
    <>
      <section className="panel">
        <h2>Отклонения</h2>
        <ul className="alerts">{insights.alerts.map((a) => <li key={a.title} className={`alert alert-${a.level}`}><b>{a.title}</b> <span>{a.text}</span>{a.area && <em>{a.area}</em>}</li>)}</ul>
      </section>
      <div className="two">
        <section className="panel">
          <h2>Мероприятия и эффект</h2>
          <table className="table">
            <thead><tr><th>Мероприятие</th><th>Эффект, авто/мес</th><th>Узкое место после</th></tr></thead>
            <tbody>{insights.levers.map((l) => <tr key={l.id}><td><b>{l.title}</b><br /><small className="muted">{l.detail}</small></td><td className={l.effect > 0 ? 'ok' : ''}>{l.effect > 0 ? `+${num(l.effect, 0)}` : '0'}</td><td>{l.bottleneckAfter}</td></tr>)}</tbody>
          </table>
          <p className="muted small">Все мероприятия вместе: {num(insights.best.month, 0)} авто/мес ({insights.best.vsTarget >= 0 ? 'цель выполняется' : `до цели ${num(-insights.best.vsTarget, 0)}`}).</p>
        </section>
        <section className="panel">
          <h2>Оборудование: риск и действие</h2>
          <table className="table">
            <thead><tr><th>Риск</th><th>Оборудование</th><th>Причина</th><th>Действие</th></tr></thead>
            <tbody>{insights.risks.map((r, i) => <tr key={`${r.equipment}-${i}`}><td className={levelClass(r.level)}>{RISK[r.level]}</td><td>{r.equipment}<br /><small className="muted">{r.area} · {r.minutes} мин ({r.shareOfLimit}% лимита)</small></td><td>{r.reason}</td><td className="small">{r.action}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
      <div className="two">
        <section className="panel">
          <h2>Журнал простоев</h2>
          <table className="table">
            <thead><tr><th>Дата</th><th>Участок</th><th>Оборудование</th><th>Причина</th><th>Мин</th><th>За сутки</th></tr></thead>
            <tbody>{kpi.downtimeEvents.map((e, i) => <tr key={i}><td>{fmtDate(e.date)}</td><td>{e.area}</td><td>{e.equipment}</td><td>{e.reason}</td><td>{e.minutes}</td><td className={e.overLimit ? 'bad' : ''}>{e.dailyMinutes} / {e.limit}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="panel">
          <h2>SCADA</h2>
          {scada?.running ? (
            <>
              <p>{scada.note}</p>
              <ul className="kv">
                <li><span>Контроллеров</span><b>{scada.controllers}</b></li>
                {Object.entries(scada.states ?? {}).map(([s, n]) => <li key={s}><span>{s}</span><b>{n}</b></li>)}
                <li><span>Активных тревог</span><b className={scada.alarms?.active ? 'bad' : ''}>{scada.alarms?.active ?? 0}</b></li>
                <li><span>Приоритет 1 / 2 / 3</span><b>{scada.alarms?.byPriority['1'] ?? 0} / {scada.alarms?.byPriority['2'] ?? 0} / {scada.alarms?.byPriority['3'] ?? 0}</b></li>
              </ul>
              <a className="button-secondary" href="/hmi.html"><Icon name="layers" size={14} />Открыть пульт HMI</a>
            </>
          ) : <p className="muted">SCADA выключена ({scada?.note || 'SCADA_MODE=off'}). Команды оборудованию подаются из пульта HMI операторами и инженерами.</p>}
          <p className="muted small" style={{ marginTop: 12, color: ACCENT }} />
        </section>
      </div>
    </>
  )
}
