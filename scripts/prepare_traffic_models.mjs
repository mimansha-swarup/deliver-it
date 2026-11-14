#!/usr/bin/env node
/**
 * Bakes the downloaded cars, auto and people into one small file,
 * public/models/traffic.glb. The originals total about 5 million triangles.
 * The game draws each of these many times, so each must be a few thousand.
 *
 *     node scripts/prepare_traffic_models.mjs <folder of unzipped models>
 *
 * Each model is flattened into one mesh with no textures: colour is sampled from
 * the texture onto each corner, which also removes printed badges. Interiors go,
 * and people are posed with their arms down and told which limb each corner is on.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptSimplifier } from 'meshoptimizer'
import * as THREE from 'three'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEXTURE_SAMPLE_SIZE = 256
const GLASS = [0.018, 0.028, 0.036]
/** Paint is stored white, so each vehicle's own colour comes through exactly. */
const WHITE = [1, 1, 1]
const BOX_WHITE = [0.82, 0.82, 0.8]
/** How far the simplified shape may drift, as a share of the model's size. */
const MAX_SHAPE_ERROR = 0.02
/** Faces meeting at more than this angle, in radians, keep a crisp edge between them. See `smoothNormals`. */
const CREASE = (50 * Math.PI) / 180

/*
 * Cars are wrapped on a fine grid (about 2 cm) and kept at 24,000 to 28,000 triangles. On a 3.5 cm
 * grid at half that, door lines, lights and the grille smeared away and the panels looked dented.
 */
const VEHICLES = [
  {
    name: 'sedan',
    folder: '2022_maruti_suzuki_swift_dzire',
    length: 4.2,
    triangles: 28000,
    wrapCell: 0.021,
    dropMaterial: /seats_|speedometer|sidewall/,
    dropNode: /^(movsteer|seats_|sidewall|dashboard|speedometer)/,
    wheelNode: /^wheel_rf(\.\d+)?$/,
  },
  {
    name: 'hatchback',
    folder: '2020_maruti_suzuki_alto_800',
    length: 3.6,
    triangles: 24000,
    wrapCell: 0.018,
    dropMaterial: /seat|^dash|^mate|steering|dore2/,
    dropNode: /^(dash|mate|steering)/,
    wheelNode: /^wheel(\.\d+)?$/,
  },
  {
    name: 'suv',
    folder: '2022_mahindra_scorpio-n',
    length: 4.6,
    triangles: 28000,
    wrapCell: 0.021,
    dropMaterial: /_int_|sunroof_m/,
    dropNode: /^movsteer/,
    wheelNode: /^wheel_rf(\.\d+)?$/,
  },
  {
    name: 'mpv',
    folder: 'renault_triber',
    length: 4,
    triangles: 28000,
    wrapCell: 0.021,
    dropMaterial: /seat|^dash|^int\.|roof_int|misc|glossy|^mate|^sell/,
    dropNode: /^(int|prtseat|dashmax|roof int|seat\d|mate)\b/,
    wheelNode: /^wheels$/,
  },
  {
    // The player's own bike. Its front end is kept apart, so that it can steer.
    name: 'delivery',
    folder: 'checkers_sixty60_bike',
    length: 1.9,
    triangles: 7000,
    wrapCell: 0.012,
    reverse: true,
    // Plain black and white replace its blue, and its number plate goes.
    dropMaterial: /License_/,
    dropNode: /^Text$/,
    wheelNode: /^(Front|Back) Brake Disc$/,
    steerNode: /^Controls$/,
    paintMaterial: /^Shiny_Blue$/,
    whiteNode: /^Box$/,
    singleTrack: true,
  },
  {
    // Kept in its own file, as its licence differs from everything else here.
    name: 'bike',
    file: 'yamaha.glb',
    folder: 'yamaha_yzf_2021',
    reverse: true,
    length: 1.95,
    triangles: 7000,
    wrapCell: 0.012,
    wheelJoint: /^(wheel_l[rf]|wheel_[lr][fr])/,
    wheelMaterial: /wheel_map/,
    paintMaterial: /^Material\.004$/,
    singleTrack: true,
  },
  {
    name: 'auto',
    folder: 'autorikshaw_-_indian_tuk_tuk',
    length: 2.6,
    triangles: 5000,
    noPaint: true,
    // It has no named lights to tell its front by, so this is set by hand.
    reverse: true,
    // It's one solid piece, so holes are cut for wheels borrowed from the hatchback.
    cutWheels: {
      borrow: 'hatchback',
      radius: 0.205,
      halfWidth: 0.1,
      // Measured from where each tyre touches the ground.
      positions: [[0.533, 0.205, -0.71], [-0.533, 0.205, -0.71], [0, 0.205, 1.14]],
    },
  },
]

const PEOPLE = [
  {
    name: 'man',
    // A man in a kurta and pyjama. He replaced the man in the dhoti, whose dhoti was a huge sheet
    // reaching his shoulders, with no legs under it, and whose skeleton was 1.6 times his size.
    folder: 'indian_male_character',
    height: 1.72,
    // His face and hands need a few more triangles than the others to read at all.
    triangles: 4500,
    // Only his kurta takes each person's colour. Its border and his pyjama keep theirs.
    clothes: /^Kurta$/,
    dropMaterial: /teeth|cornea/,
    rig: 'rigify',
    // His hair has no colour in the file, so it would come out white. Linear colour, near black.
    colors: { Hairs: [0.012, 0.01, 0.008] },
  },
  {
    name: 'teen',
    folder: 'indian_teenager',
    height: 1.66,
    triangles: 3500,
    clothes: /outfit_top/,
    dropMaterial: /Teeth|Cornea|Eyelashes/,
  },
]

const COMPONENT_READERS = {
  5120: (view, at) => view.getInt8(at),
  5121: (view, at) => view.getUint8(at),
  5122: (view, at) => view.getInt16(at, true),
  5123: (view, at) => view.getUint16(at, true),
  5125: (view, at) => view.getUint32(at, true),
  5126: (view, at) => view.getFloat32(at, true),
}
const COMPONENT_SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NORMALIZERS = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

