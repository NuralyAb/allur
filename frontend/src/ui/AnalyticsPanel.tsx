import { useEffect, useState } from 'react'
import type { Kpi } from '../types'
import { Icon } from './Icon'
import './WorkspacePanel.css'

const dateLabel = (value: string) => value.split('-').reverse().join('.')
const num = (value: number) => value.toLocaleString('ru-RU')

export function AnalyticsPanel({ kpi, onClose, onArea }: { kpi: Kpi; onClose: () => void; onArea: (area: string) => void }) {
  const [date, setDate] = useState('all')
  const dates = [...new Set(kpi.rows.map((r) => r.date))].sort()
  const rows = kpi.rows.filter((r) => date === 'all' || r.date === date)
  const events = kpi.downtimeEvents.filter((r) => date === 'all' || r.date === date)
  const issues = kpi.meta.issues.filter((r) => date === 'all' || r.date === date)
  const period = dates.length ? [dates[0], dates.length > 1 ? dates[dates.length - 1] : null].filter(Boolean).map((d) => dateLabel(d!)).join(' — ') : 'Период не указан'

  useEffect(() => {
    document.getElementById('analytics-title')?.focus({ preventScroll: true })
  }, [])

  return (
    <section className="workspace-panel analytics-dialog" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div className="panel-title-row">
          <span className="panel-heading-icon"><Icon name="chart" /></span>
          <div><span className="panel-eyebrow">Производство / Аналитика</span><h1 id="analytics-title" tabIndex={-1}>Производственная аналитика</h1><p>{kpi.meta.demo ? 'Данные демонстрационного кейса' : 'Производственные данные'} · {period}</p></div>
        </div>
        <button type="button" className="workspace-back" onClick={onClose} aria-label="Вернуться к заводу"><Icon name="arrow-left" size={16} />К заводу</button>
      </div>
      <div className="analytics-body">
        <div className="data-notice"><Icon name="info" /><p>Сводка выпуска и качества — по Сборке-1. Данные приёмки ОТК и текущие состояния оборудования не предоставлены. Анимация 3D иллюстрирует процесс.</p></div>
        <div className="analytics-summary">
          <div><span>Факт / план сборки · {dateLabel(kpi.date)}</span><strong>{num(kpi.plant.fact)} <span>/ {num(kpi.plant.plan)}</span></strong><small>Годных: {num(kpi.plant.good)} · брак: {num(kpi.plant.fact - kpi.plant.good)}</small></div>
          <div><span>Минимальный факт участка · {dateLabel(kpi.date)}</span><strong>{num(kpi.flowMinimum.fact)} <span>авто</span></strong><small>{kpi.flowMinimum.area} · не является выпуском завода</small></div>
          <div><span>План месяца / цель</span><strong>{num(kpi.monthPlan.total)} <span>/ {num(kpi.monthPlan.target)}</span></strong><small>{kpi.monthPlan.gap > 0 ? `До цели не хватает ${num(kpi.monthPlan.gap)} авто` : 'План соответствует целевому выпуску'}</small></div>
        </div>
        <div className="section-heading">
          <div><h3>Детализация по участкам</h3><p className="section-meta">Фильтр применяется к линиям, журналу простоев и замечаниям.</p></div>
          <label className="analytics-filter">Период <select value={date} onChange={(e) => setDate(e.target.value)}><option value="all">Все даты</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
        </div>
        <section>
          <div className="section-heading"><h3>Работа линий и качество</h3><span className="section-meta">Записей: {rows.length}</span></div>
          <div className="analytics-table-wrap" role="region" aria-label="Работа линий и качество" tabIndex={0}>
            <table><thead><tr><th scope="col">Дата</th><th scope="col">Линия</th><th scope="col">План / факт</th><th scope="col">Работа, ч</th><th scope="col">Загрузка</th><th scope="col">Брак, шт. / %</th><th scope="col">OEE, демо</th></tr></thead><tbody>
              {rows.map((r) => <tr key={`${r.date}-${r.line}`}><td>{dateLabel(r.date)}</td><td><button type="button" className="area-link" onClick={() => onArea(r.area)} title={`Показать участок «${r.area}» на модели`}>{r.line}<Icon name="arrow-right" /></button></td><td className={r.fact < r.plan ? 'warn' : ''}>{num(r.plan)} / {num(r.fact)}</td><td>{num(r.hours)}</td><td>{num(r.load)}%</td><td className={r.defectRate > kpi.targets.defect ? 'bad' : ''}>{num(r.defects)} / {num(r.defectRate)}%</td><td className={r.oee < kpi.targets.oee ? 'bad' : ''}>{num(r.oee)}%</td></tr>)}
              {rows.length === 0 && <tr><td colSpan={7} className="empty-state">Нет производственных данных за выбранный период.</td></tr>}
            </tbody></table>
          </div>
          <p className="analytics-note">Цели кейса: OEE ≥ {kpi.targets.oee}%, брак ≤ {kpi.targets.defect}%. OEE условный — методика расчёта внизу страницы.</p>
        </section>
        <section>
          <div className="section-heading"><h3>Журнал простоев</h3><span className="section-meta">Событий: {events.length}</span></div>
          <p className="analytics-note">Исторические события. Порог {kpi.targets.downtime_critical} мин/сутки применяется к каждому оборудованию отдельно. Критичность оборудования в кейсе не задана.</p>
          <div className="analytics-table-wrap" role="region" aria-label="Журнал простоев" tabIndex={0}>
            <table><thead><tr><th scope="col">Дата</th><th scope="col">Участок</th><th scope="col">Оборудование</th><th scope="col">Причина</th><th scope="col">Событие, мин</th><th scope="col">За сутки, мин</th><th scope="col">Порог кейса</th></tr></thead><tbody>
              {events.map((e, i) => <tr key={`${e.date}-${e.equipment}-${i}`}><td>{dateLabel(e.date)}</td><td><button type="button" className="area-link" onClick={() => onArea(e.area)} title={`Показать участок «${e.area}» на модели`}>{e.area}<Icon name="arrow-right" /></button></td><td>{e.equipment}</td><td>{e.reason}</td><td>{num(e.minutes)}</td><td>{num(e.dailyMinutes)}</td><td><span className={`status-badge ${e.overLimit ? 'bad' : 'ok'}`}>{e.overLimit ? `Выше ${e.limit}` : `В пределах ${e.limit}`}</span></td></tr>)}
              {events.length === 0 && <tr><td colSpan={7} className="empty-state">В исходном журнале нет событий за выбранный период.</td></tr>}
            </tbody></table>
          </div>
          <p className="analytics-note">Ссылки открывают участок на модели. Точное положение оборудования с указанными ID не подтверждено.</p>
        </section>
        <section>
          <h3>Производственный план месяца</h3>
          <table className="analytics-month"><thead><tr><th scope="col">Модель</th><th scope="col">План, авто</th></tr></thead><tbody>{kpi.monthPlan.models.map((m) => <tr key={m.model}><td>{m.model}</td><td>{num(m.plan)}</td></tr>)}</tbody><tfoot><tr><th scope="row">Итого</th><td>{num(kpi.monthPlan.total)}</td></tr></tfoot></table>
          <p className="analytics-note">План кейса — {num(kpi.monthPlan.total)}, целевой выпуск — {num(kpi.monthPlan.target)} авто. Факт месяца и разбивка выпуска по моделям не предоставлены.</p>
        </section>
        <section className="analytics-issues"><h3>Качество исходных данных</h3><p className="analytics-note">Указаны {kpi.targets.shifts} смены по {kpi.meta.shiftHours} часов. Не уточнено, к какой смене относятся строки и охватывает ли журнал весь день. При сопоставлении с одной сменой:</p>
          <ul>{issues.map((issue) => <li key={`${issue.date}-${issue.line}`}><b>{dateLabel(issue.date)} · {issue.line}:</b> {issue.message}</li>)}</ul>
          {issues.length === 0 && <p>Превышения {kpi.meta.shiftHours} часов в выбранных строках не выявлены. Период записей требует уточнения.</p>}
        </section>
        <details className="analytics-method"><summary>Источник данных и методика расчёта</summary><p>{kpi.meta.source}</p><ul>{kpi.meta.methodology.map((text) => <li key={text}>{text}</li>)}</ul></details>
      </div>
    </section>
  )
}
