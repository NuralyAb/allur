import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import { Vector3, type Group } from 'three'

/**
 * Плашка-подпись над объектом сцены. Мелкие подписи (small) видны только вблизи,
 * крупные (названия цехов) — только издалека, чтобы не загромождать кадр.
 */
export function Label({
  position,
  children,
  color = '#ffb020',
  small,
  onClick,
}: {
  position: [number, number, number]
  children: ReactNode
  color?: string
  small?: boolean
  onClick?: () => void
}) {
  const group = useRef<Group>(null!)
  const div = useRef<HTMLDivElement>(null!)
  const wp = useMemo(() => new Vector3(), [])
  const shown = useRef(true)

  useFrame(({ camera }) => {
    if (!div.current) return
    const d = camera.position.distanceTo(group.current.getWorldPosition(wp))
    const visible = small ? d < 120 : d > 60
    if (visible !== shown.current) {
      shown.current = visible
      div.current.style.opacity = visible ? '1' : '0'
      div.current.style.pointerEvents = visible && onClick ? 'auto' : 'none'
    }
  })

  return (
    <group ref={group} position={position}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={div}
          className={small ? 'tag tag-small' : 'tag'}
          style={{ borderColor: color, pointerEvents: onClick ? 'auto' : 'none' }}
          onClick={(e) => {
            e.stopPropagation()
            onClick?.()
          }}
        >
          <span className="tag-dot" style={{ background: color }} />
          {children}
        </div>
      </Html>
    </group>
  )
}
