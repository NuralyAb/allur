import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, createContext, Suspense, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Color, DynamicDrawUsage, Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three'
import { MAT } from '../core/assets'
import type { CarModelId } from './carModels'
import { useGlbAssets, type GlbAssetSpec } from './glbAssets'
import { prepareVehicleGeometry } from './vehicleGeometry'

export interface FleetVehicle {
  model: CarModelId
  root: Group
  fallback: Group
  body: Mesh
  glass: Mesh
  wheels: Group
  details: Mesh
}
interface FleetRegistry { vehicles: Set<FleetVehicle> }
const FleetContext = createContext<FleetRegistry | null>(null)
export function useVehicleFleet() { return useContext(FleetContext) }

class FleetBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.warn('Vehicle asset could not be displayed; keeping its local geometry.', error) }
  render() { return this.state.failed ? null : this.props.children }
}

/** One shared set of instanced PBR parts for every car, including the outside parking lot. */
export function VehicleFleetProvider({ children, detailed = true }: { children: ReactNode; detailed?: boolean }) {
  const registry = useMemo<FleetRegistry>(() => ({ vehicles: new Set() }), [])
  const assets = useGlbAssets()
  return <FleetContext.Provider value={registry}>
    {children}
    {Object.entries(assets.cars).map(([model, spec]) => spec && <FleetBoundary key={`${model}:${spec.url}`}>
      <Suspense fallback={null}><FleetModel model={model as CarModelId} spec={spec} registry={registry} detailed={detailed} /></Suspense>
    </FleetBoundary>)}
  </FleetContext.Provider>
}

