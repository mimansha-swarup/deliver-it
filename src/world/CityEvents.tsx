import { useEffect, useMemo, useRef, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { areaAt } from '../game/areas'
import { cityEvents, type CityEvent, type CityEventKind } from '../game/cityEvents'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { mapMarkers } from '../game/mapMarkers'
import { STRIDE_PER_METRE } from '../traffic/gait'
import type { Lane } from '../traffic/lanes'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createPerson } from '../traffic/person'
import { People } from '../traffic/Traffic'
import { closeLanes, type Pedestrian, type TrafficWorld } from '../traffic/trafficLogic'
import { createBrokenBus, createCow, createDigSite, createWeddingCar } from './cityEventShapes'
import { addPost, addWall, removeFootprint, removePost, type CollisionWorld, type Footprint } from './collision'
import { setClosedLinks, type RoadGraph } from './roadGraph'

/*
 * Things that happen on the roads, one at a time, somewhere ahead of the rider (game/cityEvents.ts
 * says what's on):
 *
 *   bus      a city bus broken down in its lane: solid; traffic keeps off that lane; ride round it
 *   dig      a road dug up for pipe work: closed to everything; the GPS routes round it
 *   wedding  a wedding procession walking a street behind its band: slow and solid; the street is
 *            closed to traffic while it passes, and a rider can ease past along its side
 *   cow      a cow sitting in a lane: solid, unbothered; go round her
 *
 * Each lasts a few minutes and then clears. They're scenery with consequences, shown with good
 * humour and respect; nobody in them can be knocked over. `?event=dig` (with ?debug) stages one now,
 * just ahead.
 */

/** Real seconds each lasts, and between the end of one and the start of the next. */
const LASTS: Record<CityEventKind, number> = { bus: 240, dig: 300, wedding: 420, cow: 170 }
const GAP: [number, number] = [150, 320]
const FIRST: [number, number] = [70, 130]
/** How far from the rider one may begin, in metres: out of sight, within a short ride. */
const RANGE: [number, number] = [150, 430]
/** How far along a dug-up road is shut, either side of the trench, in metres. */
const DIG_REACH = 8
/** A wedding procession's pace (m/s), and how long its solid middle is. */
const WEDDING = { pace: 0.6, length: 15, width: 2.4, minPath: 110, maxPath: 240 }
const MARKER_COLOR = '#ff6b5e'
const NAMES: Record<CityEventKind, string> = { bus: 'Bus broken down', dig: 'Road dug up', wedding: 'Wedding procession', cow: 'Cow on the road' }

const forcedKind = (): CityEventKind | null => {
  if (typeof location === 'undefined') return null
  const query = new URLSearchParams(location.search)
  const kind = query.get('event')
  return query.has('debug') && (kind === 'bus' || kind === 'dig' || kind === 'wedding' || kind === 'cow') ? kind : null
}

type Path = { points: [number, number][]; at: number[]; length: number }
type Staged = CityEvent & { width: number; path: Path | null; undo: () => void }

const between = ([low, high]: [number, number]) => low + Math.random() * (high - low)
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

function pointOn(path: Path, s: number): { x: number; z: number; dirX: number; dirZ: number } {
  const clamped = Math.max(0, Math.min(path.length, s))
  let index = 0
  while (index < path.at.length - 2 && path.at[index + 1] < clamped) index++
  const [ax, az] = path.points[index]
  const [bx, bz] = path.points[index + 1]
  const span = path.at[index + 1] - path.at[index] || 1
  const t = (clamped - path.at[index]) / span
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dirX: (bx - ax) / span, dirZ: (bz - az) / span }
}

/** Whether a spot is where an event may be: in range of the rider (or just ahead, when forced), away from signals and the order's own stops. */
function spotAllowed(x: number, z: number, forced: boolean): boolean {
  const away = Math.hypot(x - livePlayer.x, z - livePlayer.z)
  if (forced) {
    const ahead = (x - livePlayer.x) * Math.sin(livePlayer.heading) + (z - livePlayer.z) * Math.cos(livePlayer.heading)
    if (away < 35 || away > 130 || ahead < 25) return false
  } else if (away < RANGE[0] || away > RANGE[1]) return false
  // Not at a signal (when it's staged for a look, anywhere just ahead will do).
  if (!forced && areaAt(x, z).junction > 0.55) return false
  const game = useGameStore.getState()
  const stops = [game.mission?.pickup, game.mission?.customer, game.home, ...(game.planner?.stores ?? [])]
  return stops.every((stop) => !stop || Math.hypot(stop.x - x, stop.z - z) > 60)
}

