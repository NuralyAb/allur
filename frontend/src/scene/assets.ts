import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  MeshStandardMaterial,
  Shape,
  type Material,
} from 'three'

/* ---------- Кузов седана (Onix/Cobalt-класс, 4.5 × 1.75 × 1.45 м) ---------- */

function profile(points: [number, number][]) {
  const s = new Shape()
  s.moveTo(...points[0])
  for (const p of points.slice(1)) s.lineTo(...p)
  s.closePath()
  return s
}

const BODY_W = 1.74

function extrude(shape: Shape, width: number, bevel = 0.06) {
  const g = new ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  })
  g.translate(-2.25, 0, -(width - bevel * 2) / 2)
  g.computeVertexNormals()
  return g
}

export const carBodyGeo = extrude(
  profile([
    // низ передней части → передний бампер → капот
    [0.12, 0.34],
    [0.01, 0.5],
    [0.03, 0.68],
    [0.28, 0.8],
    [0.95, 0.9],
    [1.45, 0.98],
    // лобовое стекло → крыша → заднее стекло
    [2.05, 1.4],
    [2.6, 1.45],
    [3.1, 1.4],
    [3.75, 1.02],
    // крышка багажника → задний бампер
    [4.25, 0.98],
    [4.46, 0.9],
    [4.5, 0.64],
    [4.44, 0.36],
    [4.3, 0.33],
    // задняя колёсная арка
    [3.95, 0.33],
    [3.86, 0.55],
    [3.6, 0.67],
    [3.34, 0.55],
    [3.25, 0.33],
    // передняя колёсная арка
    [1.45, 0.33],
    [1.36, 0.55],
    [1.1, 0.67],
    [0.84, 0.55],
    [0.75, 0.33],
  ]),
  BODY_W,
  0.09,
)

export const carGlassGeo = extrude(
  profile([
    [1.56, 0.99],
    [2.08, 1.36],
    [3.08, 1.36],
    [3.66, 1.02],
  ]),
  BODY_W + 0.02,
  0.03,
)

export const wheelGeo = new CylinderGeometry(0.31, 0.31, 0.21, 18).rotateX(Math.PI / 2)
export const WHEEL_POS: [number, number, number][] = [
  [-1.15, 0.31, 0.74],
  [-1.15, 0.31, -0.74],
  [1.35, 0.31, 0.74],
  [1.35, 0.31, -0.74],
]

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
  glass: new MeshStandardMaterial({ color: '#16202b', metalness: 0.6, roughness: 0.08 }),
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
  wall: paint('#d9dde1', 0.1, 0.7),
  roof: paint('#3d434a', 0.3, 0.75),
  blueRack: paint('#1f5fae', 0.4, 0.5),
  orangeRack: paint('#e46b12', 0.3, 0.55),
  carton: paint('#b48a5a', 0, 0.9),
  worker: paint('#1d3557', 0, 0.8),
  vest: paint('#ff7a00', 0, 0.7),
  skin: paint('#c99b7a', 0, 0.8),
} satisfies Record<string, Material>

export const unitBox = new BoxGeometry(1, 1, 1)
export const unitCyl = new CylinderGeometry(0.5, 0.5, 1, 16)
