import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Shape,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
 * Модели, которые выпускает завод (план месяца из кейса: Onix 2500, Cobalt 1800, JAC J7 500).
 * Силуэты построены по реальным габаритам и колёсной базе; профиль задан от переднего бампера (x)
 * и от земли (y), в метрах. В сцене машина смотрит вперёд по +X.
 */

export type CarModelId = 'onix' | 'cobalt' | 'j7'

interface Spec {
  name: string
  brand: 'chevrolet' | 'jac'
  length: number
  width: number
  frontOverhang: number
  wheelbase: number
  wheelR: number
  /** верхний контур: от низа переднего бампера через крышу до низа заднего */
  top: [number, number][]
  /** боковое остекление */
  glass: [number, number][]
  headlightY: number
  taillightY: number
}

export const SPECS: Record<CarModelId, Spec> = {
  // Chevrolet Onix седан (2019–): 4474 × 1730 × 1471, база 2600
  onix: {
    name: 'Chevrolet Onix',
    brand: 'chevrolet',
    length: 4.474,
    width: 1.73,
    frontOverhang: 0.87,
    wheelbase: 2.6,
    wheelR: 0.31,
    top: [
      [0.1, 0.33],
      [0.0, 0.5],
      [0.02, 0.66],
      [0.2, 0.8],
      [0.85, 0.92],
      [1.35, 0.99],
      [1.98, 1.43],
      [2.45, 1.471],
      [2.95, 1.43],
      [3.7, 1.06],
      [4.2, 1.02],
      [4.4, 0.95],
      [4.474, 0.68],
      [4.43, 0.38],
      [4.32, 0.33],
    ],
    glass: [
      [1.42, 1.0],
      [2.0, 1.4],
      [2.95, 1.4],
      [3.62, 1.06],
    ],
    headlightY: 0.77,
    taillightY: 0.9,
  },
  // Chevrolet Cobalt (T250, выпуск в СНГ): 4479 × 1735 × 1514, база 2620 — высокий кузов, большой багажник
  cobalt: {
    name: 'Chevrolet Cobalt',
    brand: 'chevrolet',
    length: 4.479,
    width: 1.735,
    frontOverhang: 0.86,
    wheelbase: 2.62,
    wheelR: 0.31,
    top: [
      [0.1, 0.34],
      [0.0, 0.52],
      [0.03, 0.7],
      [0.22, 0.84],
      [0.95, 0.96],
      [1.35, 1.02],
      [1.92, 1.49],
      [2.5, 1.514],
      [3.05, 1.49],
      [3.68, 1.12],
      [4.25, 1.1],
      [4.43, 1.02],
      [4.479, 0.72],
      [4.44, 0.4],
      [4.33, 0.34],
    ],
    glass: [
      [1.42, 1.03],
      [1.96, 1.46],
      [3.03, 1.46],
      [3.6, 1.12],
    ],
    headlightY: 0.8,
    taillightY: 0.96,
  },
  // JAC J7 лифтбек: 4772 × 1820 × 1492, база 2760 — длинная покатая крыша, сквозной фонарь
  j7: {
    name: 'JAC J7',
    brand: 'jac',
    length: 4.772,
    width: 1.82,
    frontOverhang: 0.93,
    wheelbase: 2.76,
    wheelR: 0.33,
    top: [
      [0.1, 0.33],
      [0.0, 0.5],
      [0.03, 0.66],
      [0.25, 0.8],
      [0.95, 0.92],
      [1.45, 0.99],
      [2.05, 1.45],
      [2.55, 1.492],
      [3.05, 1.44],
      [4.3, 1.06],
      [4.62, 1.0],
      [4.772, 0.7],
      [4.73, 0.38],
      [4.6, 0.33],
    ],
    glass: [
      [1.52, 1.0],
      [2.08, 1.42],
      [3.05, 1.41],
      [4.15, 1.07],
    ],
    headlightY: 0.76,
    taillightY: 0.93,
  },
}

/** Чередование моделей в пропорции месячного плана: Onix 50 %, Cobalt 40 %, J7 10 %. */
const MIX: CarModelId[] = ['onix', 'cobalt', 'onix', 'cobalt', 'onix', 'j7', 'onix', 'cobalt', 'onix', 'cobalt']
export const pickModel = (i: number): CarModelId => MIX[((i % MIX.length) + MIX.length) % MIX.length]

/* ---------------- построение геометрии ---------------- */

const SILL = 0.3

