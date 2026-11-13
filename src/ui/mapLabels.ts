import type { MapData, PolygonFeature } from '../world/mapData'
import { isInsideBounds, lonLatToWorld, type GroundPoint, type LonLat } from '../world/worldUtils'

/**
 * Street and area names for the phone map, as a map app shows them. The map
 * turns with the bike, so names can't be painted into its picture: they'd turn
 * too, and end up upside down. Instead they're placed fresh every frame, upright,
 * along whichever stretch of road is on screen.
 */

/** A named road, with its pieces joined end to end where they meet. */
type StreetChain = {
  name: string
  points: GroundPoint[]
  /** How far along the chain each point is, in metres. */
  along: number[]
  length: number
  /** Main roads get bolder names. */
  major: boolean
  /** Its box: [minX, maxX, minZ, maxZ], to skip roads nowhere near the screen. */
  box: [number, number, number, number]
}

type AreaKind = 'place' | 'park' | 'campus'
type AreaLabel = { x: number; z: number; text: string; kind: AreaKind }

export type MapLabels = {
  streets: StreetChain[]
  areas: AreaLabel[]
  /** Every road piece, named or not, for finding the road the rider is on. */
  pieces: { ax: number; az: number; bx: number; bz: number; name: string | null }[]
}

/** Where to try a street name, in metres along its road. */
const STREET_LABEL_SPACING = 70
/** A stretch bending further than this from straight, as a share of its length, doesn't get a name. */
const MAX_BEND = 0.08
/** Two names for the same road keep at least this far apart on screen, in pixels. */
const SAME_NAME_GAP = 150
const MAJOR_ROADS = new Set(['secondary', 'tertiary', 'primary', 'trunk'])

const FONTS = {
  major: '600 10.5px system-ui, sans-serif',
  minor: '500 9.5px system-ui, sans-serif',
  place: '700 10px system-ui, sans-serif',
  park: 'italic 600 9.5px system-ui, sans-serif',
  campus: '500 9px system-ui, sans-serif',
  current: '600 11px system-ui, sans-serif',
}
const COLORS = {
  major: '#e3e6ea',
  minor: '#b9bec6',
  place: '#8f96a1',
  park: '#7cc68b',
  campus: '#9fb1c7',
}
const HALO = 'rgb(20 22 26 / 88%)'
const LABEL_HEIGHT = 12

/** Kinds of outline that a map app names: housing colonies, campuses, hospitals, parks. */
const NAMED_LANDUSE = new Set(['residential', 'commercial', 'military', 'industrial'])
const NAMED_AMENITY = new Set(['college', 'school', 'university', 'hospital', 'events_venue'])

const toGround = (position: LonLat): GroundPoint => {
  const [x, , z] = lonLatToWorld(position)
  return [x, z]
}

const isSamePoint = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5

/** Joins two lines if an end of one meets an end of the other. */
function joinLines(a: GroundPoint[], b: GroundPoint[]): GroundPoint[] | null {
  const aEnd = a[a.length - 1]
  const bEnd = b[b.length - 1]
  if (isSamePoint(aEnd, b[0])) return [...a, ...b.slice(1)]
  if (isSamePoint(aEnd, bEnd)) return [...a, ...b.slice(0, -1).reverse()]
  if (isSamePoint(a[0], bEnd)) return [...b, ...a.slice(1)]
  if (isSamePoint(a[0], b[0])) return [...b.slice().reverse(), ...a.slice(1)]
  return null
}

/** OSM splits a road at every junction. Joining the pieces back up gives a name room to fit. */
function joinAll(lines: GroundPoint[][]): GroundPoint[][] {
  const pending = lines.map((line) => [...line])
  let joined = true
  while (joined) {
    joined = false
    for (let i = 0; i < pending.length && !joined; i++) {
      for (let j = i + 1; j < pending.length && !joined; j++) {
        const line = joinLines(pending[i], pending[j])
        if (line) {
          pending[i] = line
          pending.splice(j, 1)
          joined = true
        }
      }
    }
  }
  return pending
}

