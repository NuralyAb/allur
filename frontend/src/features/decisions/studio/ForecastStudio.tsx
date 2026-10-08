/**
 * Сценарная студия в центре решений: тот же сценарий, что выбирает руководитель, плюс параметры надёжности,
 * прогоняется сотни раз со случайными отказами. Показывает разброс выпуска месяца, вероятность плана и цели,
 * узкие места, эффект мероприятий и самые дешёвые планы выхода на цель.
 */
import { useEffect, useState } from 'react'
import { Icon } from '../../../shared/ui/Icon'
import { findPlan, loadSensitivity, runForecast } from './api'
import { BottleneckShare, Distribution, SensitivityBars } from './charts'
import type { Forecast, ForecastModel, ForecastRequest, PlanResult, Sensitivity, TargetPlan } from './types'
import './forecast.css'

const num = (x: number) => Math.round(x).toLocaleString('ru-RU')
const pct = (x: number) => `${Math.round(x * 100)}%`
const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x))
const mln = (x: number) => `${(x / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₸`

/** Выбор руководителя в центре решений: мероприятия, календарь и параметры надёжности. */
export interface StudioChoice {
  levers: string[]
  shifts: number
  days: number
  extraShifts: number
  buffer: number
  repairPct: number // длительность внеплановых ремонтов, % от журнала
  speedPct: number // ускорение темпа узкого места, %
}

export function toRequest(model: ForecastModel, c: StudioChoice, bottleneck: string): ForecastRequest {
  const defect: Record<string, number> = {}
  for (const id of c.levers) if (id.startsWith('quality:')) defect[id.slice(8)] = model.defectTarget
  const repair: Record<string, number> = {}
  if (c.repairPct !== 100)
    for (const s of model.stages) for (const f of s.failures) if (!f.planned) repair[f.equipment] = f.minutes * c.repairPct / 100
  return {
    defect, repair,
    plannedOutside: c.levers.includes('planned'),
    predictive: c.levers.includes('predictive') ? model.predictiveDefault : 0,
    speed: c.speedPct ? { [bottleneck]: 1 + c.speedPct / 100 } : {},
    buffer: c.buffer, shifts: c.shifts, days: c.days, extraShifts: c.extraShifts, runs: 300,
  }
}

/** План подбора → выбор в центре решений (обратное к toRequest). */
export function fromPlan(plan: TargetPlan, c: StudioChoice): StudioChoice {
  const ids = plan.actions.map((a) => a.id)
  return {
    ...c,
    levers: ids.filter((id) => id === 'planned' || id === 'predictive' || id.startsWith('quality:')),
    repairPct: ids.includes('fastRepair') ? 50 : 100,
    speedPct: ids.some((id) => id.startsWith('speed:')) ? 5 : 0,
    extraShifts: plan.extraShifts,
  }
}

export function ReliabilityControls({ model, choice, onChange, bottleneck }: {
  model: ForecastModel; choice: StudioChoice; onChange: (c: StudioChoice) => void; bottleneck: string
}) {
  const unplanned = model.stages.flatMap((s) => s.failures.filter((f) => !f.planned))
  return (
    <div className="fc-controls">
      <label>
        <span>Буфер между участками <b>{choice.buffer} кузовов</b></span>
        <input type="range" min={2} max={40} step={1} value={choice.buffer} onChange={(e) => onChange({ ...choice, buffer: Number(e.target.value) })} />
        <small>≈ {num(choice.buffer * 4)} мин работы следующего участка. Сейчас по допущению — {model.buffer}.</small>
      </label>
      <label>
        <span>Длительность внеплановых ремонтов <b>{choice.repairPct}%</b></span>
        <input type="range" min={30} max={150} step={10} value={choice.repairPct} onChange={(e) => onChange({ ...choice, repairPct: Number(e.target.value) })} />
        <small>{unplanned.length ? unplanned.map((f) => `${f.equipment}: ${num(f.minutes * choice.repairPct / 100)} мин`).join(' · ') : 'Внеплановых отказов в данных нет'}</small>
      </label>
      <label>
        <span>Темп участка «{bottleneck}» <b>+{choice.speedPct}%</b></span>
        <input type="range" min={0} max={15} step={1} value={choice.speedPct} onChange={(e) => onChange({ ...choice, speedPct: Number(e.target.value) })} />
        <small>Балансировка линии на узком месте: короче такт, больше кузовов за смену.</small>
      </label>
    </div>
  )
}

