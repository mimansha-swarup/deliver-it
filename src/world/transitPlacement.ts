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
/** The first point of a path at or past `s` metres along it (never the very first): a binary search, as the decks' paths have thousands of points. */
function segmentAt(at: number[], s: number): number {
  let low = 1
  let high = at.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (at[middle] < s) low = middle + 1
    else high = middle
  }
  return low
}

export function pointOnPath(path: Path, distance: number): { x: number; z: number; dirX: number; dirZ: number } {
  const { points, at } = path
  const s = Math.max(0, Math.min(path.length, distance))
  const i = segmentAt(at, s)
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
export const STATION = { length: 76, concourse: 6.4, platform: 14.6, roof: 20.5, minHalfWidth: 12, maxHalfWidth: 19, narrowest: 9 }
/** Half the viaduct deck's width and a little (landmarkPlacement's deck is 8.6 m wide). */
const VIADUCT_HALF_WIDTH = 5.3
/** The underside of the viaduct's deck, in metres (CityLandmarks.tsx' DECK.bottom is 12), less its bearings. */
const VIADUCT_UNDERSIDE = 11.6
/** A station's concourse floor's depth below its top: its underside is this far below `STATION.concourse`. */
const STATION_FLOOR = 0.6
/** A flight of stairs climbs this far along the ground to the concourse. */
export const STAIR_RUN = 11

const toGround = (position: LonLat): GroundPoint => {
  const [x, , z] = lonLatToWorld(position)
  return [x, z]
}

/**
 * A line with its kinks taken out: each point moved towards the middle of its neighbours (a quarter
 * of each, half of itself), `passes` times over, the two ends left exactly where they are so that
 * what joins there still joins. The map's lines have corners every few metres (their points are
 * rounded to about a metre, and drawn by hand), and a flyover or a viaduct built straight along
 * them zig-zags; a real one is a run of straights and smooth curves.
 */
export function smoothLine(points: GroundPoint[], passes: number): GroundPoint[] {
  let line = points
  for (let pass = 0; pass < passes && line.length > 2; pass++) {
    line = line.map(([x, z], i): GroundPoint => {
      if (i === 0 || i === line.length - 1) return [x, z]
      return [x * 0.5 + (line[i - 1][0] + line[i + 1][0]) * 0.25, z * 0.5 + (line[i - 1][1] + line[i + 1][1]) * 0.25]
    })
  }
  return line
}

/** The metro line's ways, stitched end to end into one line, the longest run. */
export function stitchLine(ways: GroundPoint[][]): GroundPoint[] {
  // The longest way first, and the rest joined to its ends.
  const left = ways.map((way) => way.slice()).sort((a, b) => lengthOf(b) - lengthOf(a))
  if (left.length === 0) return []
  let line = left.shift()!
  const near = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 3
  // A way is only joined on if it carries on the way the line was going. The metro's two tracks are
  // separate ways whose ends lie within a few metres of each other: joined regardless, the line ran
  // up one track, turned back down the other and up again, and the viaduct was built as that zig-zag.
  const carriesOn = (from: GroundPoint, at: GroundPoint, to: GroundPoint) => (at[0] - from[0]) * (to[0] - at[0]) + (at[1] - from[1]) * (to[1] - at[1]) > 0
  for (let grew = true; grew && left.length > 0; ) {
    grew = false
    for (let i = 0; i < left.length; i++) {
      const way = left[i]
      if (way.length < 2 || line.length < 2) continue
      const end = line[line.length - 1]
      const beforeEnd = line[line.length - 2]
      const start = line[0]
      const afterStart = line[1]
      if (near(end, way[0]) && carriesOn(beforeEnd, end, way[1])) line = [...line, ...way.slice(1)]
      else if (near(end, way[way.length - 1]) && carriesOn(beforeEnd, end, way[way.length - 2])) line = [...line, ...way.reverse().slice(1)]
      else if (near(start, way[way.length - 1]) && carriesOn(afterStart, start, way[way.length - 2])) line = [...way.slice(0, -1), ...line]
      else if (near(start, way[0]) && carriesOn(afterStart, start, way[1])) line = [...way.reverse().slice(0, -1), ...line]
      else continue
      left.splice(i, 1)
      grew = true
      break
    }
  }
  return line
}

const lengthOf = (way: GroundPoint[]) => way.reduce((sum, [x, z], i) => (i === 0 ? 0 : sum + Math.hypot(x - way[i - 1][0], z - way[i - 1][1])), 0)

/** The Yellow Line as OSM has it, stitched into one path, or an empty path with no metro on the map. */
export function metroLine(data: MapData): Path {
  const lineWays = data.transit.filter(
    (feature): feature is Feature<{ type: 'LineString'; coordinates: LonLat[] }> =>
      feature.geometry.type === 'LineString' && feature.properties.railway === 'subway' && /yellow/i.test(feature.properties.name ?? feature.properties['name:en'] ?? ''),
  )
  return makePath(smoothLine(stitchLine(lineWays.map((way) => way.geometry.coordinates.map(toGround))), 2))
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
  // Through the pillars, smoothed: pillar to pillar exactly, the viaduct swung from side to side
  // (each pillar stands where the ground let it, a metre or two off the line). The deck is far
  // wider than that, so every pillar is still well under it.
  // The viaduct runs along the map's own line for the metro, between the first and last pillars that
  // stand on it, sampled every `METRO_STEP` metres and smoothed. It used to run from pillar to pillar,
  // and the pillars near the line aren't all the metro's (the flyovers beside it have theirs, up to
  // 30 m off): the viaduct swung 15 to 20 m from side to side all the way down Hosur Road.
  const onLine = ordered.filter(({ off }) => off < PILLARS_ON_LINE)
  const span = onLine.length >= 2 ? onLine : ordered
  const from = span[0].along
  const to = span[span.length - 1].along
  const places: GroundPoint[] = []
  const steps = Math.max(1, Math.ceil((to - from) / METRO_STEP))
  for (let k = 0; k <= steps; k++) {
    const { x, z } = pointOnPath(line, from + ((to - from) * k) / steps)
    places.push([x, z])
  }
  metro.path = makePath(smoothLine(places, METRO_SMOOTHING))
  // Nothing tall under the viaduct's deck, and nothing reaching up into it (overheadClearance.ts).
  for (const outline of pathFootprint(metro.path, VIADUCT_HALF_WIDTH)) surface.markOverhead(outline, VIADUCT_UNDERSIDE)

  // ---- Stations: OSM's subway stations near the line ----
  const stationNodes = data.transit.filter(
    (feature) => feature.geometry.type === 'Point' && feature.properties.railway === 'station' && (feature.properties.station === 'subway' || feature.properties.station === 'light_rail' || feature.properties.subway === 'yes'),
  )
  const entranceNodes = data.transit.filter((feature) => feature.geometry.type === 'Point' && feature.properties.railway === 'subway_entrance')
  for (const node of stationNodes) {
    const [x, z] = toGround(node.geometry.coordinates as LonLat)
    const { along: mapped, off } = projectOnPath(metro.path, x, z)
    if (off > 60) continue
    // Where the station stands: as near OSM's spot as it can, slid along the line by up to 64 m to
    // where the most room is either side, clear of buildings (and far enough from the line's ends).
    const roomAt = (at: number) => {
      const p = pointOnPath(metro.path, at)
      let room = STATION.maxHalfWidth
      for (const side of [1, -1]) {
        for (let a = -STATION.length / 2; a <= STATION.length / 2; a += 2) {
          for (let out = 4; out <= room; out += 0.5) {
            const px = p.x + p.dirX * a + p.dirZ * out * side
            const pz = p.z + p.dirZ * a - p.dirX * out * side
            if (surface.at(px, pz) === Surface.Building || isNearBuilding(collisions, px, pz, 0.3)) {
              room = Math.min(room, out - 1)
              break
            }
          }
        }
      }
      return room
    }
    let along = -1
    let bestRoom = -Infinity
    for (const shift of [0, 8, -8, 16, -16, 24, -24, 32, -32, 40, -40, 48, -48, 56, -56, 64, -64]) {
      const at = mapped + shift
      if (at < STATION.length / 2 || at > metro.path.length - STATION.length / 2) continue
      const room = roomAt(at)
      // Room enough for the platforms' outer walls (8.5 m out) is enough: take the nearest such spot.
      if (room >= 9.5) {
        along = at
        break
      }
      if (room > bestRoom) {
        bestRoom = room
        along = at
      }
    }
    if (along < 0) continue
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
    // It stops short of buildings, all along its length, so it never stands over a house.
    let room = STATION.maxHalfWidth
    for (const side of [1, -1]) {
      let reach = STATION.minHalfWidth
      for (let out = 6; out < STATION.maxHalfWidth + 4; out += 0.5) {
        const ground = surface.at(middle.x + acrossX * out * side, middle.z + acrossZ * out * side)
        if (ground === Surface.Footpath || ground === Surface.Open || ground === Surface.Building) {
          reach = out + 1.5
          break
        }
      }
      for (let a = -STATION.length / 2; a <= STATION.length / 2; a += 2) {
        for (let out = 4; out <= reach; out += 0.5) {
          const px = middle.x + middle.dirX * a + acrossX * out * side
          const pz = middle.z + middle.dirZ * a + acrossZ * out * side
          if (surface.at(px, pz) === Surface.Building || isNearBuilding(collisions, px, pz, 0.3)) {
            reach = Math.min(reach, out - 1)
            break
          }
        }
      }
      room = Math.min(room, reach)
      station.halfWidth = Math.max(station.halfWidth, reach)
    }
    station.halfWidth = Math.max(STATION.narrowest, Math.min(station.halfWidth, room))
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
      // The flight, 4.2 m wide, must land on open ground, not on a house.
      let blocked = false
      for (let r = 0; r <= STAIR_RUN + 3 && !blocked; r += 1) {
        for (const edge of [-2.1, 0, 2.1]) {
          const px = fx - middle.dirX * end * r + acrossX * edge
          const pz = fz - middle.dirZ * end * r + acrossZ * edge
          if (surface.at(px, pz) === Surface.Building || isNearBuilding(collisions, px, pz, 0.2)) blocked = true
        }
      }
      if (blocked) {
        usedSides.set(side, count)
        continue
      }
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
    for (const outline of pathFootprint(metro.path, station.halfWidth + 0.5, along - STATION.length / 2, along + STATION.length / 2)) surface.markOverhead(outline, STATION.concourse - STATION_FLOOR)

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
  /** Whether each end comes down to the ground over a ramp. */
  startsLow: boolean
  endsLow: boolean
}

export type Flyovers = {
  decks: Flyover[]
  /** Barriers across the foot of each ramp, where a road at ground level meets it. */
  barriers: { x: number; z: number; rotation: number; width: number }[]
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

/** Below this height the deck can't be ridden under: a solid ramp, walled each side, in metres. */
export const RIDE_UNDER = 3.6
/** How many smoothing passes a flyover's line gets at its 4 m points (about 12 m of line is evened out), and the metro's at its pillars. */
const DECK_SMOOTHING = 10
const METRO_SMOOTHING = 4
/** The metro's own pillars are within this far of its line, in metres; the viaduct's line is sampled this often. */
const PILLARS_ON_LINE = 8
const METRO_STEP = 10
/** The decks are resampled every this many metres, so ramps slope smoothly and stand on the ground. */
const DECK_STEP = 4
/** The ground kept clear either side of a deck, past its edges, in metres. */
const FOOTPRINT_MARGIN = 1.5

/**
 * The decks themselves, from the map alone: each flyover's line, resampled, its heights (up at its
 * layer, down to the ground over a ramp at an end that meets a road at ground level) and width.
 * Needed before the ground map, which paves their footprint.
 */
/**
 * Two flyovers that meet end to end are one road, so they meet at one height. They didn't always:
 * a deck one level up met a deck two levels up as a wall and a drop, and two ends a metre or two
 * apart on the map weren't seen to meet at all (one came down a ramp beside the other's blunt end).
 * Ends within `JOINT.within` metres are one joint; every deck at a joint is at the joint's height
 * there (the mean of theirs) and eases to its own over `JOINT.ease` metres.
 */
const JOINT = { within: 4, ease: 70 }

export function planFlyoverDecks(data: MapData): Flyover[] {
  const lines = data.flyovers.map((road) => road.geometry.coordinates.map(toGround))
  const topOf = (i: number) => FLYOVER_HEIGHT[Math.min(2, Math.max(1, Number(data.flyovers[i].properties.layer ?? 1)))]
  // The joints: each end goes to the first joint within reach, or starts one.
  const joints: { x: number; z: number; tops: number[] }[] = []
  const jointAt = ([x, z]: GroundPoint) => joints.find((joint) => Math.hypot(joint.x - x, joint.z - z) <= JOINT.within)
  lines.forEach((line, i) => {
    if (line.length < 2) return
    for (const end of [line[0], line[line.length - 1]]) {
      const joint = jointAt(end)
      if (joint) joint.tops.push(topOf(i))
      else joints.push({ x: end[0], z: end[1], tops: [topOf(i)] })
    }
  })
  /** The height every deck is at where this end is, or null where it meets no other and comes down to the road. */
  const heightAtEnd = (end: GroundPoint): number | null => {
    const joint = jointAt(end)
    return joint && joint.tops.length > 1 ? joint.tops.reduce((sum, top) => sum + top, 0) / joint.tops.length : null
  }
  const decks: Flyover[] = []
  data.flyovers.forEach((road, i) => {
    const line = lines[i]
    if (line.length < 2 || !line.some(([x, z]) => isInsideBounds(x, z, -150))) return
    const raw = makePath(line)
    // Every DECK_STEP metres along it.
    const steps = Math.max(1, Math.ceil(raw.length / DECK_STEP))
    const points: GroundPoint[] = []
    for (let k = 0; k <= steps; k++) {
      const { x, z } = pointOnPath(raw, (raw.length * k) / steps)
      points.push([x, z])
    }
    // Smoothed, ends pinned (so joints still meet): see `smoothLine`.
    const path = makePath(smoothLine(points, DECK_SMOOTHING))
    const top = topOf(i)
    const startJoint = heightAtEnd(line[0])
    const endJoint = heightAtEnd(line[line.length - 1])
    const startsLow = startJoint === null
    const endsLow = endJoint === null
    const ramp = Math.min(RAMP, path.length / 2)
    const ease = Math.min(JOINT.ease, path.length / 2)
    // An S-curve up each ramp: level where it leaves the road and where it meets the deck, steepest
    // halfway (1.5 times the average: about 8% on the 6.8 m flyovers), so riding over the top and the
    // foot is smooth. The riding (heightOnFlyover) and the drawing both use these heights.
    const curve = (t: number) => {
      const u = Math.max(0, Math.min(1, t))
      return u * u * (3 - 2 * u)
    }
    const heights = path.at.map((s) => {
      let height = top
      // Towards a joint, from its own height to the joint's.
      if (startJoint !== null) height += (startJoint - top) * (1 - curve(s / ease))
      if (endJoint !== null) height += (endJoint - top) * (1 - curve((path.length - s) / ease))
      if (startsLow) height = Math.min(height, top * curve(s / ramp))
      if (endsLow) height = Math.min(height, top * curve((path.length - s) / ramp))
      return height
    })
    decks.push({ name: road.properties.name ?? 'Flyover', path, heights, width: Math.max(7, getRoadWidth(road)), oneWay: road.properties.oneway === 'yes', startsLow, endsLow })
  })
  // More than once: lifting one deck over another can bring it up under a third.
  for (let pass = 0; pass < 4; pass++) giveHeadroom(decks)
  keepUnderMetro(decks, metroLine(data).points)
  return decks
}

/**
 * Where one flyover crosses over another (or over another's ramp), there has to be room under it
 * for a bus: `HEADROOM.clear` metres from road to road (the deck is 1.7 m deep, a bus 3.2 m tall).
 * Two levels 2.6 m apart left 0.9 m, and a deck over a ramp less. The upper one is lifted over the
 * crossing and eased back over `HEADROOM.ease` metres either way; not within `HEADROOM.ends` of its
 * own ends, which stay where the road or the next deck has them. Decks running side by side into
 * one another (a merge, not a crossing: within `HEADROOM.parallel` of the same direction) are left alone.
 */
const HEADROOM = { clear: 5.4, ease: 90, ends: 25, parallel: 0.85 }
/**
 * The metro's viaduct is the highest thing on the road (its rails at 13.6 m, its girders' underside
 * about 2 m below), and a flyover passing under it at 9.4 m left a bus no room. Under the metro a
 * deck is no higher than `UNDER_METRO.top`, coming down to that over `UNDER_METRO.ease` metres
 * either side of where the line crosses (`UNDER_METRO.reach` metres from its middle).
 */
const UNDER_METRO = { top: 7.2, ease: 110, reach: 7 }
function keepUnderMetro(decks: Flyover[], line: GroundPoint[]) {
  if (line.length < 2) return
  const curve = (t: number) => {
    const u = Math.max(0, Math.min(1, t))
    return u * u * (3 - 2 * u)
  }
  for (const deck of decks) {
    const { points, at } = deck.path
    const crossings: number[] = []
    points.forEach(([x, z], i) => {
      for (let k = 1; k < line.length; k++) {
        const [ax, az] = line[k - 1]
        const [bx, bz] = line[k]
        const ex = bx - ax
        const ez = bz - az
        const lengthSquared = ex * ex + ez * ez
        if (lengthSquared < 0.01) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / lengthSquared))
        if (Math.hypot(x - ax - ex * t, z - az - ez * t) < UNDER_METRO.reach + deck.width / 2) {
          crossings.push(at[i])
          return
        }
      }
    })
    if (crossings.length === 0) continue
    deck.heights.forEach((height, i) => {
      if (height <= UNDER_METRO.top) return
      let nearest = Infinity
      for (const s of crossings) nearest = Math.min(nearest, Math.abs(at[i] - s))
      // All the way down at the crossing, its own height again an ease away.
      deck.heights[i] = UNDER_METRO.top + (height - UNDER_METRO.top) * curve(nearest / UNDER_METRO.ease)
    })
  }
}

function giveHeadroom(decks: Flyover[]) {
  const curve = (t: number) => {
    const u = Math.max(0, Math.min(1, t))
    return u * u * (3 - 2 * u)
  }
  const lifts = decks.map((deck) => deck.heights.map(() => 0))
  for (let a = 0; a < decks.length; a++) {
    for (let b = a + 1; b < decks.length; b++) {
      const A = decks[a]
      const B = decks[b]
      const reach = (A.width + B.width) / 2
      for (let i = 1; i < A.path.points.length; i++) {
        const [ax, az] = A.path.points[i]
        const [pax, paz] = A.path.points[i - 1]
        for (let j = 1; j < B.path.points.length; j++) {
          const [bx, bz] = B.path.points[j]
          if (Math.hypot(ax - bx, az - bz) > reach) continue
          const [pbx, pbz] = B.path.points[j - 1]
          const la = Math.hypot(ax - pax, az - paz) || 1
          const lb = Math.hypot(bx - pbx, bz - pbz) || 1
          if (Math.abs(((ax - pax) * (bx - pbx) + (az - paz) * (bz - pbz)) / (la * lb)) > HEADROOM.parallel) continue
          const upperIsA = A.heights[i] >= B.heights[j]
          const [upper, at, lower] = upperIsA ? [a, i, B.heights[j]] : [b, j, A.heights[i]]
          const need = lower + HEADROOM.clear - decks[upper].heights[at]
          if (need <= 0) continue
          const { at: along, length } = decks[upper].path
          for (let k = 0; k < along.length; k++) {
            const nearEnd = Math.min(1, along[k] / HEADROOM.ends, (length - along[k]) / HEADROOM.ends)
            const lift = need * (1 - curve(Math.abs(along[k] - along[at]) / HEADROOM.ease)) * curve(nearEnd)
            if (lift > lifts[upper][k]) lifts[upper][k] = lift
          }
        }
      }
    }
  }
  decks.forEach((deck, n) => deck.heights.forEach((height, k) => (deck.heights[k] = height + lifts[n][k])))
}

/** How far below a deck's top its underside is, girders and all, in metres (Transit.tsx' deck). */
const DECK_DEPTH = 1.7

/**
 * A deck's ground footprint, as one rectangle a segment, its width and a margin either side, each with
 * its underside's height (the lower end's, less the deck's depth; on a ramp's embankment, the ground).
 */
export function flyoverFootprints(decks: Flyover[]): { outline: GroundPoint[]; underside: number }[] {
  const footprints: { outline: GroundPoint[]; underside: number }[] = []
  for (const deck of decks) {
    const { at } = deck.path
    for (let i = 1; i < at.length; i++) {
      const underside = Math.max(0, Math.min(deck.heights[i - 1], deck.heights[i]) - DECK_DEPTH)
      for (const outline of pathFootprint(deck.path, deck.width / 2 + FOOTPRINT_MARGIN, at[i - 1], at[i])) footprints.push({ outline, underside })
    }
  }
  return footprints
}

/** Rectangles `half` either side of each segment of a path, a little longer, so they overlap at the joints. */
function pathFootprint(path: Path, half: number, from = 0, to = path.length): GroundPoint[][] {
  const outlines: GroundPoint[][] = []
  const { points } = path
  for (let i = 1; i < points.length; i++) {
    if (path.at[i] < from || path.at[i - 1] > to) continue
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 0.1) continue
    const dx = (bx - ax) / length
    const dz = (bz - az) / length
    const sx = dz * half
    const sz = -dx * half
    outlines.push([
      [ax - dx + sx, az - dz + sz],
      [bx + dx + sx, bz + dz + sz],
      [bx + dx - sx, bz + dz - sz],
      [ax - dx - sx, az - dz - sz],
    ])
  }
  return outlines
}

