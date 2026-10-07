import { useTexture } from '@react-three/drei'
import { useMemo } from 'react'
import { DoubleSide, ExtrudeGeometry, MeshStandardMaterial, SRGBColorSpace, Shape } from 'three'
import type { Site, XY } from '../types'
import { world } from './geo'
import { surfaceTile } from './surfaces'

/** Границы спутниковой мозаики (Esri World Imagery, z17) в метрах площадки. */
const SAT = { west: -624.29, east: 656.32, north: 757.78, south: -695.51 }

const ctxWall = new MeshStandardMaterial({ color: '#b4c0c7', roughness: 0.8 })
const ctxRoof = new MeshStandardMaterial({ color: '#81909b', map: surfaceTile('roof', 1 / 12), roughness: 0.65, metalness: 0.25 })
const contextMaterials = [ctxRoof, ctxWall]

function shapeOf(poly: XY[]) {
  const s = new Shape()
  s.moveTo(poly[0][0], poly[0][1])
  for (const p of poly.slice(1)) s.lineTo(p[0], p[1])
  s.closePath()
  return s
}

/** Здание из полигона: выдавливание вверх на height (м). */
function extrudeFootprint(poly: XY[], height: number) {
  const g = new ExtrudeGeometry(shapeOf(poly), { depth: height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2) // (x, y) площадки → (x, −z) сцены, выдавливание → вверх
  return g
}

/**
 * Постройки, которых нет в OSM, сняты со спутника вручную:
 * склад у контейнерной площадки и арочные ангары. center — метры, len × wid вдоль оси корпуса.
 */
const EXTRA: { center: XY; len: number; wid: number; h: number; kind: 'box' | 'arch'; color: string }[] = [
  { center: [-118, 165], len: 140, wid: 44, h: 10, kind: 'box', color: '#b7c2c9' },
  { center: [-279, 216], len: 118, wid: 16, h: 8, kind: 'arch', color: '#a9b4bd' },
  { center: [-186, 138], len: 108, wid: 16, h: 8, kind: 'arch', color: '#a9b4bd' },
  { center: [-41, 181], len: 50, wid: 18, h: 8, kind: 'arch', color: '#a9b4bd' },
]

export function Ground({ site, hallAngle }: { site: Site; hallAngle: number }) {
  const sat = useTexture('/site_sat.jpg')
  sat.colorSpace = SRGBColorSpace
  sat.anisotropy = 8

  const buildings = useMemo(
    () =>
      site.buildings.map((b) => ({
        id: b.id,
        geo: extrudeFootprint(b.polygon, b.polygon.length > 6 ? 11 : 7),
      })),
    [site],
  )

  const w = SAT.east - SAT.west
  const h = SAT.north - SAT.south
  const c = world((SAT.east + SAT.west) / 2, (SAT.north + SAT.south) / 2)

  return (
    <group>
      {/* подложка за пределами снимка */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]} receiveShadow>
        <planeGeometry args={[9000, 9000]} />
        <meshStandardMaterial color="#6f6c58" roughness={1} />
      </mesh>
      {/* спутниковый снимок */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c.x, -0.05, c.z]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={sat} roughness={1} />
      </mesh>

      {/* соседние здания из OpenStreetMap */}
      {buildings.map((b) => (
        <mesh key={b.id} geometry={b.geo} material={contextMaterials} castShadow receiveShadow />
      ))}

      {EXTRA.map((e, i) => {
        const p = world(e.center[0], e.center[1])
        return (
          <group key={i} position={p} rotation={[0, hallAngle, 0]}>
            {e.kind === 'box' ? (
              <mesh position={[0, e.h / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[e.len, e.h, e.wid]} />
                <meshStandardMaterial color={e.color} roughness={0.8} />
              </mesh>
            ) : (
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
                <cylinderGeometry args={[e.wid / 2, e.wid / 2, e.len, 24, 1, false, 0, Math.PI]} />
                <meshStandardMaterial color={e.color} metalness={0.5} roughness={0.45} side={DoubleSide} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}
