import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group, type Mesh } from 'three'
import { CAR_COLORS, MAT, paint, unitBox, wheelGeo } from '../core/assets'
import { Instanced } from './Hall'
import { PartsRacks, type IndustrialItem } from './Industrial'
import { Label } from '../core/Label'
import { makePath, mod, placeOnPath, type P3 } from '../core/motion'
import { pickModel } from '../vehicles/carModels'
import { ParkedCars, type ParkedCar } from '../vehicles/ParkedCars'
import { Robot } from './Robot'
import { Worker } from './Worker'

type Item = { p: [number, number, number]; s: [number, number, number] }

const forkliftMat = paint('#c9a24f', 0.2, 0.5)
const containerMat = paint('#506d7c', 0.4, 0.55)
const cabMat = paint('#e9ecef', 0.3, 0.4)
const bumperMats = { raw: paint('#2b2d31', 0, 0.8), done: CAR_COLORS.map((c) => paint(c)) }
const boothGlass = new MeshStandardMaterial({ color: '#cfe3f1', transparent: true, opacity: 0.22, depthWrite: false })

/*
 * Склад CKD-комплектов — пристройка вдоль северо-восточной стены (u 60–200, v 195–227),
 * доки смотрят на контейнерный терминал. Описан в собственной системе: x — вглубь от доков,
 * z — вдоль стены; в корпус ставится поворотом (см. Warehouse).
 */

const RACK_ROWS = [9, 14.2, 25, 30.2] // пары стеллажей спина к спине
const AISLES = [4.5, 19.6]
const BAY = 2.8
const LEVELS = [0.15, 2.25, 4.35, 6.45]

function Racks() {
  const { uprights, beams, boxes, pallets, straps } = useMemo(() => {
    const uprights: Item[] = []
    const beams: Item[] = []
    const boxes: Item[] = []
    const pallets: Item[] = []
    const straps: Item[] = []
    for (const u of RACK_ROWS) {
      for (let v = 14; v <= 150; v += BAY) {
        for (const side of [-1, 1]) {
          uprights.push({ p: [u + side * 0.52, 4, -v], s: [0.1, 8, 0.12] })
          uprights.push({ p: [u + side * 0.52, 0.04, -v], s: [0.24, 0.08, 0.28] })
        }
        for (const y of [0.3, 2.1, 4.2, 6.3, 7.8]) uprights.push({ p: [u, y, -v], s: [1.1, 0.07, 0.06] })
        if (v + BAY > 150) continue
        for (const [li, y] of LEVELS.entries()) {
          for (const side of [-1, 1]) beams.push({ p: [u + side * 0.5, y - 0.08, -(v + BAY / 2)], s: [0.09, 0.14, BAY] })
          // заполненность ~80%, детерминированно
          if ((Math.sin(u * 7.1 + v * 3.3 + li * 11.7) + 1) / 2 < 0.8) {
            for (const dz of [-0.62, 0.62]) {
              boxes.push({ p: [u, y + 0.68, -(v + BAY / 2) + dz], s: [0.95, 1.02, 1.08] })
              pallets.push({ p: [u, y + 0.1, -(v + BAY / 2) + dz], s: [1.05, 0.14, 1.15] })
              straps.push({ p: [u, y + 1.2, -(v + BAY / 2) + dz], s: [0.96, 0.02, 0.055] })
              for (const side of [-1, 1]) straps.push({ p: [u + side * 0.48, y + 0.68, -(v + BAY / 2) + dz], s: [0.012, 1.03, 0.055] })
            }
          }
        }
      }
    }
    return { uprights, beams, boxes, pallets, straps }
  }, [])
  return (
    <group>
      <Instanced geometry={unitBox} material={paint('#566a76', 0.5, 0.52)} items={uprights} />
      <Instanced geometry={unitBox} material={paint('#b69659', 0.3, 0.55)} items={beams} />
      <Instanced geometry={unitBox} material={MAT.carton} items={boxes} />
      <Instanced geometry={unitBox} material={paint('#806f58', 0, 0.88)} items={pallets} />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={straps} />
    </group>
  )
}

