import { Box3, Quaternion, Vector3, type Object3D } from 'three'
import type { GlbAssetSpec } from './glbAssets'

const ONIX_URL = '/models/onix-c1bb20bcc2b636e8.glb'
const ONIX_SOURCE = 'https://sketchfab.com/3d-models/chevrolet-onix-bfd798c2695847b28ab681d42abc7056'
const AXLE = new Vector3(1, 0, 0)
const PIVOTS = [
  ['wheel_rf_dummy', -1],
  ['wheel_rf_dummy001', -1],
  ['wheel_rf_dummy002', 1],
  ['wheel_rf_dummy003', 1],
] as const

export interface OnixWheelRig {
  readonly radiusMeters: number
  /** Signed travel along the vehicle's forward axis, in scene metres. */
  advance(distanceMeters: number): void
}

/** Bind only the inspected asset's authored pivots, on a prepared scene clone. */
export function createOnixWheelRig(object: Object3D, spec: GlbAssetSpec): OnixWheelRig | null {
  if (spec.url !== ONIX_URL || spec.source !== ONIX_SOURCE) return null
  const wheels = PIVOTS.map(([name, direction]) => {
    const pivot = object.getObjectByName(name)
    return pivot ? { pivot, direction, authored: pivot.quaternion.clone() } : null
  })
  if (wheels.some((wheel) => wheel === null)) return null
  const boundWheels = wheels.filter((wheel) => wheel !== null)

  // The prepared model has uniform metre scale and Y up. Measuring the tire's
  // diameter retains the authored proportions when manifest length changes.
  object.updateWorldMatrix(true, true)
  const size = new Box3().setFromObject(boundWheels[0].pivot, true).getSize(new Vector3())
  const radiusMeters = size.y / 2
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null

  let angle = 0
  const roll = new Quaternion()
  return {
    radiusMeters,
    advance(distanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters === 0) return
      angle = (angle + distanceMeters / radiusMeters) % (Math.PI * 2)
      for (const { pivot, direction, authored } of boundWheels) {
        roll.setFromAxisAngle(AXLE, angle * direction)
        pivot.quaternion.copy(authored).multiply(roll)
      }
    },
  }
}
