import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../../shared/ui/Icon'
import { ai, usePoll, type Anomaly, type ChatMessage, type ChatReply, type Forecast, type Maintenance, type Prediction, type Quality, type AiStatus } from './api'
import '../workspace/WorkspacePanel.css'
import './ai.css'

const num = (x: number, d = 1) => x.toLocaleString('ru-RU', { maximumFractionDigits: d })
const pct = (x: number, d = 0) => `${(x * 100).toLocaleString('ru-RU', { maximumFractionDigits: d })}%`
const SEVERITY = { bad: 'Высокий', warn: 'Внимание', ok: 'Норма' }
// категориальные цвета двойника (проверены на различимость, порядок фиксирован): серия закреплена за сценарием
const SCENARIO_COLOR = { base: '#2a78d6', ai: '#eb6834' } as const
const BAR = '#2a78d6'
// участки — те же три цвета в том же порядке потока, что и в графиках админки
const AREA_COLOR: Record<string, string> = { 'Сварка': '#2a78d6', 'Окраска': '#eb6834', 'Сборка': '#1baf7a' }

export function AiPanel({ onClose, onArea }: { onClose: () => void; onArea: (area: string) => void }) {
  const status = usePoll(ai.status, 10000)
  const maint = usePoll(ai.maintenance, 5000)
  const quality = usePoll(ai.quality, 10000)
  const forecast = usePoll(ai.forecast, 60000)

  useEffect(() => { document.getElementById('ai-title')?.focus({ preventScroll: true }) }, [])

  return (
    <section className="workspace-panel analytics-dialog ai-panel" aria-labelledby="ai-title">
      <div className="analytics-heading">
        <div className="panel-title-row">
          <span className="panel-heading-icon"><Icon name="spark" /></span>
          <div><span className="panel-eyebrow">Производство / Искусственный интеллект</span><h1 id="ai-title" tabIndex={-1}>ИИ-аналитик</h1>
            <p>Модели следят за датчиками линии и предупреждают об отказе раньше, чем сработает защита ПЛК. Они же объясняют брак, оценивают вероятность выполнить план и отвечают на вопросы по живым данным.</p></div>
        </div>
        <button type="button" className="workspace-back" onClick={onClose} aria-label="Вернуться к заводу"><Icon name="arrow-left" size={16} />К заводу</button>
      </div>
      <div className="analytics-body">
        <ModelStrip status={status.data} />
        <Summary maint={maint.data} forecast={forecast.data} status={status.data} />
        <div className="ai-layout">
          <div className="ai-main">
            <Failures maint={maint.data} status={status.data} onArea={onArea} onDemo={maint.refresh} />
            <Anomalies list={maint.data?.anomalies ?? []} ready={status.data?.status === 'ready'} onArea={onArea} />
            <QualitySection quality={quality.data} onArea={onArea} />
            <ForecastSection forecast={forecast.data} />
          </div>
          <Assistant status={status.data} />
        </div>
      </div>
    </section>
  )
}

