import { useFrame } from '@react-three/fiber'
import { forwardRef, useRef } from 'react'
import type { Group, Material } from 'three'
import { MAT } from './assets'
import { Car, type CarHandle } from './Car'
import type { CarModelId } from './carModels'

/** Keep the route root stable; the shared fleet renders every available GLB. */
export const FinishedCar = forwardRef<Group, {
  model: CarModelId
  body: Material
}>(function FinishedCar({ model, body }, ref) {
  const car = useRef<CarHandle>(null)
  useFrame((_, delta) => {
    car.current?.wheels.children.forEach((wheel) => { wheel.rotation.z -= delta * 1.1 / 0.31 })
  })
  return <group ref={ref}><Car ref={car} model={model} body={body} glass={MAT.glass} wheels details /></group>
})
