import { useProductionFrame, useProductionEnabled } from '../../features/simulation/ProductionClock'
import { useMemo, useRef } from 'react'
import { Color, MeshBasicMaterial, MeshStandardMaterial, type Mesh } from 'three'
import { CAR_COLORS, MAT, unitBox, unitCyl } from '../core/assets'
import { Car, type CarHandle } from '../vehicles/Car'
import { pickModel, type CarModelId } from '../vehicles/carModels'
import { track } from '../vehicles/carUnits'
import { L } from '../core/geo'
import { Instanced } from './Hall'
import { Conveyor, ControlCabinets, PartsRacks } from './Industrial'
import { Label } from '../core/Label'
import { indexed, isDwelling, mod } from '../core/motion'
import { Robot } from './Robot'
import { Worker } from './Worker'
import { fenceTile } from '../core/surfaces'

/**
 * Цех сварки (ЦСК): у юго-западной стены, северо-западная половина корпуса — по
 * источникам 0001–0007 проекта НДВ. 4 линии, по одной на модель (nur.kz).
 * Кузов ≈90 деталей, ≈3 000 точек. Линия Onix — лазерная сварка крыши (Tengrinews, 2023).
 */
export const WELD_LINES = [
  { v: 68, model: 'Chevrolet Onix', note: 'лазерная сварка крыши', car: 'onix' },
  { v: 50, model: 'Chevrolet Cobalt', note: '', car: 'cobalt' },
  { v: 32, model: 'JAC J7', note: '', car: 'j7' },
  { v: 14, model: 'Мультимодельная', note: 'резерв / CKD', car: null },
] satisfies { v: number; model: string; note: string; car: CarModelId | null }[]
const U0 = 62 // первый пост
const PITCH = 10 // шаг постов, м
const SLOTS = 10 // 9 сварочных постов + рихтовка/геометрия
const PERIOD = 9 // такт демонстрации, с
const MOVE = 2.6 // время переезда, с

// Как на видео: жёлтые сетчатые ограждения ячеек, красные сварочные шторы лазерной ячейки.
const fenceMat = new MeshStandardMaterial({ color: '#f0c224', alphaMap: fenceTile(), alphaTest: 0.4, roughness: 0.55, metalness: 0.2 })
const laserCellMat = new MeshStandardMaterial({ color: '#c8402a', transparent: true, opacity: 0.6, roughness: 0.5, depthWrite: false })
const laserWindow = new MeshBasicMaterial({ color: new Color(1.1, 0.12, 0.08), toneMapped: false, transparent: true, opacity: 0.45, depthWrite: false })
const jigMat = new MeshStandardMaterial({ color: '#6f7d74', roughness: 0.6, metalness: 0.45 })
/** Посты с роботами; остальные — ручная контактная сварка подвесными клещами на балансирах (видео). */
const ROBOT_POSTS = new Set([2, 6])
const scanMat = new MeshBasicMaterial({ color: new Color(0.2, 3, 0.6), toneMapped: false })

