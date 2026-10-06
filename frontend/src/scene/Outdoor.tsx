import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, Vector3, type Group } from 'three'
import type { HallFrame, OutdoorZone } from '../types'
import { CAR_COLORS, MAT, paint, unitBox } from './assets'
import { Car, type CarHandle } from './Car'
import { hallToWorld, world } from './geo'
import { Instanced } from './Hall'
import { makePath, mod, placeOnPath, type P3 } from './motion'
import { ParkedCars, type ParkedCar } from './ParkedCars'

type Item = { p: [number, number, number]; s: [number, number, number]; r?: number }

const CONTAINER_COLORS = ['#1f5fae', '#c0392b', '#e67e22', '#7f8c8d', '#27ae60', '#f1f2f4', '#8e2b2b']
const containerMats = CONTAINER_COLORS.map((c) => paint(c, 0.35, 0.6))
const coneMat = paint('#ff6a00', 0, 0.6)
const concrete = paint('#8e908c', 0, 0.95)
const asphalt = paint('#5a5e62', 0, 0.9)

/** Покрытие площадки: закрывает плоские объекты спутникового снимка под 3D-моделями. */
function Pad({ zone, material }: { zone: OutdoorZone; material: typeof asphalt }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} material={material} receiveShadow>
      <planeGeometry args={zone.size} />
    </mesh>
  )
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
  return (
    <group>
      {byColor.map((items, i) => items.length > 0 && <Instanced key={i} geometry={unitBox} material={containerMats[i]} items={items} castShadow />)}
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
          out.push({ p: [x, 0, z + side], r: Math.PI / 2, color })
        }
      }
    }
    return out
  }, [zone])
  return <ParkedCars cars={cars} />
}

function TestTrack({ zone }: { zone: OutdoorZone }) {
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
  useFrame(({ clock }) => {
    const c = car.current
    if (!c) return
    const t = (clock.elapsedTime * 0.035) % 1
    curve.getPointAt(t, c.root.position)
    curve.getTangentAt(t, tmp)
    c.root.rotation.y = Math.atan2(-tmp.z, tmp.x)
    c.wheels.children.forEach((w) => (w.rotation.z -= 0.35))
  })
  const cones = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (let i = 0; i < 9; i++) out.push({ p: [-L * 0.3 + i * L * 0.075, 0.35, W * 0.42], s: [0.35, 0.7, 0.35] })
    return out
  }, [L, W])
  const marks = useMemo(() => curve.getSpacedPoints(160).map((p) => [p.x, 0.08, p.z] as [number, number, number]), [curve])
  return (
    <group>
      <Line points={marks} color="#f4f4f4" lineWidth={2} />
      <Car ref={car} body={paint(CAR_COLORS[3])} glass={MAT.glass} wheels />
      <Instanced geometry={unitBox} material={coneMat} items={cones} />
    </group>
  )
}

/** Готовые машины уезжают из ворот ОТК на площадку готовой продукции. */
function Outbound({ frame }: { frame: HallFrame }) {
  const path = useMemo(() => {
    const pts: [number, number][] = [
      [362, 218],
      [384, 222],
      [386, 300],
      [372, 318],
      [200, 330],
      [160, 345],
    ]
    return makePath(pts.map(([u, v]) => hallToWorld(frame, u, v).toArray() as P3), 8)
  }, [frame])
  const len = useMemo(() => path.getLength(), [path])
  const refs = useRef<(CarHandle | null)[]>([])
  useFrame(({ clock }) => {
    refs.current.forEach((c, i) => {
      if (!c) return
      placeOnPath(path, len, mod(clock.elapsedTime * 3.2 + i * 38, len), c.root)
      c.wheels.children.forEach((w) => (w.rotation.z -= 0.2))
    })
  })
  return (
    <group>
      {Array.from({ length: Math.floor(len / 38) }, (_, i) => (
        <Car key={i} ref={(c) => void (refs.current[i] = c)} body={paint(CAR_COLORS[i % 5])} glass={MAT.glass} wheels />
      ))}
    </group>
  )
}

/** Ричстакер курсирует вдоль контейнерного терминала. */
function ReachStacker({ zone }: { zone: OutdoorZone }) {
  const ref = useRef<Group>(null!)
  useFrame(({ clock }) => {
    ref.current.position.x = Math.sin(clock.elapsedTime * 0.06) * zone.size[0] * 0.38
  })
  return (
    <group ref={ref}>
      <mesh geometry={unitBox} material={paint('#f2a900', 0.2, 0.5)} scale={[8, 2.6, 4]} position={[0, 1.6, 0]} castShadow />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[11, 0.8, 0.8]} position={[3, 6, 0]} rotation={[0, 0, 0.45]} />
    </group>
  )
}

export function Outdoor({ frame, zones }: { frame: HallFrame; zones: OutdoorZone[] }) {
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
          <FinishedLot zone={finished} />
        </Aligned>
      )}
      {track && (
        <Aligned zone={track} angle={frame.angle}>
          <Pad zone={track} material={asphalt} />
          <TestTrack zone={track} />
        </Aligned>
      )}
      <Outbound frame={frame} />
    </group>
  )
}