function toChain(name: string, points: GroundPoint[], major: boolean): StreetChain {
  const along = [0]
  for (let i = 1; i < points.length; i++) {
    along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  }
  const xs = points.map(([x]) => x)
  const zs = points.map(([, z]) => z)
  const box: StreetChain['box'] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
  return { name, points, along, length: along[along.length - 1], major, box }
}

/** The point `distance` metres along a chain. */
function pointAlong({ points, along }: StreetChain, distance: number): GroundPoint {
  let i = 1
  while (i < along.length - 1 && along[i] < distance) i++
  const span = along[i] - along[i - 1]
  const share = span === 0 ? 0 : (distance - along[i - 1]) / span
  return [
    points[i - 1][0] + (points[i][0] - points[i - 1][0]) * share,
    points[i - 1][1] + (points[i][1] - points[i - 1][1]) * share,
  ]
}

function centreOf(feature: PolygonFeature): GroundPoint {
  const ring = feature.geometry.coordinates[0].slice(0, -1).map(toGround)
  return [ring.reduce((sum, [x]) => sum + x, 0) / ring.length, ring.reduce((sum, [, z]) => sum + z, 0) / ring.length]
}

export function createMapLabels(data: MapData): MapLabels {
  // ---- Streets ----
  const linesByName = new Map<string, { lines: GroundPoint[][]; major: boolean }>()
  const pieces: MapLabels['pieces'] = []
  for (const road of data.roads) {
    const points = road.geometry.coordinates.map(toGround)
    const name = road.properties.name ?? null
    for (let i = 1; i < points.length; i++) {
      pieces.push({ ax: points[i - 1][0], az: points[i - 1][1], bx: points[i][0], bz: points[i][1], name })
    }
    if (!name) continue
    const entry = linesByName.get(name) ?? { lines: [], major: false }
    entry.lines.push(points)
    entry.major ||= MAJOR_ROADS.has(road.properties.highway ?? '')
    linesByName.set(name, entry)
  }
  const streets = [...linesByName].flatMap(([name, { lines, major }]) =>
    joinAll(lines).map((points) => toChain(name, points, major)),
  )

  // ---- Areas ----
  const areas: AreaLabel[] = []
  const add = (x: number, z: number, text: string, kind: AreaKind) => {
    if (!isInsideBounds(x, z, 10)) return
    if (areas.some((area) => area.text.toLowerCase() === text.toLowerCase())) return
    areas.push({ x, z, text, kind })
  }

  // Neighbourhoods: where the map's addresses name one.
  for (const place of data.places) {
    const [x, z] = toGround(place.geometry.coordinates)
    const neighbourhood = place.properties['addr:place'] ?? place.properties['addr:suburb']
    if (neighbourhood) add(x, z, neighbourhood.toUpperCase(), 'place')
    const sector = /\bSector\s*(\d+)/i.exec(place.properties.name ?? '')
    if (sector) add(x, z, `SECTOR ${sector[1]}`, 'place')
  }

  for (const park of data.parks) {
    const name = park.properties.name
    if (name) add(...centreOf(park), name, 'park')
  }
  for (const area of data.areas) {
    const { name, landuse, amenity, leisure } = area.properties
    // "(u/c)" marks a building site, which a map app wouldn't name yet.
    if (!name || name.includes('(u/c)')) continue
    if (leisure === 'park') add(...centreOf(area), name, 'park')
    else if (NAMED_LANDUSE.has(landuse ?? '') || NAMED_AMENITY.has(amenity ?? '')) add(...centreOf(area), name, 'campus')
  }

  return { streets, areas, pieces }
}

// ---------------------------------------------------------------- Drawing

