#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = ['onix', 'cobalt', 'j7', 'conveyor']
const CAR_LENGTHS = { onix: 4.474, cobalt: 4.479, j7: 4.772 }
const MAX_BYTES = 64 * 1024 * 1024
const MODEL_URL = /^\/models\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*\.glb$/
const MESHOPT = ['EXT_meshopt_compression', 'KHR_meshopt_compression']
// Match the bundled GLTFLoader; Draco and KTX2 decoders are intentionally absent.
const SUPPORTED_REQUIRED = new Set([
  ...MESHOPT, 'KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_lights_punctual',
  'KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_dispersion',
  'KHR_materials_ior', 'KHR_materials_sheen', 'KHR_materials_specular',
  'KHR_materials_transmission', 'KHR_materials_iridescence', 'KHR_materials_anisotropy',
  'KHR_materials_volume', 'KHR_materials_emissive_strength', 'EXT_materials_bump',
  'EXT_texture_webp', 'EXT_texture_avif', 'EXT_mesh_gpu_instancing',
])
const DEFAULT_MODELS_DIR = fileURLToPath(new URL('../public/models/', import.meta.url))
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const HELP = `Install an exact, user-selected GLB asset (no downloads).

node scripts/install-glb.mjs --kind onix|cobalt|j7|conveyor --file /path/model.glb
  [--length metres] [--rotation-y degrees]
  --source https://original-asset-page --author "Author" --license "License"
  [--replace]

Use --check with --kind and --file for read-only validation; metadata is optional.
Car lengths default to 4.474 / 4.479 / 4.772 m. Conveyor imports require --length <=12.8 m.
Rotation defaults to 0°, accepts -360…360°, and is stored in radians.
Maximum file size: 64 MiB; maximum triangles: 500,000 car / 150,000 conveyor.
`

export function parseArgs(argv) {
  const values = {}
  const flags = new Set(['check', 'replace', 'help'])
  const names = new Set(['kind', 'file', 'length', 'rotation-y', 'source', 'author', 'license', ...flags])
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : ''
    assert(names.has(key), `Unknown argument: ${argv[i]}. Use --help.`)
    assert(!(key in values), `Duplicate argument: --${key}.`)
    if (flags.has(key)) values[key] = true
    else {
      const value = argv[++i]
      assert(value !== undefined && !value.startsWith('--'), `Missing value for --${key}.`)
      values[key] = value
    }
  }
  if (values.help) return { help: true }
  assert(KINDS.includes(values.kind), '--kind must be onix, cobalt, j7 or conveyor.')
  assert(hasText(values.file), '--file is required.')
  assert(extname(values.file).toLowerCase() === '.glb', 'Select a .glb file; export other formats as binary glTF 2.0 first.')
  const length = values.length === undefined ? CAR_LENGTHS[values.kind] : Number(values.length)
  if (length !== undefined || !values.check) {
    assert(Number.isFinite(length) && length >= 0.1 && length <= 100, '--length must be 0.1–100 metres (required for conveyor imports).')
  }
  if (values.kind === 'conveyor' && length !== undefined) assert(length <= 12.8, 'The conveyor pilot section allows --length up to 12.8 metres. Export a shorter floor-level module.')
  const degrees = values['rotation-y'] === undefined ? 0 : Number(values['rotation-y'])
  assert(Number.isFinite(degrees) && Math.abs(degrees) <= 360, '--rotation-y must be degrees between -360 and 360.')
  if (!values.check) {
    for (const key of ['source', 'author', 'license']) assert(hasText(values[key]), `--${key} is required (nonempty, at most 2048 characters).`)
    let source
    try { source = new URL(values.source) } catch { throw new Error('--source must be the original asset page HTTP(S) URL.') }
    assert(['https:', 'http:'].includes(source.protocol), '--source must be the original asset page HTTP(S) URL.')
  }
  return { ...values, file: resolve(values.file), length, rotationY: degrees * Math.PI / 180 }
}

