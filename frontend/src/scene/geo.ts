import { Vector3 } from 'three'
import type { HallFrame, XY } from '../types'

/**
 * Мировые координаты сцены: x — восток, z — юг (−север), y — вверх. 1 единица = 1 метр.
 * Координаты площадки (x восток, y север) приходят с бэкенда в метрах от точки привязки.
 */
export const world = (x: number, y: number, h = 0) => new Vector3(x, h, -y)

/** Точка в системе корпуса (u — вдоль длинной стены, v — поперёк) → мировая. */
export function hallToWorld(f: HallFrame, u: number, v: number, h = 0): Vector3 {
  const c = Math.cos(f.angle)
  const s = Math.sin(f.angle)
  return world(f.origin[0] + u * c - v * s, f.origin[1] + u * s + v * c, h)
}

/** Мировая точка площадки → система корпуса. */
export function worldToHall(f: HallFrame, p: XY): XY {
  const c = Math.cos(f.angle)
  const s = Math.sin(f.angle)
  const dx = p[0] - f.origin[0]
  const dy = p[1] - f.origin[1]
  return [dx * c + dy * s, -dx * s + dy * c]
}

/**
 * Позиция внутри группы корпуса. Группа повёрнута на f.angle, поэтому
 * локальная ось X совпадает с u, а локальная Z направлена против v.
 */
export const L = (u: number, v: number, h = 0): [number, number, number] => [u, h, -v]