function ModelStrip({ status }: { status: AiStatus | null }) {
  if (!status) return <div className="data-notice"><Icon name="clock" /><p>Подключаемся к моделям…</p></div>
  const m = status.metrics
  const q = Object.values(m.quality ?? {}).map((x) => x.auc).filter((x): x is number => x !== null)
  const llm = status.llm.mode === 'llm' ? `OpenAI (${status.llm.model})` : status.llm.mode === 'offline' ? 'офлайн-режим' : 'не проверялся'
  return (
    <div className="ai-models" aria-label="Состояние моделей">
      <span className={`ai-chip ${status.status === 'ready' ? 'ok' : status.status === 'error' ? 'bad' : ''}`}><Icon name={status.status === 'ready' ? 'check' : 'clock'} size={14} />
        {status.status === 'ready' ? `Модели обучены за ${num(m.trainSeconds ?? 0)} с` : status.status === 'training' ? 'Модели обучаются…' : status.status === 'off' ? 'ИИ выключен' : `Ошибка: ${status.error}`}</span>
      {m.failure && <span className="ai-chip" title="Классификатор «выход за порог в ближайший час»: площадь под ROC-кривой на отложенной выборке">Прогноз отказа · AUC {num(m.failure.auc ?? 0, 3)} · {num(m.failure.samples, 0)} траекторий</span>}
      {m.anomaly && <span className="ai-chip" title="Доля ложных срабатываний одного окна 2 мин на нормальной работе">Аномалии · ложных {pct(m.anomaly.falseAlarmPerWindow, 2)} окон</span>}
      {q.length > 0 && <span className="ai-chip" title="Модели брака по контроллерам: AUC на отложенной выборке">Брак · {q.length} моделей · AUC {num(Math.min(...q), 2)}–{num(Math.max(...q), 2)}</span>}
      <span className="ai-chip">Сигналы · {status.signals.series} рядов, {num(status.signals.points, 0)} точек</span>
      <span className={`ai-chip ${status.llm.mode === 'llm' ? 'ok' : ''}`} title={status.llm.error ?? undefined}><Icon name="spark" size={14} />Ассистент: {llm}</span>
    </div>
  )
}

function Summary({ maint, forecast, status }: { maint: Maintenance | null; forecast: Forecast | null; status: AiStatus | null }) {
  const risky = maint?.predictions.filter((p) => p.severity !== 'ok') ?? []
  const next = risky.filter((p) => p.etaMin !== null).sort((a, b) => a.etaMin! - b.etaMin!)[0]
  const cars = risky.reduce((s, p) => s + (p.carsAtRisk ?? 0), 0)
  const [base, withAi] = forecast?.scenarios ?? []
  const waiting = status?.status !== 'ready' ? 'Модели обучаются' : 'Накапливаем 2 мин наблюдений'
  return (
    <div className="analytics-summary ai-summary">
      <div className={risky.some((p) => p.severity === 'bad') ? 'card-bad' : risky.length ? 'card-warn' : 'card-ok'}>
        <span>Узлы, идущие к отказу</span><strong>{maint ? risky.length : '—'}</strong>
        <small>{maint?.predictions.length ? `из ${maint.predictions.length} параметров под наблюдением · под угрозой ~${num(cars, 0)} авто` : waiting}</small>
      </div>
      <div className={next ? (next.etaMin! < 30 ? 'card-bad' : 'card-warn') : 'card-ok'}>
        <span>Ближайший прогноз отказа</span><strong>{next ? <>{num(next.etaMin!, 0)} <span>мин</span></> : '—'}</strong>
        <small>{next ? `${next.equipment}: ${next.failure.toLowerCase()}` : 'Трендов к аварийному порогу нет'}</small>
      </div>
      <div className={maint?.anomalies.length ? 'card-warn' : 'card-ok'}>
        <span>Аномалии параметров</span><strong>{maint ? maint.anomalies.length : '—'}</strong>
        <small>{maint?.anomalies[0] ? `${maint.anomalies[0].equipment}: ${maint.anomalies[0].paramName.toLowerCase()}` : 'Режим всех узлов в норме'}</small>
      </div>
      <div className={base && base.pPlan >= 0.8 ? 'card-ok' : base && base.pPlan >= 0.4 ? 'card-warn' : 'card-bad'}>
        <span>Вероятность выполнить план месяца</span><strong>{base ? pct(base.pPlan) : '—'}</strong>
        <small>{base && withAi ? `P50 ${num(base.p50, 0)} авто при плане ${num(forecast!.plan, 0)} · с ИИ ${num(withAi.p50, 0)}` : 'Считаем прогноз…'}</small>
      </div>
    </div>
  )
}

