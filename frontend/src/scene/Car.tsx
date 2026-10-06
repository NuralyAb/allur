import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { Group, Material, Mesh } from 'three'
import { MAT, WHEEL_POS, carBodyGeo, carGlassGeo, wheelGeo } from './assets'

export interface CarHandle {
  root: Group
  body: Mesh
  glass: Mesh
  wheels: Group
  setBody(m: Material): void
  setGlass(m: Material | null): void
  setWheels(on: boolean): void
}

interface Props {
  body?: Material
  glass?: Material | null
  wheels?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
}

/** Автомобиль/кузов. Стадию (материал кузова, стёкла, колёса) можно менять на лету через ref. */
export const Car = forwardRef<CarHandle, Props>(function Car(
  { body = MAT.biw, glass = MAT.opening, wheels = false, position, rotation },
  ref,
) {
  const root = useRef<Group>(null!)
  const bodyRef = useRef<Mesh>(null!)
  const glassRef = useRef<Mesh>(null!)
  const wheelsRef = useRef<Group>(null!)

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
  }))

  return (
    <group ref={root} position={position} rotation={rotation}>
      <mesh ref={bodyRef} geometry={carBodyGeo} material={body} />
      <mesh ref={glassRef} geometry={carGlassGeo} material={glass ?? MAT.glass} visible={!!glass} />
      <group ref={wheelsRef} visible={wheels}>
        {WHEEL_POS.map((p, i) => (
          <mesh key={i} geometry={wheelGeo} material={MAT.tyre} position={p} />
        ))}
      </group>
    </group>
  )
})
