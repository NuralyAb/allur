import { useProductionFrame } from '../simulation/ProductionClock'
import { useRef } from 'react'
import { BoxGeometry, CapsuleGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry, type Group } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { MAT, paint } from './assets'

function merged(parts: BufferGeometry[]) {
  const result = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  return result
}
const legs = merged([-1, 1].flatMap((side) => [
  new CapsuleGeometry(0.072, 0.61, 3, 8).translate(side * 0.095, 0.44, 0),
  new BoxGeometry(0.15, 0.13, 0.29).translate(side * 0.095, 0.085, 0.065),
]))
const torso = new CapsuleGeometry(0.18, 0.26, 4, 10).scale(1, 1, 0.66).translate(0, 0.31, 0)
const arms = merged([-1, 1].flatMap((side) => [
  new CapsuleGeometry(0.06, 0.22, 3, 8).rotateZ(side * 0.1).translate(side * 0.235, 0.34, 0.02),
  new CapsuleGeometry(0.052, 0.19, 3, 8).rotateX(-0.9).translate(side * 0.245, 0.155, 0.125),
]))
const skin = merged([
  new SphereGeometry(0.122, 12, 8).scale(0.88, 1.12, 0.94).translate(0, 0.66, 0),
  ...[-1, 1].map((side) => new SphereGeometry(0.055, 8, 6).scale(0.78, 1, 1.12).translate(side * 0.245, 0.07, 0.235)),
])
const ppe = merged([
  new SphereGeometry(0.144, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.735, 0),
  new CylinderGeometry(0.169, 0.169, 0.025, 12).translate(0, 0.735, 0),
  ...[0.24, 0.37].flatMap((y) => [-1, 1].map((side) => new BoxGeometry(0.32, 0.036, 0.015).translate(0, y, side * 0.122))),
])
const workwear = paint('#354b5b', 0, 0.84)
const vest = paint('#c4994d', 0.05, 0.76)

/** Operator PPE at human scale; geometry is shared by all workers. */
export function Worker({ position, yaw = 0, phase = 0 }: { position: [number, number, number]; yaw?: number; phase?: number }) {
  const g = useRef<Group>(null!)
  const upper = useRef<Group>(null!)
  useProductionFrame(({ clock }) => {
    const t = clock.elapsedTime + phase
    g.current.rotation.y = yaw + Math.sin(t * 0.8) * 0.16
    upper.current.rotation.x = Math.max(0, Math.sin(t * 1.3)) * 0.1
  })
  return (
    <group ref={g} position={position} rotation={[0, yaw, 0]}>
      <mesh geometry={legs} material={workwear} castShadow />
      <group ref={upper} position={[0, 0.85, 0]}>
        <mesh geometry={arms} material={workwear} castShadow />
        <mesh geometry={torso} material={vest} castShadow />
        <mesh geometry={skin} material={MAT.skin} />
        <mesh geometry={ppe} material={MAT.wall} />
      </group>
    </group>
  )
}
