import { useProductionFrame, useProductionEnabled, StageScope } from '../simulation/ProductionClock'
import { Text } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import { Color, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, type Group, type Mesh } from 'three'
import { CAR_COLORS, MAT, paint, unitBox, unitCyl } from './assets'
import { Car, type CarHandle } from './Car'
import { pickModel } from './carModels'
import { track } from './carUnits'
import { useGlbAssets } from './glbAssets'
import { OptionalGlb } from './OptionalGlb'
import { Instanced } from './Hall'
import { Conveyor, ControlCabinets, PartsRacks } from './Industrial'
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
const tunnelLight = new MeshBasicMaterial({ color: new Color(1.25, 1.3, 1.34), toneMapped: false })
const waterGlass = new MeshStandardMaterial({ color: '#7fb6e6', transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false })
const dropMat = new MeshBasicMaterial({ color: '#d7ecff', transparent: true, opacity: 0.7, depthWrite: false })
const lift = paint('#f2a900', 0.3, 0.5)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Конвейер сборки: кузов «обрастает» стёклами и колёсами по ходу. */
function AssemblyCars() {
  const path = useMemo(() => makePath(ASM_PATH, 4), [])
  const length = useMemo(() => path.getLength(), [path])
  const count = Math.floor(length / POST)
  const cars = useRef<(CarHandle | null)[]>([])
  const hangers = useRef<(Group | null)[]>([])
  const units = useMemo(() => Array.from({ length: count }, (_, i) => ({
    key: `assembly:${i}`, place: 'assembly' as const, model: pickModel(i), color: CAR_COLORS[(i * 3) % 5], index: i,
  })), [count])

  useProductionFrame(({ clock }) => {
    const t = clock.elapsedTime
    cars.current.forEach((c, i) => {
      if (!c) return
      const travel = t * SPEED + i * POST
      const dist = mod(travel, count * POST)
      const p = placeOnPath(path, length, dist, c.root)
      const laneB = p.y > 1.2
      const laneC = Math.abs(p.z + LANES[2]) < 0.5
      const laneA = Math.abs(p.z + LANES[0]) < 0.5
      // пост по нумерации LineFurniture: A — 1–20, B — 21–40 (обратный ход), C — 41–59; 0 — переход между ветками
      const post = laneA ? 1 + clamp(Math.floor((p.x - UA) / POST), 0, 19)
        : laneB && Math.abs(p.z + LANES[1]) < 0.5 ? 21 + clamp(Math.floor((UB - p.x) / POST), 0, 19)
        : laneC ? 41 + clamp(Math.floor((p.x - UA) / POST), 0, 18) : 0
      track(c.root, dist / (count * POST), post, Math.floor(travel / (count * POST)))
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
          <Car ref={(c) => void (cars.current[i] = c)} model={pickModel(i)} body={paint(CAR_COLORS[(i * 3) % 5])} unit={units[i]} />
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
  const units = useMemo(() => Array.from({ length: count }, (_, i) => ({
    key: `qc:${i}`, place: 'qc' as const, model: pickModel(i + 3), color: CAR_COLORS[(i * 2) % 5], index: i,
  })), [count])
  useProductionFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    cars.current.forEach((c, i) => {
      if (!c) return
      const travel = t * 1.1 + i * spacing
      const dist = mod(travel, count * spacing)
      const p = placeOnPath(path, length, dist, c.root)
      c.wheels.children.forEach((wheel) => { wheel.rotation.z -= delta * 1.1 / 0.31 })
      // испытательный пост для карточки машины — см. QC_STATIONS в ui/carPassport.ts
      const station = Math.abs(p.z + 72) < 1.5 ? (p.x < 209 ? 0 : p.x < 219 ? 1 : p.x < 229 ? 2 : p.x <= 240 ? 3 : 0)
        : Math.abs(p.z + 48) < 1.5 && p.x > 194 && p.x < 220 ? 4
        : Math.abs(p.z + 24) < 1.5 && p.x > 191 && p.x < 221 ? 5
        : p.z > -12 ? 6 : 0
      track(c.root, dist / (count * spacing), station, Math.floor(travel / (count * spacing)))
    })
  })
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <Car key={i} ref={(c) => void (cars.current[i] = c)} model={units[i].model} body={paint(units[i].color)} glass={MAT.glass} wheels details unit={units[i]} />
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
        <Instanced geometry={unitBox} material={MAT.steel} items={Array.from({ length: 7 }, (_, i) => -12 + i * 4).flatMap((x) => [
          { p: [x, 2.25, 4.05] as [number, number, number], s: [0.12, 4.5, 0.12] as [number, number, number] },
          { p: [x, 2.25, -4.05] as [number, number, number], s: [0.12, 4.5, 0.12] as [number, number, number] },
          { p: [x, 4.25, 0] as [number, number, number], s: [0.08, 0.08, 7.9] as [number, number, number] },
        ])} />
        <mesh geometry={unitBox} material={MAT.darkSteel} scale={[26, 0.04, 3]} position={[0, 0.02, 0]} />
        <Rain />
        <Label position={[0, 6.2, 0]} color="#f472b6" small>
          Дождевальная камера · герметичность
        </Label>
      </group>
      {/* световой туннель финальной инспекции */}
      <group position={[206, 0, -24]}>
        <mesh geometry={unitBox} material={paint('#5b666d', 0.35, 0.5)} scale={[29, 0.03, 6.4]} position={[0, 0.025, 0]} receiveShadow />
        <Instanced geometry={unitBox} material={MAT.darkSteel} items={Array.from({ length: 14 }, (_, i) => -13 + i * 2).flatMap((x) => [
          { p: [x, 1.84, 3.06] as [number, number, number], s: [0.22, 3.68, 0.16] as [number, number, number] },
          { p: [x, 1.84, -3.06] as [number, number, number], s: [0.22, 3.68, 0.16] as [number, number, number] },
          { p: [x, 3.7, 0] as [number, number, number], s: [0.22, 0.16, 6.28] as [number, number, number] },
        ])} />
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
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={[
        { p: [154.35, 2.3, 0.2], s: [0.25, 4.6, 0.4] },
        { p: [159.65, 2.3, 0.2], s: [0.25, 4.6, 0.4] },
        { p: [157, 4.65, 0.2], s: [5.55, 0.3, 0.45] },
      ]} />
    </group>
  )
}

/** Разметка постов, слэт-конвейер, стеллажи комплектации вдоль линии, рабочие. */
function LineFurniture({ detailed }: { detailed: boolean }) {
  const assets = useGlbAssets()
  const conveyor = assets.conveyor && assets.conveyor.length <= POST * 2 ? assets.conveyor : null
  const sectionLength = conveyor?.length ?? POST
  const sectionX = UA + 10.5 * POST
  const { racks, slats, marks } = useMemo(() => {
    const racks: [number, number, number][] = []
    const marks: { p: [number, number, number]; s: [number, number, number] }[] = []
    LANES.forEach((v) => {
      for (let k = 0; k <= 20; k++) {
        const u = UA + k * POST
        marks.push({ p: [u, 0.05, -v], s: [0.12, 0.02, 4.8] })
        if (k < 20) {
          racks.push([u + POST / 2, 0, -(v - 4.6)])
          racks.push([u + POST / 2, 0, -(v + 4.6)])
        }
      }
    })
    // Leave a separate slot in lane C so the GLB never overlaps a solid belt.
    const start = UA - 3
    const end = UB + 3
    const left = sectionX - sectionLength / 2
    const right = sectionX + sectionLength / 2
    const slats = [
      { p: [(UA + UB) / 2, 0.15, -LANES[0]] as [number, number, number], s: [end - start, 0.3, 3.2] as [number, number, number] },
      { p: [(start + left) / 2, 0.15, -LANES[2]] as [number, number, number], s: [left - start, 0.3, 3.2] as [number, number, number] },
      { p: [(right + end) / 2, 0.15, -LANES[2]] as [number, number, number], s: [end - right, 0.3, 3.2] as [number, number, number] },
    ]
    return { racks, slats, marks }
  }, [sectionLength, sectionX])

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
      <PartsRacks positions={racks} />
      {slats.map((section, i) => <Conveyor key={i} length={section.s[0]} position={[section.p[0], 0, section.p[2]]} />)}
      <ControlCabinets positions={posts.filter((p) => p.n % 5 === 0).map((p) => [p.u + 2.5, 0, -(p.v - 3.4)])} />
      <group position={[sectionX, 0, -LANES[2]]}>
        <OptionalGlb spec={conveyor} enabled={detailed} conveyor>
          <Conveyor length={sectionLength} />
        </OptionalGlb>
      </group>
      <Instanced geometry={unitBox} material={postLine} items={marks} />
      {/* балка подвесного конвейера ветки B */}
      <mesh geometry={unitBox} material={MAT.darkSteel} scale={[UB - UA + 8, 0.5, 0.4]} position={[(UA + UB) / 2, 6.6, -LANES[1]]} />
      <mesh geometry={unitBox} material={MAT.steel} scale={[UB - UA + 8, 0.09, 0.7]} position={[(UA + UB) / 2, 6.87, -LANES[1]]} />
      <Instanced geometry={unitBox} material={MAT.darkSteel} items={Array.from({ length: 8 }, (_, i) => UA + i * (UB - UA) / 7).flatMap((u) => [
        { p: [u, 3.35, -LANES[1] - 3.5] as [number, number, number], s: [0.18, 6.7, 0.2] as [number, number, number] },
        { p: [u, 3.35, -LANES[1] + 3.5] as [number, number, number], s: [0.18, 6.7, 0.2] as [number, number, number] },
        { p: [u, 6.65, -LANES[1]] as [number, number, number], s: [0.22, 0.3, 7.3] as [number, number, number] },
      ])} />
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

export function Assembly({ detailed = true }: { detailed?: boolean }) {
  const simulated = useProductionEnabled()
  return (
    <group>
      <LineFurniture detailed={detailed} />
      {!simulated && <AssemblyCars />}
      <StageScope stage="qc"><QcStations /></StageScope>
      {!simulated && <QcCars />}
    </group>
  )
}