/** Stages an event of a kind, or returns null if nowhere suits right now. */
function stage(kind: CityEventKind, traffic: TrafficWorld, collisions: CollisionWorld, graph: RoadGraph, forced: boolean): Staged | null {
  const from = liveSky.totalHours
  const base = { kind, from, until: from }

  if (kind === 'bus' || kind === 'cow') {
    const lanes = traffic.roadLanes.filter((lane) => !lane.deck && !lane.closed && lane.length >= 7 && spotAllowed((lane.startX + lane.endX) / 2, (lane.startZ + lane.endZ) / 2, forced))
    const wanted = kind === 'bus' ? lanes.filter((lane) => lane.buses) : lanes.filter((lane) => !lane.buses)
    const options = wanted.length > 0 ? wanted : lanes
    if (options.length === 0) return null
    const lane: Lane = pick(options)
    const x = (lane.startX + lane.endX) / 2
    const z = (lane.startZ + lane.endZ) / 2
    const { forwardX: dirX, forwardZ: dirZ } = lane
    let undoSolid: () => void
    if (kind === 'bus') {
      const wall = addWall(collisions, [x - dirX * 5.2, z - dirZ * 5.2], [x + dirX * 5.2, z + dirZ * 5.2], 2.6)
      undoSolid = () => wall && removeFootprint(collisions, wall)
    } else {
      addPost(collisions, x, z, 0.95)
      undoSolid = () => removePost(collisions, x, z)
    }
    // Its own lane, and (a bus being longer than one stretch of lane) the stretches before and after it, the same way.
    const reach = kind === 'bus' ? 11 : 1
    closeLanes(
      traffic,
      (other) => {
        if (other === lane) return true
        const mx = (other.startX + other.endX) / 2 - x
        const mz = (other.startZ + other.endZ) / 2 - z
        return other.forwardX * dirX + other.forwardZ * dirZ > 0.9 && Math.abs(mx * dirX + mz * dirZ) < reach && Math.abs(mx * dirZ - mz * dirX) < 1.5
      },
      'event',
    )
    return { ...base, x, z, dirX, dirZ, road: graph.roadNames[lane.startNode] ?? '', closes: false, width: 3, path: null, undo: () => { undoSolid(); closeLanes(traffic, null, 'event') } }
  }

  // A link of a named side street, not too wide: for the dig, or the start of a procession's walk.
  const starts: { a: number; b: number; width: number }[] = []
  graph.links.forEach((links, a) => {
    const name = graph.roadNames[a]
    if (!name || /flyover|service/i.test(name)) return
    for (const { to: b, length, roadWidth } of links) {
      if (roadWidth < 6 || roadWidth > 10.5 || length < 7) continue
      if (spotAllowed((graph.xs[a] + graph.xs[b]) / 2, (graph.zs[a] + graph.zs[b]) / 2, forced)) starts.push({ a, b, width: roadWidth })
    }
  })
  if (starts.length === 0) return null

  if (kind === 'dig') {
    const { a, b, width } = pick(starts)
    const x = (graph.xs[a] + graph.xs[b]) / 2
    const z = (graph.zs[a] + graph.zs[b]) / 2
    const span = Math.hypot(graph.xs[b] - graph.xs[a], graph.zs[b] - graph.zs[a]) || 1
    const dirX = (graph.xs[b] - graph.xs[a]) / span
    const dirZ = (graph.zs[b] - graph.zs[a]) / span
    const within = (px: number, pz: number, reach: number) => Math.abs((px - x) * dirX + (pz - z) * dirZ) < reach && Math.abs((px - x) * dirZ - (pz - z) * dirX) < width / 2 + 2
    const walls: Footprint[] = []
    for (const end of [-1, 1]) {
      const cx = x + dirX * DIG_REACH * end
      const cz = z + dirZ * DIG_REACH * end
      const half = width / 2 + 1.2
      const wall = addWall(collisions, [cx + dirZ * half, cz - dirX * half], [cx - dirZ * half, cz + dirX * half], 0.5)
      if (wall) walls.push(wall)
    }
    closeLanes(traffic, (lane) => within((lane.startX + lane.endX) / 2, (lane.startZ + lane.endZ) / 2, DIG_REACH + lane.length / 2), 'event')
    const closed: [number, number][] = []
    graph.links.forEach((links, node) => {
      for (const { to, length } of links) if (to > node && within((graph.xs[node] + graph.xs[to]) / 2, (graph.zs[node] + graph.zs[to]) / 2, DIG_REACH + length / 2)) closed.push([node, to])
    })
    setClosedLinks(closed, 'event')
    return {
      ...base, x, z, dirX, dirZ, road: graph.roadNames[a], closes: true, width, path: null,
      undo: () => {
        for (const wall of walls) removeFootprint(collisions, wall)
        closeLanes(traffic, null, 'event')
        setClosedLinks([], 'event')
      },
    }
  }

  // A wedding procession: a walk along the street, straight on from link to link for as far as it runs.
  for (let attempt = 0; attempt < 12; attempt++) {
    const { a, b, width } = pick(starts)
    const points: [number, number][] = [[graph.xs[a], graph.zs[a]], [graph.xs[b], graph.zs[b]]]
    let previous = a
    let current = b
    let length = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1])
    while (length < WEDDING.maxPath) {
      const dirX = graph.xs[current] - graph.xs[previous]
      const dirZ = graph.zs[current] - graph.zs[previous]
      const dirLength = Math.hypot(dirX, dirZ) || 1
      // Straight on: the link that turns least, on the same road.
      let next = -1
      let best = 0.93
      for (const { to } of graph.links[current]) {
        if (to === previous || graph.roadNames[to] !== graph.roadNames[a]) continue
        const span = Math.hypot(graph.xs[to] - graph.xs[current], graph.zs[to] - graph.zs[current]) || 1
        const same = (dirX * (graph.xs[to] - graph.xs[current]) + dirZ * (graph.zs[to] - graph.zs[current])) / (dirLength * span)
        if (same > best) {
          best = same
          next = to
        }
      }
      if (next < 0 || areaAt(graph.xs[next], graph.zs[next]).junction > 0.6) break
      points.push([graph.xs[next], graph.zs[next]])
      length += Math.hypot(graph.xs[next] - graph.xs[current], graph.zs[next] - graph.zs[current])
      previous = current
      current = next
    }
    if (length < WEDDING.minPath) continue
    const at = [0]
    for (let i = 1; i < points.length; i++) at.push(at[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
    const path: Path = { points, at, length }
    const onStreet = (px: number, pz: number) =>
      points.some(([ax, az], index) => {
        if (index === points.length - 1) return false
        const [bx, bz] = points[index + 1]
        const span = at[index + 1] - at[index] || 1
        const along = ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / span
        const across = Math.abs((px - ax) * (bz - az) - (pz - az) * (bx - ax)) / span
        return along > -2 && along < span + 2 && across < width / 2 + 1.5
      })
    closeLanes(traffic, (lane) => onStreet((lane.startX + lane.endX) / 2, (lane.startZ + lane.endZ) / 2), 'event')
    const first = pointOn(path, 0)
    return { ...base, x: first.x, z: first.z, dirX: first.dirX, dirZ: first.dirZ, road: graph.roadNames[a], closes: false, width, path, undo: () => closeLanes(traffic, null, 'event') }
  }
  return null
}