function readAccessor(model, index) {
  const accessor = model.gltf.accessors[index]
  const bufferView = model.gltf.bufferViews[accessor.bufferView]
  const size = TYPE_COUNTS[accessor.type]
  const width = COMPONENT_SIZES[accessor.componentType]
  const stride = bufferView.byteStride ?? size * width
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const read = COMPONENT_READERS[accessor.componentType]
  const scale = accessor.normalized ? NORMALIZERS[accessor.componentType] : 1
  const values = new Float64Array(accessor.count * size)

  for (let item = 0; item < accessor.count; item++) {
    for (let part = 0; part < size; part++) {
      values[item * size + part] = read(model.view, start + item * stride + part * width) / scale
    }
  }
  return values
}

function loadModel(folder) {
  const gltf = JSON.parse(readFileSync(join(folder, 'scene.gltf'), 'utf8'))
  const bin = readFileSync(join(folder, gltf.buffers[0].uri))
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const model = { gltf, view, folder, images: new Map(), world: [], parents: [] }

  const visit = (index, parent) => {
    const node = gltf.nodes[index]
    const local = new THREE.Matrix4()
    if (node.matrix) local.fromArray(node.matrix)
    else {
      local.compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
      )
    }
    model.world[index] = parent === undefined ? local : model.world[parent].clone().multiply(local)
    model.parents[index] = parent
    for (const child of node.children ?? []) visit(child, index)
  }
  for (const root of gltf.scenes[0].nodes) visit(root)
  return model
}

/** Reads a BMP that `sips` made. There's no image library here, and this is all it needs. */
function decodeBmp(file) {
  const data = readFileSync(file)
  const offset = data.readUInt32LE(10)
  const width = data.readInt32LE(18)
  const height = Math.abs(data.readInt32LE(22))
  const bottomUp = data.readInt32LE(22) > 0
  const bytes = data.readUInt16LE(28) / 8
  const rowSize = Math.ceil((width * bytes) / 4) * 4

  return (u, v) => {
    const x = Math.min(width - 1, Math.floor(((u % 1) + 1) % 1 * width))
    const y = Math.min(height - 1, Math.floor(((v % 1) + 1) % 1 * height))
    const row = bottomUp ? height - 1 - y : y
    const at = offset + row * rowSize + x * bytes
    // Greyscale images hold one number for each pixel.
    if (bytes < 3) return [data[at] / 255, data[at] / 255, data[at] / 255]
    return [data[at + 2] / 255, data[at + 1] / 255, data[at] / 255]
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'traffic-models-'))
let imageCount = 0

function getSampler(model, material) {
  const slot = material.pbrMetallicRoughness?.baseColorTexture
  if (!slot) return null

  const source = model.gltf.textures[slot.index].source
  if (!model.images.has(source)) {
    const target = join(scratch, `${imageCount++}.bmp`)
    execFileSync('sips', [
      '-Z', String(TEXTURE_SAMPLE_SIZE), '-s', 'format', 'bmp',
      join(model.folder, decodeURIComponent(model.gltf.images[source].uri)), '--out', target,
    ], { stdio: 'ignore' })
    model.images.set(source, decodeBmp(target))
  }
  return model.images.get(source)
}

const toLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

/** One colour for a whole material. This is what wipes out badges printed on a texture. */
function averageColor(sampler, uvs, tint) {
  const total = [0, 0, 0]
  const count = uvs.length / 2
  for (let corner = 0; corner < count; corner++) {
    const sample = sampler(uvs[corner * 2], uvs[corner * 2 + 1])
    for (let part = 0; part < 3; part++) total[part] += toLinear(sample[part]) * tint[part]
  }
  return total.map((value) => value / count)
}

/** A soup of corners, gathered from every part of a model. */
class Soup {
  positions = []
  normals = []
  colors = []
  limbs = []
  paints = []
  indices = []

  get count() {
    return this.paints.length
  }
}

function addPrimitive(model, soup, primitive, matrixOf, describe) {
  const material = model.gltf.materials[primitive.material]
  const positions = readAccessor(model, primitive.attributes.POSITION)
  const normals = readAccessor(model, primitive.attributes.NORMAL)
  const uvs = primitive.attributes.TEXCOORD_0 === undefined
    ? null
    : readAccessor(model, primitive.attributes.TEXCOORD_0)
  const indices = readAccessor(model, primitive.indices)
  const sampler = getSampler(model, material)
  const tint = material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]
  const first = soup.count
  const { color: fixedColor, paint, flat } = describe(material.name)
  const color = fixedColor ?? (flat && sampler && uvs ? averageColor(sampler, uvs, tint) : null)

  const position = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3()

  for (let corner = 0; corner < positions.length / 3; corner++) {
    const matrix = matrixOf(corner)
    position.fromArray(positions, corner * 3).applyMatrix4(matrix)
    normal.fromArray(normals, corner * 3)
      .applyMatrix3(normalMatrix.getNormalMatrix(matrix))
      .normalize()
    soup.positions.push(position.x, position.y, position.z)
    soup.normals.push(normal.x, normal.y, normal.z)

    let rgb = color ?? [tint[0], tint[1], tint[2]]
    if (!color && sampler && uvs) {
      const sample = sampler(uvs[corner * 2], uvs[corner * 2 + 1])
      rgb = sample.map((value, part) => toLinear(value) * tint[part])
    }
    // A few texture formats can't be read here, and mid grey is a safe stand-in.
    soup.colors.push(...rgb.map((value) => (Number.isFinite(value) ? value : 0.3)))
    soup.paints.push(paint ? 1 : 0)
    soup.limbs.push(0, 0, 0)
  }

  const flipped = matrixOf(0).determinant() < 0
  for (let at = 0; at < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]]
    soup.indices.push(first + a, first + (flipped ? c : b), first + (flipped ? b : c))
  }
  return first
}

