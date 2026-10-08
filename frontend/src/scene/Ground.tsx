import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, IcosahedronGeometry, MeshStandardMaterial, Shape, ShapeGeometry, type Curve, type Vector3 } from 'three'
import type { Site, XY } from '../types'
import { unitBox } from './assets'
import { world } from './geo'
import { Instanced } from './Hall'
import { surfaceTile } from './surfaces'
import { terrainTexture } from './exteriorSurfaces'
import { OUTBOUND_ROUTE, ROAD_TURN_RADIUS } from './exteriorLayout'
import { makePath } from './motion'

type Item = { p: [number, number, number]; s: [number, number, number]; r?: number }
const aggregate = surfaceTile('asphalt', 1 / 6)
const grass = new MeshStandardMaterial({ color: '#71825e', map: terrainTexture, roughness: 1 })
const apron = new MeshStandardMaterial({ color: '#929894', map: aggregate, bumpMap: aggregate, bumpScale: 0.025, roughness: 0.96 })
const road = new MeshStandardMaterial({ color: '#495256', map: aggregate, bumpMap: aggregate, bumpScale: 0.035, roughness: 0.93 })
const curb = new MeshStandardMaterial({ color: '#c1c2b6', roughness: 0.9 })
const markings = new MeshStandardMaterial({ color: '#e8e6d6', roughness: 0.85 })
const facade = new MeshStandardMaterial({ color: '#a6afad', roughness: 0.78, metalness: 0.16 })
const roof = new MeshStandardMaterial({ color: '#7e8c91', map: surfaceTile('roof', 1 / 8), roughness: 0.62, metalness: 0.28 })
const archMaterial = new MeshStandardMaterial({ color: '#a4afb1', map: surfaceTile('roof', 9), metalness: 0.35, roughness: 0.65, side: DoubleSide })
const trim = new MeshStandardMaterial({ color: '#58666b', roughness: 0.55, metalness: 0.5 })
const windows = new MeshStandardMaterial({ color: '#66818a', roughness: 0.22, metalness: 0.45 })
const poleMat = new MeshStandardMaterial({ color: '#718087', roughness: 0.52, metalness: 0.65 })
const lampMat = new MeshStandardMaterial({ color: '#eef1e7', emissive: '#e8eddf', emissiveIntensity: 0.45, roughness: 0.45 })
const bark = new MeshStandardMaterial({ color: '#786c5c', roughness: 1 })
const leaves = ['#62755c', '#75825f', '#7a866a'].map((color) => new MeshStandardMaterial({ color, roughness: 1 }))
const crownGeo = new IcosahedronGeometry(1, 2)
const trunkGeo = new CylinderGeometry(0.13, 0.23, 1, 7)

function shapeOf(poly: XY[]) {
  const shape = new Shape()
  shape.moveTo(...poly[0])
  for (const p of poly.slice(1)) shape.lineTo(...p)
  shape.closePath()
  return shape
}

function inside(point: XY, poly: XY[]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit
  }
  return hit
}

