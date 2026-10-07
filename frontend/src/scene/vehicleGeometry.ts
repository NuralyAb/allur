import { Box3, BufferGeometry, Float32BufferAttribute, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { GlbAssetSpec } from './glbAssets'
import { prepareGlbScene } from './prepareGlbScene'

export type VehiclePart = 'body' | 'glass' | 'detail' | 'whole' | 'wheel'
export interface VehicleGeometryPart {
  geometry: BufferGeometry
  material: Material
  role: VehiclePart
  wheel: number
  center: Vector3
}
export interface VehicleGeometry {
  parts: VehicleGeometryPart[]
  /** A single textured surface cannot truthfully be stripped into manufacturing stages. */
  staged: boolean
  triangles: number
}
const cache = new WeakMap<Object3D, Map<string, VehicleGeometry>>()

function inWheelHierarchy(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (/^(wheel(?:[._]|$)|roda(?:[._]|$))/i.test(node.name)) return true
  }
  return false
}

/** Bake transforms once and merge compatible semantic parts, keeping authored PBR maps. */
export function prepareVehicleGeometry(source: Object3D, spec: GlbAssetSpec): VehicleGeometry {
  const key = `${spec.length}:${spec.rotationY}:${spec.source}`
  const existing = cache.get(source)?.get(key)
  if (existing) return existing
  const normalized = prepareGlbScene(source, spec)
  normalized.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  normalized.traverse((object) => { if (object instanceof Mesh) meshes.push(object) })
  const staged = meshes.some((mesh) => !Array.isArray(mesh.material) && /^(primary$|realistic_car_paint$|carpaint|bodypaint)/i.test(mesh.material.name))
  const seen = new Set<string>()
  const groups = new Map<string, { geometries: BufferGeometry[]; material: Material; role: VehiclePart; wheel: number }>()
  for (const mesh of meshes) {
    // The importer accepts standard glTF primitives, each loaded as a single-material mesh.
    if (Array.isArray(mesh.material)) continue
    const material = mesh.material
    const duplicateKey = `${mesh.geometry.uuid}:${material.uuid}:${mesh.matrixWorld.elements.map((value) => value.toFixed(6)).join(',')}`
    if (seen.has(duplicateKey)) continue
    seen.add(duplicateKey)
    if (material.transparent && material.opacity === 0) continue
    let role: VehiclePart = !staged ? 'whole' : /^(primary$|realistic_car_paint$|carpaint|bodypaint)/i.test(material.name) ? 'body' : /glass|windshield/i.test(material.name) ? 'glass' : 'detail'
    let wheel = -1
    const bounds = new Box3().setFromObject(mesh, true)
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    if (staged && inWheelHierarchy(mesh) && size.y < 1.1 && Math.abs(center.z) > 0.45 && center.y < 0.8) {
      role = 'wheel'
      wheel = (center.x < 0 ? 2 : 0) + (center.z < 0 ? 1 : 0)
    }
    const groupKey = `${role}:${wheel}:${material.uuid}`
    let group = groups.get(groupKey)
    if (!group) {
      let surface = material
      if (role === 'body' && material instanceof MeshStandardMaterial) {
        surface = material.clone()
        const finish = surface as MeshStandardMaterial
        finish.color.set('white')
        // This asset ships nearly fully rough, fully metallic white paint.
        // Calibrate the inspected Cobalt finish while retaining its geometry and authored maps.
        if (spec.source.includes('f91cbef731444f939e263041400216ca')) {
          finish.roughness = 0.25
          finish.metalness = 0.48
          if (finish instanceof MeshPhysicalMaterial) finish.clearcoat = 0.7
        }
      }
      group = { geometries: [], material: surface, role, wheel }
      groups.set(groupKey, group)
    }
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    // Consistent attributes let glTF primitives merge even if a tiny badge has no UVs.
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name)
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
    group.geometries.push(geometry)
  }
  const wheelBounds = [new Box3(), new Box3(), new Box3(), new Box3()]
  for (const { geometries, role, wheel } of groups.values()) {
    if (role !== 'wheel') continue
    for (const geometry of geometries) { geometry.computeBoundingBox(); wheelBounds[wheel].union(geometry.boundingBox!) }
  }
  const parts: VehicleGeometryPart[] = []
  for (const { geometries, material, role, wheel } of groups.values()) {
    const allIndexed = geometries.every((geometry) => geometry.index)
    const compatible = allIndexed ? geometries : geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry)
    const geometry = mergeGeometries(compatible)
    if (!geometry) throw new Error('Unable to merge vehicle primitives')
    const center = role === 'wheel' ? wheelBounds[wheel].getCenter(new Vector3()) : new Vector3()
    if (role === 'wheel') geometry.translate(-center.x, -center.y, -center.z)
    geometry.computeBoundingSphere()
    parts.push({ geometry, material, role, wheel, center })
    const temporary = new Set([...geometries, ...compatible])
    for (const original of temporary) original.dispose()
  }
  const result = { parts, staged, triangles: parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3, 0) }
  let entries = cache.get(source)
  if (!entries) { entries = new Map(); cache.set(source, entries) }
  entries.set(key, result)
  return result
}