/** Joins corners at the same spot, so the simplifier sees one surface and not loose triangles. */
function weld(soup) {
  const seen = new Map()
  const remap = new Int32Array(soup.count)
  const welded = new Soup()

  for (let corner = 0; corner < soup.count; corner++) {
    const p = corner * 3
    const key = [
      Math.round(soup.positions[p] * 500),
      Math.round(soup.positions[p + 1] * 500),
      Math.round(soup.positions[p + 2] * 500),
      Math.round(soup.colors[p] * 24),
      Math.round(soup.colors[p + 1] * 24),
      Math.round(soup.colors[p + 2] * 24),
      soup.paints[corner],
    ].join()

    let target = seen.get(key)
    if (target === undefined) {
      target = welded.count
      seen.set(key, target)
      for (const field of ['positions', 'normals', 'colors', 'limbs']) {
        welded[field].push(soup[field][p], soup[field][p + 1], soup[field][p + 2])
      }
      welded.paints.push(soup.paints[corner])
    } else {
      // Joined corners share a normal, which is the average of what they each had.
      for (let part = 0; part < 3; part++) welded.normals[target * 3 + part] += soup.normals[p + part]
    }
    remap[corner] = target
  }

  const normal = new THREE.Vector3()
  for (let corner = 0; corner < welded.count; corner++) {
    normal.fromArray(welded.normals, corner * 3).normalize().toArray(welded.normals, corner * 3)
  }

  welded.indices = soup.indices.map((index) => remap[index])
  return welded
}

function closestOnTriangle(p, a, b, c, out) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  let v = 0
  let w = 0

  if (d1 > 0 || d2 > 0) {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]]
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
    const d3 = dot(ab, bp)
    const d4 = dot(ac, bp)
    const d5 = dot(ab, cp)
    const d6 = dot(ac, cp)
    const vc = d1 * d4 - d3 * d2
    const vb = d5 * d2 - d1 * d6
    const va = d3 * d6 - d5 * d4

    if (d3 >= 0 && d4 <= d3) v = 1
    else if (d6 >= 0 && d5 <= d6) w = 1
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3)
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6)
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      w = (d4 - d3) / (d4 - d3 + (d5 - d6))
      v = 1 - w
    } else {
      const total = 1 / (va + vb + vc)
      v = vb * total
      w = vc * total
    }
  }

  out[0] = 1 - v - w
  out[1] = v
  out[2] = w
  const x = a[0] + ab[0] * v + ac[0] * w - p[0]
  const y = a[1] + ab[1] * v + ac[1] * w - p[1]
  const z = a[2] + ab[2] * v + ac[2] * w - p[2]
  return x * x + y * y + z * z
}

/**
 * Rebuilds a model as one clean outer skin. It marks every small cell the model
 * touches, floods in from outside to find what's truly outdoors, and makes a
 * surface around the rest, so interiors and overlapping panels simply vanish.
 * Then each corner of that skin snaps back onto the original shape and takes
 * its colour from there. Messy meshes simplify badly, and this one won't be messy.
 */
