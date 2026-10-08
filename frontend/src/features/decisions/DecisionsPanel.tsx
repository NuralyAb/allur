import { useEffect, useState } from 'react'
import { runScenario } from '../../shared/api/twin'
import type { Insights, ScenarioResult } from '../../shared/types'
import { Icon } from '../../shared/ui/Icon'
import '../workspace/WorkspacePanel.css'
import { loadForecastModel } from './studio/api'
import { PlanFinder, ProbabilityForecast, ReliabilityControls, SensitivityView, fromPlan, toRequest, type StudioChoice } from './studio/ForecastStudio'
import type { ForecastModel } from './studio/types'

const num = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x))
const tenge = (x: number) => `${(x / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд ₸`
const RISK = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }

export function DecisionsPanel({ insights, onClose, onArea }: { insights: Insights; onClose: () => void; onArea: (area: string) => void }) {
  const base = insights.base
  const [levers, setLevers] = useState<string[]>([])
  const [shifts, setShifts] = useState(base.shifts)
  const [daysInput, setDaysInput] = useState(String(base.days))
  const [extraShiftsInput, setExtraShiftsInput] = useState('0')
  const [result, setResult] = useState<ScenarioResult>(base)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  // параметры надёжности сценарной студии: влияют на вероятностный прогноз
  const [model, setModel] = useState<ForecastModel | null>(null)
  const [buffer, setBuffer] = useState<number | null>(null)
  const [repairPct, setRepairPct] = useState(100)
  const [speedPct, setSpeedPct] = useState(0)
  // Маржинальный доход на автомобиль вводит руководитель: в данных кейса его нет.
  const [margin, setMargin] = useState('')
  const parsedMargin = Number(margin.replace(/\s/g, ''))
  const marginValue = Number.isFinite(parsedMargin) ? parsedMargin : 0
  const days = Number(daysInput)
  const extraShifts = Number(extraShiftsInput)
  const validDays = /^\d+$/.test(daysInput) && days >= 1 && days <= 31
  const validExtraShifts = /^\d+$/.test(extraShiftsInput) && extraShifts >= 0 && extraShifts <= 20
  const validInputs = validDays && validExtraShifts

  useEffect(() => {
    document.getElementById('decisions-title')?.focus({ preventScroll: true })
    loadForecastModel().then(setModel, () => setModel(null))
  }, [])

  useEffect(() => {
    if (!validInputs) {
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      runScenario({ levers, shifts, days, extraShifts }, ctrl.signal).then(
        (r) => { if (!ctrl.signal.aborted) { setResult(r); setError(null); setLoading(false) } },
        (e: Error) => { if (!ctrl.signal.aborted) { setError(e.message); setLoading(false) } },
      )
    }, 200)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [levers, shifts, days, extraShifts, validInputs, retry])

  const choice: StudioChoice = { levers, shifts, days, extraShifts, buffer: buffer ?? model?.buffer ?? 10, repairPct, speedPct }
  const forecastRequest = model && validInputs ? toRequest(model, choice, base.bottleneck) : null
  const applyChoice = (c: StudioChoice) => {
    setLevers(c.levers); setShifts(c.shifts); setDaysInput(String(c.days)); setExtraShiftsInput(String(c.extraShifts))
    setBuffer(c.buffer); setRepairPct(c.repairPct); setSpeedPct(c.speedPct)
  }
  const toggle = (id: string) => setLevers((ls) => (ls.includes(id) ? ls.filter((x) => x !== id) : [...ls, id]))
  const reset = () => { setLevers([]); setShifts(base.shifts); setDaysInput(String(base.days)); setExtraShiftsInput('0'); setBuffer(null); setRepairPct(100); setSpeedPct(0) }
  const gain = result.month - base.month
  const changed = levers.length > 0 || shifts !== base.shifts || days !== base.days || extraShifts > 0 || buffer !== null || repairPct !== 100 || speedPct !== 0
  const stale = loading || !!error || !validInputs

  return (
    <section className="workspace-panel analytics-dialog decisions decisions-dialog" aria-labelledby="decisions-title">
      <div className="analytics-heading">
        <div className="panel-title-row">
          <span className="panel-heading-icon"><Icon name="target" /></span>
          <div><span className="panel-eyebrow">Производство / Планирование</span><h1 id="decisions-title" tabIndex={-1}>Центр решений</h1><p>Найдите ограничения и оцените эффект изменений на выпуск месяца.</p></div>
        </div>
        <button type="button" className="workspace-back" onClick={onClose} aria-label="Вернуться к заводу"><Icon name="arrow-left" size={16} />К заводу</button>
      </div>
      <div className="analytics-body">
        <div className="data-notice"><Icon name="info" /><p>Сценарный расчёт по данным кейса. Прогноз зависит от заданных смен, рабочих дней и допущений модели.</p></div>
        <div className="section-heading"><h3>Производственный потенциал</h3><span className="section-meta">{stale ? 'Показан последний успешный расчёт' : changed ? 'Ваш сценарий' : 'Базовый сценарий'}</span></div>
        <div className="analytics-summary decisions-summary" aria-busy={loading}>
          <div className={result.vsTarget < 0 ? 'card-bad' : 'card-ok'}>
            <span>Прогноз месяца</span><strong>{num(result.month)} <span>авто</span></strong>
            <small>План {num(result.plan)}: {signed(result.vsPlan)} · цель {num(result.target)}: {signed(result.vsTarget)}</small>
          </div>
          <div className="card-bad">
            <span>Узкое место</span><strong>{result.bottleneck}</strong>
            <small>{num(result.perShift)} годных / смену · ограничение выпуска в модели</small>
          </div>
          <div className="card-warn">
            <span>Недовыпуск к плановому такту</span><strong>{num(insights.lostPerMonth)} <span>авто/мес</span></strong>
            <small>{marginValue ? `≈ ${tenge(insights.lostPerMonth * marginValue)} маржи` : 'В базовом сценарии · маржу можно указать ниже'}</small>
          </div>
          <div className="card-warn">
            <span>Мощность при плановом такте</span><strong>{num(insights.nominalCapacity)} <span>авто</span></strong>
            <small>{insights.nominalCapacity < base.target ? `Цель ${num(base.target)} выше мощности: нужны дополнительные смены или короче такт` : 'Цель в пределах мощности'}</small>
          </div>
        </div>

        <section>
          <div className="section-heading"><h3>Производственный поток</h3><span className="section-meta">Годные кузова за смену</span></div>
          <div className="flow">
            {insights.flow.map((f, i) => {
              const a = result.areas[f.area]
              const next = insights.flow[i + 1]
              const delta = next ? a.good - next.fact : 0
              return (
                <div className="flow-step" key={f.area}>
                  <button type="button" className={`flow-node${f.area === result.bottleneck ? ' bottleneck' : ''}`} onClick={() => onArea(f.area)} title={`Показать участок «${f.area}» на модели`}>
                    <span>{f.area}{f.area === result.bottleneck && ' · узкое место'}</span><strong>{num(a.good)}</strong>
                    <small>Выпуск {num(a.output)} · брак {num(a.defectRate)}%<br />Такт {num(f.takt)} мин</small>
                  </button>
                  {next && <div className={`flow-arrow${delta < 0 ? ' bad' : ''}`} title="Годные на входе следующего участка минус его фактический темп"><Icon name="arrow-right" /><small>{delta < 0 ? `буфер ${signed(delta)}/смену` : 'хватает'}</small></div>}
                </div>
              )
            })}
          </div>
          <p className="analytics-note">В последовательной модели выпуск ограничивает участок с минимальной пропускной способностью. Выберите участок, чтобы увидеть его на 3D-модели.</p>
        </section>

        <section>
          <div className="section-heading"><div><h3>Сценарий «что если»</h3><p className="section-meta">Выберите мероприятия — прогноз пересчитается автоматически.</p></div><button type="button" className="text-button" onClick={reset} disabled={!changed && validInputs}><Icon name="rotate" />Сбросить сценарий</button></div>
          <div className="levers">
            {insights.levers.map((l) => (
              <label key={l.id} className={`lever${levers.includes(l.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={levers.includes(l.id)} onChange={() => toggle(l.id)} />
                <div><b>{l.title}</b><small>{l.detail}</small><small>{l.effect > 0 ? `Отдельно: +${num(l.effect)} авто/мес${marginValue ? ` · ${tenge(l.effect * marginValue)}` : ''}${l.bottleneckAfter !== base.bottleneck ? ` · узкое место сдвинется на «${l.bottleneckAfter}»` : ''}` : `Отдельно не увеличивает выпуск: ограничение — ${base.bottleneck.toLowerCase()}`}</small></div>
                <span className={l.effect > 0 ? 'lever-effect ok' : 'lever-effect'}>{l.effect > 0 ? `+${num(l.effect)}` : '0'}<small>авто/мес</small></span>
              </label>
            ))}
          </div>
          <div className="scenario-controls">
            <label>Смен в сутки<select value={shifts} onChange={(e) => setShifts(Number(e.target.value))}>{[1, 2, 3].map((s) => <option key={s} value={s}>{s}</option>)}</select><small className="field-hint">Основной рабочий график</small></label>
            <label>Рабочих дней<input type="number" inputMode="numeric" min={1} max={31} step={1} value={daysInput} aria-invalid={!validDays} aria-describedby="scenario-days-hint" onChange={(e) => setDaysInput(e.target.value)} /><small id="scenario-days-hint" className={`field-hint${validDays ? '' : ' bad'}`}>Целое число от 1 до 31</small></label>
            <label>Доп. смен в выходные<input type="number" inputMode="numeric" min={0} max={20} step={1} value={extraShiftsInput} aria-invalid={!validExtraShifts} aria-describedby="scenario-extra-hint" onChange={(e) => setExtraShiftsInput(e.target.value)} /><small id="scenario-extra-hint" className={`field-hint${validExtraShifts ? '' : ' bad'}`}>Целое число от 0 до 20</small></label>
            <label>Маржа на авто, ₸<input inputMode="numeric" placeholder="Укажите сумму" value={margin} maxLength={18} aria-describedby="scenario-margin-hint" onChange={(e) => setMargin(e.target.value.replace(/[^\d\s]/g, ''))} /><small id="scenario-margin-hint" className="field-hint">Необязательно · ваша оценка</small></label>
          </div>
          <div className={`scenario-result${!stale && result.vsTarget >= 0 ? ' ok' : ''}`} role="status" aria-live="polite" aria-atomic="true" aria-busy={loading}>
            {!validInputs ? <span className="bad"><Icon name="alert" />Проверьте диапазоны рабочих дней и дополнительных смен.</span> : error ? <><span className="bad"><Icon name="alert" />Не удалось пересчитать сценарий. Проверьте соединение и повторите попытку.</span><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить расчёт<Icon name="rotate" /></button></> : loading ? <span className="scenario-status"><Icon name="clock" />Пересчитываем производственный сценарий…</span> : (
              <><b>{num(result.month)} авто/мес</b><span>{changed ? `${signed(gain)} к текущему темпу${marginValue && gain ? ` (${tenge(gain * marginValue)})` : ''}` : 'Текущий производственный темп'}</span><span>Узкое место: {result.bottleneck.toLowerCase()} · {num(result.perShift)} годных/смену</span><span>{result.vsTarget >= 0 ? `Цель ${num(result.target)} авто выполняется` : `До цели ${num(-result.vsTarget)} авто: ещё ${result.extraShiftsForTarget} доп. смен или ${num(result.requiredPerShift)} годных/смену`}</span></>
            )}
          </div>
        </section>

        {model && <>
          <section aria-labelledby="forecast-title">
            <div className="section-heading"><div><h3 id="forecast-title">Вероятностный прогноз месяца</h3><p className="section-meta">Тот же сценарий, но отказы случаются в случайное время и длятся случайно, буферы между участками конечны.</p></div></div>
            <ReliabilityControls model={model} choice={choice} bottleneck={base.bottleneck} onChange={(c) => { setBuffer(c.buffer); setRepairPct(c.repairPct); setSpeedPct(c.speedPct) }} />
            <ProbabilityForecast request={forecastRequest} model={model} />
          </section>
          <section aria-labelledby="plan-title">
            <div className="section-heading"><div><h3 id="plan-title">Как выйти на цель</h3><p className="section-meta">Самые дешёвые сочетания мероприятий и смен в выходные, при которых цель выполняется с заданной уверенностью.</p></div></div>
            <PlanFinder margin={marginValue} target={model.target} onApply={(p) => { applyChoice(fromPlan(p, choice)); document.getElementById('forecast-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
          </section>
          <section aria-labelledby="sensitivity-title">
            <div className="section-heading"><div><h3 id="sensitivity-title">Что сильнее влияет на выпуск</h3><p className="section-meta">Каждое мероприятие отдельно, на одних и тех же случайных отказах. Отрезок — 80% прогонов.</p></div></div>
            <SensitivityView margin={marginValue} />
            <p className="analytics-note">Расчёт по средним показывает эффект только на узком месте. Модель с буферами видит больше: долгий отказ сборки через заполненный буфер останавливает окраску, поэтому предиктивное ТО и быстрый ремонт конвейера дают прирост, хотя сборка — не узкое место.</p>
          </section>
          <details className="analytics-method"><summary>Как устроен вероятностный прогноз</summary><ul>{model.assumptions.map((t) => <li key={t}>{t}</li>)}</ul></details>
        </>}

        <section>
          <div className="section-heading"><h3>Отклонения базового сценария</h3><span className="section-meta">{insights.alerts.length} уведомлений</span></div>
          <ul className="alerts">{insights.alerts.map((a) => <li key={a.title} className={`alert alert-${a.level}`}><b>{a.title}</b><span>{a.text}</span>{a.area && <button type="button" className="area-link" onClick={() => onArea(a.area!)}>Показать участок<Icon name="arrow-right" /></button>}</li>)}</ul>
          {insights.alerts.length === 0 && <p className="empty-state">В исходных данных не выявлены отклонения.</p>}
        </section>

        <section>
          <h3>Оборудование: риск и действие</h3>
          <div className="analytics-table-wrap" role="region" aria-label="Риски оборудования и рекомендуемые действия" tabIndex={0}><table><thead><tr><th scope="col">Риск</th><th scope="col">Оборудование</th><th scope="col">Причина</th><th scope="col">Простой</th><th scope="col">Потеря</th><th scope="col">Действие</th></tr></thead><tbody>
            {insights.risks.map((r, i) => <tr key={`${r.date}-${r.equipment}-${i}`}><td><span className={`status-badge ${r.level === 'high' ? 'bad' : r.level === 'medium' ? 'warn' : 'ok'}`}>{RISK[r.level]}</span></td><td><button type="button" className="area-link" onClick={() => onArea(r.area)}>{r.equipment}<Icon name="arrow-right" /></button><br /><small className="muted">{r.area}</small></td><td>{r.reason}<br /><small className="muted">{r.planned ? 'Плановый' : 'Внеплановый'}</small></td><td>{num(r.minutes)} мин<br /><small className="muted">{num(r.shareOfLimit)}% лимита {r.limit} мин</small></td><td>{num(r.carsLost)} авто на участке<br /><small className="muted">{r.onBottleneck ? `${num(r.plantCarsLost)} авто — потеря завода` : 'Не снижает выпуск завода в модели'}</small></td><td className="action">{r.action}</td></tr>)}
            {insights.risks.length === 0 && <tr><td colSpan={6} className="empty-state">События риска для оборудования отсутствуют.</td></tr>}
          </tbody></table></div>
        </section>
        <details className="analytics-method"><summary>Допущения и методика расчёта</summary><ul>{insights.assumptions.map((t) => <li key={t}>{t}</li>)}</ul></details>
      </div>
    </section>
  )
}
