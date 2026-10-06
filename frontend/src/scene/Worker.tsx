import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { CapsuleGeometry, SphereGeometry, type Group } from 'three'
import { MAT, unitBox } from './assets'

const torsoGeo = new CapsuleGeometry(0.2, 0.5, 4, 10)
const headGeo = new SphereGeometry(0.12, 12, 10)

/** Оператор поста: тёмно-синяя спецодежда, сигнальный жилет. */
export function Worker({ position, yaw = 0, phase = 0 }: { position: [number, number, number]; yaw?: number; phase?: number }) {
  const g = useRef<Group>(null!)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase
    g.current.rotation.y = yaw + Math.sin(t * 0.8) * 0.5
    g.current.children[1].rotation.x = Math.max(0, Math.sin(t * 1.3)) * 0.35
  })
  return (
    <group ref={g} position={position}>
      <mesh geometry={unitBox} material={MAT.worker} scale={[0.32, 0.85, 0.2]} position={[0, 0.42, 0]} />
      <group position={[0, 0.85, 0]}>
        <mesh geometry={torsoGeo} material={MAT.vest} position={[0, 0.35, 0]} />
        <mesh geometry={headGeo} material={MAT.skin} position={[0, 0.83, 0]} />
      </group>
    </group>
  )
}
