import { useState } from 'react'
import { Icon } from '../shared/ui/Icon'
import { Trend } from './Trend'
import { Gauge, Prio, StateChip, Value, paramAlarm } from '../features/scada/parts'
import { S, can, clock, fmt, nextStep, type Alarm, type Command, type ControllerDef, type ControllerState, type ScadaConfig, type User } from '../features/scada/scada'

const STATUS_RU: Record<Command['status'], string> = {
  new: 'Создана', armed: 'Ждёт подтверждения', sent: 'Отправлена в ПЛК', done: 'Выполнена', failed: 'Не выполнена',
  rejected: 'Отклонена', expired: 'Истекла', cancelled: 'Отменена',
}
const MAIN = ['RESET', 'START', 'HOLD', 'UNHOLD', 'STOP', 'CLEAR']

export interface Actions {
  send: (cid: string, kind: Command['kind'], name: string, value?: number) => void
  ack: (id?: string, controller?: string) => void
  shelve: (alarm: Alarm) => void
  login: () => void
  field: (cid: string, action: 'fault' | 'estop' | 'release' | 'local' | 'remote', code?: number) => void
  explain: (text: string) => void
}

export function Faceplate({ def, st, config, user, alarms, commands, now, actions, onClose }: {
  def: ControllerDef; st: ControllerState | undefined; config: ScadaConfig; user: User | null
  alarms: Alarm[]; commands: Command[]; now: number; actions: Actions; onClose: () => void
}) {
  const [trendParam, setTrendParam] = useState(def.params[0]?.id)
  const [minutes, setMinutes] = useState(15)
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null)
  const [faultCode, setFaultCode] = useState(Object.keys(def.faults).find((k) => Number(k) < 900) ?? '')
  const operator = can(user, 'operator')
  const engineer = can(user, 'engineer')
  const next = st ? nextStep(st.state) : null
  const nextBlocked = next && st?.commands[next]?.blocked
  const labels = Object.fromEntries(config.commands.map((c) => [c.name, c.label]))
  const own = alarms.filter((a) => a.controller === def.id)
  const lastCmd = commands.find((c) => c.controller === def.id)
  const trendDef = def.params.find((p) => p.id === trendParam) ?? def.params[0]

  const press = (name: string) => {
    const blocked = st?.commands[name]?.blocked
    if (!operator) return actions.login()
    if (blocked) return actions.explain(`${labels[name]}: ${blocked}`)
    actions.send(def.id, 'packml', name)
  }
  const submitEdit = (kind: 'setpoint' | 'speed', name: string) => {
    if (!edit) return
    const value = Number(edit.value.replace(',', '.'))
    if (!Number.isFinite(value)) return actions.explain('Введите число')
    actions.send(def.id, kind, name, value)
    setEdit(null)
  }

  return (
    <section className="faceplate" aria-labelledby="fp-title">
      <header className="fp-head">
        <div>
          <span className="fp-kicker">{def.area} · {def.zone === 'qc' ? 'ОТК' : 'линия'}</span>
          <h2 id="fp-title">{def.equipment}</h2>
          <p>{def.name}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть панель контроллера"><Icon name="close" /></button>
      </header>

      <div className="fp-state">
        <StateChip st={st} />
        <dl>
          <div><dt>Режим</dt><dd>{st?.mode ? Object.values(config.modes).find((m) => m.value === st.mode)?.label : '—'}</dd></div>
          <div><dt>Пульт</dt><dd className={st?.remote === false ? 'flag' : ''}>{st?.remote === false ? 'Местный' : st?.remote ? 'Дистанционный' : '—'}</dd></div>
          <div><dt>Безопасность</dt><dd className={st?.safety === false ? 'flag bad' : ''}>{st?.safety === false ? 'Цепь разомкнута' : st?.safety ? 'Норма' : '—'}</dd></div>
        </dl>
        {st?.stopText && (st.state === S.ABORTED || st.state === S.ABORTING
          ? <p className="fp-reason"><Icon name="alert" size={14} />Авария: {st.stopText}</p>
          : st.state !== S.EXECUTE && <p className="fp-meta">Причина последнего останова: {st.stopText} — сбрасывается командой «Сброс»</p>)}
        {st?.comm !== 'good' && <p className="fp-reason"><Icon name="alert" size={14} />{st?.commText || 'Нет данных от контроллера'}</p>}
      </div>

      <div className="fp-section">
        <div className="fp-section-head"><h3>Управление</h3>{!operator && <button className="link-btn" onClick={actions.login}>Войти для управления</button>}</div>
        {st?.writeBlocked && <p className="fp-note"><Icon name="info" size={14} />{st.writeBlocked}: команды не отправляются в ПЛК</p>}
        <div className="cmd-grid">
          {MAIN.map((name) => {
            const blocked = st?.commands[name]?.blocked
            return (
              <button key={name} className={`cmd${name === next ? ' next' : ''}${name === 'STOP' ? ' cmd-stop' : ''}`} aria-disabled={!operator || !!blocked}
                title={blocked ?? (operator ? (st?.commands[name]?.confirm ? 'С подтверждением' : 'Выполняется сразу') : 'Войдите, чтобы управлять')} onClick={() => press(name)}>
                {labels[name]}
              </button>
            )
          })}
        </div>
        <button className="cmd cmd-abort" aria-disabled={!operator || !!st?.commands.ABORT?.blocked} title={st?.commands.ABORT?.blocked ?? 'Программная остановка. Не заменяет аварийную кнопку на линии.'} onClick={() => press('ABORT')}>
          <Icon name="alert" size={15} />Аварийная остановка
        </button>
        {next && <p className="fp-hint">{nextBlocked ? <>Следующий шаг — «{labels[next]}»: <b>{nextBlocked}</b></> : <>Следующий шаг — «{labels[next]}»</>}</p>}
        {lastCmd && (
          <p className={`fp-last status-${lastCmd.status}`} aria-live="polite">
            <span>{clock(lastCmd.updated)}</span><b>{lastCmd.label}</b>{STATUS_RU[lastCmd.status]}{lastCmd.message && ['failed', 'rejected', 'expired'].includes(lastCmd.status) ? ` — ${lastCmd.message}` : ''}
          </p>
        )}
      </div>

      <div className="fp-section">
        <div className="fp-section-head"><h3>Режим</h3>{!engineer && <span className="fp-meta">меняет инженер</span>}</div>
        <div className="segmented" role="group" aria-label="Режим работы">
          {Object.entries(config.modes).map(([name, m]) => (
            <button key={name} aria-pressed={st?.mode === m.value} aria-disabled={!engineer || st?.mode === m.value || !!st?.modeBlocked}
              title={st?.modeBlocked ?? undefined}
              onClick={() => (!engineer ? actions.login() : st?.mode === m.value ? undefined : st?.modeBlocked ? actions.explain(st.modeBlocked) : actions.send(def.id, 'mode', name))}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fp-section">
        <h3>Процесс</h3>
        <ul className="params">
          {def.params.map((p) => {
            const v = st?.params[p.id]
            const alarm = paramAlarm(alarms, def.id, p.id)
            return (
              <li key={p.id} className={alarm ? 'in-alarm' : ''}>
                <div className="param-row">
                  <span className="param-name">{p.name}{alarm && <Prio alarm={alarm} compact />}</span>
                  <Value p={p} pv={v?.pv ?? null} quality={v?.q ?? 'bad'} />
                </div>
                <Gauge p={p} pv={v?.pv ?? null} sp={v?.sp ?? null} alarm={alarm} quality={v?.q ?? 'bad'} />
                {p.sp && (
                  <div className="sp-row">
                    <span>Уставка <b>{fmt(v?.sp, p.decimals)} {p.unit}</b><span className="fp-meta"> · {p.sp.min}…{p.sp.max}, шаг ≤ {p.sp.maxStep}</span></span>
                    {edit?.id === p.id ? (
                      <form className="sp-edit" onSubmit={(e) => { e.preventDefault(); submitEdit('setpoint', p.id) }}>
                        <input autoFocus inputMode="decimal" aria-label={`Новая уставка: ${p.name}`} value={edit.value} onChange={(e) => setEdit({ id: p.id, value: e.target.value })} />
                        <button className="mini primary">Задать</button>
                        <button type="button" className="mini" onClick={() => setEdit(null)}>Отмена</button>
                      </form>
                    ) : (
                      <button className="mini" onClick={() => (engineer ? setEdit({ id: p.id, value: String(v?.sp ?? p.sp!.value) }) : actions.login())}>Изменить</button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          <li>
            <div className="param-row"><span className="param-name">Скорость</span><span className="pv">{fmt(st?.speed, 1)}<small>{def.speed.unit}</small></span></div>
            <div className="sp-row">
              <span>Задание <b>{fmt(st?.speedSp, 1)} {def.speed.unit}</b>{def.speed.min === undefined && <span className="fp-meta"> · задаёт ведущий конвейер</span>}</span>
              {def.speed.min !== undefined && (edit?.id === '__speed' ? (
                <form className="sp-edit" onSubmit={(e) => { e.preventDefault(); submitEdit('speed', 'MachSpeed') }}>
                  <input autoFocus inputMode="decimal" aria-label="Новое задание скорости" value={edit.value} onChange={(e) => setEdit({ id: '__speed', value: e.target.value })} />
                  <button className="mini primary">Задать</button>
                  <button type="button" className="mini" onClick={() => setEdit(null)}>Отмена</button>
                </form>
              ) : <button className="mini" onClick={() => (engineer ? setEdit({ id: '__speed', value: String(st?.speedSp ?? def.speed.value) }) : actions.login())}>Изменить</button>)}
            </div>
          </li>
        </ul>
        <dl className="counters">
          <div><dt>Обработано</dt><dd>{st?.processed ?? '—'}</dd></div>
          <div><dt>Брак</dt><dd>{st?.defective ?? '—'}</dd></div>
          <div><dt>Доля брака</dt><dd>{st?.processed ? `${fmt(((st.defective ?? 0) / st.processed) * 100, 1)} %` : '—'}</dd></div>
        </dl>
      </div>

      {trendDef && (
        <div className="fp-section">
          <div className="fp-section-head">
            <h3>Тренд</h3>
            <div className="segmented small" role="group" aria-label="Интервал тренда">
              {[15, 60, 240].map((m) => <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m < 60 ? `${m} мин` : `${m / 60} ч`}</button>)}
            </div>
          </div>
          {def.params.length > 1 && <div className="tabs-inline" role="group" aria-label="Параметр тренда">
            {def.params.map((p) => <button key={p.id} aria-pressed={trendDef.id === p.id} onClick={() => setTrendParam(p.id)}>{p.name}</button>)}
          </div>}
          <Trend key={`${def.id}-${trendDef.id}`} cid={def.id} param={trendDef} minutes={minutes} live={st?.params[trendDef.id]?.q === 'good' ? st.params[trendDef.id].pv : null} liveSp={st?.params[trendDef.id]?.sp ?? null} now={now} />
        </div>
      )}

      <div className="fp-section">
        <div className="fp-section-head"><h3>Тревоги</h3>{own.some((a) => !a.acked) && <button className="mini" onClick={() => (operator ? actions.ack(undefined, def.id) : actions.login())}>Квитировать все</button>}</div>
        {own.length === 0 ? <p className="fp-meta">Активных тревог нет</p> : (
          <ul className="alarm-list">
            {own.map((a) => (
              <li key={a.id} className={a.acked ? '' : 'unacked'}>
                <Prio alarm={a} />
                <div><b>{a.message}</b><span>{clock(a.since)}{a.active ? '' : ' · вернулась в норму'}{a.shelvedUntil ? ` · отложена до ${clock(a.shelvedUntil)}` : ''}{a.ackBy ? ` · квитировал ${a.ackBy}` : ''}</span></div>
                {!a.acked && <button className="mini" onClick={() => (operator ? actions.ack(a.id) : actions.login())}>Квитировать</button>}
                {engineer && <button className="mini" onClick={() => actions.shelve(a)}>{a.shelvedUntil ? 'Вернуть' : 'Отложить'}</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fp-section fp-tech">
        <h3>Подключение</h3>
        <dl>
          <div><dt>Узел OPC UA</dt><dd><code>{def.path}</code></dd></div>
          <div><dt>Подключение</dt><dd>{config.connections.find((c) => c.id === def.connection)?.endpoint}</dd></div>
          <div><dt>Интерфейс</dt><dd>PackML · PackTags</dd></div>
        </dl>
      </div>

      {config.simulator && (
        <div className="fp-section fp-sim">
          <h3>Демонстрация: события на линии</h3>
          <p className="fp-meta">Только в режиме симулятора: то, что на заводе происходит у оборудования, а не в SCADA.</p>
          <div className="sim-actions">
            <select aria-label="Неисправность" value={faultCode} onChange={(e) => setFaultCode(e.target.value)}>
              {Object.entries(def.faults).filter(([k]) => Number(k) < 900).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
            <button className="mini" onClick={() => actions.field(def.id, 'fault', Number(faultCode))}>Вызвать отказ</button>
            <button className="mini" onClick={() => actions.field(def.id, st?.safety === false ? 'release' : 'estop')}>{st?.safety === false ? 'Отжать аварийную кнопку' : 'Нажать аварийную кнопку'}</button>
            <button className="mini" onClick={() => actions.field(def.id, st?.remote === false ? 'remote' : 'local')}>{st?.remote === false ? 'Ключ: дистанционный' : 'Ключ: местный'}</button>
          </div>
        </div>
      )}
    </section>
  )
}
