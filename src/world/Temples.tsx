import { useMemo } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { groundLift } from './groundLift'
import { colored } from './simpleShapes'
import { distanceToEdge, innerPoint, type Faith, type WorshipSite } from './worship'
import type { GroundPoint } from './worldUtils'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/*
 * Temples, mosques and churches, drawn whole (ART_DIRECTION.md: stylized, with
 * the shapes people know them by):
 *
 * - Hindu temples, in the Dravidian way: cream walls on a red-ochre plinth, and
 *   over the sanctum a stepped tower (vimana) of painted tiers, a dome and a
 *   gold kalasha, with a gold flag post (dhwajastambha) in front of the door;
 * - Jagannath temples, in Odisha's Kalinga way: a tall curved tower (rekha
 *   deula) with ribbed bands, the ribbed amalaka disc, a kalasha, the Nila Chakra
 *   wheel and a red flag, with a stepped pyramid roof (pidha) over the hall in front;
 * - mosques: a dome on a drum, and two minarets at the front;
 * - churches: a bell tower at the front with a pyramid roof and a cross;
 * - others (the Buddhist ones): a white stupa dome with a gold spire.
 *
 * All share one material and are merged per map square.
 */

type Paint = { wall: string; band: string; roof: string; height: number }

const PAINT: Record<Faith, Paint> = {
  hindu: { wall: '#f2ead8', band: '#a8432b', roof: '#cfc6b4', height: 4 },
  kalinga: { wall: '#f4efe4', band: '#c4602f', roof: '#d6cfc0', height: 4.5 },
  muslim: { wall: '#f0f1ec', band: '#2f7d55', roof: '#d2d4cd', height: 4.5 },
  christian: { wall: '#f3efe6', band: '#8d7a66', roof: '#c9c2b4', height: 5.5 },
  other: { wall: '#efe6d2', band: '#c08a3a', roof: '#d0c6b0', height: 3.6 },
}
/** Halls and the priest's house, and the little roadside shrines, are lower. */
const HALL_HEIGHT = 3.6
const SHRINE_HEIGHT = 2.6
const PLINTH = 0.6
const PARAPET = 0.45

const GOLD = '#d4a42a'
const VIMANA_TIERS = ['#efe2c4', '#e7c35c', '#efe2c4', '#e0a14a']
const FLAG_RED = '#d3262b'

/** An outline stood up as walls from `bottom` to `top`, in one colour, its roof (if any) in another. */
function walls(outline: GroundPoint[], bottom: number, top: number, color: string, roof?: string): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, bottom, 0)
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.computeVertexNormals()
  colored(flat, color)
  if (roof) {
    const normal = flat.getAttribute('normal')
    const colors = flat.getAttribute('color')
    const tint = new THREE.Color(roof)
    for (let i = 0; i < normal.count; i++) if (normal.getY(i) > 0.5) colors.setXYZ(i, tint.r, tint.g, tint.b)
  }
  return flat
}

/** A shape built round the origin, turned to face `angle` and moved to `[x, y, z]`. */
function placed(geometry: THREE.BufferGeometry, [x, y, z]: [number, number, number], angle: number, color: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.rotateY(angle)
  flat.translate(x, y, z)
  return colored(flat, color)
}

function block(width: number, height: number, depth: number, at: [number, number, number], angle: number, color: string) {
  return placed(new THREE.BoxGeometry(width, height, depth).translate(0, height / 2, 0), at, angle, color)
}

/** A Dravidian vimana: stepped painted tiers with a cornice on each, a dome and a kalasha. */
function vimana([x, z]: GroundPoint, base: number, size: number, angle: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  let y = base
  ;[1, 0.8, 0.63, 0.48].forEach((share, tier) => {
    const width = size * share
    const height = size * 0.3
    parts.push(block(width, height, width, [x, y, z], angle, VIMANA_TIERS[tier]))
    parts.push(block(width * 1.1, size * 0.07, width * 1.1, [x, y + height, z], angle, '#d8c9a8'))
    y += height + size * 0.07
  })
  parts.push(placed(new THREE.SphereGeometry(size * 0.28, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), [x, y, z], angle, VIMANA_TIERS[1]))
  parts.push(placed(new THREE.ConeGeometry(size * 0.07, size * 0.35, 8).translate(0, size * 0.175, 0), [x, y + size * 0.26, z], angle, GOLD))
  return parts
}

