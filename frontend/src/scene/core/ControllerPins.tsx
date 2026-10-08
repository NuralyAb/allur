import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Vector3, type Group } from 'three'
import { useScadaFeed, type ControllerDef, type ScadaState } from '../../features/scada/scada'

/**
 * Кликабельное оборудование в 3D: у каждого контроллера SCADA есть место в цехе.
 * Клик по самому оборудованию или по его плашке открывает пульт HMI на панели этого контроллера.
 *
 * Координаты — те же, что у геометрии цехов: сварка, сборка и ОТК живут в системе корпуса,
 * окраска — в собственной системе цеха, которая ставится в корпус поворотом на 90° (см. Paint).
 * Поэтому у точки указан кадр: hall или paint.
 */
type Spot = {
  id: string
  frame: 'hall' | 'paint'
  /** плашка над оборудованием */
  pin: [number, number, number]
  /** область клика: центр коробки; ставится на само оборудование, а не на путь кузовов */
  hot: [number, number, number]
  size: [number, number, number]
}

const SPOTS: Spot[] = [
  // сварка: роботы на постах линий и ячейка лазерной сварки крыши Onix
  { id: 'abb-01', frame: 'hall', pin: [82, 4.8, -68], hot: [82, 1.8, -68], size: [9, 3.4, 9.6] },
  { id: 'abb-02', frame: 'hall', pin: [82, 4.8, -50], hot: [82, 1.8, -50], size: [9, 3.4, 9.6] },
  { id: 'abb-04', frame: 'hall', pin: [82, 4.8, -14], hot: [82, 1.8, -14], size: [9, 3.4, 9.6] },
  { id: 'laser-01', frame: 'hall', pin: [117, 6.6, -68], hot: [117, 2, -68], size: [22, 3.8, 11] },
  // окраска: ванна катафореза №10, печь сушки, кабины грунта и эмали
  { id: 'ed-10', frame: 'paint', pin: [234.5, 5.2, -212], hot: [234.5, 0.9, -212], size: [6.8, 1.9, 4.8] },
  { id: 'oven-01', frame: 'paint', pin: [231.5, 7.4, -196], hot: [231.5, 1.8, -196], size: [53, 3.4, 5] },
  { id: 'booth-01', frame: 'paint', pin: [181, 8, -180], hot: [181, 2.4, -180], size: [18, 4.6, 8.6] },
  { id: 'booth-02', frame: 'paint', pin: [212, 8, -180], hot: [212, 2.4, -180], size: [28, 4.6, 8.6] },
  // сборка: главный конвейер (клик по полотну) и гайковёрт колёс у стеллажей шин
  { id: 'conveyor-03', frame: 'hall', pin: [136, 5.2, -146], hot: [136, 0.25, -146], size: [128, 0.7, 3.4] },
  { id: 'nutrunner-07', frame: 'hall', pin: [110, 3.8, -92.4], hot: [110, 1, -92.4], size: [22, 2.2, 2.4] },
  // ОТК: тормозной стенд (шкаф у поста) и дождевальная камера
  { id: 'brake-01', frame: 'hall', pin: [234, 5.2, -72], hot: [234, 0.9, -69], size: [3.4, 2.2, 1.6] },
  { id: 'rain-01', frame: 'hall', pin: [207, 7.6, -48], hot: [207, 2.3, -48], size: [26, 4.6, 8.4] },
]

const RUN = '#69d7ac'
const WAIT = '#e9be70'
const FAULT = '#ff5d52'
const OFFLINE = '#b48ad6'
const NEAR = 150 // с какого расстояния видны плашки оборудования, м
/** ?hot — показать области клика: нужно при правке координат оборудования. */
const debugHot = new URLSearchParams(location.search).has('hot')

/** Пульт открывается в отдельной вкладке с постоянным именем: повторный клик её переиспользует. */
function openHmi(id: string) {
  window.open(`/hmi.html?c=${encodeURIComponent(id)}`, 'allur-hmi')
}

function tone(st: ScadaState['controllers'][string] | undefined, alarm: boolean) {
  if (!st || st.comm !== 'good') return OFFLINE
  if (alarm || st.state === 9 || st.state === 8) return FAULT
  if (st.state === 6) return RUN
  return WAIT
}

