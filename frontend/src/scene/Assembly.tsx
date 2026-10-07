import { useProductionFrame, useProductionEnabled, StageScope } from '../simulation/ProductionClock'
import { Text } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import { Color, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, type Group, type Mesh } from 'three'
import { CAR_COLORS, MAT, paint, unitBox, unitCyl } from './assets'
import { Car, type CarHandle } from './Car'
import { pickModel } from './carModels'
import { Instanced } from './Hall'
import { Label } from './Label'
import { makePath, mod, placeOnPath, type P3 } from './motion'
import { Robot } from './Robot'
import { Worker } from './Worker'

/*
 * Главный сборочный конвейер — 59 рабочих постов (nur.kz) в центре корпуса. Конец линий —
 * ТРК заправки (источники НДВ 0043–0046, u≈195–215). Змейка из трёх веток:
 *  A (v=146) — монтаж салона, проводки, панели приборов; ветка у склада комплектующих;
 *  B (v=122) — подвесной конвейер: топливная и тормозная магистрали снизу, вклейка стёкол;
 *  C (v=98)  — «свадьба» кузова с силовым агрегатом, колёса, заправка жидкостями, ТРК.
 * Далее ОТК (u 160–245, v 5–80): сход-развал, фары, тормозной стенд, дождевальная камера,
 * световой туннель; выезд через ворота в юго-западной стене.
 */

const LANES = [146, 122, 98]
const UA = 72
const UB = 200
const POST = (UB - UA) / 20 // 6.4 м
const SPEED = 0.42

export const ASM_PATH: P3[] = [
  [UA - 4, 0.35, -LANES[0]],
  [UB, 0.35, -LANES[0]],
  [UB + 3, 1.0, -(LANES[0] + LANES[1]) / 2],
  [UB, 1.7, -LANES[1]],
  [UA, 1.7, -LANES[1]],
  [UA - 3, 1.0, -(LANES[1] + LANES[2]) / 2],
  [UA, 0.35, -LANES[2]],
  [UB + 2, 0.35, -LANES[2]],
]

export const QC_PATH: P3[] = [
  [UB + 3, 0, -LANES[2]],
  [206, 0, -86],
  [206, 0, -72],
  [242, 0, -72],
  [242, 0, -48],
  [172, 0, -48],
  [172, 0, -24],
  [240, 0, -24],
  [240, 0, -10],
  [158, 0, -10],
  [157, 0, 10],
]

const postLine = new MeshBasicMaterial({ color: '#f2c200' })
const tunnelLight = new MeshBasicMaterial({ color: new Color(3, 3, 3), toneMapped: false })
const waterGlass = new MeshStandardMaterial({ color: '#7fb6e6', transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false })
const dropMat = new MeshBasicMaterial({ color: '#d7ecff', transparent: true, opacity: 0.7, depthWrite: false })
const lift = paint('#f2a900', 0.3, 0.5)
const rackMat = paint('#5b6b7c', 0.4, 0.55)

/** Конвейер сборки: кузов «обрастает» стёклами и колёсами по ходу. */
function AssemblyCars() {
  const path = useMemo(() => makePath(ASM_PATH, 4), [])
  const length = useMemo(() => path.getLength(), [path])
  const count = Math.floor(length / POST)
  const cars = useRef<(CarHandle | null)[]>([])
  const hangers = useRef<(Group | null)[]>([])

  useProductionFrame(({ clock }) => {
    const t = clock.elapsedTime
    cars.current.forEach((c, i) => {
      if (!c) return
      const dist = mod(t * SPEED + i * POST, count * POST)
      const p = placeOnPath(path, length, dist, c.root)
      const laneB = p.y > 1.2
      const laneC = Math.abs(p.z + LANES[2]) < 0.5
      c.setGlass(laneB && p.x < UB - 18 ? MAT.glass : laneC ? MAT.glass : MAT.opening)
      c.setWheels(laneC && p.x > UA + 4 * POST)
      c.setDetails(laneB || laneC)
      const h = hangers.current[i]
      if (h) h.visible = laneB
    })
  })

  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <group key={i}>
          <Car ref={(c) => void (cars.current[i] = c)} model={pickModel(i)} body={paint(CAR_COLORS[(i * 3) % 5])} />
        </group>
      ))}
      {/* подвески подвесного конвейера едут вместе с кузовами ветки B */}
      <HangerFollowers cars={cars} hangers={hangers} count={count} />
    </group>
  )
}

