import { CameraControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { ACESFilmicToneMapping, PCFShadowMap, Quaternion, Vector3, type Group } from 'three'
import type { Plant, Selection, Site, XY, Zone, OutdoorZone } from '../types'
import { Assembly } from './Assembly'
import { hallToWorld, world, worldToHall } from './geo'
import { Ground } from './Ground'
import { Hall } from './Hall'
import { Logistics } from './Logistics'
import { Outdoor } from './Outdoor'
import { Paint } from './Paint'
import { BoilerAnnex, Services } from './Services'
import { Welding } from './Welding'
import { Perf } from './Perf'
import { HallZones, OutdoorZones } from './Zones'
import type { Alert, Level } from '../types'
import { Lighting, type LightMood } from './Lighting'
import { GlbAssetsProvider } from './glbAssets'
import { VehicleFleetProvider } from './VehicleFleet'
import { ProductionProvider, StageScope } from '../simulation/ProductionClock'
import type { SimulationSnapshot, Stage } from '../simulation/types'
import { ProductionFlow } from './ProductionFlow'

const debugPerf = new URLSearchParams(window.location.search).has('perf')

export interface Shot {
  camera: Vector3
  target: Vector3
  fitOverview?: boolean
  followOnix?: boolean
}

interface Props {
  plant: Plant
  site: Site
  roof: boolean
  labels: boolean
  status: Record<string, Level>
  alerts: Alert[]
  selection: Selection
  shot: Shot | null
  mood: LightMood
  detailed: boolean
  simulation?: SimulationSnapshot | null
  onSelectAsset: (stage: Stage) => void
  onSelectZone: (z: Zone) => void
  onSelectOutdoor: (z: OutdoorZone) => void
  onUserMove: () => void
}

/** Ракурс на зону корпуса: сверху-сбоку с юго-западной стороны. */
export function zoneShot(plant: Plant, z: Zone): Shot {
  const [u0, u1, v0, v1] = z.rect
  const cu = (u0 + u1) / 2
  const cv = (v0 + v1) / 2
  const size = Math.max(u1 - u0, v1 - v0)
  return {
    target: hallToWorld(plant.hall, cu, cv, 0),
    camera: hallToWorld(plant.hall, cu - size * 0.25, cv - size * 0.75, size * 0.55 + 12),
  }
}

export function outdoorShot(z: OutdoorZone): Shot {
  const size = Math.max(...z.size)
  return {
    target: world(z.center[0], z.center[1], 0),
    camera: world(z.center[0] - size * 0.5, z.center[1] - size * 0.7, size * 0.55),
  }
}

export function overviewShot(plant: Plant): Shot {
  return {
    target: hallToWorld(plant.hall, plant.hall.length / 2, plant.hall.width * 0.44, 0),
    camera: hallToWorld(plant.hall, 125, -175, 260),
    fitOverview: true,
  }
}

function CameraRig({ shot, onix, onUserMove }: { shot: Shot | null; onix: RefObject<Group | null>; onUserMove: () => void }) {
  const ref = useRef<CameraControls>(null!)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const initialized = useRef(false)
  const following = useRef(false)
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const destination = useMemo(() => {
    if (!shot) return null
    const factor = shot.fitOverview ? Math.max(1, 1.8 / (size.width / size.height)) : 1
    return shot.camera.clone().sub(shot.target).multiplyScalar(factor).add(shot.target)
  }, [shot, size.width, size.height])
  const target = useMemo(() => new Vector3(), [])
  const followTarget = useMemo(() => new Vector3(), [])
  const followCamera = useMemo(() => new Vector3(), [])
  const orientation = useMemo(() => new Quaternion(), [])
  useEffect(() => { following.current = !!shot?.followOnix }, [shot])
  useFrame(({ camera }, delta) => {
    if (!shot || !destination || !ref.current) return
    if (following.current && onix.current) {
      onix.current.getWorldPosition(followTarget)
      onix.current.getWorldQuaternion(orientation)
      followTarget.y += 0.8
      // Front three-quarter view, with room for the full car on narrow screens.
      const fit = Math.max(1, 1.1 / (Math.max(1, size.width) / Math.max(1, size.height)))
      followCamera.set(6.2, 3.8, 5.8).multiplyScalar(fit).applyQuaternion(orientation).add(followTarget)
      const blend = reducedMotion ? 1 : 1 - Math.exp(-delta * 6)
      followCamera.lerpVectors(camera.position, followCamera, blend)
      ref.current.getTarget(target).lerp(followTarget, blend)
      void ref.current.setLookAt(followCamera.x, followCamera.y, followCamera.z, target.x, target.y, target.z, false)
      gl.domElement.dataset.cameraSettled = String(target.distanceToSquared(followTarget) < 0.04)
      return
    }
    if (shot.followOnix) return
    ref.current.getTarget(target)
    const settled = camera.position.distanceToSquared(destination) < 0.01 && target.distanceToSquared(shot.target) < 0.01
    const value = String(settled)
    if (gl.domElement.dataset.cameraSettled !== value) gl.domElement.dataset.cameraSettled = value
  })
  useEffect(() => {
    if (!shot || !destination || !ref.current) return
    // Only a new shot starts following. Panning or resizing must not restart it.
    if (shot.followOnix) return
    gl.domElement.dataset.cameraSettled = 'false'
    ref.current.smoothTime = 1.1
    const animate = initialized.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    void ref.current.setLookAt(destination.x, destination.y, destination.z, shot.target.x, shot.target.y, shot.target.z, animate)
    initialized.current = true
  }, [shot, destination, gl])
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={4}
      maxDistance={1600}
      maxPolarAngle={Math.PI / 2 - 0.03}
      // Wheel gestures emit control, while mouse/touch dragging also emits controlstart.
      onStart={() => { following.current = false; onUserMove() }}
      onControl={() => { following.current = false; onUserMove() }}
    />
  )
}

