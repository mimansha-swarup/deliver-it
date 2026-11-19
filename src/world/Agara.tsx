import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { isSaturday, PLINTH, STATUE_HEIGHT, type Agara as AgaraPlan } from './agaraPlacement'
import { ShopPeople } from './ShopPeople'
import { box, colored, merge } from './simpleShapes'
import { StiltParking } from './StiltParking'

/*
 * The Abhaya Anjaneya statue at Agara and the life at its temple's door (agaraPlacement.ts).
 *
 * The statue is one shape (about 24,000 triangles near by, 4,600 far off), drawn at any distance (the haze takes it far
 * off, as it does everything), so it stands over the rooftops from much of the map. Painted stone
 * with gilded crown, mace and ornaments; at night it's floodlit: a warm glow that comes up with the
 * street lamps.
 */

// Painted, as the real statue is (a 102 ft idol "in colourful royal attire", crowned and jewelled, on a
// lotus pedestal): warm skin, a red dhoti edged in gold with a green sash, gold crown, mace and jewels.
const SKIN = '#d79a5e'
const SKIN_SHADE = '#c4854c'
const MUZZLE = '#c65a4a'
const CLOTH = '#b5302a'
const SASH = '#2f7d55'
const GOLD = '#dba93a'
const GOLD_DEEP = '#c08a26'
const GEM_RED = '#b3202a'
const GEM_GREEN = '#1f7a4d'
const GARLAND = '#ee8a1f'
const JASMINE = '#f4efe0'
const LOTUS = '#e58fa2'
const LOTUS_DEEP = '#cf6f88'
const EYE_WHITE = '#f3efe6'
const DARK = '#2a211c'
const TEMPLE_WALL = '#f2ead8'
const TEMPLE_BAND = '#a8432b'
const TEMPLE_STONE = '#cfc6b4'

type Vec = [number, number, number]

const solid = (geometry: THREE.BufferGeometry, color: string) => colored(geometry.index ? geometry.toNonIndexed() : geometry, color)

/**
 * A round, tapering form swept along a smooth curve through `points`, `radii` at each: limbs, the
 * torso, the tail. `squash` flattens it across and front to back (a chest is wider than it's deep).
 * Its corners are shared, so it's smooth-shaded.
 */
function sweep(points: Vec[], radii: number[], color: string, { around = 16, rings = 14, squash = [1, 1] as [number, number] } = {}): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, 'centripetal')
  const radiusCurve = new THREE.CatmullRomCurve3(radii.map((radius, i) => new THREE.Vector3(radius, i, 0)), false, 'centripetal')
  const positions: number[] = []
  const index: number[] = []
  const reference = new THREE.Vector3(1, 0, 0)
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings
    const centre = curve.getPoint(t)
    const tangent = curve.getTangent(t)
    const radius = radiusCurve.getPoint(t).x
    const side = reference.clone().addScaledVector(tangent, -reference.dot(tangent))
    if (side.lengthSq() < 1e-4) side.set(0, 0, 1)
    side.normalize()
    const forward = tangent.clone().cross(side).normalize()
    for (let i = 0; i < around; i++) {
      const angle = (i / around) * Math.PI * 2
      const point = centre.clone().addScaledVector(side, Math.cos(angle) * radius * squash[0]).addScaledVector(forward, Math.sin(angle) * radius * squash[1])
      positions.push(point.x, point.y, point.z)
    }
  }
  for (let ring = 0; ring < rings; ring++) {
    for (let i = 0; i < around; i++) {
      const a = ring * around + i
      const b = ring * around + ((i + 1) % around)
      const c = a + around
      const d = b + around
      index.push(a, b, c, b, d, c)
    }
  }
  // The ends, closed with a fan each.
  for (const [ring, t, flip] of [[0, 0, false], [rings, 1, true]] as const) {
    const centre = curve.getPoint(t)
    const at = positions.length / 3
    positions.push(centre.x, centre.y, centre.z)
    for (let i = 0; i < around; i++) {
      const a = ring * around + i
      const b = ring * around + ((i + 1) % around)
      if (flip) index.push(at, a, b)
      else index.push(at, b, a)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return solid(geometry, color)
}

/** A form turned on a lathe round the upright axis at (x, z): `profile` is [radius, height] up its side. */
function lathe(profile: [number, number][], at: [number, number], color: string, around = 20): THREE.BufferGeometry {
  const geometry = new THREE.LatheGeometry(profile.map(([radius, height]) => new THREE.Vector2(Math.max(0.001, radius), height)), around)
  geometry.translate(at[0], 0, at[1])
  return solid(geometry, color)
}

function ball(at: Vec, radius: number, color: string, squash: Vec = [1, 1, 1], around = 16): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, around, Math.max(6, Math.round(around * 0.7)))
  geometry.scale(...squash)
  // Squashing leaves the normals a ball's: worked out again, while its corners are still shared.
  geometry.computeVertexNormals()
  geometry.translate(...at)
  return solid(geometry, color)
}

