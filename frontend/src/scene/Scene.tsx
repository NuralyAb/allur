import { CameraControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { ACESFilmicToneMapping, PCFShadowMap, Vector3 } from 'three'
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

const debugPerf = new URLSearchParams(window.location.search).has('perf')

export interface Shot {
  camera: Vector3
  target: Vector3
  fitOverview?: boolean
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

function CameraRig({ shot, onUserMove }: { shot: Shot | null; onUserMove: () => void }) {
  const ref = useRef<CameraControls>(null!)
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const initialized = useRef(false)
  const destination = useMemo(() => {
    if (!shot) return null
    const factor = shot.fitOverview ? Math.max(1, 1.8 / (size.width / size.height)) : 1
    return shot.camera.clone().sub(shot.target).multiplyScalar(factor).add(shot.target)
  }, [shot, size.width, size.height])
  const target = useMemo(() => new Vector3(), [])
  useFrame(({ camera }) => {
    if (!shot || !destination || !ref.current) return
    ref.current.getTarget(target)
    const settled = camera.position.distanceToSquared(destination) < 0.01 && target.distanceToSquared(shot.target) < 0.01
    const value = String(settled)
    if (gl.domElement.dataset.cameraSettled !== value) gl.domElement.dataset.cameraSettled = value
  })
  useEffect(() => {
    if (!shot || !destination || !ref.current) return
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
      // controlstart — только действие пользователя: ручное управление прерывает экскурсию
      onStart={onUserMove}
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

export function Scene({ plant, site, roof, labels, status, alerts, selection, shot, mood, detailed, onSelectZone, onSelectOutdoor, onUserMove }: Props) {
  const frame = plant.hall
  const outline = useMemo<XY[]>(() => site.hall.map((p) => worldToHall(frame, p)), [site, frame])
  const origin = world(frame.origin[0], frame.origin[1])
  const overview = useMemo(() => overviewShot(plant), [plant])

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

      {/* главный корпус в собственной системе координат (u, v) */}
      <group position={origin} rotation={[0, frame.angle, 0]}>
        <Hall frame={frame} outline={outline} roof={roof} />
        <HallZones zones={plant.zones} status={status} alerts={alerts} selection={selection} onSelect={onSelectZone} labels={labels} />
        <BoilerAnnex />
        {!roof && (
          <>
            <Welding />
            <Paint />
            <GlbAssetsProvider>
              <Assembly detailed={detailed} />
            </GlbAssetsProvider>
            <Logistics />
            <Services />
          </>
        )}
      </group>

      <Outdoor frame={frame} zones={plant.outdoor} />
      <OutdoorZones zones={plant.outdoor} frame={frame} selection={selection} onSelect={onSelectOutdoor} labels={labels} />

      <CameraRig shot={shot ?? overview} onUserMove={onUserMove} />
      {debugPerf && <Perf />}

      <EffectComposer multisampling={4}>
        <N8AO enabled={detailed} aoRadius={3} intensity={1.2} distanceFalloff={1} quality="medium" halfRes />
        <Bloom mipmapBlur luminanceThreshold={1.5} intensity={0.3} radius={0.55} />
        <Vignette offset={0.25} darkness={0.10} />
      </EffectComposer>
    </Canvas>
  )
}
