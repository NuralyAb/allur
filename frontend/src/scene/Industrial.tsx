import { useMemo } from 'react'
import { CylinderGeometry, MeshStandardMaterial } from 'three'
import { MAT, paint, unitBox } from './assets'
import { Instanced } from './Hall'

export type IndustrialItem = { p: [number, number, number]; s: [number, number, number]; r?: number }
const frame = paint('#53616a', 0.64, 0.43)
const brightSteel = paint('#9aa5aa', 0.78, 0.34)
const amber = paint('#c8a45d', 0.3, 0.55)
const cabinet = paint('#c3ccce', 0.23, 0.55)
const tray = paint('#647d89', 0.22, 0.65)
const screen = new MeshStandardMaterial({ color: '#1e343d', emissive: '#426f77', emissiveIntensity: 0.28, roughness: 0.3 })
const rollerGeo = new CylinderGeometry(0.5, 0.5, 1, 12).rotateX(Math.PI / 2)

/** Plausible modular factory equipment, not manufacturer CAD. All repetition is instanced. */
export function Conveyor({ length, width = 3.2, height = 0.3, position = [0, 0, 0], rollers = false }: {
  length: number; width?: number; height?: number; position?: [number, number, number]; rollers?: boolean
}) {
  const batches = useMemo(() => {
    const steel: IndustrialItem[] = []
    const feet: IndustrialItem[] = []
    const safety: IndustrialItem[] = []
    const plates: IndustrialItem[] = []
    const drives: IndustrialItem[] = []
    const bolts: IndustrialItem[] = []
    for (const side of [-1, 1]) {
      steel.push({ p: [0, height - 0.12, side * (width / 2 - 0.09)], s: [length, 0.21, 0.13] })
      safety.push({ p: [0, height - 0.012, side * (width / 2 + 0.03)], s: [length, 0.035, 0.16] })
      // Segmented chassis with exposed crossmembers, shoes and fasteners.
      const count = Math.ceil(length / 2.8)
      for (let i = 0; i <= count; i++) {
        const x = -length / 2 + 0.18 + i * (length - 0.36) / count
        feet.push({ p: [x, (height - 0.12) / 2, side * (width / 2 - 0.3)], s: [0.12, height - 0.12, 0.16] })
        feet.push({ p: [x, 0.025, side * (width / 2 - 0.3)], s: [0.36, 0.05, 0.34] })
        bolts.push({ p: [x, height - 0.08, side * (width / 2 + 0.005)], s: [0.07, 0.07, 0.025] })
        if (side === 1) steel.push({ p: [x, height - 0.2, 0], s: [0.1, 0.08, width - 0.3] })
      }
    }
    const pitch = rollers ? 0.28 : 0.23
    const count = Math.floor(length / pitch)
    for (let i = 0; i < count; i++) {
      const x = -length / 2 + (i + 0.5) * length / count
      plates.push({ p: [x, height - 0.045, 0], s: rollers ? [0.18, 0.18, width - 0.45] : [length / count - 0.025, 0.055, width - 0.44] })
    }
    for (const x of [-length / 2 + 0.5, length / 2 - 0.5]) {
      drives.push({ p: [x, height - 0.12, width / 2 + 0.2], s: [0.45, 0.24, 0.28] })
      safety.push({ p: [x, height - 0.08, width / 2 + 0.42], s: [0.55, 0.32, 0.15] })
    }
    return { steel, feet, safety, plates, drives, bolts }
  }, [length, width, height, rollers])
  return <group position={position}>
    <Instanced geometry={unitBox} material={frame} items={batches.steel} />
    <Instanced geometry={unitBox} material={MAT.darkSteel} items={batches.feet} />
    <Instanced geometry={unitBox} material={amber} items={batches.safety} />
    <Instanced geometry={rollers ? rollerGeo : unitBox} material={brightSteel} items={batches.plates} />
    <Instanced geometry={unitBox} material={frame} items={batches.drives} />
    <Instanced geometry={unitBox} material={brightSteel} items={batches.bolts} />
  </group>
}

