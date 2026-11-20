import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { colored, merge } from '../world/simpleShapes'
import { HIP } from './gait'

/** What a part of a person does when they walk. */
type Part = {
  geometry: THREE.BufferGeometry
  color: string
  /** 1 means it takes the person's clothing colour, and 0 means it keeps its own. */
  clothing?: number
  /** Swings forward (+1) or back (-1) on each step. 0 stays still. */
  swing?: number
  /** The height of the joint it swings from, such as the hip. */
  joint?: number
}

const SKIN = '#b98a68'
const HAIR = '#141210'
const WHITE = '#ffffff'
const TROUSERS = '#333c4b'
const SHOES = '#1c1a18'

const SHOULDER = 1.38

function cylinder(top: number, bottom: number, height: number, x: number, y: number, z = 0, rings = 1) {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 7, rings)
  geometry.translate(x, y, z)
  return geometry
}

function ball(radius: number, y: number, z = 0, x = 0) {
  const geometry = new THREE.SphereGeometry(radius, 8, 6)
  geometry.translate(x, y, z)
  return geometry
}

function build(parts: Part[]): THREE.BufferGeometry {
  return merge(
    parts.map(({ geometry, color, clothing = 0, swing = 0, joint = 0 }) => {
      const flat = colored(geometry.toNonIndexed(), color)
      geometry.dispose()

      const count = flat.getAttribute('position').count
      const limb = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) limb.set([swing, joint, clothing], i * 3)
      flat.setAttribute('_limb', new THREE.BufferAttribute(limb, 3))
      return flat
    }),
  )
}

const head: Part[] = [
  { geometry: ball(0.115, 1.6), color: SKIN },
  { geometry: cylinder(0.05, 0.055, 0.1, 0, 1.46), color: SKIN },
]

function arms(sleeve: boolean): Part[] {
  return [-1, 1].flatMap((side) => {
    const x = side * 0.235
    const swing = -side
    return [
      {
        geometry: cylinder(0.052, 0.046, 0.3, x, SHOULDER - 0.15),
        color: sleeve ? WHITE : SKIN,
        clothing: sleeve ? 1 : 0,
        swing,
        joint: SHOULDER,
      },
      {
        geometry: cylinder(0.044, 0.036, 0.3, x, SHOULDER - 0.45),
        color: SKIN,
        swing,
        joint: SHOULDER,
      },
    ]
  })
}

/** A man in a shirt and dark trousers. */
export function createManGeometry(): THREE.BufferGeometry {
  return build([
    ...head,
    { geometry: ball(0.12, 1.645, -0.012), color: HAIR },
    { geometry: cylinder(0.205, 0.17, 0.62, 0, 1.13), color: WHITE, clothing: 1 },
    ...[-1, 1].flatMap((side): Part[] => [
      {
        geometry: cylinder(0.09, 0.065, 0.8, side * 0.095, HIP - 0.4, 0, 2),
        color: TROUSERS,
        swing: side,
        joint: HIP,
      },
      {
        geometry: cylinder(0.05, 0.06, 0.07, side * 0.095, 0.035, 0.05),
        color: SHOES,
        swing: side,
        joint: HIP,
      },
    ]),
    ...arms(true),
  ])
}

/** A dupatta's colour: a muted terracotta, which sits with any of the clothes' colours. */
const DUPATTA = '#b9603f'
const YOUNG_DUPATTA = '#3f7f78'

/** How a woman is made from one of the modelled people: see `createWomanFrom`. */
export type WomanStyle = 'elder' | 'young'

/**
 * A woman, from the modelled man in a kurta and pyjama, so she has real proportions, a face, hands and
 * feet and walks as he does, where she used to be a cone built from a few cylinders. He is made a
 * little shorter and narrower across the shoulders, given hair, and a dupatta round the neck with
 * both ends hanging in front, which with the kurta reads as a salwar kameez:
 *
 * - `elder`: her hair in a bun at the nape, a terracotta dupatta.
 * - `young`: a little taller, a long plait down her back, a teal dupatta.
 *
 * The kurta still takes each person's own colour, as the model's does. (The teenager's model was
 * tried for the younger woman: with only a ponytail added he still read as a boy from the front.)
 */
