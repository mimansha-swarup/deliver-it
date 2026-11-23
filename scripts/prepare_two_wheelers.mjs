#!/usr/bin/env node
/**
 * Bakes the traffic's two-wheelers into public/models/two-wheelers.glb, from models the game
 * already has: the Vega 150 (models/tripo.glb, made with Tripo AI on a commercial plan) as `bike`,
 * and the step-through scooter (models/fleet.glb, "Vespa scooty", CC BY 4.0) as `moped`.
 *
 *     node scripts/prepare_two_wheelers.mjs
 *
 * Those two files hold each vehicle cut up for the rider to drive (a body, a steering front, a
 * wheel each, lamps), at 15,000 to 20,000 triangles. Traffic draws dozens, so each is put back
 * together here as the traffic's format wants it (scripts/prepare_traffic_models.mjs):
 *
 *   <name>            the body and front as one shape, simplified to 7,000 triangles
 *   <name>-far        the same under 600, for beyond the detail distance
 *   <name>-wheel      one wheel, about its own middle (the game puts one on each axle and spins it)
 *   <name>-wheel-far
 *
 * Each is moved and sized so the traffic's seated rider (Traffic.tsx's COMMUTER_SEAT: hips at
 * 0.9 m up and 0.3 m behind the middle) sits on its seat with hands on its bars. The file is
 * written already Meshopt-compressed, as scripts/compress_models.mjs would leave it.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const MODELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

/** Linear colours for the lamps' lenses, which the source files keep as separate shapes with no colour of their own. */
const HEAD_LENS = [0.72, 0.7, 0.6]
const TAIL_LENS = [0.11, 0.005, 0.005]

const VEHICLES = [
  // `scale` sizes the whole vehicle; `shift` then moves it (x, y, z) so its seat is under the rider's hips.
  { name: 'bike', file: 'tripo.glb', source: 'vega', triangles: 7000, far: 560, scale: 1, shift: [0, 0, 0] },
  { name: 'moped', file: 'fleet.glb', source: 'scooty', triangles: 7000, far: 560, scale: 1.04, shift: [0, 0, 0] },
]
const ATTRIBUTES = ['POSITION', 'NORMAL', 'COLOR_0', '_LIMB', '_PAINT']

/** A shape as plain arrays, one entry per corner (no index), with every attribute the game reads. */
function read(document, name, lens) {
  const node = document.getRoot().listNodes().find((candidate) => candidate.getName() === name)
  if (!node) return null
  const out = { POSITION: [], NORMAL: [], COLOR_0: [], _LIMB: [], _PAINT: [] }
  for (const primitive of node.getMesh().listPrimitives()) {
    const position = primitive.getAttribute('POSITION')
    const index = primitive.getIndices()
    const count = index ? index.getCount() : position.getCount()
    for (let corner = 0; corner < count; corner++) {
      const vertex = index ? index.getScalar(corner) : corner
      for (const semantic of ATTRIBUTES) {
        const accessor = primitive.getAttribute(semantic)
        const size = semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'COLOR_0' ? 3 : 1
        if (semantic === 'COLOR_0' && lens) out.COLOR_0.push(...lens)
        else if (!accessor) out[semantic].push(...new Array(size).fill(semantic === 'COLOR_0' ? 0.5 : 0))
        else out[semantic].push(...accessor.getElement(vertex, []).slice(0, size))
      }
    }
  }
  return out
}

function join_(parts) {
  const out = { POSITION: [], NORMAL: [], COLOR_0: [], _LIMB: [], _PAINT: [] }
  for (const part of parts) if (part) for (const semantic of ATTRIBUTES) for (const value of part[semantic]) out[semantic].push(value)
  return out
}

/** Corners that are the same in every attribute become one, so the simplifier sees a joined surface. */
function weld(shape) {
  const count = shape.POSITION.length / 3
  const seen = new Map()
  const indices = new Uint32Array(count)
  const kept = []
  for (let corner = 0; corner < count; corner++) {
    const key = [
      ...shape.POSITION.slice(corner * 3, corner * 3 + 3).map((v) => Math.round(v * 20000)),
      ...shape.NORMAL.slice(corner * 3, corner * 3 + 3).map((v) => Math.round(v * 50)),
      ...shape.COLOR_0.slice(corner * 3, corner * 3 + 3).map((v) => Math.round(v * 200)),
      Math.round(shape._PAINT[corner]),
    ].join(',')
    let at = seen.get(key)
    if (at === undefined) {
      at = kept.length
      seen.set(key, at)
      kept.push(corner)
    }
    indices[corner] = at
  }
  const vertices = {}
  for (const semantic of ATTRIBUTES) {
    const size = shape[semantic].length / count
    vertices[semantic] = new Float32Array(kept.length * size)
    kept.forEach((corner, at) => {
      for (let part = 0; part < size; part++) vertices[semantic][at * size + part] = shape[semantic][corner * size + part]
    })
  }
  return { indices, vertices }
}

