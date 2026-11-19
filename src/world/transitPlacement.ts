import { addPost, addWall, isNearBuilding, type CollisionWorld } from './collision'
import type { StiltVehicle } from './houseKit'
import type { Landmarks } from './landmarkPlacement'
import type { Feature, MapData } from './mapData'
import { nearestRoadPiece, type RoadIndex } from './props'
import { getRoadWidth } from './roadData'
import { Surface, type SurfaceMap } from './surfaceMap'
import { isInsideBounds, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

/*
 * The metro, from OpenStreetMap (scripts/prepare_transit.mjs): the Yellow Line runs on its
 * viaduct down Hosur Road, on the pillars landmarkPlacement.ts stood in the median. Here:
 * - the line's path along those pillars, in order, for the tracks and the trains (MetroTrains),
 * - its stations where OSM has them (Hongasandra, Bommanahalli, Central Silk Board), each a
 *   concourse over the road and platforms at the deck, with stairs and escalators down at OSM's
 *   entrances, Kannada and English name boards,
 * - and below them, autos and bikes waiting by the entrances and vendors' carts in the median.
 * Everything below is checked on the surface map, and made solid.
 */

/** A path along the ground: its points and the distance to each from the start. */
export type Path = { points: GroundPoint[]; at: number[]; length: number }

export function makePath(points: GroundPoint[]): Path {
  const at = [0]
  for (let i = 1; i < points.length; i++) at.push(at[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  return { points, at, length: at[at.length - 1] ?? 0 }
}

/** The point `distance` along a path, and the direction it runs there. */
export function pointOnPath(path: Path, distance: number): { x: number; z: number; dirX: number; dirZ: number } {
  const { points, at } = path
  const s = Math.max(0, Math.min(path.length, distance))
  let i = 1
  while (i < at.length - 1 && at[i] < s) i++
  const [ax, az] = points[i - 1]
  const [bx, bz] = points[i]
  const span = at[i] - at[i - 1] || 1
  const t = (s - at[i - 1]) / span
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dirX: (bx - ax) / span, dirZ: (bz - az) / span }
}

/** How far along a path the point nearest (x, z) is, and how far off the path that point is. */
export function projectOnPath(path: Path, x: number, z: number): { along: number; off: number } {
  let best = { along: 0, off: Infinity }
  for (let i = 1; i < path.points.length; i++) {
    const [ax, az] = path.points[i - 1]
    const [bx, bz] = path.points[i]
    const span = path.at[i] - path.at[i - 1]
    if (span <= 0) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (span * span)))
    const off = Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t)
    if (off < best.off) best = { along: path.at[i - 1] + span * t, off }
  }
  return best
}

export type MetroStation = {
  name: string
  nameKannada: string
  /** Its middle along the metro path, and where that is, and the way the line runs there. */
  along: number
  x: number
  z: number
  dirX: number
  dirZ: number
  /** How far the concourse reaches out each side of the line, in metres. */
  halfWidth: number
  /** Stairs and escalators down to the footpath: the foot of the flight, the way it climbs, and which side of the line. */
  entrances: { x: number; z: number; climbX: number; climbZ: number; side: number; label: string }[]
}

export type Metro = {
  /** The line along the pillars, in order, at the viaduct's middle. Empty with no metro on the map. */
  path: Path
  stations: MetroStation[]
  /** Below the stations: autos waiting at the kerb, parked bikes and vendors' carts in the median. */
  autos: StiltVehicle[]
  bikes: StiltVehicle[]
  carts: { x: number; z: number; rotation: number; variation: number }[]
  report: Record<string, number>
}

/** How long a station is along the line, and its concourse's and platforms' heights, in metres. */
export const STATION = { length: 76, concourse: 6.4, platform: 14.6, roof: 20.5, minHalfWidth: 12, maxHalfWidth: 19 }
/** A flight of stairs climbs this far along the ground to the concourse. */
export const STAIR_RUN = 11

