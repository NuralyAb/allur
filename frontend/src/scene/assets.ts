import { BoxGeometry, CylinderGeometry, MeshStandardMaterial, type Material } from 'three'

/** Колесо для шасси коммерческой техники; легковые колёса — в carModels.ts. */
export const wheelGeo = new CylinderGeometry(0.31, 0.31, 0.21, 18).rotateX(Math.PI / 2)
/* ---------- Материалы ---------- */

const cache = new Map<string, MeshStandardMaterial>()
export function paint(color: string, metalness = 0.55, roughness = 0.32): MeshStandardMaterial {
  const key = `${color}|${metalness}|${roughness}`
  let m = cache.get(key)
  if (!m) {
    m = new MeshStandardMaterial({ color, metalness, roughness })
    cache.set(key, m)
  }
  return m
}

/** Пять цветов гаммы завода (по nur.kz — 5 вариантов окраски). */
export const CAR_COLORS = ['#f4f5f7', '#1b1d22', '#a9b0b8', '#b3202a', '#1e4f9c']

export const MAT = {
  biw: paint('#b9bec4', 0.9, 0.38), // «белый кузов» — голый металл
  ed: paint('#3b3f45', 0.2, 0.7), // катафорезный грунт
  primer: paint('#c9c6bd', 0.05, 0.6),
  glass: new MeshStandardMaterial({ color: '#203547', metalness: 0.85, roughness: 0.07 }),
  opening: paint('#0d0f12', 0, 1),
  tyre: paint('#121314', 0, 0.85),
  steel: paint('#7d848c', 0.75, 0.4),
  darkSteel: paint('#3a3f46', 0.6, 0.5),
  yellow: paint('#f2c200', 0.2, 0.5),
  safety: paint('#e8b500', 0.1, 0.6),
  robot: paint('#ee7d11', 0.25, 0.42),
  robotDark: paint('#2a2d33', 0.4, 0.5),
  concrete: paint('#9aa0a6', 0, 0.95),
  floor: paint('#7f878f', 0.05, 0.75),
  wall: paint('#d1d8dc', 0.25, 0.58),
  roof: paint('#626e79', 0.55, 0.46),
  blueRack: paint('#1f5fae', 0.4, 0.5),
  orangeRack: paint('#e46b12', 0.3, 0.55),
  carton: paint('#b48a5a', 0, 0.9),
  worker: paint('#1d3557', 0, 0.8),
  vest: paint('#ff7a00', 0, 0.7),
  skin: paint('#c99b7a', 0, 0.8),
} satisfies Record<string, Material>

export const unitBox = new BoxGeometry(1, 1, 1)
export const unitCyl = new CylinderGeometry(0.5, 0.5, 1, 16)
