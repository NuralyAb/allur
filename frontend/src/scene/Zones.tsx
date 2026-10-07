import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import type { HallFrame, OutdoorZone, Selection, Zone } from '../types'
import { world } from './geo'
import { Label } from './Label'

/** Подсветка зон на полу корпуса + кликабельные подписи. Рисуется внутри группы корпуса. */
export function HallZones({
  zones,
  selection,
  onSelect,
  labels,
}: {
  zones: Zone[]
  selection: Selection
  onSelect: (z: Zone) => void
  labels: boolean
}) {
  return (
    <group>
      {zones.map((z) => {
        const [u0, u1, v0, v1] = z.rect
        const active = selection?.kind === 'zone' && selection.zone.id === z.id
        return (
          <group key={z.id}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[(u0 + u1) / 2, 0.06, -(v0 + v1) / 2]}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(z)
              }}
            >
              <planeGeometry args={[u1 - u0, v1 - v0]} />
              <meshBasicMaterial color={z.color} transparent opacity={active ? 0.05 : 0} colorWrite={active} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
            </mesh>
            <Line
              points={[
                [u0, 0.08, -v0],
                [u1, 0.08, -v0],
                [u1, 0.08, -v1],
                [u0, 0.08, -v1],
                [u0, 0.08, -v0],
              ]}
              color={z.color}
              lineWidth={active ? 3 : 1.5}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-4}
            />
            {labels && (
              <Label position={[(u0 + u1) / 2, 17, -(v0 + v1) / 2]} color={z.color} onClick={() => onSelect(z)}>
                {z.short}
              </Label>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Контуры открытых площадок в мировых координатах. */
export function OutdoorZones({
  zones,
  frame,
  selection,
  onSelect,
  labels,
}: {
  zones: OutdoorZone[]
  frame: HallFrame
  selection: Selection
  onSelect: (z: OutdoorZone) => void
  labels: boolean
}) {
  return (
    <group>
      {zones.map((z) => (
        <OutdoorZoneMark key={z.id} zone={z} angle={frame.angle} active={selection?.kind === 'outdoor' && selection.zone.id === z.id} onSelect={onSelect} labels={labels} />
      ))}
    </group>
  )
}

function OutdoorZoneMark({
  zone,
  angle,
  active,
  onSelect,
  labels,
}: {
  zone: OutdoorZone
  angle: number
  active: boolean
  onSelect: (z: OutdoorZone) => void
  labels: boolean
}) {
  const [L, W] = zone.size
  const pts = useMemo(
    () =>
      [
        [-L / 2, 0.3, -W / 2],
        [L / 2, 0.3, -W / 2],
        [L / 2, 0.3, W / 2],
        [-L / 2, 0.3, W / 2],
        [-L / 2, 0.3, -W / 2],
      ] as [number, number, number][],
    [L, W],
  )
  return (
    <group position={world(zone.center[0], zone.center[1])} rotation={[0, angle, 0]}>
      <Line points={pts} color={zone.color} lineWidth={active ? 3.5 : 2} dashed={!active} dashSize={6} gapSize={4} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(zone)
        }}
      >
        <planeGeometry args={[L, W]} />
        <meshBasicMaterial color={zone.color} transparent opacity={active ? 0.08 : 0} colorWrite={active} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
      </mesh>
      {labels && (
        <Label position={[0, 22, 0]} color={zone.color} onClick={() => onSelect(zone)}>
          {zone.short}
        </Label>
      )}
    </group>
  )
}
