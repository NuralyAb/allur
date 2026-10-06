import type { TourStop } from '../scene/tour'

export function TourBar({
  stops,
  index,
  playing,
  roof,
  labels,
  onPlay,
  onStop,
  onStep,
  onRoof,
  onLabels,
}: {
  stops: TourStop[]
  index: number | null
  playing: boolean
  roof: boolean
  labels: boolean
  onPlay: () => void
  onStop: () => void
  onStep: (i: number) => void
  onRoof: () => void
  onLabels: () => void
}) {
  const stop = index !== null ? stops[index] : null
  return (
    <div className="tourbar">
      {stop && (
        <div className="tour-caption" key={index}>
          <div className="tour-step">
            {index! + 1} / {stops.length}
          </div>
          <div className="tour-title">{stop.title}</div>
          <div className="tour-text">{stop.text}</div>
          <div className="tour-progress">
            {stops.map((_, i) => (
              <button key={i} className={i === index ? 'on' : i < index! ? 'done' : ''} onClick={() => onStep(i)} aria-label={`Шаг ${i + 1}`} />
            ))}
          </div>
        </div>
      )}
      <div className="controls">
        {index !== null && (
          <button onClick={() => onStep(Math.max(0, index - 1))} disabled={index === 0} title="Назад">
            ‹
          </button>
        )}
        <button className="primary" onClick={playing ? onStop : onPlay}>
          {playing ? '❚❚ Пауза' : index === null ? '▶ 3D-экскурсия' : '▶ Продолжить'}
        </button>
        {index !== null && (
          <button onClick={() => onStep(Math.min(stops.length - 1, index + 1))} disabled={index === stops.length - 1} title="Вперёд">
            ›
          </button>
        )}
        <span className="sep" />
        <button className={roof ? '' : 'toggled'} onClick={onRoof} title="Снять кровлю и показать цеха">
          {roof ? 'Заглянуть внутрь' : 'Показать кровлю'}
        </button>
        <button className={labels ? 'toggled' : ''} onClick={onLabels}>
          Подписи
        </button>
      </div>
    </div>
  )
}