/** Marks the loaded scene after a rendered frame, for browser visual checks. */
function SceneReady() {
  const frames = useRef(0)
  useFrame(({ gl }) => {
    if (++frames.current === 3) gl.domElement.dataset.sceneReady = 'true'
  })
  return null
}

export function Scene({ plant, site, roof, labels, status, alerts, selection, shot, mood, detailed, simulation = null, onSelectAsset, onSelectZone, onSelectOutdoor, onUserMove }: Props) {
  const frame = plant.hall
  const outline = useMemo<XY[]>(() => site.hall.map((p) => worldToHall(frame, p)), [site, frame])
  const origin = world(frame.origin[0], frame.origin[1])
  const overview = useMemo(() => overviewShot(plant), [plant])
  const onix = useRef<Group | null>(null)

  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      dpr={detailed ? [1, 1.5] : [1, 1]}
      // Centimetre-separated floors and markings must stay distinct over the
      // entire 4–1600 m zoom range. N8AO supports logarithmic depth as well.
      gl={{ antialias: false, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.9, powerPreference: 'high-performance' }}
      camera={{ position: overview.camera.toArray(), fov: 45, near: 0.25, far: 3500 }}
    >
      <Lighting mood={mood} detailed={detailed} />

      <Suspense fallback={null}>
        <Ground site={site} hallAngle={frame.angle} />
        <SceneReady />
      </Suspense>

      <GlbAssetsProvider><VehicleFleetProvider>
      <ProductionProvider snapshot={simulation}>
      {/* главный корпус в собственной системе координат (u, v) */}
      <group position={origin} rotation={[0, frame.angle, 0]}>
        <Hall frame={frame} outline={outline} roof={roof} />
        <HallZones zones={plant.zones} status={status} alerts={alerts} selection={selection} onSelect={onSelectZone} labels={labels} />
        <BoilerAnnex />
        {!roof && (
          <>
            <StageScope stage="welding"><Welding /></StageScope>
            <StageScope stage="paint"><Paint /></StageScope>
            <StageScope stage="assembly"><Assembly detailed={detailed} onixRef={onix} /> </StageScope>
            <Logistics />
            <Services />
          </>
        )}
        {simulation && <ProductionFlow snapshot={simulation} roof={roof} onAsset={onSelectAsset} />}
      </group>

      <Outdoor frame={frame} zones={plant.outdoor} />
      </ProductionProvider>
      </VehicleFleetProvider></GlbAssetsProvider>
      <OutdoorZones zones={plant.outdoor} frame={frame} selection={selection} onSelect={onSelectOutdoor} labels={labels} />

      <CameraRig shot={shot ?? overview} onix={onix} onUserMove={onUserMove} />
      {debugPerf && <Perf />}

      <EffectComposer multisampling={4}>
        <N8AO enabled={detailed} aoRadius={1.8} intensity={1.5} distanceFalloff={1} quality="medium" halfRes />
        <Bloom mipmapBlur luminanceThreshold={1.5} intensity={0.16} radius={0.45} />
        <Vignette offset={0.25} darkness={0.10} />
      </EffectComposer>
    </Canvas>
  )
}