/** Профиль кузова с вырезами колёсных арок. */
function bodyShape(s: Spec) {
  const shape = new Shape()
  const pts: [number, number][] = [...s.top]
  const front = s.frontOverhang
  const rear = s.frontOverhang + s.wheelbase
  const R = s.wheelR + 0.05
  const arch = (xc: number) => {
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI
      pts.push([xc + R * Math.cos(a), Math.max(SILL, s.wheelR + R * Math.sin(a))])
    }
  }
  // низ кузова идёт от заднего бампера к переднему
  arch(rear)
  arch(front)
  // перед машины — по +X: профиль отражается (x → L − x)
  const m = pts.map(([x, y]) => [s.length - x, y] as [number, number])
  shape.moveTo(...m[0])
  for (const p of m.slice(1)) shape.lineTo(...p)
  shape.closePath()
  return shape
}

function extrudeCentered(shape: Shape, s: Spec, width: number, bevel: number) {
  const g = new ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  })
  g.translate(-s.length / 2, 0, -(width - bevel * 2) / 2)
  // Real cabins taper inward above the beltline; a constant-width extrusion
  // made roofs as wide as the doors and gave every distant car a toy silhouette.
  const vertices = g.getAttribute('position')
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i)
    const cabin = Math.max(0, Math.min(1, (y - 0.91) / 0.57))
    const nose = Math.max(0, (Math.abs(x) - s.length * 0.35) / (s.length * 0.15))
    vertices.setZ(i, vertices.getZ(i) * (1 - cabin * 0.23) * (1 - nose * 0.07))
  }
  g.computeVertexNormals()
  return g
}

function polyShape(s: Spec, points: [number, number][]) {
  const m = points.map(([x, y]) => [s.length - x, y] as [number, number])
  const sh = new Shape()
  sh.moveTo(...m[0])
  for (const p of m.slice(1)) sh.lineTo(...p)
  sh.closePath()
  return sh
}

/** Деталь-параллелепипед с цветом вершин; x — от переднего бампера. */
function part(s: Spec, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
  const g = new BoxGeometry(sx, sy, sz).toNonIndexed()
  g.translate(s.length / 2 - x, y, z)
  const c = new Color(color)
  const n = g.getAttribute('position').count
  g.setAttribute('color', new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3))
  return g
}

const GOLD = '#d6a830'
const CHROME = '#c9ced4'
const DARK = '#17191c'
const HEAD = '#eef3f8'
const TAIL = '#b0121b'

/** Фары, фонари, решётка, эмблемы, зеркала — одной геометрией с цветами вершин. */
function detailsGeo(s: Spec) {
  const W = s.width
  const L = s.length
  const parts: BufferGeometry[] = []
  // фары
  for (const side of [1, -1]) parts.push(part(s, 0.17, s.headlightY, side * (W / 2 - 0.3), 0.32, s.brand === 'jac' ? 0.08 : 0.12, 0.44, HEAD))
  // зеркала
  for (const side of [1, -1]) parts.push(part(s, s.glass[0][0] + 0.05, s.glass[0][1] + 0.04, side * (W / 2 + 0.06), 0.2, 0.12, 0.13, DARK))
  if (s.brand === 'chevrolet') {
    // фирменная двухсекционная решётка и золотая «бабочка» спереди и на крышке багажника
    parts.push(part(s, 0.03, 0.67, 0, 0.06, 0.08, 0.82, DARK))
    parts.push(part(s, 0.01, 0.47, 0, 0.06, 0.2, 1.1, DARK))
    parts.push(part(s, -0.01, 0.67, 0, 0.04, 0.055, 0.25, GOLD))
    parts.push(part(s, -0.01, 0.67, 0, 0.04, 0.12, 0.09, GOLD))
    parts.push(part(s, L - 0.02, s.taillightY - 0.02, 0, 0.04, 0.05, 0.2, GOLD))
    parts.push(part(s, L - 0.02, s.taillightY - 0.02, 0, 0.04, 0.1, 0.075, GOLD))
    for (const side of [1, -1]) parts.push(part(s, L - 0.07, s.taillightY, side * (W / 2 - 0.22), 0.14, 0.14, 0.42, TAIL))
  } else {
    // JAC: крупная решётка, хромированная эмблема, сквозной задний фонарь
    parts.push(part(s, 0.02, 0.58, 0, 0.06, 0.26, 0.98, DARK))
    parts.push(part(s, -0.01, 0.66, 0, 0.04, 0.06, 0.22, CHROME))
    parts.push(part(s, L - 0.05, s.taillightY, 0, 0.1, 0.07, W - 0.24, TAIL))
  }
  // Fine door shut lines, handles and a B-pillar make the silhouette readable in LOD.
  const beltY = s.glass[0][1]
  const frontDoor = s.glass[0][0] + 0.62
  const rearDoor = s.glass[2][0] + 0.02
  for (const side of [-1, 1]) {
    const z = side * (W / 2 + 0.008)
    for (const x of [frontDoor, rearDoor]) {
      parts.push(part(s, x, beltY - 0.075, z, 0.14, 0.035, 0.026, CHROME))
      parts.push(part(s, x + 0.19, 0.68, z, 0.008, 0.45, 0.012, '#4b5159'))
    }
    parts.push(part(s, (frontDoor + rearDoor) / 2, 0.39, z, rearDoor - frontDoor + 0.7, 0.04, 0.023, DARK))
    parts.push(part(s, (s.glass[0][0] + s.glass[2][0]) / 2, 1.2, side * W * 0.45, 0.055, 0.33, 0.04, DARK))
  }
  return mergeGeometries(parts)!
}

