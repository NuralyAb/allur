/**
 * Графики админки: встроенный SVG без библиотек. Серии — три проверенных категориальных цвета в фиксированном
 * порядке (цвет закреплён за участком, не за позицией), столбцы ≤ 24 px со скруглённым верхом, сетка — волосяная.
 * У каждого графика есть легенда (от двух серий), подсказка при наведении и табличный вид.
 */
import { useId, useState, type ReactNode } from 'react'
import { num } from './api'

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const
export const GRAY = '#c9ced5'
export const ACCENT = '#2a78d6'

type Tip = { left: number; top: number; title: string; lines: string[] }

function nice(max: number): number {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p
  return 10 * p
}

/** Столбец со скруглённым верхом (4 px) и прямым основанием. */
function column(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div className="chart-tip" style={{ left: `${tip.left}%`, top: `${tip.top}%` }} role="status">
      <strong>{tip.title}</strong>
      {tip.lines.map((l) => <span key={l}>{l}</span>)}
    </div>
  )
}

function Legend({ names, colors }: { names: string[]; colors: readonly string[] }) {
  if (names.length < 2) return null
  return <div className="chart-legend">{names.map((n, i) => <span key={n}><i style={{ background: colors[i] }} />{n}</span>)}</div>
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart-table">
      <summary>Таблица</summary>
      <table><caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </details>
  )
}

export function Chart({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="chart-card">
      <header><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</header>
      {children}
    </section>
  )
}

/** Сгруппированные столбцы: группы по оси X (даты), серии — участки. Порог рисуется пунктиром с подписью. */
export function GroupedColumns({ title, groups, series, unit = '', target, height = 220, digits = 1 }: {
  title: string
  groups: { label: string; values: (number | null)[] }[]
  series: string[]
  unit?: string
  target?: { value: number; label: string }
  height?: number
  digits?: number
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const id = useId()
  const W = 640, H = height, L = 44, R = 12, T = 16, B = 30
  const plotW = W - L - R, plotH = H - T - B
  const max = nice(Math.max(target?.value ?? 0, ...groups.flatMap((g) => g.values.map((v) => v ?? 0))) * 1.08)
  const y = (v: number) => T + plotH - (v / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const band = plotW / Math.max(groups.length, 1)
  const barW = Math.min(24, (band - 12) / series.length - 2)
  const groupW = series.length * barW + (series.length - 1) * 2
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <Legend names={series} colors={SERIES} />
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id}>
          <title id={id}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
              <text x={L - 6} y={y(t) + 3} className="tick" textAnchor="end">{num(t, 0)}</text>
            </g>
          ))}
          {groups.map((g, gi) => {
            const x0 = L + gi * band + (band - groupW) / 2
            return (
              <g key={g.label}>
                {g.values.map((v, si) => {
                  if (v === null) return null
                  const x = x0 + si * (barW + 2)
                  return (
                    <path key={si} d={column(x, y(v), barW, plotH + T - y(v))} fill={SERIES[si]}
                      onMouseEnter={() => setTip({ left: ((x + barW / 2) / W) * 100, top: (y(v) / H) * 100, title: g.label, lines: [`${series[si]}: ${num(v, digits)}${unit}`] })} />
                  )
                })}
                <text x={x0 + groupW / 2} y={H - 9} className="tick" textAnchor="middle">{g.label}</text>
              </g>
            )
          })}
          {target && (
            <g>
              <line x1={L} x2={W - R} y1={y(target.value)} y2={y(target.value)} className="target" />
              <text x={W - R} y={y(target.value) - 5} className="tick" textAnchor="end">{target.label}</text>
            </g>
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView caption={title} head={['', ...series]} rows={groups.map((g) => [g.label, ...g.values.map((v) => (v === null ? '—' : `${num(v, digits)}${unit}`))])} />
    </div>
  )
}

/** Горизонтальные бары одной серии; значение у конца. highlight выделяет одну строку, остальные серые. */
export function Bars({ title, rows, unit = '', highlight, digits = 0, max: maxOverride }: {
  title: string
  rows: { label: string; value: number; note?: string }[]
  unit?: string
  highlight?: (row: { label: string; value: number }, index: number) => boolean
  digits?: number
  max?: number
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const id = useId()
  const W = 640, rowH = 30, L = 150, R = 70
  const H = Math.max(rows.length, 1) * rowH + 8
  const max = maxOverride ?? Math.max(1, ...rows.map((r) => r.value))
  const plotW = W - L - R
  return (
    <div className="chart" onMouseLeave={() => setTip(null)}>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={id}>
          <title id={id}>{title}</title>
          <line x1={L} x2={L} y1={4} y2={H - 4} className="axis" />
          {rows.map((r, i) => {
            const w = (r.value / max) * plotW
            const yy = 4 + i * rowH + (rowH - 18) / 2
            const color = highlight ? (highlight(r, i) ? ACCENT : GRAY) : SERIES[0]
            return (
              <g key={r.label} onMouseEnter={() => setTip({ left: ((L + w) / W) * 100, top: (yy / H) * 100, title: r.label, lines: [`${num(r.value, digits)}${unit}`, ...(r.note ? [r.note] : [])] })}>
                <text x={L - 8} y={yy + 13} className="label" textAnchor="end">{r.label}</text>
                <rect x={L} y={yy} width={Math.max(w, 2)} height={18} rx={4} fill={color} />
                <text x={L + w + 8} y={yy + 13} className="value">{num(r.value, digits)}{unit}</text>
              </g>
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <TableView caption={title} head={['', 'Значение']} rows={rows.map((r) => [r.label, `${num(r.value, digits)}${unit}`])} />
    </div>
  )
}

/** Отношение к пределу: заполнение и дорожка — светлая ступень того же синего. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="meter" role="img" aria-label={`${label}: ${num(pct, 0)}%`}>
      <span className="meter-track"><span className="meter-fill" style={{ width: `${pct}%` }} /></span>
      <small>{label}</small>
    </div>
  )
}
