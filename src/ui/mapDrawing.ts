/* Drawing the map: the pre-drawn image of HSR, the route, pins, the rider. Shared by the minimap and the full map. */
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { useRoomStore } from '../net/room'
import { getCurrentStop } from '../missions/missionLogic'
import { errandLive } from '../game/doorsteps'
import type { MapData } from '../world/mapData'
import { getRoadWidth } from '../world/roadData'
import {
  isRingInPlayArea,
  lonLatToWorld,
  PLAY_AREA,
  PLAY_AREA_DEPTH,
  PLAY_AREA_WIDTH,
  type LonLat,
} from '../world/worldUtils'

/**
 * Resolution of the pre-drawn map image, in pixels per metre: 2 for a small map,
 * less for a big one, so the image stays under about 16 million pixels (64 MB).
 */
export const IMAGE_SCALE = Math.min(2, Math.sqrt(16_000_000 / (PLAY_AREA_WIDTH * PLAY_AREA_DEPTH)))
/** How quickly the map turns to follow the bike. Higher is tighter. */
export const TURN_RESPONSE = 7
/** How quickly the map zooms and shifts when the phone is raised or lowered. */
export const LAYOUT_RESPONSE = 9

/** Metres of the world for each pixel of the phone, as `[tucked away, raised]`. */
/** How far down the screen the rider sits. Lower sits above the order details. */
/** How much of the screen's bottom the order details cover, which markers stay clear of. */
export const EDGE_MARGIN = 14

export const GROUND_COLOR = '#22252a'
export const ROAD_COLOR = '#646a73'
export const BUILDING_COLOR = '#353940'
export const PARK_COLOR = '#284232'
/** Military land, which can't be entered. */
export const RESTRICTED_COLOR = '#33362a'
/** The road name pill sits this far below the status bar, in pixels. */
/** How often the road you're on is looked up again, in milliseconds. */
export const CURRENT_ROAD_EVERY = 250
export const PLAYER_COLOR = '#ffffff'

export function toImage(position: LonLat): [number, number] {
  const [x, , z] = lonLatToWorld(position)
  return [(x - PLAY_AREA.minX) * IMAGE_SCALE, (z - PLAY_AREA.minZ) * IMAGE_SCALE]
}

export function traceLine(context: CanvasRenderingContext2D, points: LonLat[]) {
  context.beginPath()
  points.forEach((point, i) => {
    const [x, y] = toImage(point)
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
}

/** Draws the whole play area once. Each frame only has to rotate this image. */
export function createMapImage(data: MapData): HTMLCanvasElement {
  const image = document.createElement('canvas')
  image.width = Math.ceil(PLAY_AREA_WIDTH * IMAGE_SCALE)
  image.height = Math.ceil(PLAY_AREA_DEPTH * IMAGE_SCALE)

  const context = image.getContext('2d')
  if (!context) return image

  context.fillStyle = GROUND_COLOR
  context.fillRect(0, 0, image.width, image.height)

  context.fillStyle = RESTRICTED_COLOR
  for (const zone of data.restricted) {
    traceLine(context, zone.geometry.coordinates[0])
    context.fill()
  }

  context.fillStyle = PARK_COLOR
  for (const park of data.parks) {
    if (!isRingInPlayArea(park.geometry.coordinates[0])) continue
    traceLine(context, park.geometry.coordinates[0])
    context.fill()
  }

  context.strokeStyle = ROAD_COLOR
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const road of data.roads) {
    context.lineWidth = getRoadWidth(road) * IMAGE_SCALE
    traceLine(context, road.geometry.coordinates)
    context.stroke()
  }

  context.fillStyle = BUILDING_COLOR
  for (const building of data.buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue
    traceLine(context, ring)
    context.fill()
  }

  return image
}

/** Where the map's drawing stands on this frame. */
export type View = {
  width: number
  height: number
  riderX: number
  riderY: number
  pixelsPerMetre: number
  rotation: number
  /** How far above and below the rider a marker can sit. */
  roomAbove: number
  roomBelow: number
  /** A round map: markers keep inside this radius from the rider instead of the box above. */
  radius?: number
}

export function toScreen({ pixelsPerMetre, rotation }: View, x: number, z: number): [number, number] {
  const worldX = (x - livePlayer.x) * pixelsPerMetre
  const worldZ = (z - livePlayer.z) * pixelsPerMetre
  return [
    worldX * Math.cos(rotation) - worldZ * Math.sin(rotation),
    worldX * Math.sin(rotation) + worldZ * Math.cos(rotation),
  ]
}

export function drawPlayer(context: CanvasRenderingContext2D, { riderX, riderY }: View) {
  context.fillStyle = PLAYER_COLOR
  context.strokeStyle = '#000000'
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(riderX, riderY - 10)
  context.lineTo(riderX + 7, riderY + 8)
  context.lineTo(riderX, riderY + 4)
  context.lineTo(riderX - 7, riderY + 8)
  context.closePath()
  context.fill()
  context.stroke()
}

/** Draws the road route from the rider to the current stop. */
export function drawRoute(context: CanvasRenderingContext2D, view: View, color: string) {
  const { points } = liveRoute

  context.beginPath()
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = toScreen(view, points[i], points[i + 1])
    if (i === 0) context.moveTo(view.riderX + x, view.riderY + y)
    else context.lineTo(view.riderX + x, view.riderY + y)
  }

  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#0f1115'
  context.lineWidth = 7
  context.stroke()
  context.strokeStyle = color
  context.lineWidth = 4
  context.stroke()
}

