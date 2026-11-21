#!/usr/bin/env node
/**
 * Bakes the downloaded cars, auto and people into one small file,
 * public/models/traffic.glb. The originals total about 5 million triangles.
 * The game draws each of these many times, so each must be a few thousand.
 *
 *     node scripts/prepare_traffic_models.mjs <folder of unzipped models>
 *     node scripts/prepare_traffic_models.mjs <folder> uncle,guy,office,saree   # only these (here, people.glb alone)
 *
 * The people added after the first two go in public/models/people.glb, so adding one doesn't
 * rebake the vehicles. Run scripts/compress_models.mjs afterwards.
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
/** Colour is sampled from each texture at this size: at 256, close up, the paint and trim read as blotches. */
const TEXTURE_SAMPLE_SIZE = 512
const GLASS = [0.018, 0.028, 0.036]
/** Paint is stored white, so each vehicle's own colour comes through exactly. */
const WHITE = [1, 1, 1]
const BOX_WHITE = [0.82, 0.82, 0.8]
/** A corner flips to paint (or away from it) when at least this share of its neighbours are, this many times over. */
const PAINT_MAJORITY = 0.6
const PAINT_PASSES = 3
/** How strongly the simplifier keeps the line between paint and trim, against colour (0.4) and shape. */
const PAINT_EDGE_WEIGHT = 2
/** How far the simplified shape may drift, as a share of the model's size. */
const MAX_SHAPE_ERROR = 0.02
/** Faces meeting at more than this angle, in radians, keep a crisp edge between them. See `smoothNormals`. */
const CREASE = (50 * Math.PI) / 180

/*
 * Cars are wrapped on a fine grid (1.5 cm), then simplified to about 14,000 triangles for the near
 * version, drawn only within 32 to 50 m of the camera (a handful at once); at 6,500 from a 2 cm wrap the
 * SUV's grille came out jagged and its paint blotchy close up. (At 24,000–28,000 each, drawn for
 * everything, traffic was once over half of every frame's triangles.)
 * Simplifying from the fine wrap, rather than wrapping coarsely, keeps door lines and lights.
 * Each vehicle also gets a far version, under 1,000 triangles with its wheels, for beyond ~20 m.
 */