function HangerFollowers({
  cars,
  hangers,
  count,
}: {
  cars: React.RefObject<(CarHandle | null)[]>
  hangers: React.RefObject<(Group | null)[]>
  count: number
}) {
  useProductionFrame(() => {
    hangers.current.forEach((h, i) => {
      const c = cars.current[i]
      if (!h || !c) return
      h.position.copy(c.root.position)
      h.rotation.copy(c.root.rotation)
    })
  })
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} ref={(g) => void (hangers.current[i] = g)} visible={false}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.15, 3.6, 0.15]} position={[-1.6, 2.6, 1.05]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.15, 3.6, 0.15]} position={[1.6, 2.6, 1.05]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.15, 3.6, 0.15]} position={[-1.6, 2.6, -1.05]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.15, 3.6, 0.15]} position={[1.6, 2.6, -1.05]} />
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[3.6, 0.15, 2.3]} position={[0, 0.35, 0]} />
        </group>
      ))}
    </group>
  )
}

/** ОТК: готовые машины проходят испытательные посты. */
function QcCars() {
  const path = useMemo(() => makePath(QC_PATH, 4), [])
  const length = useMemo(() => path.getLength(), [path])
  const spacing = 13
  const count = Math.floor(length / spacing)
  const cars = useRef<(CarHandle | null)[]>([])
  useProductionFrame(({ clock }) => {
    const t = clock.elapsedTime
    cars.current.forEach((c, i) => {
      if (!c) return
      placeOnPath(path, length, mod(t * 1.1 + i * spacing, count * spacing), c.root)
      c.wheels.children.forEach((w) => (w.rotation.z -= 0.08))
    })
  })
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <Car
          key={i}
          ref={(c) => void (cars.current[i] = c)}
          model={pickModel(i + 3)}
          body={paint(CAR_COLORS[(i * 2) % 5])}
          glass={MAT.glass}
          wheels
          details
        />
      ))}
    </group>
  )
}

