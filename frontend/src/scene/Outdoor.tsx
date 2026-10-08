import { useProductionEnabled } from '../simulation/ProductionClock'
import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, ConeGeometry, CylinderGeometry, MeshStandardMaterial, Vector3, type Group } from 'three'
import type { HallFrame, OutdoorZone } from '../types'
import { CAR_COLORS, MAT, paint, unitBox } from './assets'
import { Car, type CarHandle } from './Car'
import { hallToWorld, world } from './geo'
import { Instanced } from './Hall'
import { makePath, mod, placeOnPath, type P3 } from './motion'
import { pickModel } from './carModels'
import { ParkedCars, type ParkedCar } from './ParkedCars'
import { surfaceTile } from './surfaces'
import { OUTBOUND_ROUTE, ROAD_TURN_RADIUS } from './exteriorLayout'

type Item = { p: [number, number, number]; s: [number, number, number]; r?: number }

const CONTAINER_COLORS = ['#48697b', '#8e4d44', '#ae8061', '#778080', '#617b70', '#cbd0c9', '#664b49']
const containerMats = CONTAINER_COLORS.map((c) => paint(c, 0.35, 0.6))
const coneMat = paint('#ff6a00', 0, 0.6)
const containerFrame = paint('#b5b8ae', 0.5, 0.62)
const coneGeo = new ConeGeometry(0.21, 0.62, 12)
const coneBandGeo = new CylinderGeometry(0.073, 0.119, 0.14, 12)
const coneBase = paint('#303a3c', 0.05, 0.95)
const curbMat = paint('#bfc1b6', 0, 0.96)
const yellowMark = paint('#d7b96a', 0, 0.9)
const handlerPaint = paint('#c8a153', 0.25, 0.5)
const handlerGlass = paint('#526e78', 0.42, 0.2)
const handlerRubber = paint('#262d2e', 0.02, 0.92)
const handlerWheel = new CylinderGeometry(0.86, 0.86, 0.68, 20).rotateX(Math.PI / 2)
const handlerHub = new CylinderGeometry(0.38, 0.38, 0.7, 16).rotateX(Math.PI / 2)
// Coplanar overlays use depth offsets; all physical surfaces remain at ground level.
const pavingDepth = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }
const concreteTile = surfaceTile('concrete', 16)
const asphaltTile = surfaceTile('asphalt', 36)
const concrete = new MeshStandardMaterial({ color: '#9c9f98', roughness: 0.95, map: concreteTile, bumpMap: concreteTile, bumpScale: 0.025, ...pavingDepth })
const asphalt = new MeshStandardMaterial({ color: '#646c6d', roughness: 0.94, map: asphaltTile, bumpMap: asphaltTile, bumpScale: 0.035, ...pavingDepth })
const parkingMarkMat = new MeshStandardMaterial({ color: '#d8d7c8', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })

/** Flush paving with inset drainage and edge kerbs, joined to the site access roads. */
function Pad({ zone, material }: { zone: OutdoorZone; material: typeof asphalt }) {
  const [length, width] = zone.size
  const edges = useMemo<Item[]>(() => [
    { p: [0, 0.07, -width / 2], s: [length, 0.18, 0.3] },
    { p: [-length / 2, 0.07, 0], s: [0.3, 0.18, width] },
    { p: [length / 2, 0.07, -width / 4], s: [0.3, 0.18, width / 2] },
  ], [length, width])
  const drains = useMemo<Item[]>(() => Array.from({ length: Math.floor(length / 18) }, (_, i) => ({ p: [-length / 2 + 9 + i * 18, 0.006, width / 2 - 0.7], s: [0.9, 0.018, 0.4] })), [length, width])
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.009, 0]} material={material} renderOrder={1} receiveShadow>
      <planeGeometry args={zone.size} />
    </mesh>
    <Instanced geometry={unitBox} material={curbMat} items={edges} />
    <Instanced geometry={unitBox} material={MAT.darkSteel} items={drains} />
  </group>
}

/** детерминированный «рандом» — сцена одинаковая при каждой загрузке */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Группа, повёрнутая вдоль оси корпуса, с центром в точке площадки. */
function Aligned({ zone, angle, children }: { zone: OutdoorZone; angle: number; children: React.ReactNode }) {
  return (
    <group position={world(zone.center[0], zone.center[1])} rotation={[0, angle, 0]}>
      {children}
    </group>
  )
}

