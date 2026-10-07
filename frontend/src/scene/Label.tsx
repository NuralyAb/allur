import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
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
  const shown = useRef(false)
  // Html кладёт плашку в events.connected, а r3f переподключает события после загрузки. При смене контейнера
  // Html пересоздаёт корень без содержимого, и метки, которые не перерисовываются, пропадают.
  // Постоянный контейнер — родитель canvas — эту смену исключает.
  const gl = useThree((s) => s.gl)
  const portal = useMemo(() => ({ current: gl.domElement.parentNode as HTMLElement }), [gl])

  useFrame(({ camera }) => {
    if (!div.current) return
    const d = camera.position.distanceTo(group.current.getWorldPosition(wp))
    // Hysteresis avoids flickering at a distance threshold. Start hidden so
    // distant equipment labels do not flash for one frame when the roof opens.
    const visible = small ? d < (shown.current ? 68 : 58) : d > (shown.current ? 50 : 70)
    if (visible !== shown.current) {
      shown.current = visible
      div.current.style.opacity = visible ? '1' : '0'
      div.current.style.pointerEvents = visible && onClick ? 'auto' : 'none'
    }
  })

  return (
    <group ref={group} position={position}>
      <Html portal={portal} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={div}
          className={small ? 'tag tag-small' : 'tag'}
          style={{ borderColor: color, opacity: 0, pointerEvents: 'none' }}
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