function Rain() {
  const ref = useRef<InstancedMesh>(null!)
  const N = 260
  const seeds = useMemo(() => Array.from({ length: N }, () => [Math.random() * 24 - 12, Math.random() * 7 - 3.5, Math.random()]), [])
  const o = useMemo(() => new Object3D(), [])
  useProductionFrame(({ clock }) => {
    seeds.forEach(([x, z, s], i) => {
      o.position.set(x, 4.2 - ((clock.elapsedTime * 1.6 + s) % 1) * 4.2, z)
      o.scale.set(0.03, 0.35, 0.03)
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  })
  return <instancedMesh ref={ref} args={[unitBox, dropMat, N]} frustumCulled={false} />
}

function Rollers() {
  const ref = useRef<Group>(null!)
  useProductionFrame(() => ref.current.children.forEach((m) => ((m as Mesh).rotation.x += 0.25)))
  return (
    <group ref={ref}>
      {[-1.35, 1.35].flatMap((x) =>
        [-0.8, 0.8].map((z) => (
          <mesh key={`${x}${z}`} geometry={unitCyl} material={MAT.steel} scale={[0.3, 0.7, 0.3]} position={[x, 0.08, z]} rotation={[0, 0, Math.PI / 2]} />
        )),
      )}
    </group>
  )
}

function QcStations() {
  return (
    <group>
      {/* сход-развал */}
      <group position={[214, 0, -72]}>
        <mesh geometry={unitBox} material={MAT.yellow} scale={[5, 0.25, 3.6]} position={[0, 0.12, 0]} />
        {[-1.4, 1.4].flatMap((x) =>
          [-2.2, 2.2].map((z) => <mesh key={`${x}${z}`} geometry={unitBox} material={MAT.darkSteel} scale={[0.25, 1.2, 0.25]} position={[x, 0.6, z]} />),
        )}
        <Label position={[0, 3.5, 0]} color="#f472b6" small>
          Сход-развал
        </Label>
      </group>
      {/* регулировка фар */}
      <group position={[224, 0, -72]}>
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.4, 1.6, 0.4]} position={[-4, 0.8, 2.4]} />
        <mesh geometry={unitBox} material={MAT.wall} scale={[0.6, 0.5, 0.7]} position={[-4, 1.1, 2.4]} />
        <Label position={[0, 3.5, 0]} color="#f472b6" small>
          Регулировка фар
        </Label>
      </group>
      {/* роликовый тормозной стенд */}
      <group position={[234, 0, -72]}>
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[4.6, 0.1, 2.6]} position={[0, 0.03, 0]} />
        <Rollers />
        <mesh geometry={unitBox} material={MAT.wall} scale={[0.8, 1.8, 0.6]} position={[0, 0.9, 3]} />
        <Label position={[0, 3.5, 0]} color="#f472b6" small>
          Тормозной стенд
        </Label>
      </group>
      {/* дождевальная камера */}
      <group position={[207, 0, -48]}>
        <mesh geometry={unitBox} material={waterGlass} scale={[26, 4.5, 0.1]} position={[0, 2.25, 4]} />
        <mesh geometry={unitBox} material={waterGlass} scale={[26, 4.5, 0.1]} position={[0, 2.25, -4]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[26, 0.2, 8.2]} position={[0, 4.5, 0]} />
        <Rain />
        <Label position={[0, 6.2, 0]} color="#f472b6" small>
          Дождевальная камера · герметичность
        </Label>
      </group>
      {/* световой туннель финальной инспекции */}
      <group position={[206, 0, -24]}>
        {Array.from({ length: 14 }, (_, i) => (
          <group key={i} position={[-13 + i * 2, 0, 0]}>
            <mesh geometry={unitBox} material={tunnelLight} scale={[0.15, 3.6, 0.1]} position={[0, 1.8, 3]} />
            <mesh geometry={unitBox} material={tunnelLight} scale={[0.15, 3.6, 0.1]} position={[0, 1.8, -3]} />
            <mesh geometry={unitBox} material={tunnelLight} scale={[0.15, 0.1, 6]} position={[0, 3.6, 0]} />
          </group>
        ))}
        <Worker position={[-6, 0, 2.2]} yaw={Math.PI / 2} phase={1} />
        <Worker position={[6, 0, -2.2]} yaw={-Math.PI / 2} phase={2} />
        <Label position={[0, 5.5, 0]} color="#f472b6" small>
          Световой туннель · финальная инспекция
        </Label>
      </group>
      {/* ворота выезда в юго-западной стене */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[5, 4.5, 0.7]} position={[157, 2.25, 0.2]} />
    </group>
  )
}

