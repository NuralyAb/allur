import { CurvePath, LineCurve3, Object3D, QuadraticBezierCurve3, Vector3 } from 'three'

export type P3 = [number, number, number]

/** Ломаная со скруглёнными углами — траектория конвейера. */
export function makePath(points: P3[], radius = 3): CurvePath<Vector3> {
  const pts = points.map((p) => new Vector3(...p))
  const path = new CurvePath<Vector3>()
  let start = pts[0].clone()
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    const r = Math.min(radius, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2)
    const a = cur.clone().add(prev.clone().sub(cur).normalize().multiplyScalar(r))
    const b = cur.clone().add(next.clone().sub(cur).normalize().multiplyScalar(r))
    path.add(new LineCurve3(start, a))
    path.add(new QuadraticBezierCurve3(a, cur.clone(), b))
    start = b
  }
  path.add(new LineCurve3(start, pts[pts.length - 1].clone()))
  return path
}

const tmpP = new Vector3()
const tmpT = new Vector3()

/** Ставит объект на траекторию на расстоянии dist (м) и разворачивает по касательной (ось X — вперёд). */
export function placeOnPath(path: CurvePath<Vector3>, length: number, dist: number, obj: Object3D, lift = 0) {
  const t = Math.min(Math.max(dist / length, 0), 1)
  path.getPointAt(t, tmpP)
  path.getTangentAt(t, tmpT)
  obj.position.set(tmpP.x, tmpP.y + lift, tmpP.z)
  obj.rotation.set(0, Math.atan2(-tmpT.z, tmpT.x), 0)
  return tmpP
}

const smooth = (x: number) => x * x * (3 - 2 * x)

/**
 * Тактовое (шаговое) перемещение: изделие стоит на посту, затем за moveTime
 * переезжает на следующий. Возвращает пройденный путь в шагах.
 */
export function indexed(time: number, period: number, moveTime: number) {
  const k = Math.floor(time / period)
  const f = (time - k * period) / moveTime
  return k + smooth(Math.min(f, 1))
}

/** Изделие стоит на посту (а не переезжает) — роботы в этот момент работают. */
export function isDwelling(time: number, period: number, moveTime: number) {
  return time % period > moveTime
}

export const mod = (a: number, n: number) => ((a % n) + n) % n