/** Who's there, by event: where they stand in its own space (x across, z along), which way they face, and who's in uniform. */
type Cast = { x: number; z: number; turn: number; band?: boolean }[]
const CASTS: Record<CityEventKind, Cast> = {
  // The driver looking into the engine, the conductor waving traffic round.
  bus: [{ x: 0.3, z: -6.1, turn: 0 }, { x: 1.9, z: -7.4, turn: Math.PI }],
  dig: [{ x: -1.2, z: 2.0, turn: Math.PI }, { x: 1.4, z: -1.9, turn: 0 }, { x: 2.2, z: -6.5, turn: Math.PI / 2 }],
  // The band in two rows ahead of the car, family dancing and walking behind it.
  wedding: [
    ...[-0.9, 0, 0.9].flatMap((x) => [{ x, z: 6.4, turn: 0, band: true }, { x, z: 5.0, turn: 0, band: true }]),
    ...[-1.0, -0.3, 0.4, 1.1].flatMap((x, index) => [{ x, z: -3.6 - (index % 2) * 0.5, turn: 0 }, { x: x + 0.2, z: -5.2 - (index % 2) * 0.4, turn: 0 }, { x: x - 0.1, z: -6.9, turn: 0 }]),
  ],
  cow: [],
}

/** Moves an event's people to where it is now: standing about, or walking (and dancing) with a procession. */
function placeCast(people: Pedestrian[], cast: Cast, at: { x: number; z: number; dirX: number; dirZ: number }, moving: number, time: number, shown: boolean) {
  const heading = Math.atan2(at.dirX, at.dirZ)
  people.forEach((person, index) => {
    const { x, z, turn, band } = cast[index]
    // Dancers sway side to side and hop; the band keeps its rows.
    const sway = moving > 0 && !band ? Math.sin(time * 3.1 + index * 1.7) * 0.22 : 0
    person.x = at.x + at.dirX * z + at.dirZ * (x + sway)
    person.z = at.z + at.dirZ * z - at.dirX * (x + sway)
    person.heading = heading + turn
    person.walking = moving > 0 ? 1 : 0.1 + Math.sin(time * 1.2 + index * 2.1) * 0.08
    person.stride = moving > 0 ? time * moving * STRIDE_PER_METRE + index : Math.PI / 2
    person.lift = shown ? (moving > 0 && !band ? Math.abs(Math.sin(time * 6.2 + index)) * 0.07 : 0) : -50
    person.wave = moving > 0 && !band && index % 3 === 0 ? 1 : 0
  })
}