function Forklift({ u, v0, v1, phase }: { u: number; v0: number; v1: number; phase: number }) {
  const ref = useRef<Group>(null!)
  const forks = useRef<Group>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 0.12 + phase
    const k = (Math.sin(t) + 1) / 2
    ref.current.position.set(u, 0, -(v0 + (v1 - v0) * k))
    ref.current.rotation.y = Math.cos(t) > 0 ? Math.PI / 2 : -Math.PI / 2
    forks.current.position.y = 0.2 + (Math.sin(t * 3) + 1) * 1.6
  })
  return (
    <group ref={ref}>
      <mesh geometry={unitBox} material={forkliftMat} scale={[1.85, 0.72, 1.15]} position={[-0.3, 0.72, 0]} castShadow />
      <mesh geometry={unitBox} material={forkliftMat} scale={[0.5, 0.45, 1.1]} position={[-1, 1.14, 0]} />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={[
        ...[-0.7, 0.45].flatMap((x) => [-0.55, 0.55].map((z) => ({ p: [x, 1.83, z] as [number, number, number], s: [0.075, 1.9, 0.075] as [number, number, number] }))),
        { p: [-0.13, 2.76, 0], s: [1.32, 0.1, 1.24] },
        { p: [-0.35, 1.15, 0], s: [0.55, 0.13, 0.55] },
        { p: [-0.62, 1.42, 0], s: [0.13, 0.48, 0.55] },
        { p: [0.25, 1.4, 0], s: [0.08, 0.5, 0.1] },
        { p: [0.27, 1.67, 0], s: [0.32, 0.055, 0.32] },
        ...[-0.4, 0.4].map((z) => ({ p: [0.85, 1.8, z] as [number, number, number], s: [0.14, 3.6, 0.14] as [number, number, number] })),
        { p: [0.85, 3.54, 0], s: [0.14, 0.12, 0.93] },
      ]} />
      <Instanced geometry={wheelGeo} material={MAT.tyre} items={[-0.85, 0.55].flatMap((x) => [-0.59, 0.59].map((z) => ({ p: [x, 0.32, z] as [number, number, number], s: [1, 1, 1] as [number, number, number] })))} />
      <Instanced geometry={wheelGeo} material={MAT.steel} items={[-0.85, 0.55].flatMap((x) => [-0.71, 0.71].map((z) => ({ p: [x, 0.32, z] as [number, number, number], s: [0.52, 0.52, 0.1] as [number, number, number] })))} />
      <group ref={forks}>
        <Instanced geometry={unitBox} material={MAT.steel} items={[
          { p: [0.99, 0.4, 0], s: [0.13, 0.8, 1.0] },
          ...[-0.32, 0.32].map((z) => ({ p: [1.58, 0, z] as [number, number, number], s: [1.3, 0.06, 0.15] as [number, number, number] })),
        ]} />
        <mesh geometry={unitBox} material={MAT.carton} scale={[1.0, 0.8, 0.92]} position={[1.55, 0.54, 0]} />
        <mesh geometry={unitBox} material={paint('#897353', 0, 0.9)} scale={[1.15, 0.12, 1.05]} position={[1.55, 0.08, 0]} />
      </group>
    </group>
  )
}

/** Контейнерный тягач у докового шлюза (снаружи стены, x < 0). */
function DockTruck({ v }: { v: number }) {
  return (
    <group position={[-10.5, 0, -v]}>
      <mesh geometry={unitBox} material={containerMat} scale={[12.2, 2.6, 2.45]} position={[2, 2.6, 0]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[12.6, 0.3, 2.4]} position={[2, 1.15, 0]} />
      <mesh geometry={unitBox} material={cabMat} scale={[2.3, 2.9, 2.45]} position={[-5.4, 1.9, 0]} />
      <mesh geometry={unitBox} material={MAT.glass} scale={[0.035, 0.96, 2.16]} position={[-6.57, 2.58, 0]} />
      <Instanced geometry={unitBox} material={MAT.glass} items={[-1, 1].map((side) => ({ p: [-5.53, 2.66, side * 1.236] as [number, number, number], s: [1.38, 0.78, 0.025] as [number, number, number] }))} />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={[
        { p: [-6.61, 1.05, 0], s: [0.15, 0.27, 2.5] },
        { p: [-6.59, 1.58, 0], s: [0.045, 0.55, 1.45] },
        ...[-1, 1].map((side) => ({ p: [-5.0, 0.62, side * 1.08] as [number, number, number], s: [1.1, 0.16, 0.4] as [number, number, number] })),
      ]} />
      <Instanced geometry={unitBox} material={MAT.wall} items={[-0.9, 0.9].map((z) => ({ p: [-6.64, 1.35, z] as [number, number, number], s: [0.04, 0.2, 0.36] as [number, number, number] }))} />
      <Instanced geometry={wheelGeo} material={MAT.tyre} items={[-5.45, -2.7, 5.3, 6.5, 7.6].flatMap((x) => [-1.18, 1.18].map((z) => ({ p: [x, 0.53, z] as [number, number, number], s: [1.7, 1.7, 1.4] as [number, number, number] })))} />
      <Instanced geometry={wheelGeo} material={MAT.steel} items={[-5.45, -2.7, 5.3, 6.5, 7.6].flatMap((x) => [-1.34, 1.34].map((z) => ({ p: [x, 0.53, z] as [number, number, number], s: [0.92, 0.92, 0.08] as [number, number, number] })))} />
      <Instanced geometry={unitBox} material={paint('#647e8c', 0.4, 0.6)} items={Array.from({ length: 40 }, (_, i) => -3.8 + i * 0.3).flatMap((x) => [-1.24, 1.24].map((z) => ({ p: [x, 2.6, z] as [number, number, number], s: [0.075, 2.45, 0.045] as [number, number, number] })))} />
      <Instanced geometry={unitBox} material={MAT.steel} items={[-0.86, -0.28, 0.28, 0.86].map((z) => ({ p: [8.13, 2.6, z] as [number, number, number], s: [0.045, 2.46, 0.045] as [number, number, number] }))} />
    </group>
  )
}