/**
 * A Kalinga rekha deula: a square tower built up in courses (bhumis), each with
 * its middle stepped out on all four sides, which makes the vertical ribs. It
 * rises straight, then curves in towards the top, under the wide ribbed
 * amalaka, the kalasha, the Nila Chakra and the flag.
 */
function rekhaDeula([x, z]: GroundPoint, base: number, size: number, angle: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const height = size * 2.6
  const WHITE = '#f4efe2'
  const SHADE = '#e6dcc6'
  const RED = '#b8402a'
  // The base (pabhaga): mouldings, then the wall (jangha) with a framed niche on each face.
  const foot = size * 0.38
  parts.push(block(size * 1.2, foot * 0.22, size * 1.2, [x, base, z], angle, RED))
  parts.push(block(size * 1.14, foot * 0.2, size * 1.14, [x, base + foot * 0.22, z], angle, WHITE))
  parts.push(block(size * 1.2, foot * 0.16, size * 1.2, [x, base + foot * 0.42, z], angle, SHADE))
  parts.push(block(size * 1.08, foot * 0.42, size * 1.08, [x, base + foot * 0.58, z], angle, WHITE))
  for (let face = 0; face < 4; face++) {
    const turn = angle + (face * Math.PI) / 2
    const out = size * 0.56
    const at = (lift: number, depth: number): [number, number, number] => [x + Math.sin(turn) * (out + depth), base + lift, z + Math.cos(turn) * (out + depth)]
    // A niche: a dark recess in a red frame under a little stepped roof, as the side deities' are.
    parts.push(block(size * 0.3, foot * 0.6, 0.12, at(foot * 0.3, 0), turn, RED))
    parts.push(block(size * 0.2, foot * 0.46, 0.14, at(foot * 0.33, 0.02), turn, '#3a2c24'))
    parts.push(block(size * 0.36, foot * 0.08, 0.2, at(foot * 0.9, 0), turn, WHITE))
    parts.push(block(size * 0.24, foot * 0.08, 0.18, at(foot * 0.98, 0), turn, RED))
  }
  // The tower (gandi): courses (bhumis) with five ribs on each face (pancharatha), the middle one
  // (raha) furthest out and painted red, curving in to the neck. Every fourth course is a red band,
  // with a ribbed corner disc (bhumi-amla) on it.
  const courses = 20
  const from = base + foot
  const courseHeight = (height - foot) / courses
  const widthAt = (t: number) => size * (1 - 0.5 * (t < 0.3 ? 0 : ((t - 0.3) / 0.7) ** 1.7))
  for (let course = 0; course < courses; course++) {
    const t = (course + 0.5) / courses
    const width = widthAt(t)
    const y = from + course * courseHeight
    const isBand = course % 4 === 3
    const shade = isBand ? RED : WHITE
    const tall = courseHeight * 0.86
    parts.push(block(width, tall, width, [x, y, z], angle, shade))
    // The ribs, each stepped a little further out than the last, on both axes.
    parts.push(block(width * 0.72, tall, width * 1.07, [x, y, z], angle, shade))
    parts.push(block(width * 1.07, tall, width * 0.72, [x, y, z], angle, shade))
    parts.push(block(width * 0.44, tall, width * 1.13, [x, y, z], angle, shade))
    parts.push(block(width * 1.13, tall, width * 0.44, [x, y, z], angle, shade))
    parts.push(block(width * 0.18, tall, width * 1.19, [x, y, z], angle, RED))
    parts.push(block(width * 1.19, tall, width * 0.18, [x, y, z], angle, RED))
    // The groove between courses: a thin dark-edged cornice.
    parts.push(block(width * 1.05, courseHeight * 0.14, width * 1.05, [x, y + tall, z], angle, '#cfc2a6'))
    if (isBand) {
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const cx = x + (Math.sin(angle) * sz + Math.cos(angle) * sx) * width * 0.5
        const cz = z + (Math.cos(angle) * sz - Math.sin(angle) * sx) * width * 0.5
        parts.push(placed(new THREE.CylinderGeometry(width * 0.085, width * 0.085, tall * 0.9, 8).translate(0, tall * 0.5, 0), [cx, y, cz], angle, WHITE))
      }
    }
  }
  // A carved medallion (the chaitya window) low on each face's middle rib, and a small shrine
  // (anga-shikhara) standing out of it higher up.
  for (let face = 0; face < 4; face++) {
    const turn = angle + (face * Math.PI) / 2
    const on = (t: number, depth: number): [number, number, number] => {
      const out = widthAt(t) * 0.6 + depth
      return [x + Math.sin(turn) * out, from + (height - foot) * t, z + Math.cos(turn) * out]
    }
    parts.push(placed(new THREE.CylinderGeometry(size * 0.11, size * 0.11, 0.1, 12).rotateX(Math.PI / 2), on(0.2, 0.02), turn, GOLD))
    parts.push(placed(new THREE.CylinderGeometry(size * 0.06, size * 0.06, 0.14, 10).rotateX(Math.PI / 2), on(0.2, 0.04), turn, RED))
    const mini = size * 0.16
    const [mx, my, mz] = on(0.42, -mini * 0.2)
    parts.push(block(mini, mini * 1.5, mini * 0.7, [mx, my, mz], turn, WHITE))
    parts.push(block(mini * 0.75, mini * 0.6, mini * 0.6, [mx, my + mini * 1.5, mz], turn, SHADE))
    parts.push(placed(new THREE.CylinderGeometry(mini * 0.42, mini * 0.42, mini * 0.2, 8).translate(0, mini * 0.1, 0), [mx, my + mini * 2.1, mz], turn, RED))
    parts.push(placed(new THREE.ConeGeometry(mini * 0.14, mini * 0.4, 6).translate(0, mini * 0.2, 0), [mx, my + mini * 2.3, mz], turn, GOLD))
  }
  let y = base + height
  const top = size * 0.5
  // The neck (beki), then the amalaka: a wide, flattened disc, ribbed all round.
  parts.push(placed(new THREE.CylinderGeometry(top * 0.42, top * 0.5, size * 0.12, 12).translate(0, size * 0.06, 0), [x, y, z], angle, SHADE))
  y += size * 0.12
  parts.push(placed(new THREE.CylinderGeometry(top * 0.6, top * 0.6, size * 0.2, 20).translate(0, size * 0.1, 0), [x, y, z], angle, WHITE))
  for (let rib = 0; rib < 20; rib++) {
    const turn = (rib / 20) * Math.PI * 2
    const lobe = new THREE.SphereGeometry(size * 0.075, 6, 5)
    lobe.scale(1, 1.5, 1)
    lobe.translate(Math.sin(turn) * top * 0.62, size * 0.1, Math.cos(turn) * top * 0.62)
    parts.push(placed(lobe, [x, y, z], angle, rib % 2 === 0 ? WHITE : SHADE))
  }
  y += size * 0.2
  // The skull-cap (khapuri) and the pot (kalasha).
  parts.push(placed(new THREE.SphereGeometry(top * 0.46, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), [x, y, z], angle, WHITE))
  y += top * 0.4
  parts.push(placed(new THREE.SphereGeometry(size * 0.13, 12, 8).scale(1, 0.85, 1).translate(0, size * 0.1, 0), [x, y, z], angle, GOLD))
  parts.push(placed(new THREE.CylinderGeometry(size * 0.05, size * 0.08, size * 0.1, 8).translate(0, size * 0.24, 0), [x, y, z], angle, GOLD))
  y += size * 0.3
  // The Nila Chakra: an eight-spoked wheel facing the front, on its stem; the pole behind it, and
  // the Patitapabana flag, a long red pennant with a yellow edge and crescent.
  const wheel = size * 0.2
  parts.push(placed(new THREE.CylinderGeometry(0.05, 0.07, size * 0.2, 6).translate(0, size * 0.1, 0), [x, y, z], angle, GOLD))
  const hub = y + size * 0.2 + wheel
  parts.push(placed(new THREE.TorusGeometry(wheel, size * 0.028, 6, 24), [x, hub, z], angle, GOLD))
  parts.push(placed(new THREE.TorusGeometry(wheel * 0.72, size * 0.014, 5, 20), [x, hub, z], angle, GOLD))
  parts.push(placed(new THREE.CylinderGeometry(wheel * 0.2, wheel * 0.2, 0.08, 10).rotateX(Math.PI / 2), [x, hub, z], angle, GOLD))
  for (let spoke = 0; spoke < 4; spoke++) {
    parts.push(placed(new THREE.BoxGeometry(wheel * 2, size * 0.022, size * 0.022).rotateZ((spoke * Math.PI) / 4), [x, hub, z], angle, GOLD))
  }
  const pole = size * 1.25
  parts.push(placed(new THREE.CylinderGeometry(0.035, 0.045, pole, 6).translate(0, pole / 2, 0), [x, hub - wheel * 0.2, z], angle, '#5a4632'))
  const mast = hub - wheel * 0.2 + pole
  const pennant = (points: number[], color: string, lift: number) => {
    const flag = new THREE.BufferGeometry()
    flag.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    flag.computeVertexNormals()
    return placed(flag, [x, mast + lift, z], angle + Math.PI / 2, color)
  }
  parts.push(pennant([0, 0, 0, size * 1.05, -size * 0.2, 0, 0, -size * 0.42, 0], FLAG_RED, 0))
  parts.push(pennant([0, -size * 0.42, 0.01, size * 1.05, -size * 0.2, 0.01, 0, -size * 0.5, 0.01], '#e8b62c', 0))
  parts.push(placed(new THREE.TorusGeometry(size * 0.06, size * 0.014, 4, 10, Math.PI), [x, mast - size * 0.2, z], angle + Math.PI / 2, '#e8b62c'))
  return parts
}

