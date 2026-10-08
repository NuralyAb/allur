import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ExtrudeGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Shape,
  ShapeGeometry,
  CanvasTexture,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
} from 'three'
import type { HallFrame, XY } from '../../shared/types'
import { MAT, unitBox, unitCyl } from '../core/assets'
import { surfaceTile } from '../core/surfaces'

const glassWall = new MeshStandardMaterial({ color: '#859da9', metalness: 0.15, roughness: 0.18, transparent: true, opacity: 0.48, depthWrite: false })
const skylight = new MeshStandardMaterial({ color: '#dfe6e9', roughness: 0.3, metalness: 0.2 })
const concreteTexture = surfaceTile('concrete', 1 / 12)
const roofTexture = surfaceTile('roof', 1 / 10)
// Пол как на видео с завода: светлый наливной, глянцевый, с отражениями светильников.
const epoxy = new MeshStandardMaterial({ color: '#c2c7c6', map: concreteTexture, bumpMap: concreteTexture, bumpScale: 0.01, roughness: 0.38, metalness: 0.04 })
// Кровля светлая: на аэросъёмке корпус белый с частой сеткой зенитных фонарей.
const roofFinish = new MeshStandardMaterial({ color: '#c6ccce', map: roofTexture, bumpMap: roofTexture, bumpScale: 0.045, roughness: 0.7, metalness: 0.12 })
const aisleLine = new MeshStandardMaterial({ color: '#f1c40f', roughness: 0.55, metalness: 0.05 })
const aisleWhite = new MeshStandardMaterial({ color: '#e8ebea', roughness: 0.55, metalness: 0.05 })
const trim = new MeshStandardMaterial({ color: '#42525c', roughness: 0.52, metalness: 0.45 })
const panelRib = new MeshStandardMaterial({ color: '#afb9bd', roughness: 0.68, metalness: 0.18 })
const led = new MeshStandardMaterial({ color: '#dfe8e9', emissive: '#dfe8e9', emissiveIntensity: 0.55 })
const servicePanel = new MeshStandardMaterial({ color: '#879497', roughness: 0.72, metalness: 0.26 })
const shutter = new MeshStandardMaterial({ color: '#647175', map: roofTexture, roughness: 0.69, metalness: 0.35 })

type HallItem = { p: [number, number, number]; s: [number, number, number]; r?: number; rz?: number }

/** Roof services share geometry; their scale reads correctly in the site overview. */
function RoofServices({ units, height }: { units: HallItem[]; height: number }) {
  const fans = useMemo<HallItem[]>(() => units.flatMap(({ p }) => [-1.35, 1.35].map(x => ({ p: [p[0] + x, height + 2.08, p[2]], s: [1.35, 0.12, 1.35] }))), [units, height])
  const louvers = useMemo<HallItem[]>(() => units.flatMap(({ p }) => Array.from({ length: 7 }, (_, i) => ({ p: [p[0], height + 0.66 + i * 0.18, p[2] + 1.62], s: [4.1, 0.055, 0.04] }))), [units, height])
  const plinths = useMemo<HallItem[]>(() => units.map(({ p }) => ({ p: [p[0], height + 0.32, p[2]], s: [5.1, 0.35, 3.5] })), [units, height])
  return <group>
    <Instanced geometry={unitBox} material={trim} items={plinths} castShadow />
    <Instanced geometry={unitBox} material={servicePanel} items={units} castShadow />
    <Instanced geometry={unitCyl} material={trim} items={fans} />
    <Instanced geometry={unitBox} material={trim} items={louvers} />
  </group>
}