/**
 * Плашка оборудования: видна при подлёте к цеху и всегда — при наведении на само оборудование.
 * Html кладёт её в контейнер над canvas; портал в родителя canvas переживает переподключение событий r3f.
 */
function Badge({ position, color, hover, onClick, children }: {
  position: [number, number, number]
  color: string
  hover: boolean
  onClick: () => void
  children: ReactNode
}) {
  const group = useRef<Group>(null!)
  const div = useRef<HTMLDivElement>(null!)
  const wp = useMemo(() => new Vector3(), [])
  const shown = useRef(false)
  const near = useRef(false)
  const gl = useThree((s) => s.gl)
  const portal = useMemo(() => ({ current: gl.domElement.parentNode as HTMLElement }), [gl])

  useFrame(({ camera }) => {
    if (!div.current) return
    const d = camera.position.distanceTo(group.current.getWorldPosition(wp))
    near.current = d < (near.current ? NEAR + 20 : NEAR) // гистерезис, чтобы плашка не мигала у границы
    const visible = near.current || hover
    if (visible !== shown.current) {
      shown.current = visible
      div.current.style.opacity = visible ? '1' : '0'
      div.current.style.pointerEvents = visible ? 'auto' : 'none'
    }
  })

  return (
    <group ref={group} position={position}>
      <Html portal={portal} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          ref={div}
          className="tag tag-small"
          style={{ borderColor: color, opacity: 0, pointerEvents: 'none', cursor: 'pointer' }}
          title="Открыть пульт управления этим контроллером"
          onClick={(e) => { e.stopPropagation(); onClick() }}
        >
          <span className="tag-dot" style={{ background: color }} />
          {children}
        </div>
      </Html>
    </group>
  )
}

function Pin({ spot, def, state }: { spot: Spot; def: ControllerDef; state: ScadaState | null }) {
  const [hover, setHover] = useState(false)
  const st = state?.controllers[def.id]
  const alarms = (state?.alarms ?? []).filter((a) => a.controller === def.id && a.active && !a.shelvedUntil)
  const top = [...alarms].sort((a, b) => a.priority - b.priority)[0]
  const color = tone(st, alarms.length > 0)
  const setCursor = (on: boolean) => {
    setHover(on)
    document.body.style.cursor = on ? 'pointer' : 'auto'
  }
  return (
    <group>
      <mesh
        position={spot.hot}
        userData={{ hotspot: true }}
        onClick={(e) => {
          if (e.delta > 6) return // отпускание после поворота камеры — не выбор
          e.stopPropagation()
          openHmi(def.id)
        }}
        onPointerOver={(e) => { e.stopPropagation(); setCursor(true) }}
        onPointerOut={() => setCursor(false)}
      >
        <boxGeometry args={spot.size} />
        <meshBasicMaterial color={color} transparent opacity={hover ? 0.2 : debugHot ? 0.35 : 0} depthWrite={false} />
      </mesh>
      <Badge position={spot.pin} color={color} hover={hover} onClick={() => openHmi(def.id)}>
        {def.equipment} · {st?.stateName ?? 'нет данных'}
        {top && <em> · {top.title.replace(`${def.equipment}: `, '')}</em>}
        <em> · открыть пульт</em>
      </Badge>
    </group>
  )
}

/** Все точки оборудования; рисуется внутри группы корпуса, когда снята кровля. */
export function ControllerPins() {
  const { config, state } = useScadaFeed()
  if (!config) return null
  const pins = (frame: Spot['frame']) =>
    SPOTS.filter((s) => s.frame === frame).map((s) => {
      const def = config.controllers.find((c) => c.id === s.id)
      return def ? <Pin key={s.id} spot={s} def={def} state={state} /> : null
    })
  return (
    <group>
      {pins('hall')}
      {/* цех окраски стоит в корпусе повёрнутым — те же координаты, что у его геометрии */}
      <group position={[470, 0, 66]} rotation={[0, Math.PI / 2, 0]}>{pins('paint')}</group>
    </group>
  )
}