/**
 * The hall in front of a Kalinga tower (the jagamohana), a pidha deula: a pyramid of stepped tiers
 * in two groups, each tier's edge a red line, under a bell (ghanta), an amalaka and a kalasha.
 */
function pidha([x, z]: GroundPoint, base: number, size: number, angle: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  let y = base
  const tiers = [1, 0.9, 0.8, 0.7, 0.58, 0.5, 0.42, 0.34]
  tiers.forEach((share, tier) => {
    const tall = size * (tier === 4 ? 0.16 : 0.085)
    // A recessed wall between the two groups of tiers.
    if (tier === 4) parts.push(block(size * share * 0.9, tall, size * share * 0.9, [x, y, z], angle, '#e6dcc6'))
    else {
      parts.push(block(size * share, tall * 0.7, size * share, [x, y, z], angle, '#f4efe2'))
      parts.push(block(size * share * 1.04, tall * 0.3, size * share * 1.04, [x, y + tall * 0.7, z], angle, '#b8402a'))
    }
    y += tall
  })
  parts.push(placed(new THREE.SphereGeometry(size * 0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1), [x, y, z], angle, '#f4efe2'))
  y += size * 0.12
  parts.push(placed(new THREE.CylinderGeometry(size * 0.13, size * 0.13, size * 0.06, 14).translate(0, size * 0.03, 0), [x, y, z], angle, '#e6dcc6'))
  y += size * 0.06
  parts.push(placed(new THREE.SphereGeometry(size * 0.07, 10, 6).translate(0, size * 0.06, 0), [x, y, z], angle, GOLD))
  parts.push(placed(new THREE.ConeGeometry(size * 0.035, size * 0.16, 8).translate(0, size * 0.2, 0), [x, y, z], angle, GOLD))
  return parts
}