function FacadeBays({ length, height }: { length: number; height: number }) {
  const details = useMemo(() => {
    const doors: HallItem[] = [], frames: HallItem[] = [], ribs: HallItem[] = [], bollards: HallItem[] = []
    for (let x = -length / 2 + 24; x < length / 2 - 18; x += 44) {
      doors.push({ p: [x, 2.25, 0.28], s: [5.2, 4.5, 0.15] })
      frames.push({ p: [x, 4.65, 0.46], s: [5.8, 0.28, 0.8] })
      for (const side of [-1, 1]) {
        frames.push({ p: [x + side * 2.8, 2.3, 0.38], s: [0.18, 4.6, 0.25] })
        bollards.push({ p: [x + side * 3.15, 0.62, 1.1], s: [0.16, 1.24, 0.16] })
      }
      for (let y = 0.4; y < 4.4; y += 0.36) ribs.push({ p: [x, y, 0.365], s: [5.05, 0.035, 0.03] })
    }
    const mullions: HallItem[] = []
    for (let x = -length / 2 + 5; x < length / 2 - 4; x += 6) mullions.push({ p: [x, height - 2.2, 0.3], s: [0.075, 1.45, 0.05] })
    return { doors, frames, ribs, bollards, mullions }
  }, [length, height])
  return <group>
    <Instanced geometry={unitBox} material={shutter} items={details.doors} />
    <Instanced geometry={unitBox} material={trim} items={details.frames} castShadow />
    <Instanced geometry={unitBox} material={panelRib} items={details.ribs} />
    <Instanced geometry={unitBox} material={trim} items={details.mullions} />
    <Instanced geometry={unitCyl} material={MAT.safety} items={details.bollards} castShadow />
  </group>
}

function FactorySign() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 256
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#26353d'
    ctx.fillRect(0, 0, 1024, 256)
    ctx.fillStyle = '#f04b37'
    ctx.font = 'bold 172px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('allur', 512, 179)
    const map = new CanvasTexture(canvas)
    map.colorSpace = SRGBColorSpace
    return map
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  return <mesh position={[0, 8, 0.32]}>
    <planeGeometry args={[24, 6]} />
    <meshStandardMaterial map={texture} roughness={0.45} metalness={0.15} />
  </mesh>
}

/** Сетка колонн: шаг 24 м вдоль корпуса, ряды между технологическими линиями. */
export const COLUMN_U = Array.from({ length: 14 }, (_, i) => 24 + i * 24)
export const COLUMN_V = [86, 110, 134, 170]
/** Участки без колонн (u0, u1, v0, v1): конвейеры окраски кузовов и пластика. */
const COLUMN_CLEAR = [[218, 334, 88, 204]]
const clear = (u: number, v: number) => COLUMN_CLEAR.some(([u0, u1, v0, v1]) => u > u0 && u < u1 && v > v0 && v < v1)

/**
 * Жёлтая разметка проходов, как на видео: сплошные линии по краям магистральных проходов,
 * белая «зебра» на пересечениях. Проходы разделяют цеха (см. ZONES в backend/app/services/plant.py).
 */
const AISLE_W = 4
/** Продольные проходы (v, u0, u1) — между сваркой и сборкой, между сборкой и складом CKD. */
const AISLES_U: [number, number, number][] = [[83, 4, 300], [192.5, 58, 218]]
/** Поперечные проходы (u, v0, v1) — у западных цехов, между сборкой и окраской, выезд ОТК. */
const AISLES_V: [number, number, number][] = [[58.5, 4, 192], [217, 4, 194], [247, 4, 88]]
function FloorMarking() {
  const { lines, zebra } = useMemo(() => {
    const lines: HallItem[] = []
    const zebra: HallItem[] = []
    for (const [v, u0, u1] of AISLES_U)
      for (const side of [-1, 1]) lines.push({ p: [(u0 + u1) / 2, 0.05, -(v + side * AISLE_W / 2)], s: [u1 - u0, 0.012, 0.12] })
    for (const [u, v0, v1] of AISLES_V)
      for (const side of [-1, 1]) lines.push({ p: [u + side * AISLE_W / 2, 0.05, -(v0 + v1) / 2], s: [0.12, 0.012, v1 - v0] })
    // пешеходные переходы на пересечениях проходов
    for (const [v] of AISLES_U)
      for (const [u, v0, v1] of AISLES_V) {
        if (v < v0 || v > v1) continue
        for (let k = -3; k <= 3; k++) zebra.push({ p: [u + AISLE_W / 2 + 1.2, 0.05, -(v + k * 0.55)], s: [1.6, 0.012, 0.28] })
      }
    return { lines, zebra }
  }, [])
  return <group>
    <Instanced geometry={unitBox} material={aisleLine} items={lines} />
    <Instanced geometry={unitBox} material={aisleWhite} items={zebra} />
  </group>
}

