import { useEffect, useRef, useState } from 'react'
import type { Kpi } from '../types'

const dateLabel = (value: string) => value.split('-').reverse().join('.')

export function AnalyticsPanel({ kpi, onClose, onArea }: { kpi: Kpi; onClose: () => void; onArea: (area: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null!)
  const [date, setDate] = useState('all')
  const dates = [...new Set(kpi.rows.map((r) => r.date))].sort()
  const rows = kpi.rows.filter((r) => date === 'all' || r.date === date)
  const events = kpi.downtimeEvents.filter((r) => date === 'all' || r.date === date)
  const issues = kpi.meta.issues.filter((r) => date === 'all' || r.date === date)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog ref={ref} className="analytics-dialog" aria-labelledby="analytics-title" onCancel={onClose}>
      <div className="analytics-heading">
        <div><h2 id="analytics-title">Производственная аналитика</h2><p>Демонстрационные данные кейса · 01–02 октября 2026</p></div>
        <button className="analytics-close" onClick={onClose} aria-label="Закрыть аналитику" autoFocus>×</button>
      </div>
      <div className="analytics-body">
      <p className="analytics-note">Сводка выпуска и качества основана на Сборке-1. Приёмка ОТК и текущие состояния оборудования в исходных данных отсутствуют. Анимация 3D иллюстрирует процесс.</p>
      <div className="analytics-summary">
        <div><span>Факт сборки · {dateLabel(kpi.date)}</span><strong>{kpi.plant.fact} / {kpi.plant.plan}</strong><small>Годных: {kpi.plant.good}; брак: {kpi.plant.fact - kpi.plant.good}</small></div>
        <div><span>Минимальный факт участка · {dateLabel(kpi.date)}</span><strong>{kpi.flowMinimum.fact}</strong><small>{kpi.flowMinimum.area} · выпуск завода из этого не следует</small></div>
        <div><span>План месяца / цель</span><strong>{kpi.monthPlan.total.toLocaleString('ru-RU')} / {kpi.monthPlan.target.toLocaleString('ru-RU')}</strong><small>До цели не хватает {kpi.monthPlan.gap.toLocaleString('ru-RU')} авто</small></div>
      </div>
      <label className="analytics-filter">Период таблиц и журнала <select value={date} onChange={(e) => setDate(e.target.value)}><option value="all">Все даты</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
      <section>
        <h3>Работа линий и качество</h3>
        <div className="analytics-table-wrap"><table><thead><tr><th>Дата</th><th>Линия</th><th>План / факт</th><th>Работа, ч</th><th>Загрузка</th><th>Брак, шт. / %</th><th>OEE, демо</th></tr></thead><tbody>
          {rows.map((r) => <tr key={`${r.date}-${r.line}`}><td>{dateLabel(r.date)}</td><td><button className="area-link" onClick={() => onArea(r.area)}>{r.line} ↗</button></td><td className={r.fact < r.plan ? 'warn' : ''}>{r.plan} / {r.fact}</td><td>{r.hours}</td><td>{r.load}%</td><td className={r.defectRate > kpi.targets.defect ? 'bad' : ''}>{r.defects} / {r.defectRate}%</td><td className={r.oee < kpi.targets.oee ? 'bad' : ''}>{r.oee}%</td></tr>)}
        </tbody></table></div>
        <p className="analytics-note">Цели кейса: OEE ≥ {kpi.targets.oee}%, брак ≤ {kpi.targets.defect}%. OEE здесь условный; методика приведена ниже.</p>
      </section>
      <section>
        <h3>Журнал простоев</h3>
        <p className="analytics-note">Исторические события. Порог {kpi.targets.downtime_critical} мин/сутки применяется к каждому оборудованию отдельно. Его критичность в кейсе не задана.</p>
        <div className="analytics-table-wrap"><table><thead><tr><th>Дата</th><th>Участок</th><th>Оборудование</th><th>Причина</th><th>Событие, мин</th><th>За сутки, мин</th><th>Порог кейса</th></tr></thead><tbody>
          {events.map((e, i) => <tr key={`${e.date}-${e.equipment}-${i}`}><td>{dateLabel(e.date)}</td><td><button className="area-link" onClick={() => onArea(e.area)}>{e.area} ↗</button></td><td>{e.equipment}</td><td>{e.reason}</td><td>{e.minutes}</td><td>{e.dailyMinutes}</td><td className={e.overLimit ? 'bad' : ''}>{e.overLimit ? `Выше ${e.limit}` : `В пределах ${e.limit}`}</td></tr>)}
          {events.length === 0 && <tr><td colSpan={7}>В исходном журнале нет событий за эту дату.</td></tr>}
        </tbody></table></div>
        <p className="analytics-note">Ссылки переводят камеру к участку. Положение оборудования с указанными ID в 3D не подтверждено.</p>
      </section>
      <section>
        <h3>Производственный план месяца</h3>
        <table className="analytics-month"><thead><tr><th>Модель</th><th>План, авто</th></tr></thead><tbody>{kpi.monthPlan.models.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.plan.toLocaleString('ru-RU')}</td></tr>)}</tbody><tfoot><tr><th>Итого</th><th>{kpi.monthPlan.total.toLocaleString('ru-RU')}</th></tr></tfoot></table>
        <p className="analytics-note">План в таблице кейса — {kpi.monthPlan.total.toLocaleString('ru-RU')}, целевой выпуск — {kpi.monthPlan.target.toLocaleString('ru-RU')}. Факт месяца и разбивка выпуска по моделям не предоставлены.</p>
      </section>
      <section className="analytics-issues"><h3>Неоднозначности исходных данных</h3><p className="analytics-note">Указаны {kpi.targets.shifts} смены по {kpi.meta.shiftHours} часов. Не уточнено, к какой смене относятся строки и охватывает ли журнал весь день. При сопоставлении с одной сменой:</p>
        <ul>{issues.map((issue) => <li key={`${issue.date}-${issue.line}`}><b>{dateLabel(issue.date)} · {issue.line}:</b> {issue.message}</li>)}</ul>
        {issues.length === 0 && <p>Превышения 8 часов в выбранных строках не выявлено; период записей всё равно требует уточнения.</p>}
      </section>
      <details className="analytics-method"><summary>Источник данных и методика расчёта</summary><p>{kpi.meta.source}</p><ul>{kpi.meta.methodology.map((text) => <li key={text}>{text}</li>)}</ul></details>
      </div>
    </dialog>
  )
}
