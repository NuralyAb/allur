import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../shared/ui/Icon'
import { Faceplate, type Actions } from './Faceplate'
import { IoTable, MasterStation } from './MasterStation'
import { Gauge, Prio, StateChip, Value, paramAlarm } from '../features/scada/parts'
import { api, can, clock, dateTime, fmt, getToken, useScadaState, type Alarm, type AuditRow, type Command, type ControllerDef, type DowntimeEvent, type ScadaConfig, type ScadaState, type User } from '../features/scada/scada'
import { ai, usePoll, type Maintenance, type Prediction } from '../features/ai/api'

type Toast = { id: number; text: string; tone: 'ok' | 'bad' | 'info' }
type Tab = 'alarms' | 'commands' | 'io' | 'audit' | 'events' | 'links'
type View = 'line' | 'station'
const AREAS = ['Сварка', 'Окраска', 'Сборка', 'ОТК']

function initialSelection() {
  return new URLSearchParams(location.search).get('c')
}
function initialView(): View {
  return new URLSearchParams(location.search).get('view') === 'station' ? 'station' : 'line'
}

export default function HmiApp() {
  const [config, setConfig] = useState<ScadaConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => { setError(null); api.config().then(setConfig, (e: Error) => setError(e.message)) }, [])
  useEffect(load, [load])
  if (error) return <div className="hmi-splash"><span className="hmi-logo">allur<span>HMI</span></span><p>SCADA недоступна: {error}</p><button className="mini primary" onClick={load}>Повторить</button></div>
  if (!config) return <div className="hmi-splash" role="status"><span className="hmi-logo">allur<span>HMI</span></span><p>Подключение к контроллерам…</p></div>
  return <Hmi config={config} />
}

