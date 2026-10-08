/**
 * Графики сценарной студии — встроенный SVG, как в админке. Одна серия — один цвет (ACCENT), цвета участков
 * закреплены за участками в том же порядке, что в админке. Подписи — цветом текста, не цветом серии.
 * У каждого графика есть подсказка при наведении и табличный вид.
 */
import { useRef, useState } from 'react'
import { useElementWidth } from '../../../shared/hooks/useElementWidth'
import type { Forecast, Sensitivity } from './types'

const ACCENT = '#2a78d6'
const AREA_COLORS: Record<string, string> = { Сварка: '#2a78d6', Окраска: '#eb6834', Сборка: '#1baf7a' }
const num = (x: number) => Math.round(x).toLocaleString('ru-RU')
const pct = (x: number) => `${Math.round(x * 100)}%`
const signed = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '') + num(Math.abs(x))

type Tip = { left: number; top: number; title: string; lines: string[] }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return <div className="fc-tip" style={{ left: `${tip.left}%`, top: `${tip.top}%` }} role="status"><strong>{tip.title}</strong>{tip.lines.map((l) => <span key={l}>{l}</span>)}</div>
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="fc-table"><summary>Таблица</summary>
      <table><caption className="sr-only">{caption}</caption><thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
    </details>
  )
}

/** Столбец со скруглённым верхом (4 px) и прямым основанием. */
function column(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

/** Распределение выпуска месяца по прогонам; пунктиром — план и цель, если попадают в диапазон или рядом с ним. */
export function Distribution({ f }: { f: Forecast }) {
  const ref = useRef<HTMLDivElement>(null)
  const W = useElementWidth(ref)
  const [tip, setTip] = useState<(Tip & { key: string }) | null>(null)
  const H = 200, L = 4, R = 4, T = 26, B = 28
  const bins = f.histogram
  const dataKey = `${f.p10}-${f.p50}-${f.p90}-${f.runs}`
  // ось захватывает план и цель, но не дальше одной ширины распределения в каждую сторону
  const first = bins[0].from, last = bins[bins.length - 1].to, span = last - first
  const lo = Math.max(Math.min(first, f.plan, f.target), first - span)
  const hi = Math.min(Math.max(last, f.plan, f.target), last + span)
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - R)
  const maxShare = Math.max(...bins.map((b) => b.share))
  const plotH = H - T - B
  const marks = [{ v: f.plan, label: `План ${num(f.plan)}` }, { v: f.target, label: `Цель ${num(f.target)}` }].filter((m) => m.v >= lo && m.v <= hi)
  const anchor = (px: number) => (px > W - 70 ? 'end' : px < 70 ? 'start' : 'middle')
  const marksNearEdge = marks.some((m) => x(m.v) > W - 90)
  return (
    <div className="fc-chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Распределение выпуска месяца: от ${num(f.p10)} до ${num(f.p90)} в 80% прогонов, медиана ${num(f.p50)}`} onMouseLeave={() => setTip(null)}>
        <line x1={L} x2={W - R} y1={T + plotH} y2={T + plotH} className="fc-axis" />
        <rect x={x(f.p10)} y={T} width={Math.max(1, x(f.p90) - x(f.p10))} height={plotH} className="fc-band" />
        {bins.map((b, i) => {
          const x0 = x(b.from) + 1, w = Math.max(1, x(b.to) - x(b.from) - 2)
          const h = maxShare ? (b.share / maxShare) * plotH : 0
          return (
            <g key={i}>
              <path d={column(x0, T + plotH - h, w, h)} fill={ACCENT} />
              <rect x={x(b.from)} y={T} width={Math.max(1, x(b.to) - x(b.from))} height={plotH} fill="transparent"
                onMouseEnter={() => setTip({ key: dataKey, left: ((x0 + w / 2) / W) * 100, top: ((T + plotH - h) / H) * 100, title: `${num(b.from)}–${num(b.to)} авто`, lines: [`${pct(b.share)} прогонов`] })} />
            </g>
          )
        })}
        <line x1={x(f.p50)} x2={x(f.p50)} y1={T - 4} y2={T + plotH} className="fc-median" />
        <text x={x(f.p50)} y={T - 9} textAnchor={anchor(x(f.p50))} className="fc-label strong">Медиана {num(f.p50)}</text>
        {marks.map((m) => (
          <g key={m.label}>
            <line x1={x(m.v)} x2={x(m.v)} y1={T + 10} y2={T + plotH} className="fc-ref" />
            <text x={x(m.v)} y={T + plotH + 18} textAnchor={anchor(x(m.v))} className="fc-label">{m.label}</text>
          </g>
        ))}
        {!marks.some((m) => x(m.v) < 90) && <text x={L} y={T + plotH + 18} className="fc-label muted">{num(lo)}</text>}
        {!marksNearEdge && <text x={W - R} y={T + plotH + 18} textAnchor="end" className="fc-label muted">{num(hi)}</text>}
      </svg>
      <Tooltip tip={tip?.key === dataKey ? tip : null} />
      <p className="fc-caption">Столбцы — доля прогонов месяца с таким выпуском. Затенено: 80% прогонов (P10–P90).</p>
      <TableView caption="Распределение выпуска месяца" head={['Выпуск, авто', 'Доля прогонов']} rows={bins.filter((b) => b.share > 0).map((b) => [`${num(b.from)}–${num(b.to)}`, pct(b.share)])} />
    </div>
  )
}