function shrinkWrap(soup, cell) {
  const box = getBounds(soup)
  const padding = 3
  const origin = box.min.toArray().map((value) => value - padding * cell)
  const size = box.getSize(new THREE.Vector3()).toArray()
  const [nx, ny, nz] = size.map((value) => Math.ceil(value / cell) + padding * 2)
  const at = (i, j, k) => i + nx * (j + ny * k)
  const touched = new Uint8Array(nx * ny * nz)
  const lists = new Map()

  const triangleCount = soup.indices.length / 3
  const cornerOf = (triangle, corner) => {
    const index = soup.indices[triangle * 3 + corner] * 3
    return [soup.positions[index], soup.positions[index + 1], soup.positions[index + 2]]
  }

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = cornerOf(triangle, 0)
    const b = cornerOf(triangle, 1)
    const c = cornerOf(triangle, 2)
    const longest = Math.max(
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
      Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]),
      Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]),
    )
    const steps = Math.max(1, Math.ceil(longest / (cell * 0.5)))
    let previous = -1

    for (let s1 = 0; s1 <= steps; s1++) {
      for (let s2 = 0; s2 <= steps - s1; s2++) {
        const u = s1 / steps
        const v = s2 / steps
        const w = 1 - u - v
        const key = at(
          Math.floor((a[0] * w + b[0] * u + c[0] * v - origin[0]) / cell),
          Math.floor((a[1] * w + b[1] * u + c[1] * v - origin[1]) / cell),
          Math.floor((a[2] * w + b[2] * u + c[2] * v - origin[2]) / cell),
        )
        if (key === previous) continue
        previous = key
        touched[key] = 1
        const list = lists.get(key)
        if (!list) lists.set(key, [triangle])
        else if (list[list.length - 1] !== triangle) list.push(triangle)
      }
    }
  }

  // Thicken the walls for the flood, so it can't leak through a gap between panels.
  const thick = touched.slice()
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        if (!touched[at(i, j, k)]) continue
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          thick[at(i + di, j + dj, k + dk)] = 1
        }
      }
    }
  }

  const outside = new Uint8Array(nx * ny * nz)
  const stack = [at(0, 0, 0)]
  outside[stack[0]] = 1
  while (stack.length) {
    const key = stack.pop()
    const i = key % nx
    const j = Math.floor(key / nx) % ny
    const k = Math.floor(key / (nx * ny))
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const ni = i + di
      const nj = j + dj
      const nk = k + dk
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue
      const next = at(ni, nj, nk)
      if (outside[next] || thick[next]) continue
      outside[next] = 1
      stack.push(next)
    }
  }

  // Taking the extra thickness back off leaves the skin where the walls really are.
  const solid = new Uint8Array(nx * ny * nz)
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const key = at(i, j, k)
        if (outside[key]) continue
        const nearOutside = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
          .some(([di, dj, dk]) => outside[at(i + di, j + dj, k + dk)])
        solid[key] = nearOutside && !touched[key] ? 0 : 1
      }
    }
  }

  // One corner in each cell the surface passes through, then faces between them.
  const skin = new Soup()
  const vertexOf = new Int32Array(nx * ny * nz).fill(-1)
  const outward = []

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let filled = 0
        const push = [0, 0, 0]
        for (let corner = 0; corner < 8; corner++) {
          const dx = corner & 1
          const dy = (corner >> 1) & 1
          const dz = (corner >> 2) & 1
          if (solid[at(i + dx, j + dy, k + dz)]) {
            filled++
            push[0] -= dx * 2 - 1
            push[1] -= dy * 2 - 1
            push[2] -= dz * 2 - 1
          }
        }
        if (filled === 0 || filled === 8) continue

        vertexOf[at(i, j, k)] = skin.count
        skin.positions.push(
          origin[0] + (i + 1) * cell,
          origin[1] + (j + 1) * cell,
          origin[2] + (k + 1) * cell,
        )
        skin.normals.push(0, 1, 0)
        skin.colors.push(0, 0, 0)
        skin.limbs.push(0, 0, 0)
        skin.paints.push(0)
        outward.push(push)
      }
    }
  }

  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) skin.indices.push(a, c, b, a, d, c)
    else skin.indices.push(a, b, c, a, c, d)
  }

  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const here = solid[at(i, j, k)]
        const v = (di, dj, dk) => vertexOf[at(i + di, j + dj, k + dk)]
        if (here !== solid[at(i + 1, j, k)]) {
          quad(v(0, -1, -1), v(0, 0, -1), v(0, 0, 0), v(0, -1, 0), !here)
        }
        if (here !== solid[at(i, j + 1, k)]) {
          quad(v(-1, 0, -1), v(-1, 0, 0), v(0, 0, 0), v(0, 0, -1), !here)
        }
        if (here !== solid[at(i, j, k + 1)]) {
          quad(v(-1, -1, 0), v(0, -1, 0), v(0, 0, 0), v(-1, 0, 0), !here)
        }
      }
    }
  }

  // Snap each corner onto the nearest original surface that faces outwards.
  const reach = 3
  const weights = [0, 0, 0]
  const best = [0, 0, 0]

  for (let corner = 0; corner < skin.count; corner++) {
    const point = skin.positions.slice(corner * 3, corner * 3 + 3)
    const direction = new THREE.Vector3(...outward[corner]).normalize()
    const ci = Math.floor((point[0] - origin[0]) / cell)
    const cj = Math.floor((point[1] - origin[1]) / cell)
    const ck = Math.floor((point[2] - origin[2]) / cell)
    const seen = new Set()
    let bestScore = Infinity
    let bestTriangle = -1

    for (let dk = -reach; dk <= reach; dk++) {
      for (let dj = -reach; dj <= reach; dj++) {
        for (let di = -reach; di <= reach; di++) {
          const ni = ci + di
          const nj = cj + dj
          const nk = ck + dk
          if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue
          for (const triangle of lists.get(at(ni, nj, nk)) ?? []) {
            if (seen.has(triangle)) continue
            seen.add(triangle)

            const squared = closestOnTriangle(
              point,
              cornerOf(triangle, 0),
              cornerOf(triangle, 1),
              cornerOf(triangle, 2),
              weights,
            )
            const first = soup.indices[triangle * 3] * 3
            const facing =
              soup.normals[first] * direction.x +
              soup.normals[first + 1] * direction.y +
              soup.normals[first + 2] * direction.z
            // Paint is a thin coat over darker panels, so it wins a close call.
            const isPaint = soup.paints[soup.indices[triangle * 3]] === 1
            const score = Math.sqrt(squared) + (facing < 0 ? cell * 1.5 : 0) - (isPaint ? cell * 0.7 : 0)
            if (score >= bestScore) continue
            bestScore = score
            bestTriangle = triangle
            best[0] = weights[0]
            best[1] = weights[1]
            best[2] = weights[2]
          }
        }
      }
    }

    if (bestTriangle < 0) continue

    const here = corner * 3
    const blended = { positions: [0, 0, 0], normals: [0, 0, 0], colors: [0, 0, 0], limbs: [0, 0, 0] }
    let strongest = 0
    for (let part = 0; part < 3; part++) {
      const index = soup.indices[bestTriangle * 3 + part]
      if (best[part] > best[strongest]) strongest = part
      for (const field of Object.keys(blended)) {
        for (let axis = 0; axis < 3; axis++) {
          blended[field][axis] += soup[field][index * 3 + axis] * best[part]
        }
      }
    }

    const nearest = soup.indices[bestTriangle * 3 + strongest]
    const length = Math.hypot(...blended.normals) || 1
    for (let axis = 0; axis < 3; axis++) {
      skin.positions[here + axis] = blended.positions[axis]
      skin.normals[here + axis] = blended.normals[axis] / length
      skin.colors[here + axis] = blended.colors[axis]
      // Clothing is on or off, so that one comes from the nearest corner, never a blend.
      skin.limbs[here + axis] = axis === 2 ? soup.limbs[nearest * 3 + 2] : blended.limbs[axis]
    }
    skin.paints[corner] = soup.paints[nearest]
  }

  return skin
}

/** Removes triangles until it reaches the target, keeping colours and shape where it can. */
/**
 * Works out each corner's normal again from the finished surface: the average
 * of the faces round it, weighted by their size. The shrink-wrapped skin takes
 * its normals from whichever original panel each corner snapped to, and
 * neighbouring corners can snap to different panels, which shaded a smooth
 * door as if it were dented. Faces turned further than `crease` from the
 * corner's old normal are left out, so real edges, such as a bonnet's, stay crisp.
 */
function smoothNormals(soup, crease) {
  const limit = Math.cos(crease)
  const faceNormals = []
  for (let at = 0; at < soup.indices.length; at += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromArray(soup.positions, soup.indices[at + k] * 3))
    // The cross product's length is twice the face's area, which is the weighting wanted.
    faceNormals.push(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)))
  }
  const sums = Array.from({ length: soup.count }, () => new THREE.Vector3())
  const old = new THREE.Vector3()
  const unit = new THREE.Vector3()
  for (let face = 0; face < faceNormals.length; face++) {
    unit.copy(faceNormals[face]).normalize()
    for (let k = 0; k < 3; k++) {
      const corner = soup.indices[face * 3 + k]
      old.fromArray(soup.normals, corner * 3).normalize()
      if (old.dot(unit) >= limit) sums[corner].add(faceNormals[face])
    }
  }
  sums.forEach((sum, corner) => {
    if (sum.lengthSq() > 0) sum.normalize().toArray(soup.normals, corner * 3)
  })
}