export function createWomanFrom(model: THREE.BufferGeometry, style: WomanStyle): THREE.BufferGeometry {
  const base = model.index ? model.toNonIndexed() : model.clone()
  for (const name of Object.keys(base.attributes)) if (!['position', 'normal', 'color', '_limb'].includes(name)) base.deleteAttribute(name)
  const position = base.getAttribute('position')
  const limb = base.getAttribute('_limb')
  let top = 0
  for (let i = 0; i < position.count; i++) top = Math.max(top, position.getY(i))

  // Shorter, and narrower from the waist up (the arms come in with the shoulders).
  const scale = style === 'elder' ? 0.93 : 0.955
  const waist = top * 0.56
  const shoulders = top * 0.8
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    const up = Math.max(0, Math.min(1, (y - waist) / (shoulders - waist)))
    position.setXYZ(i, position.getX(i) * (1 - 0.1 * up) * scale, y * scale, position.getZ(i) * scale)
    limb.setY(i, limb.getY(i) * scale)
  }
  const height = top * scale

  // The head, measured off the model: its middle, how wide it is, and how far back it goes.
  let headX = 0
  let headZ = 0
  let count = 0
  let halfWidth = 0
  let back = 0
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) < height - 0.14) continue
    headX += position.getX(i)
    headZ += position.getZ(i)
    count++
  }
  headX /= count
  headZ /= count
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) < height - 0.14) continue
    halfWidth = Math.max(halfWidth, Math.abs(position.getX(i) - headX))
    back = Math.min(back, position.getZ(i) - headZ)
  }
  // The chest's front, where the dupatta hangs.
  let chest = -Infinity
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if (y > height * 0.66 && y < height * 0.8 && Math.abs(position.getX(i)) < 0.1) chest = Math.max(chest, position.getZ(i))
  }

  const squash = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, at: [number, number, number]) => {
    geometry.scale(x, y, z)
    geometry.translate(...at)
    return geometry
  }
  // Hair over the crown and the back of the head, clear of the face: the model's own hair is cropped.
  const nape = headZ + back
  // The kurta model's head is bare: hair over the crown and the back of it, clear of the face.
  const hair: Part[] = [{ geometry: squash(new THREE.SphereGeometry(halfWidth + 0.014, 10, 7), 1, 0.98, 1.02, [headX, height - halfWidth * 0.92, headZ - 0.03]), color: HAIR }]
  if (style === 'elder') hair.push({ geometry: ball(0.062, height - 0.2, nape - 0.02, headX), color: HAIR })
  else {
    // A plait from the nape down the back to the waist, with a tie at its end.
    hair.push(
      { geometry: squash(new THREE.CylinderGeometry(0.042, 0.024, height * 0.36, 7), 1, 1, 0.75, [headX, height * 0.7, nape - 0.03]), color: HAIR },
      { geometry: ball(0.03, height * 0.515, nape - 0.03, headX), color: style === 'young' ? YOUNG_DUPATTA : HAIR },
    )
  }
  const cloth = style === 'elder' ? DUPATTA : YOUNG_DUPATTA
  const dupatta: Part[] = [
    // Behind the neck, and two narrow, thin ends a little apart, widening towards the hem, lying on the chest.
    { geometry: squash(new THREE.CylinderGeometry(0.066, 0.076, 0.045, 9), 1.2, 1, 1.05, [0, height * 0.838, headZ - 0.02]), color: cloth },
    ...[-1, 1].map((side): Part => {
      const end = squash(new THREE.CylinderGeometry(0.024, 0.036, height * 0.27, 7), 1, 1, 0.22, [0, 0, 0])
      end.rotateZ(side * 0.07)
      end.translate(side * 0.062, height * 0.69, chest + 0.006)
      return { geometry: end, color: cloth }
    }),
  ]
  return mergeGeometries([base, build([...hair, ...dupatta])]) as THREE.BufferGeometry
}