/** Open assembly-side racks with folded bins; no solid block filling the whole rack. */
export function PartsRacks({ positions, width = 3.6 }: { positions: [number, number, number][]; width?: number }) {
  const batches = useMemo(() => {
    const posts: IndustrialItem[] = []
    const shelves: IndustrialItem[] = []
    const bins: IndustrialItem[] = []
    const labels: IndustrialItem[] = []
    positions.forEach(([x, y, z], index) => {
      for (const dx of [-width / 2, width / 2]) for (const dz of [-0.45, 0.45]) {
        posts.push({ p: [x + dx, y + 0.85, z + dz], s: [0.075, 1.7, 0.075] })
        posts.push({ p: [x + dx, y + 0.035, z + dz], s: [0.18, 0.07, 0.18] })
      }
      for (const level of [0.2, 0.82, 1.44]) {
        shelves.push({ p: [x, y + level, z], s: [width, 0.06, 0.92] })
        for (const side of [-1, 1]) posts.push({ p: [x, y + level + 0.07, z + side * 0.44], s: [width, 0.09, 0.045] })
        for (let bin = 0; bin < 3; bin++) {
          if ((index + bin + Math.round(level * 10)) % 7 === 0) continue
          const bx = x + (bin - 1) * width / 3.2
          const bw = width / 3.5
          bins.push({ p: [bx, y + level + 0.05, z], s: [bw, 0.05, 0.69] })
          for (const side of [-1, 1]) {
            bins.push({ p: [bx + side * bw / 2, y + level + 0.21, z], s: [0.035, 0.36, 0.69] })
            bins.push({ p: [bx, y + level + 0.17, z + side * 0.33], s: [bw, 0.27, 0.04] })
            labels.push({ p: [bx, y + level + 0.18, z + side * 0.357], s: [0.2, 0.095, 0.012] })
          }
        }
      }
    })
    return { posts, shelves, bins, labels }
  }, [positions, width])
  return <group>
    <Instanced geometry={unitBox} material={frame} items={batches.posts} />
    <Instanced geometry={unitBox} material={brightSteel} items={batches.shelves} />
    <Instanced geometry={unitBox} material={tray} items={batches.bins} />
    <Instanced geometry={unitBox} material={MAT.wall} items={batches.labels} />
  </group>
}

/** Shared instanced control cabinets: plinth, door seam, HMI, handle and vent slots. */
export function ControlCabinets({ positions }: { positions: [number, number, number][] }) {
  const batches = useMemo(() => {
    const shells: IndustrialItem[] = []
    const seams: IndustrialItem[] = []
    const displays: IndustrialItem[] = []
    const accents: IndustrialItem[] = []
    positions.forEach(([x, y, z]) => {
      shells.push({ p: [x, y + 0.98, z], s: [0.85, 1.72, 0.56] })
      shells.push({ p: [x, y + 0.98, z + 0.293], s: [0.79, 1.63, 0.025] })
      seams.push({ p: [x, y + 0.1, z], s: [0.8, 0.2, 0.52] })
      seams.push({ p: [x, y + 1.25, z + 0.315], s: [0.5, 0.36, 0.035] })
      seams.push({ p: [x + 0.29, y + 0.83, z + 0.32], s: [0.035, 0.18, 0.05] })
      displays.push({ p: [x, y + 1.25, z + 0.336], s: [0.41, 0.27, 0.012] })
      for (let i = 0; i < 5; i++) seams.push({ p: [x, y + 0.35 + i * 0.045, z + 0.312], s: [0.52, 0.018, 0.012] })
      accents.push({ p: [x + 0.22, y + 1.52, z + 0.32], s: [0.09, 0.09, 0.04] })
    })
    return { shells, seams, displays, accents }
  }, [positions])
  return <group>
    <Instanced geometry={unitBox} material={cabinet} items={batches.shells} />
    <Instanced geometry={unitBox} material={MAT.darkSteel} items={batches.seams} />
    <Instanced geometry={unitBox} material={screen} items={batches.displays} />
    <Instanced geometry={unitBox} material={amber} items={batches.accents} />
  </group>
}
