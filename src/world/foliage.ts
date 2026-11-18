import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createRandom } from './props'

type Blob = [x: number, y: number, z: number, radius: number]

/** One outline per kind of tree, built from overlapping balls. */
const TREE_SHAPES: Blob[][] = [
  // Round and full.
  [
    [0, 4.5, 0, 2.1],
    [1.2, 3.8, 0.5, 1.5],
    [-1.1, 3.9, -0.7, 1.6],
    [0.1, 5.5, -0.3, 1.4],
  ],
  // Tall and narrow.
  [
    [0, 3.8, 0, 1.6],
    [0.2, 5.2, 0.1, 1.35],
    [-0.1, 6.4, -0.1, 1],
  ],
  // Wide and flat, like a rain tree.
  [
    [0, 4.7, 0, 1.9],
    [1.9, 4.4, 0.4, 1.5],
    [-1.8, 4.4, -0.5, 1.6],
    [0.3, 4.3, 1.8, 1.4],
  ],
  // An umbrella: a broad, flat-topped spread held high, as a mature rain tree or gulmohar.
  [
    [0, 5.4, 0, 1.7],
    [2.2, 5.1, 0.6, 1.5],
    [-2.1, 5.2, -0.4, 1.5],
    [0.5, 5.0, 2.1, 1.4],
    [-0.4, 5.1, -2.1, 1.4],
    [1.4, 5.6, -1.4, 1.2],
  ],
  // A column: the mast-tree ashoka, narrow and tall, its drooping leaves almost to the ground.
  [
    [0, 1.8, 0, 0.75],
    [0, 3.1, 0, 0.8],
    [0, 4.4, 0, 0.72],
    [0, 5.6, 0, 0.6],
    [0, 6.6, 0, 0.42],
  ],
  // A dome: a banyan or peepal, the old tree beside a temple, wider than it is tall.
  [
    [0, 5.6, 0, 2.4],
    [2.6, 4.9, 0.8, 2.0],
    [-2.5, 5.0, -0.9, 2.1],
    [0.8, 4.8, 2.6, 1.9],
    [-0.9, 4.9, -2.5, 1.9],
    [1.9, 6.2, -1.6, 1.6],
    [-1.6, 6.3, 1.5, 1.6],
  ],
  // An arch: a big avenue tree's spread reaching out over the road (towards +z, which the
  // planting turns to face the road), held high enough for a bus to pass under. Two rows of
  // these, one each side, nearly meet over the middle of a residential or main road.
  [
    [0, 5.7, 0.2, 1.9],
    [1.9, 5.5, 0.9, 1.5],
    [-1.9, 5.6, 0.8, 1.5],
    [0.4, 6.1, 2.6, 1.7],
    [-0.6, 6.0, 4.5, 1.5],
    [1.2, 6.2, 4.1, 1.3],
    [0.2, 6.0, -0.9, 1.2],
  ],
]

/**
 * A bush: a low, rounded clump, a little longer than it is wide (along x), so a row of them
 * reads as a hedge. Hedges inside compound walls, and shrubs down the medians.
 */
const BUSH: Blob[] = [
  [0, 0.55, 0, 0.6],
  [0.55, 0.45, 0.08, 0.48],
  [-0.5, 0.48, -0.06, 0.5],
  [0.1, 0.8, 0.05, 0.42],
]

/** A bush's leaf cards, against a tree's. */
const BUSH_CARD_SCALE = 0.4

/** The bush's shape: leaf cards with a solid core when leafy, otherwise solid. */
export function createBushGeometry(leafy: boolean): THREE.BufferGeometry {
  return leafy ? createLeafyCanopy(BUSH, 4242, BUSH_CARD_SCALE) : createBlobs(BUSH)
}

/** The tree shapes, by name, as the planting in props.ts asks for them. The palm is drawn on its own (`createPalmGeometries`). */
export const TREE_SHAPE = { round: 0, tall: 1, wide: 2, umbrella: 3, column: 4, dome: 5, arch: 6 } as const
/** A tree planted without a shape gets one of the first this many (not the arch, which only avenues get). */
export const TREE_SHAPE_COUNT = 6
/** A coconut palm: its own trunk and crown, not one of the ball-built canopies. */
export const PALM = 7