function dataUriBytes(uri, label) {
  assert(typeof uri === 'string' && uri.startsWith('data:'), `${label}: external resources are not allowed; embed buffers and textures in the GLB.`)
  const match = /^data:([^,]*),(.*)$/s.exec(uri)
  assert(match, `${label}: malformed data URI.`)
  if (match[1].endsWith(';base64')) {
    assert(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]), `${label}: malformed base64 data.`)
    return Buffer.from(match[2], 'base64')
  }
  try { return Buffer.from(decodeURIComponent(match[2]), 'utf8') }
  catch { throw new Error(`${label}: malformed data URI encoding.`) }
}

function meshopt(view) {
  return MESHOPT.map((name) => view.extensions?.[name]).find(Boolean)
}

/** Structural/resource validation, not an authenticity check or a full glTF validator. */
export function validateGlb(bytes, kind) {
  assert(KINDS.includes(kind), 'Unknown asset kind.')
  assert(Buffer.isBuffer(bytes) && bytes.length >= 20, 'GLB header is missing or truncated.')
  assert(bytes.length <= MAX_BYTES, 'GLB exceeds 64 MiB. Optimize geometry and resize textures before importing.')
  assert(bytes.readUInt32LE(0) === 0x46546c67, 'Invalid GLB magic header.')
  assert(bytes.readUInt32LE(4) === 2, 'Only GLB version 2 is supported.')
  assert(bytes.readUInt32LE(8) === bytes.length, 'GLB header length does not match the file (truncated or trailing data).')
  let jsonBytes, bin
  for (let offset = 12; offset < bytes.length;) {
    assert(offset + 8 <= bytes.length, 'Truncated GLB chunk header.')
    const length = bytes.readUInt32LE(offset)
    const type = bytes.readUInt32LE(offset + 4)
    assert(length % 4 === 0 && offset + 8 + length <= bytes.length, 'Invalid or truncated GLB chunk length.')
    const content = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      assert(offset === 12 && !jsonBytes, 'GLB must start with exactly one JSON chunk.')
      jsonBytes = content
    } else if (type === 0x004e4942) {
      assert(jsonBytes && !bin, 'GLB must contain at most one BIN chunk after JSON.')
      bin = content
    } else throw new Error('Unsupported GLB chunk type; re-export as standard binary glTF 2.0.')
    offset += 8 + length
  }
  assert(jsonBytes && bin?.length, 'GLB must include a JSON chunk and embedded BIN data.')
  let doc
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)) }
  catch { throw new Error('Invalid UTF-8 or JSON in the GLB JSON chunk.') }
  assert(isRecord(doc) && doc.asset?.version === '2.0', 'GLB JSON must declare asset.version "2.0".')
  assert(doc.asset.minVersion === undefined || doc.asset.minVersion === '2.0', 'Unsupported glTF minimum version.')
  const used = doc.extensionsUsed ?? []
  const required = doc.extensionsRequired ?? []
  assert(Array.isArray(used) && used.every((x) => typeof x === 'string') && Array.isArray(required) && required.every((x) => typeof x === 'string'), 'Invalid extension lists.')
  // Check actual extension objects too, even when extensionsUsed was omitted.
  const extensionNames = new Set([...used, ...required])
  const pending = [doc]
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object') continue
    if (isRecord(value.extensions)) Object.keys(value.extensions).forEach((name) => extensionNames.add(name))
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child)
  }
  assert(!extensionNames.has('KHR_draco_mesh_compression'), 'Draco compression is not supported; export uncompressed or Meshopt GLB.')
  assert(!extensionNames.has('KHR_texture_basisu'), 'KTX/Basis textures are not supported; embed PNG, JPEG, WebP or AVIF textures.')
  for (const name of required) {
    assert(used.includes(name), `Required extension ${name} is missing from extensionsUsed.`)
    assert(SUPPORTED_REQUIRED.has(name), `Unsupported required glTF extension: ${name}. Re-export without it.`)
  }

  const buffers = doc.buffers
  const views = doc.bufferViews
  assert(Array.isArray(buffers) && buffers.length > 0 && Array.isArray(views) && views.length > 0, 'GLB is missing buffers or bufferViews.')
  const bufferData = buffers.map((buffer, index) => {
    assert(isRecord(buffer) && integer(buffer.byteLength, 1) && buffer.byteLength <= MAX_BYTES, `Buffer ${index} has an invalid or excessive byteLength.`)
    if (buffer.uri !== undefined) {
      const data = dataUriBytes(buffer.uri, `Buffer ${index}`)
      assert(data.length === buffer.byteLength, `Buffer ${index} data length does not match byteLength.`)
      return data
    }
    if (index === 0) {
      assert(bin.length >= buffer.byteLength && bin.length <= buffer.byteLength + 3, 'Embedded BIN length does not match buffer 0 byteLength.')
      return bin
    }
    // Meshopt may omit its decompressed fallback buffer when the extension is required.
    const referring = views.filter((view) => view.buffer === index)
    assert(MESHOPT.some((name) => required.includes(name)) && referring.length > 0 && referring.every((view) => meshopt(view)), `Buffer ${index} has no embedded data.`)
    return null
  })
  assert(buffers[0].uri === undefined, 'The first GLB buffer must use the embedded BIN chunk.')
  const range = (item, label, requireData = false) => {
    assert(isRecord(item) && integer(item.buffer) && buffers[item.buffer], `${label} references a missing buffer.`)
    assert(integer(item.byteOffset ?? 0) && integer(item.byteLength, 1) && (item.byteOffset ?? 0) + item.byteLength <= buffers[item.buffer].byteLength, `${label} exceeds its buffer bounds.`)
    if (requireData) assert(bufferData[item.buffer], `${label} references a missing data buffer.`)
  }
  views.forEach((view, index) => {
    range(view, `BufferView ${index}`)
    const compressed = meshopt(view)
    if (compressed) {
      range(compressed, `Meshopt BufferView ${index}`, true)
      assert(integer(compressed.count, 1) && integer(compressed.byteStride, 1) && compressed.count * compressed.byteStride === view.byteLength && ['ATTRIBUTES', 'TRIANGLES', 'INDICES'].includes(compressed.mode), `Invalid Meshopt BufferView ${index}.`)
    }
  })

  for (const [index, image] of (doc.images ?? []).entries()) {
    assert(isRecord(image), `Invalid image ${index}.`)
    let data
    if (image.uri !== undefined) data = dataUriBytes(image.uri, `Image ${index}`)
    else {
      assert(integer(image.bufferView) && views[image.bufferView], `Image ${index} references a missing bufferView.`)
      const view = views[image.bufferView]
      assert(bufferData[view.buffer], `Image ${index} has no embedded bytes.`)
      data = bufferData[view.buffer].subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    }
    assert(!/ktx|basis/i.test(image.mimeType ?? '') && !/^data:[^,]*(?:ktx|basis)/i.test(image.uri ?? '') && (data.length < 4 || data.readUInt32BE(0) !== 0xab4b5458) && data.subarray(0, 2).toString() !== 'sB', 'KTX/Basis textures are not supported; convert to PNG, JPEG, WebP or AVIF.')
  }

  const accessors = doc.accessors
  assert(Array.isArray(accessors) && accessors.length > 0, 'GLB is missing geometry accessors.')
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  accessors.forEach((accessor, index) => {
    assert(isRecord(accessor) && integer(accessor.count, 1) && sizes[accessor.componentType] && widths[accessor.type], `Invalid accessor ${index}.`)
    if (accessor.bufferView !== undefined) {
      const view = views[accessor.bufferView]
      assert(integer(accessor.bufferView) && view, `Accessor ${index} references a missing bufferView.`)
      const componentSize = sizes[accessor.componentType]
      const columns = accessor.type.startsWith('MAT') ? Number(accessor.type.slice(3)) : 0
      const packed = columns ? Math.ceil(columns * componentSize / 4) * 4 * columns : componentSize * widths[accessor.type]
      const stride = view.byteStride ?? packed
      assert(integer(accessor.byteOffset ?? 0) && integer(stride, packed) && (accessor.byteOffset ?? 0) + (accessor.count - 1) * stride + packed <= view.byteLength, `Accessor ${index} exceeds its bufferView bounds.`)
    } else assert(accessor.sparse, `Accessor ${index} has no bufferView or sparse data.`)
    if (accessor.sparse) {
      const sparse = accessor.sparse
      assert(integer(sparse.count, 1) && sparse.count <= accessor.count && integer(sparse.indices?.bufferView) && integer(sparse.values?.bufferView) && views[sparse.indices.bufferView] && views[sparse.values.bufferView] && [5121, 5123, 5125].includes(sparse.indices.componentType), `Invalid sparse data in accessor ${index}.`)
      const sparseIndexBytes = sparse.count * sizes[sparse.indices.componentType]
      const sparseValueBytes = sparse.count * sizes[accessor.componentType] * widths[accessor.type]
      assert(integer(sparse.indices.byteOffset ?? 0) && integer(sparse.values.byteOffset ?? 0) && (sparse.indices.byteOffset ?? 0) + sparseIndexBytes <= views[sparse.indices.bufferView].byteLength && (sparse.values.byteOffset ?? 0) + sparseValueBytes <= views[sparse.values.bufferView].byteLength, `Sparse data in accessor ${index} exceeds its bufferView bounds.`)
    }
  })
  assert(Array.isArray(doc.meshes) && doc.meshes.length > 0, 'GLB contains no meshes.')
  const trianglesPerMesh = doc.meshes.map((mesh, index) => {
    assert(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, `Mesh ${index} has no primitives.`)
    return mesh.primitives.reduce((total, primitive) => {
      const position = accessors[primitive.attributes?.POSITION]
      assert(integer(primitive.attributes?.POSITION) && position?.type === 'VEC3', `Mesh ${index} has no valid POSITION accessor.`)
      const accessor = primitive.indices === undefined ? position : accessors[primitive.indices]
      assert(accessor && (primitive.indices === undefined || (integer(primitive.indices) && accessor.type === 'SCALAR' && [5121, 5123, 5125].includes(accessor.componentType))), `Mesh ${index} has invalid indices.`)
      const mode = primitive.mode ?? 4
      assert([4, 5, 6].includes(mode), 'Import a triangle mesh; point and line primitives are unsupported.')
      assert(accessor.count >= 3 && (mode !== 4 || accessor.count % 3 === 0), `Mesh ${index} has an invalid triangle count.`)
      return total + (mode === 4 ? accessor.count / 3 : accessor.count - 2)
    }, 0)
  })
  assert(Array.isArray(doc.nodes) && Array.isArray(doc.scenes) && doc.scenes[doc.scene ?? 0]?.nodes?.length > 0, 'GLB needs a nonempty default scene.')
  const visited = new Set()
  let sceneHasMesh = false
  function visitNode(index, depth = 0) {
    assert(integer(index) && isRecord(doc.nodes[index]), 'Scene references a missing node.')
    assert(!visited.has(index) && depth <= 256, 'Scene contains a cycle, repeated node or excessive nesting.')
    visited.add(index)
    const node = doc.nodes[index]
    if (node.mesh !== undefined) sceneHasMesh = true
    assert(node.children === undefined || Array.isArray(node.children), 'Invalid scene node children.')
    for (const child of node.children ?? []) visitNode(child, depth + 1)
  }
  for (const root of doc.scenes[doc.scene ?? 0].nodes) visitNode(root)
  assert(sceneHasMesh, 'The default scene contains no mesh.')
  let nodeTriangles = 0
  for (const node of doc.nodes) {
    if (node.mesh === undefined) continue
    assert(integer(node.mesh) && trianglesPerMesh[node.mesh] !== undefined, 'Scene node references a missing mesh.')
    const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes
    let instances = 1
    if (attributes) {
      const counts = Object.values(attributes).map((index) => accessors[index]?.count)
      assert(counts.length > 0 && counts.every((count) => integer(count, 1) && count === counts[0]), 'Invalid GPU instance attributes.')
      instances = counts[0]
    }
    nodeTriangles += trianglesPerMesh[node.mesh] * instances
  }
  const triangles = Math.max(nodeTriangles, trianglesPerMesh.reduce((sum, count) => sum + count, 0))
  const limit = kind === 'conveyor' ? 150_000 : 500_000
  assert(triangles <= limit, `Model has ${triangles.toLocaleString('en-US')} triangles; limit for ${kind} is ${limit.toLocaleString('en-US')}. Decimate meshes, remove hidden parts, then re-export.`)
  return { bytes: bytes.length, triangles, meshes: doc.meshes.length }
}

