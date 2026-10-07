import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { dedupeVehicleBuffer, dedupeVehicleFile } from './dedupe-vehicle.mjs'

function fixture(change = () => {}) {
  const binary = Buffer.alloc(96)
  new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).forEach((v, i) => binary.writeFloatLE(v, i * 4))
  ;[0, 1, 2].forEach((v, i) => binary.writeUInt16LE(v, 36 + i * 2))
  binary.write('TEST', 44); binary.copy(binary, 48, 0, 48)
  const document = {
    asset: { version: '2.0', extras: { license: 'fixture metadata' } }, scene: 0,
    scenes: [{ nodes: [0, 2, 3, 4, 5] }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }, { buffer: 0, byteOffset: 48, byteLength: 36 }, { buffer: 0, byteOffset: 84, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 }, { bufferView: 1, componentType: 5123, type: 'SCALAR', count: 3 }, { bufferView: 2, componentType: 5126, type: 'VEC3', count: 3 }, { bufferView: 3, componentType: 5123, type: 'SCALAR', count: 3 }],
    materials: [{ name: 'paint' }, { name: 'trim' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 1 }] }, { primitives: [{ attributes: { POSITION: 2 }, indices: 3, material: 0 }] }],
    nodes: [{ translation: [5, 0, 0], children: [1] }, { name: 'original', mesh: 0, translation: [-5, 0, 0] }, { name: 'duplicate buffers', mesh: 2 }, { name: 'different placement', mesh: 0, translation: [2, 0, 0] }, { name: 'different material', mesh: 1 }, { name: 'duplicate parent', mesh: 0, children: [6], extras: { preserve: true } }, { name: 'unique child', mesh: 0, translation: [3, 0, 0] }],
  }
  change(document)
  const json = Buffer.from(JSON.stringify(document)), length = Math.ceil(json.length / 4) * 4
  const bytes = Buffer.alloc(28 + length + binary.length)
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8)
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16)
  bytes.fill(32, 20, 20 + length); json.copy(bytes, 20)
  bytes.writeUInt32LE(binary.length, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length); binary.copy(bytes, 28 + length)
  return bytes
}
const unpack = bytes => ({ json: JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))), binary: bytes.subarray(28 + bytes.readUInt32LE(12)) })

test('deduplication compares geometry bytes and world placement, retaining material differences and descendants', () => {
  const source = fixture(), original = Buffer.from(source)
  const result = dedupeVehicleBuffer(source), parsed = unpack(result.bytes)
  assert.deepEqual(result.removed.map(node => node.node), [2, 5])
  assert.equal(parsed.json.nodes[2].mesh, undefined)
  assert.equal(parsed.json.nodes[5].mesh, undefined)
  for (const index of [1, 3, 4, 6]) assert.notEqual(parsed.json.nodes[index].mesh, undefined)
  assert.deepEqual(parsed.json.nodes[5].children, [6])
  assert.deepEqual(parsed.json.nodes[5].extras, { preserve: true })
  assert.deepEqual(parsed.json.asset.extras, { license: 'fixture metadata' })
  assert.deepEqual(parsed.binary, unpack(source).binary, 'geometry and embedded texture bytes are unchanged')
  assert.deepEqual(source, original, 'source buffer stays untouched')
  assert.equal(dedupeVehicleBuffer(result.bytes).removed.length, 0, 'cleanup is idempotent')
})

test('invalid, animated, compressed or out-of-bounds geometry is rejected', () => {
  assert.throws(() => dedupeVehicleBuffer(Buffer.alloc(50)), /binary glTF/)
  assert.throws(() => dedupeVehicleBuffer(fixture(d => { d.animations = [{}] })), /Animated/)
  assert.throws(() => dedupeVehicleBuffer(fixture(d => { d.buffers[0].uri = 'remote.bin' })), /self-contained/)
  assert.throws(() => dedupeVehicleBuffer(fixture(d => { d.accessors[0].count = 1000000 })), /exceeds/)
  assert.throws(() => dedupeVehicleBuffer(fixture(d => { d.nodes[1].children = [0] })), /cycle/)
  assert.throws(() => dedupeVehicleBuffer(fixture(d => { d.nodes[1].mesh = 99 })), /missing mesh/)
})

test('file cleanup refuses to overwrite either original or existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'allur-dedupe-'))
  try {
    const input = join(directory, 'original.glb'), output = join(directory, 'clean.glb'), bytes = fixture()
    await writeFile(input, bytes)
    await assert.rejects(dedupeVehicleFile(input, input), /never overwritten/)
    const result = await dedupeVehicleFile(input, output)
    assert.equal(result.removed, 2)
    const firstOutput = await readFile(output)
    await assert.rejects(dedupeVehicleFile(input, output), { code: 'EEXIST' })
    assert.deepEqual(await readFile(input), bytes)
    assert.deepEqual(await readFile(output), firstOutput)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