export function ProbabilityForecast({ request, model }: { request: ForecastRequest | null; model: ForecastModel }) {
  const [f, setF] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(request)
  useEffect(() => {
    if (!request) return
    const ctrl = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      runForecast(request, ctrl.signal).then(
        (r) => { if (!ctrl.signal.aborted) { setF(r); setError(null); setLoading(false) } },
        (e: Error) => { if (!ctrl.signal.aborted) { setError(e.message); setLoading(false) } },
      )
    }, 350)
    return () => { window.clearTimeout(timer); ctrl.abort() }
  }, [key])

  if (!f) return <div className="fc-loading" aria-busy="true"><Icon name="clock" />{error ? 'Не удалось получить прогноз. Проверьте соединение.' : 'Моделируем месяц: сотни прогонов со случайными отказами…'}</div>
  const changed = f.gain !== 0 || f.mean !== f.base.mean
  return (
    <div className={`fc-forecast${loading ? ' stale' : ''}`} aria-busy={loading}>
      <div className="fc-tiles">
        <div>
          <span>Выпуск месяца, медиана</span>
          <strong>{num(f.p50)} <small>авто</small></strong>
          <small>80% прогонов: {num(f.p10)}–{num(f.p90)}{changed ? ` · ${signed(f.gain)} к текущему` : ''}</small>
        </div>
        <div className={f.probPlan >= 0.8 ? 'ok' : f.probPlan >= 0.5 ? 'warn' : 'bad'}>
          <span>Вероятность выполнить план</span>
          <strong>{pct(f.probPlan)}</strong>
          <small>План {num(f.plan)} авто{changed ? ` · было ${pct(f.base.probPlan)}` : ''}</small>
        </div>
        <div className={f.probTarget >= 0.8 ? 'ok' : f.probTarget >= 0.5 ? 'warn' : 'bad'}>
          <span>Вероятность выйти на цель</span>
          <strong>{pct(f.probTarget)}</strong>
          <small>Цель {num(f.target)} авто{changed ? ` · было ${pct(f.base.probTarget)}` : ''}</small>
        </div>
        <div className="warn">
          <span>Цена нестабильности</span>
          <strong>−{num(f.variabilityLoss)} <small>авто</small></strong>
          <small>Расчёт по средним — {num(f.deterministic)}; случайные отказы и конечные буферы съедают разницу</small>
        </div>
      </div>
      <div className="fc-grid">
        <section>
          <h4>Разброс выпуска за месяц</h4>
          <Distribution f={f} />
        </section>
        <section>
          <h4>Где узкое место</h4>
          <BottleneckShare shares={f.bottleneckShare} />
          <p className="fc-caption">Доля прогонов, в которых участок дольше всех работал без ожидания соседей.</p>
          <table className="fc-areas">
            <thead><tr><th scope="col">Участок</th><th scope="col">Простой</th><th scope="col">Ждёт кузова</th><th scope="col">Буфер полон</th></tr></thead>
            <tbody>{Object.entries(f.areas).map(([area, a]) => <tr key={area}><td>{area}</td><td>{num(a.down)} мин</td><td>{num(a.starved)} мин</td><td>{num(a.blocked)} мин</td></tr>)}</tbody>
          </table>
          <p className="fc-caption">Минут за смену в среднем по прогонам.</p>
        </section>
      </div>
      <p className="fc-caption">{f.runs} прогонов месяца ({f.shifts} смен) · калибровка по данным {model.period[0]} — {model.period[1]}</p>
    </div>
  )
}