/**
 * At ground level in front of a Jagannath temple, as at Puri: steps up to a door between two lions
 * (the Simhadwara), and the Aruna Stambha before it, a tall many-sided pillar with a figure on top.
 */
function kalingaForecourt(site: WorshipSite, inside: GroundPoint, ground: number, angle: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const out = distanceToEdge(site.outline, inside, site.front)
  const at = (forward: number, across: number): GroundPoint => [
    inside[0] + site.front[0] * (out + forward) + site.front[1] * across,
    inside[1] + site.front[1] * (out + forward) - site.front[0] * across,
  ]
  // The door: a dark opening in a red frame with a stepped white lintel.
  const [dx, dz] = at(0.06, 0)
  parts.push(block(1.5, 2.3, 0.12, [dx, ground + PLINTH, dz], angle, '#3a2c24'))
  for (const side of [-1, 1]) {
    const [jx, jz] = at(0.08, side * 0.86)
    parts.push(block(0.22, 2.5, 0.2, [jx, ground + PLINTH, jz], angle, '#b8402a'))
  }
  parts.push(block(2.2, 0.22, 0.26, [at(0.08, 0)[0], ground + PLINTH + 2.3, at(0.08, 0)[1]], angle, '#f4efe2'))
  parts.push(block(1.6, 0.18, 0.24, [at(0.08, 0)[0], ground + PLINTH + 2.52, at(0.08, 0)[1]], angle, '#b8402a'))
  // Steps, and a lion each side, sitting up on a block.
  for (let step = 0; step < 3; step++) parts.push(block(2.6 - step * 0.3, PLINTH / 3, 0.36, [at(0.95 - step * 0.33, 0)[0], ground + (step * PLINTH) / 3 - 0.02, at(0.95 - step * 0.33, 0)[1]], angle, '#d8ccb2'))
  for (const side of [-1, 1]) {
    const [lx, lz] = at(0.9, side * 1.75)
    parts.push(block(0.6, 0.45, 0.9, [lx, ground, lz], angle, '#b8402a'))
    parts.push(placed(new THREE.SphereGeometry(0.3, 8, 6).scale(0.85, 1, 1.3).translate(0, 0.3, -0.05), [lx, ground + 0.45, lz], angle, '#f4efe2'))
    parts.push(placed(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 0.62, 0.28), [lx, ground + 0.45, lz], angle, '#f4efe2'))
    parts.push(placed(new THREE.SphereGeometry(0.27, 8, 5).scale(1, 1, 0.6).translate(0, 0.62, 0.16), [lx, ground + 0.45, lz], angle, '#e8b62c'))
  }
  // The Aruna Stambha, a little way out in front.
  const [px, pz] = at(3.2, 0)
  parts.push(block(1.0, 0.3, 1.0, [px, ground, pz], angle, '#b8402a'))
  parts.push(block(0.74, 0.3, 0.74, [px, ground + 0.3, pz], angle, '#f4efe2'))
  parts.push(placed(new THREE.CylinderGeometry(0.16, 0.2, 5.2, 16).translate(0, 2.6, 0), [px, ground + 0.6, pz], angle, '#6b5a4c'))
  parts.push(placed(new THREE.CylinderGeometry(0.34, 0.18, 0.3, 16).translate(0, 0.15, 0), [px, ground + 5.8, pz], angle, '#6b5a4c'))
  parts.push(placed(new THREE.SphereGeometry(0.17, 8, 6).scale(1, 1.3, 1).translate(0, 0.22, 0), [px, ground + 6.1, pz], angle, GOLD))
  return parts
}

