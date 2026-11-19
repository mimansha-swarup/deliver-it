import { keyFor } from '../game/keyBindings'
import { isKey } from '../game/keyBindings'
import { Suspense, use, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../game/gameStore'
import { MISSION_RULES } from '../game/missionConfig'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { loadMapData } from '../world/mapData'
import { findNearestNode } from '../world/roadGraph'
import { PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH } from '../world/worldUtils'
import { createMapLabels, drawMapLabels } from './mapLabels'
import { createMapImage, currentTarget, drawPin, fitCanvas, GROUND_COLOR, IMAGE_SCALE, PLAYER_COLOR, drawLandmarkDot } from './mapDrawing'
import { mapMarkers } from '../game/mapMarkers'
import { setMapOpen, useUi } from './uiState'

/*
 * The full map: all of HSR, north up, over the game (which keeps running). The rider's arrow, the
 * route, the stop, home and the dark stores, and street names. Wheel to zoom, drag to move. With
 * no order on, a click sets a waypoint the minimap and route lead to. Tab, Esc or the button closes it.
 */

const FRAME_MS = 32
const MIN_ZOOM = 1
const MAX_ZOOM = 8
/** A press that moves less than this, in pixels, is a click rather than a drag. */
const CLICK_SLOP = 5
const HOME_COLOR = '#7fb2ff'

type Camera = { zoom: number; centreX: number; centreZ: number }

/**
 * Pixels per metre at a zoom: zoom 1 is the furthest out, where HSR just covers the panel (no
 * empty margin beyond the map), and it zooms in from there.
 */
function scaleOf(camera: Camera, width: number, height: number): number {
  return Math.max(width / PLAY_AREA_WIDTH, height / PLAY_AREA_DEPTH) * camera.zoom
}

/** Keeps the view on the map: centred on its point where it can be, never so near an edge that beyond shows. */
function clampCamera(camera: Camera, width: number, height: number) {
  const scale = scaleOf(camera, width, height)
  const halfX = width / 2 / scale
  const halfZ = height / 2 / scale
  const clamp = (value: number, low: number, high: number) => (low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value)))
  camera.centreX = clamp(camera.centreX, PLAY_AREA.minX + halfX, PLAY_AREA.minX + PLAY_AREA_WIDTH - halfX)
  camera.centreZ = clamp(camera.centreZ, PLAY_AREA.minZ + halfZ, PLAY_AREA.minZ + PLAY_AREA_DEPTH - halfZ)
}