const VEHICLES = [
  {
    name: 'sedan',
    folder: '2022_maruti_suzuki_swift_dzire',
    length: 4.2,
    triangles: 14000,
    nearTriangles: 22000,
    wrapCell: 0.015,
    dropMaterial: /seats_|speedometer|sidewall/,
    dropNode: /^(movsteer|seats_|sidewall|dashboard|speedometer)/,
    wheelNode: /^wheel_rf(\.\d+)?$/,
  },
  {
    name: 'hatchback',
    folder: '2020_maruti_suzuki_alto_800',
    length: 3.6,
    triangles: 14000,
    nearTriangles: 22000,
    wrapCell: 0.015,
    dropMaterial: /seat|^dash|^mate|steering|dore2/,
    dropNode: /^(dash|mate|steering)/,
    wheelNode: /^wheel(\.\d+)?$/,
  },
  {
    name: 'suv',
    folder: '2022_mahindra_scorpio-n',
    length: 4.6,
    triangles: 14000,
    // More than the others: its grille alone is 70,000 triangles in the original, and with less the
    // windscreen's glass merged into the paint round it in patches.
    nearTriangles: 30000,
    nearColorWeight: 0.6,
    wrapCell: 0.015,
    dropMaterial: /_int_|sunroof_m/,
    dropNode: /^movsteer/,
    wheelNode: /^wheel_rf(\.\d+)?$/,
  },
  {
    name: 'mpv',
    folder: 'renault_triber',
    length: 4,
    triangles: 14000,
    nearTriangles: 22000,
    wrapCell: 0.015,
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
    file: 'sportbike.glb',
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
    // All of the original's (about 7,500): cut to 5,000, its hood came out faceted beside the rider in a jam.
    triangles: 8000,
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

/** The file the people added after the first two go in. */
const PEOPLE_FILE = 'people.glb'

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
  // More people for the pavements, in a file of their own (people.glb), so adding one never rebakes
  // the vehicles. Their titles and makers are in public/models/CREDITS.txt.
  {
    // "Indian Overweight Man Striped Shirt": the same avatar skeleton as the teenager.
    name: 'uncle',
    folder: 'indian_overweight_man_striped_shirt',
    file: PEOPLE_FILE,
    height: 1.68,
    triangles: 3800,
    // His striped shirt is the point of him: it keeps its own colours, and nothing takes a person's tint.
    clothes: /^$/,
    dropMaterial: /Teeth|Cornea|Eyelashes/,
  },
  {
    // "Indian Gangster" is the model's title; here he's a man in a shirt on the pavement, like anyone.
    name: 'guy',
    folder: 'indian_gangster',
    file: PEOPLE_FILE,
    height: 1.74,
    triangles: 3800,
    clothes: /outfit_top/,
    dropMaterial: /Teeth|Cornea|Eyelashes/,
  },
  {
    // "Indian male metaverse avatar in formal Dress": an office-goer.
    name: 'office',
    folder: 'indian_male_metaverse_avatar_in_formal_dress',
    file: PEOPLE_FILE,
    height: 1.73,
    triangles: 3500,
    clothes: /Outfit_Top/,
    dropMaterial: /Teeth/,
  },
  {
    // "Sareewoman": one material for all of her, so nothing is tinted; and her saree is one cloth
    // over both legs, so the legs swing only a little under it, or it would part like trousers.
    name: 'saree',
    folder: 'sareewoman',
    file: PEOPLE_FILE,
    height: 1.6,
    triangles: 5000,
    clothes: /^$/,
    legSwing: 0.3,
    // A quarter of a million triangles in many loose pieces: she's allowed to drift further from
    // the original than the others to get down to a pedestrian's share.
    simplify: { maxError: 0.08, colorWeight: 0.05, normalWeight: 0.02 },
  },
  {
    // "bike rider 3d": a rider in a riding suit and a full-face helmet. The base for the player's
    // own rider (vehicle/Rider.tsx), who wears the Deliver It jacket over it.
    name: 'biker',
    folder: 'bike_rider_3d',
    file: PEOPLE_FILE,
    height: 1.74,
    triangles: 5000,
    clothes: /Outfit_Top/,
    dropMaterial: /Teeth/,
  },
]

/**
 * Animals, baked standing as modelled into the people's file: one mesh, colour sampled from the
 * texture, no limbs (they stand still). `head`: the material that says which end is the front.
 */
const ANIMALS = [
  {
    // "Bull": the animal in the road (world/CityEvents.tsx).
    name: 'bull',
    folder: 'bull',
    file: PEOPLE_FILE,
    height: 1.55,
    triangles: 4500,
    head: /horns/,
    dropMaterial: /^$/,
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

/**
 * Cleans up the paint after shrink-wrapping. Each corner of the skin takes its colour from the
 * nearest part of the original, and near a panel gap that's often the dark seal underneath, so
 * painted bodies came out speckled with dark corners. Here a corner mostly surrounded by paint
 * becomes paint, and a stray painted corner among trim becomes trim, taking its neighbours'
 * colour, a few times over.
 */
function settlePaint(soup) {
  const neighbours = Array.from({ length: soup.count }, () => new Set())
  for (let at = 0; at < soup.indices.length; at += 3) {
    for (let k = 0; k < 3; k++) {
      const a = soup.indices[at + k]
      const b = soup.indices[at + ((k + 1) % 3)]
      neighbours[a].add(b)
      neighbours[b].add(a)
    }
  }
  for (let pass = 0; pass < PAINT_PASSES; pass++) {
    const paints = soup.paints.slice()
    const colors = soup.colors.slice()
    for (let corner = 0; corner < soup.count; corner++) {
      const around = [...neighbours[corner]]
      if (around.length === 0) continue
      const painted = around.filter((other) => paints[other] === 1)
      const share = painted.length / around.length
      const flip = paints[corner] === 0 ? share >= PAINT_MAJORITY : share <= 1 - PAINT_MAJORITY
      if (!flip) continue
      const from = paints[corner] === 0 ? painted : around.filter((other) => paints[other] === 0)
      soup.paints[corner] = paints[corner] === 0 ? 1 : 0
      for (let axis = 0; axis < 3; axis++) {
        soup.colors[corner * 3 + axis] = from.reduce((sum, other) => sum + colors[other * 3 + axis], 0) / from.length
      }
    }
  }
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

/**
 * Removes triangles until it reaches the target. `colorWeight` is how much a corner's colour
 * counts against merging it: less for the vehicles, whose colours are sampled photo noise.
 * `sloppy` merges nearby corners whatever the surface, which reaches any target: for far versions.
 */
function simplify(soup, triangles, { maxError = MAX_SHAPE_ERROR, colorWeight = 0.4, normalWeight = 0.08, sloppy = false, flags = ['Prune'] } = {}) {
  const count = soup.count
  // Never more than it has: the simplifier won't take a target above the source.
  triangles = Math.min(triangles, soup.indices.length / 3)
  const positions = new Float32Array(soup.positions)
  // Whether a corner is paint counts most: merged across a paint edge, a triangle is half body
  // colour and half trim, and window frames, arches and grilles came out ragged and speckled.
  const attributes = new Float32Array(count * 7)
  for (let corner = 0; corner < count; corner++) {
    attributes.set(soup.colors.slice(corner * 3, corner * 3 + 3), corner * 7)
    attributes.set(soup.normals.slice(corner * 3, corner * 3 + 3), corner * 7 + 3)
    attributes[corner * 7 + 6] = soup.paints[corner]
  }

  const [indices, error] = sloppy
    ? MeshoptSimplifier.simplifySloppy(new Uint32Array(soup.indices), positions, 3, null, triangles * 3, maxError)
    : MeshoptSimplifier.simplifyWithAttributes(
        new Uint32Array(soup.indices),
        positions,
        3,
        attributes,
        7,
        [colorWeight, colorWeight, colorWeight, normalWeight, normalWeight, normalWeight, PAINT_EDGE_WEIGHT],
        null,
        triangles * 3,
        maxError,
        flags,
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
const WHEEL_TRIANGLES = 300
/** The far versions: the body, and each of its wheels, in triangles, and how far their shape may drift. */
const FAR_TRIANGLES = 700
const FAR_WHEEL_TRIANGLES = 40
const FAR_FRONT_TRIANGLES = 150
const FAR_SHAPE_ERROR = 0.12
/** Traffic's near models: colour counts less, and the shape may drift a little further. */
/**
 * Traffic's near models. 'Permissive' lets the simplifier merge across the tiny seams the
 * shrink-wrap leaves: without it, the hatchback stopped at 18,000 triangles whatever the
 * error allowed; with it, 6,200 at a smaller error than before.
 */
/** Straight from the original model: its shape kept closely, its normals (the panels' creases) counting for more. */
const DIRECT_SIMPLIFY = { maxError: 0.06, colorWeight: 0.2, normalWeight: 0.3, flags: ['Prune', 'Permissive'] }
const NEAR_SIMPLIFY = { maxError: 0.03, colorWeight: 0.12, normalWeight: 0.05, flags: ['Prune', 'Permissive'] }
/** Wheels are small, and an error limit is a share of the shape's own size, so theirs is looser. */
const FAR_WHEEL_ERROR = 0.3
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
    const legs = (share.leftLeg - share.rightLeg) * leftSide * (spec.legSwing ?? 1)
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

/**
 * Riders for the traffic's two-wheelers (traffic/Traffic.tsx), from models with no skeleton: low-poly
 * figures in riding suits and helmets, standing with their arms straight out. `facing`: which way
 * they look in their file, as [x, z].
 */
const UNRIGGED = [
  { name: 'rider-m', folder: 'low-pol_bike_rider_male', file: PEOPLE_FILE, height: 1.74, triangles: 2000, facing: [1, 0] },
  { name: 'rider-f', folder: 'low-pol_bike_rider_female', file: PEOPLE_FILE, height: 1.64, triangles: 2000, facing: [1, 0] },
]

/**
 * A figure with no skeleton, made ready for the game's posing: stood on the ground facing +Z, the
 * arms brought down from straight out (turned about each shoulder), and each corner told its limb
 * from where it is: beyond the shoulders is an arm, below the hips a leg, by its side. The heights
 * of the shoulders and hips are found on the figure itself.
 */
function bakeUnrigged(spec, folder) {
  const model = loadModel(join(folder, spec.folder))
  const { gltf } = model
  const soup = new Soup()
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    for (const primitive of gltf.meshes[node.mesh].primitives) addPrimitive(model, soup, primitive, () => model.world[index], () => ({ color: null, paint: false }))
  })
  const box = getBounds(soup)
  const middle = box.getCenter(new THREE.Vector3())
  const scale = spec.height / box.getSize(new THREE.Vector3()).y
  transformSoup(
    soup,
    new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeRotationY(-Math.atan2(spec.facing[0], spec.facing[1])))
      .multiply(new THREE.Matrix4().makeTranslation(-middle.x, -box.min.y, -middle.z)),
  )

  const H = spec.height
  const at = (corner) => [soup.positions[corner * 3], soup.positions[corner * 3 + 1], soup.positions[corner * 3 + 2]]
  // The arms are everything well out to the side: their middle height is the shoulders'.
  let armSum = 0
  let armCount = 0
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y] = at(corner)
    if (Math.abs(x) > 0.22 * H) {
      armSum += y
      armCount++
    }
  }
  const shoulderY = armSum / armCount + 0.01 * H
  // The chest's half-width just under the arms: where the shoulders' joints are.
  let chest = 0
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y] = at(corner)
    if (y > shoulderY - 0.16 * H && y < shoulderY - 0.09 * H) chest = Math.max(chest, Math.abs(x))
  }
  const shoulderX = chest * 0.92
  // The hips: the highest level at which the figure is in two (nothing near the middle).
  let hipY = 0.47 * H
  for (let y = 0.58 * H; y > 0.3 * H; y -= 0.01 * H) {
    let nearest = Infinity
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, cy] = at(corner)
      if (Math.abs(cy - y) < 0.02 * H) nearest = Math.min(nearest, Math.abs(x))
    }
    if (nearest > 0.012 * H && nearest < Infinity) {
      hipY = y + 0.03 * H
      break
    }
  }
  console.log(`  ${spec.name}: shoulders at ${shoulderY.toFixed(2)} m and ±${shoulderX.toFixed(2)} m, hips at ${hipY.toFixed(2)} m`)

  const smooth = (from, to, value) => {
    const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
    return t * t * (3 - 2 * t)
  }
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const axis = new THREE.Vector3(0, 0, 1)
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y] = at(corner)
    const side = x >= 0 ? 1 : -1
    // How much of an arm this corner is: none on the chest, all of it past the shoulder.
    const arm = y > shoulderY - 0.14 * H ? smooth(shoulderX - 0.015 * H, shoulderX + 0.025 * H, Math.abs(x)) : 0
    if (arm > 0) {
      // Down from straight out, about the shoulder: a little short of straight down, as arms hang.
      const turn = -side * (Math.PI / 2 - 0.12) * arm
      point.fromArray(soup.positions, corner * 3).sub(new THREE.Vector3(side * shoulderX, shoulderY, 0)).applyAxisAngle(axis, turn).add(new THREE.Vector3(side * shoulderX, shoulderY, 0))
      point.toArray(soup.positions, corner * 3)
      normal.fromArray(soup.normals, corner * 3).applyAxisAngle(axis, turn).toArray(soup.normals, corner * 3)
    }
    const leg = 1 - smooth(hipY - 0.01 * H, hipY + 0.05 * H, y)
    const isArm = arm > 0.5
    soup.limbs[corner * 3] = isArm ? -side * arm : arm > 0 ? 0 : side * leg
    soup.limbs[corner * 3 + 1] = isArm ? shoulderY : hipY
    soup.limbs[corner * 3 + 2] = 0
  }
  return soup
}

