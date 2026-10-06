import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group, type Mesh } from 'three'
import { CAR_COLORS, MAT, paint, unitBox } from './assets'
import { Instanced } from './Hall'
import { Label } from './Label'
import { makePath, mod, placeOnPath, type P3 } from './motion'
import { ParkedCars, type ParkedCar } from './ParkedCars'
import { Robot } from './Robot'
import { Worker } from './Worker'

type Item = { p: [number, number, number]; s: [number, number, number] }

const forkliftMat = paint('#f2a900', 0.2, 0.5)
const containerMat = paint('#1f5fae', 0.4, 0.55)
const cabMat = paint('#e9ecef', 0.3, 0.4)
const bumperMats = { raw: paint('#2b2d31', 0, 0.8), done: CAR_COLORS.map((c) => paint(c)) }
const boothGlass = new MeshStandardMaterial({ color: '#cfe3f1', transparent: true, opacity: 0.22, depthWrite: false })

/* ---------------- Склад CKD-комплектов (u 0–48) ---------------- */

const RACK_ROWS = [7, 13.2, 26, 32.2] // u, пары стеллажей спина к спине
const AISLES = [19.6, 39]
const BAY = 2.8
const LEVELS = [0.15, 2.25, 4.35, 6.45]

function Racks() {
  const { uprights, beams, boxes } = useMemo(() => {
    const uprights: Item[] = []
    const beams: Item[] = []
    const boxes: Item[] = []
    for (const u of RACK_ROWS) {
      for (let v = 14; v <= 212; v += BAY) {
        uprights.push({ p: [u, 4, -v], s: [1.1, 8, 0.12] })
        if (v + BAY > 212) continue
        for (const [li, y] of LEVELS.entries()) {
          if (li > 0) beams.push({ p: [u, y - 0.08, -(v + BAY / 2)], s: [1.15, 0.14, BAY] })
          // заполненность ~80%, детерминированно
          if ((Math.sin(u * 7.1 + v * 3.3 + li * 11.7) + 1) / 2 < 0.8)
            boxes.push({ p: [u, y + 0.75, -(v + BAY / 2)], s: [1.0, 1.4, BAY - 0.35] })
        }
      }
    }
    return { uprights, beams, boxes }
  }, [])
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.blueRack} items={uprights} />
      <Instanced geometry={unitBox} material={MAT.orangeRack} items={beams} />
      <Instanced geometry={unitBox} material={MAT.carton} items={boxes} />
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
      <mesh geometry={unitBox} material={forkliftMat} scale={[2.2, 1.2, 1.2]} position={[-0.3, 0.75, 0]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[1.1, 1.1, 1.1]} position={[-0.5, 1.9, 0]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.12, 3.6, 0.9]} position={[0.85, 1.8, 0]} />
      <group ref={forks}>
        <mesh geometry={unitBox} material={MAT.steel} scale={[1.1, 0.06, 0.8]} position={[1.45, 0, 0]} />
        <mesh geometry={unitBox} material={MAT.carton} scale={[1.0, 0.9, 1.0]} position={[1.45, 0.5, 0]} />
      </group>
    </group>
  )
}

/** Контейнерный тягач у докового шлюза (снаружи торцевой стены u = 0). */
function DockTruck({ v }: { v: number }) {
  return (
    <group position={[-10.5, 0, -v]}>
      <mesh geometry={unitBox} material={containerMat} scale={[12.2, 2.6, 2.45]} position={[2, 2.6, 0]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[12.6, 0.3, 2.4]} position={[2, 1.15, 0]} />
      <mesh geometry={unitBox} material={cabMat} scale={[2.3, 2.9, 2.45]} position={[-5.4, 1.9, 0]} />
    </group>
  )
}