const CAPACITY = 2048
/** Сколько ближайших машин в кадре получают GLB; остальные остаются лёгкой процедурной геометрией. */
const GLB_VEHICLES = { detailed: 140, light: 60 }
/** Дальность GLB по числу уровней детализации: без упрощённых версий модель рисуется только вблизи. */
const GLB_RANGE = [90, 260, 420]
interface Candidate { vehicle: FleetVehicle; distance: number }
const WHITE = new Color('white')
function FleetModel({ model, spec, registry, detailed }: { model: CarModelId; spec: GlbAssetSpec; registry: FleetRegistry; detailed: boolean }) {
  const loaded = useGLTF([spec.url, ...[spec.lodUrl, spec.distantUrl].filter((url): url is string => !!url)], false, true)
  const levels = useMemo(() => loaded.map(({ scene }) => prepareVehicleGeometry(scene, spec)), [loaded, spec])
  const parts = useMemo(() => levels.flatMap((asset, level) => asset.parts.map((part) => ({ ...part, level }))), [levels])
  const meshes = useRef<(InstancedMesh | null)[]>([])
  const parent = useRef<Group>(null!)
  const motion = useMemo(() => new WeakMap<FleetVehicle, { position: Vector3; travel: number; level: number }>(), [])
  const scratch = useMemo(() => ({
    inverse: new Matrix4(), matrix: new Matrix4(), local: new Matrix4(), rotation: new Matrix4(),
    frustum: new Frustum(), projection: new Matrix4(), center: new Vector3(), sphere: new Sphere(new Vector3(), 3.2),
    counts: new Uint32Array(parts.length), displacement: new Vector3(), forward: new Vector3(),
    candidates: [] as Candidate[], active: [] as Candidate[],
  }), [parts])

  useEffect(() => () => {
    for (const vehicle of registry.vehicles) if (vehicle.model === model) vehicle.fallback.visible = true
  }, [registry, model])

  useFrame(({ camera }) => {
    const { inverse, matrix, local, rotation, frustum, projection, sphere, counts, candidates, active } = scratch
    parent.current.updateWorldMatrix(true, false)
    inverse.copy(parent.current.matrixWorld).invert()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    counts.fill(0)
    const range = GLB_RANGE[Math.min(levels.length, GLB_RANGE.length) - 1]
    let found = 0
    for (const vehicle of registry.vehicles) {
      if (vehicle.model !== model) continue
      // Только своя матрица: родители — стоянки и линии — уже посчитаны рендером прошлого кадра.
      // Пересчёт всей цепочки родителей для каждой из ~1 300 машин занимал заметную часть кадра.
      vehicle.root.updateWorldMatrix(false, false)
      sphere.center.setFromMatrixPosition(vehicle.root.matrixWorld)
      const distance = camera.position.distanceTo(sphere.center)
      // The far model is a simplified derivative of the same vehicle, never a different sedan.
      const eligible = (levels[0].staged || vehicle.details.visible && vehicle.wheels.visible) && distance < range
      if (!eligible) { vehicle.fallback.visible = true; continue }
      let visible = true
      for (let node: Group | null = vehicle.root; node; node = node.parent as Group | null) if (!node.visible) { visible = false; break }
      // Вне кадра не рисуется ничего — ни GLB, ни процедурная машина.
      vehicle.fallback.visible = false
      if (!visible || !frustum.intersectsSphere(sphere)) continue
      const candidate = candidates[found] ??= { vehicle, distance }
      candidate.vehicle = vehicle
      candidate.distance = distance
      found++
    }
    // Стоянка готовой продукции — больше тысячи машин: GLB получают только ближайшие.
    active.length = 0
    for (let i = 0; i < found; i++) active.push(candidates[i])
    active.sort((a, b) => a.distance - b.distance)
    const limit = Math.min(found, detailed ? GLB_VEHICLES.detailed : GLB_VEHICLES.light, CAPACITY)
    for (let i = limit; i < found; i++) active[i].vehicle.fallback.visible = true
    for (let i = 0; i < limit; i++) {
      const { vehicle, distance } = active[i]
      sphere.center.setFromMatrixPosition(vehicle.root.matrixWorld)
      let wheelMotion = motion.get(vehicle)
      if (!wheelMotion) {
        wheelMotion = { position: sphere.center.clone(), travel: 0, level: distance > 35 && levels.length > 1 ? 1 : 0 }
        motion.set(vehicle, wheelMotion)
      }
      if (levels.length > 1) {
        const farThreshold = detailed ? (wheelMotion.level === 2 ? 125 : 155) : (wheelMotion.level === 2 ? 65 : 80)
        wheelMotion.level = levels.length > 2 && distance > farThreshold ? 2
          : !detailed ? 1 : distance > (wheelMotion.level ? 31 : 39) ? 1 : 0
      }
      scratch.displacement.subVectors(sphere.center, wheelMotion.position)
      // Actual route travel drives the wheels, so paused production and parked cars stay still.
      // Loop resets/teleports are not physical movement and must not produce a sudden spin.
      if (vehicle.wheels.visible && scratch.displacement.lengthSq() < 25) {
        scratch.forward.setFromMatrixColumn(vehicle.root.matrixWorld, 0).normalize()
        wheelMotion.travel += scratch.displacement.dot(scratch.forward)
      }
      wheelMotion.position.copy(sphere.center)
      matrix.multiplyMatrices(inverse, vehicle.root.matrixWorld)
      const bodyMaterial = vehicle.body.material
      const bodyColor = bodyMaterial instanceof MeshStandardMaterial ? bodyMaterial.color : WHITE
      parts.forEach((part, index) => {
        if (part.level !== wheelMotion.level) return
        const instance = meshes.current[index]
        if (!instance || counts[index] >= CAPACITY) return
        if (part.role === 'glass' && (!vehicle.glass.visible || vehicle.glass.material === MAT.opening)) return
        if (part.role === 'detail' && !vehicle.details.visible) return
        if (part.role === 'wheel' && !vehicle.wheels.visible) return
        local.copy(matrix)
        if (part.role === 'wheel') {
          local.multiply(rotation.makeTranslation(part.center.x, part.center.y, part.center.z))
          const radius = Math.max(0.2, part.center.y)
          local.multiply(rotation.makeRotationZ(-wheelMotion.travel / radius))
        }
        const slot = counts[index]++
        instance.setMatrixAt(slot, local)
        if (part.role === 'body') instance.setColorAt(slot, bodyColor)
      })
    }
    meshes.current.forEach((mesh, index) => {
      if (!mesh) return
      mesh.count = counts[index]
      // Upload only populated ranges. A whole 2,048-car allocation per part/per frame
      // would erase the benefit of batching a small visible subset of the site.
      mesh.instanceMatrix.clearUpdateRanges()
      if (mesh.count) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16)
        mesh.instanceMatrix.needsUpdate = true
      }
      if (mesh.instanceColor) {
        mesh.instanceColor.setUsage(DynamicDrawUsage)
        mesh.instanceColor.clearUpdateRanges()
        if (mesh.count) {
          mesh.instanceColor.addUpdateRange(0, mesh.count * 3)
          mesh.instanceColor.needsUpdate = true
        }
      }
    })
  })

  return <group ref={parent}>
    {parts.map((part, index) => <instancedMesh
      key={index} ref={(mesh) => { meshes.current[index] = mesh; mesh?.instanceMatrix.setUsage(DynamicDrawUsage) }}
      args={[part.geometry, part.material, CAPACITY]} count={0} frustumCulled={false}
      // Дальний уровень — машины в несколько пикселей: их тени в карте 0,25 м/тексель не видны.
      castShadow={part.level < 2} receiveShadow dispose={null}
    />)}
  </group>
}