export function planFlyovers({ decks, surface, collisions }: { decks: Flyover[]; surface: SurfaceMap; collisions: CollisionWorld }): Flyovers {
  const flyovers: Flyovers = { decks, pillars: [], bikes: [], stalls: [], barriers: [], report: {} }

  for (const deck of decks) {
    const { path } = deck

    // The ramps are solid embankments: walled along both edges where the deck is too low to ride
    // under (and high enough to see), so they're ridden up from the foot, not onto from the side.
    for (let i = 1; i < path.points.length; i++) {
      if (Math.min(deck.heights[i - 1], deck.heights[i]) >= RIDE_UNDER || Math.max(deck.heights[i - 1], deck.heights[i]) < DECK_STEP_UP) continue
      const [ax, az] = path.points[i - 1]
      const [bx, bz] = path.points[i]
      const length = Math.hypot(bx - ax, bz - az) || 1
      const sx = ((bz - az) / length) * (deck.width / 2)
      const sz = (-(bx - ax) / length) * (deck.width / 2)
      for (const side of [1, -1]) addWall(collisions, [ax + sx * side, az + sz * side], [bx + sx * side, bz + sz * side], 0.4)
    }
    // Pillars along the raised part, where the ground allows; under the highest, life.
    let sinceStall = 60
    for (let s = FLYOVER_PILLAR_EVERY / 2; s < path.length; s += FLYOVER_PILLAR_EVERY) {
      const height = heightOnFlyover(deck, s)
      if (height < RIDE_UNDER) continue
      const { x, z, dirX, dirZ } = pointOnPath(path, s)
      if (!isInsideBounds(x, z, 4)) continue
      const ground = surface.at(x, z)
      const rotation = Math.atan2(dirX, dirZ)
      if (PILLAR_GROUND.has(ground) && !isNearBuilding(collisions, x, z, 1.2)) {
        flyovers.pillars.push({ x, z, rotation, height, width: deck.width, poster: flyovers.pillars.length % 3 === 0 ? flyovers.pillars.length % 12 : -1 })
        addPost(collisions, x, z, 1.0)
      }
      // In the shade either side of every third pillar, on open or paved ground or a median: bikes, now and then a tea stall.
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
  }
  flyovers.report.decks = flyovers.decks.length
  flyovers.report.metres = Math.round(flyovers.decks.reduce((sum, deck) => sum + deck.path.length, 0))
  flyovers.report.pillars = flyovers.pillars.length
  flyovers.report.bikes = flyovers.bikes.length
  flyovers.report.stalls = flyovers.stalls.length
  flyovers.report.rampBarriers = flyovers.barriers.length
  return flyovers
}

/** A flyover's deck height `s` along it. */
export function heightOnFlyover(deck: Flyover, s: number): number {
  const { at } = deck.path
  const i = segmentAt(at, s)
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

// ---------------------------------------------------------------------------
// Riding the flyovers

/*
 * The scooter rides the flyovers (World.tsx, Scooter.tsx): up a ramp from the road at its foot,
 * along the deck and down the far end, or on to the flyover it joins. Which level a wheel is on
 * comes from how high it already is: a deck counts if it's no more than a step above the wheel,
 * so riding up a ramp from its foot carries it up, and riding under a deck keeps it on the ground.
 * Up on a deck, only the deck's edges are solid (`collisions`), and the traffic below ignores the
 * rider (trafficLogic.ts). The traffic and deliveries stay on the ground.
 */

/** A wheel steps onto a deck no more than this far above it, in metres. */
export const DECK_STEP_UP = 0.6
/** Above this, the scooter is up on a deck: the deck's own collisions, and the ground's traffic ignores it. */
export const UP_ON_DECK = 2.2
/** The barriers along a deck's edges stand this far in from its sides, and are this thick. */
const EDGE_INSET = 0.35

export type DeckLevels = {
  /** The highest deck at (x, z) no higher than `below`, or null where there's none. */
  heightAt: (x: number, z: number, below: number) => number | null
  /**
   * What's solid up on a deck at this height: the edges of the decks at about that height, and
   * their ends that stop in the air. Banded by height, so a deck crossing above or below isn't.
   */
  collisionsAt: (height: number) => CollisionWorld
}

/** Deck walls are sorted into bands of this height; a wall counts in every band its stretch reaches, give or take `BAND_SLACK`. */
const BAND = 1.5
const BAND_SLACK = 1.2

const DECK_CELL = 16

/**
 * Where two flyovers join, or a ramp runs into a deck, the edge of one lies on the roadway of the
 * other. A crash barrier built along that edge is a wall across the road (there was one, across
 * both lanes, where the ramps meet). So a point of one deck's edge that is on another deck's
 * roadway, `JOIN.inside` metres or more in from its edge and within `JOIN.level` of its height,
 * gets no barrier: none drawn (Transit.tsx) and none solid (below).
 */
const JOIN = { inside: 0.9, level: 1.3, piece: 2 }
const deckBounds = new WeakMap<Flyover, [number, number, number, number]>()
export function onAnotherDeck(decks: Flyover[], own: Flyover, x: number, z: number, height: number): boolean {
  for (const deck of decks) {
    if (deck === own) continue
    const { points } = deck.path
    let bounds = deckBounds.get(deck)
    if (!bounds) {
      bounds = [Infinity, Infinity, -Infinity, -Infinity]
      for (const [px, pz] of points) bounds = [Math.min(bounds[0], px), Math.min(bounds[1], pz), Math.max(bounds[2], px), Math.max(bounds[3], pz)]
      deckBounds.set(deck, bounds)
    }
    const half = deck.width / 2
    if (x < bounds[0] - half || z < bounds[1] - half || x > bounds[2] + half || z > bounds[3] + half) continue
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      const ex = bx - ax
      const ez = bz - az
      const lengthSquared = ex * ex + ez * ez
      if (lengthSquared < 0.01) continue
      // Measured to the nearest point of this stretch, its ends included: at a bend, a point in the
      // wedge between two stretches is "past the end" of both, and was taken to be off the deck (a
      // barrier was then left standing across the road there, unseen).
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / lengthSquared))
      if (Math.hypot(x - (ax + ex * t), z - (az + ez * t)) > half - JOIN.inside) continue
      if (Math.abs(deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * t - height) < JOIN.level) return true
    }
  }
  return false
}

