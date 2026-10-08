import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { MAT, paint } from '../core/assets'
import { CARS, vertexColored, type CarModelId } from './carModels'
import type { CarUnit } from './carUnits'
import { useVehicleFleet, type FleetVehicle } from './VehicleFleet'

export interface ParkedCar {
  p: [number, number, number]
  r: number
  color: string
  model: CarModelId
  unit?: CarUnit
}

const bodyMat = new MeshStandardMaterial({ metalness: 0.55, roughness: 0.32 })

interface Opts {
  wheels?: boolean
  glass?: boolean
  details?: boolean
}

/** Много неподвижных автомобилей/кузовов: по несколько instanced-мешей на каждую модель. */
export function ParkedCars({ cars, wheels = true, glass = true, details = true }: { cars: ParkedCar[] } & Opts) {
  const byModel = useMemo(() => {
    const m = new Map<CarModelId, ParkedCar[]>()
    for (const c of cars) m.set(c.model, [...(m.get(c.model) ?? []), c])
    return [...m.entries()]
  }, [cars])
  return (
    <group>
      {byModel.map(([model, list]) => (
        <ModelInstances key={model} model={model} cars={list} wheels={wheels} glass={glass} details={details} />
      ))}
    </group>
  )
}

function ModelInstances({ model, cars, wheels, glass, details }: { model: CarModelId; cars: ParkedCar[] } & Required<Opts>) {
  const geo = CARS[model]
  const parent = useRef<Group>(null!)
  const fleet = useVehicleFleet()
  const entries = useMemo<FleetVehicle[]>(() => cars.map((car) => {
    const root = new Group()
    root.position.set(...car.p)
    root.rotation.y = car.r
    root.userData.unit = car.unit
    const fallback = new Group()
    const body = new Mesh(undefined, paint(car.color))
    const gl = new Mesh(undefined, MAT.glass)
    gl.visible = glass
    const wh = new Group()
    wh.visible = wheels
    const dt = new Mesh()
    dt.visible = details
    root.add(fallback)
    return { model, root, fallback, body, glass: gl, wheels: wh, details: dt }
  }), [cars, model, wheels, glass, details])
  const shown = useRef<boolean[]>([])
  const matrix = useMemo(() => new Object3D(), [])

  useLayoutEffect(() => {
    if (!fleet) return
    for (const entry of entries) { parent.current.add(entry.root); fleet.vehicles.add(entry) }
    shown.current = entries.map(() => true)
    return () => {
      for (const entry of entries) { fleet.vehicles.delete(entry); entry.root.removeFromParent() }
    }
  }, [fleet, entries])
  const body = useRef<InstancedMesh>(null!)
  const gl = useRef<InstancedMesh>(null)
  const wh = useRef<InstancedMesh>(null)
  const dt = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const o = new Object3D()
    const col = new Color()
    cars.forEach((c, i) => {
      o.position.set(...c.p)
      o.rotation.set(0, c.r, 0)
      o.updateMatrix()
      body.current.setMatrixAt(i, o.matrix)
      body.current.setColorAt(i, col.set(c.color))
      for (const m of [gl.current, wh.current, dt.current]) m?.setMatrixAt(i, o.matrix)
    })
    for (const m of [body.current, gl.current, wh.current, dt.current]) {
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [cars, wheels, glass, details])

  useFrame(() => {
    let changed = false
    entries.forEach((entry, index) => {
      const visible = entry.fallback.visible
      if (shown.current[index] === visible) return
      shown.current[index] = visible
      matrix.position.copy(entry.root.position)
      matrix.rotation.copy(entry.root.rotation)
      matrix.scale.setScalar(visible ? 1 : 0)
      matrix.updateMatrix()
      for (const mesh of [body.current, gl.current, wh.current, dt.current]) mesh?.setMatrixAt(index, matrix.matrix)
      changed = true
    })
    if (changed) for (const mesh of [body.current, gl.current, wh.current, dt.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={parent}>
      <instancedMesh ref={body} args={[geo.body, bodyMat, cars.length]} castShadow />
      {glass && <instancedMesh ref={gl} args={[geo.glass, MAT.glass, cars.length]} />}
      {details && <instancedMesh ref={dt} args={[geo.details, vertexColored, cars.length]} />}
      {wheels && <instancedMesh ref={wh} args={[geo.wheelsMergedLow, vertexColored, cars.length]} />}
    </group>
  )
}
