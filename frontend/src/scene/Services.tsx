import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group } from 'three'
import { CAR_COLORS, MAT, paint, unitBox, unitCyl, wheelGeo } from './assets'
import { Car } from './Car'
import { pickModel } from './carModels'
import { Instanced } from './Hall'
import { Conveyor, ControlCabinets, type IndustrialItem } from './Industrial'
import { Label } from './Label'
import { Worker } from './Worker'

/*
 * Вспомогательные цеха из проекта НДВ ТОО «СарыаркаАвтоПром» (карта-схема источников выбросов):
 * котельная (0038–0041), ЦУД (0008–0012), ЦСКТ (0028–0030), РИЦ (0035–0037), лаборатория (0047–0048).
 */

type Item = { p: [number, number, number]; s: [number, number, number] }

const annexWall = paint('#e6e8ea', 0.1, 0.7)
const chimney = paint('#9aa1a8', 0.6, 0.4)
const boothGlass = new MeshStandardMaterial({ color: '#cfe3f1', transparent: true, opacity: 0.22, depthWrite: false })
const liftMat = paint('#506e82', 0.4, 0.5)
const truckCab = paint('#e9ecef', 0.3, 0.4)
const machineMat = paint('#5c7a8a', 0.4, 0.5)

/** Пристройка вдоль юго-западной стены с котельной — видна и снаружи, с кровлей. */
export function BoilerAnnex() {
  // четыре трубы котельной — по координатам источников 0038–0041
  const stacks: [number, number][] = [
    [301, -9],
    [298, -16],
    [288, -11],
    [303, -9.5],
  ]
  return (
    <group>
      <mesh geometry={unitBox} material={annexWall} scale={[195, 9, 24]} position={[262.5, 4.5, 12]} castShadow receiveShadow />
      <mesh geometry={unitBox} material={paint('#697780', 0.35, 0.6)} scale={[196, 0.35, 25]} position={[262.5, 9.15, 12]} castShadow />
      <Instanced geometry={unitBox} material={paint('#b7c1c5', 0.25, 0.65)} items={Array.from({ length: 39 }, (_, i) => ({ p: [168 + i * 5, 4.45, 24.04] as [number, number, number], s: [0.09, 8.9, 0.05] as [number, number, number] }))} />
      <Instanced geometry={unitBox} material={MAT.glass} items={Array.from({ length: 16 }, (_, i) => ({ p: [172 + i * 11.5, 6.4, 24.08] as [number, number, number], s: [7.5, 1.25, 0.08] as [number, number, number] }))} />
      <Instanced geometry={unitBox} material={paint('#53636c', 0.4, 0.6)} items={[185, 242, 318, 349].map((u) => ({ p: [u, 2.1, 24.12] as [number, number, number], s: [4.2, 4.2, 0.08] as [number, number, number] }))} />
      {stacks.map(([u, v], i) => (
        <mesh key={i} geometry={unitCyl} material={chimney} scale={[0.9, 26, 0.9]} position={[u + i * 0.6, 13, -v]} castShadow />
      ))}
      <Label position={[296, 29, 12]} color="#cbd5e1" small>
        Котельная · 4 трубы (НДВ)
      </Label>
    </group>
  )
}

/** ЦУД: посты доработки с двухстоечными подъёмниками, окрасочная и сушильная камеры. */
function Cud() {
  const posts = [10, 19, 28]
  return (
    <group>
      {posts.map((u, i) => (
        <group key={u} position={[u, 0, -122]}>
          {/* двухстоечный подъёмник: стойки по бокам машины, лапы под порогами */}
          <mesh geometry={unitBox} material={liftMat} scale={[0.35, 2.6, 0.35]} position={[1.35, 1.3, 0]} />
          <mesh geometry={unitBox} material={liftMat} scale={[0.35, 2.6, 0.35]} position={[-1.35, 1.3, 0]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[2.5, 0.08, 1.6]} position={[0, 1.42, 0]} />
          <Car
            model={pickModel(i + 1)}
            body={paint(CAR_COLORS[(i + 1) % 5])}
            glass={MAT.glass}
            wheels
            details
            position={[0, 1.4, 0]}
            rotation={[0, Math.PI / 2, 0]}
          />
          <Worker position={[0.4, 0, -2.6]} yaw={Math.PI / 2} phase={i * 2} />
        </group>
      ))}
      {/* окрасочно-сушильная камера */}
      <group position={[44, 0, -122]}>
        <mesh geometry={unitBox} material={boothGlass} scale={[8, 4, 6]} position={[0, 2, 0]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[8.2, 0.3, 6.2]} position={[0, 4.1, 0]} />
        <Car model="cobalt" body={paint(CAR_COLORS[3])} glass={MAT.glass} wheels details />
      </group>
      <Label position={[28, 6, -122]} color="#fb923c" small>
        Посты доработки · окрасочная камера
      </Label>
    </group>
  )
}