function Warehouse() {
  const docks = [20, 40, 60, 80, 100, 120, 140]
  return (
    // x склада → v = 227 − x, z склада → u = 46 − z
    <group position={[46, 0, -227]} rotation={[0, -Math.PI / 2, 0]}>
      <Racks />
      <Forklift u={AISLES[0]} v0={16} v1={146} phase={0} />
      <Forklift u={AISLES[0]} v0={30} v1={140} phase={2.4} />
      <Forklift u={AISLES[1]} v0={16} v1={148} phase={1.2} />
      {docks.map((v, i) => (
        <group key={v}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.6, 3.6, 3.4]} position={[0, 1.8, -v]} />
          <mesh geometry={unitBox} material={MAT.yellow} scale={[2, 1.2, 3.4]} position={[1.2, 0.6, -v]} />
          {i % 3 !== 1 && <DockTruck v={v} />}
        </group>
      ))}
      <Label position={[18, 10, -80]} color="#4f8cff" small>
        Стеллажи хранения машинокомплектов
      </Label>
    </group>
  )
}

/* ---------------- Тягач-AGV: склад → вдоль сборочных линий и обратно ---------------- */

function Tugger() {
  const path = useMemo(() => makePath([[62, 0, -191], [214, 0, -191], [214, 0, -178], [62, 0, -178], [62, 0, -191]] as P3[], 4), [])
  const len = useMemo(() => path.getLength(), [path])
  const refs = useRef<(Group | null)[]>([])
  useFrame(({ clock }) => {
    refs.current.forEach((g, i) => g && placeOnPath(path, len, mod(clock.elapsedTime * 2.2 - i * 3.2, len), g))
  })
  return (
    <group>
      {Array.from({ length: 4 }, (_, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)}>
          {i === 0 ? (
            <mesh geometry={unitBox} material={forkliftMat} scale={[1.8, 1.3, 1.1]} position={[0, 0.7, 0]} />
          ) : (
            <>
              <mesh geometry={unitBox} material={MAT.darkSteel} scale={[2.6, 0.3, 1.2]} position={[0, 0.4, 0]} />
              <mesh geometry={unitBox} material={MAT.carton} scale={[2.2, 0.9, 1.0]} position={[0, 1.0, 0]} />
            </>
          )}
        </group>
      ))}
    </group>
  )
}

/* ---------- Мелкоузловая сборка ЦМУС и ЦМУС-2 (u 2–55, v 138–190), источники НДВ 0025–0033 ---------- */

function SmallParts() {
  const benches = useMemo(() => {
    const out: { u: number; v: number }[] = []
    for (const u of [10, 20, 30]) for (const v of [143, 153, 170, 180]) out.push({ u, v })
    return out
  }, [])
  const tables: IndustrialItem[] = benches.flatMap((b) => [
    { p: [b.u, 0.95, -b.v], s: [4, 0.12, 2] },
    ...[-1.8, 1.8].flatMap((x) => [-0.8, 0.8].map((z) => ({ p: [b.u + x, 0.45, -b.v + z] as [number, number, number], s: [0.12, 0.9, 0.12] as [number, number, number] }))),
  ])
  const jigs: Item[] = benches.map((b) => ({ p: [b.u, 1.25, -b.v], s: [3.2, 0.5, 1.4] }))
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={tables} />
      <Instanced geometry={unitBox} material={MAT.steel} items={jigs} />
      <PartsRacks width={3} positions={benches.map((b) => [b.u, 0, -(b.v + 2.6)])} />
      {benches.map((b, i) => (
        <Worker key={i} position={[b.u + (i % 2 ? 1 : -1), 0, -(b.v - 1.8)]} yaw={Math.PI / 2} phase={i * 0.9} />
      ))}
      {/* роботизированные ячейки с поворотным столом */}
      {[148, 175].map((v, i) => (
        <group key={v} position={[45, 0, -v]}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[3.4, 0.9, 3.4]} position={[0, 0.45, 0]} />
          <Robot position={[0, 0, 3.2]} yaw={Math.PI / 2} tool="gun" phase={i * 2} speed={1.5} />
          <Robot position={[0, 0, -3.2]} yaw={-Math.PI / 2} tool="gripper" phase={i * 2 + 1} speed={1.1} />
        </group>
      ))}
    </group>
  )
}

