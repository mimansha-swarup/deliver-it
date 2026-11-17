import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { groundLift } from './groundLift'
import { colored } from './simpleShapes'
import { distanceToEdge, innerPoint, type Faith, type WorshipSite } from './worship'
import type { GroundPoint } from './worldUtils'

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
  const height = size * 2.4
  const courses = 10
  const courseHeight = height / courses
  for (let course = 0; course < courses; course++) {
    const t = (course + 0.5) / courses
    // Straight for the lower half, then curving in to about half its width at the top.
    const curve = t < 0.45 ? 0 : ((t - 0.45) / 0.55) ** 1.6
    const width = size * (1 - 0.48 * curve)
    const y = base + course * courseHeight
    const shade = course % 2 === 0 ? '#f3eee2' : '#e8dfcb'
    parts.push(block(width, courseHeight * 0.92, width, [x, y, z], angle, shade))
    // The ribs: the middle of each face stepped out, twice.
    parts.push(block(width * 0.5, courseHeight * 0.92, width * 1.1, [x, y, z], angle, shade))
    parts.push(block(width * 1.1, courseHeight * 0.92, width * 0.5, [x, y, z], angle, shade))
    parts.push(block(width * 0.2, courseHeight * 0.92, width * 1.18, [x, y, z], angle, '#c4602f'))
    parts.push(block(width * 1.18, courseHeight * 0.92, width * 0.2, [x, y, z], angle, '#c4602f'))
    // A thin cornice between courses.
    parts.push(block(width * 1.04, courseHeight * 0.08, width * 1.04, [x, y + courseHeight * 0.92, z], angle, '#d8ccb2'))
  }
  let y = base + height
  const top = size * 0.52
  // The neck, then the amalaka: a wide, flattened, ribbed disc.
  parts.push(placed(new THREE.CylinderGeometry(top * 0.42, top * 0.5, size * 0.12, 12).translate(0, size * 0.06, 0), [x, y, z], angle, '#e8dfcb'))
  y += size * 0.12
  parts.push(placed(new THREE.CylinderGeometry(top * 0.62, top * 0.62, size * 0.2, 20).translate(0, size * 0.1, 0), [x, y, z], angle, '#ece5d4'))
  parts.push(placed(new THREE.TorusGeometry(top * 0.62, size * 0.06, 6, 20).rotateX(Math.PI / 2), [x, y + size * 0.1, z], angle, '#ece5d4'))
  y += size * 0.2
  parts.push(placed(new THREE.CylinderGeometry(top * 0.3, top * 0.42, size * 0.1, 12).translate(0, size * 0.05, 0), [x, y, z], angle, '#e8dfcb'))
  y += size * 0.1
  parts.push(placed(new THREE.SphereGeometry(size * 0.13, 10, 6).translate(0, size * 0.1, 0), [x, y, z], angle, GOLD))
  parts.push(placed(new THREE.ConeGeometry(size * 0.06, size * 0.25, 8).translate(0, size * 0.32, 0), [x, y, z], angle, GOLD))
  y += size * 0.45
  // The Nila Chakra, a wheel facing the front, and the flag above it.
  parts.push(placed(new THREE.TorusGeometry(size * 0.18, size * 0.025, 5, 16), [x, y + size * 0.2, z], angle, GOLD))
  parts.push(placed(new THREE.CylinderGeometry(0.03, 0.03, size * 1.0, 5).translate(0, size * 0.5, 0), [x, y, z], angle, '#5a4632'))
  const flag = new THREE.BufferGeometry()
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, size, 0, size * 0.75, size * 0.85, 0, 0, size * 0.7, 0], 3))
  flag.computeVertexNormals()
  parts.push(placed(flag, [x, y, z], angle + Math.PI / 2, FLAG_RED))
  return parts
}

/** A pidha roof: three stepped tiers over the hall in front of a Kalinga tower. */
function pidha([x, z]: GroundPoint, base: number, size: number, angle: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  let y = base
  for (const share of [1, 0.75, 0.5]) {
    parts.push(block(size * share, size * 0.22, size * share, [x, y, z], angle, '#efe6d6'))
    y += size * 0.22
  }
  parts.push(placed(new THREE.ConeGeometry(size * 0.06, size * 0.25, 8).translate(0, size * 0.125, 0), [x, y, z], angle, GOLD))
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
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), [])
  return <ChunkedMesh geometries={geometries} material={material} castShadow />
}