/** A ring (a bangle, a necklace) lying flat at `at`, then tipped by `tilt` round x and `lean` round z. */
function ring(at: Vec, radius: number, thickness: number, color: string, { tilt = 0, lean = 0, squash = [1, 1, 1] as Vec, around = 18 } = {}): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, thickness, 6, around)
  geometry.rotateX(Math.PI / 2)
  geometry.scale(...squash)
  geometry.rotateX(tilt)
  geometry.rotateZ(lean)
  geometry.computeVertexNormals()
  geometry.translate(...at)
  return solid(geometry, color)
}

/** The little temple he stands over: its top, in metres. And the lotus pedestal on it. */
const SHRINE_TOP = 5.6
const LOTUS_TOP = SHRINE_TOP + 1.3

/**
 * Hanuman standing, facing +z: right hand raised, palm out, in blessing (abhaya); the mace (gada)
 * held upright at his left side, its head by his shoulder; his tail rising in an arc behind his head.
 * He stands on a lotus pedestal on the roof of a small temple, the shrine at his feet.
 * Drawn 1 unit to the metre, the temple's foot at 0 and the crown's tip at STATUE_HEIGHT.
 * `fine` is the version for near by; without it, the same figure in far fewer triangles, for far off.
 */
function createStatueGeometry(fine: boolean): THREE.BufferGeometry {
  const figure = STATUE_HEIGHT - LOTUS_TOP
  const u = figure / 26 // The figure is modelled 26 units tall.
  const y = (units: number) => LOTUS_TOP + units * u
  const around = fine ? 14 : 8
  const rings = fine ? 10 : 6
  const round = fine ? 12 : 8
  const limb = (points: Vec[], radii: number[], color: string, squash: [number, number] = [1, 1]) =>
    sweep(points.map(([px, py, pz]): Vec => [px * u, y(py), pz * u]), radii.map((radius) => radius * u), color, { around, rings, squash })
  const orb = (at: Vec, radius: number, color: string, squash: Vec = [1, 1, 1]) => ball([at[0] * u, y(at[1]), at[2] * u], radius * u, color, squash, round)
  const band = (at: Vec, radius: number, thickness: number, color: string, options: { tilt?: number; lean?: number; squash?: Vec } = {}) =>
    ring([at[0] * u, y(at[1]), at[2] * u], radius * u, thickness * u, color, { ...options, around: fine ? 16 : 10 })
  const parts: THREE.BufferGeometry[] = []

  // ---- The temple at his feet: a pillared shrine, banded in red, its door to the front ----
  const half = PLINTH / 2
  parts.push(box([PLINTH + 2.4, 0.3, PLINTH + 2.4], [0, 0.15, 0], TEMPLE_STONE))
  parts.push(box([PLINTH + 1.4, 0.3, PLINTH + 1.4], [0, 0.45, 0], TEMPLE_STONE))
  parts.push(box([PLINTH, 0.5, PLINTH], [0, 0.85, 0], TEMPLE_BAND))
  parts.push(box([PLINTH - 0.3, 3.4, PLINTH - 0.3], [0, 2.8, 0], TEMPLE_WALL))
  parts.push(box([PLINTH, 0.35, PLINTH], [0, 4.65, 0], TEMPLE_BAND))
  parts.push(box([PLINTH + 0.5, 0.25, PLINTH + 0.5], [0, 4.95, 0], TEMPLE_STONE))
  parts.push(box([PLINTH - 0.2, 0.5, PLINTH - 0.2], [0, 5.3, 0], TEMPLE_WALL))
  if (fine) {
    // The door, dark within, in a gold frame under a red lintel, and steps up to it.
    parts.push(box([2.0, 2.7, 0.2], [0, 2.45, half - 0.1], DARK))
    parts.push(box([2.5, 0.3, 0.3], [0, 3.95, half - 0.05], TEMPLE_BAND))
    for (const side of [-1, 1]) parts.push(box([0.25, 2.9, 0.3], [side * 1.15, 2.55, half - 0.05], GOLD_DEEP))
    for (let step = 0; step < 3; step++) parts.push(box([3.2 - step * 0.3, 0.27, 0.5], [0, 0.4 + step * 0.27, half + 1.0 - step * 0.4], TEMPLE_STONE))
    // Pilasters round the walls, and a little kalasha at each corner of the roof.
    for (const side of [-1, 1]) {
      for (const along of [-0.62, -0.25, 0.25, 0.62]) {
        parts.push(box([0.35, 3.4, 0.2], [along * PLINTH, 2.8, side * (half - 0.1)], TEMPLE_STONE))
        parts.push(box([0.2, 3.4, 0.35], [side * (half - 0.1), 2.8, along * PLINTH], TEMPLE_STONE))
      }
      for (const other of [-1, 1]) {
        parts.push(lathe([[0.01, 5.55], [0.32, 5.6], [0.4, 5.85], [0.18, 6.1], [0.22, 6.2], [0.01, 6.5]], [side * (half - 0.5), other * (half - 0.5)], GOLD, 10))
      }
    }
  }
  // The lotus pedestal: a drum, and two rows of petals turned out.
  parts.push(lathe([[3.9, SHRINE_TOP - 0.05], [4.2, SHRINE_TOP + 0.25], [3.7, SHRINE_TOP + 0.55], [4.0, SHRINE_TOP + 0.9], [3.6, LOTUS_TOP], [0.01, LOTUS_TOP]], [0, 0], LOTUS_DEEP, fine ? 28 : 12))
  if (fine) {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 18; i++) {
        const angle = ((i + row * 0.5) / 18) * Math.PI * 2
        const petal = new THREE.SphereGeometry(0.62, 6, 4)
        petal.scale(0.75, 1, 0.3)
        petal.rotateX(row === 0 ? 0.75 : 0.35)
        petal.computeVertexNormals()
        petal.translate(0, SHRINE_TOP + 0.45 + row * 0.45, 3.85 - row * 0.2)
        petal.rotateY(angle)
        parts.push(solid(petal, row === 0 ? LOTUS : LOTUS_DEEP))
      }
    }
  }

  // ---- Legs and feet ----
  for (const side of [-1, 1]) {
    parts.push(limb([[side * 1.5, 0.5, 0], [side * 1.48, 2.6, -0.1], [side * 1.42, 5.3, 0.15], [side * 1.3, 8.0, 0], [side * 1.05, 10.8, 0]], [0.78, 1.12, 0.98, 1.5, 1.7], SKIN))
    parts.push(orb([side * 1.5, 0.42, 0.75], 0.95, SKIN_SHADE, [1, 0.45, 1.75]))
    parts.push(band([side * 1.5, 1.05, 0], 0.98, 0.17, GOLD))
    if (fine) {
      parts.push(band([side * 1.5, 1.4, 0], 0.95, 0.1, GOLD_DEEP))
      for (let toe = 0; toe < 5; toe++) parts.push(orb([side * 1.5 + (toe - 2) * 0.34, 0.3, 2.25 - Math.abs(toe - 2) * 0.12], 0.2, SKIN_SHADE, [1, 0.8, 1.3]))
    }
  }

  // ---- The dhoti: red cloth from the waist to the knees, gold at its hem, a green sash, pleats in front ----
  parts.push(lathe([[0.01, 5.9], [2.95, 6.0], [3.0, 6.5], [2.85, 8.5], [2.6, 10.6], [2.45, 12.0], [0.01, 12.0]].map(([r, h]): [number, number] => [r * u, y(h)]), [0, 0], CLOTH, fine ? 24 : 10))
  parts.push(band([0, 6.25, 0], 2.98, 0.2, GOLD))
  parts.push(band([0, 11.9, 0], 2.5, 0.34, SASH))
  parts.push(band([0, 12.3, 0], 2.42, 0.2, GOLD))
  if (fine) {
    parts.push(band([0, 6.75, 0], 2.97, 0.09, GOLD_DEEP))
    // Pleats fanning down the front, and the sash's ends hanging beside them.
    for (let pleat = -2; pleat <= 2; pleat++) parts.push(limb([[pleat * 0.28, 11.6, 2.45], [pleat * 0.42, 8.6, 2.95], [pleat * 0.55, 6.1, 3.1]], [0.22, 0.3, 0.36], pleat % 2 === 0 ? GOLD : CLOTH, [1, 0.5]))
    for (const side of [-1, 1]) parts.push(limb([[side * 1.3, 11.8, 2.2], [side * 1.55, 9.6, 2.75], [side * 1.5, 7.6, 2.95]], [0.3, 0.34, 0.42], SASH, [1, 0.4]))
    // The belt's clasp.
    parts.push(orb([0, 12.25, 2.45], 0.5, GOLD, [1, 1, 0.5]))
    parts.push(orb([0, 12.25, 2.62], 0.22, GEM_RED, [1, 1, 0.6]))
  }

  // ---- Torso: waist to a broad chest and shoulders ----
  parts.push(limb([[0, 11.8, 0], [0, 13.4, 0], [0, 15.4, 0.1], [0, 17.0, 0.15], [0, 18.3, 0.05], [0, 19.0, 0]], [2.3, 2.1, 2.55, 2.95, 2.5, 1.2], SKIN, [1.18, 0.8]))
  for (const side of [-1, 1]) parts.push(orb([side * 3.25, 17.55, 0], 1.38, SKIN))
  if (fine) {
    // The chest's two planes and the navel, lightly.
    for (const side of [-1, 1]) parts.push(orb([side * 1.25, 16.7, 1.75], 1.25, SKIN, [1, 0.8, 0.5]))
    parts.push(orb([0, 13.3, 1.72], 0.16, SKIN_SHADE, [1, 1.3, 0.5]))
  }

  // ---- Jewels on the chest: two necklaces, a pendant, the sacred thread, and a long garland ----
  parts.push(band([0, 18.5, 0.45], 1.3, 0.2, GOLD, { tilt: -0.3 }))
  parts.push(band([0, 17.6, 1.0], 2.05, 0.16, GOLD, { tilt: -0.5 }))
  parts.push(band([0, 15.3, 1.2], 2.5, 0.34, GARLAND, { tilt: -1.02, squash: [1, 1, 1.45] }))
  if (fine) {
    parts.push(band([0, 15.5, 1.3], 2.2, 0.16, JASMINE, { tilt: -1.02, squash: [1, 1, 1.45] }))
    parts.push(orb([0, 16.05, 2.4], 0.42, GOLD, [1, 1.2, 0.5]))
    parts.push(orb([0, 16.05, 2.56], 0.2, GEM_GREEN, [1, 1.2, 0.6]))
  }

  // ---- His right arm (at -x, as he faces +z): raised, the open palm out in blessing ----
  parts.push(limb([[-3.4, 17.5, 0], [-4.35, 15.9, 0.35], [-4.75, 14.5, 0.9]], [1.2, 1.1, 0.95], SKIN))
  parts.push(limb([[-4.75, 14.5, 0.9], [-4.7, 16.2, 1.7], [-4.5, 17.9, 2.3]], [0.98, 0.9, 0.66], SKIN))
  parts.push(orb([-4.75, 14.5, 0.9], 0.98, SKIN))
  parts.push(orb([-4.45, 19.0, 2.5], 1.0, SKIN, [0.95, 1.15, 0.36]))
  parts.push(band([-4.05, 16.3, 0.3], 1.14, 0.2, GOLD, { lean: -0.5 }))
  parts.push(band([-4.52, 17.7, 2.22], 0.74, 0.16, GOLD, { tilt: 0.35 }))
  if (fine) {
    // Four fingers together, upright, and the thumb beside them; a mark in the palm.
    for (let finger = 0; finger < 4; finger++) {
      const fx = -4.45 + (finger - 1.5) * 0.44
      const length = 1.35 - Math.abs(finger - 1.4) * 0.16
      parts.push(limb([[fx, 19.7, 2.5], [fx, 19.7 + length * 0.55, 2.52], [fx, 19.7 + length, 2.5]], [0.23, 0.21, 0.17], SKIN))
    }
    parts.push(limb([[-3.6, 18.7, 2.5], [-3.25, 19.3, 2.55], [-3.15, 19.9, 2.5]], [0.26, 0.23, 0.18], SKIN))
    parts.push(orb([-4.45, 19.0, 2.7], 0.3, MUZZLE, [1, 1, 0.3]))
    parts.push(band([-4.52, 17.35, 2.12], 0.76, 0.1, GOLD_DEEP, { tilt: 0.35 }))
  }

  // ---- His left arm: down at his side, the hand on the mace's shaft ----
  parts.push(limb([[3.4, 17.5, 0], [4.05, 15.6, 0.1], [4.4, 13.7, 0.35]], [1.2, 1.1, 0.95], SKIN))
  parts.push(limb([[4.4, 13.7, 0.35], [4.6, 12.2, 0.85], [4.68, 10.9, 1.35]], [0.98, 0.88, 0.68], SKIN))
  parts.push(orb([4.4, 13.7, 0.35], 0.98, SKIN))
  parts.push(orb([4.72, 10.5, 1.55], 0.82, SKIN, [1, 0.9, 1]))
  parts.push(band([3.85, 16.2, 0.05], 1.14, 0.2, GOLD, { lean: 0.35 }))
  parts.push(band([4.64, 11.3, 1.2], 0.76, 0.16, GOLD, { tilt: 0.35 }))

  // ---- The mace: its shaft from the lotus to his shoulder, a ribbed head and a finial ----
  const maceX = 4.75 * u
  const maceZ = 1.6 * u
  const mace = (profile: [number, number][], color: string) => lathe(profile.map(([r, h]): [number, number] => [r * u, y(h)]), [maceX, maceZ], color, fine ? 18 : 8)
  parts.push(mace([[0.01, 0.1], [0.6, 0.15], [0.62, 0.5], [0.34, 0.8], [0.32, 14.6], [0.55, 14.8], [0.55, 15.1], [0.01, 15.1]], GOLD_DEEP))
  parts.push(mace([[0.01, 15.0], [0.7, 15.1], [1.55, 15.9], [1.95, 17.0], [1.8, 18.1], [1.15, 19.0], [0.5, 19.4], [0.42, 19.9], [0.6, 20.1], [0.3, 20.5], [0.01, 21.0]], GOLD))
  if (fine) {
    for (let rib = 0; rib < 8; rib++) {
      const angle = (rib / 8) * Math.PI * 2
      parts.push(orb([4.75 + Math.cos(angle) * 1.72, 17.1, 1.6 + Math.sin(angle) * 1.72], 0.55, GOLD_DEEP, [0.55, 2.6, 0.55]))
    }
    parts.push(mace([[1.6, 15.75], [1.72, 15.9], [1.6, 16.05]], GEM_RED))
    parts.push(mace([[1.3, 18.75], [1.42, 18.9], [1.3, 19.05]], GEM_RED))
  }

  // ---- Neck and head ----
  parts.push(limb([[0, 18.7, 0], [0, 19.4, 0.1], [0, 20.1, 0.15]], [1.15, 1.0, 1.0], SKIN))
  parts.push(orb([0, 21.2, 0.15], 1.78, SKIN, [0.98, 1.08, 1]))
  // The muzzle, forward and full, as Hanuman's is; the jaw under it.
  parts.push(orb([0, 20.55, 1.3], 1.02, MUZZLE, [1.12, 0.82, 1]))
  parts.push(orb([0, 20.0, 0.75], 1.05, SKIN, [1.05, 0.7, 1]))
  for (const side of [-1, 1]) {
    parts.push(orb([side * 1.72, 21.25, 0.05], 0.52, SKIN_SHADE, [0.5, 1, 0.8]))
    parts.push(band([side * 1.9, 20.35, 0.15], 0.34, 0.11, GOLD, { tilt: Math.PI / 2 }))
  }
  if (fine) {
    // A calm face: eyes half closed under level brows, a small nose, the mouth a quiet line, a tilak.
    for (const side of [-1, 1]) {
      parts.push(orb([side * 0.68, 21.5, 1.62], 0.3, EYE_WHITE, [1.25, 0.62, 0.5]))
      parts.push(orb([side * 0.68, 21.47, 1.74], 0.15, DARK, [1, 1, 0.5]))
      parts.push(orb([side * 0.68, 21.68, 1.62], 0.33, SKIN, [1.3, 0.5, 0.55]))
      parts.push(limb([[side * 0.28, 21.95, 1.72], [side * 0.7, 22.05, 1.66], [side * 1.12, 21.92, 1.45]], [0.07, 0.09, 0.06], DARK))
      parts.push(orb([side * 1.0, 20.75, 1.2], 0.55, SKIN, [1, 0.9, 0.7]))
      parts.push(orb([side * 0.16, 20.85, 2.22], 0.09, DARK, [1, 0.7, 0.6]))
    }
    parts.push(orb([0, 21.0, 2.05], 0.3, MUZZLE, [1, 1.25, 0.9]))
    parts.push(limb([[-0.55, 20.3, 2.08], [0, 20.24, 2.28], [0.55, 20.3, 2.08]], [0.05, 0.06, 0.05], DARK))
    parts.push(orb([0, 22.1, 1.74], 0.16, GEM_RED, [0.7, 1.9, 0.4]))
  }

  // ---- The crown: a jewelled band, tiers narrowing to a finial ----
  const crown = (profile: [number, number][], color: string) => lathe(profile.map(([r, h]): [number, number] => [r * u, y(h)]), [0, 0.1 * u], color, fine ? 20 : 8)
  parts.push(crown([[1.86, 22.2], [1.95, 22.45], [1.86, 22.75], [1.7, 22.85], [1.78, 23.3], [1.45, 23.75], [1.5, 24.05], [1.05, 24.6], [1.1, 24.85], [0.6, 25.3], [0.38, 25.45], [0.52, 25.65], [0.2, 25.85], [0.01, 26.0]], GOLD))
  if (fine) {
    for (let gem = 0; gem < 10; gem++) {
      const angle = (gem / 10) * Math.PI * 2
      parts.push(orb([Math.sin(angle) * 1.93, 22.47, 0.1 + Math.cos(angle) * 1.93], 0.17, gem % 2 === 0 ? GEM_RED : GEM_GREEN))
    }
    parts.push(crown([[1.74, 23.2], [1.84, 23.3], [1.74, 23.4]], GOLD_DEEP))
    parts.push(crown([[1.48, 23.98], [1.56, 24.06], [1.48, 24.14]], GOLD_DEEP))
    // The crest at the crown's front.
    parts.push(orb([0, 23.4, 1.7], 0.5, GOLD, [0.8, 1.5, 0.35]))
    parts.push(orb([0, 23.4, 1.85], 0.2, GEM_RED, [0.8, 1.4, 0.5]))
  }

  // ---- The tail: from the base of his back, out behind and up in an arc over his head ----
  parts.push(limb([[0, 11.4, -1.9], [0.5, 10.9, -4.6], [1.0, 14.6, -6.9], [0.8, 20.4, -6.6], [0.2, 24.3, -4.4], [0, 25.0, -3.0]], [0.62, 0.6, 0.56, 0.5, 0.42, 0.36], SKIN_SHADE))
  parts.push(orb([0, 25.05, -2.75], 0.62, SKIN_SHADE, [0.9, 0.9, 1.3]))

  const statue = merge(parts)
  statue.computeBoundingSphere()
  return statue
}