function Failures({ maint, status, onArea, onDemo }: { maint: Maintenance | null; status: AiStatus | null; onArea: (a: string) => void; onDemo: () => void }) {
  const [all, setAll] = useState(false)
  const list = (maint?.predictions ?? []).filter((p) => all || p.severity !== 'ok')
  return (
    <section>
      <div className="section-heading"><div><h3>Прогноз отказов оборудования</h3><p className="section-meta">Тренд параметра к аварийному порогу ПЛК: время до отказа и вероятность выхода за порог в ближайший час.</p></div>
        <button type="button" className="text-button" onClick={() => setAll((v) => !v)} aria-pressed={all}>{all ? 'Только требующие внимания' : 'Все параметры'}</button></div>
      {status?.status !== 'ready' ? <p className="empty-state">Модели обучаются на синтетических траекториях износа — это несколько секунд.</p>
        : !maint?.predictions.length ? <p className="empty-state">Набираем наблюдения: прогноз появится через 2 минуты работы линии.</p>
          : list.length === 0 ? <p className="empty-state">Ни один узел не идёт к аварийному порогу. Модель следит за {maint.predictions.length} параметрами.</p>
            : <ul className="ai-failures">{list.map((p) => <FailureRow key={`${p.controller}.${p.param}`} p={p} onArea={onArea} />)}</ul>}
      {maint && maint.demos.length > 0 && <Demos maint={maint} onChanged={onDemo} />}
    </section>
  )
}

function FailureRow({ p, onArea }: { p: Prediction; onArea: (a: string) => void }) {
  const [lo, hi] = p.etaRangeMin
  return (
    <li className={`ai-failure sev-${p.severity}`}>
      <div className="ai-failure-head">
        <span className={`status-badge ${p.severity}`}><Icon name={p.severity === 'ok' ? 'check' : 'alert'} size={12} />{SEVERITY[p.severity]}</span>
        <button type="button" className="area-link" onClick={() => onArea(p.area)} title="Показать участок на 3D-модели"><b>{p.equipment}</b> · {p.area}<Icon name="arrow-right" /></button>
        <span className="ai-eta">{p.etaMin !== null ? <>отказ через <b>~{num(p.etaMin, 0)} мин</b>{lo !== null && <small> ({num(lo, 0)}–{hi !== null ? num(hi, 0) : '…'})</small>}</> : <>тренда к порогу нет</>}</span>
      </div>
      <div className="ai-failure-body">
        <div>
          <span className="ai-param">{p.paramName}: <b>{num(p.value, p.decimals + 1)} {p.unit}</b> → порог {num(p.limit, p.decimals)} {p.unit}</span>
          <span className="ai-trend">{p.slopePerMin === 0 ? 'стабильно' : `${p.slopePerMin > 0 ? '+' : '−'}${num(Math.abs(p.slopePerMin), p.decimals + 2)} ${p.unit}/мин`} · окно {num(p.windowMin)} мин</span>
          <div className="ai-meter" role="img" aria-label={`Вероятность отказа в ближайший час ${pct(p.probability)}`}><span style={{ width: `${Math.max(2, p.probability * 100)}%` }} /></div>
          <span className="ai-prob">Вероятность отказа в ближайший час — <b>{pct(p.probability)}</b></span>
        </div>
        <div className="ai-impact">
          <span>{p.failure}</span>
          {p.carsAtRisk !== null && <b>~{num(p.carsAtRisk)} авто</b>}
          <small>{p.onBottleneck ? 'на узком месте — потеря завода' : `ремонт ~${p.repairMin} мин на участке`}</small>
        </div>
      </div>
      {p.severity !== 'ok' && <p className="ai-action"><Icon name="wrench" size={14} />{p.action}</p>}
    </li>
  )
}

