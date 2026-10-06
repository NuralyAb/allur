import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group } from 'three'
import { CAR_COLORS, MAT, paint, unitBox, unitCyl, wheelGeo } from './assets'
import { Car } from './Car'
import { Instanced } from './Hall'
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
const liftMat = paint('#1f5fae', 0.4, 0.5)
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
          <mesh geometry={unitBox} material={liftMat} scale={[0.35, 2.6, 0.35]} position={[0, 1.3, 1.6]} />
          <mesh geometry={unitBox} material={liftMat} scale={[0.35, 2.6, 0.35]} position={[0, 1.3, -1.6]} />
          <Car body={paint(CAR_COLORS[(i + 1) % 5])} glass={MAT.glass} wheels position={[0, 1.4, 0]} rotation={[0, Math.PI / 2, 0]} />
          <Worker position={[1.6, 0, 0]} yaw={Math.PI} phase={i * 2} />
        </group>
      ))}
      {/* окрасочно-сушильная камера */}
      <group position={[44, 0, -122]}>
        <mesh geometry={unitBox} material={boothGlass} scale={[8, 4, 6]} position={[0, 2, 0]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[8.2, 0.3, 6.2]} position={[0, 4.1, 0]} />
        <Car body={paint(CAR_COLORS[3])} glass={MAT.glass} wheels />
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
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[48, 0.2, 3]} position={[28, 0.1, -91]} />
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
  const machines = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (let u = 222; u <= 242; u += 6.5)
      for (const v of [164, 174]) out.push({ p: [u, 1, -v], s: [4, 2, 2.4] })
    return out
  }, [])
  const benches = useMemo<Item[]>(() => [196, 202, 208, 214].map((u) => ({ p: [u + 2, 0.5, -187.5], s: [4, 1, 1.4] })), [])
  return (
    <group>
      <Instanced geometry={unitBox} material={machineMat} items={machines} />
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