/** Where each frond sits on the leaf image: [left, top, right, bottom], then its card's width and height. */
const FRONDS = [
  [0.155, 0.025, 0.99, 0.47, 3.3, 1.8],
  [0, 0.325, 0.425, 0.7, 2.2, 1.9],
  [0.25, 0.585, 1, 0.995, 3.1, 1.7],
]

/** Cards for each square metre of a ball's surface. */
const CARDS_PER_AREA = 0.55
/** The solid core only shows through gaps. It stops a tree looking hollow. */
const CORE_SHADE = 0.3
const CORE_SIZE = 0.72
/** The underside of a tree is this much darker than its top. */
const UNDERSIDE_SHADE = 0.5

/** Rough balls, joined together, make a leafy outline from very few triangles. */
function createBlobs(blobs: Blob[], scale = 1): THREE.BufferGeometry {
  const parts = blobs.map(([x, y, z, radius]) => {
    const blob = new THREE.IcosahedronGeometry(radius * scale, 0)
    blob.rotateY(x + z)
    blob.translate(x, y, z)
    return blob
  })

  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Could not merge canopy geometry')
  parts.forEach((part) => part.dispose())
  return merged
}

/** One solid shape for each kind of tree, for the Low setting. */
export function createCanopyGeometries(): THREE.BufferGeometry[] {
  return TREE_SHAPES.map((blobs) => createBlobs(blobs))
}

/** A leafy canopy: many cards around each ball, with a dark solid core inside. */
/** `cardScale` sizes the leaf cards: smaller for a bush, whose fronds are smaller than a tree's. */
function createLeafyCanopy(blobs: Blob[], seed: number, cardScale = 1): THREE.BufferGeometry {
  const random = createRandom(seed)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colors: number[] = []

  const out = new THREE.Vector3()
  const along = new THREE.Vector3()
  const across = new THREE.Vector3()
  const facing = new THREE.Vector3()

  for (const [blobX, blobY, blobZ, radius] of blobs) {
    // Smaller cards need more of them to cover the same ball.
    const cards = Math.round((4 * Math.PI * radius * radius * CARDS_PER_AREA) / (cardScale * cardScale))

    for (let card = 0; card < cards; card++) {
      // A random direction, using a method that doesn't bunch up at the poles.
      const height = random() * 2 - 1
      const angle = random() * Math.PI * 2
      const ring = Math.sqrt(1 - height * height)
      out.set(Math.cos(angle) * ring, height, Math.sin(angle) * ring)

      const distance = radius * (0.72 + random() * 0.3)
      const centreX = blobX + out.x * distance
      const centreY = blobY + out.y * distance
      const centreZ = blobZ + out.z * distance

      // Fronds run around the outside of the ball, and droop a little.
      along.set(random() - 0.5, random() - 0.5, random() - 0.5).cross(out).normalize()
      along.y -= 0.35
      along.normalize()
      across.crossVectors(out, along).normalize()

      const [left, top, right, bottom, frondWidth, frondLength] = FRONDS[Math.floor(random() * FRONDS.length)]
      const width = frondWidth * cardScale
      const length = frondLength * cardScale

      // All corners share one direction, which shades the canopy like one soft ball.
      facing.copy(out).setY(out.y + 0.5).normalize()
      const shade = UNDERSIDE_SHADE + (1 - UNDERSIDE_SHADE) * (out.y * 0.5 + 0.5)

      const corner = (sideways: number, lengthways: number, u: number, v: number) => {
        positions.push(
          centreX + along.x * sideways * width + across.x * lengthways * length,
          centreY + along.y * sideways * width + across.y * lengthways * length,
          centreZ + along.z * sideways * width + across.z * lengthways * length,
        )
        normals.push(facing.x, facing.y, facing.z)
        uvs.push(u, v)
        colors.push(shade, shade, shade)
      }

      // Images count from the bottom, so 1 minus each row.
      corner(-0.5, -0.5, left, 1 - bottom)
      corner(0.5, -0.5, right, 1 - bottom)
      corner(0.5, 0.5, right, 1 - top)
      corner(-0.5, -0.5, left, 1 - bottom)
      corner(0.5, 0.5, right, 1 - top)
      corner(-0.5, 0.5, left, 1 - top)
    }
  }

  const cards = new THREE.BufferGeometry()
  cards.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  cards.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  cards.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  cards.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const core = createBlobs(blobs, CORE_SIZE).toNonIndexed()
  const count = core.getAttribute('position').count
  // The middle of the leaf image is a solid part of a frond, so the core stays opaque.
  core.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2).fill(0.5), 2))
  core.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(count * 3).fill(CORE_SHADE), 3),
  )

  const merged = mergeGeometries([cards, core])
  if (!merged) throw new Error('Could not merge canopy geometry')
  cards.dispose()
  core.dispose()
  return merged
}