function simplify(soup, triangles) {
  const count = soup.count
  const positions = new Float32Array(soup.positions)
  const attributes = new Float32Array(count * 6)
  for (let corner = 0; corner < count; corner++) {
    attributes.set(soup.colors.slice(corner * 3, corner * 3 + 3), corner * 6)
    attributes.set(soup.normals.slice(corner * 3, corner * 3 + 3), corner * 6 + 3)
  }

  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(soup.indices),
    positions,
    3,
    attributes,
    6,
    [0.4, 0.4, 0.4, 0.08, 0.08, 0.08],
    null,
    triangles * 3,
    MAX_SHAPE_ERROR,
    ['Prune'],
  )

  const final = indices
  const finalError = error

  const used = new Map()
  const result = new Soup()
  result.indices = Array.from(final, (index) => {
    let target = used.get(index)
    if (target === undefined) {
      target = result.count
      used.set(index, target)
      for (const field of ['positions', 'normals', 'colors', 'limbs']) {
        result[field].push(...soup[field].slice(index * 3, index * 3 + 3))
      }
      result.paints.push(soup.paints[index])
    }
    return target
  })
  return { result, error: finalError }
}

function transformSoup(soup, matrix) {
  const position = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
  for (let corner = 0; corner < soup.count; corner++) {
    position.fromArray(soup.positions, corner * 3).applyMatrix4(matrix).toArray(soup.positions, corner * 3)
    normal.fromArray(soup.normals, corner * 3).applyMatrix3(normalMatrix).normalize().toArray(soup.normals, corner * 3)
  }
}

function getBounds(soup, filter = () => true) {
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  for (let corner = 0; corner < soup.count; corner++) {
    if (filter(corner)) box.expandByPoint(point.fromArray(soup.positions, corner * 3))
  }
  return box
}

const DEFAULT_FILE = 'traffic.glb'
const WHEEL_TRIANGLES = 420
const STEERED_TRIANGLES = 2500
const WHEEL_WRAP_CELL = 0.012

/** Keeps only the triangles a test accepts, as a separate soup. */
function pickTriangles(soup, test) {
  const picked = new Soup()
  const used = new Map()

  for (let at = 0; at < soup.indices.length; at += 3) {
    const corners = soup.indices.slice(at, at + 3)
    if (!test(corners)) continue

    for (const corner of corners) {
      let target = used.get(corner)
      if (target === undefined) {
        target = picked.count
        used.set(corner, target)
        for (const field of ['positions', 'normals', 'colors', 'limbs']) {
          picked[field].push(...soup[field].slice(corner * 3, corner * 3 + 3))
        }
        picked.paints.push(soup.paints[corner])
      }
      picked.indices.push(target)
    }
  }
  return picked
}

/** Finds where each wheel sits, and keeps one, centred, with its outer face towards +X. */
function extractWheel(wheels, singleTrack) {
  const positions = []
  for (const sideX of singleTrack ? [0] : [1, -1]) {
    for (const sideZ of [1, -1]) {
      const box = getBounds(wheels, (corner) =>
        wheels.positions[corner * 3] * sideX >= 0 && wheels.positions[corner * 3 + 2] * sideZ > 0,
      )
      positions.push(box.getCenter(new THREE.Vector3()).toArray())
    }
  }

  const one = pickTriangles(wheels, (corners) =>
    corners.every(
      (corner) =>
        (singleTrack || wheels.positions[corner * 3] > 0) && wheels.positions[corner * 3 + 2] > 0,
    ),
  )
  const box = getBounds(one)
  const centre = box.getCenter(new THREE.Vector3())
  transformSoup(one, new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z))
  // An axle's height is the true radius, even when a tyre's thin edge gets simplified away.
  return { soup: one, radius: Math.max(box.getSize(new THREE.Vector3()).y / 2, centre.y), positions }
}

/** Removes a solid model's own wheels, leaving arches for separate ones to sit in. */
function cutWheelHoles(soup, { positions, radius, halfWidth }) {
  const isInWheel = (corner) => {
    const [x, y, z] = soup.positions.slice(corner * 3, corner * 3 + 3)
    return positions.some(
      ([wx, wy, wz]) => Math.abs(x - wx) < halfWidth && Math.hypot(y - wy, z - wz) < radius * 1.08,
    )
  }
  return pickTriangles(soup, (corners) => !corners.every(isInWheel))
}

function bakeVehicle(spec, folder) {
  const model = loadModel(join(folder, spec.folder))
  let soup = new Soup()
  const wheels = new Soup()
  const steered = new Soup()
  const lightOf = []

  // Some models hang their parts on a skeleton, so each corner goes where its bones say.
  const skin = model.gltf.skins?.[0]
  const inverseBinds = skin && readAccessor(model, skin.inverseBindMatrices)
  const jointMatrices = skin?.joints.map((joint, slot) =>
    model.world[joint].clone().multiply(new THREE.Matrix4().fromArray(inverseBinds, slot * 16)),
  )
  const wheelJoints = new Set(
    (skin?.joints ?? [])
      .filter((joint) => spec.wheelJoint?.test(model.gltf.nodes[joint].name ?? ''))
      .flatMap((joint) => [...collectDescendants(model.gltf, joint)]),
  )

  model.gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined || !model.world[index]) return

    // Anything under a dropped part goes with it.
    let isWheel = false
    let isWhite = false
    let isSteered = false
    for (let up = index; up !== undefined; up = model.parents[up]) {
      const name = model.gltf.nodes[up].name ?? ''
      if (spec.wheelNode?.test(name)) isWheel = true
      else if (spec.dropNode?.test(name)) return
      if (spec.whiteNode?.test(name)) isWhite = true
      if (spec.steerNode?.test(name)) isSteered = true
    }

    for (const primitive of model.gltf.meshes[node.mesh].primitives) {
      const material = model.gltf.materials[primitive.material]
      const joints = node.skin === undefined ? null : readAccessor(model, primitive.attributes.JOINTS_0)
      const weights = joints && readAccessor(model, primitive.attributes.WEIGHTS_0)
      const onWheel = isWheel || spec.wheelMaterial?.test(material.name) ||
        (joints !== null && wheelJoints.has(skin.joints[joints[0]]))

      if (!onWheel && spec.dropMaterial?.test(material.name)) continue

      const blended = new THREE.Matrix4()
      const matrixOf = !joints
        ? () => model.world[index]
        : (corner) => {
            const out = blended.elements.fill(0)
            for (let slot = 0; slot < 4; slot++) {
              const weight = weights[corner * 4 + slot]
              if (weight === 0) continue
              const elements = jointMatrices[joints[corner * 4 + slot]].elements
              for (let at = 0; at < 16; at++) out[at] += elements[at] * weight
            }
            return blended
          }

      const target = onWheel ? wheels : isSteered ? steered : soup
      const first = addPrimitive(model, target, primitive, matrixOf, (name) => {
        const isBodywork = (spec.paintMaterial ?? /^primary$/).test(name)
        const paint = !onWheel && !isWhite && isBodywork
        const painted = isWhite && isBodywork ? BOX_WHITE : paint ? WHITE : null
        return {
          color: /glass/i.test(name) ? GLASS : painted,
          paint,
          flat: !spec.noPaint,
        }
      })
      if (target !== soup) continue

      const kind = /front.?light|headlight/i.test(material.name) ? 1
        : /rear.?light|taillight|red_light/i.test(material.name) ? -1 : 0
      for (let corner = first; corner < soup.count; corner++) lightOf[corner] = kind
    }
  })

  // Point the length of the vehicle along Z, with the headlights towards +Z.
  const box = getBounds(soup).union(getBounds(wheels)).union(getBounds(steered))
  const size = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())
  const place = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z)
  const turn = new THREE.Matrix4()
  if (size.x > size.z) turn.makeRotationY(Math.PI / 2)
  const lineUp = turn.multiply(place)
  for (const part of [soup, wheels, steered]) transformSoup(part, lineUp)

  const front = getBounds(soup, (corner) => lightOf[corner] === 1).getCenter(new THREE.Vector3())
  const back = getBounds(soup, (corner) => lightOf[corner] === -1).getCenter(new THREE.Vector3())
  const facesBack = spec.reverse ?? front.z < back.z
  const length = getBounds(soup).union(getBounds(wheels)).union(getBounds(steered)).getSize(new THREE.Vector3()).z
  const scale = spec.length / length
  const finish = new THREE.Matrix4()
    .makeRotationY(facesBack ? Math.PI : 0)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
  for (const part of [soup, wheels, steered]) transformSoup(part, finish)

  if (spec.cutWheels) {
    const { borrow, radius, positions } = spec.cutWheels
    soup = cutWheelHoles(soup, spec.cutWheels)
    soup.wheels = { borrow, radius, positions }
  } else if (wheels.count) {
    soup.wheels = extractWheel(wheels, spec.singleTrack)
  }
  if (steered.count) soup.steered = steered
  return soup
}

