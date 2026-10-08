import { useMemo } from 'react'
import { Icon } from '../shared/ui/Icon'
import { Prio, StateChip } from '../features/scada/parts'
import { clock, fmt, type Alarm, type ControllerDef, type ScadaConfig, type ScadaState, type SignalDef, type User } from '../features/scada/scada'

/**
 * Диспетчерская (центральный пульт): путь сигнала от датчика до пульта и состояние сервера SCADA.
 * Уровень 0 — датчики и приводы на клеммах шкафов; уровень 1 — ПЛК в шкафу линии; уровень 2 — сеть цеха и сервер,
 * который держит базу тегов, тревоги, историк и журнал; уровень 3 — пульты и двойник как его клиенты.
 */
export function MasterStation({ config, state, alarms, user, selected, onSelect, onLine }: {
  config: ScadaConfig; state: ScadaState | null; alarms: Alarm[]; user: User | null; selected: string | null
  onSelect: (id: string) => void; onLine: (line: string, name: 'START' | 'STOP' | 'HOLD') => void
}) {
  const srv = state?.server
  const areas = useMemo(() => {
    const order: string[] = []
    const by = new Map<string, ControllerDef[]>()
    for (const c of config.controllers) {
      if (!by.has(c.area)) { by.set(c.area, []); order.push(c.area) }
      by.get(c.area)!.push(c)
    }
    return order.map((a) => ({ area: a, controllers: by.get(a)! }))
  }, [config])
  const counts = useMemo(() => {
    const n = { DI: 0, DO: 0, AI: 0, AO: 0 }
    for (const c of config.controllers) for (const s of c.io) n[s.kind]++
    return n
  }, [config])
  const connOk = state ? state.connections.every((c) => c.ok) : false
  const st = config.station
  const running = state?.commands.filter((c) => c.kind === 'line' && (c.status === 'sent' || c.status === 'armed')) ?? []
  void user

  return (
    <section className="station" aria-label="Диспетчерская">
      <header className="station-head">
        <div>
          <span className="fp-kicker">Центральный пульт</span>
          <h2>{st.name ?? 'Диспетчерская'}</h2>
          <p>{[st.location, st.server].filter(Boolean).join(' · ')}</p>
        </div>
        <dl className="station-kpis" aria-label="Сервер SCADA">
          <div><dt>Контроллеры на связи</dt><dd className={srv && srv.online < srv.controllers ? 'bad' : ''}>{srv ? `${srv.online} / ${srv.controllers}` : '—'}</dd></div>
          <div><dt>Теги в базе</dt><dd>{srv ? srv.tags : '—'}<small> · {srv ? srv.signals : '—'} полевых</small></dd></div>
          <div><dt>Обновлений в секунду</dt><dd>{srv ? fmt(srv.updatesPerSec, 0) : '—'}</dd></div>
          <div><dt>Цикл тревог</dt><dd>{srv ? `${fmt(srv.scanMs, 1)} мс` : '—'}</dd></div>
          <div><dt>Клиентов</dt><dd>{srv ? srv.clients : '—'}</dd></div>
          <div><dt>Работает</dt><dd>{srv ? uptime(srv.uptime) : '—'}</dd></div>
        </dl>
      </header>

      <div className="signal-path" role="list" aria-label="Путь сигнала">
        <div className="sp-level" role="listitem">
          <span className="sp-level-name">Уровень 0 · Поле</span>
          <b>Датчики и приводы</b>
          <ul className="sp-counts">
            <li><i className="sig sig-di" />DI {counts.DI}</li>
            <li><i className="sig sig-do" />DO {counts.DO}</li>
            <li><i className="sig sig-ai" />AI {counts.AI}</li>
            <li><i className="sig sig-ao" />AO {counts.AO}</li>
          </ul>
          <p>Аварийные кнопки, ограждения, фотодатчики, термопары и тензодатчики подключены к модулям ввода-вывода в шкафу своей линии: в SCADA они приходят уже через ПЛК.</p>
        </div>
        <span className="sp-arrow" aria-hidden="true"><i /><small>клеммы · 24 В · 4–20 мА</small></span>
        <div className="sp-level sp-cabinets" role="listitem">
          <span className="sp-level-name">Уровень 1 · Шкафы управления</span>
          <b>{config.controllers.length} ПЛК по участкам</b>
          <div className="cab-areas">
            {areas.map(({ area, controllers }) => (
              <div key={area} className="cab-area">
                <span className="cab-area-name">{area}</span>
                {controllers.map((c) => {
                  const cs = state?.controllers[c.id]
                  const top = alarms.filter((a) => a.controller === c.id).sort((a, b) => a.priority - b.priority)[0]
                  return (
                    <button key={c.id} className={`cab${selected === c.id ? ' selected' : ''}${cs && cs.comm !== 'good' ? ' comm-bad' : ''}`} onClick={() => onSelect(c.id)} aria-pressed={selected === c.id}
                      title={c.cabinet ? `${c.cabinet.id} · ${c.cabinet.location}\n${c.cabinet.plc}` : c.equipment}>
                      <span className="cab-id">{c.cabinet?.id ?? c.id}{top && <Prio alarm={top} compact />}</span>
                      <span className="cab-eq">{c.equipment}</span>
                      <span className="cab-foot"><StateChip st={cs} /><small>{c.io.length} сигн.</small></span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
        <span className="sp-arrow" aria-hidden="true"><i /><small>OPC UA · PackML</small></span>
        <div className={`sp-level sp-server${connOk ? '' : ' comm-bad'}`} role="listitem">
          <span className="sp-level-name">Уровень 2 · Сервер SCADA</span>
          <b>{st.server ?? 'Сервер SCADA'}</b>
          <ul className="srv-list">
            <li><Icon name={connOk ? 'check' : 'alert'} size={13} />{state ? `${srv?.connectionsOk ?? 0} из ${srv?.connections ?? 0} подключений` : 'нет данных'}{config.mode !== 'plant' && <small> · симулятор ПЛК</small>}</li>
            <li>База тегов: {srv?.values ?? '—'} значений, {srv ? srv.updates.toLocaleString('ru-RU') : '—'} обновлений с запуска</li>
            <li>Тревоги: {srv?.alarmsActive ?? '—'} активных, {srv?.alarmsUnacked ?? '—'} не квитировано</li>
            <li>Историк: {srv?.historyRows !== undefined ? srv.historyRows.toLocaleString('ru-RU') : '—'} точек · журнал {srv?.auditRows ?? '—'} записей · {srv?.dbBytes !== undefined ? `${fmt(srv.dbBytes / 1048576, 1)} МБ` : '—'}</li>
            <li>Команд в работе: {srv?.commandsPending ?? '—'}{srv && srv.lineRuns > 0 && <small> · групповых {srv.lineRuns}</small>}</li>
            <li className={srv?.writeEnabled === false ? 'bad' : ''}>{srv?.writeEnabled === false ? 'Запись в ПЛК выключена' : 'Запись в ПЛК разрешена'}</li>
            <li><small>{st.redundancy ?? ''}</small></li>
          </ul>
        </div>
        <span className="sp-arrow" aria-hidden="true"><i /><small>WebSocket · HTTPS</small></span>
        <div className="sp-level" role="listitem">
          <span className="sp-level-name">Уровень 3 · Клиенты</span>
          <b>{srv?.clients ?? '—'} подключено</b>
          <ul className="srv-list">
            <li>Этот пульт (/hmi.html)</li>
            <li>Цифровой двойник — только чтение</li>
            <li><small>Все команды идут через сервер: роль, блокировки, второй шаг, журнал</small></li>
          </ul>
        </div>
      </div>

      <div className="station-lines">
        {config.lines.map((line) => {
          const run = running.find((c) => c.controller === line.id)
          const last = state?.commands.find((c) => c.kind === 'line' && c.controller === line.id)
          return (
            <div key={line.id} className="station-line">
              <div>
                <b>{line.name}</b>
                <p className="fp-meta">Групповая команда с центрального пульта: пуск идёт с конца линии к началу, остановка — с начала; каждый контроллер проходит те же проверки, что и по одному.</p>
                {run ? <p className="fp-last status-sent" aria-live="polite"><span>{clock(run.updated)}</span><b>{run.label}</b>{run.message}</p>
                  : last && <p className={`fp-last status-${last.status}`}><span>{clock(last.updated)}</span><b>{last.label}</b>{last.message}</p>}
                {last && last.steps.length > 0 && (
                  <ol className="line-steps">
                    {last.steps.map((s, i) => (
                      <li key={i} className={`step-${s.status}`}>
                        <span>{config.controllers.find((c) => c.id === s.controller)?.equipment ?? s.controller}</span>
                        <span>{s.label || '—'}</span>
                        <small>{s.message}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="line-cmds">
                {config.lineCommands.map((lc) => (
                  <button key={lc.name} className={`cmd${lc.name === 'STOP' ? ' cmd-stop' : ''}`} aria-disabled={!!run || state?.writeEnabled === false}
                    title={run ? 'Дождитесь завершения текущей команды линии' : lc.confirm ? 'С подтверждением' : 'Выполняется сразу'}
                    onClick={() => !run && onLine(line.id, lc.name)}>
                    {lc.label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function uptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 48) return `${Math.floor(h / 24)} д ${h % 24} ч`
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

/** Таблица сигналов: вид, адрес в ПЛК, устройство, текущее значение. */
export function IoTable({ controllers, state, area, onSelect }: { controllers: ControllerDef[]; state: ScadaState | null; area: string; onSelect: (id: string) => void }) {
  const rows = controllers.filter((c) => area === 'all' || c.area === area)
  return (
    <table className="io-table">
      <thead><tr><th>Шкаф</th><th>Оборудование</th><th>Сигнал</th><th>Вид</th><th>Адрес</th><th>Устройство</th><th>Значение</th><th>Сырое</th></tr></thead>
      <tbody>
        {rows.flatMap((c) => c.io.map((s) => {
          const v = state?.controllers[c.id]?.io[s.id]
          return (
            <tr key={`${c.id}/${s.id}`} className={v && v.q !== 'good' ? 'bad-quality' : ''}>
              <td><code>{c.cabinet?.id ?? '—'}</code></td>
              <td><button className="link-btn" onClick={() => onSelect(c.id)}>{c.equipment}</button></td>
              <td><b>{s.id}</b> {s.name}</td>
              <td><SignalKind kind={s.kind} /></td>
              <td><code>{s.address}</code></td>
              <td><small>{s.device}</small></td>
              <td><SignalValue sig={s} value={v?.value ?? null} quality={v?.q ?? 'bad'} /></td>
              <td><code>{v && v.raw !== null && v.raw !== undefined ? (typeof v.raw === 'boolean' ? (v.raw ? '1' : '0') : v.raw) : '—'}</code></td>
            </tr>
          )
        }))}
        {rows.length === 0 && <tr><td colSpan={8} className="empty">Сигналов нет</td></tr>}
      </tbody>
    </table>
  )
}

export function SignalKind({ kind }: { kind: SignalDef['kind'] }) {
  return <span className={`sig-kind sig-${kind.toLowerCase()}`}>{kind}</span>
}

export function SignalValue({ sig, value, quality }: { sig: SignalDef; value: number | boolean | null; quality: string }) {
  if (quality !== 'good' || value === null) return <span className="sig-val bad-quality">нет данных</span>
  if (sig.kind === 'DI' || sig.kind === 'DO') {
    const on = value === true
    return <span className={`sig-val sig-bit${on ? ' on' : ''}`}><i aria-hidden="true" />{on ? '1 · замкнут' : '0 · разомкнут'}</span>
  }
  const decimals = sig.range[1] - sig.range[0] > 100 ? 0 : 1
  return <span className="sig-val">{fmt(value as number, decimals)}<small> {sig.unit}</small></span>
}
