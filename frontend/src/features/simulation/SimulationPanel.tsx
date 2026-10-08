import { useEffect, useRef, useState } from 'react'
import type { useSimulation } from './useSimulation'
import { formatTime, STATE_LABELS, type CompareParameters, type SimulationConfig, type Stage } from './types'

type Simulation = ReturnType<typeof useSimulation>
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })

export function SimulationPanel({ simulation, onAsset, onHide }: { simulation: Simulation; onAsset: (stage: Stage) => void; onHide: () => void }) {
  const { snapshot: s, comparison, comparing, busy, error } = simulation
  const [tab, setTab] = useState<'flow' | 'compare'>('flow')
  const [alternative, setAlternative] = useState('20')
  const [days, setDays] = useState('21')
  const [margin, setMargin] = useState('150000')
  const [cost, setCost] = useState('30000')
  const values = [alternative, days, margin, cost].map(Number)
  const valid = [alternative, days, margin, cost].every((v) => v.trim() !== '') && values.every(Number.isFinite)
    && values[0] >= 0 && values[0] <= 180 && Number.isInteger(values[1]) && values[1] >= 1 && values[1] <= 31
    && values[2] >= 0 && values[2] <= 10_000_000 && values[3] >= 0 && values[3] <= 100_000_000
  const parameters: CompareParameters | null = s ? { ...s.config, alternativeRepair: values[0], workingDays: values[1], contributionMargin: values[2], interventionCost: values[3] } : null
  const fresh = comparison && parameters && Object.entries(parameters).every(([key, value]) => comparison.parameters[key as keyof CompareParameters] === value)
  const result = fresh ? comparison : null
  const resultRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tab !== 'compare' || !result || !resultRef.current || !contentRef.current) return
    const container = contentRef.current
    container.scrollTop += resultRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top - 16
  }, [result, tab])
  return (
    <aside className="simulation-panel" aria-labelledby="simulation-title">
      <div className="simulation-heading">
        <div><span className="eyebrow">Лаборатория производства</span><h2 id="simulation-title">Сценарии завода</h2></div>
        <button className="icon-button" onClick={onHide} aria-label="Свернуть сценарии">−</button>
      </div>
      <div className="simulation-tabs" role="tablist" aria-label="Сценарии">
        <button id="flow-tab" role="tab" aria-selected={tab === 'flow'} aria-controls="simulation-content" onClick={() => setTab('flow')}>Производственный поток</button>
        <button id="compare-tab" role="tab" aria-selected={tab === 'compare'} aria-controls="simulation-content" onClick={() => setTab('compare')}>Что если?</button>
      </div>
      <div ref={contentRef} className="simulation-content" id="simulation-content" role="tabpanel" aria-labelledby={tab === 'flow' ? 'flow-tab' : 'compare-tab'}>
        <p className="simulation-disclosure">Симуляция · заданные параметры. Оборудование привязано условно; подключения к MES нет.</p>
        {error && <div role="alert" className="simulation-error">{error}<button onClick={() => void simulation.create(s?.config)} disabled={busy}>Новая сессия</button></div>}
        {!s ? <p role="status">{busy ? 'Подготовка производственной модели…' : 'Сессия ещё не создана.'}</p> : tab === 'flow' ? <>
          <div className={`incident-card${s.faultUntil !== null ? ' is-fault' : ''}`} aria-live="polite">
            <span className="eyebrow">{s.faultUntil !== null ? 'Инцидент · Конвейер-03' : s.completed ? 'Смена завершена' : 'Сценарий смены'}</span>
            <h3>{s.faultUntil !== null ? 'Сборка остановлена' : s.completed ? 'Смена завершена' : s.config.repairMinutes === 0 ? 'Контрольная смена без отказа' : s.time < 30 ? 'Проверим последствия отказа' : 'Поток восстанавливается'}</h3>
            <p>{s.faultUntil !== null ? `Ремонт: ещё ${number(Math.max(0, s.faultUntil - s.time))} мин. Буфер PBS перед сборкой ${s.stages[2].queue} / ${s.config.bufferCapacity}.`
              : s.time < 30 ? `На 30-й минуте — обрыв цепи. Базовый ремонт ${s.config.repairMinutes} мин.` : `Принято ОТК ${s.good} авто. В производстве ${s.wip}; в карантине ${s.rejected}.`}</p>
            <button className="sim-primary" disabled={busy} onClick={() => {
              if (s.completed) void simulation.control('reset')
              else if (s.config.repairMinutes !== 0 && s.time < 30) { onAsset(s.stages[2]); void simulation.control('fault') }
              else if (s.faultUntil !== null) void simulation.control('advance', { minutes: Math.max(0.001, s.faultUntil - s.time) })
              else void simulation.control('advance', { minutes: 480 })
            }}>{s.completed ? 'Начать заново' : s.config.repairMinutes !== 0 && s.time < 30 ? 'Показать отказ' : s.faultUntil !== null ? 'К концу ремонта' : 'Итог смены'}</button>
          </div>
          <h3 className="sim-section-title">Оборудование и очереди</h3>
          <div className="equipment-list">
            {s.stages.map((stage) => <button className={`equipment-row state-${stage.state.toLowerCase()}`} key={stage.id} onClick={() => onAsset(stage)} aria-label={`Показать ${stage.id}`}>
              <span className="equipment-top"><strong>{stage.label}</strong><span className="equipment-state">{STATE_LABELS[stage.state]}</span></span>
              <span className="equipment-meta">{stage.id} · такт {number(stage.cycleMinutes)} мин</span>
              {stage.stage !== 'welding' && <><span className="equipment-buffer"><span>{stage.stage === 'assembly' ? 'Буфер PBS' : 'Входной буфер'}</span><b>{stage.queue} / {stage.capacity}</b></span><span className="queue-track"><span style={{ width: `${stage.queue / stage.capacity * 100}%` }} /></span></>}
            </button>)}
          </div>
          <div className="flow-conservation"><span>Баланс кузовов</span><b>{s.started} = {s.good} + {s.rejected} + {s.wip}</b><small>Начато = годные + карантин + в производстве</small></div>
          {s.events.length > 0 && <section className="sim-event-list"><h3>События смены</h3>{s.events.slice(0, 4).map((event, i) => <div key={`${event.id}-${i}`}><time>{formatTime(event.time)}</time><span>{event.message}</span></div>)}</section>}
          <ModelSettings key={s.sessionId} config={s.config} busy={busy} onApply={simulation.create} />
          <details className="sim-assumptions"><summary>Как устроена модель</summary><ul>{s.assumptions.map((text) => <li key={text}>{text}</li>)}</ul></details>
        </> : <>
          <div className="compare-intro"><span className="eyebrow">Одинаковые начальные условия</span><h3>Быстрее ремонт — больше выпуск?</h3><p>Сравним две полные смены и отдельные месячные прогоны. Базовый ремонт: <b>{number(s.config.repairMinutes)} мин</b>.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); if (valid && parameters && !comparing) void simulation.compare(parameters) }}>
            <div className="sim-form-grid">
              <NumberField label="Новый ремонт, мин" value={alternative} onChange={setAlternative} min={0} max={180} />
              <NumberField label="Рабочие дни месяца" value={days} onChange={setDays} min={1} max={31} />
              <NumberField label="Марж. доход, ₸/авто" value={margin} onChange={setMargin} min={0} max={10_000_000} />
              <NumberField label="Вмешательство, ₸/смену" value={cost} onChange={setCost} min={0} max={100_000_000} />
            </div>
            <p className="sim-field-hint">Экономические значения — ваши допущения. Две смены по 480 рабочих минут в день.</p>
            {!valid && <p className="bad" role="status">Заполните допустимые значения. Дни месяца — целое число от 1 до 31.</p>}
            <button className="sim-primary compare-submit" type="submit" disabled={!valid || comparing || busy}>{comparing ? 'Сравниваем сценарии…' : 'Сравнить сценарии'}</button>
          </form>
          {comparison && !fresh && <p className="simulation-disclosure">Параметры изменены. Пересчитайте результат.</p>}
          {result && <div ref={resultRef} className="comparison-result" aria-live="polite">
            <h3>Результат за смену</h3>
            <div className="comparison-columns"><div><span>База · {number(result.parameters.repairMinutes)} мин</span><strong data-testid="baseline-good">{result.baseline.good}</strong><small>годных авто</small></div><div><span>Вариант · {number(result.parameters.alternativeRepair)} мин</span><strong data-testid="alternative-good">{result.alternative.good}</strong><small>годных авто</small></div></div>
            <div className="scenario-delta"><b data-testid="delta-good">{result.deltaGood > 0 ? '+' : ''}{result.deltaGood} авто</b><span>{number(result.savedMinutes)} мин разницы простоя</span></div>
            <section className="month-forecast"><h3>Месяц · цель {number(result.month.target)}</h3>{[['База', result.month.baseline, result.month.probTarget[0]], ['Вариант', result.month.alternative, result.month.probTarget[1]]].map(([label, value, prob]) => <div key={label}><span>{label}</span><b>{number(Number(value))}</b><span className="month-track"><span style={{ width: `${Math.min(100, Number(value) / result.month.target * 100)}%` }} /></span><small>{Number(value) >= result.month.target ? `выше цели на ${number(Number(value) - result.month.target)}` : `до цели ${number(result.month.target - Number(value))}`} · цель в {Math.round(Number(prob) * 100)}% прогонов</small></div>)}<p>{result.month.days} рабочих дней · медиана {result.month.runs} прогонов единой модели прогноза, калиброванной по данным завода (та же, что в центре решений)</p></section>
            <section className="loss-explanation"><h3>Почему изменился выпуск</h3><p className="sim-field-hint">Разбор полной базовой смены, независимо от текущего времени сцены.</p>{result.causes.map((cause, i) => <button key={i} onClick={() => { const asset = s.stages.find((x) => x.id === cause.assetId); if (asset) onAsset(asset) }}>{cause.text}<span aria-hidden="true">↗</span></button>)}
              <p className="sim-field-hint">{result.bottleneck.method} Лучший результат: {result.bottleneck.label}, +{result.bottleneck.extraGood} годных авто.</p>
            </section>
            <section className="director-brief"><span className="eyebrow">Решение руководителя · сценарная оценка</span><h3>{result.deltaGood > 0 ? 'Ремонт возвращает доступный выпуск' : 'Проверьте целесообразность вмешательства'}</h3><strong data-testid="effect-kzt">{number(result.effectKzt)} ₸</strong><p>{result.deltaGood} авто × {number(result.parameters.contributionMargin)} ₸ − {number(result.parameters.interventionCost)} ₸ за одну смену.</p><small>Не выручка и не подтверждённая экономия завода. Энергия и другие дополнительные затраты не учтены.</small></section>
            <details className="sim-assumptions"><summary>Параметры и ограничения прогноза</summary><ul>{result.assumptions.map((text) => <li key={text}>{text}</li>)}</ul></details>
          </div>}
        </>}
      </div>
    </aside>
  )
}