/** Как часто каждый участок оказывается узким местом: 100% полоса, подписи прямо на сегментах. */
export function BottleneckShare({ shares }: { shares: Record<string, number> }) {
  const items = Object.entries(shares).filter(([, v]) => v > 0)
  return (
    <div className="fc-share">
      <div className="fc-share-bar" role="img" aria-label={items.map(([a, v]) => `${a} — ${pct(v)}`).join(', ')}>
        {items.map(([area, v]) => <span key={area} style={{ width: `${v * 100}%`, background: AREA_COLORS[area] ?? ACCENT }} title={`${area}: узкое место в ${pct(v)} прогонов`} />)}
      </div>
      <div className="fc-legend">{Object.entries(shares).map(([area, v]) => <span key={area}><i style={{ background: AREA_COLORS[area] ?? ACCENT }} />{area} <b>{pct(v)}</b></span>)}</div>
    </div>
  )
}

/** Эффект мероприятий: столбец — средний прирост, отрезок — 80% прогонов (P10–P90). HTML-строки: подписи не обрезаются. */
export function SensitivityBars({ s, margin }: { s: Sensitivity; margin: number }) {
  const max = Math.max(1, ...s.items.map((i) => Math.max(i.gainP90, i.gain)))
  const min = Math.min(0, ...s.items.map((i) => i.gainP10))
  const pos = (v: number) => ((v - min) / (max - min)) * 100
  const len = (v: number) => (Math.abs(v) / (max - min)) * 100
  return (
    <div className="fc-sens">
      <ul aria-label="Эффект мероприятий на выпуск месяца">
        {s.items.map((it) => {
          const hint = [`${signed(it.gain)} авто/мес, 80% прогонов: ${signed(it.gainP10)}…${signed(it.gainP90)}`, `Стоимость ≈ ${num(it.cost / 1e6)} млн ₸/мес`,
            ...(margin ? [`Маржа минус затраты: ${num((it.gain * margin - it.cost) / 1e6)} млн ₸/мес`] : [])].join('\n')
          return (
            <li key={it.id} title={hint} tabIndex={0}>
              <span className="fc-sens-label">{it.title}<small>≈ {num(it.cost / 1e6)} млн ₸/мес{margin ? ` · итог ${num((it.gain * margin - it.cost) / 1e6)} млн ₸` : ''}</small></span>
              <span className="fc-sens-track">
                <span className="fc-sens-zero" style={{ left: `${pos(0)}%` }} />
                <span className="fc-sens-bar" style={{ left: `${pos(Math.min(0, it.gain))}%`, width: `${Math.max(0.4, len(it.gain))}%` }} />
                <span className="fc-sens-whisker" style={{ left: `${pos(it.gainP10)}%`, width: `${len(it.gainP90 - it.gainP10)}%` }} />
              </span>
              <b>{signed(it.gain)}</b>
            </li>
          )
        })}
      </ul>
      <TableView caption="Эффект мероприятий" head={['Мероприятие', 'Авто/мес', 'P10', 'P90', 'Стоимость, млн ₸/мес']}
        rows={s.items.map((i) => [i.title, signed(i.gain), signed(i.gainP10), signed(i.gainP90), num(i.cost / 1e6)])} />
    </div>
  )
}