function Demos({ maint, onChanged }: { maint: Maintenance; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const run = (id: string, action: 'start' | 'repair') => {
    setBusy(id)
    ai.demo(id, action).then(onChanged, () => null).finally(() => setBusy(null))
  }
  return (
    <details className="ai-demos">
      <summary><Icon name="play" size={14} />Проверить на симуляторе: развивающаяся неисправность</summary>
      <p className="analytics-note">Запустите износ узла и смотрите, как ИИ находит аномалию за 1–2 мин и предсказывает отказ, пока тревога ПЛК ещё не сработала. Ремонт возвращает узел в норму.</p>
      <ul>{maint.demos.map((d) => {
        const on = maint.active.includes(d.id)
        return <li key={d.id} className={on ? 'on' : ''}>
          <div><b>{d.title}</b><small>{d.detail}</small></div>
          <button type="button" className={on ? 'button-secondary' : 'button-primary'} disabled={busy === d.id} onClick={() => run(d.id, on ? 'repair' : 'start')}>
            <Icon name={on ? 'wrench' : 'play'} size={14} />{on ? 'Отремонтировать' : 'Запустить износ'}</button>
        </li>
      })}</ul>
    </details>
  )
}

function Anomalies({ list, ready, onArea }: { list: Anomaly[]; ready: boolean; onArea: (a: string) => void }) {
  return (
    <section>
      <div className="section-heading"><div><h3>Аномалии режима</h3><p className="section-meta">Робастная модель нормальной работы (MCD): отклонение среднего, наклон и разброс за 2 мин в единицах шума датчика.</p></div></div>
      {!ready ? null : list.length === 0 ? <p className="empty-state">Все параметры с уставкой или номиналом ведут себя как при нормальной работе.</p> :
        <ul className="alerts">{list.map((a) => <li key={`${a.controller}.${a.param}`} className="alert alert-warn">
          <b>{a.equipment}: {a.paramName.toLowerCase()} {num(a.value, a.decimals + 1)} {a.unit} при норме {num(a.expected, a.decimals)}</b>
          <span>Сдвиг {a.shiftSigma > 0 ? '+' : ''}{num(a.shiftSigma)}σ, t-наклона {num(a.slopeT)}, разброс ×{num(a.spread, 2)} · оценка {num(a.score, 0)} при пороге {num(a.threshold, 0)}. Тревога ПЛК ещё не сработала — осмотрите узел.</span>
          <button type="button" className="area-link" onClick={() => onArea(a.area)}>Показать участок<Icon name="arrow-right" /></button>
        </li>)}</ul>}
    </section>
  )
}

function QualitySection({ quality, onArea }: { quality: Quality | null; onArea: (a: string) => void }) {
  if (!quality || !quality.areas.length) return <section><h3>Причины брака</h3><p className="empty-state">Модели брака обучаются…</p></section>
  const target = quality.target ?? 2
  return (
    <section>
      <div className="section-heading"><div><h3>Причины брака</h3><p className="section-meta">Градиентный бустинг «режим процесса → брак кузова» по каждому узлу; важность — перестановкой на отложенной выборке.</p></div></div>
      <div className="ai-quality">{quality.areas.map((a) => {
        const top = a.controllers[0]
        const factor = top?.factors.find((f) => f.delta > 0.001)
        return (
          <article key={a.area} className="ai-quality-area">
            <header>
              <button type="button" className="area-link" onClick={() => onArea(a.area)}><b>{a.area}</b><Icon name="arrow-right" /></button>
              <span className={`status-badge ${a.risk * 100 > target ? 'bad' : 'ok'}`}>{a.risk * 100 > target ? 'Выше нормы' : 'В норме'}</span>
            </header>
            <div className="ai-quality-nums">
              <div><span>Риск брака сейчас · {a.worst}</span><strong>{pct(a.risk, 1)}</strong></div>
              <div><span>Тот же узел при режиме нормы</span><strong>{pct(a.baseline, 1)}</strong></div>
              <div><span>Данные кейса</span><strong>{a.caseRate !== null ? `${num(a.caseRate)}%` : '—'}</strong></div>
            </div>
            {factor && <p className="ai-why"><Icon name="info" size={14} />Сейчас больше всего добавляет <b>{factor.name.toLowerCase()}</b> ({top.equipment}): {num(factor.value ?? 0)} {factor.unit} при норме {num(factor.nominal)} — +{pct(factor.delta, 1)} к риску.</p>}
            {a.controllers.filter((c) => c.drivers.length).slice(0, 2).map((c) => <Drivers key={c.controller} c={c} />)}
          </article>
        )
      })}</div>
    </section>
  )
}

function Drivers({ c }: { c: Quality['areas'][number]['controllers'][number] }) {
  const max = Math.max(...c.drivers.map((d) => d.importance), 0.01)
  return (
    <div className="ai-drivers">
      <span className="ai-drivers-title">{c.equipment} · {c.name}<small>AUC {c.metrics.auc !== null ? num(c.metrics.auc, 2) : '—'}{c.observed.processed ? ` · факт ПЛК ${num(c.observed.defective, 0)} из ${num(c.observed.processed, 0)}` : ''}</small></span>
      <ul>{c.drivers.map((d) => {
        const limits = [d.doubleAbove !== null && `выше ${num(d.doubleAbove)}`, d.doubleBelow !== null && `ниже ${num(d.doubleBelow)}`].filter(Boolean).join(' или ')
        return <li key={d.param} title={`Важность ${pct(d.importance)}`}>
          <span className="ai-driver-name">{d.name}</span>
          <span className="ai-bar"><span style={{ width: `${(d.importance / max) * 100}%`, background: BAR }} /></span>
          <span className="ai-driver-value">{pct(d.importance)}</span>
          <small>{limits ? `брак вдвое выше при ${limits} ${d.unit}` : 'порог удвоения в диапазоне режимов не найден'}</small>
        </li>
      })}</ul>
    </div>
  )
}

function ForecastSection({ forecast }: { forecast: Forecast | null }) {
  if (!forecast) return <section><h3>Вероятность выполнить план</h3><p className="empty-state">Считаем прогноз…</p></section>
  const [base, withAi] = forecast.scenarios
  return (
    <section>
      <div className="section-heading"><div><h3>Вероятность выполнить план</h3><p className="section-meta">Монте-Карло: {num(forecast.runs, 0)} проигрышей месяца по {forecast.shifts} сменам с разбросом темпа, простоями и браком из данных.</p></div></div>
      <div className="ai-forecast-nums">
        {forecast.scenarios.map((s) => <div key={s.id}>
          <span><i style={{ background: SCENARIO_COLOR[s.id] }} />{s.title}</span>
          <strong>{num(s.p50, 0)} <small>авто · P50</small></strong>
          <small>P10–P90: {num(s.p10, 0)}–{num(s.p90, 0)} · план {pct(s.pPlan)} · цель {pct(s.pTarget)}</small>
        </div>)}
        <div><span>Детерминированный прогноз</span><strong>{num(forecast.deterministic, 0)} <small>авто</small></strong><small>при среднем темпе; разброс смен снижает выпуск на ~{num(forecast.deterministic - base.p50, 0)} авто</small></div>
      </div>
      {forecast.scenarios.map((s) => <Histogram key={s.id} s={s} bins={forecast.bins} plan={forecast.plan} target={forecast.target} />)}
      <div className="ai-bottleneck">
        <span>Как часто участок становится узким местом смены</span>
        {[base, withAi].map((s) => <div key={s.id} className="ai-bn-row"><small>{s.title}</small>
          <div className="ai-stack" role="img" aria-label={Object.entries(s.bottleneck).map(([a, v]) => `${a} ${pct(v)}`).join(', ')}>
            {Object.entries(s.bottleneck).filter(([, v]) => v > 0).map(([a, v]) => <span key={a} style={{ flex: v, background: AREA_COLOR[a] ?? '#c9ced5' }} title={`${a}: ${pct(v)} смен`} />)}
          </div>
          <span className="ai-stack-values">{Object.entries(s.bottleneck).map(([a, v]) => <span key={a}><i style={{ background: AREA_COLOR[a] ?? '#c9ced5' }} />{a} {pct(v)}</span>)}</span>
        </div>)}
      </div>
      <p className="analytics-note">Предиктивное обслуживание добавляет ~{num(withAi.p50 - base.p50, 0)} авто в месяц: {pct(forecast.predictableShare)} внеплановых простоев в данных видны по датчикам заранее ({forecast.predictable.join(', ').toLowerCase() || 'нет'}).</p>
      <details className="analytics-method"><summary>Допущения прогноза</summary><ul>{forecast.assumptions.map((t) => <li key={t}>{t}</li>)}</ul></details>
    </section>
  )
}

function Histogram({ s, bins, plan, target }: { s: Forecast['scenarios'][number]; bins: number[]; plan: number; target: number }) {
  const [tip, setTip] = useState<number | null>(null)
  const W = 640, H = 100, top = 4, bottom = 1
  const max = Math.max(...s.hist, 0.01)
  const lo = bins[0], hi = bins[bins.length - 1]
  const x = (v: number) => ((v - lo) / (hi - lo)) * W
  const bw = W / s.hist.length
  const inside = (v: number) => v >= lo && v <= hi
  const marks = [{ v: s.p50, label: `P50 ${num(s.p50, 0)}` }, { v: plan, label: `План ${num(plan, 0)}` }].filter((m) => inside(m.v))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo))
  const outside = [plan > hi && `план ${num(plan, 0)}`, target > hi && `цель ${num(target, 0)}`].filter(Boolean)
  return (
    <figure className="ai-hist">
      <figcaption><i style={{ background: SCENARIO_COLOR[s.id] }} />{s.title}{outside.length > 0 && <small> · {outside.join(' и ')} — правее всех исходов</small>}</figcaption>
      <div className="ai-hist-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Распределение выпуска месяца: P10 ${s.p10}, P50 ${s.p50}, P90 ${s.p90}`} onMouseLeave={() => setTip(null)}>
          <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} className="ai-axis" />
          {s.hist.map((v, i) => {
            const h = (v / max) * (H - top - bottom)
            const y = H - bottom - h
            const w = bw - 2
            const r = Math.min(4, w / 2, h)
            return <g key={i} onMouseEnter={() => setTip(i)}>
              <rect x={i * bw} y={top} width={bw} height={H - top - bottom} fill="transparent" />
              {h > 0 && <path d={`M${i * bw + 1},${H - bottom} V${y + r} Q${i * bw + 1},${y} ${i * bw + 1 + r},${y} H${i * bw + 1 + w - r} Q${i * bw + 1 + w},${y} ${i * bw + 1 + w},${y + r} V${H - bottom} Z`} fill={SCENARIO_COLOR[s.id]} opacity={tip === null || tip === i ? 1 : 0.55} />}
            </g>
          })}
          {marks.map((m) => <line key={m.label} x1={x(m.v)} x2={x(m.v)} y1={0} y2={H - bottom} className="ai-hist-marker" />)}
        </svg>
        {/* подписи — HTML поверх графика: SVG растягивается по ширине, текст в нём исказился бы */}
        {marks.map((m) => <span key={m.label} className="ai-hist-label" style={{ left: `${(x(m.v) / W) * 100}%` }}>{m.label}</span>)}
        <div className="ai-hist-ticks" aria-hidden="true">{ticks.map((t, i) => <span key={i} style={{ left: `${(x(t) / W) * 100}%` }}>{num(t, 0)}</span>)}</div>
        {tip !== null && <div className="chart-tip" style={{ left: `${((tip + 0.5) / s.hist.length) * 100}%`, top: '10%' }} role="status">
          <strong>{num(bins[tip], 0)}–{num(bins[tip + 1], 0)} авто</strong><span>{pct(s.hist[tip], 1)} проигрышей месяца</span></div>}
      </div>
    </figure>
  )
}