const toGround = (position: LonLat): GroundPoint => {
  const [x, , z] = lonLatToWorld(position)
  return [x, z]
}

/** The metro line's ways, stitched end to end into one line, the longest run. */
export function stitchLine(ways: GroundPoint[][]): GroundPoint[] {
  const left = ways.map((way) => way.slice())
  if (left.length === 0) return []
  let line = left.shift()!
  const near = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3
  for (let grew = true; grew && left.length > 0; ) {
    grew = false
    for (let i = 0; i < left.length; i++) {
      const way = left[i]
      if (near(line[line.length - 1], way[0])) line = [...line, ...way.slice(1)]
      else if (near(line[line.length - 1], way[way.length - 1])) line = [...line, ...way.reverse().slice(1)]
      else if (near(line[0], way[way.length - 1])) line = [...way.slice(0, -1), ...line]
      else if (near(line[0], way[0])) line = [...way.reverse().slice(0, -1), ...line]
      else continue
      left.splice(i, 1)
      grew = true
      break
    }
  }
  return line
}

/** The Yellow Line as OSM has it, stitched into one path, or an empty path with no metro on the map. */
export function metroLine(data: MapData): Path {
  const lineWays = data.transit.filter(
    (feature): feature is Feature<{ type: 'LineString'; coordinates: LonLat[] }> =>
      feature.geometry.type === 'LineString' && feature.properties.railway === 'subway' && /yellow/i.test(feature.properties.name ?? feature.properties['name:en'] ?? ''),
  )
  return makePath(stitchLine(lineWays.map((way) => way.geometry.coordinates.map(toGround))))
}

/** Pillars further from OSM's line than this stand on another road that happens to share Hosur Road's name. */
export const PILLAR_LINE_REACH = 30

