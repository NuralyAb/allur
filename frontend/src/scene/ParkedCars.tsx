import { useLayoutEffect, useRef } from 'react'
import { Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import { MAT, WHEEL_POS, carBodyGeo, carGlassGeo, wheelGeo } from './assets'

export interface ParkedCar {
  p: [number, number, number]
  r: number
  color: string
}

const bodyMat = new MeshStandardMaterial({ metalness: 0.55, roughness: 0.32 })

/** Много неподвижных автомобилей/кузовов — три instanced-меша на всё. */
export function ParkedCars({ cars, wheels = true, glass = true }: { cars: ParkedCar[]; wheels?: boolean; glass?: boolean }) {
  const body = useRef<InstancedMesh>(null!)
  const gl = useRef<InstancedMesh>(null!)
  const wh = useRef<InstancedMesh>(null!)

  useLayoutEffect(() => {
    const o = new Object3D()
    const w = new Object3D()
    const col = new Color()
    cars.forEach((c, i) => {
      o.position.set(...c.p)
      o.rotation.set(0, c.r, 0)
      o.updateMatrix()
      body.current.setMatrixAt(i, o.matrix)
      body.current.setColorAt(i, col.set(c.color))
      if (glass) gl.current.setMatrixAt(i, o.matrix)
      if (wheels)
        WHEEL_POS.forEach((wp, j) => {
          w.position.set(...wp)
          w.rotation.set(0, 0, 0)
          w.updateMatrix()
          w.matrix.premultiply(o.matrix)
          wh.current.setMatrixAt(i * 4 + j, w.matrix)
        })
    })
    for (const m of [body.current, gl.current, wh.current]) {
      if (!m) continue
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.computeBoundingSphere()
    }
  }, [cars, wheels, glass])

  return (
    <group>
      <instancedMesh ref={body} args={[carBodyGeo, bodyMat, cars.length]} castShadow />
      {glass && <instancedMesh ref={gl} args={[carGlassGeo, MAT.glass, cars.length]} />}
      {wheels && <instancedMesh ref={wh} args={[wheelGeo, MAT.tyre, cars.length * 4]} />}
    </group>
  )
}
