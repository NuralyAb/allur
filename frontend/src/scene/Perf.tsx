import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { InstancedMesh, Mesh, type Object3D } from 'three'

/** Треугольники видимых мешей поддерева с учётом числа инстансов. */
function triangles(root: Object3D) {
  let tris = 0
  let meshes = 0
  let objects = 0
  root.traverse(() => void objects++)
  root.traverseVisible((o) => {
    if (!(o instanceof Mesh)) return
    const g = o.geometry
    const t = (g.index?.count ?? g.getAttribute('position')?.count ?? 0) / 3
    tris += t * (o instanceof InstancedMesh ? o.count : 1)
    meshes++
  })
  return { tris, meshes, objects }
}

/** Самые тяжёлые поддеревья сцены: уровень, где вклад одного узла заметен. */
function breakdown(root: Object3D, depth = 0, path = 'scene', out: { path: string; tris: number; meshes: number; objects: number }[] = []) {
  for (const [i, child] of root.children.entries()) {
    if (!child.visible) continue
    const name = `${path}/${child.name || child.type}#${i}`
    const stats = triangles(child)
    if (stats.tris < 100_000 && stats.objects < 500 && stats.meshes < 40) continue
    out.push({ path: name, ...stats })
    if (depth < 3) breakdown(child, depth + 1, name, out)
  }
  return out
}

/**
 * Отладка: ?perf в адресе — раз в 2 с пишет в консоль draw calls, треугольники и FPS за кадр,
 * а через 10 с после загрузки — раскладку треугольников по поддеревьям сцены.
 */
export function Perf() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const acc = useRef({ t: 0, n: 0 })
  useEffect(() => {
    gl.info.autoReset = false // считаем все проходы кадра, включая постобработку
    const timer = setTimeout(() => {
      const rows = breakdown(scene).sort((a, b) => b.meshes - a.meshes).slice(0, 30)
      console.log(`[perf-breakdown] ${JSON.stringify(rows.map((r) => [r.path, Math.round(r.tris), r.meshes, r.objects]))}`)
      console.log(`[perf-objects] ${triangles(scene).objects}`)
    }, 10_000)
    return () => { clearTimeout(timer); gl.info.autoReset = true }
  }, [gl, scene])
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