export function planMetro({
  data,
  landmarks,
  surface,
  roads,
  collisions,
}: {
  data: MapData
  landmarks: Landmarks
  surface: SurfaceMap
  roads: RoadIndex
  collisions: CollisionWorld
}): Metro {
  const metro: Metro = { path: makePath([]), stations: [], autos: [], bikes: [], carts: [], report: {} }
  const line = metroLine(data)
  if (line.length === 0 || landmarks.pillars.length < 2) return metro

  // The pillars along the line, in its order: the trains run over them, as the deck does.
  const ordered = landmarks.pillars
    .map(({ x, z }) => ({ x, z, ...projectOnPath(line, x, z) }))
    .filter(({ off }) => off < PILLAR_LINE_REACH)
    .sort((a, b) => a.along - b.along)
  metro.report.pillarsOnLine = ordered.length
  metro.report.pillarsOffLine = landmarks.pillars.length - ordered.length
  metro.report.pillarsMeanOffset = ordered.length ? Math.round((ordered.reduce((sum, { off }) => sum + off, 0) / ordered.length) * 10) / 10 : 0
  if (ordered.length < 2) return metro
  metro.path = makePath(ordered.map(({ x, z }): GroundPoint => [x, z]))

  // ---- Stations: OSM's subway stations near the line ----
  const stationNodes = data.transit.filter(
    (feature) => feature.geometry.type === 'Point' && feature.properties.railway === 'station' && (feature.properties.station === 'subway' || feature.properties.station === 'light_rail' || feature.properties.subway === 'yes'),
  )
  const entranceNodes = data.transit.filter((feature) => feature.geometry.type === 'Point' && feature.properties.railway === 'subway_entrance')
  for (const node of stationNodes) {
    const [x, z] = toGround(node.geometry.coordinates as LonLat)
    const { along, off } = projectOnPath(metro.path, x, z)
    // On the line, and far enough from its ends for the whole station to stand on pillars.
    if (off > 60 || along < STATION.length / 2 - 10 || along > metro.path.length - STATION.length / 2 + 10) continue
    const middle = pointOnPath(metro.path, along)
    if (!isInsideBounds(middle.x, middle.z, 20)) continue
    const station: MetroStation = {
      name: node.properties['name:en'] ?? node.properties.name ?? 'Metro',
      nameKannada: node.properties['name:kn'] ?? '',
      along,
      ...middle,
      halfWidth: STATION.minHalfWidth,
      entrances: [],
    }
    // Wide enough to reach over the road to the footpaths: where the road ends each side.
    const acrossX = middle.dirZ
    const acrossZ = -middle.dirX
    for (const side of [1, -1]) {
      for (let out = 6; out < STATION.maxHalfWidth + 4; out += 0.5) {
        const ground = surface.at(middle.x + acrossX * out * side, middle.z + acrossZ * out * side)
        if (ground === Surface.Footpath || ground === Surface.Open || ground === Surface.Building) {
          station.halfWidth = Math.min(STATION.maxHalfWidth, Math.max(station.halfWidth, out + 2))
          break
        }
      }
    }
    // Entrances: OSM's near this station, or else one each side, on the footpath. Each flight
    // climbs along the footpath, towards the station's middle, up to the concourse's edge.
    const nearby = entranceNodes
      .map((entrance) => toGround(entrance.geometry.coordinates as LonLat))
      .map(([ex, ez], i) => ({ ex, ez, label: entranceNodes[i].properties.name ?? '' }))
      .filter(({ ex, ez }) => Math.hypot(ex - middle.x, ez - middle.z) < 140)
    const spots = nearby.length
      ? nearby.map(({ ex, ez, label }) => {
          const side = (ex - middle.x) * acrossX + (ez - middle.z) * acrossZ >= 0 ? 1 : -1
          return { side, label }
        })
      : [
          { side: 1, label: '' },
          { side: -1, label: '' },
        ]
    const usedSides = new Map<number, number>()
    for (const { side, label } of spots) {
      // One flight per corner: up to two each side, at either end of the concourse.
      const count = usedSides.get(side) ?? 0
      if (count >= 2) continue
      usedSides.set(side, count + 1)
      const end = count === 0 ? 1 : -1
      // On the footpath just outside the concourse, the foot of the flight a stair's run back from the end.
      let footOut = station.halfWidth - 1.5
      for (let out = station.halfWidth - 4; out < station.halfWidth + 6; out += 0.5) {
        if (surface.at(middle.x + acrossX * out * side, middle.z + acrossZ * out * side) === Surface.Footpath) {
          footOut = out + 0.8
          break
        }
      }
      const footAlong = end * (STATION.length / 2 + STAIR_RUN - 2)
      const fx = middle.x + middle.dirX * footAlong + acrossX * footOut * side
      const fz = middle.z + middle.dirZ * footAlong + acrossZ * footOut * side
      station.entrances.push({ x: fx, z: fz, climbX: -middle.dirX * end, climbZ: -middle.dirZ * end, side, label })
      // Solid: the flight's side walls.
      const topX = fx - middle.dirX * end * STAIR_RUN
      const topZ = fz - middle.dirZ * end * STAIR_RUN
      for (const edge of [-1.6, 1.6]) addWall(collisions, [fx + acrossX * edge, fz + acrossZ * edge], [topX + acrossX * edge, topZ + acrossZ * edge], 0.2)
    }
    // The concourse's columns at its outer edges, every 12 m: solid.
    for (let a = -STATION.length / 2 + 4; a <= STATION.length / 2 - 4; a += 12) {
      for (const side of [1, -1]) {
        const cx = middle.x + middle.dirX * a + acrossX * (station.halfWidth - 1) * side
        const cz = middle.z + middle.dirZ * a + acrossZ * (station.halfWidth - 1) * side
        if (surface.at(cx, cz) !== Surface.Road) addPost(collisions, cx, cz, 0.6)
      }
    }
    metro.stations.push(station)

    // ---- Below: autos at the kerb by each entrance, bikes and carts in the median ----
    for (const entrance of station.entrances) {
      const near = nearestRoadPiece(roads, entrance.x, entrance.z, 12)
      if (!near) continue
      const { start, end } = near.piece
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
      const dirX = (end[0] - start[0]) / length
      const dirZ = (end[1] - start[1]) / length
      const facing = Math.atan2(dirX, dirZ)
      // At the kerb: back from the entrance's edge of the road, a row of three, nose to tail.
      const kerbX = -(entrance.x - (start[0] + dirX * ((entrance.x - start[0]) * dirX + (entrance.z - start[1]) * dirZ)))
      const kerbZ = -(entrance.z - (start[1] + dirZ * ((entrance.x - start[0]) * dirX + (entrance.z - start[1]) * dirZ)))
      const kerbLength = Math.hypot(kerbX, kerbZ) || 1
      const inX = kerbX / kerbLength
      const inZ = kerbZ / kerbLength
      for (let i = 0; i < 3; i++) {
        const back = 4 + i * 3.3
        const x = entrance.x + inX * (Math.max(0, near.edge) + 1.3) - entrance.climbX * back
        const z = entrance.z + inZ * (Math.max(0, near.edge) + 1.3) - entrance.climbZ * back
        if (surface.at(x, z) !== Surface.Road || isNearBuilding(collisions, x, z, 1.1)) continue
        metro.autos.push({ x, z, rotation: facing + (dirX * entrance.climbX + dirZ * entrance.climbZ > 0 ? Math.PI : 0), variation: (i * 0.37) % 1, car: true, model: 0 })
        addPost(collisions, x, z, 1)
      }
    }
    // The median under the viaduct, either side of the station: parked bikes and a cart or two.
    for (let a = -STATION.length / 2; a <= STATION.length / 2; a += 1.1) {
      const p = pointOnPath(metro.path, along + a)
      if (surface.at(p.x, p.z) !== Surface.Median || isNearBuilding(collisions, p.x, p.z, 0.5)) continue
      const slot = Math.round((a + STATION.length / 2) / 1.1)
      if (slot % 14 === 6) {
        metro.carts.push({ x: p.x, z: p.z, rotation: Math.atan2(p.dirX, p.dirZ) + Math.PI / 2, variation: (slot * 0.29) % 1 })
        addPost(collisions, p.x, p.z, 0.9)
      } else if (slot % 14 < 4 || slot % 14 > 9) {
        metro.bikes.push({ x: p.x, z: p.z, rotation: Math.atan2(p.dirX, p.dirZ) + Math.PI / 2 + ((slot % 3) - 1) * 0.12, variation: (slot * 0.61) % 1, car: false })
        addPost(collisions, p.x, p.z, 0.35)
      }
    }
  }
  metro.report.stations = metro.stations.length
  metro.report.entrances = metro.stations.reduce((sum, station) => sum + station.entrances.length, 0)
  metro.report.autos = metro.autos.length
  metro.report.bikes = metro.bikes.length
  metro.report.carts = metro.carts.length
  metro.report.pathMetres = Math.round(metro.path.length)
  return metro
}