/** A seller's stall, its front to +z: a low table of marigold garlands, or coconuts heaped round a basket. */
function createStallGeometry(coconuts: boolean): THREE.BufferGeometry {
  const parts = [
    box([1.7, 0.08, 0.9], [0, 0.62, 0], '#7a5230'),
    ...[-0.75, 0.75].flatMap((x) => [-0.35, 0.35].map((z) => box([0.06, 0.6, 0.06], [x, 0.3, z], '#3a2c20'))),
    // A cloth awning on two poles.
    ...[-0.8, 0.8].map((x) => box([0.05, 1.9, 0.05], [x, 0.95, -0.42], '#4a4d51')),
    box([1.9, 0.05, 1.2], [0, 1.92, 0], coconuts ? '#3f7d5a' : '#c9452f'),
  ]
  if (coconuts) {
    for (let i = 0; i < 9; i++) parts.push(ball([-0.6 + (i % 5) * 0.3, 0.76 + Math.floor(i / 5) * 0.2, -0.1 + (i % 2) * 0.22], 0.14, i % 3 === 0 ? '#8a6a45' : '#6f8f3c'))
    parts.push(box([0.5, 0.25, 0.4], [0.5, 0.78, 0.15], '#b58a4c'))
  } else {
    // Garlands in coils: marigold orange and yellow, jasmine white.
    ;['#e8862a', '#f2b705', '#f3efe2', '#e8862a', '#f2b705'].forEach((color, i) => {
      const coil = new THREE.TorusGeometry(0.15, 0.06, 5, 10)
      coil.rotateX(Math.PI / 2).translate(-0.62 + i * 0.31, 0.72, 0.05)
      parts.push(solid(coil, color))
    })
    parts.push(box([1.5, 0.3, 0.04], [0, 1.55, -0.4], '#e8862a'))
  }
  return merge(parts)
}

