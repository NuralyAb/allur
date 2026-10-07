#!/usr/bin/env node
/** Preserve the inspected Cobalt's overlapping paint/trim panels at sub-millimetre error. */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, simplifyPrimitive, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { resolve } from 'node:path'

const [input, output, mode = 'detail'] = process.argv.slice(2)
if (!input || !output || resolve(input) === resolve(output) || !['detail', 'lod'].includes(mode)) throw new Error('Usage: optimize-cobalt.mjs cleaned-input.glb separate-output.glb [detail|lod]')
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const document = await io.read(input)
await document.transform(dedup(), prune(), weld())
const stats = {}
for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const material = primitive.getMaterial()?.getName() ?? ''
  const name = mesh.getName()
  const sensitive = material === 'Realistic_Car_Paint' || /^(chassis|door_|interior_1|windscreen)/i.test(name)
  const category = sensitive ? 'panels' : /^(roda|wheel)/i.test(name) ? 'wheels' : 'details'
  const before = primitive.getIndices().getCount() / 3
  const ratio = mode === 'lod' ? (sensitive ? 0.055 : 0.025) : sensitive ? 0.18 : 0.05
  const error = mode === 'lod' ? (sensitive ? 0.0005 : 0.01) : sensitive ? 0.00008 : 0.003
  simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: sensitive })
  const after = primitive.getIndices().getCount() / 3
  stats[category] ??= { before: 0, after: 0 }
  stats[category].before += before; stats[category].after += after
}
await document.transform(prune())
await io.write(output, document)
const rendered = document.getRoot().listNodes().reduce((sum, node) => sum + (node.getMesh()?.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0) ?? 0), 0)
console.log(JSON.stringify({ output, mode, stats, renderedTriangles: rendered }))
