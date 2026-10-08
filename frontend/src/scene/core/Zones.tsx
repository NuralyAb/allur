import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import type { Alert, HallFrame, Level, OutdoorZone, Selection, Zone } from '../../shared/types'
import { world } from './geo'
import { Label } from './Label'

/** Подсветка зон на полу корпуса + кликабельные подписи. Рисуется внутри группы корпуса. */
const STATUS_COLOR = { bad: '#ff5d52', warn: '#e9be70', ok: '#69d7ac' }

/** Короткая надпись для метки на модели: самое важное отклонение участка. */
function alertTag(area: string, alerts: Alert[]) {
  const own = alerts.filter((a) => a.area === area)
  const live = own.find((a) => a.kind === 'live')
  if (live) return live.title
  if (own.some((a) => a.kind === 'bottleneck')) return 'Узкое место'
  const q = own.find((a) => a.kind === 'quality')
  if (q) return q.title.replace(/ при норме.*/, '')
  return own[0]?.title
}

export function HallZones({
  zones,
  status,
  alerts,
  selection,
  onSelect,
  labels,
}: {
  zones: Zone[]
  status: Record<string, Level>
  alerts: Alert[]
  selection: Selection
  onSelect: (z: Zone) => void
  labels: boolean
}) {
  return (
    <group>
      {zones.map((z) => {
        const [u0, u1, v0, v1] = z.rect
        const active = selection?.kind === 'zone' && selection.zone.id === z.id
        const level = z.kpiArea ? status[z.kpiArea] : undefined
        const tag = z.kpiArea && level && level !== 'ok' ? alertTag(z.kpiArea, alerts) : undefined
        const live = z.kpiArea ? alerts.some((a) => a.area === z.kpiArea && a.kind === 'live') : false
        return (
          <group key={z.id}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[(u0 + u1) / 2, 0.06, -(v0 + v1) / 2]}
              onClick={(e) => {
                // отпускание после поворота камеры — не выбор
                if (e.delta > 6) return
                e.stopPropagation()
                onSelect(z)
              }}
            >
              <planeGeometry args={[u1 - u0, v1 - v0]} />
              <meshBasicMaterial color={z.color} transparent opacity={active ? 0.05 : 0} colorWrite={active} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />
            </mesh>
            {(active || labels) && <Line
              points={[
                [u0, 0.08, -v0],
                [u1, 0.08, -v0],
                [u1, 0.08, -v1],
                [u0, 0.08, -v1],
                [u0, 0.08, -v0],
              ]}
              color={tag ? STATUS_COLOR[level!] : z.color}
              lineWidth={active ? 2.5 : tag ? 1.7 : 0.8}
              transparent
              opacity={active || tag ? 0.9 : 0.4}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-4}
            />}
            {tag && (labels || active || tag === 'Узкое место' || live) && (
              <Label position={[(u0 + u1) / 2, labels ? 26 : 17, -(v0 + v1) / 2]} color={STATUS_COLOR[level!]} onClick={() => onSelect(z)}>
                {z.short}: {tag}
              </Label>
            )}
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
      {(active || labels) && <Line points={pts} color={zone.color} lineWidth={active ? 2 : 1} dashed={!active} dashSize={6} gapSize={4} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-4} />}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.2, 0]}
        onClick={(e) => {
          if (e.delta > 6) return
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
