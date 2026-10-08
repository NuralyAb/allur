import { useEffect, useMemo, useRef, useState } from 'react'
import { api, clock, fmt, type ParamDef } from '../features/scada/scada'

const H = 168
const PAD = { top: 10, right: 52, bottom: 22, left: 44 }
const LIMIT_LABEL: Record<string, string> = { hihi: 'ВВ', hi: 'В', lo: 'Н', lolo: 'НН' }

function ticks(min: number, max: number, count = 4) {
  const span = max - min || 1
  const step0 = span / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

/** Тренд параметра: факт (линия), уставка (ступенчатая линия), пределы тревог, перекрестие с подсказкой. */
export function Trend({ cid, param, minutes, live, liveSp, now }: { cid: string; param: ParamDef; minutes: number; live: number | null; liveSp: number | null; now: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  const [data, setData] = useState<{ pv: [number, number][]; sp: [number, number][] } | null>(null)
  const [error, setError] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const pvKey = `${cid}/Status.Parameter.${param.id}`
  const spKey = `${cid}/Status.Setpoint.${param.id}`

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    setData(null)
    const load = () => api.history(param.sp ? [pvKey, spKey] : [pvKey], minutes)
      .then((r) => { if (alive) { setData({ pv: r.series[pvKey] ?? [], sp: r.series[spKey] ?? [] }); setError(false) } }, () => alive && setError(true))
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [pvKey, spKey, minutes, param.sp])

  const model = useMemo(() => {
    if (!data) return null
    const t1 = now
    const t0 = now - minutes * 60
    const pv = data.pv.filter(([t]) => t >= t0)
    if (live !== null) pv.push([t1, live])
    const sp = data.sp.filter(([t]) => t >= t0)
    if (param.sp && liveSp !== null) sp.push([t1, liveSp])
    const limits = Object.entries(param.alarms).filter(([k]) => k !== 'dev') as [string, number][]
    const values = [...pv.map((p) => p[1]), ...sp.map((p) => p[1])]
    if (!values.length) return { pv, sp, limits: [], x: () => 0, y: () => 0, yTicks: [], xTicks: [], t0, t1 }
    let lo = Math.min(...values)
    let hi = Math.max(...values)
    // пределы видны, если они рядом с данными: не сжимаем тренд ради далёкой уставки тревоги
    const span0 = Math.max(hi - lo, (param.range[1] - param.range[0]) * 0.04)
    const near = limits.filter(([, v]) => v >= lo - span0 * 1.5 && v <= hi + span0 * 1.5)
    lo = Math.min(lo, ...near.map(([, v]) => v))
    hi = Math.max(hi, ...near.map(([, v]) => v))
    const pad = Math.max((hi - lo) * 0.12, (param.range[1] - param.range[0]) * 0.01)
    lo -= pad
    hi += pad
    const w = width - PAD.left - PAD.right
    const h = H - PAD.top - PAD.bottom
    const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * w
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * h
    const step = minutes <= 15 ? 300 : minutes <= 60 ? 900 : 3600
    const xTicks = []
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) xTicks.push(t)
    return { pv, sp, limits: near, x, y, yTicks: ticks(lo, hi), xTicks, t0, t1 }
  }, [data, live, liveSp, now, minutes, param, width])

  const pvPath = model?.pv.map(([t, v], i) => `${i ? 'L' : 'M'}${model.x(t).toFixed(1)},${model.y(v).toFixed(1)}`).join('') ?? ''
  // уставка держится до следующего изменения — ступенька, а не наклонная линия
  const spPath = model?.sp.map(([t, v], i) => i ? `H${model.x(t).toFixed(1)}V${model.y(v).toFixed(1)}` : `M${model.x(t).toFixed(1)},${model.y(v).toFixed(1)}`).join('') ?? ''
  const spAt = (t: number) => {
    let v: number | null = null
    for (const [ts, val] of model?.sp ?? []) { if (ts <= t) v = val; else break }
    return v
  }
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!model || !model.pv.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left + PAD.left
    let best = 0
    model.pv.forEach(([t], i) => { if (Math.abs(model.x(t) - px) < Math.abs(model.x(model.pv[best][0]) - px)) best = i })
    setHover(best)
  }
  const point = hover !== null && model ? model.pv[hover] : null
  const last = model?.pv[model.pv.length - 1]
  const summary = model?.pv.length
    ? `${param.name}: сейчас ${fmt(last![1], param.decimals)} ${param.unit}, за ${minutes} мин от ${fmt(Math.min(...model.pv.map((p) => p[1])), param.decimals)} до ${fmt(Math.max(...model.pv.map((p) => p[1])), param.decimals)}`
    : `${param.name}: нет данных`

  return (
    <div className="trend" ref={box}>
      <div className="trend-legend" aria-hidden="true">
        <span><i className="key key-pv" />Факт</span>
        {param.sp && <span><i className="key key-sp" />Уставка</span>}
        {model && model.limits.length > 0 && <span><i className="key key-limit" />Пределы тревог</span>}
      </div>
      {error && <p className="trend-empty">История недоступна</p>}
      {!error && !model && <p className="trend-empty">Загрузка истории…</p>}
      {model && (
        <svg width={width} height={H} role="img" aria-label={summary} onPointerLeave={() => setHover(null)}>
          {model.yTicks.map((v) => <g key={v}>
            <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={model.y(v)} y2={model.y(v)} />
            <text className="tick" x={PAD.left - 6} y={model.y(v) + 3} textAnchor="end">{fmt(v, Math.max(0, param.decimals - 1))}</text>
          </g>)}
          {model.xTicks.map((t) => <text key={t} className="tick" x={model.x(t)} y={H - 6} textAnchor="middle">{clock(t).slice(0, 5)}</text>)}
          {model.limits.map(([k, v]) => <g key={k}>
            <line className="limit" x1={PAD.left} x2={width - PAD.right} y1={model.y(v)} y2={model.y(v)} />
            <text className="tick" x={width - PAD.right + 4} y={model.y(v) + 3}>{LIMIT_LABEL[k]} {fmt(v, 0)}</text>
          </g>)}
          {spPath && <path className="line-sp" d={spPath} />}
          <path className="line-pv" d={pvPath} />
          {last && <>
            <circle className="end-dot" cx={model.x(last[0])} cy={model.y(last[1])} r={4} />
            {!model.limits.some(([, v]) => Math.abs(model.y(v) - model.y(last[1])) < 10) && <text className="end-label" x={width - PAD.right + 4} y={model.y(last[1]) + 4}>{fmt(last[1], param.decimals)}</text>}
          </>}
          {point && <>
            <line className="crosshair" x1={model.x(point[0])} x2={model.x(point[0])} y1={PAD.top} y2={H - PAD.bottom} />
            <circle className="end-dot" cx={model.x(point[0])} cy={model.y(point[1])} r={4} />
          </>}
          <rect className="hit" x={PAD.left} y={PAD.top} width={Math.max(0, width - PAD.left - PAD.right)} height={H - PAD.top - PAD.bottom} onPointerMove={onMove} onPointerDown={onMove} />
        </svg>
      )}
      {point && model && (
        <div className="trend-tip" style={{ left: Math.min(width - 150, Math.max(0, model.x(point[0]) + 10)) }}>
          <span>{clock(point[0])}</span>
          <div><i className="key key-pv" /><strong>{fmt(point[1], param.decimals)} {param.unit}</strong> факт</div>
          {param.sp && spAt(point[0]) !== null && <div><i className="key key-sp" /><strong>{fmt(spAt(point[0]), param.decimals)} {param.unit}</strong> уставка</div>}
        </div>
      )}
    </div>
  )
}
