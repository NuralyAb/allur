import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, type RootState } from '@react-three/fiber'
import type { SimulationSnapshot, StageId } from './types'

interface ProductionData { snapshot: SimulationSnapshot | null; receivedAt: number }
const ProductionContext = createContext<{ current: ProductionData } | null>(null)
const StageContext = createContext<StageId | null>(null)

export function ProductionProvider({ snapshot, children }: { snapshot: SimulationSnapshot | null; children: ReactNode }) {
  const data = useMemo(() => ({ current: { snapshot, receivedAt: performance.now() } }), [snapshot])
  return <ProductionContext.Provider value={data}>{children}</ProductionContext.Provider>
}
export function StageScope({ stage, children }: { stage: StageId; children: ReactNode }) {
  return <StageContext.Provider value={stage}>{children}</StageContext.Provider>
}
export function useProductionData() { return useContext(ProductionContext) }
export function useProductionEnabled() { return !!useProductionData()?.current.snapshot }

export function presentationTime(data: ProductionData) {
  const s = data.snapshot
  if (!s) return 0
  // Interpolate only until the next server event. Never run past an unknown failure.
  return s.running ? Math.min(s.horizon, s.nextEventAt, s.time + (performance.now() - data.receivedAt) / 1000 * s.speed / 60) : s.time
}

export function useProductionFrame(callback: (state: RootState, delta: number) => void) {
  const data = useProductionData()
  const stage = useContext(StageContext)
  const frozen = useRef(0)
  useFrame((state, delta) => {
    const s = data?.current.snapshot
    if (!s || !data) { callback(state, delta); return }
    const operating = !stage || s.stages.find((x) => x.stage === stage)?.state === 'RUN'
    if (operating) frozen.current = presentationTime(data.current) * 2
    callback({ ...state, clock: { ...state.clock, elapsedTime: frozen.current } as typeof state.clock }, s.running && operating ? delta : 0)
  })
}
