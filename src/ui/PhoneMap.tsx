import { use, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { getCurrentStop } from '../missions/missionLogic'
import { loadMapData, type MapData } from '../world/mapData'
import { getRoadWidth } from '../world/roadData'
import {
  isRingInPlayArea,
  lonLatToWorld,
  PLAY_AREA,
  PLAY_AREA_DEPTH,
  PLAY_AREA_WIDTH,
  type LonLat,
} from '../world/worldUtils'

/** Resolution of the pre-drawn map image, in pixels per metre. */
const IMAGE_SCALE = 2
/** How quickly the map turns to follow the bike. Higher is tighter. */
const TURN_RESPONSE = 7
/** How quickly the map zooms and shifts when the phone is raised or lowered. */
const LAYOUT_RESPONSE = 9

/** Metres of the world for each pixel of the phone, as `[tucked away, raised]`. */
const METRES_PER_PIXEL = [1.15, 1.9]
/** How far down the screen the rider sits. Lower sits above the order details. */
const RIDER_POSITION = [0.42, 0.27]
/** How much of the screen's bottom the order details cover, which markers stay clear of. */
const SHEET_SHARE = [0.36, 0.56]
const STATUS_BAR_HEIGHT = 42
const EDGE_MARGIN = 14

const GROUND_COLOR = '#22252a'
const ROAD_COLOR = '#646a73'
const BUILDING_COLOR = '#353940'
const PLAYER_COLOR = '#ffffff'

function toImage(position: LonLat): [number, number] {
  const [x, , z] = lonLatToWorld(position)
  return [(x - PLAY_AREA.minX) * IMAGE_SCALE, (z - PLAY_AREA.minZ) * IMAGE_SCALE]
}

function traceLine(context: CanvasRenderingContext2D, points: LonLat[]) {
  context.beginPath()
  points.forEach((point, i) => {
    const [x, y] = toImage(point)
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
}

/** Draws the whole play area once. Each frame only has to rotate this image. */
function createMapImage(data: MapData): HTMLCanvasElement {
  const image = document.createElement('canvas')
  image.width = PLAY_AREA_WIDTH * IMAGE_SCALE
  image.height = PLAY_AREA_DEPTH * IMAGE_SCALE

  const context = image.getContext('2d')
  if (!context) return image

  context.fillStyle = GROUND_COLOR
  context.fillRect(0, 0, image.width, image.height)

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
type View = {
  width: number
  height: number
  riderX: number
  riderY: number
  pixelsPerMetre: number
  rotation: number
  /** How far above and below the rider a marker can sit. */
  roomAbove: number
  roomBelow: number
}

function toScreen({ pixelsPerMetre, rotation }: View, x: number, z: number): [number, number] {
  const worldX = (x - livePlayer.x) * pixelsPerMetre
  const worldZ = (z - livePlayer.z) * pixelsPerMetre
  return [
    worldX * Math.cos(rotation) - worldZ * Math.sin(rotation),
    worldX * Math.sin(rotation) + worldZ * Math.cos(rotation),
  ]
}

function drawPlayer(context: CanvasRenderingContext2D, { riderX, riderY }: View) {
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
function drawRoute(context: CanvasRenderingContext2D, view: View, color: string) {
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
const PIN_LIFT = 15
const PIN_RADIUS = 9
/** An off-map marker keeps this far from the edge, leaving room for its arrow. */
const OFF_MAP_MARGIN = 34

/** A small picture of what's at the stop: a parcel to collect, a house to deliver to. */
function drawStopIcon(context: CanvasRenderingContext2D, x: number, y: number, pickup: boolean) {
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
function drawBadge(context: CanvasRenderingContext2D, x: number, y: number, color: string, pickup: boolean) {
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
function drawPin(context: CanvasRenderingContext2D, x: number, y: number, color: string, pickup: boolean) {
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
function drawOffMap(
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

/** Draws the current stop as a pin, or at the edge with an arrow if it's off the map. */
function drawTarget(context: CanvasRenderingContext2D, view: View, time: number) {
  const { mission, phase } = useGameStore.getState()
  const stop = getCurrentStop(mission, phase)
  if (!stop) return
  const pickup = phase === 'toPickup'

  drawRoute(context, view, stop.color)

  const [x, y] = toScreen(view, stop.x, stop.z)
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
function fitCanvas(canvas: HTMLCanvasElement): [number, number] {
  const pixelRatio = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pixelWidth = Math.round(width * pixelRatio)
  const pixelHeight = Math.round(height * pixelRatio)

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  return [width, height]
}

/** A map centred on the bike, turned so that ahead is always up. */
export function PhoneMap({ raised }: { raised: boolean }) {
  const data = use(loadMapData())
  const canvas = useRef<HTMLCanvasElement>(null)
  const raisedAmount = useRef(raised ? 1 : 0)
  const target = useRef(raised ? 1 : 0)
  const mapImage = useMemo(() => createMapImage(data), [data])

  useEffect(() => {
    target.current = raised ? 1 : 0
  }, [raised])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    let frame = 0
    let previousTime = performance.now()
    let shownHeading = livePlayer.heading

    const blend = ([tucked, up]: number[]) => tucked + (up - tucked) * raisedAmount.current

    const draw = (time: number) => {
      // A frame's timestamp can be earlier than the last, and a negative step would blow up the maths.
      const delta = Math.max(0, (time - previousTime) / 1000)
      previousTime = time
      shownHeading += (livePlayer.heading - shownHeading) * (1 - Math.exp(-TURN_RESPONSE * delta))
      raisedAmount.current +=
        (target.current - raisedAmount.current) * (1 - Math.exp(-LAYOUT_RESPONSE * delta))

      const [width, height] = fitCanvas(element)
      const pixelRatio = window.devicePixelRatio || 1
      const riderY = height * blend(RIDER_POSITION)
      const view: View = {
        width,
        height,
        riderX: width / 2,
        riderY,
        pixelsPerMetre: 1 / blend(METRES_PER_PIXEL),
        // The world's +Z is down on the image, so a half turn puts "ahead" at the top.
        rotation: Math.PI + shownHeading,
        roomAbove: riderY - STATUS_BAR_HEIGHT - EDGE_MARGIN,
        roomBelow: height * (1 - blend(SHEET_SHARE)) - riderY - EDGE_MARGIN,
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.fillStyle = GROUND_COLOR
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(view.riderX, view.riderY)
      context.rotate(view.rotation)
      context.scale(view.pixelsPerMetre / IMAGE_SCALE, view.pixelsPerMetre / IMAGE_SCALE)
      context.drawImage(
        mapImage,
        -(livePlayer.x - PLAY_AREA.minX) * IMAGE_SCALE,
        -(livePlayer.z - PLAY_AREA.minZ) * IMAGE_SCALE,
      )
      context.restore()

      drawTarget(context, view, time)
      drawPlayer(context, view)

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [mapImage])

  return <canvas ref={canvas} className="phone-map" aria-label="Map of the route" />
}
