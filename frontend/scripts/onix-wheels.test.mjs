import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Group, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createOnixWheelRig } from '../src/scene/onixWheels.ts'
import { prepareGlbScene } from '../src/scene/prepareGlbScene.ts'

const spec = {
  url: '/models/onix-c1bb20bcc2b636e8.glb',
  length: 4.474,
  rotationY: -Math.PI / 2,
  source: 'https://sketchfab.com/3d-models/chevrolet-onix-bfd798c2695847b28ab681d42abc7056',
  author: 'uzb_rx7 (uzbek_supra)',
  license: 'CC-BY-4.0',
}
const names = ['wheel_rf_dummy', 'wheel_rf_dummy001', 'wheel_rf_dummy002', 'wheel_rf_dummy003']

async function loadAuthoredGeometry() {
  const file = await readFile(new URL('../public/models/onix-c1bb20bcc2b636e8.glb', import.meta.url))
  const originalJsonLength = file.readUInt32LE(12)
  const document = JSON.parse(file.subarray(20, 20 + originalJsonLength).toString())
  // Node has no image decoder. Remove only texture references in memory; keep
  // the actual model's geometry, materials, hierarchy and transforms intact.
  for (const material of document.materials) delete material.pbrMetallicRoughness?.baseColorTexture
  delete document.textures
  delete document.images
  const json = Buffer.from(JSON.stringify(document))
  const paddedLength = Math.ceil(json.length / 4) * 4
  const remainingChunks = file.subarray(20 + originalJsonLength)
  const glb = Buffer.alloc(20 + paddedLength + remainingChunks.length)
  file.copy(glb, 0, 0, 20)
  glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(paddedLength, 12)
  glb.fill(0x20, 20, 20 + paddedLength)
  json.copy(glb, 20)
  remainingChunks.copy(glb, 20 + paddedLength)
  return (await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '')).scene
}

const source = await loadAuthoredGeometry()

function close(actual, expected, message, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: expected ${expected}, got ${actual}`)
}

test('authored Onix pivots stay centered while all four tires roll forward', () => {
  const car = prepareGlbScene(source, spec)
  const rig = createOnixWheelRig(car, spec)
  assert.ok(rig)
  close(rig.radiusMeters, 0.315, 'normalised tire radius in metres', 0.0001)

  const wheels = names.map((name) => {
    const pivot = car.getObjectByName(name)
    assert.ok(pivot, name)
    const center = pivot.getWorldPosition(new Vector3())
    return {
      pivot,
      center,
      position: pivot.position.clone(),
      authored: pivot.quaternion.clone(),
      topPoint: pivot.worldToLocal(center.clone().add(new Vector3(0, rig.radiusMeters, 0))),
    }
  })
  rig.advance(rig.radiusMeters * Math.PI / 2)
  car.updateMatrixWorld(true)

  wheels.forEach(({ pivot, center, position, authored, topPoint }, index) => {
    close(pivot.getWorldPosition(new Vector3()).distanceTo(center), 0, 'wheel center is stationary')
    assert.deepEqual(pivot.position, position, 'authored pivot translation is untouched')
    const movedTop = pivot.localToWorld(topPoint)
    close(movedTop.x - center.x, rig.radiusMeters, 'top of tire moves toward vehicle front', 0.0002)
    close(movedTop.y, center.y, 'quarter-turn ends at axle height', 0.0002)
    const relative = authored.invert().multiply(pivot.quaternion)
    assert.equal(Math.sign(relative.x), index < 2 ? -1 : 1, 'mirrored axles use opposite local signs')
  })
})

test('rolling a clone preserves cached model transforms, geometry, materials and other instances', () => {
  const car = prepareGlbScene(source, spec)
  const other = prepareGlbScene(source, spec)
  const before = []
  source.traverse((object) => {
    before.push({
      object,
      position: object.position.clone(),
      rotation: object.quaternion.clone(),
      scale: object.scale.clone(),
      geometry: object.geometry,
      material: object.material,
    })
  })
  const otherRotations = names.map((name) => other.getObjectByName(name).quaternion.clone())
  createOnixWheelRig(car, spec).advance(1.1)
  for (const snapshot of before) {
    assert.deepEqual(snapshot.object.position, snapshot.position)
    assert.deepEqual(snapshot.object.quaternion.toArray(), snapshot.rotation.toArray())
    assert.deepEqual(snapshot.object.scale, snapshot.scale)
    assert.equal(snapshot.object.geometry, snapshot.geometry)
    assert.equal(snapshot.object.material, snapshot.material)
    if (snapshot.geometry) {
      const clonedMesh = car.getObjectByName(snapshot.object.name)
      assert.equal(clonedMesh.geometry, snapshot.geometry, 'geometry remains shared')
      assert.equal(clonedMesh.material, snapshot.material, 'authored material remains shared')
    }
  }
  names.forEach((name, index) => {
    assert.deepEqual(other.getObjectByName(name).quaternion.toArray(), otherRotations[index].toArray())
  })
})

test('wheel radius follows uniform asset length and travel is independent of frame rate', () => {
  const first = prepareGlbScene(source, spec)
  const second = prepareGlbScene(source, spec)
  const firstRig = createOnixWheelRig(first, spec)
  const secondRig = createOnixWheelRig(second, spec)
  firstRig.advance(1.1)
  for (let frame = 0; frame < 60; frame++) secondRig.advance(1.1 / 60)
  names.forEach((name) => {
    close(first.getObjectByName(name).quaternion.angleTo(second.getObjectByName(name).quaternion), 0, 'same travel yields same roll')
  })

  const largerSpec = { ...spec, length: spec.length * 1.1 }
  const largerRig = createOnixWheelRig(prepareGlbScene(source, largerSpec), largerSpec)
  close(largerRig.radiusMeters / firstRig.radiusMeters, 1.1, 'radius tracks model size')
  firstRig.advance(-1.1)
  names.forEach((name) => {
    close(first.getObjectByName(name).quaternion.angleTo(source.getObjectByName(name).quaternion), 0, 'reversed travel restores authored orientation')
  })
})

test('unrecognized or incomplete assets remain static and invalid travel is ignored', () => {
  const car = prepareGlbScene(source, spec)
  assert.equal(createOnixWheelRig(car, { ...spec, source: 'another model' }), null)
  assert.equal(createOnixWheelRig(car, { ...spec, url: '/models/another-onix.glb' }), null)
  assert.equal(createOnixWheelRig(new Group(), spec), null)
  const incomplete = prepareGlbScene(source, spec)
  incomplete.getObjectByName(names[3]).removeFromParent()
  assert.equal(createOnixWheelRig(incomplete, spec), null)

  const rig = createOnixWheelRig(car, spec)
  for (const distance of [0, NaN, Infinity, -Infinity]) rig.advance(distance)
  names.forEach((name) => {
    const original = source.getObjectByName(name).quaternion
    assert.ok(car.getObjectByName(name).quaternion.equals(new Quaternion().copy(original)))
  })
})