export function createLeafyCanopyGeometries(): THREE.BufferGeometry[] {
  return TREE_SHAPES.map((blobs, kind) => createLeafyCanopy(blobs, 2026 + kind))
}

/** A tapered trunk, with thick branches reaching up into the canopy. */
export function createTrunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, 4, 7)
  trunk.translate(0, 2, 0)

  const branches = [
    [0.55, 0.3],
    [-0.5, 2.3],
    [0.45, 4.4],
  ].map(([tilt, turn]) => {
    const branch = new THREE.CylinderGeometry(0.05, 0.13, 2.2, 5)
    branch.translate(0, 1.1, 0)
    branch.rotateZ(tilt)
    branch.rotateY(turn)
    branch.translate(0, 2.6, 0)
    return branch
  })

  const parts = [trunk, ...branches].map((part) => part.toNonIndexed())
  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Could not merge trunk geometry')
  ;[trunk, ...branches, ...parts].forEach((part) => part.dispose())
  return merged
}

/** A palm's crown, in metres up the trunk, and how many fronds it has, each in this many lengths. */
const PALM_TOP = 8.6
const PALM_FRONDS = 14
const FROND_STEPS = 5

/**
 * A coconut palm: a tall, thin trunk with a slight curve and rings, and a crown of fronds that
 * arch out and droop, each a strip narrowing to its tip. Vertex-coloured, no texture, about 120
 * triangles for the crown, so it's the same on every quality. The crown sits on the trunk's top.
 */
export function createPalmGeometries(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  // The trunk, bowed a little: a cylinder bent by moving each ring sideways.
  const trunk = new THREE.CylinderGeometry(0.13, 0.2, PALM_TOP, 7, 8).toNonIndexed()
  trunk.translate(0, PALM_TOP / 2, 0)
  const trunkPositions = trunk.getAttribute('position')
  for (let i = 0; i < trunkPositions.count; i++) {
    const up = trunkPositions.getY(i) / PALM_TOP
    trunkPositions.setX(i, trunkPositions.getX(i) + Math.sin(up * Math.PI * 0.9) * 0.35)
  }
  trunk.computeVertexNormals()

  const positions: number[] = []
  const colors: number[] = []
  const random = createRandom(9721)
  const green = new THREE.Color('#5b8a3a')
  const dry = new THREE.Color('#8d8a42')
  const topX = Math.sin(Math.PI * 0.9) * 0.35
  for (let frond = 0; frond < PALM_FRONDS; frond++) {
    const turn = (frond / PALM_FRONDS) * Math.PI * 2 + random() * 0.3
    const length = 3.2 + random() * 0.8
    const lift = 0.5 + random() * 0.4
    const shade = new THREE.Color().copy(green).lerp(dry, random() * 0.35)
    const point = (t: number, side: number): [number, number, number] => {
      // Out along the frond, arching up then drooping, its width narrowing to the tip.
      const out = t * length
      const height = PALM_TOP + Math.sin(t * Math.PI * 0.7) * lift - t * t * 1.6
      const width = 0.62 * (1 - t * 0.8) * side
      return [topX + Math.cos(turn) * out - Math.sin(turn) * width, height, Math.sin(turn) * out + Math.cos(turn) * width]
    }
    for (let step = 0; step < FROND_STEPS; step++) {
      const [a, b] = [step / FROND_STEPS, (step + 1) / FROND_STEPS]
      for (const corner of [point(a, -1), point(b, -1), point(b, 1), point(a, -1), point(b, 1), point(a, 1)]) {
        positions.push(...corner)
        colors.push(shade.r, shade.g, shade.b)
      }
    }
  }
  // Each frond's back face too, so it shows from below (the material draws front faces only).
  const frontCount = positions.length / 9
  for (let triangle = 0; triangle < frontCount; triangle++) {
    for (const corner of [0, 2, 1]) {
      const at = (triangle * 3 + corner) * 3
      positions.push(positions[at], positions[at + 1], positions[at + 2])
      colors.push(colors[at] * 0.8, colors[at + 1] * 0.8, colors[at + 2] * 0.8)
    }
  }
  // A cluster of coconuts under the crown.
  const nuts = new THREE.IcosahedronGeometry(0.42, 0).toNonIndexed()
  nuts.translate(topX, PALM_TOP - 0.35, 0)
  const nutColor = new THREE.Color('#6b5a2a')
  for (let i = 0; i < nuts.getAttribute('position').count; i++) {
    positions.push(nuts.getAttribute('position').getX(i), nuts.getAttribute('position').getY(i), nuts.getAttribute('position').getZ(i))
    colors.push(nutColor.r, nutColor.g, nutColor.b)
  }
  nuts.dispose()
  const crown = new THREE.BufferGeometry()
  crown.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  crown.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  crown.computeVertexNormals()
  return { trunk, crown }
}