/*
 * Цех окраски пластика (u 220–244, v 95–152), источники НДВ 0023–0024. Описан в собственной
 * системе (x вдоль конвейера) и ставится в корпус поворотом на 90°: v = x − 66, u = 252 − z.
 */

function Plastic() {
  const path = useMemo(() => makePath([[164, 2.2, -28], [219, 2.2, -28], [219, 2.2, -9], [164, 2.2, -9], [164, 2.2, -28]] as P3[], 3), [])
  const len = useMemo(() => path.getLength(), [path])
  const n = Math.floor(len / 2.4)
  const refs = useRef<(Group | null)[]>([])
  useFrame(({ clock }) => {
    refs.current.forEach((g, i) => {
      if (!g) return
      const p = placeOnPath(path, len, mod(clock.elapsedTime * 1.2 + i * 2.4, len), g)
      const m = g.children[0] as Mesh
      const painted = Math.abs(p.z + 9) < 0.6 || (Math.abs(p.z + 28) < 0.6 && p.x > 208)
      m.material = painted ? bumperMats.done[i % 5] : bumperMats.raw
    })
  })
  return (
    <group position={[252, 0, 66]} rotation={[0, Math.PI / 2, 0]}>
      {/* кабина: 6 роботов (nur.kz) */}
      <group position={[188, 0, -28]}>
        <mesh geometry={unitBox} material={boothGlass} scale={[34, 4.6, 0.08]} position={[0, 2.3, 4.2]} />
        <mesh geometry={unitBox} material={boothGlass} scale={[34, 4.6, 0.08]} position={[0, 2.3, -4.2]} />
        <mesh geometry={unitBox} material={boothGlass} scale={[34, 0.1, 8.6]} position={[0, 4.7, 0]} />
        {[-10, 0, 10].flatMap((x, i) =>
          ([1, -1] as const).map((side) => (
            <Robot key={`${x}${side}`} position={[x, 0, side * 2.9]} yaw={side === 1 ? Math.PI / 2 : -Math.PI / 2} tool="spray" material={MAT.wall} phase={i + side} scale={0.75} />
          )),
        )}
      </group>
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[58, 0.3, 0.25]} position={[191.5, 3.3, -9]} />
      {Array.from({ length: n }, (_, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)}>
          <mesh geometry={unitBox} scale={[0.4, 0.55, 1.8]} material={bumperMats.raw} />
        </group>
      ))}
    </group>
  )
}

/* ---------------- Буфер окрашенных кузовов (u 300–356, v 10–85) ---------------- */

function Pbs() {
  const cars = useMemo(() => {
    const out: ParkedCar[] = []
    let k = 0
    for (let u = 304; u <= 352; u += 6)
      for (const v of [18, 28, 38, 48, 58, 68, 78]) {
        // кузова на двух ярусах стеллажа
        for (const h of (u + v) % 4 === 0 ? [0.5, 3.3] : [0.5]) {
          const color = CAR_COLORS[k % 5], model = pickModel(k)
          out.push({ p: [u, h, -v], r: Math.PI / 2, color, model, unit: { key: `pbs:${k}`, place: 'pbs', model, color, index: k } })
          k++
        }
      }
    return out
  }, [])
  const shelves = useMemo(() => {
    const out: Item[] = []
    for (let u = 304; u <= 352; u += 6) out.push({ p: [u, 3, -48], s: [2.2, 0.15, 66] })
    return out
  }, [])
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.steel} items={shelves} />
      <ParkedCars cars={cars} wheels={false} glass={false} details={false} />
    </group>
  )
}

export function Logistics() {
  return (
    <group>
      <Warehouse />
      <Tugger />
      <SmallParts />
      <Plastic />
      <Pbs />
    </group>
  )
}