/** A shallow, continuous road surface. Coordinates are metres in the hall frame. */
function roadGeometry(curve: Curve<Vector3>, width: number) {
  const count = Math.ceil(curve.getLength() / 2)
  const positions: number[] = [], uv: number[] = [], index: number[] = []
  for (let i = 0; i <= count; i++) {
    const p = curve.getPointAt(i / count), t = curve.getTangentAt(i / count)
    for (const side of [-1, 1]) {
      positions.push(p.x - t.z * width / 2 * side, -0.016, p.z + t.x * width / 2 * side)
      uv.push(i * 2, side * width / 2)
    }
    if (i < count) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

// Landscape/access detail is an illustrative reconstruction, not a surveyed road plan.
const ROADS: { points: XY[]; width: number; lane?: boolean }[] = [
  { points: [[-610, -52], [-300, -52], [40, -52], [380, -52], [640, -52]], width: 16, lane: true },
  { points: OUTBOUND_ROUTE, width: 13, lane: true },
  { points: [[-372, -52], [-372, 150], [-363, 290], [-333, 310], [-80, 318], [150, 328], [395, 318]], width: 14, lane: true },
  { points: [[-22, -52], [-22, 15], [-22, 130], [-22, 195], [-50, 285], [-70, 317]], width: 12 },
  { points: [[-60, 320], [-45, 340], [-45, 420], [-30, 457], [160, 457], [183, 438], [183, 350], [160, 330]], width: 10 },
]

function AccessRoads() {
  const data = useMemo(() => {
    const paths = ROADS.map((r) => {
      const curve = makePath(r.points.map(([x, y]) => [x, 0, -y]), ROAD_TURN_RADIUS)
      return { curve, samples: curve.getSpacedPoints(Math.ceil(curve.getLength() / 2)), width: r.width }
    })
    const touchesRoad = (x: number, z: number, roadIndex: number, earlierOnly = false) => paths.some((p, i) =>
      i !== roadIndex && (!earlierOnly || i < roadIndex) && p.samples.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < (p.width / 2 + 0.8) ** 2))
    return ROADS.map((r, roadIndex) => {
    const curve = paths[roadIndex].curve
    const length = curve.getLength(), lines: Item[] = [], kerbs: Item[] = []
    for (let d = 0; d < length - 6; d += 10) {
      const p = curve.getPointAt((d + 3) / length), t = curve.getTangentAt((d + 3) / length), angle = Math.atan2(-t.z, t.x)
      if (r.lane && !touchesRoad(p.x, p.z, roadIndex, true)) lines.push({ p: [p.x, 0.002, p.z], s: [4.5, 0.008, 0.13], r: angle })
    }
    for (let d = 1.5; d < length - 1.5; d += 3) {
      const p = curve.getPointAt(d / length), t = curve.getTangentAt(d / length), angle = Math.atan2(-t.z, t.x)
      for (const side of [-1, 1]) {
        const x = p.x - t.z * (r.width / 2 + 0.18) * side, z = p.z + t.x * (r.width / 2 + 0.18) * side
        if (!touchesRoad(x, z, roadIndex) && !touchesRoad(x + t.x * 1.5, z + t.z * 1.5, roadIndex) && !touchesRoad(x - t.x * 1.5, z - t.z * 1.5, roadIndex)) {
          kerbs.push({ p: [x, 0.08, z], s: [2.96, 0.2, 0.32], r: angle })
        }
      }
    }
    return { geometry: roadGeometry(curve, r.width), lines, kerbs }
    })
  }, [])
  useEffect(() => () => data.forEach((d) => d.geometry.dispose()), [data])
  return <group>
    {data.map((d, i) => <mesh key={i} geometry={d.geometry} material={road} receiveShadow />)}
    <Instanced geometry={unitBox} material={markings} items={data.flatMap((d) => d.lines)} />
    <Instanced geometry={unitBox} material={curb} items={data.flatMap((d) => d.kerbs)} />
  </group>
}

const EXTRA: { center: XY; len: number; wid: number; h: number; kind: 'box' | 'arch' }[] = [
  { center: [-118, 165], len: 140, wid: 44, h: 10, kind: 'box' },
  { center: [-279, 216], len: 118, wid: 16, h: 8, kind: 'arch' },
  { center: [-186, 138], len: 108, wid: 16, h: 8, kind: 'arch' },
  { center: [-41, 181], len: 50, wid: 18, h: 8, kind: 'arch' },
]

/** Real geographic footprints with a coherent, fully modelled industrial ground plane. */
export function Ground({ site, hallAngle }: { site: Site; hallAngle: number }) {
  const data = useMemo(() => {
    const ribs: Item[] = [], glazing: Item[] = [], ventilation: Item[] = [], plinth: Item[] = []
    const buildings = site.buildings.map((building) => {
      const height = building.polygon.length > 6 ? 11 : 7
      const geometry = new ExtrudeGeometry(shapeOf(building.polygon), { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2)
      const center = building.polygon.reduce((a, p) => [a[0] + p[0] / building.polygon.length, a[1] + p[1] / building.polygon.length] as XY, [0, 0] as XY)
      const apronPoly = building.polygon.map(([x, y]) => {
        const dx = x - center[0], dy = y - center[1], len = Math.hypot(dx, dy)
        return [x + dx / len * 5, y + dy / len * 5] as XY
      })
      for (let i = 0; i < building.polygon.length; i++) {
        const a = building.polygon[i], b = building.polygon[(i + 1) % building.polygon.length]
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), angle = Math.atan2(dy, dx)
        plinth.push({ p: [(a[0] + b[0]) / 2, 0.38, -(a[1] + b[1]) / 2], s: [len, 0.76, 0.45], r: angle })
        for (let d = 3; d < len - 2; d += 5) {
          ribs.push({ p: [a[0] + dx * d / len, height / 2, -a[1] - dy * d / len], s: [0.08, height - 0.9, 0.34], r: angle })
          if (len > 18) glazing.push({ p: [a[0] + dx * (d - 1.4) / len, height * 0.62, -a[1] - dy * (d - 1.4) / len], s: [2.3, 1.65, 0.36], r: angle })
        }
      }
      if (inside(center, building.polygon)) ventilation.push({ p: [center[0], height + 0.65, -center[1]], s: [4, 1.3, 2.8], r: hallAngle })
      return { id: building.id, geometry, ground: new ShapeGeometry(shapeOf(apronPoly)).rotateX(-Math.PI / 2) }
    })
    const siteGeometry = new ShapeGeometry(shapeOf(site.site)).rotateX(-Math.PI / 2)
    return { buildings, ribs, glazing, ventilation, plinth, siteGeometry }
  }, [site, hallAngle])
  useEffect(() => () => {
    data.siteGeometry.dispose()
    data.buildings.forEach((b) => { b.geometry.dispose(); b.ground.dispose() })
  }, [data])
  const origin = world(...site.hall[0])
  const landscape = useMemo(() => {
    const trunks: Item[] = [], crowns: Item[][] = [[], [], []], poles: Item[] = [], arms: Item[] = [], lights: Item[] = []
    const c = Math.cos(hallAngle), s = Math.sin(hallAngle)
    const toSite = (u: number, v: number): XY => [site.hall[0][0] + u * c - v * s, site.hall[0][1] + u * s + v * c]
    for (let i = 0; i < 84; i++) {
      const u = i < 48 ? -560 + i * 24 : i < 66 ? -396 : 424
      const v = i < 48 ? -98 - (i % 3) * 1.5 : 10 + (i % 18) * 25
      const pos = toSite(u, v)
      if (site.buildings.some((b) => inside(pos, b.polygon)) || inside(pos, site.hall)) continue
      const h = 5 + Math.sin(i * 1.8) * 0.9
      trunks.push({ p: [u, h * 0.31, -v], s: [1, h * 0.62, 1] })
      crowns[i % 3].push({ p: [u, h, -v], s: [2.3 + i % 2 * 0.5, 3.1, 2.1 + i % 3 * 0.2] })
    }
    for (let u = -330; u < 410; u += 42) {
      for (const v of [-62, 302]) {
        poles.push({ p: [u, 4.3, -v], s: [0.16, 8.6, 0.16] })
        arms.push({ p: [u, 8.5, -v - 1.1], s: [0.12, 0.12, 2.4] })
        lights.push({ p: [u, 8.43, -v - 2.25], s: [0.52, 0.15, 1.12] })
      }
    }
    return { trunks, crowns, poles, arms, lights }
  }, [site, hallAngle])
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} material={grass} receiveShadow><planeGeometry args={[9000, 9000]} /></mesh>
    <mesh geometry={data.siteGeometry} material={apron} position={[0, -0.035, 0]} receiveShadow />
    {data.buildings.map((b) => <group key={b.id}>
      <mesh geometry={b.ground} material={apron} position={[0, -0.036, 0]} receiveShadow />
      <mesh geometry={b.geometry} material={[roof, facade]} castShadow receiveShadow />
    </group>)}
    <Instanced geometry={unitBox} material={trim} items={data.ribs} />
    <Instanced geometry={unitBox} material={windows} items={data.glazing} />
    <Instanced geometry={unitBox} material={curb} items={data.plinth} />
    <Instanced geometry={unitBox} material={trim} items={data.ventilation} castShadow />
    <group position={origin} rotation={[0, hallAngle, 0]}>
      <AccessRoads />
      <Instanced geometry={trunkGeo} material={bark} items={landscape.trunks} castShadow />
      {landscape.crowns.map((items, i) => <Instanced key={i} geometry={crownGeo} material={leaves[i]} items={items} castShadow />)}
      <Instanced geometry={unitBox} material={poleMat} items={[...landscape.poles, ...landscape.arms]} castShadow />
      <Instanced geometry={unitBox} material={lampMat} items={landscape.lights} />
    </group>
    {EXTRA.map((e, i) => <group key={i} position={world(...e.center)} rotation={[0, hallAngle, 0]}>
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} material={apron} receiveShadow><planeGeometry args={[e.len + 12, e.wid + 12]} /></mesh>
      {e.kind === 'box' ? <>
        <mesh position={[0, e.h / 2, 0]} material={facade} castShadow receiveShadow><boxGeometry args={[e.len, e.h, e.wid]} /></mesh>
        <mesh position={[0, e.h + 0.15, 0]} material={roof} castShadow receiveShadow><boxGeometry args={[e.len + 0.6, 0.3, e.wid + 0.6]} /></mesh>
        {[-1, 1].map((side) => <mesh key={side} position={[0, e.h * 0.6, side * (e.wid / 2 + 0.02)]} material={windows}><boxGeometry args={[e.len - 8, 1.8, 0.12]} /></mesh>)}
      </> : <mesh rotation={[0, 0, Math.PI / 2]} material={archMaterial} castShadow receiveShadow><cylinderGeometry args={[e.wid / 2, e.wid / 2, e.len, 32, 1, false, 0, Math.PI]} /></mesh>}
    </group>)}
  </group>
}
