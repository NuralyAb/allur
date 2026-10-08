import type { Object3D } from 'three'
import type { CarModelId } from './carModels'

/** Где машина находится в сцене. sim — кузов из движка симуляции. */
export type UnitPlace = 'welding' | 'paint' | 'pbs' | 'assembly' | 'qc' | 'testtrack' | 'outbound' | 'finished' | 'sim'

/**
 * Метка машины в сцене: по ней карточка строит VIN, сроки и статус.
 * Хранится в userData корня машины; анимации пишут туда же текущее положение:
 * progress — доля пути по участку (0–1), station — номер поста, cycle — номер круга петли.
 */
export interface CarUnit {
  /** Постоянный ключ: по нему выбранная машина находится снова после перемонтирования. */
  key: string
  place: UnitPlace
  model: CarModelId
  /** Цвет кузова по заказу — у некрашеных кузовов тоже */
  color: string
  index: number
  /** Линия сварки, 0–3 */
  line?: number
  /** ID кузова в симуляции */
  body?: string
}

/** Выбранная машина. root обновляет сцена, если машина перемонтировалась. */
export interface CarSelection {
  unit: CarUnit
  root: Object3D | null
  /** Круг петли на момент выбора: на следующем круге по этому месту едет уже другая машина. */
  cycle: number
  /** Положение на участке в момент выбора: от него строятся сроки. */
  progress: number
  station: number
  /** Момент выбора: от него считаются сценарные сроки. */
  at: number
}

export const unitOf = (o: Object3D): CarUnit | undefined => o.userData.unit
export const cycleOf = (o: Object3D): number => o.userData.cycle ?? 0

/** Положение машины на участке — пишется каждый кадр, без выделения памяти. */
export function track(o: Object3D, progress: number, station: number, cycle: number) {
  const d = o.userData
  d.progress = progress
  d.station = station
  d.cycle = cycle
}

/** Машина в сцене и видна: она и все её родители видимы, цепочка доходит до сцены. */
export function shown(o: Object3D) {
  let node: Object3D | null = o
  for (; node; node = node.parent) {
    if (!node.visible) return false
    if ((node as { isScene?: boolean }).isScene) return true
  }
  return false
}

/** Машина ещё в графе сцены (видимость не важна). */
export function attached(o: Object3D) {
  let node: Object3D | null = o
  while (node.parent) node = node.parent
  return (node as { isScene?: boolean }).isScene === true
}