function Hmi({ config }: { config: ScadaConfig }) {
  const { state, link, serverNow } = useScadaState()
  // предупреждения ИИ — не тревоги ISA-18.2: квитирования не требуют и в счётчики тревог не входят
  const aiData = usePoll(ai.maintenance, 5000).data
  const [user, setUser] = useState<User | null>(null)
  const [area, setArea] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(initialSelection)
  const [armed, setArmed] = useState<Command | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [shelving, setShelving] = useState<Alarm | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [view, setView] = useState<View>(initialView)
  const [tab, setTab] = useState<Tab>(() => (initialView() === 'station' ? 'io' : 'alarms'))
  const toastId = useRef(0)

  useEffect(() => { if (getToken()) api.me().then((u) => setUser(u.guest ? null : u), () => setUser(null)) }, [])
  useEffect(() => {
    const url = new URL(location.href)
    if (selected) url.searchParams.set('c', selected); else url.searchParams.delete('c')
    if (view === 'station') url.searchParams.set('view', 'station'); else url.searchParams.delete('view')
    history.replaceState(null, '', url)
  }, [selected, view])

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 7000 : 4000)
  }, [])
  const guard = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) toast(done, 'ok')
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 401) { setUser(null); setLoginOpen(true) }
      toast(err.message, 'bad')
    }
  }, [toast])

  const defs = useMemo(() => new Map(config.controllers.map((c) => [c.id, c])), [config])
  const actions: Actions = useMemo(() => ({
    send: (cid, kind, name, value) => void guard(async () => {
      const cmd = await api.command(cid, kind, name, value)
      if (cmd.status === 'armed') setArmed(cmd)
      else toast(`${defs.get(cid)?.equipment}: ${cmd.label} — отправлена`, 'ok')
    }),
    ack: (id, controller) => void guard(() => api.ack(id, controller)),
    shelve: (alarm) => setShelving(alarm),
    login: () => setLoginOpen(true),
    field: (cid, action, code) => void guard(() => api.field(cid, action, code), 'Событие на линии смоделировано'),
    explain: (text) => toast(text, 'info'),
    line: (line, name) => void guard(async () => {
      const cmd = await api.lineCommand(line, name)
      if (cmd.status === 'armed') setArmed(cmd)
      else toast(`${cmd.label} — выполняется`, 'ok')
    }),
  }), [guard, toast, defs])

  const alarms = state?.alarms ?? []
  const visibleAlarms = alarms.filter((a) => !a.shelvedUntil)
  const unacked = visibleAlarms.filter((a) => !a.acked)
  const byPrio = [1, 2, 3].map((p) => visibleAlarms.filter((a) => a.priority === p).length)
  const shown = config.controllers.filter((c) => area === 'all' || c.area === area)
  const selectedDef = selected ? defs.get(selected) : undefined
  const writeOff = state ? !state.writeEnabled : !config.writeEnabled
  const connOk = state?.connections.every((c) => c.ok)

  return (
    <div className={`hmi${selectedDef ? ' with-faceplate' : ''}`}>
      <header className="hmi-top">
        <a className="hmi-logo" href="/" title="Вернуться в цифровой двойник">allur<span>HMI</span></a>
        <div className="hmi-title"><strong>Пульт управления линиями</strong><span>SCADA · PackML · OPC UA</span></div>
        <div className="hmi-status">
          <span className={`pill ${connOk && link !== 'offline' ? '' : 'pill-bad'}`} title={state?.connections.map((c) => c.text).join('\n')}>
            <i className={connOk && link !== 'offline' ? 'dot-ok' : 'dot-bad'} />{link === 'offline' ? 'Нет связи с сервером' : connOk ? `ПЛК на связи · ${config.mode === 'plant' ? 'завод' : 'симулятор'}` : 'Потеря связи с ПЛК'}
            {link === 'http' && <small> · резервный канал</small>}
          </span>
          {writeOff && <span className="pill pill-warn" title="Команды не отправляются в ПЛК">Только чтение</span>}
          {state && <span className="hmi-clock">{clock(state.ts)}</span>}
          {user ? (
            <span className="hmi-user"><Icon name="check" size={14} /><span><b>{user.name}</b>{user.roleName}</span>
              <button className="mini" onClick={() => void guard(async () => { await api.logout(); setUser(null) }, 'Вы вышли')}>Выйти</button></span>
          ) : <button className="mini primary" onClick={() => setLoginOpen(true)}>Войти</button>}
        </div>
      </header>

      <section className={`alarm-banner${unacked.length ? ' has-unacked' : ''}`} aria-label="Тревоги" aria-live="polite">
        <div className="alarm-counts">
          {byPrio.map((n, i) => <span key={i} className={n ? '' : 'zero'}><Prio alarm={{ priority: (i + 1) as 1 | 2 | 3, acked: true, active: true }} compact />{n}</span>)}
        </div>
        <ol className="alarm-latest">
          {visibleAlarms.slice(0, 3).map((a) => (
            <li key={a.id} className={a.acked ? '' : 'unacked'}>
              <button onClick={() => setSelected(a.controller)}><Prio alarm={a} /><span className="al-time">{clock(a.since)}</span><b>{defs.get(a.controller)?.equipment}</b><span>{a.message}</span></button>
            </li>
          ))}
          {visibleAlarms.length === 0 && <li className="quiet">Активных тревог нет</li>}
        </ol>
        <div className="alarm-actions">
          {unacked.length > 0 && <button className="mini" onClick={() => (can(user, 'operator') ? actions.ack() : setLoginOpen(true))}>Квитировать все ({unacked.length})</button>}
          <button className="mini" onClick={() => { setTab('alarms'); document.getElementById('journal')?.scrollIntoView({ behavior: 'smooth' }) }}>Журнал</button>
        </div>
      </section>

      <nav className="hmi-areas" aria-label="Участки">
        {view === 'line' && ['all', ...AREAS].map((a) => {
          const ids = config.controllers.filter((c) => a === 'all' || c.area === a).map((c) => c.id)
          const worst = Math.min(4, ...visibleAlarms.filter((x) => ids.includes(x.controller)).map((x) => x.priority))
          return (
            <button key={a} aria-pressed={area === a} onClick={() => setArea(a)}>
              {a === 'all' ? 'Все участки' : a}<span className="count">{ids.length}</span>
              {worst < 4 && <Prio alarm={{ priority: worst as 1 | 2 | 3, acked: true, active: true }} compact />}
            </button>
          )
        })}
        <div className="hmi-views" role="group" aria-label="Экран">
          <button aria-pressed={view === 'line'} onClick={() => { setView('line'); setTab('alarms') }}>Линия</button>
          <button aria-pressed={view === 'station'} onClick={() => { setView('station'); setTab('io') }}>Диспетчерская{state && state.server.online < state.server.controllers && <Prio alarm={{ priority: 1, acked: true, active: true }} compact />}</button>
        </div>
      </nav>

      <main className="hmi-main">
        {view === 'station' ? (
          <MasterStation config={config} state={state} alarms={visibleAlarms} user={user} selected={selected} onSelect={setSelected}
            onLine={(line, name) => (can(user, 'operator') ? actions.line(line, name) : setLoginOpen(true))} />
        ) : (
          <>
            <AiAdvisory data={aiData} area={area} onSelect={setSelected} />
            {config.lines.map((line) => <LineFlow key={line.id} line={line} defs={defs} state={state} onSelect={setSelected} selected={selected} />)}
            <div className="tiles">
              {shown.map((c) => <Tile key={c.id} def={c} state={state} alarms={visibleAlarms} forecast={aiData?.predictions.find((p) => p.controller === c.id && p.severity !== 'ok')} selected={selected === c.id} onSelect={() => setSelected(c.id)} />)}
            </div>
          </>
        )}
        <Journal tab={tab} onTab={setTab} state={state} defs={defs} config={config} user={user} actions={actions} onSelect={setSelected} area={view === 'station' ? 'all' : area} />
      </main>

      {selectedDef && state && (
        <aside className="hmi-side">
          <Faceplate key={selectedDef.id} def={selectedDef} st={state.controllers[selectedDef.id]} config={config} user={user}
            alarms={alarms} commands={state.commands} now={state.ts} actions={actions} onClose={() => setSelected(null)} />
        </aside>
      )}

      {loginOpen && <LoginDialog demo={config.simulator} onClose={() => setLoginOpen(false)} onLogin={(u) => { setUser(u); setLoginOpen(false); toast(`Вход: ${u.name} (${u.roleName})`, 'ok') }} />}
      {armed && <ConfirmDialog cmd={armed} def={defs.get(armed.controller)} line={config.lines.find((l) => l.id === armed.controller)} state={state} serverNow={serverNow} onClose={() => setArmed(null)} onDone={(text) => { setArmed(null); toast(text, 'ok') }} />}
      {shelving && <ShelveDialog alarm={shelving} onClose={() => setShelving(null)} onDone={() => { setShelving(null); toast('Тревога отложена — запись в журнале', 'ok') }} onError={(t) => toast(t, 'bad')} />}
      <div className="toasts" aria-live="assertive">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}</div>
    </div>
  )
}