/**
 * A bougainvillea spilling over a compound wall, in metres. X runs along the
 * wall, Y is up from the wall's top, and Z points out to the road.
 */
const CREEPER_FLOWERS: Blob[] = [
  [0, 0.2, 0.1, 0.5],
  [0.75, 0.1, 0.22, 0.42],
  [-0.8, 0.15, 0.2, 0.46],
  [0.35, -0.3, 0.38, 0.36],
  [-0.4, -0.35, 0.4, 0.34],
  [1.3, 0, 0.12, 0.3],
]
const CREEPER_LEAVES: Blob[] = [
  [0.2, 0.05, -0.15, 0.5],
  [-0.6, 0, -0.1, 0.45],
  [0.9, -0.05, -0.1, 0.4],
  [-1.25, -0.1, 0.1, 0.3],
  [0, -0.5, 0.3, 0.28],
]
/** Leaf cards are sized for trees, so a creeper is built this much too big, then shrunk. */
const CREEPER_SCALE = 3.4

function createCreeper(blobs: Blob[], leafy: boolean, seed: number): THREE.BufferGeometry {
  const big = blobs.map(([x, y, z, radius]): Blob => [
    x * CREEPER_SCALE,
    y * CREEPER_SCALE,
    z * CREEPER_SCALE,
    radius * CREEPER_SCALE,
  ])
  const geometry = leafy ? createLeafyCanopy(big, seed) : createBlobs(big)
  geometry.scale(1 / CREEPER_SCALE, 1 / CREEPER_SCALE, 1 / CREEPER_SCALE)
  return geometry
}

/** The green and the flowering halves of a bougainvillea, which are tinted separately. */
export function createCreeperGeometries(leafy: boolean): { leaves: THREE.BufferGeometry; flowers: THREE.BufferGeometry } {
  return {
    leaves: createCreeper(CREEPER_LEAVES, leafy, 3101),
    flowers: createCreeper(CREEPER_FLOWERS, leafy, 3102),
  }
}

/** Fallen petals under a tree in flower: small flat diamonds, thickest near the trunk. */
export function createPetalGeometry(): THREE.BufferGeometry {
  const random = createRandom(4401)
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const PETALS = 260
  const REACH = 3.6
  const HEIGHT = 0.065

  for (let petal = 0; petal < PETALS; petal++) {
    // Squaring nothing spreads them evenly; this bunches them a little towards the middle.
    const distance = 0.5 + Math.pow(random(), 0.75) * REACH
    const angle = random() * Math.PI * 2
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance
    // A petal is longer than it is wide: about 12 cm by 6 cm.
    const size = 0.04 + random() * 0.035
    const turn = random() * Math.PI
    const alongX = Math.cos(turn) * size
    const alongZ = Math.sin(turn) * size
    const shade = 0.75 + random() * 0.25
    const corners = [
      [x - alongX, z - alongZ],
      [x - alongZ * 0.5, z + alongX * 0.5],
      [x + alongX, z + alongZ],
      [x + alongZ * 0.5, z - alongX * 0.5],
    ]
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(corners[index][0], HEIGHT, corners[index][1])
      normals.push(0, 1, 0)
      colors.push(shade, shade, shade)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}