export function SensitivityView({ margin }: { margin: number }) {
  const [s, setS] = useState<Sensitivity | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => { loadSensitivity().then(setS, () => setError(true)) }, [])
  if (!s) return <div className="fc-loading" aria-busy="true"><Icon name="clock" />{error ? 'Не удалось рассчитать эффект мероприятий.' : 'Считаем эффект каждого мероприятия…'}</div>
  return <SensitivityBars s={s} margin={margin} />
}

export function PlanFinder({ margin, target, onApply }: { margin: number; target: number; onApply: (plan: TargetPlan) => void }) {
  const [confidence, setConfidence] = useState(0.8)
  const [result, setResult] = useState<PlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const run = () => {
    setLoading(true)
    setError(false)
    findPlan({ confidence, margin }).then((r) => { setResult(r); setLoading(false) }, () => { setError(true); setLoading(false) })
  }
  return (
    <div className="fc-plan">
      <div className="fc-plan-form">
        <label>Уверенность в результате
          <select value={confidence} onChange={(e) => { setConfidence(Number(e.target.value)); setResult(null) }}>
            {[0.5, 0.7, 0.8, 0.9, 0.95].map((c) => <option key={c} value={c}>{pct(c)} прогонов</option>)}
          </select>
        </label>
        <button type="button" className="fc-primary" onClick={run} disabled={loading}><Icon name="target" />{loading ? 'Подбираем план…' : `Как выйти на ${num(target)}?`}</button>
      </div>
      {error && <p className="bad" role="status">Не удалось подобрать план. Повторите попытку.</p>}
      {result && (
        <div aria-live="polite">
          <p className="fc-caption">Сейчас: {num(result.base)} авто в среднем, цель выполняется в {pct(result.baseProb)} прогонов. Перебраны все сочетания мероприятий; число смен в выходные добрано до уверенности {pct(result.confidence)}.</p>
          {result.plans.length === 0 && <p className="empty-state">Цель недостижима даже с {num(20)} дополнительными сменами.</p>}
          <ol className="fc-plans">
            {result.plans.map((p, i) => (
              <li key={i} className={i === 0 ? 'best' : ''}>
                <header>
                  <span className="eyebrow">{i === 0 ? 'Самый дешёвый' : `Вариант ${i + 1}`}</span>
                  <strong>{mln(p.cost)} <small>в месяц</small></strong>
                </header>
                <ul>
                  {p.actions.map((a) => <li key={a.id}>{a.title}<small>{mln(a.cost)}</small></li>)}
                  {p.extraShifts > 0 && <li>{p.extraShifts} {p.extraShifts === 1 ? 'смена' : p.extraShifts < 5 ? 'смены' : 'смен'} в выходные<small>{mln(p.extraShifts * result.shiftCost)}</small></li>}
                  {p.actions.length === 0 && p.extraShifts === 0 && <li>Ничего менять не нужно</li>}
                </ul>
                <div className="fc-plan-result">
                  <span><b>{num(p.mean)}</b> авто в среднем · {signed(p.gain)}</span>
                  <span className={p.reached ? 'ok' : 'bad'}>Цель в {pct(p.probTarget)} прогонов</span>
                  {p.net !== null && <span className={p.net >= 0 ? 'ok' : 'bad'}>Маржа минус затраты: {p.net >= 0 ? '+' : '−'}{mln(Math.abs(p.net))}</span>}
                </div>
                <button type="button" className="text-button" onClick={() => onApply(p)}>Применить к сценарию<Icon name="arrow-right" /></button>
              </li>
            ))}
          </ol>
          {!margin && <p className="fc-caption">Укажите маржу на автомобиль в сценарии выше — план покажет, окупаются ли затраты.</p>}
        </div>
      )}
    </div>
  )
}
