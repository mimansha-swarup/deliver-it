import { useKeyName } from '../game/keyBindings'
import { use, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../game/gameStore'
import { MISSION_RULES } from '../game/missionConfig'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { loadMapData } from '../world/mapData'
import { createMapLabels, CURRENT_ROAD_HEIGHT, drawCurrentRoad, drawMapLabels, findCurrentRoad } from './mapLabels'
import { PLAY_AREA } from '../world/worldUtils'
import { CURRENT_ROAD_EVERY, EDGE_MARGIN, GROUND_COLOR, IMAGE_SCALE, LAYOUT_RESPONSE, TURN_RESPONSE, createMapImage, currentTarget, drawParkedVehicle, drawPlayer, drawRoute, drawTarget, fitCanvas, toScreen, type View, drawLandmarkDot, drawFriends } from './mapDrawing'
import { mapMarkers } from '../game/mapMarkers'

/** The minimap is redrawn at most this often, in milliseconds (about 30 a second). */
const MAP_FRAME_MS = 32
/** Metres per pixel: online it's zoomed in for finding the way; off duty a little wider. */
const MINIMAP_SCALE = { online: 1.5, off: 2.2 }

/**
 * A round map bottom-left, centred on the rider and turned so ahead is always up: the roads, the
 * route and the stop (or the rider's own waypoint), and the street being ridden. Smaller off duty.
 * Clicking it opens the full map.
 */
export function Minimap({ onOpen }: { onOpen: () => void }) {
  const data = use(loadMapData())
  const canvas = useRef<HTMLCanvasElement>(null)
  const mapImage = useMemo(() => createMapImage(data), [data])
  const online = useGameStore((state) => state.duty === 'online')
  const mapKey = useKeyName('map')
  const distance = useGameStore((state) => state.distance)
  const hasTarget = useGameStore((state) => state.mission !== null || state.waypoint !== null)
  const stores = useGameStore((state) => state.planner?.stores)
  const labels = useMemo(() => {
    const mapLabels = createMapLabels(data)
    // Every dark store, in the pickup colour, so a rider far from home can find the nearest.
    for (const store of stores ?? []) {
      mapLabels.shops.unshift({ x: store.x, z: store.z, text: 'Dark store', color: MISSION_RULES.pickupColor })
    }
    // Landmarks (the Anjaneya statue, the Jagannath temple): first, so their names win a crowded spot.
    for (const marker of mapMarkers.list) mapLabels.shops.unshift({ x: marker.x, z: marker.z, text: marker.text, color: marker.color })
    return mapLabels
  }, [data, stores])
  const scale = useRef(online ? MINIMAP_SCALE.online : MINIMAP_SCALE.off)
  const wantedScale = online ? MINIMAP_SCALE.online : MINIMAP_SCALE.off

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return

    let frame = 0
    let previousTime = performance.now()
    let shownHeading = livePlayer.heading
    let currentRoad: string | null = null
    let lastRoadCheck = -Infinity

    const draw = (time: number) => {
      // Redrawn at most MAP_FRAME_MS apart: a small map turning with the rider looks smooth at 30 a
      // second, and redrawing it, names and all, every frame was a noticeable share of each frame.
      if (time - previousTime < MAP_FRAME_MS) {
        frame = requestAnimationFrame(draw)
        return
      }
      const delta = Math.max(0, (time - previousTime) / 1000)
      previousTime = time
      shownHeading += (livePlayer.heading - shownHeading) * (1 - Math.exp(-TURN_RESPONSE * delta))
      scale.current += (wantedScale - scale.current) * (1 - Math.exp(-LAYOUT_RESPONSE * delta))

      const [width, height] = fitCanvas(element)
      const pixelRatio = window.devicePixelRatio || 1
      const radius = Math.min(width, height) / 2
      if (time - lastRoadCheck > CURRENT_ROAD_EVERY) {
        lastRoadCheck = time
        currentRoad = findCurrentRoad(labels, livePlayer.x, livePlayer.z, currentRoad)
      }
      const view: View = {
        width,
        height,
        riderX: width / 2,
        riderY: height / 2,
        pixelsPerMetre: 1 / scale.current,
        // The world's +Z is down on the image, so a half turn puts "ahead" at the top.
        rotation: Math.PI + shownHeading,
        roomAbove: radius - EDGE_MARGIN,
        roomBelow: radius - EDGE_MARGIN,
        radius,
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.save()
      context.beginPath()
      context.arc(width / 2, height / 2, radius, 0, Math.PI * 2)
      context.clip()
      context.fillStyle = GROUND_COLOR
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(view.riderX, view.riderY)
      context.rotate(view.rotation)
      context.scale(view.pixelsPerMetre / IMAGE_SCALE, view.pixelsPerMetre / IMAGE_SCALE)
      context.drawImage(mapImage, -(livePlayer.x - PLAY_AREA.minX) * IMAGE_SCALE, -(livePlayer.z - PLAY_AREA.minZ) * IMAGE_SCALE)
      context.restore()

      // The route goes under the names, as in a map app, and the pins and rider go over them.
      const target = currentTarget()
      if (target && liveRoute.active) drawRoute(context, view, target.color)
      drawMapLabels(context, labels, {
        pixelsPerMetre: view.pixelsPerMetre,
        centre: [livePlayer.x, livePlayer.z],
        reach: radius * 2 / view.pixelsPerMetre,
        project: (x, z) => {
          const [screenX, screenY] = toScreen(view, x, z)
          return [view.riderX + screenX, view.riderY + screenY]
        },
        bounds: [radius * 0.3, radius * 0.3, width - radius * 0.3, height - radius * 0.45],
        keepClear: [view.riderX, view.riderY, 14],
      })
      for (const marker of mapMarkers.list) {
        const [screenX, screenY] = toScreen(view, marker.x, marker.z)
        drawLandmarkDot(context, view.riderX + screenX, view.riderY + screenY, marker.color)
      }
      drawTarget(context, view, time)
      drawParkedVehicle(context, view)
      // Friends in the room, under the rider's own arrow.
      drawFriends(context, view)
      drawPlayer(context, view)
      if (currentRoad) drawCurrentRoad(context, currentRoad, width / 2, height - CURRENT_ROAD_HEIGHT - 10)
      context.restore()

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [mapImage, labels, wantedScale])

  return (
    <div className="minimap" data-size={online ? 'online' : 'off'}>
      <canvas
        ref={canvas}
        className="minimap-canvas"
        role="button"
        tabIndex={-1}
        aria-label={`Map: click or press ${mapKey} for the full map`}
        onClick={onOpen}
      />
      {hasTarget && distance > 0 && (
        <span className="minimap-distance">{distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`}</span>
      )}
    </div>
  )
}
