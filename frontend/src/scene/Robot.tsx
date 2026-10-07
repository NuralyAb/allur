import { useProductionFrame, useProductionEnabled } from '../simulation/ProductionClock'
import { useRef } from 'react'
import { Color, MeshBasicMaterial, SphereGeometry, Shape, ExtrudeGeometry, CylinderGeometry, CatmullRomCurve3, TubeGeometry, Vector3, type Group, type Material, type Mesh } from 'three'
import { MAT, paint, unitBox, unitCyl } from './assets'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const sparkMat = new MeshBasicMaterial({ color: new Color(6, 4.2, 1.6), toneMapped: false })
const laserMat = new MeshBasicMaterial({ color: new Color(8, 0.6, 0.3), toneMapped: false })
const sprayMat = new MeshBasicMaterial({ color: '#dfe6ee', transparent: true, opacity: 0.35, depthWrite: false })
const sparkGeo = new SphereGeometry(1, 8, 6)
const robotPaint = paint('#bd793f', 0.3, 0.44)
const copper = paint('#a67954', 0.72, 0.32)
const motorGeo = new CylinderGeometry(0.5, 0.5, 1, 24)
function casting(points: [number, number][], depth: number) {
  const shape = new Shape()
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2, steps: 1 })
  geo.translate(0, 0, -depth / 2)
  return geo
}
// Cast, tapered links give the silhouette and highlights of real machinery.
const upperArm = casting([[-0.23, -0.04], [0.2, -0.04], [0.16, 0.45], [0.12, 1.38], [-0.14, 1.38], [-0.2, 0.45]], 0.31)
const forearm = casting([[-0.03, -0.15], [0.35, -0.16], [1.29, -0.09], [1.29, 0.09], [0.4, 0.18], [-0.03, 0.18]], 0.26)
const upperCable = new TubeGeometry(new CatmullRomCurve3([new Vector3(-0.25, 0, -0.23), new Vector3(-0.33, 0.65, -0.23), new Vector3(-0.23, 1.3, -0.23), new Vector3(0.03, 1.44, -0.23)]), 16, 0.045, 6, false)
const armCable = new TubeGeometry(new CatmullRomCurve3([new Vector3(0, 0.24, -0.22), new Vector3(0.5, 0.28, -0.22), new Vector3(1.15, 0.18, -0.2), new Vector3(1.32, 0, -0.15)]), 12, 0.04, 6, false)
const shoulderHardware = mergeGeometries([upperCable, motorGeo.clone().scale(0.42, 0.5, 0.42).rotateX(Math.PI / 2)])
const elbowHardware = mergeGeometries([armCable, motorGeo.clone().scale(0.36, 0.44, 0.36).rotateX(Math.PI / 2)])

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
export function Robot({ position, yaw = 0, tool = 'gun', phase = 0, speed = 1, scale = 1, material = robotPaint, active }: Props) {
  const simulated = useProductionEnabled()
  const turret = useRef<Group>(null!)
  const shoulder = useRef<Group>(null!)
  const elbow = useRef<Group>(null!)
  const wrist = useRef<Group>(null!)
  const fx = useRef<Mesh>(null!)

  useProductionFrame(({ clock }, delta) => {
    const t = clock.elapsedTime * speed + phase
    const on = active ? active(clock.elapsedTime) : true
    const a = on ? 1 : 0.25
    turret.current.rotation.y = Math.sin(t * 0.7) * 0.6 * a
    shoulder.current.rotation.z = -0.35 + Math.sin(t * 1.1) * 0.22 * a
    elbow.current.rotation.z = 0.9 + Math.sin(t * 1.3 + 1) * 0.3 * a
    wrist.current.rotation.x = Math.sin(t * 2.1) * 0.8 * a
    if (fx.current) {
      const flicker = tool === 'gun' ? Math.sin(t * 23) > 0.2 : true
      fx.current.visible = on && flicker && (!simulated || delta > 0)
      if (tool === 'gun') fx.current.scale.setScalar(0.04 + (Math.sin(t * 71) * 0.5 + 0.5) * 0.07)
    }
  })

  return (
    <group position={position} rotation={[0, yaw, 0]} scale={scale}>
      {/* основание */}
      <mesh geometry={motorGeo} material={MAT.robotDark} scale={[0.95, 0.35, 0.95]} position={[0, 0.17, 0]} castShadow receiveShadow />
      <group ref={turret} position={[0, 0.35, 0]}>
        <mesh geometry={unitBox} material={material} scale={[0.8, 0.55, 0.75]} position={[0, 0.27, 0]} />
        {/* плечо */}
        <group ref={shoulder} position={[0.15, 0.6, 0]}>
          <mesh geometry={upperArm} material={material} castShadow />
          <mesh geometry={shoulderHardware} material={MAT.robotDark} />
          {/* предплечье */}
          <group ref={elbow} position={[0, 1.45, 0]}>
            <mesh geometry={elbowHardware} material={MAT.robotDark} />
            <mesh geometry={forearm} material={material} castShadow />
            <group ref={wrist} position={[1.32, 0, 0]}>
              <mesh geometry={motorGeo} material={MAT.robotDark} scale={[0.2, 0.22, 0.2]} rotation={[0, 0, Math.PI / 2]} />
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
          <mesh geometry={unitBox} material={copper} scale={[0.3, 0.05, 0.05]} position={[0.26, -0.42, 0]} />
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