/** Шасси коммерческого автомобиля (грузовик/автобус на линии ЦСКТ). */
function Chassis() {
  return (
    <group>
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[8, 0.3, 0.2]} position={[0, 0.9, 0.5]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[8, 0.3, 0.2]} position={[0, 0.9, -0.5]} />
      <mesh geometry={unitBox} material={truckCab} scale={[2, 2.4, 2.3]} position={[3.4, 2.1, 0]} />
      <mesh geometry={unitBox} material={MAT.glass} scale={[0.035, 0.88, 2.03]} position={[4.42, 2.64, 0]} />
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.09, 0.6, 1.65]} position={[4.43, 1.52, 0]} />
      <Instanced geometry={unitBox} material={MAT.glass} items={[-1.17, 1.17].map((z) => ({ p: [3.58, 2.6, z] as [number, number, number], s: [1.24, 0.82, 0.035] as [number, number, number] }))} />
      <Instanced geometry={unitBox} material={MAT.steel} items={[-3.5, -2, -0.5, 1, 2.3].map((x) => ({ p: [x, 0.9, 0] as [number, number, number], s: [0.12, 0.2, 1.2] as [number, number, number] }))} />
      {[-3, -1.6, 3].flatMap((x) =>
        [1.05, -1.05].map((z) => <mesh key={`${x}${z}`} geometry={wheelGeo} material={MAT.tyre} position={[x, 0.45, z]} scale={1.45} />),
      )}
    </group>
  )
}

function Cskt() {
  const ref = useRef<Group>(null!)
  useFrame(({ clock }) => {
    // медленный пульсирующий конвейер шасси
    ref.current.position.x = ((clock.elapsedTime * 0.25) % 14) - 7
  })
  return (
    <group>
      <Conveyor length={48} width={3} height={0.2} position={[28, 0, -91]} />
      <group ref={ref}>
        {[10, 24, 38].map((u) => (
          <group key={u} position={[u, 0, -91]}>
            <Chassis />
          </group>
        ))}
      </group>
      {[12, 26, 40].map((u, i) => (
        <Worker key={u} position={[u, 0, -(91 + 2.6)]} yaw={-Math.PI / 2} phase={i * 1.7} />
      ))}
      <Label position={[28, 6, -91]} color="#84cc16" small>
        Линия коммерческой техники
      </Label>
    </group>
  )
}

/** РИЦ (станки) и центральная заводская лаборатория. */
function Ric() {
  const machines = useMemo(() => {
    const out: IndustrialItem[] = []
    for (let u = 222; u <= 242; u += 6.5)
      for (const v of [164, 174]) out.push({ p: [u, 1, -v], s: [4, 2, 2.4] })
    return out
  }, [])
  const benches = useMemo<Item[]>(() => [196, 202, 208, 214].map((u) => ({ p: [u + 2, 0.5, -187.5], s: [4, 1, 1.4] })), [])
  return (
    <group>
      <Instanced geometry={unitBox} material={machineMat} items={machines.map(({ p }) => ({ p: [p[0], 0.32, p[2]], s: [4, 0.64, 2.4] }))} />
      <Instanced geometry={unitBox} material={MAT.wall} items={machines.flatMap(({ p }) => [
        { p: [p[0], 1.55, p[2] - 0.8], s: [4, 1.85, 0.75] },
        { p: [p[0] - 1.7, 1.55, p[2]], s: [0.6, 1.85, 2.3] },
        { p: [p[0] + 1.7, 1.55, p[2]], s: [0.6, 1.85, 2.3] },
        { p: [p[0], 2.45, p[2]], s: [4, 0.15, 2.4] },
      ])} />
      <Instanced geometry={unitBox} material={MAT.glass} items={machines.map(({ p }) => ({ p: [p[0], 1.62, p[2] + 1.12], s: [2.45, 1.24, 0.055] }))} />
      <Instanced geometry={unitBox} material={MAT.steel} items={machines.flatMap(({ p }) => [
        { p: [p[0], 0.94, p[2]], s: [2.4, 0.3, 1.4] },
        { p: [p[0], 1.63, p[2] + 1.17], s: [0.06, 1.3, 0.04] },
        { p: [p[0] + 0.2, 1.63, p[2] + 1.22], s: [0.035, 0.25, 0.07] },
      ])} />
      <ControlCabinets positions={machines.map(({ p }) => [p[0] + 2.55, 0, p[2] + 0.8])} />
      <Instanced geometry={unitBox} material={MAT.wall} items={benches} />
      {/* вытяжные шкафы лаборатории — источники 0047–0048 */}
      <mesh geometry={unitBox} material={MAT.steel} scale={[6, 2.4, 1]} position={[207, 1.2, -183.5]} />
      <Worker position={[234, 0, -169]} yaw={0} phase={1} />
      <Worker position={[203, 0, -185.6]} yaw={Math.PI / 2} phase={2} />
      <Label position={[232, 5, -169]} color="#e879f9" small>
        РИЦ · станки
      </Label>
      <Label position={[206, 5, -188]} color="#e879f9" small>
        Лаборатория
      </Label>
    </group>
  )
}

export function Services() {
  return (
    <group>
      <Cud />
      <Cskt />
      <Ric />
    </group>
  )
}