/** What became of the decks' ends up in the air: closed with a wall, or left open because they run into another deck (for the load timeline). */
export const deckReport = { endsClosed: 0, endsLeftOpen: 0 }

/** Another deck's roadway counts as over or under a barrier from this much height apart, in metres (nearer than that they're one road: `JOIN`). */
const STACKED = 0.4

/** The heights of every other deck whose roadway is over or under a point. */
function roadwaysAt(decks: Flyover[], own: Flyover, x: number, z: number): number[] {
  const heights: number[] = []
  for (const deck of decks) {
    if (deck === own) continue
    const { points } = deck.path
    const half = deck.width / 2
    const bounds = deckBounds.get(deck)
    if (bounds && (x < bounds[0] - half || z < bounds[1] - half || x > bounds[2] + half || z > bounds[3] + half)) continue
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      const ex = bx - ax
      const ez = bz - az
      const lengthSquared = ex * ex + ez * ez
      if (lengthSquared < 0.01) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / lengthSquared))
      if (Math.hypot(x - (ax + ex * t), z - (az + ez * t)) > half) continue
      heights.push(deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * t)
      break
    }
  }
  return heights
}

export function createDeckLevels(decks: Flyover[]): DeckLevels {
  type Segment = { deck: Flyover; i: number }
  const cells = new Map<string, Segment[]>()
  const bands = new Map<number, CollisionWorld>()
  const empty: CollisionWorld = new Map()
  /** A wall, in each band from `low` to `high` metres up. */
  /**
   * `others`: the heights of other decks' roadways passing over or under the wall's middle. The
   * wall isn't solid at their height: where two decks run one above the other a metre or two apart
   * (coming into a join), the lower one's barrier stopped vehicles on the upper one, from underneath
   * and out of sight. It keeps to the bands on its own side of each of them (and always its own).
   */
  const wall = (from: GroundPoint, to: GroundPoint, thickness: number, low: number, high: number, others: number[] = []) => {
    let first = Math.floor((low - BAND_SLACK) / BAND)
    let last = Math.floor((high + BAND_SLACK) / BAND)
    for (const other of others) {
      if (other > high + STACKED) last = Math.min(last, Math.max(Math.floor(high / BAND), Math.floor(other / BAND) - 1))
      else if (other < low - STACKED) first = Math.max(first, Math.min(Math.floor(low / BAND), Math.floor(other / BAND) + 1))
    }
    for (let band = first; band <= last; band++) {
      const world = bands.get(band) ?? new Map()
      addWall(world, from, to, thickness)
      bands.set(band, world)
    }
  }
  const endKey = ([x, z]: GroundPoint) => `${Math.round(x)},${Math.round(z)}`
  const ends = new Map<string, number>()
  for (const deck of decks) for (const end of [deck.path.points[0], deck.path.points[deck.path.points.length - 1]]) ends.set(endKey(end), (ends.get(endKey(end)) ?? 0) + 1)

  for (const deck of decks) {
    const { points } = deck.path
    const half = deck.width / 2
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      for (let cx = Math.floor((Math.min(ax, bx) - half) / DECK_CELL); cx <= Math.floor((Math.max(ax, bx) + half) / DECK_CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - half) / DECK_CELL); cz <= Math.floor((Math.max(az, bz) + half) / DECK_CELL); cz++) {
          const key = `${cx},${cz}`
          const list = cells.get(key) ?? []
          list.push({ deck, i })
          cells.set(key, list)
        }
      }
      // The crash barriers along both edges.
      const length = Math.hypot(bx - ax, bz - az) || 1
      const sx = ((bz - az) / length) * (half - EDGE_INSET)
      const sz = (-(bx - ax) / length) * (half - EDGE_INSET)
      const low = Math.min(deck.heights[i - 1], deck.heights[i])
      const high = Math.max(deck.heights[i - 1], deck.heights[i])
      // In pieces, so that only the part of an edge that lies on another deck's roadway is left open.
      const pieces = Math.max(1, Math.ceil(length / JOIN.piece))
      for (const side of [1, -1]) {
        for (let p = 0; p < pieces; p++) {
          const t0 = p / pieces
          const t1 = (p + 1) / pieces
          const mid = (t0 + t1) / 2
          // Its middle or either end on another deck's roadway: no barrier there.
          if ([t0, mid, t1].some((t) => onAnotherDeck(decks, deck, ax + (bx - ax) * t + sx * side, az + (bz - az) * t + sz * side, deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * t))) continue
          const midX = ax + (bx - ax) * mid + sx * side
          const midZ = az + (bz - az) * mid + sz * side
          wall([ax + (bx - ax) * t0 + sx * side, az + (bz - az) * t0 + sz * side], [ax + (bx - ax) * t1 + sx * side, az + (bz - az) * t1 + sz * side], 0.4, low, high, roadwaysAt(decks, deck, midX, midZ))
        }
      }
    }
    // An end up in the air that meets no other flyover (the one under construction): closed off.
    for (const [index, s] of [[0, 0.3], [points.length - 1, deck.path.length - 0.3]] as const) {
      const low = index === 0 ? deck.startsLow : deck.endsLow
      // Joined to another deck there (planFlyoverDecks' joints: ends within a few metres): open road.
      const [ex, ez] = points[index]
      const joined = decks.some((other) => other !== deck && [other.path.points[0], other.path.points[other.path.points.length - 1]].some(([ox, oz]) => Math.hypot(ox - ex, oz - ez) <= JOINT.within + 1))
      if (low || joined || (ends.get(endKey(points[index])) ?? 0) > 1) continue
      const { x, z, dirX, dirZ } = pointOnPath(deck.path, s)
      const height = heightOnFlyover(deck, s)
      // Or it runs into the side of another deck part-way along it (a slip road joining a flyover):
      // the road carries on there, and closing the end left a wall nobody could see across both lanes.
      // Looked for at the end itself and a little past it, in the middle and towards each side.
      const out = index === 0 ? -1 : 1
      const meets = [0, 2, 4].some((past) => [0, 0.5, -0.5].some((across) => onAnotherDeck(decks, deck, x + dirX * out * past + dirZ * half * across, z + dirZ * out * past - dirX * half * across, height)))
      if (meets) {
        deckReport.endsLeftOpen++
        continue
      }
      deckReport.endsClosed++
      wall([x + dirZ * half, z - dirX * half], [x - dirZ * half, z + dirX * half], 0.6, height, height)
    }
  }

  return {
    collisionsAt: (height) => bands.get(Math.floor(height / BAND)) ?? empty,
    heightAt(x, z, below) {
      let best: number | null = null
      for (const { deck, i } of cells.get(`${Math.floor(x / DECK_CELL)},${Math.floor(z / DECK_CELL)}`) ?? []) {
        const [ax, az] = deck.path.points[i - 1]
        const [bx, bz] = deck.path.points[i]
        const ex = bx - ax
        const ez = bz - az
        const lengthSquared = ex * ex + ez * ez
        if (lengthSquared < 0.01) continue
        const t = ((x - ax) * ex + (z - az) * ez) / lengthSquared
        if (t < -0.02 || t > 1.02) continue
        const off = Math.abs((x - ax) * ez - (z - az) * ex) / Math.sqrt(lengthSquared)
        if (off > deck.width / 2 - 0.1) continue
        const clamped = Math.max(0, Math.min(1, t))
        const height = deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * clamped + 0.05
        if (height <= below && (best === null || height > best)) best = height
      }
      return best
    },
  }
}