function dome([x, z]: GroundPoint, base: number, radius: number, color: string): THREE.BufferGeometry[] {
  return [
    placed(new THREE.CylinderGeometry(radius * 0.95, radius * 0.95, radius * 0.4, 16).translate(0, radius * 0.2, 0), [x, base, z], 0, color),
    placed(new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [x, base + radius * 0.4, z], 0, color),
    placed(new THREE.ConeGeometry(radius * 0.08, radius * 0.6, 6).translate(0, radius * 0.3, 0), [x, base + radius * 1.35, z], 0, GOLD),
  ]
}

function minaret([x, z]: GroundPoint, ground: number, height: number): THREE.BufferGeometry[] {
  return [
    placed(new THREE.CylinderGeometry(0.36, 0.42, height, 10).translate(0, height / 2, 0), [x, ground, z], 0, '#f0f1ec'),
    placed(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 10), [x, ground + height * 0.72, z], 0, '#2f7d55'),
    placed(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [x, ground + height, z], 0, '#2f7d55'),
  ]
}

function belltower([x, z]: GroundPoint, ground: number, height: number, angle: number): THREE.BufferGeometry[] {
  return [
    block(2.6, height, 2.6, [x, ground, z], angle, '#f3efe6'),
    placed(new THREE.ConeGeometry(2.0, 2.4, 4).rotateY(Math.PI / 4).translate(0, 1.2, 0), [x, ground + height, z], angle, '#7a3b2e'),
    block(0.14, 1.6, 0.14, [x, ground + height + 2.3, z], angle, '#ffffff'),
    block(0.9, 0.14, 0.14, [x, ground + height + 3.3, z], angle, '#ffffff'),
  ]
}