function MapCanvas() {
  const data = use(loadMapData())
  const canvas = useRef<HTMLCanvasElement>(null)
  const mapImage = useMemo(() => createMapImage(data), [data])
  const labels = useMemo(() => {
    const mapLabels = createMapLabels(data)
    for (const marker of mapMarkers.list) mapLabels.shops.unshift({ x: marker.x, z: marker.z, text: marker.text, color: marker.color })
    return mapLabels
  }, [data])
  // Starts centred on the rider, zoomed to see the neighbourhood.
  const camera = useRef<Camera>({ zoom: 2, centreX: livePlayer.x, centreZ: livePlayer.z })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const hasOrder = useGameStore((state) => state.mission !== null)
  const waypoint = useGameStore((state) => state.waypoint)
  const setWaypoint = useGameStore((state) => state.setWaypoint)

  const scaleFor = (width: number, height: number) => scaleOf(camera.current, width, height)

  const toWorld = (element: HTMLCanvasElement, clientX: number, clientY: number): [number, number] => {
    const rect = element.getBoundingClientRect()
    const scale = scaleFor(rect.width, rect.height)
    const { centreX, centreZ } = camera.current
    return [centreX + (clientX - rect.left - rect.width / 2) / scale, centreZ + (clientY - rect.top - rect.height / 2) / scale]
  }

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    let frame = 0
    let last = 0

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw)
      if (time - last < FRAME_MS) return
      last = time
      const [width, height] = fitCanvas(element)
      const pixelRatio = window.devicePixelRatio || 1
      clampCamera(camera.current, width, height)
      const scale = scaleFor(width, height)
      const { centreX, centreZ } = camera.current
      const project = (x: number, z: number): [number, number] => [width / 2 + (x - centreX) * scale, height / 2 + (z - centreZ) * scale]

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.fillStyle = GROUND_COLOR
      context.fillRect(0, 0, width, height)
      const [originX, originY] = project(PLAY_AREA.minX, PLAY_AREA.minZ)
      context.drawImage(mapImage, originX, originY, mapImage.width * (scale / IMAGE_SCALE), mapImage.height * (scale / IMAGE_SCALE))

      // The route, under the names.
      const target = currentTarget()
      const points = liveRoute.points
      if (target && liveRoute.active && points.length >= 4) {
        context.beginPath()
        for (let i = 0; i < points.length; i += 2) {
          const [x, y] = project(points[i], points[i + 1])
          if (i === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.strokeStyle = '#0f1115'
        context.lineWidth = 7
        context.stroke()
        context.strokeStyle = target.color
        context.lineWidth = 4
        context.stroke()
      }

      drawMapLabels(context, labels, {
        pixelsPerMetre: scale,
        centre: [centreX, centreZ],
        reach: Math.hypot(width, height) / scale,
        project,
        bounds: [4, 4, width - 4, height - 4],
      })

      // Landmarks, dark stores, home, the stop, and the rider on top.
      for (const marker of mapMarkers.list) {
        const [x, y] = project(marker.x, marker.z)
        drawLandmarkDot(context, x, y, marker.color)
      }
      const { planner, home } = useGameStore.getState()
      for (const store of planner?.stores ?? []) {
        const [x, y] = project(store.x, store.z)
        drawPin(context, x, y, MISSION_RULES.pickupColor, true)
      }
      if (home) {
        const [x, y] = project(home.x, home.z)
        context.fillStyle = HOME_COLOR
        context.strokeStyle = '#000'
        context.lineWidth = 2
        context.beginPath()
        context.arc(x, y, 6, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
      if (target) {
        const [x, y] = project(target.x, target.z)
        drawPin(context, x, y, target.color, target.pickup)
      }
      const [riderX, riderY] = project(livePlayer.x, livePlayer.z)
      context.save()
      context.translate(riderX, riderY)
      // Ahead is (sin h, cos h) on the map, with +Z down; the arrow is drawn pointing up.
      context.rotate(Math.PI - livePlayer.heading)
      context.fillStyle = PLAYER_COLOR
      context.strokeStyle = '#000'
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(0, -11)
      context.lineTo(8, 9)
      context.lineTo(0, 4)
      context.lineTo(-8, 9)
      context.closePath()
      context.fill()
      context.stroke()
      context.restore()
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [mapImage, labels])

  return (
    <>
      <canvas
        ref={canvas}
        className="full-map-canvas"
        aria-label="Map of HSR Layout"
        onWheel={(event) => {
          const element = canvas.current
          if (!element) return
          // Zoom about the pointer: the point under it stays put.
          const [beforeX, beforeZ] = toWorld(element, event.clientX, event.clientY)
          const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.current.zoom * Math.exp(-event.deltaY * 0.0015)))
          camera.current.zoom = zoom
          const [afterX, afterZ] = toWorld(element, event.clientX, event.clientY)
          camera.current.centreX += beforeX - afterX
          camera.current.centreZ += beforeZ - afterZ
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, moved: false }
        }}
        onPointerMove={(event) => {
          const start = drag.current
          const element = canvas.current
          if (!start || !element) return
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) start.moved = true
          if (!start.moved) return
          const rect = element.getBoundingClientRect()
          const scale = scaleFor(rect.width, rect.height)
          camera.current.centreX -= (event.clientX - start.x) / scale
          camera.current.centreZ -= (event.clientY - start.y) / scale
          start.x = event.clientX
          start.y = event.clientY
        }}
        onPointerUp={(event) => {
          const start = drag.current
          drag.current = null
          const element = canvas.current
          const { planner, mission } = useGameStore.getState()
          if (!start || start.moved || !element || !planner || mission) return
          // A click: a waypoint at the nearest road point to where it landed.
          const [x, z] = toWorld(element, event.clientX, event.clientY)
          const node = findNearestNode(planner.graph, x, z)
          setWaypoint({ x: planner.graph.xs[node], z: planner.graph.zs[node], node })
        }}
      />
      <p className="full-map-hint">
        {hasOrder ? `Following your order · ${keyFor('map')} or Esc to close` : `Click to set a waypoint · drag to move · scroll to zoom · ${keyFor('map')} or Esc to close`}
        {waypoint && !hasOrder && (
          <button type="button" onClick={() => setWaypoint(null)}>
            Clear waypoint
          </button>
        )}
      </p>
    </>
  )
}

/** Tab (or the minimap) opens the full map; Tab or Esc closes it. */
export function FullMap() {
  const open = useUi((state) => state.mapOpen)
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isKey('map', event.code)) {
        // Tab would otherwise move the keyboard focus around the page.
        event.preventDefault()
        if (!event.repeat) setMapOpen(!useUi.getState().mapOpen)
      } else if (event.code === 'Escape' && useUi.getState().mapOpen) {
        setMapOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  if (!open) return null
  return (
    <section className="full-map" role="dialog" aria-label="Map">
      <Suspense fallback={null}>
        <MapCanvas />
      </Suspense>
      <button type="button" className="full-map-close" onClick={() => setMapOpen(false)}>
        Close · {keyFor('map')}
      </button>
    </section>
  )
}