/**
 * The rider's own vehicles (vehicle/vehicleBodies.ts): the Deliver It scooter and what GaadiGo rents
 * and sells. Each is fitted to the vehicle the game already had (the same wheelbase, wheels on the
 * ground, front to +Z) and cut into the pieces the game moves: the body, each wheel about its own
 * axle, and on two wheels what turns with the bars. Where its wheels are is found from where the
 * model touches the ground, so a model that is one mesh (the scooter) is cut as well as one in parts.
 *
 * `facing`: which way it looks in its file, as [x, z]. `drop`: parts left out, by their names.
 * `paint`: what takes the vehicle's colour, by material name or by the colour itself. `bars`:
 * whether bars and a headset turn with the front wheel (not under a sports bike's fairing).
 * `radius`: the wheels' radius when it can't be measured (a low-poly wheel). `triangles`: the body's share.
 * `fine`: for a low-poly model with its picture in a texture, how finely it's cut before the colour is read
 * (`addPrimitiveFine`), in the model's own units.
 */
const FLEET_FILE = 'fleet.glb'
const orange = (r, g, b) => r > 0.3 && g / r > 0.05 && g / r < 0.45 && b / r < 0.25
const red = (r, g, b) => r > 0.2 && g / r < 0.3 && b / r < 0.3
const blue = (r, g, b) => b > 0.12 && r / b < 0.45 && g / b < 0.75
const FLEET = [
  { name: 'scooty', folder: 'vespa_scooty', wheels: 2, wheelbase: 1.28, rearAxleZ: -0.62, facing: [0, 1], paint: orange, bars: true, radius: 0.221, triangles: 11000 },
  { name: 'cycle', folder: 'old_bicycle', wheels: 2, wheelbase: 1.07, rearAxleZ: -0.52, facing: [1, 0], drop: /Pedal|Center-Gear|Chain/, paint: /Bicycle-Body/, bars: true, corridor: 0.07, triangles: 6000 },
  // A small box truck: at the hatchback's wheelbase it stood 2.5 m tall, so it's fitted by its length instead.
  { name: 'minitruck', folder: 'cafe_sones_catering_car', wheels: 4, wheelbase: 1.95, rearAxleZ: -0.95, facing: [0, 1], fine: 0.03, triangles: 7000 },
  { name: 'cargovan', folder: 'cargo_van', wheels: 4, wheelbase: 2.8, rearAxleZ: -1.3, facing: [0, 1], drop: /Badge|LicensePlate/, paint: /Carpaint/, triangles: 9000 },
  // Made with Tripo AI (art/tripo/*.glb, one mesh and one 2K texture each), in a file of their own.
  // `glb`: read from this file. `length`: fitted by its length, in metres, where no vehicle's wheelbase is being matched.
  // `cuts`: each triangle cut this many times a side before the texture is read, so its detail isn't lost.
  // `lamps`: its head and tail lamps are cut out as pieces of their own, to glow. `far`: a far version of this many triangles.
  {
    name: 'vega', glb: 'art/tripo/vega150.glb', file: 'tripo.glb', wheels: 2, length: 2.05, rearAxleZ: -0.7, facing: [-1, 0], cuts: 3, bars: true, corridor: 0.075,
    // The tank is the paint: everything on it but its dark trim takes the colour, the maker's badge with it.
    paint: blue, clearBadge: true, lamps: true, far: 1800, triangles: 13000,
  },
  {
    name: 'ecargo', glb: 'art/tripo/bhaara_ecargo.glb', file: 'tripo.glb', wheels: 3, length: 2.9, rearAxleZ: -0.95, facing: [0, 1], cuts: 3, bars: false,
    // The silver cargo box becomes Deliver It's: stored white as paint, which the game dyes yellow, with the logo on it.
    box: true, lamps: true, far: 1800, triangles: 12000,
  },
]