/** Simplified to about `target` triangles: by shape, colour and the paint's edge; then, if that stops short, without regard to surface joins. */
function simplify({ indices, vertices }, target) {
  const count = vertices.POSITION.length / 3
  if (indices.length / 3 <= target) return { indices, vertices }
  // Colour (three numbers) and paint (one) are what the simplifier weighs beside the shape.
  const attributes = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    attributes.set(vertices.COLOR_0.subarray(i * 3, i * 3 + 3), i * 4)
    attributes[i * 4 + 3] = vertices._PAINT[i]
  }
  let [result] = MeshoptSimplifier.simplifyWithAttributes(indices, vertices.POSITION, 3, attributes, 4, [0.4, 0.4, 0.4, 2], null, target * 3, 0.03)
  if (result.length / 3 > target * 1.3) [result] = MeshoptSimplifier.simplify(indices, vertices.POSITION, 3, target * 3, 0.08, ['Permissive'])
  if (result.length / 3 > target * 1.5) [result] = MeshoptSimplifier.simplifySloppy(indices, vertices.POSITION, 3, null, target * 3, 0.2)
  // Only the corners still used are written.
  const remap = new Map()
  const used = []
  const compact = new Uint32Array(result.length)
  result.forEach((vertex, i) => {
    let at = remap.get(vertex)
    if (at === undefined) {
      at = used.length
      remap.set(vertex, at)
      used.push(vertex)
    }
    compact[i] = at
  })
  const out = {}
  for (const semantic of ATTRIBUTES) {
    const size = vertices[semantic].length / count
    out[semantic] = new Float32Array(used.length * size)
    used.forEach((vertex, at) => out[semantic].set(vertices[semantic].subarray(vertex * size, vertex * size + size), at * size))
  }
  return { indices: compact, vertices: out }
}

function moved(shape, scale, [dx, dy, dz]) {
  const position = shape.POSITION
  for (let i = 0; i < position.length; i += 3) {
    position[i] = position[i] * scale + dx
    position[i + 1] = position[i + 1] * scale + dy
    position[i + 2] = position[i + 2] * scale + dz
  }
  return shape
}

function bounds(position) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < position.length; i++) {
    min[i % 3] = Math.min(min[i % 3], position[i])
    max[i % 3] = Math.max(max[i % 3], position[i])
  }
  return { min, max }
}

const output = new Document()
const buffer = output.createBuffer()
const scene = output.createScene('two-wheelers')
function write(name, { indices, vertices }, extras = {}) {
  const primitive = output.createPrimitive().setIndices(output.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
  for (const semantic of ATTRIBUTES) {
    const size = vertices[semantic].length / (vertices.POSITION.length / 3)
    primitive.setAttribute(semantic, output.createAccessor().setType(size === 3 ? 'VEC3' : 'SCALAR').setArray(vertices[semantic]).setBuffer(buffer))
  }
  scene.addChild(output.createNode(name).setMesh(output.createMesh(name).addPrimitive(primitive)).setExtras(extras))
  console.log(`  ${name}: ${indices.length / 3} triangles`)
}

for (const { name, file, source, triangles, far, scale, shift } of VEHICLES) {
  const document = await io.read(join(MODELS, file))
  const extras = document.getRoot().listNodes().find((node) => node.getName() === source).getExtras()
  console.log(`${name} from ${file}'s ${source}`)
  const whole = moved(join_([read(document, source), read(document, `${source}-front`), read(document, `${source}-head`, HEAD_LENS), read(document, `${source}-tail`, TAIL_LENS)]), scale, shift)
  const box = bounds(whole.POSITION)
  console.log('  size', box.min.map((v) => +v.toFixed(2)), box.max.map((v) => +v.toFixed(2)))
  const welded = weld(whole)
  // The rear wheel serves both axles: about its own middle, as the source has it.
  const wheel = weld(moved(read(document, `${source}-wheel-0`), scale, [0, 0, 0]))
  const wheelBox = bounds(wheel.vertices.POSITION)
  const wheelRadius = (wheelBox.max[1] - wheelBox.min[1]) / 2
  const wheelPositions = extras.wheels
    .map(({ at }) => [at[0] * scale + shift[0], wheelRadius, at[2] * scale + shift[2]])
    .sort((a, b) => b[2] - a[2])
  write(name, simplify(welded, triangles), { wheelModel: name, wheelRadius, wheelPositions })
  write(`${name}-far`, simplify(welded, far))
  write(`${name}-wheel`, simplify(wheel, 700), { wheelRadius })
  write(`${name}-wheel-far`, simplify(wheel, 56), { wheelRadius })
}

output.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
await io.write(join(MODELS, 'two-wheelers.glb'), output)
console.log('wrote public/models/two-wheelers.glb')