// ---------------------------------------------------------------------------
// Flyovers

/*
 * The flyovers OSM maps over HSR's edges (the Silk Board flyovers and interchange, the Outer Ring
 * Road's at Agara, the Electronic City elevated road): scenery overhead for now, with traffic
 * on them, not ridden (mapData.ts takes them out of the roads). Each is a deck at its layer's
 * height, coming down to the ground over a ramp where it meets a road at ground level, on
 * pillars where the ground below allows one (not in a carriageway). Under the decks: parked
 * bikes, a tea stall, posters on the pillars.
 */

export type Flyover = {
  name: string
  /** The deck's middle line, its height at each point, its width, and whether it's one way. */
  path: Path
  heights: number[]
  width: number
  oneWay: boolean
}

export type Flyovers = {
  decks: Flyover[]
  pillars: { x: number; z: number; rotation: number; height: number; width: number; poster: number }[]
  bikes: StiltVehicle[]
  stalls: { x: number; z: number; rotation: number; variation: number }[]
  report: Record<string, number>
}

/** A deck's height above the ground by its layer, in metres (the metro deck is at 12). */
const FLYOVER_HEIGHT: Record<number, number> = { 1: 6.8, 2: 9.4 }
/** It comes down to the ground over this far at an end that meets a road at ground level. */
const RAMP = 130
const FLYOVER_PILLAR_EVERY = 28
/** Ground a pillar can stand on. */
const PILLAR_GROUND = new Set<Surface>([Surface.Median, Surface.Open, Surface.Footpath, Surface.Park, Surface.Plot, Surface.Paved])