function NumberField({ label, value, onChange, min, max, step = 1 }: { label: string; value: string; onChange: (v: string) => void; min: number; max: number; step?: number }) {
  return <label className="sim-field"><span>{label}</span><input type="number" value={value} min={min} max={max} step={step} required onChange={(e) => onChange(e.target.value)} /></label>
}

function ModelSettings({ config, busy, onApply }: { config: SimulationConfig; busy: boolean; onApply: (config: SimulationConfig) => Promise<void> }) {
  const [cycle, setCycle] = useState(String(config.assemblyCycle))
  const [capacity, setCapacity] = useState(String(config.bufferCapacity))
  const [repair, setRepair] = useState(String(config.repairMinutes))
  const [defect, setDefect] = useState(String(config.defectPercent))
  const n = [cycle, capacity, repair, defect].map(Number)
  const valid = [cycle, capacity, repair, defect].every((x) => x.trim() !== '') && n.every(Number.isFinite)
    && n[0] >= 2 && n[0] <= 12 && Number.isInteger(n[1]) && n[1] >= 1 && n[1] <= 12 && n[2] >= 0 && n[2] <= 180 && n[3] >= 0 && n[3] <= 20
  return <details className="sim-assumptions model-settings"><summary>Параметры новой смены</summary><form onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void onApply({ ...config, assemblyCycle: n[0], bufferCapacity: n[1], repairMinutes: n[2], defectPercent: n[3] }) }}>
    <div className="sim-form-grid"><NumberField label="Такт сборки, мин" value={cycle} onChange={setCycle} min={2} max={12} step={0.1} /><NumberField label="Ёмкость буферов, авто" value={capacity} onChange={setCapacity} min={1} max={12} /><NumberField label="Базовый ремонт, мин" value={repair} onChange={setRepair} min={0} max={180} /><NumberField label="Брак на ОТК, %" value={defect} onChange={setDefect} min={0} max={20} step={0.1} /></div>
    <p className="sim-field-hint">Применение начинает новую смену. Данные кейса сохраняются в аналитике.</p><button className="sim-secondary" disabled={busy || !valid}>Применить и начать заново</button>
  </form></details>
}

