import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Color, MeshBasicMaterial, SphereGeometry, type Group, type Material, type Mesh } from 'three'
import { MAT, unitBox, unitCyl } from './assets'

const sparkMat = new MeshBasicMaterial({ color: new Color(6, 4.2, 1.6), toneMapped: false })
const laserMat = new MeshBasicMaterial({ color: new Color(8, 0.6, 0.3), toneMapped: false })
const sprayMat = new MeshBasicMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.35, depthWrite: false })
const sparkGeo = new SphereGeometry(1, 8, 6)

export type Tool = 'gun' | 'laser' | 'spray' | 'gripper'

interface Props {
  position: [number, number, number]
  /** поворот основания: робот «смотрит» вдоль своей оси X */
  yaw?: number
  tool?: Tool
  phase?: number
  speed?: number
  scale?: number
  material?: Material
  /** функция «сейчас идёт процесс» — например, кузов стоит на посту */
  active?: (t: number) => boolean
}

/** Шестиосевой промышленный робот (силуэт ABB IRB 6700-класса). */
export function Robot({ position, yaw = 0, tool = 'gun', phase = 0, speed = 1, scale = 1, material = MAT.robot, active }: Props) {
  const turret = useRef<Group>(null!)
  const shoulder = useRef<Group>(null!)
  const elbow = useRef<Group>(null!)
  const wrist = useRef<Group>(null!)
  const fx = useRef<Mesh>(null!)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed + phase
    const on = active ? active(clock.elapsedTime) : true
    const a = on ? 1 : 0.25
    turret.current.rotation.y = Math.sin(t * 0.7) * 0.6 * a
    shoulder.current.rotation.z = -0.35 + Math.sin(t * 1.1) * 0.22 * a
    elbow.current.rotation.z = 0.9 + Math.sin(t * 1.3 + 1) * 0.3 * a
    wrist.current.rotation.x = Math.sin(t * 2.1) * 0.8 * a
    if (fx.current) {
      const flicker = tool === 'gun' ? Math.sin(t * 23) > 0.2 : true
      fx.current.visible = on && flicker
      if (tool === 'gun') fx.current.scale.setScalar(0.04 + (Math.sin(t * 71) * 0.5 + 0.5) * 0.07)
    }
  })

  return (
    <group position={position} rotation={[0, yaw, 0]} scale={scale}>
      {/* основание */}
      <mesh geometry={unitCyl} material={MAT.robotDark} scale={[0.95, 0.35, 0.95]} position={[0, 0.17, 0]} castShadow receiveShadow />
      <group ref={turret} position={[0, 0.35, 0]}>
        <mesh geometry={unitBox} material={material} scale={[0.8, 0.55, 0.75]} position={[0, 0.27, 0]} />
        {/* плечо */}
        <group ref={shoulder} position={[0.15, 0.6, 0]}>
          <mesh geometry={unitBox} material={material} scale={[0.32, 1.45, 0.36]} position={[0, 0.72, 0]} castShadow />
          <mesh geometry={unitCyl} material={MAT.robotDark} scale={[0.42, 0.5, 0.42]} rotation={[Math.PI / 2, 0, 0]} />
          {/* предплечье */}
          <group ref={elbow} position={[0, 1.45, 0]}>
            <mesh geometry={unitCyl} material={MAT.robotDark} scale={[0.36, 0.44, 0.36]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={unitBox} material={material} scale={[1.35, 0.26, 0.28]} position={[0.62, 0, 0]} castShadow />
            <group ref={wrist} position={[1.32, 0, 0]}>
              <mesh geometry={unitCyl} material={MAT.robotDark} scale={[0.2, 0.22, 0.2]} rotation={[0, 0, Math.PI / 2]} />
              <ToolHead tool={tool} fxRef={fx} />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

function ToolHead({ tool, fxRef }: { tool: Tool; fxRef: React.RefObject<Mesh> }) {
  switch (tool) {
    case 'gun': // клещи контактной точечной сварки
      return (
        <group position={[0.18, 0, 0]}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.22, 0.34, 0.2]} />
          <mesh geometry={unitBox} material={MAT.steel} scale={[0.05, 0.45, 0.05]} position={[0.14, -0.2, 0]} />
          <mesh geometry={unitBox} material={MAT.steel} scale={[0.3, 0.05, 0.05]} position={[0.26, -0.42, 0]} />
          <mesh ref={fxRef} geometry={sparkGeo} material={sparkMat} scale={0.09} position={[0.4, -0.42, 0]} />
        </group>
      )
    case 'laser': // оптическая головка лазерной сварки
      return (
        <group position={[0.15, 0, 0]}>
          <mesh geometry={unitCyl} material={MAT.darkSteel} scale={[0.16, 0.3, 0.16]} rotation={[0, 0, Math.PI / 2]} />
          <mesh ref={fxRef} geometry={unitCyl} material={laserMat} scale={[0.02, 0.6, 0.02]} position={[0.3, -0.25, 0]} rotation={[0, 0, 0.6]} />
        </group>
      )
    case 'spray': // ротационный распылитель
      return (
        <group position={[0.15, 0, 0]}>
          <mesh geometry={unitCyl} material={MAT.wall} scale={[0.14, 0.26, 0.14]} rotation={[0, 0, Math.PI / 2]} />
          <mesh ref={fxRef} geometry={unitCyl} material={sprayMat} scale={[0.35, 0.6, 0.35]} position={[0.42, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
        </group>
      )
    default: // захват
      return (
        <group position={[0.15, 0, 0]}>
          <mesh geometry={unitBox} material={MAT.darkSteel} scale={[0.12, 0.5, 0.5]} />
          <mesh geometry={unitBox} material={MAT.steel} scale={[0.3, 0.05, 0.6]} position={[0.15, -0.2, 0]} />
        </group>
      )
  }
}