/**
 * The traffic's bus (traffic/bus.ts), from a low-poly model with its picture in a texture and no
 * wheels: stood at the game's bus's length with its skirt off the ground, front to +Z, its red band
 * marked as paint so each bus takes a livery colour of the game's own (and the operator's lettering,
 * read this coarsely, is only a smudge). Where its wheel arches are is measured, for the wheels
 * the game puts in them.
 */
const BUSES = [{ name: 'bus', folder: 'ksrtc_bus', length: 11.2, skirt: 0.34, facing: [0, -1], cuts: 12, paint: red, triangles: 9000 }]

function bakeBus(spec, folder) {
  const model = loadModel(join(folder, spec.folder))
  const soup = new Soup()
  model.gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    for (const primitive of model.gltf.meshes[node.mesh].primitives) addPrimitiveFine(model, soup, primitive, model.world[index], 1, spec.cuts)
  })
  transformSoup(soup, new THREE.Matrix4().makeRotationY(-Math.atan2(spec.facing[0], spec.facing[1])))
  let box = getBounds(soup)
  const scale = spec.length / (box.max.z - box.min.z)
  transformSoup(
    soup,
    new THREE.Matrix4()
      .makeTranslation(0, spec.skirt, 0)
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)),
  )
  box = getBounds(soup)
  for (let corner = 0; corner < soup.count; corner++) {
    const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
    if (!spec.paint(r, g, b)) continue
    const shade = Math.min(1, 0.82 + 0.18 * Math.min(1, r / 0.8))
    soup.colors.splice(corner * 3, 3, shade, shade, shade)
    soup.paints[corner] = 1
  }
  // The arches: the stretches along the side where the skirt's lowest corner is well above the rest.
  const lowest = new Map()
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y, z] = [soup.positions[corner * 3], soup.positions[corner * 3 + 1], soup.positions[corner * 3 + 2]]
    if (Math.abs(x) < box.max.x * 0.8) continue
    const slice = Math.round(z / 0.1)
    if (y < (lowest.get(slice) ?? Infinity)) lowest.set(slice, y)
  }
  const arches = []
  let run = []
  for (const slice of [...lowest.keys()].sort((a, b) => a - b)) {
    if (lowest.get(slice) > spec.skirt + 0.25) run.push(slice * 0.1)
    else if (run.length) {
      if (run.length >= 4) arches.push(run)
      run = []
    }
  }
  const round = (value) => Math.round(value * 100) / 100
  const extras = { arches: arches.map((arch) => ({ z: round((arch[0] + arch.at(-1)) / 2), long: round(arch.at(-1) - arch[0] + 0.1) })), size: box.getSize(new THREE.Vector3()).toArray().map(round) }
  console.log(`  ${spec.name}:`, JSON.stringify(extras))
  const welded = weld(soup)
  settlePaint(welded)
  let { result } = simplify(welded, spec.triangles, { maxError: 0.01, colorWeight: 0.8 })
  // Its panels don't share edges, so the careful pass stops early; a cruder one that joins them finishes.
  if (result.indices.length / 3 > spec.triangles * 2) result = simplify(result, spec.triangles, { sloppy: true, maxError: 0.02 }).result
  console.log(`  ${String(soup.indices.length / 3).padStart(6)} -> ${String(result.indices.length / 3).padStart(6)} triangles`)
  return [{ name: spec.name, soup: result, extras }]
}

/** The triangles of `soup` that pass `keep` (given their three corners' numbers), as a soup of their own. */
function cutSoup(soup, keep) {
  const cut = new Soup()
  const moved = new Map()
  for (let at = 0; at < soup.indices.length; at += 3) {
    const corners = [soup.indices[at], soup.indices[at + 1], soup.indices[at + 2]]
    if (!keep(corners)) continue
    for (const corner of corners) {
      let target = moved.get(corner)
      if (target === undefined) {
        target = cut.count
        moved.set(corner, target)
        for (const field of ['positions', 'normals', 'colors', 'limbs']) cut[field].push(...soup[field].slice(corner * 3, corner * 3 + 3))
        cut.paints.push(soup.paints[corner])
      }
      cut.indices.push(target)
    }
  }
  return cut
}

/**
 * A part of a model with few, large triangles and its picture in a texture (a low-poly truck, a bus):
 * colour kept only at its corners would lose the windows, lamps and stripes inside each triangle. So
 * every triangle is first cut into small ones (edges no longer than `edge`, in the model's own units)
 * and the texture is read at each new corner. The simplifier then keeps the corners the colour needs.
 */