/** How far a pin's head sits above the spot it marks, and its size, in pixels. */
export const PIN_LIFT = 15
export const PIN_RADIUS = 9
/** An off-map marker keeps this far from the edge, leaving room for its arrow. */
export const OFF_MAP_MARGIN = 34

/** A small picture of what's at the stop: a parcel to collect, a house to deliver to. */
export function drawStopIcon(context: CanvasRenderingContext2D, x: number, y: number, pickup: boolean) {
  context.fillStyle = '#10231a'
  context.strokeStyle = '#10231a'
  context.lineWidth = 1.4
  context.beginPath()
  if (pickup) {
    // A box with its lid, a slightly wider strip on top.
    context.fillRect(x - 4, y - 1.5, 8, 6)
    context.fillRect(x - 5, y - 5, 10, 2.6)
  } else {
    context.moveTo(x, y - 5)
    context.lineTo(x + 5, y - 0.5)
    context.lineTo(x + 3.5, y - 0.5)
    context.lineTo(x + 3.5, y + 4)
    context.lineTo(x - 3.5, y + 4)
    context.lineTo(x - 3.5, y - 0.5)
    context.lineTo(x - 5, y - 0.5)
    context.closePath()
    context.fill()
  }
}

/** A round marker with the stop's icon in it. */
export function drawBadge(context: CanvasRenderingContext2D, x: number, y: number, color: string, pickup: boolean) {
  context.fillStyle = color
  context.strokeStyle = '#000000'
  context.lineWidth = 2
  context.beginPath()
  context.arc(x, y, PIN_RADIUS, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  drawStopIcon(context, x, y, pickup)
}

/** A map pin: a badge on a point, with the point exactly on the stop. */
/** A landmark's mark: a diamond in its colour, ringed so it shows on any ground. */
export function drawLandmarkDot(context: CanvasRenderingContext2D, x: number, y: number, color: string) {
  context.fillStyle = color
  context.strokeStyle = '#0f1115'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(x, y - 7)
  context.lineTo(x + 6, y)
  context.lineTo(x, y + 7)
  context.lineTo(x - 6, y)
  context.closePath()
  context.fill()
  context.stroke()
}

export function drawPin(context: CanvasRenderingContext2D, x: number, y: number, color: string, pickup: boolean) {
  context.fillStyle = color
  context.strokeStyle = '#000000'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x - 5, y - PIN_LIFT + 4)
  context.lineTo(x + 5, y - PIN_LIFT + 4)
  context.closePath()
  context.fill()
  context.stroke()
  drawBadge(context, x, y - PIN_LIFT, color, pickup)
}