function LineFlow({ line, defs, state, selected, onSelect }: { line: ScadaConfig['lines'][number]; defs: Map<string, ControllerDef>; state: ScadaState | null; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="lineflow" aria-label={line.name}>
      <h2>{line.name}</h2>
      <ol>
        {line.controllers.map((cid, i) => {
          const buf = state?.buffers.find((b) => b.up === cid)
          const st = state?.controllers[cid]
          const alarm = state?.alarms.filter((a) => a.controller === cid && !a.shelvedUntil).sort((a, b) => a.priority - b.priority)[0]
          return (
            <li key={cid}>
              <button className={`lf-node${selected === cid ? ' selected' : ''}`} onClick={() => onSelect(cid)}>
                <span className="lf-name">{defs.get(cid)?.equipment}{alarm && <Prio alarm={alarm} compact />}</span>
                <StateChip st={st} />
              </button>
              {i < line.controllers.length - 1 && (
                <span className="lf-buffer" title={buf ? `Буфер: ${fmt(buf.fill, 0)} из ${buf.size} с работы` : `Буфер ${line.bufferSeconds[i]} с`}>
                  <span className="lf-arrow" aria-hidden="true" />
                  {buf && <span className="lf-fill" aria-label={`Заполнение буфера ${Math.round((buf.fill / buf.size) * 100)}%`}><span style={{ width: `${(buf.fill / buf.size) * 100}%` }} /></span>}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Предупреждения ИИ для оператора: какой узел идёт к аварии и что сделать до срабатывания защиты ПЛК. */
function AiAdvisory({ data, area, onSelect }: { data: Maintenance | null; area: string; onSelect: (id: string) => void }) {
  if (!data) return null
  const inArea = (a: string) => area === 'all' || a === area
  const preds = data.predictions.filter((p) => p.severity !== 'ok' && inArea(p.area))
  const anomalies = data.anomalies.filter((a) => inArea(a.area))
  if (!preds.length && !anomalies.length) return null
  return (
    <section className="ai-advisory" aria-label="Предупреждения ИИ">
      <h2><Icon name="spark" size={15} />Прогноз ИИ <small>предупреждения, не тревоги ПЛК</small></h2>
      <ul>
        {preds.slice(0, 4).map((p) => <li key={`${p.controller}.${p.param}`} className={`sev-${p.severity}`}>
          <button onClick={() => onSelect(p.controller)}><b>{p.equipment}</b>
            <span>{p.paramName}: {fmt(p.value, p.decimals)} → {fmt(p.limit, p.decimals)} {p.unit} · {p.etaMin !== null ? `${p.failure.toLowerCase()} через ~${Math.round(p.etaMin)} мин` : `риск ${Math.round(p.probability * 100)}% за час`}</span>
            <small>{p.action}</small></button>
        </li>)}
        {anomalies.slice(0, 3).map((a) => <li key={`a.${a.controller}.${a.param}`} className="sev-warn">
          <button onClick={() => onSelect(a.controller)}><b>{a.equipment}</b>
            <span>Аномалия: {a.paramName.toLowerCase()} {fmt(a.value, a.decimals)} {a.unit} при норме {fmt(a.expected, a.decimals)} ({a.shiftSigma > 0 ? '+' : ''}{fmt(a.shiftSigma, 1)}σ)</span>
            <small>Тревоги ПЛК ещё нет — осмотрите узел.</small></button>
        </li>)}
      </ul>
    </section>
  )
}

function Tile({ def, state, alarms, forecast, selected, onSelect }: { def: ControllerDef; state: ScadaState | null; alarms: Alarm[]; forecast?: Prediction; selected: boolean; onSelect: () => void }) {
  const st = state?.controllers[def.id]
  const own = alarms.filter((a) => a.controller === def.id)
  const top = [...own].sort((a, b) => a.priority - b.priority)[0]
  return (
    <button className={`tile${selected ? ' selected' : ''}${top ? ` tile-alarm prio-${top.priority}` : ''}`} onClick={onSelect} aria-pressed={selected}>
      <span className="tile-head">
        <span><b>{def.equipment}</b><small>{def.name}</small></span>
        <StateChip st={st} />
      </span>
      <span className="tile-params">
        {def.params.slice(0, 3).map((p) => {
          const v = st?.params[p.id]
          return (
            <span key={p.id} className="tile-param">
              <span className="tp-name">{p.name}</span>
              <Value p={p} pv={v?.pv ?? null} quality={v?.q ?? 'bad'} />
              <Gauge p={p} pv={v?.pv ?? null} sp={v?.sp ?? null} alarm={paramAlarm(alarms, def.id, p.id)} quality={v?.q ?? 'bad'} />
            </span>
          )
        })}
      </span>
      <span className="tile-foot">
        <span>{fmt(st?.speed, 1)} {def.speed.unit}</span>
        <span>{st?.processed ?? '—'} шт</span>
        {st?.remote === false && <span className="flag">Местный</span>}
        {st?.safety === false && <span className="flag bad">Цепь безоп.</span>}
        {top && <span className="tile-alarm-text"><Prio alarm={top} compact />{own.length > 1 ? `${own.length} тревоги` : top.message.split('.')[0]}</span>}
        {forecast && <span className={`tile-ai sev-${forecast.severity}`}><Icon name="spark" size={12} />ИИ: {forecast.etaMin !== null ? `${forecast.failure.toLowerCase()} через ~${Math.round(forecast.etaMin)} мин` : `риск отказа ${Math.round(forecast.probability * 100)}%`}</span>}
      </span>
    </button>
  )
}

function Journal({ tab, onTab, state, defs, config, user, actions, onSelect, area }: { tab: Tab; onTab: (t: Tab) => void; state: ScadaState | null; defs: Map<string, ControllerDef>; config: ScadaConfig; user: User | null; actions: Actions; onSelect: (id: string) => void; area: string }) {
  const [ioArea, setIoArea] = useState('all')
  const [ioKind, setIoKind] = useState('all')
  const [audit, setAudit] = useState<AuditRow[] | null>(null)
  const [verify, setVerify] = useState<{ ok: boolean; rows: number } | null>(null)
  const [events, setEvents] = useState<DowntimeEvent[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (tab === 'audit') { api.audit().then((r) => alive && setAudit(r), () => null); api.verify().then((r) => alive && setVerify(r), () => null) }
      if (tab === 'events') api.events().then((r) => alive && setEvents(r), () => null)
    }
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [tab])
  const signals = config.controllers.reduce((n, c) => n + c.io.length, 0)
  const tabs: [Tab, string][] = [['alarms', `Тревоги (${state?.alarms.length ?? 0})`], ['commands', 'Команды'], ['io', `Сигналы I/O (${signals})`], ['audit', 'Журнал аудита'], ['events', 'Простои по ПЛК'], ['links', 'Связь']]
  const name = (cid: string) => defs.get(cid)?.equipment ?? config.lines.find((l) => l.id === cid)?.name ?? cid
  const ioControllers = config.controllers.map((c) => (ioKind === 'all' ? c : { ...c, io: c.io.filter((s) => s.kind === ioKind) }))
  return (
    <section className="journal" id="journal">
      <div className="journal-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>{label}</button>)}
      </div>
      <div className="journal-body" role="tabpanel">
        {tab === 'alarms' && (
          <table>
            <thead><tr><th>Пр.</th><th>Время</th><th>Оборудование</th><th>Сообщение</th><th>Состояние</th><th /></tr></thead>
            <tbody>
              {(state?.alarms ?? []).map((a) => (
                <tr key={a.id} className={a.acked ? '' : 'unacked'}>
                  <td><Prio alarm={a} /></td><td>{clock(a.since)}</td>
                  <td><button className="link-btn" onClick={() => onSelect(a.controller)}>{name(a.controller)}</button></td>
                  <td>{a.message}{a.shelveReason && <small> · отложена: {a.shelveReason}</small>}</td>
                  <td>{a.active ? (a.acked ? 'Активна, квитирована' : 'Активна') : 'Вернулась в норму'}{a.shelvedUntil ? ` · до ${clock(a.shelvedUntil)}` : ''}</td>
                  <td>{!a.acked && <button className="mini" onClick={() => (can(user, 'operator') ? actions.ack(a.id) : actions.login())}>Квитировать</button>}</td>
                </tr>
              ))}
              {!state?.alarms.length && <tr><td colSpan={6} className="empty">Тревог нет</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'commands' && (
          <table>
            <thead><tr><th>Время</th><th>Оборудование</th><th>Команда</th><th>Кто</th><th>Причина</th><th>Результат</th></tr></thead>
            <tbody>
              {(state?.commands ?? []).map((c) => (
                <tr key={c.id} className={`status-${c.status}`}><td>{clock(c.updated)}</td><td>{c.kind === 'line' ? 'Линия' : name(c.controller)}</td><td>{c.label}</td><td>{c.user}</td><td>{c.reason || '—'}</td><td>{c.message}</td></tr>
              ))}
              {!state?.commands.length && <tr><td colSpan={6} className="empty">Команд в этой смене не было</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'io' && (
          <>
            <div className="io-filter">
              <span>База сигналов станции: что подключено к клеммам каждого шкафа и что ПЛК отдаёт серверу под тегом <code>IO.&lt;id&gt;</code>.</span>
              <select aria-label="Участок" value={ioArea === 'all' && area !== 'all' ? area : ioArea} onChange={(e) => setIoArea(e.target.value)}>
                <option value="all">Все участки</option>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select aria-label="Вид сигнала" value={ioKind} onChange={(e) => setIoKind(e.target.value)}>
                <option value="all">DI · DO · AI · AO</option><option value="DI">DI — дискретные входы</option><option value="DO">DO — дискретные выходы</option><option value="AI">AI — аналоговые входы</option><option value="AO">AO — аналоговые выходы</option>
              </select>
            </div>
            <IoTable controllers={ioControllers} state={state} area={ioArea === 'all' && area !== 'all' ? area : ioArea} onSelect={onSelect} />
          </>
        )}
        {tab === 'audit' && (
          <>
            {verify && <p className={`audit-verify ${verify.ok ? 'ok' : 'bad'}`}><Icon name={verify.ok ? 'check' : 'alert'} size={14} />{verify.ok ? `Цепочка хешей цела: ${verify.rows} записей` : 'Журнал изменён вне системы — цепочка хешей нарушена'}</p>}
            <table>
              <thead><tr><th>Время</th><th>Кто</th><th>Оборудование</th><th>Действие</th><th>Статус</th><th>Подробности</th></tr></thead>
              <tbody>
                {(audit ?? []).map((r) => (
                  <tr key={r.seq}><td>{dateTime(r.ts)}</td><td>{r.user}{r.role && <small> · {config.roles[r.role] ?? r.role}</small>}</td><td>{r.controller ? name(r.controller) : '—'}</td><td>{r.action}</td><td>{r.status}</td>
                    <td><small>{[r.detail.reason, r.detail.message, r.detail.text].filter(Boolean).join(' · ') || '—'}</small></td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {tab === 'events' && (
          <table>
            <thead><tr><th>Начало</th><th>Оборудование</th><th>Участок</th><th>Состояние</th><th>Причина</th><th>Мин</th></tr></thead>
            <tbody>
              {(events ?? []).map((e) => (
                <tr key={e.id}><td>{dateTime(e.start)}</td><td>{e.equipment}</td><td>{e.area}</td><td>{e.state}{e.end ? '' : ' · идёт'}</td><td>{e.reason}</td><td>{fmt(e.minutes, 1)}</td></tr>
              ))}
              {events?.length === 0 && <tr><td colSpan={6} className="empty">Простоев не зафиксировано</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'links' && (
          <div className="links">
            <p>{config.note}</p>
            <table>
              <thead><tr><th>Подключение</th><th>Протокол</th><th>Адрес</th><th>Состояние</th><th>С</th></tr></thead>
              <tbody>{config.connections.map((c) => {
                const s = state?.connections.find((x) => x.id === c.id)
                return <tr key={c.id}><td>{c.name}</td><td>{c.protocol.toUpperCase()}</td><td><code>{c.endpoint}</code></td><td className={s?.ok ? '' : 'bad'}>{s?.text ?? '—'}</td><td>{s ? clock(s.since) : '—'}</td></tr>
              })}</tbody>
            </table>
            <p className="fp-meta">Контроллеров: {config.controllers.length}, полевых сигналов: {signals}. Каждый ПЛК отдаёт интерфейс PackML (состояние, режим, скорость, счётчики, код останова, ключ «Местный/Дистанционный», цепь безопасности, параметры и уставки) и образ своих клемм (IO). {config.station.network}</p>
          </div>
        )}
      </div>
    </section>
  )
}

function useModal() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return ref
}

function LoginDialog({ demo, onClose, onLogin }: { demo: boolean; onClose: () => void; onLogin: (u: User) => void }) {
  const ref = useModal()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { onLogin(await api.login(login.trim(), password)) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <dialog ref={ref} className="hmi-dialog" aria-labelledby="login-title" onCancel={onClose}>
      <form onSubmit={submit}>
        <h2 id="login-title">Вход в пульт управления</h2>
        <p className="fp-meta">Смотреть может любой в сети завода. Команды, квитирование и уставки — после входа; каждое действие записывается в журнал от вашего имени.</p>
        <label>Логин<input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required /></label>
        <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {demo && <p className="demo-accounts">Демо-учётки: <code>operator</code> / <code>operator</code> — оператор, <code>engineer</code> / <code>engineer</code> — инженер АСУ ТП.</p>}
        <div className="dialog-actions"><button type="button" className="mini" onClick={onClose}>Отмена</button><button className="mini primary" disabled={busy}>Войти</button></div>
      </form>
    </dialog>
  )
}

function ConfirmDialog({ cmd, def, line, state, serverNow, onClose, onDone }: { cmd: Command; def?: ControllerDef; line?: ScadaConfig['lines'][number]; state: ScadaState | null; serverNow: () => number; onClose: () => void; onDone: (text: string) => void }) {
  const ref = useModal()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(() => Math.max(0, Math.round((cmd.expires ?? 0) - serverNow())))
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((cmd.expires ?? 0) - serverNow()))), 250)
    return () => clearInterval(t)
  }, [cmd.expires, serverNow])
  const st = state?.controllers[cmd.controller]
  const needReason = cmd.kind !== 'packml' && cmd.kind !== 'line'
  const lineStates = line ? line.controllers.map((cid) => state?.controllers[cid]) : []
  const cancel = () => { void api.cancel(cmd.id).catch(() => null); onClose() }
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.confirm(cmd.id, reason)
      onDone(def ? `${def.equipment}: ${cmd.label} — отправлена в ПЛК` : `${cmd.label} — выполняется по очереди`)
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <dialog ref={ref} className="hmi-dialog confirm" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); cancel() }}>
      <form onSubmit={confirm}>
        <span className="fp-kicker">Второй шаг · подтверждение</span>
        <h2 id="confirm-title">{cmd.label}</h2>
        {def ? <p><b>{def.equipment}</b> — {def.name}</p> : <p><b>{line?.name}</b></p>}
        {def ? (
          <dl className="confirm-facts">
            <div><dt>Сейчас</dt><dd>{st?.stateName ?? '—'}</dd></div>
            <div><dt>Пульт</dt><dd>{st?.remote ? 'Дистанционный' : 'Местный'}</dd></div>
            <div><dt>Цепь безопасности</dt><dd>{st?.safety ? 'Норма' : 'Разомкнута'}</dd></div>
          </dl>
        ) : (
          <dl className="confirm-facts">
            <div><dt>Контроллеров</dt><dd>{line?.controllers.length ?? '—'}</dd></div>
            <div><dt>Местное управление</dt><dd>{lineStates.filter((s) => s?.remote === false).length}</dd></div>
            <div><dt>Цепь разомкнута</dt><dd>{lineStates.filter((s) => s?.safety === false).length}</dd></div>
          </dl>
        )}
        <p className="fp-meta">{def ? 'Перед подтверждением убедитесь, что в зоне оборудования нет людей. Если состояние изменится, ПЛК команду не получит.'
          : 'Контроллеры запускаются по очереди с конца линии, каждый — через проверки роли, ключа, цепи безопасности и разрешений пуска. Заблокированные пропускаются, результат виден в шагах команды.'}</p>
        <label>Причина{needReason ? ' (обязательно)' : ''}<input autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={needReason ? 'например: по техкарте, заявка №…' : 'необязательно'} required={needReason} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="mini" onClick={cancel}>Отмена</button>
          <button className="mini primary" disabled={busy || left === 0}>{left === 0 ? 'Время истекло' : `Подтвердить · ${left} с`}</button>
        </div>
      </form>
    </dialog>
  )
}

function ShelveDialog({ alarm, onClose, onDone, onError }: { alarm: Alarm; onClose: () => void; onDone: () => void; onError: (t: string) => void }) {
  const ref = useModal()
  const [minutes, setMinutes] = useState(alarm.shelvedUntil ? 0 : 60)
  const [reason, setReason] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api.shelve(alarm.id, minutes, reason); onDone() } catch (err) { onError((err as Error).message) }
  }
  return (
    <dialog ref={ref} className="hmi-dialog" aria-labelledby="shelve-title" onCancel={onClose}>
      <form onSubmit={submit}>
        <h2 id="shelve-title">{alarm.shelvedUntil ? 'Вернуть тревогу' : 'Отложить тревогу'}</h2>
        <p>{alarm.message}</p>
        {!alarm.shelvedUntil && <label>На сколько<select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[30, 60, 120, 240, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} мин` : `${m / 60} ч`}</option>)}</select></label>}
        <label>Причина (обязательно)<input autoFocus required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="например: датчик в ремонте, заявка №…" /></label>
        <p className="fp-meta">Отложенная тревога не показывается в ленте, но остаётся в журнале и возвращается автоматически.</p>
        <div className="dialog-actions"><button type="button" className="mini" onClick={onClose}>Отмена</button><button className="mini primary">{alarm.shelvedUntil ? 'Вернуть' : 'Отложить'}</button></div>
      </form>
    </dialog>
  )
}