function addPrimitiveFine(model, soup, primitive, matrix, edge, same = 0) {
  const material = model.gltf.materials[primitive.material]
  const positions = readAccessor(model, primitive.attributes.POSITION)
  const normals = readAccessor(model, primitive.attributes.NORMAL)
  const uvs = primitive.attributes.TEXCOORD_0 === undefined ? null : readAccessor(model, primitive.attributes.TEXCOORD_0)
  const indices = readAccessor(model, primitive.indices)
  const sampler = getSampler(model, material)
  const tint = material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
  const flipped = matrix.determinant() < 0
  const corner = (index) => ({
    p: new THREE.Vector3().fromArray(positions, index * 3).applyMatrix4(matrix),
    n: new THREE.Vector3().fromArray(normals, index * 3).applyMatrix3(normalMatrix).normalize(),
    uv: uvs ? [uvs[index * 2], uvs[index * 2 + 1]] : [0, 0],
  })
  const scaleOf = Math.cbrt(Math.abs(matrix.determinant()))
  for (let at = 0; at < indices.length; at += 3) {
    const [a, b, c] = [corner(indices[at]), corner(indices[at + (flipped ? 2 : 1)]), corner(indices[at + (flipped ? 1 : 2)])]
    const longest = Math.max(a.p.distanceTo(b.p), b.p.distanceTo(c.p), c.p.distanceTo(a.p))
    // `same`: every triangle cut the same number of times, so neighbours' new corners meet along their
    // shared edge. Cut by their own sizes they don't, and the simplifier, which won't close a crack,
    // stops far short of its target.
    const steps = same || Math.min(40, Math.max(1, Math.ceil(longest / (edge * scaleOf))))
    // A grid of points across the triangle: `i` steps towards b and `j` towards c.
    const first = soup.count
    const rowStart = []
    for (let i = 0; i <= steps; i++) {
      rowStart.push(soup.count - first)
      for (let j = 0; j <= steps - i; j++) {
        const wb = i / steps
        const wc = j / steps
        const wa = 1 - wb - wc
        const p = a.p.clone().multiplyScalar(wa).addScaledVector(b.p, wb).addScaledVector(c.p, wc)
        const n = a.n.clone().multiplyScalar(wa).addScaledVector(b.n, wb).addScaledVector(c.n, wc).normalize()
        soup.positions.push(p.x, p.y, p.z)
        soup.normals.push(n.x, n.y, n.z)
        let rgb = [tint[0], tint[1], tint[2]]
        if (sampler && uvs) rgb = sampler(a.uv[0] * wa + b.uv[0] * wb + c.uv[0] * wc, a.uv[1] * wa + b.uv[1] * wb + c.uv[1] * wc).map((value, part) => toLinear(value) * tint[part])
        soup.colors.push(...rgb.map((value) => (Number.isFinite(value) ? value : 0.3)))
        soup.paints.push(0)
        soup.limbs.push(0, 0, 0)
      }
    }
    const at2 = (i, j) => first + rowStart[i] + j
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps - i; j++) {
        soup.indices.push(at2(i, j), at2(i + 1, j), at2(i, j + 1))
        if (j < steps - i - 1) soup.indices.push(at2(i + 1, j), at2(i + 1, j + 1), at2(i, j + 1))
      }
    }
  }
}

/** Unpacks a .glb beside this script's other working files, as a folder with scene.gltf in it, and says where. */
function unpackGlb(file) {
  const target = join(scratch, `glb-${imageCount++}`)
  execFileSync('node', ['--input-type=module', '-e', `
    import { mkdirSync } from 'node:fs'
    import { NodeIO } from '@gltf-transform/core'
    import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
    mkdirSync(${JSON.stringify(target)}, { recursive: true })
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    await io.write(${JSON.stringify(join(target, 'scene.gltf'))}, await io.read(${JSON.stringify(join(ROOT, file))}))
  `], { stdio: 'ignore', cwd: ROOT })
  return target
}