function flagPost([x, z]: GroundPoint, ground: number): THREE.BufferGeometry[] {
  return [
    block(0.9, 0.3, 0.9, [x, ground, z], 0, '#a8432b'),
    block(0.6, 0.3, 0.6, [x, ground + 0.3, z], 0, '#d8c9a8'),
    placed(new THREE.CylinderGeometry(0.07, 0.1, 7, 8).translate(0, 3.5, 0), [x, ground + 0.6, z], 0, GOLD),
    block(0.5, 0.06, 0.06, [x, ground + 7.2, z], 0, GOLD),
  ]
}

function areaOf(outline: GroundPoint[]): number {
  let doubled = 0
  outline.forEach(([x, z], index) => {
    const [nextX, nextZ] = outline[(index + 1) % outline.length]
    doubled += x * nextZ - nextX * z
  })
  return Math.abs(doubled) / 2
}

/** The shapes for one place of worship. */
function buildSite(site: WorshipSite): THREE.BufferGeometry[] {
  const paint = PAINT[site.faith]
  const small = site.generated && areaOf(site.outline) < 15
  const height = small ? SHRINE_HEIGHT : paint.height
  const inside = innerPoint(site.outline)
  const ground = groundLift.at(...inside)
  const angle = Math.atan2(site.front[0], site.front[1])

  const building = (outline: GroundPoint[], top: number) => [
    walls(outline, ground - 0.1, ground + PLINTH, paint.band),
    walls(outline, ground + PLINTH, ground + top - PARAPET, paint.wall),
    walls(outline, ground + top - PARAPET, ground + top, paint.band, paint.roof),
  ]
  const parts = [...building(site.outline, height), ...site.halls.flatMap((hall) => building(hall, HALL_HEIGHT))]

  // Room on the roof round the inner point, across and along, for the tower.
  const across: GroundPoint = [site.front[1], -site.front[0]]
  const room = 2 * Math.min(
    distanceToEdge(site.outline, inside, site.front),
    distanceToEdge(site.outline, inside, [-site.front[0], -site.front[1]]),
    distanceToEdge(site.outline, inside, across),
    distanceToEdge(site.outline, inside, [-across[0], -across[1]]),
  )
  const roof = ground + height
  const size = Math.min(room * 0.9, Math.max(1.6, Math.min(7, Math.sqrt(areaOf(site.outline)) * 0.5)))

  switch (site.faith) {
    case 'hindu':
      parts.push(...vimana(inside, roof, size, angle))
      break
    case 'kalinga': {
      // The tower behind, over the sanctum; the hall's stepped roof in front, where it fits.
      const back = distanceToEdge(site.outline, inside, [-site.front[0], -site.front[1]])
      const shift = Math.max(0, Math.min(back - size * 0.55, size * 0.4))
      const towerAt: GroundPoint = [inside[0] - site.front[0] * shift, inside[1] - site.front[1] * shift]
      parts.push(...rekhaDeula(towerAt, roof, size, angle))
      const hallAt: GroundPoint = [towerAt[0] + site.front[0] * size * 1.05, towerAt[1] + site.front[1] * size * 1.05]
      if (distanceToEdge(site.outline, inside, site.front) > shift + size * 1.3) parts.push(...pidha(hallAt, roof, size * 0.85, angle))
      parts.push(...kalingaForecourt(site, inside, ground, angle))
      break
    }
    case 'muslim': {
      parts.push(...dome(inside, roof, Math.min(size * 0.55, 5), '#eef0ea'))
      // Minarets at the two front corners.
      const centre = inside
      const corners = [...site.outline].sort(
        (a, b) =>
          (b[0] - centre[0]) * site.front[0] + (b[1] - centre[1]) * site.front[1] - ((a[0] - centre[0]) * site.front[0] + (a[1] - centre[1]) * site.front[1]),
      )
      const first = corners[0]
      const second = corners.find((corner) => Math.hypot(corner[0] - first[0], corner[1] - first[1]) > 2.5)
      for (const corner of second ? [first, second] : [first]) parts.push(...minaret(corner, ground, height + 6))
      break
    }
    case 'christian': {
      const out = distanceToEdge(site.outline, inside, site.front)
      const at: GroundPoint = [inside[0] + site.front[0] * Math.max(0, out - 1.4), inside[1] + site.front[1] * Math.max(0, out - 1.4)]
      parts.push(...belltower(at, ground, height + 4, angle))
      break
    }
    case 'other':
      parts.push(...dome(inside, roof, Math.min(size * 0.45, 3), '#f6f4ee'))
      break
  }
  if (site.flagPost) parts.push(...flagPost(site.flagPost, groundLift.at(...site.flagPost)))
  return parts
}