/**
 * Светлые решётчатые фермы покрытия: нижний пояс вдоль рядов колонн, поперечные фермы с шагом
 * колонн и раскосы. На видео они задают весь вид цеха; сверху это тонкие линии и обзор не закрывают.
 */
function RoofTrusses({ frame, height }: { frame: HallFrame; height: number }) {
  const items = useMemo(() => {
    const chords: HallItem[] = []
    const web: HallItem[] = []
    const depth = 1.6
    const top = height - 0.3
    const bottom = top - depth
    const length = frame.length - 8
    for (const v of COLUMN_V) {
      chords.push({ p: [frame.length / 2, top, -v], s: [length, 0.22, 0.3] })
      chords.push({ p: [frame.length / 2, bottom, -v], s: [length, 0.18, 0.26] })
      for (let u = 6; u < frame.length - 4; u += 3) {
        web.push({ p: [u, (top + bottom) / 2, -v], s: [0.09, depth, 0.09] })
        web.push({ p: [u + 1.5, (top + bottom) / 2, -v], s: [0.07, Math.hypot(depth, 3), 0.07], r: 0, rz: Math.atan2(3, depth) })
      }
    }
    const span = frame.width - 8
    for (const u of COLUMN_U) {
      chords.push({ p: [u, top, -frame.width / 2], s: [0.3, 0.22, span] })
      chords.push({ p: [u, bottom, -frame.width / 2], s: [0.26, 0.18, span] })
      for (let v = 6; v < frame.width - 4; v += 3) web.push({ p: [u, (top + bottom) / 2, -v], s: [0.09, depth, 0.09] })
    }
    return { chords, web }
  }, [frame, height])
  return <group>
    <Instanced geometry={unitBox} material={MAT.truss} items={items.chords} />
    <Instanced geometry={unitBox} material={MAT.truss} items={items.web} />
  </group>
}

function shapeUV(poly: XY[]) {
  const s = new Shape()
  s.moveTo(poly[0][0], poly[0][1])
  for (const p of poly.slice(1)) s.lineTo(p[0], p[1])
  s.closePath()
  return s
}