function wheelGeoFor(r: number) {
  const paintGeo = (geometry: BufferGeometry, color: string) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    const c = new Color(color)
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }
  const parts: BufferGeometry[] = [
    paintGeo(new CylinderGeometry(r * 0.96, r * 0.96, 0.16, 24).rotateX(Math.PI / 2), '#101215'),
  ]
  for (const side of [-1, 1]) {
    parts.push(paintGeo(new TorusGeometry(r * 0.79, r * 0.2, 6, 24).translate(0, 0, side * 0.075), '#202328'))
    parts.push(paintGeo(new CylinderGeometry(r * 0.53, r * 0.53, 0.018, 24).rotateX(Math.PI / 2).translate(0, 0, side * 0.106), '#596067'))
    parts.push(paintGeo(new TorusGeometry(r * 0.61, 0.016, 5, 24).translate(0, 0, side * 0.123), '#c2c9d0'))
    parts.push(paintGeo(new CylinderGeometry(r * 0.14, r * 0.14, 0.035, 10).rotateX(Math.PI / 2).translate(0, 0, side * 0.127), '#bdc4cb'))
    for (let spoke = 0; spoke < 5; spoke++) {
      const angle = spoke * Math.PI * 2 / 5
      parts.push(paintGeo(new BoxGeometry(0.033, r * 0.46, 0.025).translate(0, r * 0.37, side * 0.132).rotateZ(angle), '#c6ccd2'))
    }
  }
  return mergeGeometries(parts)!
}

/** Колесо для дальних стоящих машин: шина и диск без спиц и ободов — ~60 треугольников вместо ~1 500. */
function wheelLowGeoFor(r: number) {
  const tinted = (geometry: BufferGeometry, color: string) => {
    const g = geometry.toNonIndexed()
    const c = new Color(color)
    const n = g.getAttribute('position').count
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }
  return mergeGeometries([
    tinted(new CylinderGeometry(r * 0.96, r * 0.96, 0.18, 10).rotateX(Math.PI / 2), '#101215'),
    tinted(new CylinderGeometry(r * 0.55, r * 0.55, 0.2, 8, 1, true).rotateX(Math.PI / 2), '#8d949b'),
  ])!
}

export interface CarGeometry {
  spec: Spec
  body: BufferGeometry
  glass: BufferGeometry
  details: BufferGeometry
  wheel: BufferGeometry
  /** четыре колеса */
  wheelPos: [number, number, number][]
  /** все четыре колеса одной геометрией — для стоящих машин */
  wheelsMerged: BufferGeometry
  /** то же в упрощённом виде — для стоянок, где вблизи машины заменяет GLB-модель */
  wheelsMergedLow: BufferGeometry
}

function build(id: CarModelId): CarGeometry {
  const s = SPECS[id]
  const body = extrudeCentered(bodyShape(s), s, s.width, 0.1)
  const glass = extrudeCentered(polyShape(s, s.glass), s, s.width + 0.02, 0.03)
  const details = detailsGeo(s)
  const wheel = wheelGeoFor(s.wheelR)
  const xf = s.length / 2 - s.frontOverhang
  const xr = xf - s.wheelbase
  const zw = s.width / 2 - 0.13
  const wheelPos: [number, number, number][] = [
    [xf, s.wheelR, zw],
    [xf, s.wheelR, -zw],
    [xr, s.wheelR, zw],
    [xr, s.wheelR, -zw],
  ]
  const wheelsMerged = mergeGeometries(wheelPos.map((p) => wheel.clone().translate(...p)))!
  const wheelLow = wheelLowGeoFor(s.wheelR)
  const wheelsMergedLow = mergeGeometries(wheelPos.map((p) => wheelLow.clone().translate(...p)))!
  return { spec: s, body, glass, details, wheel, wheelPos, wheelsMerged, wheelsMergedLow }
}

export const CARS: Record<CarModelId, CarGeometry> = {
  onix: build('onix'),
  cobalt: build('cobalt'),
  j7: build('j7'),
}

/** Материал деталей и колёс: цвет берётся из вершин. */
export const vertexColored = new MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.4 })
