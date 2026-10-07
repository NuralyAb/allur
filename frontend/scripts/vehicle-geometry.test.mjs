import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { registerHooks } from 'node:module'

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context) } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.ts`, context)
    throw error
  }
} })
const { prepareVehicleGeometry } = await import('../src/scene/vehicleGeometry.ts')

const spec = { url: '/models/onix-c1bb20bcc2b636e8.glb', length: 4.474, rotationY: -Math.PI / 2, source: 'test', author: 'test', license: 'CC-BY-4.0' }
async function loadGeometry(url) {
  const file = await readFile(new URL(`../public${url}`, import.meta.url))
  const length = file.readUInt32LE(12)
  const json = JSON.parse(file.subarray(20, 20 + length).toString())
  const stripTextures = (value) => {
    for (const key of Object.keys(value)) {
      if (key.toLowerCase().includes('texture')) delete value[key]
      else if (value[key] && typeof value[key] === 'object') stripTextures(value[key])
    }
  }
  for (const material of json.materials) stripTextures(material)
  delete json.textures; delete json.images
  const encoded = Buffer.from(JSON.stringify(json))
  const padded = Math.ceil(encoded.length / 4) * 4
  const rest = file.subarray(20 + length)
  const result = Buffer.alloc(20 + padded + rest.length)
  file.copy(result, 0, 0, 20)
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded, 12)
  result.fill(32, 20, 20 + padded); encoded.copy(result, 20); rest.copy(result, 20 + padded)
  return (await new GLTFLoader().parseAsync(result.buffer, '')).scene
}

test('real Onix geometry is batched with all four independent wheel centers and manufacturing stages', async () => {
  const source = await loadGeometry(spec.url)
  let originalMeshes = 0
  const snapshots = []
  source.traverse((mesh) => {
    if (!mesh.isMesh) return
    originalMeshes++
    snapshots.push([mesh, mesh.geometry, mesh.material, mesh.matrixWorld.clone()])
  })
  const result = prepareVehicleGeometry(source, spec)
  assert.equal(result.staged, true)
  assert.ok(result.parts.length < originalMeshes / 2, `${result.parts.length} draw batches from ${originalMeshes} source meshes`)
  assert.deepEqual([...new Set(result.parts.filter(p => p.role === 'wheel').map(p => p.wheel))].sort(), [0, 1, 2, 3])
  for (const wheel of result.parts.filter(p => p.role === 'wheel')) {
    assert.ok(wheel.center.y > 0.28 && wheel.center.y < 0.36)
    assert.ok(Math.abs(wheel.center.x) > 1)
    assert.ok(Math.abs(wheel.center.z) > 0.6)
  }
  assert.ok(result.parts.some(p => p.role === 'body'))
  assert.ok(result.parts.some(p => p.role === 'glass'))
  assert.ok(result.parts.some(p => p.role === 'detail'))
  const bounds = new Box3()
  for (const part of result.parts) {
    part.geometry.computeBoundingBox()
    bounds.union(part.geometry.boundingBox.clone().translate(part.center))
  }
  assert.ok(Math.abs(bounds.getSize(new Vector3()).x - spec.length) < 0.025, `visible length ${bounds.getSize(new Vector3()).x}`)
  assert.ok(Math.abs(bounds.min.y) < 1e-5)
  assert.equal(prepareVehicleGeometry(source, spec), result, 'all fleet cars share one prepared geometry allocation')
  for (const [mesh, geometry, material, transform] of snapshots) {
    assert.equal(mesh.geometry, geometry)
    assert.equal(mesh.material, material)
    assert.deepEqual(mesh.matrixWorld, transform)
  }
})

test('textured single-surface assets stay complete instead of pretending to support manufacturing stages', () => {
  const source = new Group()
  source.add(new Mesh(new BoxGeometry(4.5, 1.5, 1.8), new MeshStandardMaterial({ name: 'Material' })))
  const result = prepareVehicleGeometry(source, { ...spec, rotationY: 0 })
  assert.equal(result.staged, false)
  assert.deepEqual(result.parts.map(p => p.role), ['whole'])
})


test('every shipped near and far car derivative fits its slot and retains manufacturing separation', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/manifest.json', import.meta.url), 'utf8'))
  for (const [model, spec] of Object.entries(manifest.cars)) {
    if (!spec) continue
    const high = prepareVehicleGeometry(await loadGeometry(spec.url), spec)
    assert.ok(high.parts.length > 0, `${model} has renderable geometry`)
    if (model === 'onix' || model === 'cobalt') {
      assert.equal(high.staged, true, `${model} can hide fitted parts during manufacturing`)
      assert.equal(new Set(high.parts.filter(p => p.role === 'wheel').map(p => p.wheel)).size, 4, `${model} retains four wheels`)
    }
    if (spec.lodUrl) {
      const low = prepareVehicleGeometry(await loadGeometry(spec.lodUrl), spec)
      assert.equal(low.staged, high.staged, `${model} LOD preserves stage semantics`)
      assert.ok(low.triangles < high.triangles * 0.7, `${model} LOD reduces GPU work`)
      assert.deepEqual([...new Set(low.parts.filter(p => p.role === 'wheel').map(p => p.wheel))].sort(), [...new Set(high.parts.filter(p => p.role === 'wheel').map(p => p.wheel))].sort(), `${model} LOD retains all wheel groups`)
    }
  }
})