function Containers({ zone }: { zone: OutdoorZone }) {
  const byColor = useMemo(() => {
    const out: Item[][] = CONTAINER_COLORS.map(() => [])
    const [L, W] = zone.size
    let k = 0
    // штабели блоками, между ними проезды для ричстакера
    for (let bx = -L / 2 + 20; bx < L / 2 - 20; bx += 34) {
      for (const bz of [-W / 4, W / 4]) {
        if (rnd(k++) < 0.25) continue
        for (let row = 0; row < 4; row++)
          for (let col = 0; col < 2; col++) {
            const h = 1 + Math.floor(rnd(k++) * 3)
            for (let lvl = 0; lvl < h; lvl++) {
              const c = Math.floor(rnd(k++) * CONTAINER_COLORS.length)
              out[c].push({ p: [bx + col * 12.6, 1.3 + lvl * 2.6, bz + row * 2.6 - 4], s: [12.19, 2.59, 2.44] })
            }
          }
      }
    }
    return out
  }, [zone])
  const details = useMemo(() => {
    const ribs: Item[][] = CONTAINER_COLORS.map(() => []), hardware: Item[] = [], bayMarks: Item[] = []
    byColor.forEach((items, color) => items.forEach(({ p: [x, y, z] }) => {
      for (let d = -5.65; d < 5.8; d += 0.43) {
        for (const side of [-1, 1]) ribs[color].push({ p: [x + d, y, z + side * 1.23], s: [0.11, 2.43, 0.075] })
        ribs[color].push({ p: [x + d, y + 1.31, z], s: [0.11, 0.055, 2.34] })
      }
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) hardware.push({ p: [x + end * 6.03, y, z + side * 1.17], s: [0.18, 2.6, 0.16] })
        for (const top of [-1, 1]) hardware.push({ p: [x + end * 6.06, y + top * 1.2, z], s: [0.16, 0.15, 2.36] })
      }
      for (const door of [-0.64, 0.64]) hardware.push({ p: [x + 6.115, y, z + door], s: [0.055, 2.22, 0.055] })
    }))
    for (let x = -zone.size[0] / 2 + 4; x < zone.size[0] / 2 - 3; x += 17) {
      for (const side of [-1, 1]) bayMarks.push({ p: [x, 0.008, side * (zone.size[1] / 2 - 3)], s: [13, 0.008, 0.16] })
    }
    return { ribs, hardware, bayMarks }
  }, [byColor, zone])
  return (
    <group>
      {byColor.map((items, i) => items.length > 0 && <Instanced key={i} geometry={unitBox} material={containerMats[i]} items={items} castShadow />)}
      {details.ribs.map((items, i) => items.length > 0 && <Instanced key={i} geometry={unitBox} material={containerMats[i]} items={items} />)}
      <Instanced geometry={unitBox} material={containerFrame} items={details.hardware} />
      <Instanced geometry={unitBox} material={yellowMark} items={details.bayMarks} />
    </group>
  )
}

function FinishedLot({ zone }: { zone: OutdoorZone }) {
  const cars = useMemo(() => {
    const out: ParkedCar[] = []
    const [L, W] = zone.size
    let k = 0
    // ряды «ёлочкой» через проезд, как на снимке; ~85% мест занято
    for (let z = -W / 2 + 6; z < W / 2 - 4; z += 13) {
      for (const side of [-2.6, 2.6]) {
        for (let x = -L / 2 + 4; x < L / 2 - 4; x += 2.7) {
          if (rnd(k++) > 0.85) continue
          const c = rnd(k++)
          // основной поток — белые и серебристые машины, как на спутниковом снимке
          const color = c < 0.45 ? CAR_COLORS[0] : c < 0.7 ? CAR_COLORS[2] : c < 0.85 ? CAR_COLORS[1] : CAR_COLORS[3 + (k % 2)]
          out.push({ p: [x, 0, z + side], r: Math.PI / 2, color, model: pickModel(k) })
        }
      }
    }
    return out
  }, [zone])
  const marks = useMemo<Item[]>(() => {
    const out: Item[] = []
    const [L, W] = zone.size
    for (let z = -W / 2 + 6; z < W / 2 - 4; z += 13)
      for (let x = -L / 2 + 2.65; x < L / 2 - 4; x += 2.7)
        for (const side of [-2.6, 2.6]) out.push({ p: [x, 0.008, z + side], s: [0.1, 0.008, 5] })
    return out
  }, [zone])
  return <><ParkedCars cars={cars} /><Instanced geometry={unitBox} material={parkingMarkMat} items={marks} /></>
}