export function planFlyovers({ data, surface, collisions }: { data: MapData; surface: SurfaceMap; collisions: CollisionWorld }): Flyovers {
  const flyovers: Flyovers = { decks: [], pillars: [], bikes: [], stalls: [], report: {} }
  // Which ends meet another flyover (so stay up) and which meet the ground (so ramp down).
  const endKey = ([x, z]: GroundPoint) => `${Math.round(x)},${Math.round(z)}`
  const ends = new Map<string, number>()
  const lines = data.flyovers.map((road) => road.geometry.coordinates.map(toGround))
  for (const line of lines) for (const end of [line[0], line[line.length - 1]]) ends.set(endKey(end), (ends.get(endKey(end)) ?? 0) + 1)

  data.flyovers.forEach((road, i) => {
    const line = lines[i]
    if (line.length < 2 || !line.some(([x, z]) => isInsideBounds(x, z, -150))) return
    const path = makePath(line)
    const top = FLYOVER_HEIGHT[Math.min(2, Math.max(1, Number(road.properties.layer ?? 1)))]
    const startsLow = (ends.get(endKey(line[0])) ?? 0) < 2
    const endsLow = (ends.get(endKey(line[line.length - 1])) ?? 0) < 2
    const ramp = Math.min(RAMP, path.length / 2)
    const heights = path.at.map((s) => {
      let height = top
      if (startsLow) height = Math.min(height, (top * s) / ramp)
      if (endsLow) height = Math.min(height, (top * (path.length - s)) / ramp)
      return height
    })
    const deck: Flyover = { name: road.properties.name ?? 'Flyover', path, heights, width: Math.max(7, getRoadWidth(road)), oneWay: road.properties.oneway === 'yes' }
    flyovers.decks.push(deck)

    // Pillars along the raised part, where the ground allows; under the highest, life.
    let sinceStall = 60
    for (let s = FLYOVER_PILLAR_EVERY / 2; s < path.length; s += FLYOVER_PILLAR_EVERY) {
      const height = heightOnFlyover(deck, s)
      if (height < 3.5) continue
      const { x, z, dirX, dirZ } = pointOnPath(path, s)
      if (!isInsideBounds(x, z, 4)) continue
      const ground = surface.at(x, z)
      const rotation = Math.atan2(dirX, dirZ)
      if (PILLAR_GROUND.has(ground) && !isNearBuilding(collisions, x, z, 1.2)) {
        flyovers.pillars.push({ x, z, rotation, height, width: deck.width, poster: flyovers.pillars.length % 3 === 0 ? flyovers.pillars.length % 12 : -1 })
        addPost(collisions, x, z, 1.0)
      }
      // In the shade either side of every third pillar, on open ground or a median: bikes, now and then a tea stall.
      sinceStall += FLYOVER_PILLAR_EVERY
      if (Math.round(s / FLYOVER_PILLAR_EVERY) % 3 !== 0) continue
      for (const side of [-1, 1]) {
        const ox = x + dirZ * side * 3.2
        const oz = z - dirX * side * 3.2
        const under = surface.at(ox, oz)
        if (!PILLAR_GROUND.has(under) || isNearBuilding(collisions, ox, oz, 1.4)) continue
        if (sinceStall > 160 && under !== Surface.Median) {
          flyovers.stalls.push({ x: ox, z: oz, rotation: rotation + (side > 0 ? -Math.PI / 2 : Math.PI / 2), variation: (flyovers.stalls.length * 0.37) % 1 })
          addPost(collisions, ox, oz, 1.3)
          sinceStall = 0
          continue
        }
        for (let b = -2; b <= 2; b++) {
          const bx = ox + dirX * b * 1.05
          const bz = oz + dirZ * b * 1.05
          if (!PILLAR_GROUND.has(surface.at(bx, bz)) || isNearBuilding(collisions, bx, bz, 0.5)) continue
          flyovers.bikes.push({ x: bx, z: bz, rotation: rotation + Math.PI / 2 + (b % 2) * 0.1, variation: ((flyovers.bikes.length * 0.618) % 1), car: false })
          addPost(collisions, bx, bz, 0.35)
        }
      }
    }
  })
  flyovers.report.decks = flyovers.decks.length
  flyovers.report.metres = Math.round(flyovers.decks.reduce((sum, deck) => sum + deck.path.length, 0))
  flyovers.report.pillars = flyovers.pillars.length
  flyovers.report.bikes = flyovers.bikes.length
  flyovers.report.stalls = flyovers.stalls.length
  return flyovers
}