/** Набор одинаковых объектов одним draw call. */
export function Instanced({
  geometry,
  material,
  items,
  castShadow,
}: {
  geometry: BufferGeometry
  material: Material
  items: { p: [number, number, number]; s?: [number, number, number]; r?: number; rz?: number }[]
  castShadow?: boolean
}) {
  const ref = useRef<InstancedMesh>(null!)
  useLayoutEffect(() => {
    const o = new Object3D()
    items.forEach((it, i) => {
      o.position.set(...it.p)
      o.rotation.set(0, it.r ?? 0, it.rz ?? 0)
      o.scale.set(...(it.s ?? [1, 1, 1]))
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [items])
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow />
}

interface Props {
  frame: HallFrame
  /** контур корпуса в координатах (u, v) */
  outline: XY[]
  roof: boolean
}

/** Оболочка главного корпуса: пол, стены по реальному контуру, колонны, фермы, светильники, кровля. */
export function Hall({ frame, outline, roof }: Props) {
  const H = frame.height
  const { floorGeo, roofGeo, walls } = useMemo(() => {
    const shape = shapeUV(outline)
    const floorGeo = new ShapeGeometry(shape).rotateX(-Math.PI / 2)
    const roofGeo = new ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }).rotateX(-Math.PI / 2)
    const walls = outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length]
      const du = b[0] - a[0]
      const dv = b[1] - a[1]
      return {
        len: Math.hypot(du, dv),
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as XY,
        rot: Math.atan2(dv, du),
      }
    })
    return { floorGeo, roofGeo, walls }
  }, [outline])

  const wallH = roof ? H : 3.2

  const columns = useMemo(
    () =>
      COLUMN_U.flatMap((u) =>
        COLUMN_V.filter((v) => !clear(u, v)).map((v) => ({
          p: [u, H / 2, -v] as [number, number, number],
          s: [0.45, H, 0.45] as [number, number, number],
        })),
      ),
    [H],
  )
  const facadeRibs = useMemo(() => walls.flatMap((w) => {
    const out: { p: [number, number, number]; s: [number, number, number]; r: number }[] = []
    for (let x = -w.len / 2 + 2; x < w.len / 2; x += 3) {
      out.push({ p: [w.mid[0] + Math.cos(w.rot) * x, wallH / 2 + 0.6, -w.mid[1] - Math.sin(w.rot) * x], s: [0.07, wallH - 1.2, 0.48], r: w.rot })
    }
    return out
  }), [walls, wallH])
  const ventilation = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (let u = 55; u < frame.length - 30; u += 38)
      for (let v = 35; v < frame.width - 25; v += 55)
        out.push({ p: [u, H + 1.2, -v], s: [4.8, 1.5, 3.2] })
    return out
  }, [frame, H])
  // Ряды линейных светильников через каждые 12 м вдоль рядов колонн и между ними — как на видео.
  const lights = useMemo(() => {
    const rows = [...COLUMN_V, 50, 160, 200]
    const out: HallItem[] = []
    for (let u = 12; u < frame.length - 8; u += 12)
      for (const v of rows) if (!clear(u, v)) out.push({ p: [u, H - 2.2, -v], s: [6, 0.1, 0.3] })
    return out
  }, [H, frame.length])
  return (
    <group>
      <mesh geometry={floorGeo} material={epoxy} position={[0, 0.03, 0]} receiveShadow />

      {walls.map((w, i) => (
        <group key={i} position={[w.mid[0], 0, -w.mid[1]]} rotation={[0, w.rot, 0]}>
          {/* цоколь */}
          <mesh geometry={unitBox} material={MAT.concrete} scale={[w.len, 1.2, 0.5]} position={[0, 0.6, 0]} receiveShadow />
          {/* сэндвич-панели */}
          <mesh geometry={unitBox} material={MAT.wall} scale={[w.len, wallH - 1.2, 0.4]} position={[0, 1.2 + (wallH - 1.2) / 2, 0]} castShadow receiveShadow />
          {roof && (
            <>
              <mesh geometry={unitBox} material={glassWall} scale={[w.len * 0.96, 1.4, 0.52]} position={[0, H - 2.2, 0]} />
              <mesh geometry={unitBox} material={trim} scale={[w.len + 0.6, 0.32, 0.7]} position={[0, H + 0.45, 0]} castShadow />
              <mesh geometry={unitBox} material={trim} scale={[w.len, 0.14, 0.55]} position={[0, H - 3, 0]} />
              {w.len > 200 && <FactorySign />}
              {w.len > 45 && <FacadeBays length={w.len} height={H} />}
            </>
          )}
        </group>
      ))}

      <Instanced geometry={unitBox} material={MAT.lightColumn} items={columns} castShadow />
      <Instanced geometry={unitBox} material={panelRib} items={facadeRibs} />
      <FloorMarking />
      {!roof && (
        <>
          <Instanced geometry={unitBox} material={led} items={lights} />
          <RoofTrusses frame={frame} height={H} />
        </>
      )}

      {roof && (
        <group>
          <mesh geometry={roofGeo} material={roofFinish} position={[0, H, 0]} castShadow receiveShadow />
          <Skylights frame={frame} />
          <RoofServices units={ventilation} height={H} />
        </group>
      )}
    </group>
  )
}

/** Raised glazing with metal curbs, following the visible roof-light grid. */
function Skylights({ frame }: { frame: HallFrame }) {
  const items = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (let u = 70; u < frame.length - 15; u += 9)
      for (let v = 20; v < frame.width - 15; v += 14) out.push({ p: [u, frame.height + 0.94, -v], s: [3, 0.12, 1.6] })
    return out
  }, [frame])
  const curbs = useMemo(() => items.map(({ p }) => ({ p: [p[0], frame.height + 0.76, p[2]] as [number, number, number], s: [3.35, 0.32, 1.95] as [number, number, number] })), [items, frame.height])
  return <group>
    <Instanced geometry={unitBox} material={trim} items={curbs} castShadow />
    <Instanced geometry={unitBox} material={skylight} items={items} />
  </group>
}