function Line({ index, v, model, note, car }: { index: number; v: number; model: string; note: string; car: CarModelId | null }) {
  const simulated = useProductionEnabled()
  const offset = index * 2.1
  const cars = useRef<(CarHandle | null)[]>([])
  const laser = index === 0

  useProductionFrame(({ clock }) => {
    const step = indexed(clock.elapsedTime + offset, PERIOD, MOVE)
    cars.current.forEach((c, i) => {
      if (!c) return
      const s = mod(step + i, SLOTS)
      c.root.visible = s <= SLOTS - 1
      c.root.position.set(U0 + s * PITCH, 0.55, -v)
      track(c.root, Math.min(1, s / (SLOTS - 1)), Math.min(SLOTS, Math.round(s) + 1), Math.floor((step + i) / SLOTS))
    })
  })

  const dwell = (t: number) => isDwelling(t + offset, PERIOD, MOVE)
  const units = useMemo(() => Array.from({ length: SLOTS }, (_, i) => ({
    key: `welding:${index}:${i}`, place: 'welding' as const, model: car ?? pickModel(i), color: CAR_COLORS[(i + index) % 5], index: i, line: index,
  })), [car, index])

  const robots = useMemo(() => {
    const out: { u: number; side: 1 | -1; tool: 'gun' | 'laser' }[] = []
    for (let k = 0; k < SLOTS - 1; k++) {
      const u = U0 + k * PITCH
      const isLaser = laser && (k === 5 || k === 6)
      if (!isLaser && !ROBOT_POSTS.has(k)) continue
      const n = isLaser ? 2 : 1
      for (let j = 0; j < n; j++)
        for (const side of [1, -1] as const)
          out.push({ u: u + (n === 2 ? (j ? 2.2 : -2.2) : 0), side, tool: isLaser ? 'laser' : 'gun' })
    }
    return out
  }, [laser])
  const manual = useMemo(() => {
    const out: { u: number; side: 1 | -1 }[] = []
    for (let k = 0; k < SLOTS - 1; k++) {
      if (ROBOT_POSTS.has(k) || (laser && (k === 5 || k === 6))) continue
      for (const side of [1, -1] as const) out.push({ u: U0 + k * PITCH + (side === 1 ? 1.2 : -1.2), side })
    }
    return out
  }, [laser])

  const uEnd = U0 + (SLOTS - 1) * PITCH
  const fence = useMemo(
    () =>
      [1, -1].map((side) => ({
        p: [(U0 + uEnd) / 2 - 4, 1.1, -(v + side * 5.6)] as [number, number, number],
        s: [uEnd - U0 + 2, 2.2, 0.05] as [number, number, number],
      })),
    [v, uEnd],
  )
  const posts = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (const side of [1, -1]) for (let u = U0 - 5; u <= uEnd; u += 5)
      out.push({ p: [u, 1.1, -(v + side * 5.6)], s: [0.1, 2.2, 0.1] })
    return out
  }, [v, uEnd])
  // Верхний ярус линии, как на видео: три красные магистрали (сжатый воздух, вода охлаждения,
  // шинопровод), жёлтый монорельс с балансирами и свисающими кабелями сварочных клещей.
  const overhead = useMemo(() => {
    const len = uEnd - U0 + 8
    const cu = (U0 + uEnd) / 2
    const pipes = [7.2, 7.65, 8.1].map((h, i) => ({ p: [cu, h, -(v + 1.4 - i * 0.5)] as [number, number, number], s: [0.2, len, 0.2] as [number, number, number], rz: Math.PI / 2 }))
    const yellow: { p: [number, number, number]; s: [number, number, number] }[] = []
    const dark: { p: [number, number, number]; s: [number, number, number] }[] = []
    const jigs: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (const side of [1, -1]) {
      yellow.push({ p: [cu, 4.9, -(v + side * 2.6)], s: [len, 0.32, 0.36] })
      for (let u = U0 - 4; u <= uEnd + 4; u += PITCH) {
        yellow.push({ p: [u, 2.45, -(v + side * 5.4)], s: [0.22, 4.9, 0.22] })
        yellow.push({ p: [u, 4.9, -(v + side * 4)], s: [0.22, 0.26, 3] })
      }
    }
    for (const m of manual) {
      const z = -(v + m.side * 2.6)
      yellow.push({ p: [m.u, 4.45, z], s: [0.5, 0.55, 0.4] })
      dark.push({ p: [m.u, 2.9, z], s: [0.05, 2.6, 0.05] })
      dark.push({ p: [m.u, 1.45, z + m.side * 0.1], s: [0.32, 0.5, 0.22] })
    }
    for (let k = 0; k < SLOTS - 1; k++) {
      const u = U0 + k * PITCH
      jigs.push({ p: [u, 0.25, -v], s: [4.6, 0.5, 2.3] })
      for (const side of [1, -1]) jigs.push({ p: [u, 0.95, -(v + side * 1.35)], s: [3.8, 0.9, 0.25] })
    }
    return { pipes, yellow, dark, jigs }
  }, [v, uEnd, manual])

  return (
    <group>
      <Conveyor length={uEnd - U0 + 6} width={1.8} height={0.5} rollers position={[(U0 + uEnd) / 2, 0, -v]} />
      <ControlCabinets positions={[U0 + 12, U0 + 42, U0 + 72].map((u) => [u, 0, -v + 6.5])} />
      <Instanced geometry={unitBox} material={fenceMat} items={fence} />
      <Instanced geometry={unitBox} material={MAT.yellow} items={posts} />
      <Instanced geometry={unitCyl} material={MAT.redPipe} items={overhead.pipes} />
      <Instanced geometry={unitBox} material={MAT.yellowStruct} items={overhead.yellow} />
      <Instanced geometry={unitBox} material={MAT.cable} items={overhead.dark} />
      <Instanced geometry={unitBox} material={jigMat} items={overhead.jigs} />
      {manual.map((m, i) => (
        <Worker key={i} position={[m.u, 0, -(v + m.side * 2.2)]} yaw={m.side === 1 ? Math.PI / 2 : -Math.PI / 2} phase={i * 0.7 + index} />
      ))}

      {!simulated && Array.from({ length: SLOTS }, (_, i) => (
        <Car key={i} ref={(c) => void (cars.current[i] = c)} model={car ?? pickModel(i)} unit={units[i]} />
      ))}

      {robots.map((r, i) => (
        <Robot
          key={i}
          position={[r.u, 0, -(v + r.side * 3.1)]}
          yaw={r.side === 1 ? -Math.PI / 2 : Math.PI / 2}
          tool={r.tool}
          phase={i * 0.7}
          speed={r.tool === 'laser' ? 0.6 : 1.4}
          active={dwell}
        />
      ))}

      {laser && (
        <group position={[U0 + 5.5 * PITCH, 0, -v]}>
          {/* ячейка лазерной сварки за красными сварочными шторами (видео) */}
          <mesh geometry={unitBox} material={laserCellMat} scale={[22, 3.6, 0.1]} position={[0, 1.9, 5.4]} />
          <mesh geometry={unitBox} material={laserCellMat} scale={[22, 3.6, 0.1]} position={[0, 1.9, -5.4]} />
          <mesh geometry={unitBox} material={MAT.steel} scale={[22.4, 0.12, 0.12]} position={[0, 3.75, 5.4]} />
          <mesh geometry={unitBox} material={MAT.steel} scale={[22.4, 0.12, 0.12]} position={[0, 3.75, -5.4]} />
          <mesh geometry={unitBox} material={laserWindow} scale={[16, 0.6, 0.12]} position={[0, 2.4, 5.45]} />
          <mesh geometry={unitBox} material={laserWindow} scale={[16, 0.6, 0.12]} position={[0, 2.4, -5.45]} />
        </group>
      )}

      {/* рихтовка и лазерный контроль геометрии */}
      <group position={[uEnd, 0, -v]}>
        <mesh geometry={unitBox} material={MAT.steel} scale={[0.35, 3.6, 0.35]} position={[0, 1.8, 2.6]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[0.35, 3.6, 0.35]} position={[0, 1.8, -2.6]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[0.5, 0.4, 5.6]} position={[0, 3.6, 0]} />
        <Scanner />
        <Worker position={[1.8, 0, 2.3]} yaw={Math.PI} phase={index} />
      </group>

      {/* пост загрузки основания кузова */}
      <Worker position={[U0 - 1, 0, -(v + 2.6)]} yaw={-Math.PI / 2} phase={index * 3} />
      <PartsRacks width={2.4} positions={[[U0 - 3, 0, -(v + 4)]]} />

      <Label position={[U0 - 6, 5, -v]} color="#ff8a3d" small>
        Линия {index + 1} · {model}
        {note && <em> · {note}</em>}
      </Label>
    </group>
  )
}

function Scanner() {
  const ref = useRef<Mesh>(null!)
  useProductionFrame(({ clock }) => {
    ref.current.position.y = 1.9 + Math.sin(clock.elapsedTime * 2.2) * 0.9
  })
  return <mesh ref={ref} geometry={unitBox} material={scanMat} scale={[0.04, 0.04, 4.8]} />
}

export function Welding() {
  return (
    <group>
      {WELD_LINES.map((l, i) => (
        <Line key={l.v} index={i} {...l} />
      ))}
    </group>
  )
}
