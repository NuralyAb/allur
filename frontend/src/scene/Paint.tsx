import { useProductionFrame, useProductionEnabled } from '../simulation/ProductionClock'
import { useMemo, useRef } from 'react'
import { Color, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { CAR_COLORS, MAT, paint, unitBox } from './assets'
import { Car, type CarHandle } from './Car'
import { pickModel } from './carModels'
import { track } from './carUnits'
import { Instanced } from './Hall'
import { Conveyor, ControlCabinets, type IndustrialItem } from './Industrial'
import { Label } from './Label'
import { makePath, mod, placeOnPath, type P3 } from './motion'
import { Robot } from './Robot'
import { Worker } from './Worker'

/*
 * Цех окраски кузовов (ЦОК). Положение — по источникам 0013–0022 проекта НДВ (печи ED, УГД,
 * USB, вторичного грунта, базы и лака): юго-восточная часть корпуса. Ниже цех описан в
 * собственной системе (проходы вдоль оси a), а в корпус ставится поворотом на 90° — см. Paint().
 * Проход 1 — подготовка поверхности в 13 ваннах окунанием,
 * 10-я ванна — катодное электроосаждение грунта (nur.kz). Проход 2 — печь
 * катафореза и герметизация швов. Проход 3 — кабины грунта, базы и лака (роботы).
 * Проход 4 — печь финишной сушки, выход в буфер окрашенных кузовов.
 */

const TANK_C0 = 171.5
const TANK_PITCH = 7
const TANKS = Array.from({ length: 13 }, (_, k) => TANK_C0 + k * TANK_PITCH)
const KTL = 9 // индекс 10-й ванны
const LIQUID = ['#cfd9c9', '#cfd9c9', '#9fc5e3', '#9fc5e3', '#b9d3cf', '#c9d6b6', '#9fc5e3', '#b5c9d9', '#a8d1ec', '#2b2f35', '#9db3c7', '#9db3c7', '#a8d1ec']

const V1 = 212
const V2 = 196
const V3 = 180
const V4 = 164
const SPACING = 7.5
const SPEED = 0.9 // м/с

export const PATH: P3[] = [
  [160, 2.6, -V1],
  [264, 2.6, -V1],
  [264, 0.55, -V2],
  [166, 0.55, -V2],
  [166, 0.55, -V3],
  [262, 0.55, -V3],
  [262, 0.55, -V4],
  [150, 0.55, -V4],
]

// участки прохода 3 (u)
const PRIMER = [172, 190] as const
const BASE = [198, 226] as const
const CLEAR = [232, 252] as const

const liquidMats = LIQUID.map((c, i) =>
  i === KTL ? paint(c, 0.3, 0.25) : new MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.1 }),
)
const boothGlass = new MeshStandardMaterial({ color: '#cfe3f1', transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false })
const boothLight = new MeshBasicMaterial({ color: new Color(1.15, 1.15, 1.1), toneMapped: false })
const ovenGlow = new MeshBasicMaterial({ color: new Color(1.2, 0.55, 0.22), toneMapped: false })
const ovenSkin = paint('#c3c8cd', 0.85, 0.3)

function dip(u: number) {
  let y = 0
  for (const c of TANKS) {
    const d = Math.abs(u - c)
    if (d < 2.8) y = Math.min(y, -3.4 * (Math.cos((d / 2.8) * Math.PI) + 1) * 0.5)
  }
  return y
}

