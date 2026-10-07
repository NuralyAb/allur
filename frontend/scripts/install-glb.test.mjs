import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installGlb, parseArgs, validateGlb } from './install-glb.mjs'

function fixtureDocument(triangles = 1) {
  const byteLength = triangles * 3 * 12
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: triangles * 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }
}

function glb(doc = fixtureDocument(), { binary = true } = {}) {
  const json = Buffer.from(JSON.stringify(doc))
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
  json.copy(paddedJson)
  const bin = binary ? Buffer.alloc(Math.ceil(doc.buffers[0].byteLength / 4) * 4) : null
  const output = Buffer.alloc(20 + paddedJson.length + (bin ? 8 + bin.length : 0))
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(paddedJson.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  paddedJson.copy(output, 20)
  if (bin) {
    const offset = 20 + paddedJson.length
    output.writeUInt32LE(bin.length, offset)
    output.writeUInt32LE(0x004e4942, offset + 4)
    bin.copy(output, offset + 8)
  }
  return output
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'allur-glb-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'user selected model.glb')
  await writeFile(file, glb())
  return { directory, file, modelsDir: join(directory, 'models') }
}

function args(file, extra = []) {
  return parseArgs(['--kind', 'onix', '--file', file, '--source', 'https://example.com/original-model', '--author', 'Fixture author', '--license', 'CC0-1.0', ...extra])
}

test('valid embedded GLB and embedded data textures pass structural validation', () => {
  const doc = fixtureDocument()
  doc.images = [{ uri: 'data:image/png;base64,aGVsbG8=' }]
  const bytes = glb(doc)
  assert.deepEqual(validateGlb(bytes, 'onix'), { bytes: bytes.length, triangles: 1, meshes: 1 })
})

test('malformed headers, JSON, chunks and missing BIN fail', () => {
  assert.throws(() => validateGlb(Buffer.alloc(4), 'onix'), /header.*truncated/)
  const invalidMagic = glb(); invalidMagic.writeUInt32LE(0, 0)
  assert.throws(() => validateGlb(invalidMagic, 'onix'), /magic/)
  const wrongVersion = glb(); wrongVersion.writeUInt32LE(1, 4)
  assert.throws(() => validateGlb(wrongVersion, 'onix'), /version 2/)
  assert.throws(() => validateGlb(glb().subarray(0, -1), 'onix'), /header length/)
  const badChunk = glb(); badChunk.writeUInt32LE(999999, 12)
  assert.throws(() => validateGlb(badChunk, 'onix'), /chunk length/)
  const badJson = glb(); badJson[20] = 0x21
  assert.throws(() => validateGlb(badJson, 'onix'), /JSON/)
  assert.throws(() => validateGlb(glb(fixtureDocument(), { binary: false }), 'onix'), /embedded BIN/)
})

test('missing buffers and out-of-range geometry are rejected', () => {
  const missingBuffer = fixtureDocument(); missingBuffer.bufferViews[0].buffer = 1
  assert.throws(() => validateGlb(glb(missingBuffer), 'onix'), /missing buffer/)
  const missingData = fixtureDocument(); missingData.buffers.push({ byteLength: 36 })
  assert.throws(() => validateGlb(glb(missingData), 'onix'), /no embedded data/)
  const longAccessor = fixtureDocument(); longAccessor.accessors[0].count = 6
  assert.throws(() => validateGlb(glb(longAccessor), 'onix'), /bufferView bounds/)
  const longBin = fixtureDocument(); longBin.buffers[0].byteLength = 1
  assert.throws(() => validateGlb(glb(longBin), 'onix'), /buffer bounds/)
})

test('external buffers/textures are refused, including relative and protocol-relative URLs', () => {
  for (const uri of ['https://example.com/mesh.bin', '../mesh.bin', '//example.com/mesh.bin']) {
    const doc = fixtureDocument(); doc.buffers[0].uri = uri
    assert.throws(() => validateGlb(glb(doc), 'onix'), /external resources/)
  }
  const doc = fixtureDocument(); doc.images = [{ uri: 'textures/paint.png' }]
  assert.throws(() => validateGlb(glb(doc), 'onix'), /external resources/)
})

test('Draco, KTX/Basis and unsupported required extensions fail before writes', () => {
  for (const name of ['KHR_draco_mesh_compression', 'KHR_texture_basisu']) {
    const doc = fixtureDocument(); doc.extensionsUsed = [name]
    assert.throws(() => validateGlb(glb(doc), 'onix'), /not supported/)
  }
  const doc = fixtureDocument(); doc.extensionsUsed = ['VENDOR_unavailable']; doc.extensionsRequired = ['VENDOR_unavailable']
  assert.throws(() => validateGlb(glb(doc), 'onix'), /Unsupported required/)
  const ktx = fixtureDocument(); ktx.images = [{ uri: 'data:image/ktx2;base64,aGVsbG8=' }]
  assert.throws(() => validateGlb(glb(ktx), 'onix'), /KTX\/Basis/)
})

test('required Meshopt can use a virtual decompressed fallback buffer', () => {
  const doc = fixtureDocument()
  doc.extensionsUsed = ['EXT_meshopt_compression']; doc.extensionsRequired = ['EXT_meshopt_compression']
  doc.buffers.push({ byteLength: 36 })
  doc.bufferViews[0] = { buffer: 1, byteLength: 36, extensions: { EXT_meshopt_compression: { buffer: 0, byteLength: 36, byteStride: 12, count: 3, mode: 'ATTRIBUTES' } } }
  assert.equal(validateGlb(glb(doc), 'onix').triangles, 1)
})

test('triangle budgets reject excessive assets for both slots', () => {
  assert.throws(() => validateGlb(glb(fixtureDocument(150001)), 'conveyor'), /150,000.*Decimate/)
  assert.throws(() => validateGlb(glb(fixtureDocument(500001)), 'onix'), /500,000.*Decimate/)
})

test('invalid scene references and cycles fail', () => {
  const missing = fixtureDocument(); missing.scenes[0].nodes = [99]
  assert.throws(() => validateGlb(glb(missing), 'onix'), /missing node/)
  const cycle = fixtureDocument(); cycle.nodes[0].children = [0]
  assert.throws(() => validateGlb(glb(cycle), 'onix'), /cycle/)
})

test('CLI applies real car dimensions, converts degrees and validates metadata', () => {
  const parsed = args('/tmp/onix.glb', ['--rotation-y', '-90'])
  assert.equal(parsed.length, 4.474)
  assert.equal(parsed.rotationY, -Math.PI / 2)
  assert.throws(() => args('/tmp/onix.glb', ['--kind', 'cobalt']), /Duplicate/)
  assert.throws(() => parseArgs(['--kind', 'conveyor', '--file', '/tmp/module.glb']), /--length/)
  assert.throws(() => parseArgs(['--kind', 'onix', '--file', '/tmp/onix.glb']), /--source/)
  assert.throws(() => args('/tmp/onix.glb', ['--rotation-y', 'Infinity']), /rotation-y/)
  assert.throws(() => args('/tmp/onix.glb', ['--length', '0']), /--length/)
  assert.throws(() => parseArgs(['--kind', 'conveyor', '--file', '/tmp/module.glb', '--length', '13', '--check']), /12.8 metres/)
})

test('--check is read-only and does not require source metadata or conveyor length', async (t) => {
  const { directory, file, modelsDir } = await workspace(t)
  const before = await readdir(directory)
  const result = await installGlb(parseArgs(['--kind', 'conveyor', '--file', file, '--check']), { modelsDir })
  assert.equal(result.checked, true)
  assert.deepEqual(await readdir(directory), before)
})

test('install writes a content-hashed asset, preserves other slots, and requires explicit replacement', async (t) => {
  const { directory, file, modelsDir } = await workspace(t)
  const first = await installGlb(args(file, ['--rotation-y', '90']), { modelsDir })
  assert.match(first.url, /^\/models\/onix-[a-f0-9]{16}\.glb$/)
  let manifest = JSON.parse(await readFile(join(modelsDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.cars.onix.length, 4.474)
  assert.equal(manifest.cars.onix.rotationY, Math.PI / 2)
  assert.equal(manifest.cars.j7, null)
  assert.deepEqual(await readFile(join(modelsDir, first.url.split('/').at(-1))), await readFile(file))
  const cobalt = { ...manifest.cars.onix, url: '/models/cobalt-existing.glb', length: 4.479 }
  manifest.cars.cobalt = cobalt
  await writeFile(join(modelsDir, 'manifest.json'), JSON.stringify(manifest))
  const unchanged = await readFile(join(modelsDir, 'manifest.json'), 'utf8')
  const replacementFile = join(directory, 'replacement.glb')
  const changed = fixtureDocument(); changed.asset.generator = 'Another export'
  await writeFile(replacementFile, glb(changed))
  await assert.rejects(installGlb(args(replacementFile), { modelsDir }), /--replace/)
  assert.equal(await readFile(join(modelsDir, 'manifest.json'), 'utf8'), unchanged)
  const replaced = await installGlb(args(replacementFile, ['--replace']), { modelsDir })
  assert.notEqual(replaced.url, first.url)
  manifest = JSON.parse(await readFile(join(modelsDir, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.cars.cobalt, cobalt)
  assert.equal(manifest.conveyor, null)
  assert.equal((await readdir(modelsDir)).filter((name) => name.endsWith('.glb')).length, 2)
  assert(!(await readdir(modelsDir)).some((name) => name.endsWith('.tmp') || name.endsWith('.lock')))
})

test('invalid GLB leaves the installation directory absent', async (t) => {
  const { directory, file, modelsDir } = await workspace(t)
  await writeFile(file, 'this is not GLB')
  await assert.rejects(installGlb(args(file), { modelsDir }), /header/)
  assert.deepEqual(await readdir(directory), ['user selected model.glb'])
})