function TestTrack({ zone }: { zone: OutdoorZone }) {
  const simulated = useProductionEnabled()
  const [L, W] = zone.size
  // восьмёрка
  const curve = useMemo(() => {
    const pts: Vector3[] = []
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      pts.push(new Vector3(Math.sin(t) * L * 0.38, 0, Math.sin(t) * Math.cos(t) * W * 0.7))
    }
    return new CatmullRomCurve3(pts, true)
  }, [L, W])
  const car = useRef<CarHandle>(null)
  const tmp = useMemo(() => new Vector3(), [])
  useFrame(({ clock }, delta) => {
    const c = car.current
    if (!c) return
    const t = (clock.elapsedTime * 0.035) % 1
    curve.getPointAt(t, c.root.position)
    curve.getTangentAt(t, tmp)
    c.root.rotation.y = Math.atan2(-tmp.z, tmp.x)
    c.wheels.children.forEach((w) => (w.rotation.z -= delta * curve.getLength() * 0.035 / 0.315))
  })
  const cones = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (let i = 0; i < 9; i++) out.push({ p: [-L * 0.3 + i * L * 0.075, 0.36, W * 0.42], s: [1, 1, 1] })
    return out
  }, [L, W])
  const marks = useMemo(() => curve.getSpacedPoints(160).map((p) => [p.x, 0.018, p.z] as [number, number, number]), [curve])
  const edgeMarks = useMemo(() => [-1, 1].map((side) => Array.from({ length: 161 }, (_, i) => {
    const p = curve.getPointAt(i / 160), t = curve.getTangentAt(i / 160)
    return [p.x - t.z * 3.3 * side, 0.018, p.z + t.x * 3.3 * side] as [number, number, number]
  })), [curve])
  return (
    <group>
      <Line points={marks} color="#e2d7a1" lineWidth={1} dashed dashSize={2.5} gapSize={2.5} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      {edgeMarks.map((points, i) => <Line key={i} points={points} color="#dddcd0" lineWidth={1.4} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />)}
      {!simulated && <Car ref={car} model="onix" body={paint(CAR_COLORS[3])} glass={MAT.glass} wheels details />}
      <Instanced geometry={coneGeo} material={coneMat} items={cones} castShadow />
      <Instanced geometry={coneBandGeo} material={parkingMarkMat} items={cones.map((item) => ({ ...item, p: [item.p[0], 0.4, item.p[2]] }))} />
      <Instanced geometry={unitBox} material={coneBase} items={cones.map((item) => ({ p: [item.p[0], 0.035, item.p[2]], s: [0.5, 0.07, 0.5] }))} />
    </group>
  )
}

/** Готовые машины выезжают из ворот ОТК (юго-западная стена) и объезжают корпус к площадке отгрузки. */
function Outbound({ frame }: { frame: HallFrame }) {
  const path = useMemo(() => {
    return makePath(OUTBOUND_ROUTE.map(([u, v]) => hallToWorld(frame, u, v).toArray() as P3), ROAD_TURN_RADIUS)
  }, [frame])
  const len = useMemo(() => path.getLength(), [path])
  const refs = useRef<(CarHandle | null)[]>([])
  useFrame(({ clock }, delta) => {
    refs.current.forEach((c, i) => {
      if (!c) return
      placeOnPath(path, len, mod(clock.elapsedTime * 3.2 + i * 38, len), c.root)
      c.wheels.children.forEach((w) => (w.rotation.z -= delta * 3.2 / 0.315))
    })
  })
  return (
    <group>
      {Array.from({ length: Math.floor(len / 38) }, (_, i) => (
        <Car
          key={i}
          ref={(c) => void (refs.current[i] = c)}
          model={pickModel(i)}
          body={paint(CAR_COLORS[i % 5])}
          glass={MAT.glass}
          wheels
          details
        />
      ))}
    </group>
  )
}