function Warehouse() {
  const docks = [34, 62, 90, 118, 146, 174, 202]
  return (
    <group>
      <Racks />
      <Forklift u={AISLES[0]} v0={20} v1={200} phase={0} />
      <Forklift u={AISLES[0]} v0={30} v1={190} phase={2.4} />
      <Forklift u={AISLES[1]} v0={16} v1={205} phase={1.2} />
      <Forklift u={44} v0={25} v1={200} phase={3.7} />
      {docks.map((v, i) => (
        <group key={v}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.6, 3.6, 3.4]} position={[0, 1.8, -v]} />
          <mesh geometry={unitBox} material={MAT.yellow} scale={[2, 1.2, 3.4]} position={[1.2, 0.6, -v]} />
          {i % 3 !== 1 && <DockTruck v={v} />}
        </group>
      ))}
      <Label position={[24, 10, -110]} color="#4f8cff" small>
        Стеллажи хранения машинокомплектов
      </Label>
    </group>
  )
}

/* ---------------- Тягач-AGV: склад → линии сварки и обратно ---------------- */

function Tugger() {
  const path = useMemo(() => makePath([[46, 0, -55], [156, 0, -55], [156, 0, -100.5], [46, 0, -100.5], [46, 0, -55]] as P3[], 4), [])
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

/* ---------------- Мелкоузловая сборка (u 52–150, v 0–52) ---------------- */

function SmallParts() {
  const benches = useMemo(() => {
    const out: { u: number; v: number }[] = []
    for (let u = 60; u <= 110; u += 10) for (const v of [12, 26, 40]) out.push({ u, v })
    return out
  }, [])
  const tables: Item[] = benches.map((b) => ({ p: [b.u, 0.5, -b.v], s: [4, 1, 2] }))
  const jigs: Item[] = benches.map((b) => ({ p: [b.u, 1.25, -b.v], s: [3.2, 0.5, 1.4] }))
  const bins: Item[] = benches.map((b) => ({ p: [b.u, 0.6, -(b.v + 2.6)], s: [3, 1.2, 0.8] }))
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={tables} />
      <Instanced geometry={unitBox} material={MAT.steel} items={jigs} />
      <Instanced geometry={unitBox} material={MAT.blueRack} items={bins} />
      {benches.map((b, i) => (
        <Worker key={i} position={[b.u + (i % 2 ? 1 : -1), 0, -(b.v - 1.8)]} yaw={Math.PI / 2} phase={i * 0.9} />
      ))}
      {/* роботизированные ячейки с поворотным столом */}
      {[124, 140].map((u, i) => (
        <group key={u} position={[u, 0, -26]}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[3.4, 0.9, 3.4]} position={[0, 0.45, 0]} />
          <Robot position={[0, 0, 3.2]} yaw={Math.PI / 2} tool="gun" phase={i * 2} speed={1.5} />
          <Robot position={[0, 0, -3.2]} yaw={-Math.PI / 2} tool="gripper" phase={i * 2 + 1} speed={1.1} />
        </group>
      ))}
    </group>
  )
}

/* ---------------- Окраска пластиковых деталей (u 160–222, v 0–52) ---------------- */

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
    <group>
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

/* ---------------- Буфер окрашенных кузовов (u 160–222, v 56–96) ---------------- */

function Pbs() {
  const cars = useMemo(() => {
    const out: ParkedCar[] = []
    let k = 0
    for (let u = 166; u <= 214; u += 6)
      for (const v of [62, 70, 78, 86]) {
        // кузова на двух ярусах стеллажа
        out.push({ p: [u, 0.5, -v], r: Math.PI / 2, color: CAR_COLORS[k++ % 5] })
        if ((u + v) % 4 === 0) out.push({ p: [u, 3.3, -v], r: Math.PI / 2, color: CAR_COLORS[k++ % 5] })
      }
    return out
  }, [])
  const shelves = useMemo(() => {
    const out: Item[] = []
    for (let u = 166; u <= 214; u += 6) out.push({ p: [u, 3, -74], s: [2.2, 0.15, 34] })
    return out
  }, [])
  return (
    <group>
      <Instanced geometry={unitBox} material={MAT.steel} items={shelves} />
      <ParkedCars cars={cars} wheels={false} glass={false} />
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