/** A flyover's deck height `s` along it. */
export function heightOnFlyover(deck: Flyover, s: number): number {
  const { at } = deck.path
  let i = 1
  while (i < at.length - 1 && at[i] < s) i++
  const span = at[i] - at[i - 1] || 1
  const t = Math.max(0, Math.min(1, (s - at[i - 1]) / span))
  return deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * t
}

// ---------------------------------------------------------------------------
// The bus stand

/*
 * HSR Layout's bus stand, by the BDA Complex, where OSM has its station: a concrete apron off the
 * road with a long island under a canopy, four numbered bays with their routes, buses waiting at
 * them and people on the island.
 */

export type BusStand = {
  name: string
  nameKannada: string
  /** Its middle, and the way the road runs past it (the island runs the same way). */
  x: number
  z: number
  dirX: number
  dirZ: number
  /** Which side of the island the road is on: the apron's open side. */
  roadSide: number
  /** 1 for the full stand, less where only a smaller one fits. */
  scale: number
  bays: { number: number; routes: string[] }[]
  buses: { x: number; z: number; rotation: number; variation: number }[]
  people: { x: number; z: number; heading: number }[]
}

export const BUS_STAND = { length: 40, depth: 22, island: { length: 32, width: 3.4 } }
/** How far from OSM's spot a site for the stand is looked for, in metres. */
const STAND_REACH = 200