function Bodies() {
  const path = useMemo(() => makePath(PATH, 3.5), [])
  const length = useMemo(() => path.getLength(), [path])
  const count = Math.floor(length / SPACING)
  const cars = useRef<(CarHandle | null)[]>([])
  const units = useMemo(() => Array.from({ length: count }, (_, i) => ({
    key: `paint:${i}`, place: 'paint' as const, model: pickModel(i), color: CAR_COLORS[i % 5], index: i,
  })), [count])

  useProductionFrame(({ clock }) => {
    const t = clock.elapsedTime
    cars.current.forEach((c, i) => {
      if (!c) return
      const travel = t * SPEED + i * SPACING
      const dist = mod(travel, count * SPACING)
      const p = placeOnPath(path, length, dist, c.root)
      const pass1 = Math.abs(p.z + V1) < 0.5 && p.y > 2
      const pass3 = Math.abs(p.z + V3) < 0.5
      const u = p.x
      // номер операции для карточки машины — см. PAINT_STATIONS в ui/carPassport.ts
      let station = 0
      if (pass1) {
        const y = dip(u)
        c.root.position.y += y
        c.root.rotation.z = (dip(u + 0.4) - dip(u - 0.4)) * 0.6
        c.setBody(u > TANKS[KTL] ? MAT.ed : MAT.biw)
        station = u < TANKS[KTL] - 3 ? 1 : u <= TANKS[KTL] + 3 ? 2 : 3
      } else if (pass3) {
        c.setBody(u < PRIMER[1] - 4 ? MAT.ed : u < BASE[0] + 12 ? MAT.primer : paint(CAR_COLORS[i % 5]))
        station = u >= PRIMER[0] && u <= PRIMER[1] ? 6 : u >= BASE[0] && u <= BASE[1] ? 7 : u >= CLEAR[0] && u <= CLEAR[1] ? 8 : 0
      } else if (Math.abs(p.z + V2) < 0.5) {
        c.setBody(MAT.ed)
        station = u >= 205 && u <= 258 ? 4 : 5
      } else if (Math.abs(p.z + V4) < 0.5) {
        c.setBody(paint(CAR_COLORS[i % 5]))
        station = u >= 176 && u <= 254 ? 9 : 10
      }
      track(c.root, dist / (count * SPACING), station, Math.floor(travel / (count * SPACING)))
    })
  })

  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <Car key={i} ref={(c) => void (cars.current[i] = c)} model={pickModel(i)} unit={units[i]} />
      ))}
    </group>
  )
}

function Tanks() {
  const details = useMemo(() => {
    const steel: IndustrialItem[] = []
    const safety: IndustrialItem[] = []
    TANKS.forEach((c) => {
      for (const side of [-1, 1]) {
        steel.push({ p: [c, 1.32, -V1 + side * 1.9], s: [6.25, 0.08, 0.35] })
        steel.push({ p: [c, 0.4, -V1 + side * 2.75], s: [6.6, 0.1, 1.1] })
        for (const dx of [-3, 0, 3]) {
          steel.push({ p: [c + dx, 0.65, -V1 + side * 2.06], s: [0.08, 1.3, 0.05] })
          safety.push({ p: [c + dx, 0.94, -V1 + side * 3.25], s: [0.06, 1.12, 0.06] })
        }
        for (const y of [0.9, 1.45]) safety.push({ p: [c, y, -V1 + side * 3.25], s: [6.8, 0.055, 0.055] })
      }
    })
    return { steel, safety }
  }, [])
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.steel} items={details.steel} />
      <Instanced geometry={unitBox} material={paint('#bea267', 0.3, 0.5)} items={details.safety} />
      {TANKS.map((c, k) => (
        <group key={k} position={[c, 0, -V1]}>
          {/* борта ванны */}
          <mesh geometry={unitBox} material={MAT.concrete} scale={[6.2, 1.3, 0.3]} position={[0, 0.65, 1.9]} />
          <mesh geometry={unitBox} material={MAT.concrete} scale={[6.2, 1.3, 0.3]} position={[0, 0.65, -1.9]} />
          <mesh geometry={unitBox} material={MAT.concrete} scale={[0.3, 1.3, 4.1]} position={[3.1, 0.65, 0]} />
          <mesh geometry={unitBox} material={MAT.concrete} scale={[0.3, 1.3, 4.1]} position={[-3.1, 0.65, 0]} />
          <mesh geometry={unitBox} material={liquidMats[k]} scale={[5.9, 0.05, 3.5]} position={[0, 1.05, 0]} />
          {k === KTL && (
            <>
              <mesh geometry={unitBox} material={MAT.yellow} scale={[6.4, 0.12, 0.12]} position={[0, 1.35, 2.05]} />
              <Label position={[0, 3.2, 3.5]} color="#22c3a6" small>
                Ванна №10 · катафорез
              </Label>
            </>
          )}
        </group>
      ))}
      <Label position={[TANKS[0] - 1, 3.4, -(V1 + 4)]} color="#22c3a6" small>
        Подготовка поверхности · 13 ванн
      </Label>
      {/* монорельс окунания */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[106, 0.4, 0.3]} position={[212, 5.6, -V1]} />
      {[165, 190, 215, 240, 262].map((u) => (
        <group key={u}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.3, 5.6, 0.3]} position={[u, 2.8, -(V1 + 2.4)]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.3, 5.6, 0.3]} position={[u, 2.8, -(V1 - 2.4)]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.3, 0.3, 5]} position={[u, 5.6, -V1]} />
        </group>
      ))}
    </group>
  )
}

