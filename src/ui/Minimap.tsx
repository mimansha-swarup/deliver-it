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

/** Size on screen, in CSS pixels. */
const MAP_SIZE = 200
/** How many metres of the world fit across the map. */
const VIEW_METRES = 240
/** Resolution of the pre-drawn map image, in pixels per metre. */
const IMAGE_SCALE = 2
/** How quickly the map turns to follow the scooter. Higher is tighter. */
const TURN_RESPONSE = 7

const GROUND_COLOR = '#3f4238'
const ROAD_COLOR = '#c9c7bd'
const BUILDING_COLOR = '#74705f'
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

function drawPlayer(context: CanvasRenderingContext2D, centre: number) {
  context.fillStyle = PLAYER_COLOR
  context.strokeStyle = '#000000'
  context.lineWidth = 1.5
  context.beginPath()
  context.moveTo(centre, centre - 9)
  context.lineTo(centre + 6, centre + 7)
  context.lineTo(centre, centre + 3)
  context.lineTo(centre - 6, centre + 7)
  context.closePath()
  context.fill()
  context.stroke()
}

/** Draws the road route from the rider to the current stop. */
function drawRoute(
  context: CanvasRenderingContext2D,
  centre: number,
  rotation: number,
  pixelsPerMetre: number,
  color: string,
) {
  const { points } = liveRoute
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  context.save()
  context.beginPath()
  context.arc(centre, centre, centre, 0, Math.PI * 2)
  context.clip()

  context.beginPath()
  for (let i = 0; i < points.length; i += 2) {
    const worldX = (points[i] - livePlayer.x) * pixelsPerMetre
    const worldZ = (points[i + 1] - livePlayer.z) * pixelsPerMetre
    const screenX = centre + worldX * cos - worldZ * sin
    const screenY = centre + worldX * sin + worldZ * cos
    if (i === 0) context.moveTo(screenX, screenY)
    else context.lineTo(screenX, screenY)
  }

  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#0f1115'
  context.lineWidth = 7
  context.stroke()
  context.strokeStyle = color
  context.lineWidth = 4
  context.stroke()
  context.restore()
}

/** Draws the current stop, or pins it to the rim if it's out of range. */
function drawTarget(
  context: CanvasRenderingContext2D,
  centre: number,
  rotation: number,
  pixelsPerMetre: number,
) {
  const { mission, phase } = useGameStore.getState()
  const stop = getCurrentStop(mission, phase)
  if (!stop) return

  drawRoute(context, centre, rotation, pixelsPerMetre, stop.color)

  const worldX = (stop.x - livePlayer.x) * pixelsPerMetre
  const worldZ = (stop.z - livePlayer.z) * pixelsPerMetre
  const screenX = worldX * Math.cos(rotation) - worldZ * Math.sin(rotation)
  const screenY = worldX * Math.sin(rotation) + worldZ * Math.cos(rotation)

  const distance = Math.hypot(screenX, screenY)
  const rim = centre - 12
  const scale = distance > rim ? rim / distance : 1

  context.fillStyle = stop.color
  context.strokeStyle = '#000000'
  context.lineWidth = 2
  context.beginPath()
  context.arc(centre + screenX * scale, centre + screenY * scale, 7, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

/** A round map centred on the scooter, turned so that ahead is always up. */
export function Minimap() {
  const data = use(loadMapData())
  const canvas = useRef<HTMLCanvasElement>(null)
  const mapImage = useMemo(() => createMapImage(data), [data])

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return

    const pixelRatio = window.devicePixelRatio || 1
    const centre = MAP_SIZE / 2
    const pixelsPerMetre = MAP_SIZE / VIEW_METRES

    let frame = 0
    let previousTime = performance.now()
    let shownHeading = livePlayer.heading

    const draw = (time: number) => {
      const delta = (time - previousTime) / 1000
      previousTime = time
      shownHeading += (livePlayer.heading - shownHeading) * (1 - Math.exp(-TURN_RESPONSE * delta))

      // The world's +Z is down on the image, so a half turn puts "ahead" at the top.
      const rotation = Math.PI + shownHeading

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, MAP_SIZE, MAP_SIZE)

      context.save()
      context.beginPath()
      context.arc(centre, centre, centre, 0, Math.PI * 2)
      context.clip()

      context.fillStyle = GROUND_COLOR
      context.fillRect(0, 0, MAP_SIZE, MAP_SIZE)

      context.translate(centre, centre)
      context.rotate(rotation)
      context.scale(pixelsPerMetre / IMAGE_SCALE, pixelsPerMetre / IMAGE_SCALE)
      context.drawImage(
        mapImage,
        -(livePlayer.x - PLAY_AREA.minX) * IMAGE_SCALE,
        -(livePlayer.z - PLAY_AREA.minZ) * IMAGE_SCALE,
      )
      context.restore()

      drawTarget(context, centre, rotation, pixelsPerMetre)
      drawPlayer(context, centre)

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [mapImage])

  const pixelRatio = window.devicePixelRatio || 1

  return (
    <canvas
      ref={canvas}
      className="minimap"
      width={MAP_SIZE * pixelRatio}
      height={MAP_SIZE * pixelRatio}
      aria-label="Minimap"
    />
  )
}