/**
 * The bones the script needs, by the name each kind of skeleton gives them. `side` is 'Left' or
 * 'Right'. Mixamo's names (LeftUpLeg) are the usual. Rigify, as Blender's MB-Lab characters use, calls
 * them DEF-thigh_L and so on, and moves much of the body with "muscle" bones that hang off the
 * pelvis and shoulders rather than off the limb, so those are listed as part of each limb too.
 */
const RIGS = {
  mixamo: {
    upLeg: (side) => `${side}UpLeg`,
    arm: (side) => `${side}Arm`,
    foreArm: (side) => `${side}ForeArm`,
    hand: (side) => `${side}Hand`,
    foot: (side) => `${side}Foot`,
    toe: (side) => `${side}ToeBase`,
    legParts: null,
    armParts: null,
  },
  rigify: {
    upLeg: (side) => `DEF-thigh_${side[0]}`,
    arm: (side) => `DEF-upperarm_${side[0]}`,
    foreArm: (side) => `DEF-lowerarm_${side[0]}`,
    hand: (side) => `DEF-hand_${side[0]}`,
    foot: (side) => `DEF-foot_${side[0]}`,
    toe: (side) => `DEF-toes_${side[0]}`,
    // Thigh and lower-leg muscles; forearm, biceps and triceps.
    legParts: (side) => new RegExp(`^DEF-(lgs|lwrl)_muscle_\\d+_${side[0]}(_|$)`),
    armParts: (side) => new RegExp(`^DEF-(lwrm|bcs|tcs)_muscle_\\d+_${side[0]}(_|$)`),
  },
}

/** A bone by its plain name, which an exporter may have prefixed (`mixamorig:`) or numbered (`_57`). */
function boneNamed(name) {
  return new RegExp(`(^|:)${name}(_\\d+)?$`)
}

function findJoint(gltf, skin, pattern) {
  const joint = skin.joints.find((index) => pattern.test(gltf.nodes[index].name ?? ''))
  if (joint === undefined) throw new Error(`No joint matching ${pattern}`)
  return joint
}

function collectDescendants(gltf, root) {
  const found = new Set([root])
  for (const child of gltf.nodes[root].children ?? []) {
    for (const index of collectDescendants(gltf, child)) found.add(index)
  }
  return found
}

/** Pulls loose cloth in around the body, and brings its top down to the waist. */
/**
 * A straight line from a joint's height to where it is on the mesh, fitted by
 * least squares to every joint that moves enough of the mesh on its own.
 */
function fitJointsToMesh(heldBy, jointHeight) {
  const pairs = [...heldBy]
    .filter(([, heights]) => heights.length >= 20)
    .map(([joint, heights]) => [jointHeight(joint), heights.reduce((sum, y) => sum + y, 0) / heights.length])
  const count = pairs.length
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / count
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / count
  const spread = pairs.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0)
  const slope = pairs.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / spread
  return (y) => meanY + slope * (y - meanX)
}

