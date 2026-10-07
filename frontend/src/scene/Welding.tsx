import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, MeshBasicMaterial, MeshStandardMaterial, type Mesh } from 'three'
import { MAT, unitBox } from './assets'
import { Car, type CarHandle } from './Car'
import { pickModel, type CarModelId } from './carModels'
import { L } from './geo'
import { Instanced } from './Hall'
import { Label } from './Label'
import { indexed, isDwelling, mod } from './motion'
import { Robot } from './Robot'
import { Worker } from './Worker'
import { fenceTile } from './surfaces'

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

const fenceMat = new MeshStandardMaterial({ color: '#7b888b', alphaMap: fenceTile(), alphaTest: 0.4, roughness: 0.6, metalness: 0.4 })
const laserCellMat = new MeshStandardMaterial({ color: '#25292f', transparent: true, opacity: 0.55, roughness: 0.3, depthWrite: false })
const laserWindow = new MeshBasicMaterial({ color: new Color(1.1, 0.12, 0.08), toneMapped: false, transparent: true, opacity: 0.45, depthWrite: false })
const scanMat = new MeshBasicMaterial({ color: new Color(0.2, 3, 0.6), toneMapped: false })

function Line({ index, v, model, note, car }: { index: number; v: number; model: string; note: string; car: CarModelId | null }) {
  const offset = index * 2.1
  const cars = useRef<(CarHandle | null)[]>([])
  const laser = index === 0

  useFrame(({ clock }) => {
    const step = indexed(clock.elapsedTime + offset, PERIOD, MOVE)
    cars.current.forEach((c, i) => {
      if (!c) return
      const s = mod(step + i, SLOTS)
      c.root.visible = s <= SLOTS - 1
      c.root.position.set(U0 + s * PITCH, 0.55, -v)
    })
  })

  const dwell = (t: number) => isDwelling(t + offset, PERIOD, MOVE)

  const robots = useMemo(() => {
    const out: { u: number; side: 1 | -1; tool: 'gun' | 'laser' }[] = []
    for (let k = 0; k < SLOTS - 1; k++) {
      const u = U0 + k * PITCH
      const isLaser = laser && (k === 5 || k === 6)
      const n = isLaser ? 2 : k % 3 === 0 ? 1 : 2
      for (let j = 0; j < n; j++)
        for (const side of [1, -1] as const)
          out.push({ u: u + (n === 2 ? (j ? 2.2 : -2.2) : 0), side, tool: isLaser ? 'laser' : 'gun' })
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

  return (
    <group>
      {/* челночный конвейер */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[uEnd - U0 + 6, 0.5, 1.6]} position={[(U0 + uEnd) / 2, 0.25, -v]} receiveShadow />
      <mesh geometry={unitBox} material={MAT.yellow} scale={[uEnd - U0 + 6, 0.06, 0.12]} position={[(U0 + uEnd) / 2, 0.52, -(v + 0.8)]} />
      <mesh geometry={unitBox} material={MAT.yellow} scale={[uEnd - U0 + 6, 0.06, 0.12]} position={[(U0 + uEnd) / 2, 0.52, -(v - 0.8)]} />
      <Instanced geometry={unitBox} material={fenceMat} items={fence} />
      <Instanced geometry={unitBox} material={MAT.yellow} items={posts} />

      {Array.from({ length: SLOTS }, (_, i) => (
        <Car key={i} ref={(c) => void (cars.current[i] = c)} model={car ?? pickModel(i)} />
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
          {/* закрытая ячейка лазерной сварки */}
          <mesh geometry={unitBox} material={laserCellMat} scale={[22, 4.2, 0.1]} position={[0, 2.1, 5.4]} />
          <mesh geometry={unitBox} material={laserCellMat} scale={[22, 4.2, 0.1]} position={[0, 2.1, -5.4]} />
          <mesh geometry={unitBox} material={laserCellMat} scale={[22, 0.1, 10.8]} position={[0, 4.2, 0]} />
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
      <mesh geometry={unitBox} material={MAT.blueRack} scale={[2.4, 1.6, 1.2]} position={[U0 - 3, 0.8, -(v + 4)]} />

      <Label position={[U0 - 6, 5, -v]} color="#ff8a3d" small>
        Линия {index + 1} · {model}
        {note && <em> · {note}</em>}
      </Label>
    </group>
  )
}

function Scanner() {
  const ref = useRef<Mesh>(null!)
  useFrame(({ clock }) => {
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
