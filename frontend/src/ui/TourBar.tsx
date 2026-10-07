import type { TourStop } from '../scene/tour'
import { Icon } from './Icon'

export function TourBar({ stops, index, playing, roof, labels, onPlay, onStop, onStep, onRoof, onLabels, onOverview }: {
  stops: TourStop[]; index: number | null; playing: boolean; roof: boolean; labels: boolean
  onPlay: () => void; onStop: () => void; onStep: (i: number) => void; onRoof: () => void; onLabels: () => void; onOverview: () => void
}) {
  const stop = index !== null ? stops[index] : null
  return <div className="tourbar">
    {stop && <section className="tour-caption" key={index} aria-label="Экскурсия по заводу" aria-live="polite">
      <div className="tour-caption-top"><span className="tour-step">ЗНАКОМСТВО С ПРОИЗВОДСТВОМ</span><span className="tour-count">{String(index! + 1).padStart(2, '0')} / {stops.length}</span><button className="icon-button" onClick={onOverview} aria-label="Завершить экскурсию"><Icon name="close" size={15} /></button></div>
      <h2 className="tour-title">{stop.title}</h2><div className="tour-text">{stop.text}</div>
      <div className="tour-progress">{stops.map((s, i) => <button key={i} className={i === index ? 'on' : i < index! ? 'done' : ''} onClick={() => onStep(i)} title={s.title} aria-label={`Шаг ${i + 1}: ${s.title}`} aria-current={i === index ? 'step' : undefined} />)}</div>
    </section>}
    <div className="controls" role="group" aria-label="Управление 3D-сценой">
      {index !== null && <button className="tour-arrow" onClick={() => onStep(index - 1)} disabled={index === 0} aria-label="Предыдущий шаг"><Icon name="arrow-left" size={16} /></button>}
      <button className="primary" onClick={playing ? onStop : onPlay}><Icon name={playing ? 'pause' : 'play'} size={15} />{playing ? 'Пауза' : index === null ? '3D-экскурсия' : 'Продолжить'}</button>
      {index !== null && <button className="tour-arrow" onClick={() => onStep(index + 1)} disabled={index === stops.length - 1} aria-label="Следующий шаг"><Icon name="arrow-right" size={16} /></button>}
      <span className="sep" />
      <button onClick={onOverview} title="Вернуть камеру к общему виду"><Icon name="rotate" size={17} /><span>Общий вид</span></button>
      <button className={roof ? '' : 'toggled'} aria-pressed={!roof} onClick={onRoof} title={roof ? 'Снять кровлю и показать цеха' : 'Показать кровлю'}><Icon name="layers" size={17} /><span>{roof ? 'Внутри завода' : 'Показать кровлю'}</span></button>
      <button className={`labels-control${labels ? ' toggled' : ''}`} aria-pressed={labels} onClick={onLabels} title="Названия участков на модели"><Icon name="tag" size={17} /><span>Подписи</span></button>
    </div>
  </div>
}