export function planBusStand({ data, surface, roads, collisions, routes }: { data: MapData; surface: SurfaceMap; roads: RoadIndex; collisions: CollisionWorld; routes: string[] }): BusStand | null {
  const node = data.transit.find(
    (feature) =>
      feature.geometry.type === 'Point' &&
      (feature.properties.public_transport === 'station' || feature.properties.amenity === 'bus_station') &&
      /hsr/i.test(feature.properties.name ?? ''),
  )
  if (!node) return null
  const [nx, nz] = toGround(node.geometry.coordinates as LonLat)
  const road = nearestRoadPiece(roads, nx, nz, 80)
  if (!road) return null
  const roadLength = Math.hypot(road.piece.end[0] - road.piece.start[0], road.piece.end[1] - road.piece.start[1]) || 1
  const roadX = (road.piece.end[0] - road.piece.start[0]) / roadLength
  const roadZ = (road.piece.end[1] - road.piece.start[1]) / roadLength
  const ground = new Set<Surface>([Surface.Open, Surface.Paved, Surface.Plot, Surface.Park])
  // The nearest clear site to OSM's spot, along the nearest road or square to it.
  let best: { x: number; z: number; distance: number; dirX: number; dirZ: number; scale: number } | null = null
  // The full stand if it fits within reach, else a smaller one (four-fifths the size).
  for (const scale of [1, 0.8]) {
    for (const [dirX, dirZ] of [[roadX, roadZ], [roadZ, -roadX]]) {
      for (let dx = -STAND_REACH; dx <= STAND_REACH; dx += 5) {
        for (let dz = -STAND_REACH; dz <= STAND_REACH; dz += 5) {
          const x = nx + dx
          const z = nz + dz
          const distance = Math.hypot(dx, dz)
          if (distance > STAND_REACH || (best && distance >= best.distance)) continue
          let clear = true
          for (let a = (-BUS_STAND.length * scale) / 2; a <= (BUS_STAND.length * scale) / 2 && clear; a += 2) {
            for (let o = (-BUS_STAND.depth * scale) / 2; o <= (BUS_STAND.depth * scale) / 2 && clear; o += 2) {
              const px = x + dirX * a + dirZ * o
              const pz = z + dirZ * a - dirX * o
              if (!ground.has(surface.at(px, pz)) || isNearBuilding(collisions, px, pz, 0.5)) clear = false
            }
          }
          if (clear) best = { x, z, distance, dirX, dirZ, scale }
        }
      }
    }
    if (best) break
  }
  if (!best) return null
  const { x, z, dirX, dirZ, scale } = best
  // The way out: the road nearest the site, whose side the apron opens onto.
  const exit = nearestRoadPiece(roads, x, z, 60) ?? road
  // The road's side: the apron opens towards it.
  const roadSide = (exit.piece.start[0] - x) * dirZ - (exit.piece.start[1] - z) * dirX >= 0 ? 1 : -1
  const at = (a: number, o: number): GroundPoint => [x + dirX * a + dirZ * o * roadSide, z + dirZ * a - dirX * o * roadSide]
  const stand: BusStand = {
    name: 'HSR Layout Bus Stand',
    nameKannada: 'ಎಚ್‌ಎಸ್‌ಆರ್ ಬಡಾವಣೆ ಬಸ್ ನಿಲ್ದಾಣ',
    x,
    z,
    dirX,
    dirZ,
    roadSide,
    scale: 1,
    bays: [1, 2, 3, 4].map((number, i) => ({ number, routes: routes.slice(i * 3, i * 3 + 3) })),
    buses: [],
    people: [],
  }
  // The apron is paved ground: concrete, with nothing planted on it.
  const length = (BUS_STAND.length * scale) / 2
  const depth = (BUS_STAND.depth * scale) / 2
  surface.fillPolygon([at(-length, -depth), at(length, -depth), at(length, depth), at(-length, depth)], Surface.Paved)
  // Solid: the island, and the buses at three of the bays (two on the road side, one behind).
  const island = { length: BUS_STAND.island.length * scale, width: BUS_STAND.island.width }
  stand.scale = scale
  addWall(collisions, at(-island.length / 2, 0), at(island.length / 2, 0), island.width)
  const rotation = Math.atan2(dirX, dirZ)
  for (const [a, o] of [[-9 * scale, 3.6], [8 * scale, 3.6], [-1, -3.6]] as const) {
    const [bx, bz] = at(a, o)
    stand.buses.push({ x: bx, z: bz, rotation, variation: (stand.buses.length * 0.37) % 1 })
    addWall(collisions, at(a - 5.4, o), at(a + 5.4, o), 2.5)
  }
  // People on the island, under the canopy, facing the bays.
  for (let i = 0; i < 9; i++) {
    const a = -island.length / 2 + 2 + (i * (island.length - 4)) / 8 + ((i * 37) % 5) * 0.2
    const side = i % 2 === 0 ? 1 : -1
    const [px, pz] = at(a, side * 0.9)
    stand.people.push({ x: px, z: pz, heading: Math.atan2(dirZ * side * roadSide, -dirX * side * roadSide) })
  }
  return stand
}