function bakeFleet(spec, folder) {
  const model = loadModel(spec.glb ? unpackGlb(spec.glb) : join(folder, spec.folder))
  const soup = new Soup()
  const paintByName = spec.paint instanceof RegExp ? spec.paint : null
  model.gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined || spec.drop?.test(node.name ?? '')) return
    for (const primitive of model.gltf.meshes[node.mesh].primitives) {
      if (spec.fine || spec.cuts) {
        addPrimitiveFine(model, soup, primitive, model.world[index], spec.fine ?? 1, spec.cuts ?? 0)
        continue
      }
      // Paint is known by the part's name or its material's: exporters put the useful one in either.
      const painted = (name) => paintByName?.test(`${node.name ?? ''} ${name}`) ?? false
      addPrimitive(model, soup, primitive, () => model.world[index], (name) => ({ color: painted(name) ? WHITE : null, paint: painted(name) }))
    }
  })
  const point = (corner) => [soup.positions[corner * 3], soup.positions[corner * 3 + 1], soup.positions[corner * 3 + 2]]
  // Front to +Z first, so everything after can speak of ahead and behind.
  transformSoup(soup, new THREE.Matrix4().makeRotationY(-Math.atan2(spec.facing[0], spec.facing[1])))

  // Where the wheels are, as modelled: the patches that touch the ground, ahead of and behind the middle.
  let box = getBounds(soup)
  const tall = box.max.y - box.min.y
  const midZ = (box.min.z + box.max.z) / 2
  const midX = (box.min.x + box.max.x) / 2
  const patch = { front: [], rear: [], out: [] }
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y, z] = point(corner)
    if (y - box.min.y > tall * 0.012) continue
    patch[z > midZ ? 'front' : 'rear'].push(z)
    patch.out.push(Math.abs(x - midX))
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  // Only the patches furthest apart are the wheels': a stand's foot or a low sump between them isn't.
  const long = box.max.z - box.min.z
  const ends = (values, furthest) => values.filter((z) => Math.abs(z - furthest) < long * 0.06)
  patch.front = ends(patch.front, Math.max(...patch.front))
  patch.rear = ends(patch.rear, Math.min(...patch.rear))
  const scale = spec.length ? spec.length / long : spec.wheelbase / (mean(patch.front) - mean(patch.rear))
  const wheelbase = (mean(patch.front) - mean(patch.rear)) * scale
  transformSoup(
    soup,
    new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-midX, -box.min.y, -mean(patch.rear) + spec.rearAxleZ / scale)),
  )
  box = getBounds(soup)
  const rearZ = spec.rearAxleZ
  const frontZ = rearZ + wheelbase
  // Four wheels stand out to each side by the patches' own distance from the middle; of three, the two at the back do.
  let track = spec.wheels === 4 ? mean(patch.out) * scale : 0
  if (spec.wheels === 3) {
    const sides = []
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, y, z] = point(corner)
      if (y < 0.03 && z < 0) sides.push(Math.abs(x))
    }
    track = mean(sides)
  }
  // The front wheel of three is in the middle; everything measured at "a wheel" below is measured there.
  const frontTrack = spec.wheels === 4 ? track : 0

  // A wheel's radius, from the curve of the tyre where it leaves the ground: a point on a circle
  // standing on the ground, z ahead of its middle and y up, has radius (z² + y²) / 2y. The lowest
  // corner in each slice along the tyre gives one reading; the middle one is taken.
  let radius = spec.radius
  let tyreHalf = 0
  if (!radius) {
    const lowest = new Map()
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, y, z] = point(corner)
      if (Math.abs(Math.abs(x) - frontTrack) > 0.12 || Math.abs(z - frontZ) > 0.3 || y > 0.22) continue
      const slice = Math.round((z - frontZ) / 0.02)
      if (y < (lowest.get(slice) ?? Infinity)) lowest.set(slice, y)
    }
    const readings = []
    for (const [slice, y] of lowest) {
      const z = slice * 0.02
      if (y > 0.015 && Math.abs(z) > 0.06) readings.push((z * z + y * y) / (2 * y))
    }
    readings.sort((a, b) => a - b)
    radius = readings[Math.floor(readings.length / 2)] ?? 0.25
  }
  for (let corner = 0; corner < soup.count; corner++) {
    const [x, y] = point(corner)
    if (y < 0.03 && point(corner)[2] > 0) tyreHalf = Math.max(tyreHalf, Math.abs(Math.abs(x) - frontTrack))
  }
  // (Never wider than a tyre is: a fairing or a stand low down isn't the wheel.)
  const half = Math.min(spec.wheels === 4 ? 0.17 : 0.1, Math.max(0.05, tyreHalf * 1.7))

  // Paint by its colour, where the model is one material: stored near white, keeping a little light and shade.
  if (typeof spec.paint === 'function') {
    for (let corner = 0; corner < soup.count; corner++) {
      const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
      if (!spec.paint(r, g, b)) continue
      const shade = Math.min(1, 0.82 + 0.18 * Math.min(1, Math.max(r, g, b) / 0.8))
      soup.colors.splice(corner * 3, 3, shade, shade, shade)
      soup.paints[corner] = 1
    }
  }

  // The maker's badge on the tank: whatever isn't dark inside the painted tank's own outline is paint too.
  if (spec.clearBadge) {
    const tank = new THREE.Box3()
    for (let corner = 0; corner < soup.count; corner++) if (soup.paints[corner] === 1) tank.expandByPoint(new THREE.Vector3(...point(corner)))
    const size = tank.getSize(new THREE.Vector3())
    tank.expandByVector(size.multiplyScalar(-0.06))
    for (let corner = 0; corner < soup.count; corner++) {
      if (soup.paints[corner] === 1 || !tank.containsPoint(new THREE.Vector3(...point(corner)))) continue
      const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
      const light = Math.max(r, g, b)
      // Its lettering is pale and on the tank's sides; the dark seat, cap and seams stay what they are.
      if (light > 0.35 && Math.abs(point(corner)[0]) > size.x * 0.25) {
        soup.colors.splice(corner * 3, 3, 0.95, 0.95, 0.95)
        soup.paints[corner] = 1
      }
    }
  }
  // The cargo box: the grey at the back, above the floor, stored white as paint with its own light and shade.
  let boxBounds = null
  if (spec.box) {
    boxBounds = new THREE.Box3()
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, y, z] = point(corner)
      const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
      const light = Math.max(r, g, b)
      const grey = light - Math.min(r, g, b) < 0.06 && light > 0.12
      if (!grey || z > -0.15 || y < 0.62) continue
      const shade = Math.min(1, 0.55 + light * 0.75)
      soup.colors.splice(corner * 3, 3, shade, shade, shade)
      soup.paints[corner] = 1
      boxBounds.expandByPoint(new THREE.Vector3(x, y, z))
    }
  }
  // The lamps: pale at the very front, red at the very back, each a piece of its own so it can glow.
  const lampOf = new Int8Array(soup.count)
  if (spec.lamps) {
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, y, z] = point(corner)
      const [r, g, b] = soup.colors.slice(corner * 3, corner * 3 + 3)
      const light = Math.max(r, g, b)
      if (z > box.max.z - 0.42 && y > 0.5 && y < 1.25 && Math.abs(x) < 0.16 && light > 0.55 && light - Math.min(r, g, b) < 0.2) lampOf[corner] = 1
      else if (z < box.min.z + 0.3 && y > 0.45 && r > 0.3 && g / r < 0.3 && b / r < 0.3) lampOf[corner] = 2
    }
  }
  const lampKind = (corners) => (corners.every((corner) => lampOf[corner] === 1) ? 1 : corners.every((corner) => lampOf[corner] === 2) ? 2 : 0)
  const isLamp = (corners) => lampKind(corners) !== 0

  const middleOf = (corners) => {
    const sum = [0, 0, 0]
    for (const corner of corners) point(corner).forEach((value, part) => { sum[part] += value / 3 })
    return sum
  }
  // The wheels: [x, z, whether it steers], the rear ones first.
  const places = spec.wheels === 4
    ? [[-track, rearZ, false], [track, rearZ, false], [-track, frontZ, true], [track, frontZ, true]]
    : spec.wheels === 3
      ? [[-track, rearZ, false], [track, rearZ, false], [0, frontZ, true]]
      : [[0, rearZ, false], [0, frontZ, true]]
  const inWheel = ([wheelX, wheelZ]) => (corners) => corners.every((corner) => {
    const [x, y, z] = point(corner)
    return Math.abs(x - wheelX) < half && Math.hypot(y - radius, z - wheelZ) < radius * 1.03
  })
  const wheelTests = places.map(inWheel)
  const isWheel = (corners) => wheelTests.some((test) => test(corners))

  // On two wheels, what turns with the bars.
  let turns = () => false
  let pivotZ = 0
  let bars = null
  if (spec.wheels <= 3) {
    let barsY = 0
    let barsZ = 0
    let widest = 0
    for (let corner = 0; corner < soup.count; corner++) {
      const [x, y, z] = point(corner)
      // (Not the mirrors, which stand higher and wider on their stalks.)
      if (y > 0.85 && y < 1.12 && z > 0 && Math.abs(x) > widest) [widest, barsY, barsZ] = [Math.abs(x), y, z]
    }
    bars = [widest, barsY, barsZ]
    const headsetFrom = barsY - 0.13
    pivotZ = spec.bars ? barsZ + 0.04 : frontZ - radius * 1.6
    const corridor = spec.corridor ?? 0
    turns = (corners) => {
      const [x, y, z] = middleOf(corners)
      // The headset: the bars, the lamp and the mirrors.
      if (spec.bars && y > headsetFrom && z > pivotZ - 0.22) return true
      // The fork, where it's a thing of its own (a bicycle's): close to the line from the headset to the axle.
      if (corridor > 0 && Math.abs(x) < 0.12) {
        const along = Math.min(1, Math.max(0, (headsetFrom - y) / (headsetFrom - radius)))
        if (y < headsetFrom + 0.02 && Math.abs(z - (pivotZ + (frontZ - pivotZ) * along)) < corridor) return true
      }
      // The mudguard and whatever else hugs the front wheel.
      return Math.hypot(y - radius, z - frontZ) < radius * 1.5 && y < radius * 2.35 && Math.abs(x) < 0.16 && z > frontZ - radius * 1.25
    }
  }

  const wheels = places.map(([x, z, steers], index) => {
    const part = cutSoup(soup, wheelTests[index])
    transformSoup(part, new THREE.Matrix4().makeTranslation(-x, -radius, -z))
    return { soup: part, at: [x, radius, z], steers }
  })
  const front = spec.wheels <= 3 ? cutSoup(soup, (corners) => !isWheel(corners) && !isLamp(corners) && turns(corners)) : null
  const body = cutSoup(soup, (corners) => !isWheel(corners) && !isLamp(corners) && !turns(corners))

  // What the game needs to know to seat the rider: measured, not guessed.
  const seat = { y: 0, z: 0 }
  let floorY = 0
  for (let corner = 0; corner < body.count; corner++) {
    const [x, y, z] = [body.positions[corner * 3], body.positions[corner * 3 + 1], body.positions[corner * 3 + 2]]
    if (Math.abs(x) < 0.08 && z < -0.05 && z > -0.6 && y > seat.y) [seat.y, seat.z] = [y, z]
    if (Math.abs(x) > 0.06 && Math.abs(x) < 0.16 && z > -0.05 && z < 0.22 && y < 0.5) floorY = Math.max(floorY, y)
  }
  const round = (value) => Math.round(value * 1000) / 1000
  // The head lamp turns with the bars if that's where it is; the tail lamp is on the body.
  const head = cutSoup(soup, (corners) => !isWheel(corners) && lampKind(corners) === 1)
  const tail = cutSoup(soup, (corners) => !isWheel(corners) && lampKind(corners) === 2)
  const headTurns = head.count > 0 && spec.bars && turns([0, 1, 2].map(() => 0).map((_, k) => head.indices[k]).map((corner) => {
    // (`turns` reads corners of the whole soup; the head lamp's own first corner is found there by its place.)
    const target = head.positions.slice(corner * 3, corner * 3 + 3)
    for (let other = 0; other < soup.count; other++) if (soup.positions[other * 3] === target[0] && soup.positions[other * 3 + 1] === target[1] && soup.positions[other * 3 + 2] === target[2]) return other
    return 0
  }))
  const extras = {
    wheels: wheels.map(({ at, steers }) => ({ at: at.map(round), steers })),
    pivot: [0, round(pivotZ)],
    size: box.getSize(new THREE.Vector3()).toArray().map(round),
    ...(boxBounds && !boxBounds.isEmpty() ? { logoBox: { min: boxBounds.min.toArray().map(round), max: boxBounds.max.toArray().map(round) } } : {}),
    ...(spec.lamps ? { headTurns } : {}),
  }
  console.log(`  ${spec.name}:`, JSON.stringify({ ...extras, bars: bars?.map(round), seat: [round(seat.y), round(seat.z)], floor: round(floorY), halfTyre: round(half) }))
  return { body, front, wheels, extras, head, tail, whole: soup }
}

