#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Matrix4, Quaternion, Vector3 } from 'three'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const WIDTHS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

/** Remove identical static mesh placements; preserve every other JSON field and all binary bytes. */
export function dedupeVehicleBuffer(bytes) {
  assert(Buffer.isBuffer(bytes) && bytes.length >= 28 && bytes.length <= 64 * 1024 * 1024, 'Expected a GLB between 28 bytes and 64 MiB.')
  assert(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2, 'Expected binary glTF 2.0.')
  assert(bytes.readUInt32LE(8) === bytes.length && bytes.readUInt32LE(16) === 0x4e4f534a, 'Invalid GLB header or JSON chunk.')
  const jsonLength = bytes.readUInt32LE(12)
  assert(jsonLength % 4 === 0 && 28 + jsonLength <= bytes.length, 'Invalid JSON chunk length.')
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
  const chunks = bytes.subarray(20 + jsonLength)
  assert(chunks.readUInt32LE(4) === 0x004e4942 && chunks.readUInt32LE(0) + 8 === chunks.length, 'Expected one embedded binary chunk.')
  const binary = chunks.subarray(8)
  assert(document.asset?.version === '2.0' && document.buffers?.length === 1 && !document.buffers[0].uri, 'Use one self-contained binary glTF buffer.')
  assert(document.buffers[0].byteLength <= binary.length, 'Binary buffer exceeds its chunk.')
  assert(document.scenes?.length === 1 && Array.isArray(document.nodes) && Array.isArray(document.meshes), 'Expected one static scene with nodes and meshes.')
  assert(!document.animations?.length && !document.skins?.length, 'Animated or skinned placements must not be deduplicated as static geometry.')

  const accessorHashes = new Map()
  function accessorHash(index) {
    if (accessorHashes.has(index)) return accessorHashes.get(index)
    const accessor = document.accessors?.[index]
    assert(accessor && integer(accessor.count) && !accessor.sparse, 'Invalid or sparse accessor; decode sparse data first.')
    const view = document.bufferViews?.[accessor.bufferView]
    assert(view && view.buffer === 0 && !view.extensions?.EXT_meshopt_compression && !view.extensions?.KHR_meshopt_compression, 'Decode compressed geometry before deduplicating.')
    const elementSize = WIDTHS[accessor.componentType] * COMPONENTS[accessor.type]
    const stride = view.byteStride ?? elementSize
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    assert(Number.isFinite(elementSize) && integer(stride) && stride >= elementSize && integer(offset), 'Unsupported accessor encoding.')
    const end = accessor.count ? offset + (accessor.count - 1) * stride + elementSize : offset
    assert(end <= binary.length && end <= (view.byteOffset ?? 0) + view.byteLength, 'Accessor exceeds its buffer view.')
    const hash = createHash('sha256').update(`${accessor.componentType}:${accessor.count}:${accessor.type}:${accessor.normalized ?? false}:`)
    for (let i = 0; i < accessor.count; i++) hash.update(binary.subarray(offset + i * stride, offset + i * stride + elementSize))
    const digest = hash.digest('hex')
    accessorHashes.set(index, digest)
    return digest
  }

  const meshHashes = document.meshes.map((mesh) => {
    assert(Array.isArray(mesh.primitives) && mesh.primitives.length, 'Empty mesh.')
    return mesh.primitives.map((primitive) => {
      assert(!primitive.targets?.length && !primitive.extensions?.KHR_draco_mesh_compression, 'Decode compressed or morphed geometry first.')
      assert(primitive.attributes && Object.keys(primitive.attributes).length, 'Primitive has no attributes.')
      return [primitive.mode ?? 4, primitive.material ?? -1, primitive.indices === undefined ? '' : accessorHash(primitive.indices),
        ...Object.entries(primitive.attributes).sort().map(([name, value]) => `${name}:${accessorHash(value)}`)].join('|')
    }).join(';')
  })

  const seen = new Map(), visited = new Set(), removed = []
  function walk(index, parent) {
    assert(integer(index) && document.nodes[index] && !visited.has(index), 'Scene contains an invalid node, cycle, or multiple parents.')
    visited.add(index)
    const node = document.nodes[index]
    assert(node.skin === undefined && !node.weights?.length, 'Animated/skinned nodes are not supported.')
    const transform = (value, fallback, length) => {
      const result = value ?? fallback
      assert(Array.isArray(result) && result.length === length && result.every(Number.isFinite), 'Invalid node transform.')
      return result
    }
    const local = node.matrix
      ? new Matrix4().fromArray(transform(node.matrix, [], 16))
      : new Matrix4().compose(new Vector3().fromArray(transform(node.translation, [0, 0, 0], 3)), new Quaternion().fromArray(transform(node.rotation, [0, 0, 0, 1], 4)), new Vector3().fromArray(transform(node.scale, [1, 1, 1], 3)))
    const world = parent.clone().multiply(local)
    if (node.mesh !== undefined) {
      assert(integer(node.mesh) && meshHashes[node.mesh], 'Node references a missing mesh.')
      // Micrometre precision removes authored duplicates without merging separate panels.
      const key = `${meshHashes[node.mesh]}:${world.elements.map((value) => value.toFixed(6)).join(',')}`
      if (seen.has(key)) { removed.push({ node: index, name: node.name ?? '', duplicateOf: seen.get(key) }); delete node.mesh }
      else seen.set(key, index)
    }
    for (const child of node.children ?? []) walk(child, world)
  }
  for (const root of document.scenes[0].nodes ?? []) walk(root, new Matrix4())
  const json = Buffer.from(JSON.stringify(document)), paddedLength = Math.ceil(json.length / 4) * 4
  const result = Buffer.alloc(20 + paddedLength + chunks.length)
  bytes.copy(result, 0, 0, 20)
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(paddedLength, 12)
  result.fill(32, 20, 20 + paddedLength); json.copy(result, 20); chunks.copy(result, 20 + paddedLength)
  return { bytes: result, removed }
}

export async function dedupeVehicleFile(input, output) {
  assert(input && output && resolve(input) !== resolve(output), 'Use a separate output path; the downloaded original is never overwritten.')
  const result = dedupeVehicleBuffer(await readFile(input))
  await writeFile(output, result.bytes, { flag: 'wx' })
  return { input, output, removed: result.removed.length, nodes: result.removed }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output, extra] = process.argv.slice(2)
  if (!input || !output || extra) throw new Error('Usage: node scripts/dedupe-vehicle.mjs input.glb new-output.glb')
  console.log(JSON.stringify(await dedupeVehicleFile(input, output)))
}
