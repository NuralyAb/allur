import assert from 'node:assert/strict'
import test from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { prepareGlbScene } from '../src/scene/prepareGlbScene.ts'

const spec = (overrides = {}) => ({
  url: '/models/cars/onix.glb',
  length: 4.474,
  rotationY: 0,
  source: 'Local test fixture',
  author: 'Test suite',
  license: 'Test fixture',
  ...overrides,
})

function box(length, height, width) {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(length, height, width), new MeshStandardMaterial()))
  return root
}

function boundsOf(object) {
  object.updateMatrixWorld(true)
  return new Box3().setFromObject(object, true)
}

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: expected ${expected}, got ${actual}`)
}

test('normalizes a millimetre asset with nested authored offsets onto the floor', () => {
  const source = new Group()
  source.position.set(12000, -3500, 9000)
  const authored = box(4474, 1471, 1730)
  authored.position.set(340, 480, -570)
  source.add(authored)

  const result = prepareGlbScene(source, spec())
  const bounds = boundsOf(result)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  close(size.x, 4.474, 'length in metres')
  close(size.y, 1.471, 'height in metres')
  close(size.z, 1.730, 'width in metres')
  close(center.x, 0, 'centred along X')
  close(center.z, 0, 'centred along Z')
  close(bounds.min.y, 0, 'wheel contact plane')
})

test('rotates a +Z-facing vehicle to +X before measuring its length', () => {
  const source = box(1.73, 1.471, 4.474)
  const frontMarker = new Group()
  frontMarker.name = 'front-marker'
  frontMarker.position.set(0, 0, 2)
  source.add(frontMarker)

  const result = prepareGlbScene(source, spec({ rotationY: Math.PI / 2 }))
  const bounds = boundsOf(result)
  const size = bounds.getSize(new Vector3())
  const front = result.getObjectByName('front-marker').getWorldPosition(new Vector3())
  close(size.x, 4.474, 'rotated length')
  close(size.z, 1.73, 'rotated width')
  assert.ok(front.x > 0, 'front must face +X')
  close(front.z, 0, 'front stays on centreline')
})

test('uses uniform scale and preserves the authored proportions', () => {
  const source = box(8, 3, 3.6)
  source.scale.setScalar(1.5)
  const result = prepareGlbScene(source, spec({ length: 4.8 }))
  const dimensions = boundsOf(result).getSize(new Vector3())
  close(result.scale.x, result.scale.y, 'uniform X/Y scale')
  close(result.scale.y, result.scale.z, 'uniform Y/Z scale')
  close(dimensions.x, 4.8, 'desired length')
  close(dimensions.y / dimensions.x, 3 / 8, 'height/length ratio')
  close(dimensions.z / dimensions.x, 3.6 / 8, 'width/length ratio')
})

test('clones hierarchy without modifying source transforms, shadows or shared resources', () => {
  const parent = new Group()
  const source = box(4.474, 1.471, 1.73)
  source.name = 'authored-root'
  source.position.set(25, 6, -15)
  parent.add(source)
  const mesh = source.children[0]
  mesh.name = 'body'
  const beforePosition = source.position.clone()
  const beforeRotation = source.quaternion.clone()
  const beforeScale = source.scale.clone()
  const beforeVertices = mesh.geometry.attributes.position.array.slice()

  const first = prepareGlbScene(source, spec())
  const second = prepareGlbScene(source, spec())
  const firstMesh = first.getObjectByName('body')
  const secondMesh = second.getObjectByName('body')
  assert.equal(source.parent, parent)
  assert.deepEqual(source.position, beforePosition)
  assert.deepEqual(source.quaternion.toArray(), beforeRotation.toArray())
  assert.deepEqual(source.scale, beforeScale)
  assert.deepEqual(mesh.geometry.attributes.position.array, beforeVertices)
  assert.equal(mesh.castShadow, false)
  assert.equal(mesh.receiveShadow, false)
  assert.notEqual(firstMesh, mesh)
  assert.notEqual(firstMesh, secondMesh)
  assert.equal(firstMesh.geometry, mesh.geometry)
  assert.equal(firstMesh.material, mesh.material)
  assert.equal(firstMesh.castShadow, true)
  assert.equal(firstMesh.receiveShadow, true)
  firstMesh.position.x += 10
  assert.notEqual(firstMesh.position.x, secondMesh.position.x)
})

test('rejects empty, flat and nonfinite assets before they enter the scene', () => {
  assert.throws(() => prepareGlbScene(new Group(), spec()), /finite three-dimensional bounds/)
  assert.throws(() => prepareGlbScene(box(4.474, 0, 1.73), spec()), /finite three-dimensional bounds/)
  const invalid = box(4.474, 1.471, 1.73)
  invalid.position.x = Infinity
  assert.throws(() => prepareGlbScene(invalid, spec()), /finite three-dimensional bounds/)
})

test('rejects sideways cars and geometry with implausible vehicle proportions', () => {
  for (const dimensions of [[1.73, 1.471, 4.474], [4.474, 0.4, 1.73], [4.474, 3, 1.73], [4.474, 1.471, 3]]) {
    assert.throws(() => prepareGlbScene(box(...dimensions), spec()), /Car GLB proportions/)
  }
})

test('fits a conveyor into the floor slot with its running surface at 0.30 metres', () => {
  const source = box(12000, 200, 2800)
  source.position.set(11000, -900, 600)
  const result = prepareGlbScene(source, spec({ length: 12 }), true)
  const bounds = boundsOf(result)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  close(size.x, 12, 'conveyor length')
  close(size.z, 2.8, 'conveyor width')
  close(bounds.max.y, 0.3, 'running surface height')
  close(bounds.min.y, 0.1, 'conveyor base height')
  close(center.x, 0, 'conveyor centred along X')
  close(center.z, 0, 'conveyor centred along Z')
})

test('rejects conveyors which exceed the available length, width or vertical clearance', () => {
  for (const [length, height, width] of [[13, 0.2, 2.8], [12, 0.2, 2], [12, 0.2, 3.4], [12, 0.8, 2.8]]) {
    assert.throws(() => prepareGlbScene(box(length, height, width), spec({ length }), true), /Conveyor must fit the floor slot/)
  }
})

test('accepts the documented conveyor slot limits despite Float32 vertex precision', () => {
  const result = prepareGlbScene(box(12, 0.35, 3.2), spec({ length: 12 }), true)
  const size = boundsOf(result).getSize(new Vector3())
  close(size.x, 12, 'requested length')
  close(size.y, 0.35, 'maximum height')
  close(size.z, 3.2, 'maximum width')
  const maximumLength = prepareGlbScene(box(12.8, 0.2, 2.8), spec({ length: 12.8 }), true)
  close(boundsOf(maximumLength).getSize(new Vector3()).x, 12.8, 'maximum length')
})

test('loads a self-contained GLB through the real loader, normalizes it and preserves authored PBR', async () => {
  // An in-memory bounding box only: no vehicle asset or fixture is shipped to public/.
  // Deliberately authored in millimetres, along Z, and away from the origin.
  const vertices = new Float32Array([
    0, 0, 0, 1730, 0, 0, 1730, 1471, 0, 0, 1471, 0,
    0, 0, 4474, 1730, 0, 4474, 1730, 1471, 4474, 0, 1471, 4474,
  ])
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ])
  const binary = Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(indices.buffer)])
  const document = {
    asset: { version: '2.0', generator: 'In-memory normalization integration test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'fixture-body', mesh: 0, translation: [410, -700, 300] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{
      name: 'authored-paint',
      pbrMetallicRoughness: {
        baseColorFactor: [0.62, 0.67, 0.72, 1],
        metallicFactor: 0.68,
        roughnessFactor: 0.27,
      },
      extensions: { KHR_materials_clearcoat: { clearcoatFactor: 0.85, clearcoatRoughnessFactor: 0.18 } },
    }],
    extensionsUsed: ['KHR_materials_clearcoat'],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength, target: 34962 },
      { buffer: 0, byteOffset: vertices.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [0, 0, 0], max: [1730, 1471, 4474] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  }
  const json = Buffer.from(JSON.stringify(document))
  const jsonLength = Math.ceil(json.length / 4) * 4
  const glb = Buffer.alloc(12 + 8 + jsonLength + 8 + binary.length)
  glb.writeUInt32LE(0x46546c67, 0)
  glb.writeUInt32LE(2, 4)
  glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(jsonLength, 12)
  glb.writeUInt32LE(0x4e4f534a, 16)
  glb.fill(0x20, 20, 20 + jsonLength)
  json.copy(glb, 20)
  glb.writeUInt32LE(binary.length, 20 + jsonLength)
  glb.writeUInt32LE(0x004e4942, 24 + jsonLength)
  binary.copy(glb, 28 + jsonLength)

  const { scene } = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')
  const original = scene.getObjectByName('fixture-body')
  assert.ok(original instanceof Mesh, 'the real GLB parser should create a renderable mesh')
  const result = prepareGlbScene(scene, spec({ rotationY: Math.PI / 2 }))
  const bounds = boundsOf(result)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  close(size.x, 4.474, 'loaded length')
  close(size.y, 1.471, 'loaded height')
  close(size.z, 1.73, 'loaded width')
  close(center.x, 0, 'loaded X centre')
  close(center.z, 0, 'loaded Z centre')
  close(bounds.min.y, 0, 'loaded floor contact')

  const normalizedMesh = result.getObjectByName('fixture-body')
  assert.equal(normalizedMesh.material, original.material, 'normalization should retain authored PBR resource')
  assert.equal(normalizedMesh.material.name, 'authored-paint')
  close(normalizedMesh.material.color.r, 0.62, 'authored linear red')
  close(normalizedMesh.material.color.g, 0.67, 'authored linear green')
  close(normalizedMesh.material.color.b, 0.72, 'authored linear blue')
  close(normalizedMesh.material.metalness, 0.68, 'authored metallic factor')
  close(normalizedMesh.material.roughness, 0.27, 'authored roughness factor')
  close(normalizedMesh.material.clearcoat, 0.85, 'authored clearcoat extension')
  close(normalizedMesh.material.clearcoatRoughness, 0.18, 'authored clearcoat roughness')
  assert.deepEqual(original.position.toArray(), [410, -700, 300], 'source node keeps its authored transform')
})