const templeFlood = { value: 0 }
const templeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })
templeMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uFlood = templeFlood
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uFlood;\nvoid main() {')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.66) * uFlood;')
}

export function Temples({ sites }: { sites: WorshipSite[] }) {
  const geometries = useMemo(() => {
    const chunks = new Map<number, THREE.BufferGeometry[]>()
    for (const site of sites) {
      const [x, z] = innerPoint(site.outline)
      const key = chunkKey(x, z)
      const list = chunks.get(key) ?? []
      chunks.set(key, list)
      list.push(...buildSite(site))
    }
    return [...chunks.values()].map((parts) => {
      for (const part of parts) {
        for (const name of Object.keys(part.attributes)) if (!['position', 'normal', 'color'].includes(name)) part.deleteAttribute(name)
        if (!part.getAttribute('normal')) part.computeVertexNormals()
      }
      const merged = mergeGeometries(parts)
      parts.forEach((part) => part.dispose())
      if (!merged) throw new Error('Could not merge temples')
      merged.computeBoundingSphere()
      return merged
    })
  }, [sites])
  // After dark the temples are floodlit: their own paint lit warm, rising with the street lamps.
  useFrame(() => {
    templeFlood.value = liveSky.look.night * 0.32
  })
  return <ChunkedMesh geometries={geometries} material={templeMaterial} castShadow />
}
