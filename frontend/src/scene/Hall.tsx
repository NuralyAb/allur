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
import type { HallFrame, XY } from '../types'
import { MAT, unitBox } from './assets'
import { surfaceTile } from './surfaces'

const glassWall = new MeshStandardMaterial({ color: '#859da9', metalness: 0.15, roughness: 0.18, transparent: true, opacity: 0.48, depthWrite: false })
const skylight = new MeshStandardMaterial({ color: '#c2cbd0', roughness: 0.32, metalness: 0.12 })
const concreteTexture = surfaceTile('concrete', 1 / 12)
const roofTexture = surfaceTile('roof', 1 / 10)
const epoxy = new MeshStandardMaterial({ color: '#b5bdbd', map: concreteTexture, bumpMap: concreteTexture, bumpScale: 0.025, roughness: 0.64, metalness: 0.04 })
const roofFinish = new MeshStandardMaterial({ color: '#7c8b94', map: roofTexture, bumpMap: roofTexture, bumpScale: 0.055, roughness: 0.6, metalness: 0.32 })
const trim = new MeshStandardMaterial({ color: '#42525c', roughness: 0.52, metalness: 0.45 })
const panelRib = new MeshStandardMaterial({ color: '#afb9bd', roughness: 0.68, metalness: 0.18 })
const led = new MeshStandardMaterial({ color: '#f5f8fa', emissive: '#e7f0f7', emissiveIntensity: 1.7, toneMapped: false })

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
  items: { p: [number, number, number]; s?: [number, number, number]; r?: number }[]
  castShadow?: boolean
}) {
  const ref = useRef<InstancedMesh>(null!)
  useLayoutEffect(() => {
    const o = new Object3D()
    items.forEach((it, i) => {
      o.position.set(...it.p)
      o.rotation.set(0, it.r ?? 0, 0)
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
  const lights = useMemo(() => COLUMN_U.flatMap((u) => COLUMN_V.filter((v) => !clear(u, v)).map((v) => ({
    p: [u + 1.5, H - 1.1, -v] as [number, number, number], s: [5, 0.12, 0.32] as [number, number, number],
  }))), [H])
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
            </>
          )}
        </group>
      ))}

      <Instanced geometry={unitBox} material={MAT.darkSteel} items={columns} castShadow />
      <Instanced geometry={unitBox} material={panelRib} items={facadeRibs} />
      {!roof && <Instanced geometry={unitBox} material={led} items={lights} />}

      {roof && (
        <group>
          <mesh geometry={roofGeo} material={roofFinish} position={[0, H, 0]} castShadow receiveShadow />
          <Skylights frame={frame} />
          <Instanced geometry={unitBox} material={trim} items={ventilation} castShadow />
        </group>
      )}
    </group>
  )
}

/** Зенитные фонари — светлые прямоугольники на кровле, как на спутниковом снимке. */
function Skylights({ frame }: { frame: HallFrame }) {
  const items = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number] }[] = []
    for (let u = 70; u < frame.length - 15; u += 9)
      for (let v = 20; v < frame.width - 15; v += 14) out.push({ p: [u, frame.height + 0.75, -v], s: [3, 0.3, 1.6] })
    return out
  }, [frame])
  return <Instanced geometry={unitBox} material={skylight} items={items} />
}
