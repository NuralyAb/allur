import { useFrame } from '@react-three/fiber'
import { forwardRef, useRef } from 'react'
import type { Group, Material } from 'three'
import { MAT } from './assets'
import { Car, type CarHandle } from './Car'
import type { CarModelId } from './carModels'
import type { GlbAssetSpec } from './glbAssets'
import { OptionalGlb } from './OptionalGlb'

/** Keep the moving root stable while the optional finished vehicle loads or switches LOD. */
export const FinishedCar = forwardRef<Group, {
  model: CarModelId
  body: Material
  spec: GlbAssetSpec | null
  detailed: boolean
}>(function FinishedCar({ model, body, spec, detailed }, ref) {
  const fallback = useRef<CarHandle>(null)
  useFrame((_, delta) => {
    fallback.current?.wheels.children.forEach((wheel) => { wheel.rotation.z -= delta * 1.1 / 0.31 })
  })
  return (
    <group ref={ref}>
      <OptionalGlb spec={spec} enabled={detailed} speed={1.1}>
        <Car ref={fallback} model={model} body={body} glass={MAT.glass} wheels details />
      </OptionalGlb>
    </group>
  )
})
