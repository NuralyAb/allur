import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { MAT } from './assets'
import { CARS, vertexColored, type CarModelId } from './carModels'

export interface CarHandle {
  root: Group
  body: Mesh
  glass: Mesh
  wheels: Group
  setBody(m: Material): void
  setGlass(m: Material | null): void
  setWheels(on: boolean): void
  setDetails(on: boolean): void
}

interface Props {
  model?: CarModelId
  body?: Material
  glass?: Material | null
  wheels?: boolean
  /** фары, фонари, решётка, эмблемы, зеркала */
  details?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
}

/**
 * Автомобиль одной из моделей завода. Стадию (материал кузова, стёкла, колёса, навесные детали)
 * можно менять на лету через ref — так кузов «собирается» по ходу конвейера.
 */
export const Car = forwardRef<CarHandle, Props>(function Car(
  { model = 'onix', body = MAT.biw, glass = MAT.opening, wheels = false, details = false, position, rotation },
  ref,
) {
  const geo = CARS[model]
  const root = useRef<Group>(null!)
  const bodyRef = useRef<Mesh>(null!)
  const glassRef = useRef<Mesh>(null!)
  const wheelsRef = useRef<Group>(null!)
  const detailsRef = useRef<Mesh>(null!)

  useImperativeHandle(ref, () => ({
    root: root.current,
    body: bodyRef.current,
    glass: glassRef.current,
    wheels: wheelsRef.current,
    setBody: (m) => {
      if (bodyRef.current.material !== m) bodyRef.current.material = m
    },
    setGlass: (m) => {
      glassRef.current.visible = !!m
      if (m && glassRef.current.material !== m) glassRef.current.material = m
    },
    setWheels: (on) => {
      wheelsRef.current.visible = on
    },
    setDetails: (on) => {
      detailsRef.current.visible = on
    },
  }))

  return (
    <group ref={root} position={position} rotation={rotation}>
      <mesh ref={bodyRef} geometry={geo.body} material={body} />
      <mesh ref={glassRef} geometry={geo.glass} material={glass ?? MAT.glass} visible={!!glass} />
      <mesh ref={detailsRef} geometry={geo.details} material={vertexColored} visible={details} />
      <group ref={wheelsRef} visible={wheels}>
        {geo.wheelPos.map((p, i) => (
          <mesh key={i} geometry={geo.wheel} material={vertexColored} position={p} />
        ))}
      </group>
    </group>
  )
})
