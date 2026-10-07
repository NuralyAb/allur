#!/usr/bin/env node
// Offline preparation: retain authored nodes/materials while removing redundant
// vertices. Never overwrites the downloaded original or normalizes its identity.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { resolve } from 'node:path'

const [input, output, ratioArg = '0.1', errorArg = '0.002', mode = 'detail'] = process.argv.slice(2)
if (!input || !output || resolve(input) === resolve(output)) throw new Error('Usage: optimize-vehicle.mjs input.glb output.glb [ratio] [error]; use a separate output.')
const ratio = Number(ratioArg), error = Number(errorArg)
if (!(ratio > 0 && ratio <= 1 && error > 0 && error <= 0.1)) throw new Error('Invalid simplification ratio/error.')
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(input)
const triangles = () => doc.getRoot().listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)
const before = triangles()
const simplifier = mode === 'lod' ? {
  ...MeshoptSimplifier,
  simplify: (indices, positions, stride, target, limit, flags = []) => MeshoptSimplifier.simplify(indices, positions, stride, target, limit, [...flags, 'Permissive']),
} : MeshoptSimplifier
await doc.transform(dedup(), weld(), simplify({ simplifier, ratio, error }), prune())
await io.write(output, doc)
console.log(JSON.stringify({ input, output, trianglesBefore: before, trianglesAfter: triangles(), ratio, error }))