const BAND_UNIFORM = ['#b3261e']
const WORK_CLOTHES = ['#d9a520', '#5d6b7a', '#8a5a3c']

// Debug: what's on, for scripts (with ?debug).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) Object.assign(window, { __cityEvents: cityEvents })

export function CityEvents({ traffic, collisions, graph }: { traffic: TrafficWorld; collisions: CollisionWorld; graph: RoadGraph }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const body = useMemo(() => getModel(scene, 'man'), [scene])
  const [event, setEvent] = useState<Staged | null>(null)
  const live = useRef<{ event: Staged | null; startedAt: number; nextIn: number; wall: Footprint | null; sinceWall: number }>({ event: null, startedAt: 0, nextIn: forcedKind() ? 3 : between(FIRST), wall: null, sinceWall: 0 })
  const group = useRef<THREE.Group>(null)
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), [])
  useEffect(() => () => material.dispose(), [material])

  const geometry = useMemo(() => {
    if (!event) return null
    return event.kind === 'bus' ? createBrokenBus() : event.kind === 'dig' ? createDigSite(event.width) : event.kind === 'wedding' ? createWeddingCar() : createCow()
  }, [event])
  useEffect(() => () => geometry?.dispose(), [geometry])
  const cast = event ? CASTS[event.kind] : CASTS.cow
  const band = useMemo(() => cast.filter((one) => one.band).map(() => createPerson(0, 0, 0, 0.5, 0.8)), [cast])
  const others = useMemo(() => cast.filter((one) => !one.band).map((_, index) => createPerson(0, 0, 0, (index * 0.37) % 1, 0.7 + ((index * 0.13) % 0.3))), [cast])

  // Whatever is staged when the world goes away is cleared up.
  useEffect(() => {
    const state = live.current
    return () => {
      state.event?.undo()
      if (state.wall) removeFootprint(collisions, state.wall)
      cityEvents.active = []
    }
  }, [collisions])

  useFrame(({ clock }, delta) => {
    const state = live.current
    const game = useGameStore.getState()
    if (!game.started || game.photoMode) return
    const dt = Math.min(delta, 0.1)

    if (!state.event) {
      state.nextIn -= dt
      if (state.nextIn > 0) return
      const forced = forcedKind()
      const kind = forced ?? pick<CityEventKind>(['bus', 'dig', 'wedding', 'cow', 'cow', 'dig'])
      const staged = stage(kind, traffic, collisions, graph, forced !== null)
      // Nowhere suits just now: try again soon.
      if (!staged) {
        state.nextIn = 20
        return
      }
      state.event = staged
      state.startedAt = clock.elapsedTime
      state.sinceWall = 99
      cityEvents.active = [staged]
      mapMarkers.list.push({ x: staged.x, z: staged.z, text: NAMES[kind], color: MARKER_COLOR })
      const where = staged.road ? `on ${staged.road}` : 'up ahead'
      game.raviSays(
        kind === 'bus' ? `Heads up: a bus has broken down ${where}. One lane is blocked, go round it.`
          : kind === 'dig' ? `Heads up: ${staged.road || 'a road near you'} is dug up for pipe work. It's closed; your GPS will take you round.`
            : kind === 'wedding' ? `There's a wedding procession ${where}. Go slowly past, maga, and no horn.`
              : `A cow is sitting in the road ${where}. She's not moving. Go round her.`,
      )
      setEvent(staged)
      return
    }

    const staged = state.event
    const age = clock.elapsedTime - state.startedAt
    // A procession walks its street; everything else stays where it is.
    let at = { x: staged.x, z: staged.z, dirX: staged.dirX, dirZ: staged.dirZ }
    let moving = 0
    let finished = age > LASTS[staged.kind]
    if (staged.path) {
      const s = 8 + age * WEDDING.pace
      at = pointOn(staged.path, s)
      moving = WEDDING.pace
      if (s >= staged.path.length - 6) finished = true
      // Its solid middle moves with it, a step at a time.
      state.sinceWall += dt
      if (state.sinceWall > 0.6) {
        state.sinceWall = 0
        if (state.wall) removeFootprint(collisions, state.wall)
        state.wall = addWall(collisions, [at.x - at.dirX * (WEDDING.length / 2 + 1), at.z - at.dirZ * (WEDDING.length / 2 + 1)], [at.x + at.dirX * (WEDDING.length / 2), at.z + at.dirZ * (WEDDING.length / 2)], WEDDING.width)
        const marker = mapMarkers.list.find((one) => one.text === NAMES.wedding)
        if (marker) {
          marker.x = at.x
          marker.z = at.z
        }
        staged.x = at.x
        staged.z = at.z
      }
    }
    const shown = Math.hypot(at.x - livePlayer.x, at.z - livePlayer.z) < 260
    if (group.current) {
      group.current.visible = shown
      group.current.position.set(at.x, 0.05, at.z)
      group.current.rotation.y = Math.atan2(at.dirX, at.dirZ)
    }
    const all = CASTS[staged.kind]
    placeCast(band, all.filter((one) => one.band), at, moving, clock.elapsedTime, shown)
    placeCast(others, all.filter((one) => !one.band), at, moving, clock.elapsedTime, shown)

    if (finished && !forcedKind()) {
      staged.undo()
      if (state.wall) removeFootprint(collisions, state.wall)
      state.wall = null
      mapMarkers.list = mapMarkers.list.filter((one) => one.text !== NAMES[staged.kind])
      cityEvents.active = []
      state.event = null
      state.nextIn = between(GAP)
      setEvent(null)
    }
  })

  if (!event || !geometry) return null
  return (
    <>
      <group ref={group} visible={false}>
        <mesh geometry={geometry} material={material} castShadow receiveShadow />
      </group>
      {band.length > 0 && <People key={`band ${band.length}`} items={band} body={body} palette={BAND_UNIFORM} />}
      {others.length > 0 && <People key={`cast ${event.kind} ${others.length}`} items={others} body={body} palette={event.kind === 'wedding' ? undefined : WORK_CLOTHES} />}
    </>
  )
}
