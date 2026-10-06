import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

/** Отладка: ?perf в адресе — раз в 2 с пишет в консоль draw calls, треугольники и FPS за кадр. */
export function Perf() {
  const gl = useThree((s) => s.gl)
  const acc = useRef({ t: 0, n: 0 })
  useEffect(() => {
    gl.info.autoReset = false // считаем все проходы кадра, включая постобработку
    return () => void (gl.info.autoReset = true)
  }, [gl])
  useFrame((_, dt) => {
    const a = acc.current
    const r = gl.info.render
    a.t += dt
    a.n++
    if (a.t > 2) {
      console.log(`[perf] fps=${(a.n / a.t).toFixed(0)} calls=${r.calls} tris=${r.triangles}`)
      a.t = 0
      a.n = 0
    }
    gl.info.reset()
  })
  return null
}