function Oven({ u0, u1, v, label }: { u0: number; u1: number; v: number; label: string }) {
  const len = u1 - u0
  const c = (u0 + u1) / 2
  return (
    <group position={[c, 0, -v]}>
      <mesh geometry={unitBox} material={ovenSkin} scale={[len, 3.4, 0.3]} position={[0, 1.7, 2.3]} />
      <mesh geometry={unitBox} material={ovenSkin} scale={[len, 3.4, 0.3]} position={[0, 1.7, -2.3]} />
      <mesh geometry={unitBox} material={ovenSkin} scale={[len, 0.3, 4.9]} position={[0, 3.4, 0]} />
      <mesh geometry={unitBox} material={ovenGlow} scale={[len - 1, 0.1, 0.1]} position={[0, 3.6, 2.2]} />
      <mesh geometry={unitBox} material={ovenGlow} scale={[len - 1, 0.1, 0.1]} position={[0, 3.6, -2.2]} />
      {/* вытяжные трубы */}
      {[-len / 3, 0, len / 3].map((x) => (
        <mesh key={x} geometry={unitBox} material={ovenSkin} scale={[0.9, 6, 0.9]} position={[x, 6.4, 0]} />
      ))}
      <Label position={[0, 5, 0]} color="#ff9b3d" small>
        {label}
      </Label>
    </group>
  )
}

