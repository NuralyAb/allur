import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Component, Suspense, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Vector3 } from 'three'
import type { GlbAssetSpec } from './glbAssets'
import { createOnixWheelRig } from './onixWheels'
import { prepareGlbScene } from './prepareGlbScene'

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) {
    console.warn('GLB could not be displayed; keeping the lightweight model.', error)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function GlbModel({ spec, conveyor, speed }: { spec: GlbAssetSpec; conveyor: boolean; speed: number }) {
  // Meshopt is bundled by drei. Draco/Basis models are rejected by the importer,
  // so loading never depends on third-party decoder URLs.
  const { scene } = useGLTF(spec.url, false, true)
  const object = useMemo(() => prepareGlbScene(scene, spec, conveyor), [scene, spec, conveyor])
  const wheels = useMemo(() => conveyor ? null : createOnixWheelRig(object, spec), [object, spec, conveyor])
  useFrame((_, delta) => { wheels?.advance(speed * delta) })
  return <primitive object={object} dispose={null} />
}

/** A local asset can fail or suspend without hiding the rest of the factory. */
export function OptionalGlb({ spec, enabled, conveyor = false, speed = 0, children }: {
  spec: GlbAssetSpec | null
  enabled: boolean
  conveyor?: boolean
  speed?: number
  children: ReactNode
}) {
  const root = useRef<Group>(null!)
  const point = useMemo(() => new Vector3(), [])
  const [near, setNear] = useState(false)
  const proximity = useRef(false)
  const nextCheck = useRef(0)

  useFrame(({ camera, clock }) => {
    if (!spec || !enabled || clock.elapsedTime < nextCheck.current) return
    nextCheck.current = clock.elapsedTime + 0.25
    root.current.getWorldPosition(point)
    // Hysteresis prevents flickering at the LOD boundary. Assets load only on approach.
    const within = camera.position.distanceToSquared(point) < (proximity.current ? 100 ** 2 : 85 ** 2)
    if (within !== proximity.current) {
      proximity.current = within
      setNear(within)
    }
  })

  return (
    <group ref={root}>
      <ModelBoundary key={spec?.url ?? 'empty'} fallback={children}>
        {spec && enabled && near ? (
          <Suspense fallback={children}>
            <GlbModel spec={spec} conveyor={conveyor} speed={speed} />
          </Suspense>
        ) : children}
      </ModelBoundary>
    </group>
  )
}