const SUGGESTIONS = ['Что сейчас главный риск для выпуска?', 'Какой узел обслужить в ближайший перерыв?', 'Почему брак окраски выше нормы?', 'Выполним ли план месяца и что для этого сделать?']

function Assistant({ status }: { status: AiStatus | null }) {
  const [messages, setMessages] = useState<(ChatMessage & { meta?: ChatReply })[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'chat' | 'report' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chat = useRef<HTMLDivElement>(null)
  // прокручивается только лента чата, а не вся страница раздела
  useEffect(() => { const el = chat.current; if (el) el.scrollTop = el.scrollHeight }, [messages, busy])

  const send = (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const history = [...messages, { role: 'user' as const, content: q }]
    setMessages(history); setInput(''); setBusy('chat'); setError(null)
    ai.chat(history.map(({ role, content }) => ({ role, content }))).then(
      (r) => setMessages((m) => [...m, { role: 'assistant', content: r.reply, meta: r }]),
      () => setError('Не удалось получить ответ. Проверьте соединение с сервером.'),
    ).finally(() => setBusy(null))
  }
  const report = () => {
    if (busy) return
    setBusy('report'); setError(null)
    setMessages((m) => [...m, { role: 'user', content: 'Сменный отчёт' }])
    ai.report().then(
      (r) => setMessages((m) => [...m, { role: 'assistant', content: r.reply, meta: r }]),
      () => setError('Не удалось составить отчёт.'),
    ).finally(() => setBusy(null))
  }
  const mode = status?.llm.mode
  return (
    <aside className="ai-assistant" aria-label="ИИ-ассистент">
      <header>
        <span className="ai-assistant-icon"><Icon name="spark" /></span>
        <div><strong>ИИ-ассистент</strong><small>{mode === 'llm' ? `OpenAI ${status?.llm.model} · читает данные двойника` : mode === 'offline' ? 'Офлайн: выводы по правилам' : 'Отвечает по живым данным двойника'}</small></div>
        <button type="button" className="button-secondary" onClick={report} disabled={!!busy}><Icon name="doc" size={14} />Сменный отчёт</button>
      </header>
      <div className="ai-chat" aria-live="polite" ref={chat}>
        {messages.length === 0 && <div className="ai-chat-empty">
          <p>Спросите о производстве — ассистент сам возьмёт показатели, тревоги, прогнозы отказов и сценарии.</p>
          <div className="ai-suggest">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={!!busy}>{s}</button>)}</div>
        </div>}
        {messages.map((m, i) => <div key={i} className={`ai-msg ${m.role}`}>
          {m.role === 'assistant' ? <Rich text={m.content} /> : <p>{m.content}</p>}
          {m.meta && <small className="ai-msg-meta">{m.meta.mode === 'llm' ? `${m.meta.model} · ${num(m.meta.seconds)} с${m.meta.tools.length ? ` · данные: ${[...new Set(m.meta.tools)].length} источника` : ''}` : `офлайн · ${m.meta.reason ?? ''}`}</small>}
        </div>)}
        {busy && <div className="ai-msg assistant pending"><span className="ai-dots"><i /><i /><i /></span>{busy === 'report' ? 'Собираю данные для отчёта…' : 'Анализирую данные завода…'}</div>}
        {error && <p className="ai-chat-error"><Icon name="alert" size={14} />{error}</p>}
      </div>
      <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(input) }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Например: что будет с выпуском, если остановится конвейер?" rows={2} maxLength={2000}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }} aria-label="Вопрос ассистенту" />
        <button type="submit" className="button-primary" disabled={!input.trim() || !!busy} aria-label="Отправить"><Icon name="send" size={16} /></button>
      </form>
      <p className="ai-assistant-note">Ассистент только читает данные. Команды оборудованию подаёт оператор на пульте HMI.</p>
    </aside>
  )
}

/** Минимальная разметка ответа: абзацы, списки «- » и **жирный**. HTML из ответа не исполняется. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = [] } }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^[-•*]\s+/.test(line)) { list.push(line.replace(/^[-•*]\s+/, '')); continue }
    flush()
    if (!line) continue
    const heading = /^#{1,4}\s+/.test(line)
    blocks.push(<p key={blocks.length} className={heading ? 'ai-msg-heading' : undefined}>{inline(line.replace(/^#{1,4}\s+/, ''))}</p>)
  }
  flush()
  return <>{blocks}</>
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)
}