function Booth({ u0, u1, label, robotsPerSide }: { u0: number; u1: number; label: string; robotsPerSide: number }) {
  const len = u1 - u0
  const c = (u0 + u1) / 2
  const step = len / robotsPerSide
  return (
    <group position={[c, 0, -V3]}>
      <mesh geometry={unitBox} material={boothGlass} scale={[len, 4.6, 0.08]} position={[0, 2.3, 4.2]} />
      <mesh geometry={unitBox} material={boothGlass} scale={[len, 4.6, 0.08]} position={[0, 2.3, -4.2]} />
      {/* потолок кабины — фильтры приточной вентиляции, прозрачный для обзора */}
      <mesh geometry={unitBox} material={boothGlass} scale={[len, 0.1, 8.6]} position={[0, 4.7, 0]} />
      <mesh geometry={unitBox} material={MAT.steel} scale={[len, 0.25, 0.25]} position={[0, 4.7, 4.2]} />
      <mesh geometry={unitBox} material={MAT.steel} scale={[len, 0.25, 0.25]} position={[0, 4.7, -4.2]} />
      <mesh geometry={unitBox} material={boothLight} scale={[len - 1, 0.06, 0.25]} position={[0, 4.55, 2.4]} />
      <mesh geometry={unitBox} material={boothLight} scale={[len - 1, 0.06, 0.25]} position={[0, 4.55, -2.4]} />
      <Instanced geometry={unitBox} material={MAT.wall} items={Array.from({ length: Math.ceil(len / 3) + 1 }, (_, i) => -len / 2 + i * len / Math.ceil(len / 3)).flatMap((x) => [
        { p: [x, 2.35, 4.2] as [number, number, number], s: [0.12, 4.7, 0.18] as [number, number, number] },
        { p: [x, 2.35, -4.2] as [number, number, number], s: [0.12, 4.7, 0.18] as [number, number, number] },
        { p: [x, 4.7, 0] as [number, number, number], s: [0.12, 0.18, 8.5] as [number, number, number] },
      ])} />
      {/* решётчатый пол кабины */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[len, 0.1, 8.3]} position={[0, 0.06, 0]} />
      {Array.from({ length: robotsPerSide }, (_, i) =>
        ([1, -1] as const).map((side) => (
          <Robot
            key={`${i}${side}`}
            position={[-len / 2 + step * (i + 0.5), 0.6, side * 3]}
            yaw={side === 1 ? Math.PI / 2 : -Math.PI / 2}
            tool="spray"
            material={MAT.wall}
            phase={i * 1.3 + side}
            speed={0.9}
            scale={0.85}
          />
        )),
      )}
      <Label position={[0, 6.2, 0]} color="#22c3a6" small>
        {label}
      </Label>
    </group>
  )
}

/** Перегородки цеха окраски — отдельная «чистая» зона. */
function Enclosure() {
  const items = useMemo(
    () => [
      { p: [213, 3, -158] as [number, number, number], s: [110, 6, 0.12] as [number, number, number] },
      { p: [213, 3, -222] as [number, number, number], s: [110, 6, 0.12] as [number, number, number] },
      // проём для выхода кузовов в буфер на проходе V4
      { p: [158, 3, -196] as [number, number, number], s: [0.12, 6, 52] as [number, number, number] },
      { p: [268, 3, -190] as [number, number, number], s: [0.12, 6, 64] as [number, number, number] },
    ],
    [],
  )
  return <Instanced geometry={unitBox} material={boothGlass} items={items} />
}

/** Перевод собственной системы цеха в корпус: a → v = a − 66, проход p → u = 470 − p. */
export function Paint() {
  const simulated = useProductionEnabled()
  return (
    <group position={[470, 0, 66]} rotation={[0, Math.PI / 2, 0]}>
      <Enclosure />
      <Tanks />
      {[V2, V3, V4].map((v) => <Conveyor key={v} length={102} width={2.8} height={0.5} position={[213, 0, -v]} rollers />)}
      <ControlCabinets positions={[[174, 0, -172], [197, 0, -172], [229, 0, -172], [255, 0, -172]]} />
      <Oven u0={205} u1={258} v={V2} label="Печь сушки катафореза" />
      <Oven u0={176} u1={254} v={V4} label="Печь финишной сушки" />
      {/* герметизация швов */}
      {[174, 184, 194].map((u, i) => (
        <group key={u}>
          <Worker position={[u, 0, -(V2 + 2.6)]} yaw={Math.PI / 2} phase={i} />
          <Worker position={[u + 3, 0, -(V2 - 2.6)]} yaw={-Math.PI / 2} phase={i + 2} />
        </group>
      ))}
      <Label position={[184, 4, -V2]} color="#22c3a6" small>
        Герметизация швов
      </Label>
      <Booth u0={PRIMER[0]} u1={PRIMER[1]} label="Кабина грунта" robotsPerSide={2} />
      <Booth u0={BASE[0]} u1={BASE[1]} label="Кабина базовой эмали" robotsPerSide={3} />
      <Booth u0={CLEAR[0]} u1={CLEAR[1]} label="Кабина лака" robotsPerSide={2} />
      {!simulated && <Bodies />}
    </group>
  )
}