/** An animal as it stands in its file: skinned to its rest pose, on the ground, its head towards +Z. */
function bakeAnimal(spec, folder) {
  const model = loadModel(join(folder, spec.folder))
  const { gltf } = model
  const skin = gltf.skins[0]
  const inverseBinds = readAccessor(model, skin.inverseBindMatrices)
  const jointMatrices = skin.joints.map((joint, slot) => model.world[joint].clone().multiply(new THREE.Matrix4().fromArray(inverseBinds, slot * 16)))
  const soup = new Soup()
  const head = new THREE.Vector3()
  let headCorners = 0
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const material = gltf.materials[primitive.material]
      if (spec.dropMaterial?.test(material.name)) continue
      let matrixOf = () => model.world[index]
      if (node.skin !== undefined) {
        const joints = readAccessor(model, primitive.attributes.JOINTS_0)
        const weights = readAccessor(model, primitive.attributes.WEIGHTS_0)
        const blended = new THREE.Matrix4()
        matrixOf = (corner) => {
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
      }
      const first = addPrimitive(model, soup, primitive, matrixOf, () => ({ color: null, paint: false }))
      if (spec.head.test(material.name)) {
        for (let corner = first; corner < soup.count; corner++) {
          head.add(new THREE.Vector3().fromArray(soup.positions, corner * 3))
          headCorners++
        }
      }
    }
  })
  const box = getBounds(soup)
  const middle = box.getCenter(new THREE.Vector3())
  head.divideScalar(Math.max(1, headCorners))
  const facing = Math.atan2(head.x - middle.x, head.z - middle.z)
  const scale = spec.height / box.getSize(new THREE.Vector3()).y
  transformSoup(
    soup,
    new THREE.Matrix4()
      .makeScale(scale, scale, scale)
      .multiply(new THREE.Matrix4().makeRotationY(-facing))
      .multiply(new THREE.Matrix4().makeTranslation(-middle.x, -box.min.y, -middle.z)),
  )
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

