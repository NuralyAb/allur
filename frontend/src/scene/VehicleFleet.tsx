import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, createContext, Suspense, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Color, Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three'
import { MAT } from './assets'
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
  }), [parts])

  useEffect(() => () => {
    for (const vehicle of registry.vehicles) if (vehicle.model === model) vehicle.fallback.visible = true
  }, [registry, model])

  useFrame(({ camera }) => {
    const { inverse, matrix, local, rotation, frustum, projection, sphere, counts } = scratch
    parent.current.updateWorldMatrix(true, false)
    inverse.copy(parent.current.matrixWorld).invert()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    counts.fill(0)
    let renderedVehicles = 0
    for (const vehicle of registry.vehicles) {
      if (vehicle.model !== model) continue
      let visible = true
      for (let node: Group | null = vehicle.root; node; node = node.parent as Group | null) if (!node.visible) { visible = false; break }
      vehicle.root.updateWorldMatrix(true, false)
      sphere.center.setFromMatrixPosition(vehicle.root.matrixWorld)
      const distance = camera.position.distanceTo(sphere.center)
      // The far model is a simplified derivative of the same vehicle, never a different sedan.
      const eligible = (levels[0].staged || vehicle.details.visible && vehicle.wheels.visible) && distance < (levels.length > 1 ? 900 : 240) && renderedVehicles < CAPACITY
      vehicle.fallback.visible = !eligible
      if (!visible || !eligible || !frustum.intersectsSphere(sphere)) continue
      renderedVehicles++
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
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  })

  return <group ref={parent}>
    {parts.map((part, index) => <instancedMesh
      key={index} ref={(mesh) => { meshes.current[index] = mesh }}
      args={[part.geometry, part.material, CAPACITY]} count={0} frustumCulled={false}
      castShadow receiveShadow dispose={null}
    />)}
  </group>
}