/** Footwear left outside a door: a dozen pairs of sandals and slippers, set down any way. */
function createFootwearGeometry(): THREE.BufferGeometry {
  const colors = ['#3a2c20', '#7a5230', '#2b3a55', '#8c2f2a', '#4a4d51', '#c9b38a']
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 12; i++) {
    const x = ((i * 37) % 11) / 11 - 0.5
    const z = ((i * 53) % 7) / 7 - 0.5
    const turn = (((i * 29) % 9) / 9 - 0.5) * 0.9
    for (const side of [-0.07, 0.07]) {
      const shoe = box([0.09, 0.03, 0.25], [side, 0.015, 0], colors[i % colors.length])
      shoe.rotateY(turn).translate(x * 1.5, 0, z * 0.9)
      parts.push(shoe)
    }
  }
  return merge(parts)
}

/** Each plan item's shape, turned and moved to where it stands, all in one shape. */
function placeAll(items: { x: number; z: number; rotation: number; variation: number }[], shape: (item: { variation: number }) => THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (items.length === 0) return null
  return merge(items.map((item) => shape(item).rotateY(item.rotation).translate(item.x, 0, item.z)))
}

/** Nearer than this, the fine statue; further, the plain one. With a margin, so it doesn't flicker at the line. */
const FINE_WITHIN = 260
const FINE_MARGIN = 20