export function SimulationTransport({ simulation, panel, onPanel, roof, onRoof, onOverview }: { simulation: Simulation; panel: boolean; onPanel: () => void; roof: boolean; onRoof: () => void; onOverview: () => void }) {
  const s = simulation.snapshot
  return <div className="tourbar simulation-transport"><div className="controls" role="group" aria-label="Управление симуляцией">
    <span className="sim-clock" data-testid="simulation-time">{s ? formatTime(s.time) : '00:00'}<small>/ 08:00</small></span>
    <button className="primary" disabled={!s || simulation.busy || s.completed} onClick={() => void simulation.control(s?.running ? 'pause' : 'resume')}>{s?.running ? 'Пауза смены' : s?.completed ? 'Смена завершена' : 'Запустить смену'}</button>
    <button disabled={!s || simulation.busy || s.completed} onClick={() => void simulation.control('advance', { minutes: 15 })}>+15 мин</button>
    <label className="speed-control">Скорость<select aria-label="Скорость симуляции" value={s?.speed ?? 120} disabled={!s || simulation.busy} onChange={(e) => void simulation.control('speed', { speed: Number(e.target.value) })}><option value={60}>×60</option><option value={120}>×120</option><option value={300}>×300</option></select></label>
    <button disabled={!s || simulation.busy} onClick={() => void simulation.control('reset')}>Сбросить смену</button>
    <span className="sep" /><button onClick={onOverview}>Общий вид</button><button aria-pressed={!roof} onClick={onRoof}>{roof ? 'Заглянуть внутрь' : 'Показать кровлю'}</button>
    <button aria-expanded={panel} onClick={onPanel}>{panel ? 'Свернуть панель' : 'Открыть панель'}</button>
  </div></div>
}