function bakePerson(spec, folder) {
  const model = loadModel(join(folder, spec.folder))
  const { gltf } = model
  const skinned = gltf.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.skin !== undefined && node.mesh !== undefined)

  const skinIndex = 0
  const skin = gltf.skins[skinIndex]
  const inverseBinds = readAccessor(model, skin.inverseBindMatrices)

  const worldPoint = (joint) => new THREE.Vector3().setFromMatrixPosition(model.world[joint])
  const rig = RIGS[spec.rig ?? 'mixamo']
  const bone = (part, side) => findJoint(gltf, skin, boneNamed(rig[part](side)))
  const armOf = (side) => bone('arm', side)
  const handOf = (side) => bone('hand', side)
  const legOf = (side) => bone('upLeg', side)

  // Bring each arm down: first turn it at the shoulder, and then at the elbow.
  const posed = model.world.map((matrix) => matrix?.clone())
  const down = new THREE.Vector3(0, -1, 0)
  const pointOf = (joint) => new THREE.Vector3().setFromMatrixPosition(posed[joint])

  const hang = (pivot, end) => {
    const from = pointOf(pivot)
    const reach = pointOf(end).sub(from).normalize()
    const hanging = reach.clone().multiplyScalar(0.12).add(down).normalize()
    const about = new THREE.Matrix4()
      .makeTranslation(from.x, from.y, from.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(reach, hanging),
      ))
      .multiply(new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z))
    for (const joint of collectDescendants(gltf, pivot)) {
      posed[joint] = about.clone().multiply(posed[joint])
    }
  }

  for (const side of spec.keepPose ? [] : ['Left', 'Right']) {
    const elbow = bone('foreArm', side)
    hang(armOf(side), elbow)
    hang(elbow, handOf(side))
  }

  const jointMatrices = skin.joints.map((joint, slot) =>
    posed[joint].clone().multiply(new THREE.Matrix4().fromArray(inverseBinds, slot * 16)),
  )
  // Everything below each hip and shoulder, and any muscle bones the rig hangs elsewhere.
  const limb = (root, parts) => {
    const found = collectDescendants(gltf, root)
    if (parts) for (const joint of skin.joints) if (parts.test(gltf.nodes[joint].name ?? '')) found.add(joint)
    return found
  }
  const groups = {
    leftLeg: limb(legOf('Left'), rig.legParts?.('Left')),
    rightLeg: limb(legOf('Right'), rig.legParts?.('Right')),
    leftArm: limb(armOf('Left'), rig.armParts?.('Left')),
    rightArm: limb(armOf('Right'), rig.armParts?.('Right')),
  }
  const shares = new Map()
  const soup = new Soup()
  // For each joint, the heights of the corners it moves most, to find where the joint is on the mesh.
  const heldBy = new Map()

  for (const { node } of skinned) {
    if (node.skin !== skinIndex) continue

    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const material = gltf.materials[primitive.material]
      if (spec.dropMaterial?.test(material.name)) continue

      const joints = readAccessor(model, primitive.attributes.JOINTS_0)
      const weights = readAccessor(model, primitive.attributes.WEIGHTS_0)
      const blended = new THREE.Matrix4()

      // Weights are scaled to add up to 1. A few corners in some files have none at all, which would
      // squash them to nothing (and break the maths), so those simply follow their first bone.
      const matrixOf = (corner) => {
        const out = blended.elements.fill(0)
        let total = 0
        for (let slot = 0; slot < 4; slot++) total += weights[corner * 4 + slot]
        if (total < 1e-6) return blended.copy(jointMatrices[joints[corner * 4]])
        for (let slot = 0; slot < 4; slot++) {
          const weight = weights[corner * 4 + slot] / total
          if (weight === 0) continue
          const elements = jointMatrices[joints[corner * 4 + slot]].elements
          for (let at = 0; at < 16; at++) out[at] += elements[at] * weight
        }
        return blended
      }

      const first = addPrimitive(model, soup, primitive, matrixOf, (name) => ({ color: spec.colors?.[name] ?? null, paint: false }))
      const isClothing = spec.clothes.test(material.name)

      for (let corner = 0; corner < soup.count - first; corner++) {
        const share = { leftLeg: 0, rightLeg: 0, leftArm: 0, rightArm: 0, isClothing }
        let strongest = -1
        let strongestWeight = 0
        for (let slot = 0; slot < 4; slot++) {
          const joint = skin.joints[joints[corner * 4 + slot]]
          const weight = weights[corner * 4 + slot]
          for (const group of Object.keys(groups)) {
            if (groups[group].has(joint)) share[group] += weight
          }
          if (weight > strongestWeight) [strongest, strongestWeight] = [joint, weight]
        }
        shares.set(first + corner, share)
        if (strongestWeight > 0.8) {
          const heights = heldBy.get(strongest) ?? []
          heights.push(soup.positions[(first + corner) * 3 + 1])
          heldBy.set(strongest, heights)
        }
      }
    }
  }

  // Parts that hang rigidly off a bone rather than being skinned to it, such as the kurta man's
  // hair on his head bone, move with that bone. Without this he came out bald.
  const isJoint = new Set(skin.joints)
  const onBone = (index) => {
    for (let at = model.parents[index]; at !== undefined; at = model.parents[at]) if (isJoint.has(at)) return true
    return false
  }
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined || node.skin !== undefined || !onBone(index)) return
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const material = gltf.materials[primitive.material]
      if (spec.dropMaterial?.test(material.name)) continue
      const first = addPrimitive(model, soup, primitive, () => posed[index], (name) => ({ color: spec.colors?.[name] ?? null, paint: false }))
      const isClothing = spec.clothes.test(material.name)
      for (let corner = first; corner < soup.count; corner++) {
        shares.set(corner, { leftLeg: 0, rightLeg: 0, leftArm: 0, rightArm: 0, isClothing })
      }
    }
  })

  // Stand them on the ground at the right height, facing +Z.
  const foot = worldPoint(bone('foot', 'Left'))
  const toe = worldPoint(bone('toe', 'Left'))
  const facing = Math.atan2(toe.x - foot.x, toe.z - foot.z)
  const box = getBounds(soup)
  const scale = spec.height / box.getSize(new THREE.Vector3()).y
  const hips = worldPoint(legOf('Left')).add(worldPoint(legOf('Right'))).multiplyScalar(0.5)
  const fit = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeRotationY(-facing))
    .multiply(new THREE.Matrix4().makeTranslation(-hips.x, -box.min.y, -hips.z))
  transformSoup(soup, fit)

  // The skeleton and the mesh needn't be at the same scale: the man in the dhoti's skeleton is about
  // 1.6 times his mesh, so his hips came out at 1.47 m on a 1.72 m man. So the joint heights are taken
  // onto the mesh by a straight-line fit between each joint's height and the middle height of the
  // corners it moves most. It's exact where they agree, and corrects them where they don't.
  const onMesh = fitJointsToMesh(heldBy, (joint) => pointOf(joint).y)
  const meshHeight = (y) => (onMesh(y) - box.min.y) * scale
  const hipHeight = meshHeight(hips.y)
  const shoulderHeight = meshHeight(worldPoint(armOf('Left')).y)
  const leftSide = worldPoint(legOf('Left')).applyMatrix4(fit).x > 0 ? 1 : -1

  // The swing the game's walking shader reads: one side forward, the other back.
  for (const [corner, share] of shares) {
    const legs = (share.leftLeg - share.rightLeg) * leftSide
    const arms = -(share.leftArm - share.rightArm) * leftSide * (spec.armSwing ?? 1)
    const isArm = share.leftArm + share.rightArm > share.leftLeg + share.rightLeg
    const at = corner * 3
    soup.limbs[at] = isArm ? arms : legs
    soup.limbs[at + 1] = isArm ? shoulderHeight : hipHeight
    soup.limbs[at + 2] = share.isClothing ? 1 : 0
  }

  // Clothing takes each person's own colour, so only its light and shade should stay.
  for (let corner = 0; corner < soup.count; corner++) {
    if (soup.limbs[corner * 3 + 2] !== 1) continue
    const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
    const light = Math.min(1, 0.45 + (0.3 * r + 0.6 * g + 0.1 * b) * 0.8)
    soup.colors.splice(corner * 3, 3, light, light, light)
  }

  return soup
}

