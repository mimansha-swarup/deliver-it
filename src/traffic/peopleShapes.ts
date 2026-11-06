import * as THREE from 'three'
import { colored, merge } from '../world/simpleShapes'

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

const HIP = 0.86
const SHOULDER = 1.38

function cylinder(top: number, bottom: number, height: number, x: number, y: number, z = 0) {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 7, 1)
  geometry.translate(x, y, z)
  return geometry
}

function ball(radius: number, y: number, z = 0) {
  const geometry = new THREE.SphereGeometry(radius, 8, 6)
  geometry.translate(0, y, z)
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
      flat.setAttribute('aLimb', new THREE.BufferAttribute(limb, 3))
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
        geometry: cylinder(0.09, 0.065, 0.8, side * 0.095, HIP - 0.4),
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

/** A woman in a long kurta or saree, with her hair tied back. */
export function createWomanGeometry(): THREE.BufferGeometry {
  return build([
    ...head,
    { geometry: ball(0.12, 1.635, -0.015), color: HAIR },
    { geometry: ball(0.07, 1.6, -0.14), color: HAIR },
    { geometry: cylinder(0.185, 0.16, 0.56, 0, 1.14), color: WHITE, clothing: 1 },
    { geometry: cylinder(0.165, 0.27, 0.86, 0, 0.45), color: WHITE, clothing: 1 },
    ...arms(false),
  ])
}
