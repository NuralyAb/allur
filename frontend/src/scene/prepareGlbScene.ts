import { Box3, Group, Mesh, Vector3, type Object3D } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { GlbAssetSpec } from './glbAssets'

/** Preserve authored PBR materials; share cached geometry/textures between clones. */
export function prepareGlbScene(source: Object3D, spec: GlbAssetSpec, conveyor = false): Group {
  const model = clone(source)
  const rotated = new Group()
  rotated.rotation.y = spec.rotationY
  rotated.add(model)
  rotated.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(rotated, true)
  const size = bounds.getSize(new Vector3())
  if (bounds.isEmpty() || ![size.x, size.y, size.z].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('GLB has no finite three-dimensional bounds.')
  }

  const scale = spec.length / size.x
  const width = size.z * scale
  const height = size.y * scale
  const epsilon = 1e-5 // GLB positions commonly use Float32, including boundary dimensions.
  // This slot replaces a floor-level slat section, not an elevated warehouse belt.
  if (conveyor && (spec.length > 12.8 + epsilon || width < 2.2 - epsilon || width > 3.2 + epsilon || height > 0.35 + epsilon)) {
    throw new Error('Conveyor must fit the floor slot: length ≤12.8 m, width 2.2–3.2 m, height ≤0.35 m.')
  }
  if (!conveyor && (width < 1.4 - epsilon || width > 2.4 + epsilon || height < 1.1 - epsilon || height > 2.1 + epsilon)) {
    throw new Error('Car GLB proportions do not fit the selected vehicle. Check orientation and remove its display platform.')
  }

  const center = bounds.getCenter(new Vector3())
  const normalized = new Group()
  normalized.scale.setScalar(scale)
  normalized.position.set(-center.x * scale, conveyor ? 0.3 - bounds.max.y * scale : -bounds.min.y * scale, -center.z * scale)
  normalized.add(rotated)
  model.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  return normalized
}