/** A fleet vehicle's pieces, each welded and thinned to its share, with the paint's edges settled. */
function finishFleet(spec, baked) {
  const piece = (soup, triangles) => {
    const welded = weld(soup)
    if (typeof spec.paint === 'function') settlePaint(welded)
    const { result } = simplify(welded, triangles, { maxError: 0.006, colorWeight: 0.5 })
    console.log(`  ${String(soup.indices.length / 3).padStart(6)} -> ${String(result.indices.length / 3).padStart(6)} triangles`)
    return result
  }
  return [
    { name: spec.name, soup: piece(baked.body, spec.triangles), extras: baked.extras },
    ...(baked.front ? [{ name: `${spec.name}-front`, soup: piece(baked.front, 3000) }] : []),
    ...baked.wheels.map(({ soup }, index) => ({ name: `${spec.name}-wheel-${index}`, soup: piece(soup, 1200) })),
    ...(baked.head?.count ? [{ name: `${spec.name}-head`, soup: piece(baked.head, 300) }] : []),
    ...(baked.tail?.count ? [{ name: `${spec.name}-tail`, soup: piece(baked.tail, 300) }] : []),
    // The far version: the whole vehicle as one shape, wheels and all, for when it's small on the screen.
    ...(spec.far ? [{ name: `${spec.name}-far`, soup: simplify(weld(baked.whole), spec.far, { maxError: 0.03, colorWeight: 0.3 }).result }] : []),
  ]
}

async function main() {
  const folder = process.argv[2]
  if (!folder) throw new Error('Pass the folder of unzipped models')

  const only = process.argv[3]
  await MeshoptSimplifier.ready
  MeshoptSimplifier.useExperimentalFeatures = true

  const files = new Map()
  const farMeshes = []
  for (const spec of BUSES) {
    if (only && !only.split(',').includes(spec.name)) continue
    const meshes = files.get(FLEET_FILE) ?? []
    files.set(FLEET_FILE, meshes)
    meshes.push(...bakeBus(spec, folder))
  }
  for (const spec of FLEET) {
    if (only && !only.split(',').includes(spec.name)) continue
    const meshes = files.get(spec.file ?? FLEET_FILE) ?? []
    files.set(spec.file ?? FLEET_FILE, meshes)
    meshes.push(...finishFleet(spec, bakeFleet(spec, folder)))
  }
  for (const [specs, bake] of [[VEHICLES, bakeVehicle], [PEOPLE, bakePerson], [ANIMALS, bakeAnimal], [UNRIGGED, bakeUnrigged]]) {
    for (const spec of specs) {
      // One name, or several with commas between: only those are baked, and only their files written.
      if (only && !only.split(',').includes(spec.name)) continue
      const baked = bake(spec, folder)
      const broken = ['positions', 'normals', 'colors', 'limbs'].filter((field) =>
        baked[field].some((value) => !Number.isFinite(value)),
      )
      if (broken.length) console.log(spec.name, 'has bad numbers in', broken)
      const welded = weld(spec.wrapCell ? shrinkWrap(baked, spec.wrapCell) : baked)
      if (spec.wrapCell) settlePaint(welded)
      // A car's near version is simplified straight from the original model, not from the wrap: the
      // wrap's skin, snapped back onto the panels from a grid, came out dented and wrinkled close up,
      // and smeared paint into trim. The original keeps its smooth panels, its own normals and each
      // material's exact edge. (The far version still comes from the wrap: one skin, no insides.)
      const { result, error } = spec.nearTriangles
        ? simplify(weld(baked), spec.nearTriangles, { ...DIRECT_SIMPLIFY, colorWeight: spec.nearColorWeight ?? DIRECT_SIMPLIFY.colorWeight })
        : simplify(welded, spec.triangles, specs === VEHICLES && spec.name !== 'delivery' ? NEAR_SIMPLIFY : (spec.simplify ?? {}))
      // A model in many loose pieces (the saree woman) stops far short of its target, as the
      // simplifier won't join pieces. A second, cruder pass that does join them finishes the job.
      if (specs === PEOPLE && result.indices.length / 3 > spec.triangles * 1.3) {
        const cruder = simplify(result, spec.triangles, { sloppy: true, maxError: 0.06 }).result
        console.log(`  ${spec.name}: ${result.indices.length / 3} -> ${cruder.indices.length / 3} triangles by the cruder pass`)
        for (const field of ['positions', 'normals', 'colors', 'limbs', 'paints', 'indices']) result[field] = cruder[field]
      }
      if (spec.wrapCell && !spec.nearTriangles) smoothNormals(result, CREASE)
      const size = getBounds(result).getSize(new THREE.Vector3())
      console.log(
        spec.name.padEnd(10),
        `${String(welded.indices.length / 3).padStart(8)} -> ${String(result.indices.length / 3).padStart(6)} triangles`,
        `error ${error.toFixed(4)}`,
        `size ${size.toArray().map((value) => value.toFixed(2)).join(' x ')}`,
      )

      // The far version, for beyond ~20 m (people don't get one).
      if (specs === VEHICLES) {
        const far = simplify(welded, FAR_TRIANGLES, { maxError: FAR_SHAPE_ERROR, sloppy: true }).result
        if (spec.wrapCell) smoothNormals(far, CREASE)
        console.log(`  far: ${far.indices.length / 3} triangles`)
        farMeshes.push({ name: `${spec.name}-far`, soup: far })
      }

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
        // Its far version too, for the scooters parked along the shops.
        const farFront = simplify(weld(shrinkWrap(baked.steered, spec.wrapCell)), FAR_FRONT_TRIANGLES, { maxError: FAR_SHAPE_ERROR, sloppy: true }).result
        meshes.push({ name: `${spec.name}-front-far`, soup: farFront })
      }

      if (wheels?.soup) {
        const wrapped = weld(shrinkWrap(wheels.soup, WHEEL_WRAP_CELL))
        // The player's own scooter is seen right up close, so its wheel keeps the careful settings.
        const wheel = simplify(wrapped, WHEEL_TRIANGLES, spec.name === 'delivery' ? {} : NEAR_SIMPLIFY).result
        const farWheel = simplify(wrapped, FAR_WHEEL_TRIANGLES, { maxError: FAR_WHEEL_ERROR, sloppy: true }).result
        console.log(`  wheel: ${wheel.indices.length / 3} triangles, far ${farWheel.indices.length / 3}, radius ${wheels.radius.toFixed(3)}`)
        meshes.push({ name: `${spec.name}-wheel`, soup: wheel, extras: { wheelRadius: wheels.radius } })
        meshes.push({ name: `${spec.name}-wheel-far`, soup: farWheel, extras: { wheelRadius: wheels.radius } })
      }
      meshes.push(...farMeshes.splice(0))
    }
  }

  for (const [file, meshes] of files) {
    const output = join(ROOT, 'public', 'models', file)
    writeGlb(meshes, output)
    console.log(file, `${(readFileSync(output).length / 1_000_000).toFixed(2)} MB`)
  }
}

await main()