/** Разметка постов, слэт-конвейер, стеллажи комплектации вдоль линии, рабочие. */
function LineFurniture() {
  const { racks, slats, marks } = useMemo(() => {
    const racks: { p: [number, number, number]; s: [number, number, number] }[] = []
    const marks: { p: [number, number, number]; s: [number, number, number] }[] = []
    LANES.forEach((v) => {
      for (let k = 0; k <= 20; k++) {
        const u = UA + k * POST
        marks.push({ p: [u, 0.05, -v], s: [0.12, 0.02, 4.8] })
        if (k < 20) {
          racks.push({ p: [u + POST / 2, 0.7, -(v - 4.6)], s: [3.6, 1.4, 0.9] })
          racks.push({ p: [u + POST / 2, 0.7, -(v + 4.6)], s: [3.6, 1.4, 0.9] })
        }
      }
    })
    const slats = [LANES[0], LANES[2]].map((v) => ({ p: [(UA + UB) / 2, 0.15, -v] as [number, number, number], s: [UB - UA + 6, 0.3, 3.2] as [number, number, number] }))
    return { racks, slats, marks }
  }, [])

  const posts = useMemo(() => {
    const out: { n: number; u: number; v: number }[] = []
    // нумерация по ходу конвейера: A → B (обратно) → C
    for (let k = 0; k < 20; k++) out.push({ n: k + 1, u: UA + (k + 0.5) * POST, v: LANES[0] })
    for (let k = 0; k < 20; k++) out.push({ n: 21 + k, u: UB - (k + 0.5) * POST, v: LANES[1] })
    for (let k = 0; k < 19; k++) out.push({ n: 41 + k, u: UA + (k + 0.5) * POST, v: LANES[2] })
    return out
  }, [])

  return (
    <group>
      <Instanced geometry={unitBox} material={rackMat} items={racks} />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={slats} />
      <Instanced geometry={unitBox} material={postLine} items={marks} />
      {/* балка подвесного конвейера ветки B */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[UB - UA + 8, 0.5, 0.4]} position={[(UA + UB) / 2, 6.6, -LANES[1]]} />
      {/* номера постов: шрифт грузится отдельно и не задерживает сцену */}
      <Suspense fallback={null}>
        {posts.map((p) => (
          <Text
            font="/fonts/Manrope.ttf"
            key={p.n}
            position={[p.u, 0.07, -(p.v - 2.9)]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.9}
            color="#f2c200"
            anchorX="center"
            anchorY="middle"
          >
            {String(p.n)}
          </Text>
        ))}
      </Suspense>
      {posts.map((p) => (
        <group key={p.n}>
          {p.n % 2 === 0 ? (
            <Worker position={[p.u, 0, -(p.v + 2.5)]} yaw={-Math.PI / 2} phase={p.n} />
          ) : (
            <Worker position={[p.u, 0, -(p.v - 2.5)]} yaw={Math.PI / 2} phase={p.n} />
          )}
        </group>
      ))}
      {/* робот вклейки стёкол в начале ветки B */}
      <Robot position={[UB - 8, 0, -(LANES[1] - 4)]} yaw={Math.PI / 2} tool="gripper" speed={0.8} />
      {/* «свадьба»: подъёмник с силовым агрегатом под кузовом */}
      <Marriage />
      {/* ТРК в конце линии — источники 0043–0046 проекта НДВ */}
      <group position={[UB - 3, 0, -(LANES[2] - 3.8)]}>
        <mesh geometry={unitBox} material={MAT.wall} scale={[1.2, 1.9, 0.7]} position={[0, 0.95, 0]} />
        <mesh geometry={unitBox} material={paint('#d62828', 0.2, 0.5)} scale={[1.25, 0.35, 0.75]} position={[0, 1.75, 0]} />
        <Label position={[0, 3.2, 0]} color="#facc15" small>
          ТРК · заправка топливом
        </Label>
      </group>
      {/* заправка жидкостями — стойки с рукавами */}
      {[0, 1, 2].map((i) => (
        <group key={i} position={[UB - 10 - i * POST, 0, -(LANES[2] + 3.6)]}>
          <mesh geometry={unitBox} material={MAT.wall} scale={[0.8, 2.2, 0.8]} position={[0, 1.1, 0]} />
          <mesh geometry={unitCyl} material={MAT.darkSteel} scale={[0.06, 2.8, 0.06]} position={[0, 3.2, 1.2]} rotation={[0.5, 0, 0]} />
        </group>
      ))}
      <Label position={[UA - 6, 5, -LANES[0]]} color="#facc15" small>
        Посты 1–20 · салон и проводка
      </Label>
      <Label position={[UB + 6, 7, -LANES[1]]} color="#facc15" small>
        Посты 21–40 · подвесной конвейер, стёкла
      </Label>
      <Label position={[UA - 6, 5, -LANES[2]]} color="#facc15" small>
        Посты 41–59 · «свадьба», колёса, заправка
      </Label>
    </group>
  )
}

function Marriage() {
  const ref = useRef<Group>(null!)
  useProductionFrame(({ clock }) => {
    ref.current.position.y = 0.1 + Math.max(0, Math.sin(clock.elapsedTime * 0.5)) * 0.5
  })
  return (
    <group position={[UA + 2.5 * POST, 0, -LANES[2]]}>
      <mesh geometry={unitBox} material={lift} scale={[4.2, 0.3, 2.4]} position={[0, 0.15, 0]} />
      <group ref={ref}>
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.9, 0.7, 0.8]} position={[1.4, 0.7, 0]} />
        <mesh geometry={unitBox} material={MAT.steel} scale={[3.2, 0.15, 1.4]} position={[0, 0.35, 0]} />
      </group>
    </group>
  )
}

export function Assembly() {
  const simulated = useProductionEnabled()
  return (
    <group>
      <LineFurniture />
      {!simulated && <AssemblyCars />}
      <StageScope stage="qc"><QcStations /></StageScope>
      {!simulated && <QcCars />}
    </group>
  )
}
