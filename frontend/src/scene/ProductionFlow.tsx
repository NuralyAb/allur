import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { presentationTime, useProductionData } from '../simulation/ProductionClock'
import { STATE_LABELS, type SimulationSnapshot, type Stage, type Vehicle } from '../simulation/types'
import { ASM_PATH, QC_PATH } from './Assembly'
import { PATH as PAINT_PATH } from './Paint'
import { Car, type CarHandle } from './Car'
import { CAR_COLORS, MAT, paint } from './assets'
import { makePath, placeOnPath, type P3 } from './motion'

const PATHS: Record<Vehicle['stage'], P3[]> = {
  welding: [[62, 0.55, -68], [152, 0.55, -68]],
  paint: PAINT_PATH.map(([a, h, p]) => [470 + p, h, -(a - 66)] as P3),
  assembly: ASM_PATH,
  qc: QC_PATH,
}
const diagnostics = new URLSearchParams(window.location.search).has('e2e')
const QUEUES: Record<Vehicle['stage'], { start: P3; direction: P3 }> = {
  welding: { start: [56, 0.55, -68], direction: [0, 0, -5] },
  paint: { start: [250, 0.55, -84], direction: [-6, 0, 0] },
  assembly: { start: [307, 0.55, -24], direction: [0, 0, -7] },
  qc: { start: [228, 0.55, -86], direction: [-6, 0, 0] },
}

function SimulatedVehicle({ vehicle }: { vehicle: Vehicle }) {
  const ref = useRef<CarHandle>(null!)
  const data = useProductionData()
  const path = useMemo(() => makePath(PATHS[vehicle.stage], 3.5), [vehicle.stage])
  const length = useMemo(() => path.getLength(), [path])
  useFrame((_, dt) => {
    const car = ref.current, snapshot = data?.current.snapshot
    if (!car || !snapshot || !data) return
    const stage = snapshot.stages.find((x) => x.stage === vehicle.stage)!
    let progress = vehicle.progress
    if (vehicle.status === 'queued') {
      const queue = QUEUES[vehicle.stage], i = vehicle.queueIndex ?? 0
      const slot = vehicle.stage === 'assembly' ? i % 8 : i
      car.root.position.set(...queue.start.map((v, j) => v + queue.direction[j] * slot + (vehicle.stage === 'assembly' && j === 0 ? Math.floor(i / 8) * 7 : 0)) as P3)
      car.root.rotation.set(0, vehicle.stage === 'assembly' ? Math.PI / 2 : 0, 0)
    } else {
      if (stage.state === 'RUN' && vehicle.start !== undefined) progress = Math.min(1, Math.max(0, (presentationTime(data.current) - vehicle.start) / stage.cycleMinutes))
      placeOnPath(path, length, length * progress, car.root)
    }
    const assembled = vehicle.stage === 'qc' || (vehicle.stage === 'assembly' && progress > 0.65)
    car.setWheels(assembled); car.setGlass(assembled ? MAT.glass : MAT.opening); car.setDetails(assembled)
    car.setBody(vehicle.stage === 'welding' || vehicle.stage === 'paint' && (vehicle.status === 'queued' || progress < 0.2) ? MAT.biw : vehicle.stage === 'paint' && progress < 0.6 ? MAT.ed : paint(CAR_COLORS[Number(vehicle.id.slice(-3)) % 5]))
    if (snapshot.running && stage.state === 'RUN' && vehicle.status === 'processing') car.wheels.children.forEach((wheel) => { wheel.rotation.z -= dt * 2 })
    car.root.userData.bodyId = vehicle.id
  }, -1)
  return <Car ref={ref} model={vehicle.model} />
}

function EquipmentMarker({ stage, roof, onSelect }: { stage: Stage; roof: boolean; onSelect: (stage: Stage) => void }) {
  return <group position={[stage.position[0], roof ? 18 : 7, -stage.position[1]]}>
    <mesh><sphereGeometry args={[stage.state === 'FAULT' ? 1.8 : 1.1, 12, 8]} /><meshBasicMaterial color={stage.state === 'FAULT' ? '#f4493d' : stage.state === 'BLOCKED' ? '#e9be70' : stage.state === 'STARVED' ? '#8392a0' : '#69d7ac'} toneMapped={false} /></mesh>
    <Html center position={[0, 2.5, 0]} zIndexRange={[24, 0]}>
      <button className={`equipment-marker state-${stage.state.toLowerCase()}`} onClick={(e) => { e.stopPropagation(); onSelect(stage) }} aria-label={`Оборудование ${stage.id}: ${STATE_LABELS[stage.state]}`}><b>{stage.id}</b><span>{STATE_LABELS[stage.state]}</span></button>
    </Html>
  </group>
}

export function ProductionFlow({ snapshot, roof, onAsset }: { snapshot: SimulationSnapshot; roof: boolean; onAsset: (stage: Stage) => void }) {
  const gl = useThree((s) => s.gl)
  const group = useRef<import('three').Group>(null!)
  const scratch = useMemo(() => new Vector3(), [])
  useFrame(() => {
    if (!diagnostics) return
    // Read actual vehicle transforms after their frame callbacks, for rendering diagnostics.
    const positions: string[] = []
    group.current?.traverse((node) => { if (node.userData.bodyId) { node.getWorldPosition(scratch); positions.push(`${node.userData.bodyId}:${scratch.x.toFixed(2)},${scratch.y.toFixed(2)},${scratch.z.toFixed(2)}`) } })
    gl.domElement.dataset.productionPositions = positions.join('|')
    gl.domElement.dataset.productionBodies = String(positions.length)
    gl.domElement.dataset.productionFault = snapshot.stages.find((x) => x.state === 'FAULT')?.id ?? ''
    gl.domElement.dataset.productionTime = String(snapshot.time)
  })
  return <group ref={group}>
    {!roof && snapshot.vehicles.map((vehicle) => <SimulatedVehicle key={vehicle.id} vehicle={vehicle} />)}
    {snapshot.finishedVehicles.map((vehicle, i) => <Car key={vehicle.id} model={vehicle.model} body={paint(CAR_COLORS[Number(vehicle.id.slice(-3)) % 5])} glass={MAT.glass} wheels details position={[38 + i * 6, 0.3, -400]} />)}
    {!roof && <group position={[313, 8, -74]}><Html center zIndexRange={[24, 0]}><button className="equipment-marker" onClick={() => onAsset(snapshot.stages[2])} aria-label="Показать буфер PBS"><b>Буфер PBS</b><span>{snapshot.stages[2].queue} / {snapshot.config.bufferCapacity} кузовов</span></button></Html></group>}
    {snapshot.stages.map((stage) => <EquipmentMarker key={stage.id} stage={stage} roof={roof} onSelect={onAsset} />)}
  </group>
}
