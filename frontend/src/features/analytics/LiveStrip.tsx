import type { LiveShift } from '../../shared/types'
import { Icon } from '../../shared/ui/Icon'
import { fmtDate } from '../../shared/lib/format'

const clock = (min: number) => `${String(8 + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Ход текущей смены из живого потока: счётчики участков и простои, которые идут сейчас. */
export function LiveStrip({ shift, onArea }: { shift: LiveShift; onArea: (area: string) => void }) {
  const pct = Math.round((shift.elapsed / shift.length) * 100)
  return (
    <section className="live-strip" aria-label="Текущая смена" aria-live="off">
      <div className="live-head">
        <span className="live-pulse" />
        <strong>Смена {fmtDate(shift.date)}</strong>
        <span>{clock(shift.elapsed)} · {pct}%</span>
        <span className="live-progress"><span style={{ width: `${pct}%` }} /></span>
      </div>
      <div className="live-areas">
        {Object.entries(shift.areas).map(([area, a]) => (
          <button key={area} className={a.stopped ? 'stopped' : a.done < a.plan - 3 ? 'behind' : ''} onClick={() => onArea(area)}>
            <span>{area}</span>
            <strong>{a.done}<small> / {a.plan}</small></strong>
            <span>{a.stopped ? 'стоит' : `брак ${a.defects}`}</span>
          </button>
        ))}
      </div>
      <div className="live-events">
        {shift.active.map((e) => <button key={e.equipment} className="live-event active" onClick={() => onArea(e.area)}><Icon name="alert" size={13} />{e.equipment} · {e.reason.toLowerCase()} · {e.minutes} мин</button>)}
        {shift.active.length === 0 && <span className="live-event">Простоев сейчас нет</span>}
        {shift.finished.slice(-2).map((e) => <span key={e.equipment} className="live-event done">{e.equipment}: {e.minutes} мин</span>)}
      </div>
    </section>
  )
}