/** What the label layer needs to know about the map on this frame. */
export type LabelView = {
  pixelsPerMetre: number
  /** Where the map is centred, and how far from there it can show, in metres. */
  centre: [number, number]
  reach: number
  /** Turns a world position into a position on the phone's screen, in pixels. */
  project: (x: number, z: number) => [number, number]
  /** The part of the screen a label may use: [left, top, right, bottom]. */
  bounds: [number, number, number, number]
  /** A spot no name may cover, such as the rider's arrow: [x, y, radius]. */
  keepClear?: [number, number, number]
}

const widths = new Map<string, number>()
function measure(context: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`
  let width = widths.get(key)
  if (width === undefined) {
    context.font = font
    width = context.measureText(text).width
    widths.set(key, width)
  }
  return width
}

/**
 * A label's footprint, as a row of circles along it. Two labels overlap if any
 * of their circles do, which works whatever angle each is turned to.
 */
function footprint(x: number, y: number, angle: number, width: number): number[] {
  const radius = LABEL_HEIGHT / 2 + 1
  const count = Math.max(1, Math.ceil(width / LABEL_HEIGHT))
  const circles: number[] = []
  for (let i = 0; i < count; i++) {
    const offset = (i + 0.5) * (width / count) - width / 2
    circles.push(x + Math.cos(angle) * offset, y + Math.sin(angle) * offset, radius)
  }
  return circles
}

function overlaps(circles: number[], taken: number[]): boolean {
  for (let i = 0; i < circles.length; i += 3) {
    for (let j = 0; j < taken.length; j += 3) {
      const reach = circles[i + 2] + taken[j + 2]
      const dx = circles[i] - taken[j]
      const dy = circles[i + 1] - taken[j + 1]
      if (dx * dx + dy * dy < reach * reach) return true
    }
  }
  return false
}

function write(context: CanvasRenderingContext2D, text: string, x: number, y: number, angle: number, font: string, color: string, spacing = 0) {
  context.save()
  context.translate(x, y)
  context.rotate(angle)
  context.font = font
  context.letterSpacing = `${spacing}px`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'
  context.lineWidth = 3
  context.strokeStyle = HALO
  context.strokeText(text, 0, 0)
  context.fillStyle = color
  context.fillText(text, 0, 0)
  context.restore()
}

/**
 * Draws as many names as fit without overlapping, most important first:
 * neighbourhoods, then streets, then parks, then campuses and colonies.
 */
export function drawMapLabels(context: CanvasRenderingContext2D, labels: MapLabels, view: LabelView) {
  const [left, top, right, bottom] = view.bounds
  const taken: number[] = view.keepClear ? [...view.keepClear] : []
  const placedStreets: { name: string; x: number; y: number }[] = []
  const fits = (x: number, y: number, width: number) =>
    x - width / 2 > left && x + width / 2 < right && y - LABEL_HEIGHT / 2 > top && y + LABEL_HEIGHT / 2 < bottom

  const drawArea = ({ x, z, text, kind }: AreaLabel) => {
    const [screenX, screenY] = view.project(x, z)
    const spacing = kind === 'place' ? 1.5 : 0
    const width = measure(context, FONTS[kind], text) + spacing * text.length
    if (!fits(screenX, screenY, width)) return
    const circles = footprint(screenX, screenY, 0, width)
    if (overlaps(circles, taken)) return
    taken.push(...circles)
    write(context, text, screenX, screenY, 0, FONTS[kind], COLORS[kind], spacing)
  }

  for (const area of labels.areas) if (area.kind === 'place') drawArea(area)

  const [centreX, centreZ] = view.centre
  for (const street of labels.streets) {
    const [minX, maxX, minZ, maxZ] = street.box
    if (minX > centreX + view.reach || maxX < centreX - view.reach || minZ > centreZ + view.reach || maxZ < centreZ - view.reach) continue
    const font = street.major ? FONTS.major : FONTS.minor
    const width = measure(context, font, street.name)
    // How much road the name needs, in metres, with a little room at each end.
    const half = (width / 2 + 5) / view.pixelsPerMetre

    for (let distance = STREET_LABEL_SPACING / 2; distance < street.length; distance += STREET_LABEL_SPACING) {
      if (distance - half < 0 || distance + half > street.length) continue
      const middle = pointAlong(street, distance)
      const [x, y] = view.project(middle[0], middle[1])
      if (!fits(x, y, width)) continue

      // Only on a straight stretch, or the name would float off the road where it bends.
      const start = pointAlong(street, distance - half)
      const end = pointAlong(street, distance + half)
      const bend = Math.hypot((start[0] + end[0]) / 2 - middle[0], (start[1] + end[1]) / 2 - middle[1])
      if (bend > MAX_BEND * half * 2) continue

      if (placedStreets.some((placed) => placed.name === street.name && Math.hypot(placed.x - x, placed.y - y) < SAME_NAME_GAP)) continue

      const [startX, startY] = view.project(start[0], start[1])
      const [endX, endY] = view.project(end[0], end[1])
      // Turned to run along the road, but never upside down.
      let angle = Math.atan2(endY - startY, endX - startX)
      if (angle > Math.PI / 2) angle -= Math.PI
      if (angle < -Math.PI / 2) angle += Math.PI

      const circles = footprint(x, y, angle, width)
      if (overlaps(circles, taken)) continue
      taken.push(...circles)
      placedStreets.push({ name: street.name, x, y })
      write(context, street.name, x, y, angle, font, street.major ? COLORS.major : COLORS.minor)
    }
  }

  for (const area of labels.areas) if (area.kind === 'park') drawArea(area)
  for (const area of labels.areas) if (area.kind === 'campus') drawArea(area)
}

// ---------------------------------------------------------------- The road you're on

/** Further than this from any road, in metres, and the rider isn't on one. */
const ON_ROAD_REACH = 14
/** Another road must be this much closer before the name changes, so it doesn't flicker at junctions. */
const SWITCH_MARGIN = 2.5

function distanceToPiece(x: number, z: number, { ax, az, bx, bz }: MapLabels['pieces'][number]): number {
  const edgeX = bx - ax
  const edgeZ = bz - az
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * edgeX + (z - az) * edgeZ) / lengthSquared))
  return Math.hypot(x - (ax + edgeX * along), z - (az + edgeZ * along))
}

/** The name of the road the rider is on, or null on an unnamed road or off the road. */
export function findCurrentRoad(labels: MapLabels, x: number, z: number, previous: string | null): string | null {
  let best: string | null = null
  let bestDistance = ON_ROAD_REACH
  let previousDistance = Infinity
  for (const piece of labels.pieces) {
    const distance = distanceToPiece(x, z, piece)
    if (piece.name !== null && piece.name === previous) previousDistance = Math.min(previousDistance, distance)
    if (distance < bestDistance) {
      bestDistance = distance
      best = piece.name
    }
  }
  if (previous && previousDistance < ON_ROAD_REACH && previousDistance < bestDistance + SWITCH_MARGIN) return previous
  return best
}

export const CURRENT_ROAD_HEIGHT = 22

/** A pill at the top of the map naming the road you're on. */
export function drawCurrentRoad(context: CanvasRenderingContext2D, name: string, centreX: number, top: number) {
  const width = measure(context, FONTS.current, name) + 22
  context.fillStyle = 'rgb(14 16 20 / 90%)'
  context.strokeStyle = 'rgb(255 255 255 / 14%)'
  context.lineWidth = 1
  context.beginPath()
  context.roundRect(centreX - width / 2, top, width, CURRENT_ROAD_HEIGHT, CURRENT_ROAD_HEIGHT / 2)
  context.fill()
  context.stroke()
  context.font = FONTS.current
  context.letterSpacing = '0px'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.fillText(name, centreX, top + CURRENT_ROAD_HEIGHT / 2 + 0.5)
}