function writeGlb(meshes, file) {
  const binary = []
  let length = 0
  const views = []
  const accessors = []

  const add = (array, type, componentType, target, bounds) => {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
    const padding = -length % 4 < 0 ? 4 + (-length % 4) : 0
    if (padding) {
      binary.push(Buffer.alloc(padding))
      length += padding
    }
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target })
    binary.push(bytes)
    length += bytes.length
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count: array.length / TYPE_COUNTS[type],
      type,
      ...bounds,
    })
    return accessors.length - 1
  }

  const gltfMeshes = meshes.map(({ name, soup }) => {
    const box = getBounds(soup)
    return {
      name,
      primitives: [{
        attributes: {
          POSITION: add(new Float32Array(soup.positions), 'VEC3', 5126, 34962, {
            min: box.min.toArray(),
            max: box.max.toArray(),
          }),
          NORMAL: add(new Float32Array(soup.normals), 'VEC3', 5126, 34962),
          COLOR_0: add(new Float32Array(soup.colors), 'VEC3', 5126, 34962),
          _LIMB: add(new Float32Array(soup.limbs), 'VEC3', 5126, 34962),
          _PAINT: add(new Float32Array(soup.paints), 'SCALAR', 5126, 34962),
        },
        indices: add(new Uint32Array(soup.indices), 'SCALAR', 5125, 34963),
      }],
    }
  })

  const padding = -length % 4 < 0 ? 4 + (-length % 4) : 0
  if (padding) binary.push(Buffer.alloc(padding))
  const body = Buffer.concat(binary)

  const document = {
    asset: { version: '2.0', generator: 'scripts/prepare_traffic_models.mjs' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, index) => index) }],
    nodes: meshes.map(({ name, extras }, index) => ({ name, mesh: index, extras })),
    meshes: gltfMeshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: body.length }],
  }
  let json = Buffer.from(JSON.stringify(document))
  json = Buffer.concat([json, Buffer.alloc(-json.length % 4 < 0 ? 4 + (-json.length % 4) : 0, 0x20)])

  const header = Buffer.alloc(12)
  header.write('glTF', 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + json.length + 8 + body.length, 8)
  const chunk = (data, type) => {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(data.length, 0)
    head.write(type, 4, 'latin1')
    return Buffer.concat([head, data])
  }
  writeFileSync(file, Buffer.concat([header, chunk(json, 'JSON'), chunk(body, 'BIN\0')]))
}

async function main() {
  const folder = process.argv[2]
  if (!folder) throw new Error('Pass the folder of unzipped models')

  const only = process.argv[3]
  await MeshoptSimplifier.ready
  MeshoptSimplifier.useExperimentalFeatures = true

  const files = new Map()
  for (const [specs, bake] of [[VEHICLES, bakeVehicle], [PEOPLE, bakePerson]]) {
    for (const spec of specs) {
      if (only && only !== spec.name) continue
      const baked = bake(spec, folder)
      const broken = ['positions', 'normals', 'colors', 'limbs'].filter((field) =>
        baked[field].some((value) => !Number.isFinite(value)),
      )
      if (broken.length) console.log(spec.name, 'has bad numbers in', broken)
      const welded = weld(spec.wrapCell ? shrinkWrap(baked, spec.wrapCell) : baked)
      const { result, error } = simplify(welded, spec.triangles)
      if (spec.wrapCell) smoothNormals(result, CREASE)
      const size = getBounds(result).getSize(new THREE.Vector3())
      console.log(
        spec.name.padEnd(10),
        `${String(welded.indices.length / 3).padStart(8)} -> ${String(result.indices.length / 3).padStart(6)} triangles`,
        `error ${error.toFixed(4)}`,
        `size ${size.toArray().map((value) => value.toFixed(2)).join(' x ')}`,
      )

      const wheels = baked.wheels
      const extras = wheels && {
        wheelModel: wheels.borrow ?? spec.name,
        wheelRadius: wheels.radius,
        wheelPositions: wheels.positions,
      }
      const file = spec.file ?? DEFAULT_FILE
      const meshes = files.get(file) ?? []
      files.set(file, meshes)
      meshes.push({ name: spec.name, soup: result, extras })

      if (baked.steered) {
        const front = simplify(weld(shrinkWrap(baked.steered, spec.wrapCell)), STEERED_TRIANGLES).result
        console.log(`  front end: ${front.indices.length / 3} triangles`)
        meshes.push({ name: `${spec.name}-front`, soup: front })
      }

      if (wheels?.soup) {
        const wheel = simplify(weld(shrinkWrap(wheels.soup, WHEEL_WRAP_CELL)), WHEEL_TRIANGLES).result
        console.log(`  wheel: ${wheel.indices.length / 3} triangles, radius ${wheels.radius.toFixed(3)}`)
        meshes.push({ name: `${spec.name}-wheel`, soup: wheel, extras: { wheelRadius: wheels.radius } })
      }
    }
  }

  for (const [file, meshes] of files) {
    const output = join(ROOT, 'public', 'models', file)
    writeGlb(meshes, output)
    console.log(file, `${(readFileSync(output).length / 1_000_000).toFixed(2)} MB`)
  }
}

await main()
