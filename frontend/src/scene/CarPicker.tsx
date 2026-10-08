import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Box3, Matrix4, Object3D, Ray, Vector3, type Group, type Intersection, type Mesh, type MeshBasicMaterial, type Raycaster } from 'three'
import { CARS, SPECS, type CarModelId } from './carModels'
import { attached, cycleOf, shown, unitOf, type CarSelection } from './carUnits'
import { useVehicleFleet, type FleetVehicle } from './VehicleFleet'

const boxes = new Map<CarModelId, Box3>()
/** Габарит машины в её собственных осях: от земли до крыши. */
function carBox(model: CarModelId) {
  let box = boxes.get(model)
  if (!box) {
    const body = CARS[model].body
    if (!body.boundingBox) body.computeBoundingBox()
    box = body.boundingBox!.clone()
    box.min.y = 0
    boxes.set(model, box)
  }
  return box
}

interface CarHit extends Intersection { car: Object3D }

/**
 * Невидимая цель для кликов по машинам. Ближнюю машину рисует общий GLB-флот, дальнюю —
 * instanced-геометрия стоянки, поэтому меши для луча не годятся: луч проверяется по габаритам
 * всех отмеченных машин флота. В пересечения попадает только ближайшая машина.
 */
class CarTarget extends Object3D {
  vehicles: Set<FleetVehicle> | null = null
  private inverse = new Matrix4()
  private local = new Ray()
  private point = new Vector3()
  private center = new Vector3()

  raycast(raycaster: Raycaster, intersects: Intersection[]) {
    if (!this.vehicles) return
    const ray = raycaster.ray
    let best: CarHit | null = null
    for (const { root, model } of this.vehicles) {
      if (!unitOf(root)) continue
      this.center.setFromMatrixPosition(root.matrixWorld)
      // габарит вписан в сферу ≈3,2 м: дальние машины отсекаются без обращения матрицы
      if (ray.distanceSqToPoint(this.center) > 10.5 || !shown(root)) continue
      this.local.copy(ray).applyMatrix4(this.inverse.copy(root.matrixWorld).invert())
      if (!this.local.intersectBox(carBox(model), this.point)) continue
      this.point.applyMatrix4(root.matrixWorld)
      const distance = ray.origin.distanceTo(this.point)
      if (distance < raycaster.near || distance > raycaster.far || (best && distance >= best.distance)) continue
      best = { distance, point: this.point.clone(), object: this, car: root }
    }
    if (best) intersects.push(best)
  }
}

/** Выбор машины кликом и маркер выбранной. followed — корень выбранной машины, пока она видна. */
export function CarPicker({ selection, onPick, followed }: { selection: CarSelection | null; onPick: (car: Object3D) => void; followed: RefObject<Object3D | null> }) {
  const fleet = useVehicleFleet()
  const gl = useThree((s) => s.gl)
  const target = useMemo(() => new CarTarget(), [])
  target.vehicles = fleet?.vehicles ?? null
  const cursor = (on: boolean) => { gl.domElement.style.cursor = on ? 'pointer' : '' }
  useEffect(() => () => { gl.domElement.style.cursor = '' }, [gl])
  return <>
    <primitive
      object={target}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        // отпускание после поворота камеры — не выбор
        if (e.delta > 6) return
        e.stopPropagation()
        onPick((e as unknown as CarHit).car)
      }}
      onPointerOver={() => cursor(true)}
      onPointerOut={() => cursor(false)}
    />
    {selection && <SelectionMarker selection={selection} vehicles={fleet?.vehicles ?? null} followed={followed} />}
  </>
}

const scale = new Vector3()

function SelectionMarker({ selection, vehicles, followed }: { selection: CarSelection; vehicles: Set<FleetVehicle> | null; followed: RefObject<Object3D | null> }) {
  const group = useRef<Group>(null!)
  const pulse = useRef<Mesh>(null!)
  const pin = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const { length, width } = SPECS[selection.unit.model]
  useEffect(() => () => { followed.current = null }, [followed])
  useFrame(({ clock }) => {
    let root = selection.root
    if (!root || !attached(root)) {
      // Машину перемонтировали (кузов симуляции сменил этап или выпущен) — ищем её по ключу, не каждый кадр.
      root = null
      if (vehicles && frame.current++ % 15 === 0) {
        for (const v of vehicles) if (unitOf(v.root)?.key === selection.unit.key) { root = v.root; break }
      }
      selection.root = root
    }
    // На следующем круге петли на этом месте едет уже другая машина.
    const live = !!root && shown(root) && cycleOf(root) === selection.cycle
    followed.current = live ? root : null
    group.current.visible = live
    if (pin.current) pin.current.style.display = live ? '' : 'none'
    if (!live) return
    // анимации уже сдвинули машину в этом кадре, а мировая матрица пересчитается только при рендере
    root!.updateWorldMatrix(true, false)
    root!.matrixWorld.decompose(group.current.position, group.current.quaternion, scale)
    const t = (clock.elapsedTime * 0.7) % 1
    pulse.current.scale.set(length * 0.62 * (1 + t * 0.4), width * 0.82 * (1 + t * 0.4), 1)
    ;(pulse.current.material as MeshBasicMaterial).opacity = 0.75 * (1 - t)
  })
  return (
    <group ref={group} visible={false}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04} scale={[length * 0.62, width * 0.82, 1]} renderOrder={2}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#e84735" toneMapped={false} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      <mesh ref={pulse} rotation-x={-Math.PI / 2} position-y={0.05} renderOrder={2}>
        <ringGeometry args={[0.95, 1, 64]} />
        <meshBasicMaterial color="#e84735" toneMapped={false} transparent depthWrite={false} />
      </mesh>
      <Html position={[0, 2.4, 0]} center zIndexRange={[5, 0]} pointerEvents="none">
        <div ref={pin} className="car-pin" style={{ display: 'none' }}><i />{SPECS[selection.unit.model].name}</div>
      </Html>
    </group>
  )
}
