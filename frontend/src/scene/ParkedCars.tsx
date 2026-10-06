import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import { MAT } from './assets'
import { CARS, vertexColored, type CarModelId } from './carModels'

export interface ParkedCar {
  p: [number, number, number]
  r: number
  color: string
  model: CarModelId
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

  return (
    <group>
      <instancedMesh ref={body} args={[geo.body, bodyMat, cars.length]} castShadow />
      {glass && <instancedMesh ref={gl} args={[geo.glass, MAT.glass, cars.length]} />}
      {details && <instancedMesh ref={dt} args={[geo.details, vertexColored, cars.length]} />}
      {wheels && <instancedMesh ref={wh} args={[geo.wheelsMerged, vertexColored, cars.length]} />}
    </group>
  )
}