function readRegistry(value) {
  assert(isRecord(value) && isRecord(value.cars) && Object.keys(value.cars).every((key) => Object.hasOwn(CAR_LENGTHS, key)), 'Existing manifest has invalid car keys; fix it before importing.')
  for (const spec of [...Object.keys(CAR_LENGTHS).map((key) => value.cars[key]), value.conveyor]) {
    if (spec === null) continue
    assert(isRecord(spec) && typeof spec.url === 'string' && MODEL_URL.test(spec.url) && Number.isFinite(spec.length) && spec.length >= 0.1 && spec.length <= 100 && Number.isFinite(spec.rotationY) && Math.abs(spec.rotationY) <= Math.PI * 2 && ['source', 'author', 'license'].every((key) => hasText(spec[key])), 'Existing manifest has an invalid entry; fix it before importing.')
  }
  return value
}

export async function installGlb(options, { modelsDir = DEFAULT_MODELS_DIR } = {}) {
  // Complete validation before creating files or changing the registry.
  const info = await stat(options.file)
  assert(info.isFile() && info.size <= MAX_BYTES, 'Select a regular GLB file no larger than 64 MiB.')
  const bytes = await readFile(options.file)
  const summary = validateGlb(bytes, options.kind)
  if (options.check) return { ...summary, checked: true }
  const metadata = parseArgs(['--kind', options.kind, '--file', options.file, '--length', String(options.length), '--rotation-y', String(options.rotationY * 180 / Math.PI), '--source', options.source ?? '', '--author', options.author ?? '', '--license', options.license ?? ''])
  await mkdir(modelsDir, { recursive: true })
  const lockPath = join(modelsDir, '.install-glb.lock')
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another import is active (.install-glb.lock). If a previous import was interrupted, remove that lock after checking no importer is running.')
    throw error
  }
  const temporaryManifest = join(modelsDir, `.manifest-${randomUUID()}.tmp`)
  try {
    const manifestPath = join(modelsDir, 'manifest.json')
    let manifest
    try { manifest = readRegistry(JSON.parse(await readFile(manifestPath, 'utf8'))) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      manifest = { cars: { onix: null, cobalt: null, j7: null }, conveyor: null }
    }
    const oldEntry = options.kind === 'conveyor' ? manifest.conveyor : manifest.cars[options.kind]
    assert(!oldEntry || options.replace, `${options.kind} is already configured. Use --replace to change it; the old GLB file will be retained.`)
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const filename = `${options.kind}-${hash}.glb`
    const assetPath = join(modelsDir, filename)
    try { await writeFile(assetPath, bytes, { flag: 'wx' }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      assert((await readFile(assetPath)).equals(bytes), 'The content-hashed target already exists with different bytes; inspect it before retrying.')
    }
    const entry = { url: `/models/${filename}`, length: metadata.length, rotationY: metadata.rotationY, source: metadata.source.trim(), author: metadata.author.trim(), license: metadata.license.trim() }
    if (options.kind === 'conveyor') manifest.conveyor = entry
    else manifest.cars[options.kind] = entry
    if ('_comment' in manifest) manifest._comment = 'Null entries retain the existing scene. Added models are user-selected; verify their exact model generation, source and license.'
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await rename(temporaryManifest, manifestPath)
    return { ...summary, checked: false, url: entry.url, manifest: manifestPath }
  } finally {
    await rm(temporaryManifest, { force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) console.log(HELP)
    else {
      const result = await installGlb(options)
      console.log(`${result.checked ? 'Validated (no files changed)' : `Installed ${result.url}`}: ${result.triangles.toLocaleString('en-US')} triangles, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB.`)
      if (!result.checked) console.log('Reload the page to load the updated manifest. Confirm the model, orientation and proportions in the close-up view.')
    }
  } catch (error) {
    console.error(`GLB import failed: ${error.message}`)
    process.exitCode = 1
  }
}
