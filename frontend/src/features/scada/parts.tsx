import type { Alarm, ControllerState, ParamDef } from './scada'
import { S, fmt } from './scada'

const PRIO = { 1: 'Высокий', 2: 'Средний', 3: 'Низкий' } as const

/** Приоритет тревоги: форма + цифра + цвет, чтобы не зависеть только от цвета (ISA-101). */
export function Prio({ alarm, compact }: { alarm: Pick<Alarm, 'priority' | 'acked' | 'active'>; compact?: boolean }) {
  return (
    <span className={`prio prio-${alarm.priority}${alarm.acked ? '' : ' unacked'}${alarm.active ? '' : ' rtn'}`} title={`Приоритет: ${PRIO[alarm.priority]}${alarm.acked ? '' : ', не квитирована'}`}>
      <span aria-hidden="true">{alarm.priority}</span>
      {!compact && <span className="sr-only">Приоритет {PRIO[alarm.priority]}{alarm.acked ? '' : ', не квитирована'}</span>}
    </span>
  )
}

/** Состояние PackML. Норма — спокойный серый, авария и потеря связи — выделены. */
export function StateChip({ st }: { st: ControllerState | undefined }) {
  if (!st || st.comm === 'bad') return <span className="state-chip comm-bad">Нет связи</span>
  if (st.comm === 'stale') return <span className="state-chip comm-bad">Данные устарели</span>
  const cls = st.state === S.EXECUTE ? 'run'
    : st.state === S.ABORTED || st.state === S.ABORTING ? 'fault'
      : st.state === S.SUSPENDED || st.state === S.HELD ? 'wait' : 'stop'
  return <span className={`state-chip ${cls}`}>{st.stateName}</span>
}

export function paramAlarm(alarms: Alarm[], cid: string, pid: string) {
  return alarms.filter((a) => a.controller === cid && a.kind.startsWith(`${pid}.`) && a.active).sort((a, b) => a.priority - b.priority)[0]
}

/** Аналоговый индикатор: диапазон, зона нормы, пределы, уставка и текущее значение. */
export function Gauge({ p, pv, sp, alarm, quality }: { p: ParamDef; pv: number | null; sp: number | null; alarm?: Alarm; quality: string }) {
  const [lo, hi] = p.range
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`
  const a = p.alarms
  const centre = sp ?? p.sp?.value
  const normalLo = a.dev !== undefined && centre !== undefined ? centre - a.dev : a.lo ?? lo
  const normalHi = a.dev !== undefined && centre !== undefined ? centre + a.dev : a.hi ?? hi
  return (
    <span className={`gauge${alarm ? ` gauge-alarm prio-${alarm.priority}` : ''}${quality !== 'good' ? ' gauge-bad' : ''}`} aria-hidden="true">
      <span className="gauge-normal" style={{ left: pos(normalLo), width: `calc(${pos(normalHi)} - ${pos(normalLo)})` }} />
      {(['lolo', 'lo', 'hi', 'hihi'] as const).filter((k) => a[k] !== undefined).map((k) => <span key={k} className={`gauge-limit ${k}`} style={{ left: pos(a[k]!) }} />)}
      {centre !== undefined && p.sp && <span className="gauge-sp" style={{ left: pos(centre) }} />}
      {pv !== null && <span className="gauge-pv" style={{ left: pos(pv) }} />}
    </span>
  )
}

export function Value({ p, pv, quality }: { p: ParamDef; pv: number | null; quality: string }) {
  return <span className={`pv${quality !== 'good' ? ' bad-quality' : ''}`}>{quality !== 'good' ? '?' : fmt(pv, p.decimals)}<small>{p.unit}</small></span>
}
