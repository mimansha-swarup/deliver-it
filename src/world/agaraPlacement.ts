import { addFootprint, addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { StiltVehicle } from './houseKit'
import type { BusStop } from './landmarkPlacement'
import { nearestRoadPiece, type RoadIndex } from './props'
import { IDLE_POSE } from '../traffic/gait'
import type { ShopPerson } from './shopPeoplePlacement'
import { Surface, type SurfaceMap } from './surfaceMap'
import type { Flyover } from './transitPlacement'
import { distanceToEdge, innerPoint, type WorshipSite } from './worship'
import type { GroundPoint } from './worldUtils'

/*
 * Agara: the Abhaya Anjaneya statue, about 100 ft of Hanuman standing with his hand raised in
 * blessing, beside the Agara flyover on Outer Ring Road, by the Hanuman temple OSM has there, with the
 * Jagannath temple a few doors down. A place of worship: the statue stands on a solid plinth, takes no
 * part in crashes, and faces the flyover, so riders coming over it see it full on.
 *
 * Round the temple's door: flower and coconut sellers, devotees' footwear left outside, autos at the
 * kerb, a few people at any time and a crowd on Saturdays, Hanuman's day.
 */

/** The whole height, the temple under him and all, in metres: 102 ft, as the real one. */
export const STATUE_HEIGHT = 31.1
/** The side of the little temple he stands on, in metres. */
export const PLINTH = 10
/** The statue's temple is the Hanuman temple within this far of the Agara flyover, in metres. */
const NEAR_FLYOVER = 400
/** The plinth is put on open ground within this far of the temple, the nearest spot that takes it. */
const STATUE_REACH = 60

export type Agara = {
  statue: { x: number; z: number; rotation: number } | null
  /** Sellers' stalls: `variation` under 0.5 is flowers, over it coconuts. */
  stalls: { x: number; z: number; rotation: number; variation: number }[]
  /** Patches of footwear left outside the door. */
  footwear: { x: number; z: number; rotation: number; variation: number }[]
  autos: StiltVehicle[]
  /** Sellers and a few devotees, there every day. */
  people: ShopPerson[]
  /** The Saturday crowd. */
  crowd: ShopPerson[]
  /** More people waiting at the Agara bus stop at rush hour. */
  rushCrowd: ShopPerson[]
  /** The auto stand under the flyover. */
  standAutos: StiltVehicle[]
  /** Where `?spawn=agara-flyover` starts: on the road at the Agara junction, on the flyover's approach, facing up the ramp. */
  spawn: { name: string; x: number; z: number; heading: number } | null
  /** Where `?spawn=agara-temple` starts: on the road outside the temple's door. */
  templeSpawn: { name: string; x: number; z: number; heading: number } | null
  /** Up on the Agara flyover's deck, at its highest point, in the left lane (`?spawn=agara-flyover-top`). */
  topSpawn: { name: string; x: number; z: number; heading: number; height: number } | null
  /** The flyover decks near the statue (both carriageways), whose view of him is kept clear of trees. */
  viewDecks: Flyover[]
  /**
   * The festival procession's street, outside the Jagannath temple: the closed stretch (a to b, its
   * width), and the crowd along it. Null if no road runs by the temple.
   */
  festival: { ax: number; az: number; bx: number; bz: number; width: number; crowd: ShopPerson[]; road: string } | null
  /** The traffic policeman at the junction's lights, set once the lights are placed (World.tsx). */
  police: { x: number; z: number; rotation: number } | null
  /** The temple's door, where its life gathers. */
  door: { x: number; z: number } | null
  /** The Jagannath temple nearest the statue, for the map. */
  jagannath: { x: number; z: number; name: string } | null
  report: Record<string, number>
  /** The temple the statue stands by, as OSM names it. */
  temple: string
}

const centreOf = (outline: GroundPoint[]): GroundPoint => {
  let x = 0
  let z = 0
  for (const [px, pz] of outline) {
    x += px
    z += pz
  }
  return [x / outline.length, z / outline.length]
}

export function planAgara({
  worship,
  decks,
  surface,
  roads,
  collisions,
  stops,
  lake,
}: {
  worship: WorshipSite[]
  decks: Flyover[]
  surface: SurfaceMap
  roads: RoadIndex
  collisions: CollisionWorld
  stops: BusStop[]
  /** Agara Lake's middle, if the map has it: the flyover's approach nearest it is the Agara junction's. */
  lake: GroundPoint | null
}): Agara {
  const agara: Agara = { statue: null, stalls: [], footwear: [], autos: [], people: [], crowd: [], rushCrowd: [], standAutos: [], spawn: null, templeSpawn: null, topSpawn: null, viewDecks: [], festival: null, police: null, door: null, jagannath: null, report: {}, temple: '' }

  // The temple: a Hanuman (Anjaneya) temple near an Outer Ring Road flyover. The nearest such pair is Agara's.
  const ringRoad = decks.filter(({ name }) => /outer ring road/i.test(name))
  let best: { site: WorshipSite; deck: Flyover; distance: number; point: GroundPoint } | null = null
  for (const site of worship) {
    if (!/hanuman|anjaneya/i.test(site.name ?? '') || site.outline.length === 0) continue
    const [cx, cz] = centreOf(site.outline)
    for (const deck of ringRoad) {
      for (const point of deck.path.points) {
        const distance = Math.hypot(point[0] - cx, point[1] - cz)
        if (distance < NEAR_FLYOVER && (!best || distance < best.distance)) best = { site, deck, distance, point }
      }
    }
  }
  if (!best) {
    agara.report.placed = 0
    return agara
  }
  const { site, deck } = best
  const [cx, cz] = centreOf(site.outline)
  agara.temple = site.name ?? ''
  agara.report.metresFromFlyover = Math.round(best.distance)

  // The start for `?spawn=agara-flyover`: on the ground road leading to a ramp's foot, in the left
  // lane, facing up the ramp. The decks are one way, so a deck's start is its approach. Of the ring
  // road's ramps near the temple, the one nearest Agara Lake: the Agara junction's.
  {
    let approach: { deck: Flyover; distance: number } | null = null
    for (const candidate of ringRoad) {
      if (!candidate.startsLow) continue
      if (!candidate.path.points.some(([px, pz]) => Math.hypot(px - cx, pz - cz) < NEAR_FLYOVER * 1.5)) continue
      const [fx, fz] = candidate.path.points[0]
      const distance = lake ? Math.hypot(fx - lake[0], fz - lake[1]) : Math.hypot(fx - cx, fz - cz)
      if (!approach || distance < approach.distance) approach = { deck: candidate, distance }
    }
    if (approach) {
      const { points } = approach.deck.path
      // The top of that deck: its highest point, in the left lane, facing along it.
      {
        const { heights, width } = approach.deck
        let top = 0
        for (let i = 1; i < heights.length; i++) if (heights[i] > heights[top]) top = i
        // The middle of the level stretch at that height, not its first point.
        let last = top
        while (last + 1 < heights.length && heights[last + 1] >= heights[top] - 0.05) last++
        const at = Math.min(points.length - 2, Math.floor((top + last) / 2))
        const [tx, tz] = points[at]
        const [ux, uz] = points[at + 1]
        const span = Math.hypot(ux - tx, uz - tz) || 1
        const dx = (ux - tx) / span
        const dz = (uz - tz) / span
        const left = Math.min(width / 4, 1.8)
        agara.topSpawn = { name: 'Agara flyover, up on the deck', x: tx + dz * left, z: tz - dx * left, heading: Math.atan2(dx, dz), height: heights[at] }
      }
      const [ax, az] = points[0]
      const [bx, bz] = points[Math.min(points.length - 1, 4)]
      const length = Math.hypot(bx - ax, bz - az) || 1
      const fx = (bx - ax) / length
      const fz = (bz - az) / length
      // Back along the approach, on a road running the ramp's way, in its left lane, clear of anything solid.
      for (const back of [35, 25, 45, 15, 60]) {
        const px = ax - fx * back
        const pz = az - fz * back
        const near = nearestRoadPiece(roads, px, pz, 12)
        if (!near) continue
        const { start, end, width } = near.piece
        const pieceLength = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
        let dirX = (end[0] - start[0]) / pieceLength
        let dirZ = (end[1] - start[1]) / pieceLength
        const same = dirX * fx + dirZ * fz
        if (Math.abs(same) < 0.8) continue
        if (same < 0) {
          dirX = -dirX
          dirZ = -dirZ
        }
        const along = (px - start[0]) * dirX + (pz - start[1]) * dirZ
        const left = Math.min(width / 4, 1.8)
        const x = start[0] + dirX * along + dirZ * left
        const z = start[1] + dirZ * along - dirX * left
        if (surface.at(x, z) !== Surface.Road || isNearBuilding(collisions, x, z, 1.2)) continue
        agara.spawn = { name: 'Agara flyover', x, z, heading: Math.atan2(dirX, dirZ) }
        break
      }
      // No road found leading to it: on the ramp's own foot, which is road.
      if (!agara.spawn) agara.spawn = { name: 'Agara flyover', x: ax + fx * 6, z: az + fz * 6, heading: Math.atan2(fx, fz) }
    }
  }

  // The statue: on the nearest open ground to the temple that takes the plinth whole, clear of everything.
  const half = PLINTH / 2 + 1.5
  const takesPlinth = (x: number, z: number) => {
    for (const [dx, dz] of [[0, 0], [half, 0], [-half, 0], [0, half], [0, -half], [half, half], [-half, half], [half, -half], [-half, -half]]) {
      const at = surface.at(x + dx, z + dz)
      if (at !== Surface.Open && at !== Surface.Park && at !== Surface.Plot) return false
      if (surface.isOverhead(x + dx, z + dz) || isNearBuilding(collisions, x + dx, z + dz, 2)) return false
    }
    return true
  }
  let spot: GroundPoint | null = null
  for (let distance = 8; distance <= STATUE_REACH && !spot; distance += 4) {
    for (let i = 0; i < 16 && !spot; i++) {
      const angle = (i / 16) * Math.PI * 2
      const x = cx + Math.cos(angle) * distance
      const z = cz + Math.sin(angle) * distance
      if (takesPlinth(x, z)) spot = [x, z]
    }
  }
  if (spot) {
    const [x, z] = spot
    // Facing the flyover's nearest point, so the view from the deck frames him.
    let nearest = best.point
    let nearestDistance = Infinity
    for (const point of deck.path.points) {
      const d = Math.hypot(point[0] - x, point[1] - z)
      if (d < nearestDistance) {
        nearestDistance = d
        nearest = point
      }
    }
    const rotation = Math.atan2(nearest[0] - x, nearest[1] - z)
    agara.statue = { x, z, rotation }
    agara.viewDecks = ringRoad.filter((candidate) => candidate.path.points.some(([px, pz]) => Math.hypot(px - x, pz - z) < 160))
    // The plinth is solid, and its ground is taken: nothing is planted or built on it.
    const h = PLINTH / 2
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const corner = (lx: number, lz: number): GroundPoint => [x + lx * cos + lz * sin, z - lx * sin + lz * cos]
    addFootprint(collisions, [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)])
    const g = h + 1
    surface.fillPolygon([corner(-g, -g), corner(g, -g), corner(g, g), corner(-g, g)], Surface.Building)
    agara.report.statueMetresFromTemple = Math.round(Math.hypot(x - cx, z - cz))
    agara.report.statueMetresFromFlyover = Math.round(nearestDistance)
  }
  agara.report.placed = spot ? 1 : 0

  // Outside the temple's door.
  const [frontX, frontZ] = site.front
  const sideX = frontZ
  const sideZ = -frontX
  const inside = innerPoint(site.outline)
  const out = distanceToEdge(site.outline, inside, site.front)
  const doorX = inside[0] + frontX * out
  const doorZ = inside[1] + frontZ * out
  const facingOut = Math.atan2(frontX, frontZ)
  agara.door = { x: doorX, z: doorZ }
  const free = (x: number, z: number, radius: number) => {
    const at = surface.at(x, z)
    return at !== Surface.Road && at !== Surface.Building && at !== Surface.Water && !isNearBuilding(collisions, x, z, radius)
  }

  // Sellers either side of the way in: flowers and coconuts, each with its seller behind it.
  ;[-5.2, -3, 3, 5.2].forEach((across, i) => {
    const x = doorX + frontX * 2.6 + sideX * across
    const z = doorZ + frontZ * 2.6 + sideZ * across
    if (!free(x, z, 0.9)) return
    agara.stalls.push({ x, z, rotation: facingOut, variation: i % 2 === 0 ? 0.2 : 0.8 })
    addPost(collisions, x, z, 0.8)
    agara.people.push({ x: x - frontX * 0.9, z: z - frontZ * 0.9, heading: facingOut, body: (i % 2) as 0 | 1, tint: (i * 0.31 + 0.1) % 1, skin: 0.72 + ((i * 0.13) % 0.3), idle: IDLE_POSE.weight, phase: i * 2.9 })
  })
  // Footwear left outside, in two patches by the door.
  for (const across of [-1.5, 1.5]) {
    const x = doorX + frontX * 0.9 + sideX * across
    const z = doorZ + frontZ * 0.9 + sideZ * across
    if (free(x, z, 0.3)) agara.footwear.push({ x, z, rotation: facingOut, variation: across > 0 ? 0.7 : 0.2 })
  }
  // Devotees: a few every day, facing the door, and many more on a Saturday.
  const stand = (list: ShopPerson[], forward: number, across: number, i: number) => {
    const x = doorX + frontX * forward + sideX * across
    const z = doorZ + frontZ * forward + sideZ * across
    if (!free(x, z, 0.4)) return
    list.push({ x, z, heading: facingOut + Math.PI + (((i * 7) % 5) - 2) * 0.12, body: (i % 2) as 0 | 1, tint: (i * 0.37) % 1, skin: 0.7 + ((i * 0.11) % 0.33), idle: i % 4 === 0 ? IDLE_POSE.phone : i % 2 === 0 ? IDLE_POSE.weight : IDLE_POSE.still, phase: i * 1.9 })
  }
  ;[[1.8, -0.5], [2.4, 0.7], [3.4, -1.3], [4.2, 1.5]].forEach(([forward, across], i) => stand(agara.people, forward, across, i))
  for (let i = 0; i < 22; i++) {
    const row = Math.floor(i / 6)
    const column = (i % 6) - 2.5
    stand(agara.crowd, 3 + row * 1.1 + ((i * 13) % 5) * 0.08, column * 0.95 + ((i * 7) % 3) * 0.12, i + 4)
  }

  // Autos waiting at the kerb of the nearest road.
  const near = nearestRoadPiece(roads, doorX, doorZ, 40)
  if (near) {
    const { start, end, width } = near.piece
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const dirX = (end[0] - start[0]) / length
    const dirZ = (end[1] - start[1]) / length
    const along = (doorX - start[0]) * dirX + (doorZ - start[1]) * dirZ
    const onX = start[0] + dirX * along
    const onZ = start[1] + dirZ * along
    const toDoor = Math.hypot(doorX - onX, doorZ - onZ) || 1
    const inX = (doorX - onX) / toDoor
    const inZ = (doorZ - onZ) / toDoor
    // Keeping left: on the door's side of the road, traffic runs with the door on its left.
    const forward = inX * dirZ - inZ * dirX > 0 ? 1 : -1
    // `?spawn=agara-temple`: in the lane on the door's side, a little short of the door, the temple ahead on the left.
    {
      const lane = Math.min(width / 4, 1.8)
      const x = onX + inX * lane - dirX * forward * 14
      const z = onZ + inZ * lane - dirZ * forward * 14
      if (surface.at(x, z) === Surface.Road && !isNearBuilding(collisions, x, z, 1.2)) agara.templeSpawn = { name: site.name ?? 'Agara temple', x, z, heading: Math.atan2(dirX * forward, dirZ * forward) }
    }
    for (let i = 0; i < 3; i++) {
      // Past the door, the way the traffic on this side runs: ahead of anyone arriving, not among them.
      const x = onX + inX * (width / 2 - 1.1) + dirX * forward * (6 + i * 3.3)
      const z = onZ + inZ * (width / 2 - 1.1) + dirZ * forward * (6 + i * 3.3)
      if (surface.at(x, z) !== Surface.Road || isNearBuilding(collisions, x, z, 1.1)) continue
      agara.autos.push({ x, z, rotation: Math.atan2(dirX * forward, dirZ * forward), variation: (i * 0.37 + 0.2) % 1, car: true, model: 0 })
      addPost(collisions, x, z, 1)
    }
  }

  // The Jagannath temple nearest the statue (Odisha style, worship.ts' `kalinga`), for the map.
  let jagannathDistance = Infinity
  for (const other of worship) {
    if (other.faith !== 'kalinga' || other.outline.length === 0) continue
    const [ox, oz] = centreOf(other.outline)
    const distance = Math.hypot(ox - cx, oz - cz)
    if (distance < jagannathDistance) {
      jagannathDistance = distance
      agara.jagannath = { x: ox, z: oz, name: other.name ?? 'Jagannath Temple' }
    }
  }
  if (agara.jagannath) agara.report.jagannathMetresFromTemple = Math.round(jagannathDistance)

  // The festival's street: the road nearest the Jagannath temple, up to 45 m either way from the temple.
  if (agara.jagannath) {
    const { x: jx, z: jz } = agara.jagannath
    const by = nearestRoadPiece(roads, jx, jz, 60)
    if (by) {
      const { start, end, width } = by.piece
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
      const dirX = (end[0] - start[0]) / length
      const dirZ = (end[1] - start[1]) / length
      const along = Math.max(0, Math.min(length, (jx - start[0]) * dirX + (jz - start[1]) * dirZ))
      const from = Math.max(0, along - 45)
      const to = Math.min(length, along + 45)
      if (to - from > 25) {
        const festival = { ax: start[0] + dirX * from, az: start[1] + dirZ * from, bx: start[0] + dirX * to, bz: start[1] + dirZ * to, width, crowd: [] as ShopPerson[], road: '' }
        // The crowd lines both edges of the street, watching the chariot pass.
        const steps = Math.floor((to - from - 6) / 4.2)
        for (let k = 0; k <= steps; k++) {
          for (const side of [-1, 1]) {
            const s = from + 3 + k * 4.2 + (side > 0 ? 1.4 : 0)
            const across = side * (width / 2 - 0.5 - ((k * 3) % 2) * 0.5)
            const x = start[0] + dirX * s + dirZ * across
            const z = start[1] + dirZ * s - dirX * across
            if (isNearBuilding(collisions, x, z, 0.35)) continue
            const i = k * 2 + (side > 0 ? 1 : 0)
            // Facing the middle of the street.
            festival.crowd.push({ x, z, heading: Math.atan2(-dirZ * side, dirX * side), body: (i % 2) as 0 | 1, tint: (i * 0.37) % 1, skin: 0.7 + ((i * 0.11) % 0.33), idle: i % 4 === 0 ? IDLE_POSE.phone : i % 2 === 0 ? IDLE_POSE.weight : IDLE_POSE.still, phase: i * 1.3 })
          }
        }
        agara.festival = festival
        agara.report.festivalStreetMetres = Math.round(to - from)
        agara.report.festivalCrowd = festival.crowd.length
      }
    }
  }

  // The Agara bus stop: OSM's stop nearest the temple (landmarkPlacement.ts puts its shelter and
  // board up, and buses pull in at it). People wait in front of it all day, and many more at rush hour.
  let stopDistance = Infinity
  let agaraStop: BusStop | null = null
  for (const stop of stops) {
    const distance = Math.hypot(stop.x - doorX, stop.z - doorZ)
    if (distance < stopDistance) {
      stopDistance = distance
      agaraStop = stop
    }
  }
  if (agaraStop && stopDistance < 400) {
    const stop: BusStop = agaraStop
    const outX = Math.sin(stop.rotation)
    const outZ = Math.cos(stop.rotation)
    const alongX = outZ
    const alongZ = -outX
    const wait = (list: ShopPerson[], k: number, across: number, out: number) => {
      const x = stop.x + alongX * across + outX * out
      const z = stop.z + alongZ * across + outZ * out
      // In the shelter's open front and on the footpath before it: never out on the road.
      if (surface.at(x, z) === Surface.Road) return
      list.push({ x, z, heading: stop.rotation + (((k * 5) % 7) - 3) * 0.14, body: (k % 2) as 0 | 1, tint: (k * 0.41 + 0.2) % 1, skin: 0.7 + ((k * 0.13) % 0.33), idle: k % 3 === 0 ? IDLE_POSE.phone : k % 3 === 1 ? IDLE_POSE.weight : IDLE_POSE.still, phase: k * 2.1 })
    }
    for (let k = 0; k < 7; k++) wait(agara.people, k + 30, (k - 3) * 0.85 + ((k * 7) % 3) * 0.1, 0.15 + (k % 2) * 0.45)
    for (let k = 0; k < 12; k++) wait(agara.rushCrowd, k + 50, (k - 5.5) * 0.75, 0.3 + (k % 3) * 0.35)
  }

  // Under the flyover by the junction: an auto stand in the shade between the pillars, nose to
  // tail along the deck, and a coconut seller's stall at its end.
  {
    let placed = 0
    for (const candidate of ringRoad) {
      if (placed >= 4 || !candidate.path.points.some(([px, pz]) => Math.hypot(px - cx, pz - cz) < NEAR_FLYOVER)) continue
      const { points, at } = candidate.path
      let cartDone = false
      for (let i = 2; i < points.length - 2 && placed < 4; i++) {
        if (candidate.heights[i] < 4.6 || Math.round(at[i] / 4) % 2 !== 0) continue
        const [x, z] = points[i]
        const [nx, nz] = points[i + 1]
        const length = Math.hypot(nx - x, nz - z) || 1
        const dirX = (nx - x) / length
        const dirZ = (nz - z) / length
        // To one side of the pillars' line, in the shade.
        const sx = x + dirZ * 2.4
        const sz = z - dirX * 2.4
        const ground = surface.at(sx, sz)
        if ((ground !== Surface.Open && ground !== Surface.Median && ground !== Surface.Paved) || isNearBuilding(collisions, sx, sz, 1.5)) continue
        if (!cartDone) {
          agara.stalls.push({ x: sx, z: sz, rotation: Math.atan2(dirZ, -dirX), variation: 0.8 })
          agara.people.push({ x: sx - dirZ * 0.9, z: sz + dirX * 0.9, heading: Math.atan2(dirZ, -dirX), body: 0, tint: 0.62, skin: 0.78, idle: IDLE_POSE.weight, phase: 4.2 })
          addPost(collisions, sx, sz, 0.9)
          cartDone = true
          continue
        }
        agara.standAutos.push({ x: sx, z: sz, rotation: Math.atan2(dirX, dirZ), variation: (placed * 0.37 + 0.1) % 1, car: true, model: 0 })
        addPost(collisions, sx, sz, 1)
        placed++
      }
    }
  }
  agara.report.metresToBusStop = Number.isFinite(stopDistance) ? Math.round(stopDistance) : -1
  agara.report.stalls = agara.stalls.length
  agara.report.footwear = agara.footwear.length
  agara.report.autos = agara.autos.length
  agara.report.people = agara.people.length
  agara.report.saturdayCrowd = agara.crowd.length
  agara.report.rushHourAtBusStop = agara.rushCrowd.length
  agara.report.autosUnderFlyover = agara.standAutos.length
  return agara
}