/**
 * A stop that's off the map sits at its edge, with an arrow pointing the way to
 * it and how far it is by road. It pulses gently so it reads as "over there",
 * not as a place on the map.
 */
export function drawOffMap(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  pickup: boolean,
  time: number,
) {
  const pointX = Math.cos(angle)
  const pointY = Math.sin(angle)
  const nudge = Math.sin(time / 220) * 2
  const tipX = x + pointX * (PIN_RADIUS + 10 + nudge)
  const tipY = y + pointY * (PIN_RADIUS + 10 + nudge)
  const baseX = x + pointX * (PIN_RADIUS + 1)
  const baseY = y + pointY * (PIN_RADIUS + 1)

  context.fillStyle = color
  context.strokeStyle = '#000000'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(baseX - pointY * 7, baseY + pointX * 7)
  context.lineTo(baseX + pointY * 7, baseY - pointX * 7)
  context.closePath()
  context.fill()
  context.stroke()
  drawBadge(context, x, y, color, pickup)

  const { distance } = useGameStore.getState()
  const label = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`
  context.font = '700 11px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  // The label goes on the side away from the arrow, so the two never overlap.
  const labelX = x - pointX * 26
  const labelY = y - pointY * 20
  context.lineWidth = 3
  context.strokeStyle = 'rgb(0 0 0 / 80%)'
  context.strokeText(label, labelX, labelY)
  context.fillStyle = '#ffffff'
  context.fillText(label, labelX, labelY)
}

/** Where to draw a marker for: the order's stop, or else the rider's own waypoint. */
export function currentTarget(): { x: number; z: number; color: string; pickup: boolean } | null {
  const { mission, phase, waypoint } = useGameStore.getState()
  const stop = getCurrentStop(mission, phase)
  if (stop) {
    // The pin stands on the door itself, not on the road outside it, once the errand knows which door.
    const goal = errandLive.goal
    const at = goal && goal.kind === 'door' && !goal.indoors ? goal : stop
    return { x: at.x, z: at.z, color: stop.color, pickup: phase === 'toPickup' }
  }
  return waypoint ? { x: waypoint.x, z: waypoint.z, color: WAYPOINT_COLOR, pickup: false } : null
}

export const WAYPOINT_COLOR = '#7fb2ff'

/** Draws the current stop as a pin, or at the edge with an arrow if it's off the map. */
export function drawTarget(context: CanvasRenderingContext2D, view: View, time: number) {
  const target = currentTarget()
  if (!target) return
  const { pickup } = target
  const stop = target

  const [x, y] = toScreen(view, stop.x, stop.z)
  if (view.radius !== undefined) {
    // Round: a pin fits if its head is inside the circle; otherwise it sits on the rim, pointing out.
    const reach = view.radius - EDGE_MARGIN
    if (Math.hypot(x, y - PIN_LIFT) <= reach - PIN_RADIUS) {
      drawPin(context, view.riderX + x, view.riderY + y, stop.color, pickup)
      return
    }
    const scale = (view.radius - OFF_MAP_MARGIN) / Math.max(Math.hypot(x, y), 1)
    drawOffMap(context, view.riderX + x * scale, view.riderY + y * scale, Math.atan2(y, x), stop.color, pickup, time)
    return
  }
  // A pin's head stands above its point, so it needs that much more room at the top.
  const fitsAcross = Math.abs(x) <= view.width / 2 - EDGE_MARGIN
  const fitsUpDown = y < 0 ? -y <= view.roomAbove - PIN_LIFT : y <= view.roomBelow
  if (fitsAcross && fitsUpDown) {
    drawPin(context, view.riderX + x, view.riderY + y, stop.color, pickup)
    return
  }

  // Slide it in along the line from the rider until it's inside, with room for the arrow.
  const extra = OFF_MAP_MARGIN - EDGE_MARGIN
  const sideways = view.width / 2 - EDGE_MARGIN - extra
  const upDown = (y < 0 ? view.roomAbove : view.roomBelow) - extra
  const scale = Math.min(1, sideways / Math.max(Math.abs(x), 1), upDown / Math.max(Math.abs(y), 1))
  drawOffMap(
    context,
    view.riderX + x * scale,
    view.riderY + y * scale,
    Math.atan2(y, x),
    stop.color,
    pickup,
    time,
  )
}

/** Matches the canvas to the size it's shown at, which changes as the phone is raised. */
export function fitCanvas(canvas: HTMLCanvasElement): [number, number] {
  const pixelRatio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelWidth = Math.round(width * pixelRatio)
  const pixelHeight = Math.round(height * pixelRatio)

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  return [width, height]
}


/**
 * The rider's vehicle, parked, while they're away from it on foot: a marigold dot with a P, held at
 * the map's edge when it's further than the map shows, so it can always be walked back to.
 */
export function drawParkedVehicle(context: CanvasRenderingContext2D, view: View) {
  // Also while driving one off the street: their own is still where they left it.
  if (!livePlayer.awayFromOwn) return
  let [x, y] = toScreen(view, livePlayer.vehicleX, livePlayer.vehicleZ)
  const reach = Math.hypot(x, y)
  const edge = (view.radius ?? Math.min(view.width, view.height) / 2) - 14
  if (reach > edge) {
    x *= edge / reach
    y *= edge / reach
  }
  const cx = view.riderX + x
  const cy = view.riderY + y
  context.beginPath()
  context.arc(cx, cy, 8, 0, Math.PI * 2)
  context.fillStyle = '#f6b32b'
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#2a1300'
  context.stroke()
  context.fillStyle = '#2a1300'
  context.font = 'bold 10px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('P', cx, cy + 0.5)
}

/**
 * A friend in the room (net/room.ts) on a map: a dot in their own colour with a white rim and the
 * first letter of their name, and their name beside it where there's room (`named`). `x`, `y`: where
 * on the canvas.
 */
export function drawFriendDot(context: CanvasRenderingContext2D, x: number, y: number, colour: string, name: string, named: boolean) {
  context.beginPath()
  context.arc(x, y, 8, 0, Math.PI * 2)
  context.fillStyle = colour
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#ffffff'
  context.stroke()
  context.fillStyle = '#0e1116'
  context.font = "800 10px 'Baloo Tamma 2', system-ui, sans-serif"
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(name.slice(0, 1).toUpperCase(), x, y + 1)
  if (!named) return
  context.font = "700 12px 'Baloo Tamma 2', system-ui, sans-serif"
  context.textAlign = 'left'
  const wide = context.measureText(name).width + 10
  context.fillStyle = 'rgb(14 17 22 / 80%)'
  context.beginPath()
  context.roundRect(x + 11, y - 9, wide, 18, 9)
  context.fill()
  context.fillStyle = '#fff6e6'
  context.fillText(name, x + 16, y + 1)
}

/**
 * Everyone else in the room on the minimap: where they are, or at its edge in their direction when
 * they're further than it shows, so a friend can always be ridden towards.
 */
export function drawFriends(context: CanvasRenderingContext2D, view: View) {
  const { riders, status } = useRoomStore.getState()
  if (status !== 'on') return
  for (const rider of Object.values(riders)) {
    let [x, y] = toScreen(view, rider.x, rider.z)
    const reach = Math.hypot(x, y)
    const edge = (view.radius ?? Math.min(view.width, view.height) / 2) - 12
    if (reach > edge) {
      x *= edge / reach
      y *= edge / reach
    }
    drawFriendDot(context, view.riderX + x, view.riderY + y, rider.colour, rider.name, false)
  }
}

