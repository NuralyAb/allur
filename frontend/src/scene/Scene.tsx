import { CameraControls, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing'
import { memo, Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ACESFilmicToneMapping, PCFShadowMap, Quaternion, Vector3, type Group } from 'three'
import type { Plant, Selection, Site, XY, Zone, OutdoorZone } from '../types'
import { Assembly as AssemblyLine } from './Assembly'
import { hallToWorld, world, worldToHall } from './geo'
import { Ground as GroundPlane } from './Ground'
import { Hall as HallBuilding } from './Hall'
import { Logistics as LogisticsArea } from './Logistics'
import { Outdoor as OutdoorSite } from './Outdoor'
import { Paint as PaintShop } from './Paint'
import { BoilerAnnex as BoilerBuilding, Services as ServiceAreas } from './Services'
import { Welding as WeldingShop } from './Welding'
import { Perf } from './Perf'
import { HallZones, OutdoorZones } from './Zones'
import type { Alert, Level } from '../types'
import { Lighting as SceneLighting, type LightMood } from './Lighting'
import { GlbAssetsProvider } from './glbAssets'
import { VehicleFleetProvider } from './VehicleFleet'
import { ProductionProvider, StageScope } from '../simulation/ProductionClock'
import type { SimulationSnapshot, Stage } from '../simulation/types'
import { ProductionFlow } from './ProductionFlow'

const debugPerf = new URLSearchParams(window.location.search).has('perf')

// Сцена перерисовывается при каждом снимке симуляции (дважды в секунду) и при выборе участка.
// Цеха, стоянки и корпус от этого не меняются: memo избавляет от сверки тысяч элементов.
const Assembly = memo(AssemblyLine)
const Ground = memo(GroundPlane)
const Hall = memo(HallBuilding)
const Logistics = memo(LogisticsArea)
const Outdoor = memo(OutdoorSite)
const Paint = memo(PaintShop)
const BoilerAnnex = memo(BoilerBuilding)
const Services = memo(ServiceAreas)
const Welding = memo(WeldingShop)
const Lighting = memo(SceneLighting)

/** Высшая ступень качества: всё включено. */
const TOP_TIER = 3

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
  /** сцена скрыта — открыт другой раздел: кадры не рисуются, GPU не работает впустую */
  paused?: boolean
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
  const manuallyMoved = useRef(false)
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
  useEffect(() => {
    following.current = !!shot?.followOnix
    manuallyMoved.current = false
  }, [shot])
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
    // Resize may refit an untouched shot, but must preserve a manually chosen view.
    // A new shot resets manuallyMoved above and applies its requested framing.
    if (shot.followOnix || manuallyMoved.current) return
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
      onStart={() => { following.current = false; manuallyMoved.current = true; onUserMove() }}
      onControl={() => { following.current = false; manuallyMoved.current = true; onUserMove() }}
    />
  )
}

/** Marks the loaded scene after a rendered frame, for browser visual checks. */
/**
 * Тени от солнца пересчитываются ~20 раз в секунду, а не каждый кадр. Карта покрывает всю площадку
 * (≈0,25 м на тексель), и сдвиг машины на конвейере за 50 мс — около 5 см — в ней не виден.
 */
function ShadowThrottle({ hz = 20 }: { hz?: number }) {
  const gl = useThree((s) => s.gl)
  const elapsed = useRef(0)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => void (gl.shadowMap.autoUpdate = true)
  }, [gl])
  useFrame((_, delta) => {
    elapsed.current += delta
    if (elapsed.current < 1 / hz) return
    elapsed.current = 0
    gl.shadowMap.needsUpdate = true
  })
  return null
}

/**
 * N8AO по умолчанию каждый кадр ищет в сцене прозрачные материалы и, найдя стёкла, ещё дважды
 * перерисовывает всю сцену для «прозрачного» затенения. Затенение под стёклами того не стоит.
 */
function opaqueOnlyAO(pass: { autoDetectTransparency: boolean; configuration: { transparencyAware: boolean } } | null) {
  if (!pass) return
  pass.autoDetectTransparency = false
  pass.configuration.transparencyAware = false
}

/**
 * Постобработка. MSAA ×4 — только на обычных экранах при высоком качестве: на Retina края сглаживает
 * плотность пикселей, а на слабой графике MSAA слишком дорог, там работает SMAA.
 */
function Effects({ ao, bloom, msaa }: { ao: boolean; bloom: boolean; msaa: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr)
  const multisampling = msaa && dpr <= 1.2 ? 4 : 0
  return (
    <EffectComposer multisampling={multisampling}>
      <N8AO ref={opaqueOnlyAO} enabled={ao} aoRadius={1.8} intensity={1.5} distanceFalloff={1} quality="medium" halfRes />
      {bloom ? <Bloom mipmapBlur luminanceThreshold={1.5} intensity={0.16} radius={0.45} /> : <></>}
      <Vignette offset={0.25} darkness={0.10} />
      {multisampling ? <></> : <SMAA />}
    </EffectComposer>
  )
}

function SceneReady() {
  const frames = useRef(0)
  useFrame(({ gl }) => {
    if (++frames.current === 3) gl.domElement.dataset.sceneReady = 'true'
  })
  return null
}

export function Scene({ plant, site, roof, labels, status, alerts, selection, shot, mood, detailed, paused = false, simulation = null, onSelectAsset, onSelectZone, onSelectOutdoor, onUserMove }: Props) {
  const frame = plant.hall
  const outline = useMemo<XY[]>(() => site.hall.map((p) => worldToHall(frame, p)), [site, frame])
  const origin = world(frame.origin[0], frame.origin[1])
  const overview = useMemo(() => overviewShot(plant), [plant])
  const onix = useRef<Group | null>(null)
  // Качество подстраивается под FPS: сначала снижается плотность пикселей, затем отключаются
  // свечение и затенение. На Retina стартуем с 1,5, на слабой встроенной графике доходим до минимума.
  const [tier, setTier] = useState(TOP_TIER)
  const maxDpr = Math.min(window.devicePixelRatio || 1, detailed ? 1.5 : 1)
  const dpr = tier >= 3 ? maxDpr : tier === 2 ? Math.min(maxDpr, 1.25) : 1

  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      dpr={dpr}
      frameloop={paused ? 'never' : 'always'}
      // Centimetre-separated floors and markings must stay distinct over the
      // entire 4–1600 m zoom range. N8AO supports logarithmic depth as well.
      gl={{ antialias: false, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 0.9, powerPreference: 'high-performance' }}
      camera={{ position: overview.camera.toArray(), fov: 45, near: 0.25, far: 3500 }}
    >
      <Lighting mood={mood} detailed={detailed} />
      <ShadowThrottle />
      <PerformanceMonitor
        bounds={(refresh) => (refresh > 100 ? [55, 100] : [45, 58])}
        flipflops={4}
        onDecline={() => setTier((t) => Math.max(0, t - 1))}
        onIncline={() => setTier((t) => Math.min(TOP_TIER, t + 1))}
        onFallback={() => setTier(1)}
      />

      <Suspense fallback={null}>
        <Ground site={site} hallAngle={frame.angle} />
        <SceneReady />
      </Suspense>

      <GlbAssetsProvider><VehicleFleetProvider detailed={detailed}>
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

      <Effects ao={detailed && tier >= 1} bloom={tier >= 3} msaa={tier >= 2} />
    </Canvas>
  )
}
