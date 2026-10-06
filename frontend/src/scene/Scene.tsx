import { CameraControls, Sky } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { ACESFilmicToneMapping, Vector3 } from 'three'
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

const debugPerf = new URLSearchParams(window.location.search).has('perf')

export interface Shot {
  camera: Vector3
  target: Vector3
}

interface Props {
  plant: Plant
  site: Site
  roof: boolean
  labels: boolean
  selection: Selection
  shot: Shot | null
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

function CameraRig({ shot, onUserMove }: { shot: Shot | null; onUserMove: () => void }) {
  const ref = useRef<CameraControls>(null!)
  useEffect(() => {
    if (!shot || !ref.current) return
    ref.current.smoothTime = 1.1
    void ref.current.setLookAt(shot.camera.x, shot.camera.y, shot.camera.z, shot.target.x, shot.target.y, shot.target.z, true)
  }, [shot])
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

export function Scene({ plant, site, roof, labels, selection, shot, onSelectZone, onSelectOutdoor, onUserMove }: Props) {
  const frame = plant.hall
  const outline = useMemo<XY[]>(() => site.hall.map((p) => worldToHall(frame, p)), [site, frame])
  const origin = world(frame.origin[0], frame.origin[1])
  const sun = useMemo(() => new Vector3(-420, 520, 260), [])

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: false, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }}
      camera={{ position: [-330, 330, 380], fov: 42, near: 0.5, far: 9000 }}
    >
      <color attach="background" args={['#a9c4dd']} />
      <fog attach="fog" args={['#b8cde0', 900, 3800]} />
      <Sky sunPosition={sun} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} />
      <hemisphereLight args={['#dfefff', '#5a5446', 0.9]} />
      <directionalLight
        position={sun}
        intensity={2.4}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-camera-left={-420}
        shadow-camera-right={420}
        shadow-camera-top={420}
        shadow-camera-bottom={-420}
        shadow-camera-near={10}
        shadow-camera-far={1800}
      />

      <Suspense fallback={null}>
        <Ground site={site} hallAngle={frame.angle} />
      </Suspense>

      {/* главный корпус в собственной системе координат (u, v) */}
      <group position={origin} rotation={[0, frame.angle, 0]}>
        <Hall frame={frame} outline={outline} roof={roof} />
        <HallZones zones={plant.zones} selection={selection} onSelect={onSelectZone} labels={labels} />
        <BoilerAnnex />
        {!roof && (
          <>
            <Welding />
            <Paint />
            <Assembly />
            <Logistics />
            <Services />
          </>
        )}
      </group>

      <Outdoor frame={frame} zones={plant.outdoor} />
      <OutdoorZones zones={plant.outdoor} frame={frame} selection={selection} onSelect={onSelectOutdoor} labels={labels} />

      <CameraRig shot={shot} onUserMove={onUserMove} />
      {debugPerf && <Perf />}

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={0.9} radius={0.6} />
      </EffectComposer>
    </Canvas>
  )
}