/** Ричстакер курсирует вдоль контейнерного терминала. */
function ReachStacker({ zone }: { zone: OutdoorZone }) {
  const ref = useRef<Group>(null!)
  const wheels = useRef<Group>(null!)
  const previous = useRef(0)
  const tires = useMemo<Item[]>(() => [-2.5, 2.7].flatMap((x) => [-1, 1].map((side) => ({ p: [x, 0.86, side * 1.88], s: [1, 1, 1] }))), [])
  const chassis = useMemo<Item[]>(() => [
    { p: [0, 1.1, 0], s: [8.5, 0.5, 3.6] },
    { p: [-3.2, 2.1, 0], s: [2.1, 2.3, 3.6] },
    { p: [-1.7, 2.9, 0], s: [2, 0.5, 3.3] },
    { p: [0.5, 2.1, -0.6], s: [2.5, 0.4, 2.1] },
    { p: [0.5, 4.7, -0.6], s: [2.55, 0.22, 2.15] },
    ...[-0.65, 1.65].flatMap((x) => [-1.56, 0.36].map((z) => ({ p: [x, 3.45, z] as [number, number, number], s: [0.14, 2.5, 0.14] as [number, number, number] }))),
  ], [])
  const undercarriage = useMemo<Item[]>(() => [
    { p: [-4.35, 1.65, 0], s: [0.3, 0.6, 4] },
    { p: [4.3, 1.3, 0], s: [0.3, 0.5, 3.8] },
    { p: [0, 1.62, -2], s: [3.5, 0.12, 0.75] },
    { p: [0, 1.1, -2.25], s: [2.3, 0.12, 0.4] },
    { p: [0, 0.61, -2.35], s: [1.7, 0.12, 0.4] },
    ...Array.from({ length: 7 }, (_, i) => ({ p: [-4.27, 2.1 + i * 0.11, 0] as [number, number, number], s: [0.09, 0.035, 2.6] as [number, number, number] })),
  ], [])
  useFrame(({ clock }) => {
    // Keep the spreader inside the clear central aisle; wheels follow distance travelled.
    const x = Math.sin(clock.elapsedTime * 0.035) * zone.size[0] * 0.33
    const travel = x - previous.current
    ref.current.position.x = x
    if (Math.abs(travel) < 2) wheels.current.children.forEach((wheel) => { wheel.rotation.z -= travel / 0.86 })
    previous.current = x
  })
  return (
    <group ref={ref}>
      <Instanced geometry={unitBox} material={handlerPaint} items={chassis} castShadow />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={undercarriage} castShadow />
      <mesh geometry={unitBox} material={handlerGlass} scale={[2.25, 2.25, 1.9]} position={[0.5, 3.42, -0.6]} castShadow />
      <group ref={wheels}>
        {tires.map((t, i) => <group key={i} position={t.p}>
          <mesh geometry={handlerWheel} material={handlerRubber} castShadow />
          <mesh geometry={handlerHub} material={containerFrame} />
        </group>)}
      </group>
      <group position={[-1.2, 4.3, 0.5]} rotation={[0, 0, 0.3]}>
        <mesh geometry={unitBox} material={handlerPaint} scale={[7.8, 0.9, 1.15]} position={[3.1, 0, 0]} castShadow />
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[5.2, 0.6, 0.75]} position={[5.6, 0, 0]} castShadow />
        <mesh geometry={unitBox} material={containerFrame} scale={[4.7, 0.13, 0.14]} position={[3.3, -0.52, -0.44]} />
      </group>
      <group position={[6.45, 6.35, 0.5]}>
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[1.6, 0.55, 11.8]} castShadow />
        {[-1, 1].map((side) => <group key={side} position={[0, -0.3, side * 5.7]}>
          <mesh geometry={unitBox} material={handlerPaint} scale={[2.7, 0.3, 0.7]} castShadow />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.2, 0.65, 0.24]} position={[1.1, -0.36, 0]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.2, 0.65, 0.24]} position={[-1.1, -0.36, 0]} />
        </group>)}
      </group>
      <mesh geometry={unitBox} material={containerFrame} scale={[0.18, 2.7, 0.18]} position={[-2.2, 4.1, 1.35]} />
      <mesh geometry={unitBox} material={yellowMark} scale={[0.18, 0.28, 0.18]} position={[0.5, 5.01, -0.6]} />
    </group>
  )
}

export function Outdoor({ frame, zones }: { frame: HallFrame; zones: OutdoorZone[] }) {
  const simulated = useProductionEnabled()
  const z = (id: string) => zones.find((o) => o.id === id)
  const containers = z('containers')
  const finished = z('finished')
  const track = z('testtrack')
  return (
    <group>
      {containers && (
        <Aligned zone={containers} angle={frame.angle}>
          <Pad zone={containers} material={concrete} />
          <Containers zone={containers} />
          <ReachStacker zone={containers} />
        </Aligned>
      )}
      {finished && (
        <Aligned zone={finished} angle={frame.angle}>
          <Pad zone={finished} material={asphalt} />
          {!simulated && <FinishedLot zone={finished} />}
        </Aligned>
      )}
      {track && (
        <Aligned zone={track} angle={frame.angle}>
          <Pad zone={track} material={asphalt} />
          <TestTrack zone={track} />
        </Aligned>
      )}
      {!simulated && <Outbound frame={frame} />}
    </group>
  )
}