// One of each for the game's life (there's one Agara), so the frame loop may change the statue's glow.
// Floodlit after dark: the paint's own colours lit warm, not a flat glow over them (`uFlood`).
const flood = { value: 0 }
const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 })
stone.onBeforeCompile = (shader) => {
  shader.uniforms.uFlood = flood
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uFlood;\nvoid main() {')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.66) * uFlood;')
}
const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })

export function Agara({ agara }: { agara: AgaraPlan }) {
  const day = useGameStore((state) => state.day)
  const statue = useMemo(() => (agara.statue ? { fine: createStatueGeometry(true), far: createStatueGeometry(false) } : null), [agara])
  const details = useMemo(() => {
    const stalls = placeAll(agara.stalls, ({ variation }) => createStallGeometry(variation >= 0.5))
    const footwear = placeAll(agara.footwear, createFootwearGeometry)
    const parts = [stalls, footwear].filter((part): part is THREE.BufferGeometry => part !== null)
    return parts.length ? merge(parts) : null
  }, [agara])
  useEffect(() => () => {
    statue?.fine.dispose()
    statue?.far.dispose()
    details?.dispose()
  }, [statue, details])
  const crowd = useMemo(() => ({ standing: agara.crowd, walkers: [] }), [agara])
  const fineMesh = useRef<THREE.Mesh>(null)
  const farMesh = useRef<THREE.Mesh>(null)
  const isFine = useRef(false)

  useFrame(({ camera }) => {
    // Floodlit after dark, coming up with the street lamps.
    flood.value = liveSky.look.night * 0.5
    // The fine statue near by, the plain one far off; a margin either side of the line.
    if (!agara.statue || !fineMesh.current || !farMesh.current) return
    const distance = Math.hypot(camera.position.x - agara.statue.x, camera.position.z - agara.statue.z)
    isFine.current = distance < FINE_WITHIN + (isFine.current ? FINE_MARGIN : -FINE_MARGIN)
    fineMesh.current.visible = isFine.current
    farMesh.current.visible = !isFine.current
  })

  return (
    <>
      {statue && agara.statue && (
        <group position={[agara.statue.x, 0, agara.statue.z]} rotation={[0, agara.statue.rotation, 0]}>
          <mesh ref={fineMesh} geometry={statue.fine} material={stone} castShadow receiveShadow />
          <mesh ref={farMesh} geometry={statue.far} material={stone} visible={false} />
        </group>
      )}
      {details && <mesh geometry={details} material={plain} castShadow receiveShadow />}
      <StiltParking vehicles={agara.autos} carModels={AUTO_ONLY} drawDistance={120} />
      {isSaturday(day) && agara.crowd.length > 0 && <ShopPeople people={crowd} />}
    </>
  )
}

const AUTO_ONLY = ['auto'] as const
