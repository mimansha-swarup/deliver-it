import { useEffect, useMemo, useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { agaraPlaces, isFestivalDay } from '../game/agaraPlaces'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { closeLanes, type TrafficWorld } from '../traffic/trafficLogic'
import type { Agara } from './agaraPlacement'
import { addWall, removeFootprint, type CollisionWorld, type Footprint } from './collision'
import { setClosedLinks, type RoadGraph } from './roadGraph'
import { ShopPeople } from './ShopPeople'
import { box, colored, merge } from './simpleShapes'
import { useHours } from './useHours'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/*
 * A festival procession at the Jagannath temple, in the spirit of the Rath Yatra: on festival days
 * (game/agaraPlaces.ts), from four to eight in the evening, a chariot is drawn slowly up and down the
 * street by the temple, the street lined with people. A celebration, shown with respect: nothing here
 * can be knocked over or ridden through.
 *
 * While it's on, the street is closed: barricades stand across both ends (solid, only for those
 * hours), traffic keeps off it and turns away (trafficLogic.ts' `closeLanes`), and routes go round
 * (roadGraph.ts' `setClosedLinks`). All of it lifts when the procession ends.
 */

const HOURS: [number, number] = [16, 20]
/** The chariot's pace, in metres per second: a walk held back by the ropes. */
const PACE = 0.35

const solid = (geometry: THREE.BufferGeometry, color: string) => colored(geometry.index ? geometry.toNonIndexed() : geometry, color)

/**
 * The chariot (ratha), its front to +z: a wooden car on six big wheels, a pillared stage, and a
 * tall tiered canopy of red and yellow cloth with a pot and a flag on top; the ropes out in front.
 */
function createChariotGeometry(): THREE.BufferGeometry {
  const WOOD = '#7a5230'
  const WOOD_DARK = '#4f3520'
  const RED = '#b8322a'
  const YELLOW = '#e8b62c'
  const GOLD = '#d9a93a'
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-1.55, 1.55]) {
    for (const z of [-1.6, 0, 1.6]) {
      parts.push(solid(new THREE.CylinderGeometry(0.75, 0.75, 0.22, 16).rotateZ(Math.PI / 2).translate(x, 0.75, z), WOOD_DARK))
      parts.push(solid(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8).rotateZ(Math.PI / 2).translate(x, 0.75, z), GOLD))
    }
  }
  parts.push(box([3.0, 0.5, 4.6], [0, 1.45, 0], WOOD))
  parts.push(box([3.3, 0.16, 4.9], [0, 1.78, 0], RED))
  // The stage's pillars and its railing.
  for (const x of [-1.35, 1.35]) for (const z of [-2.0, 0, 2.0]) parts.push(box([0.16, 2.2, 0.16], [x, 2.95, z], GOLD))
  parts.push(box([2.9, 0.4, 0.08], [0, 2.1, 2.15], YELLOW), box([2.9, 0.4, 0.08], [0, 2.1, -2.15], YELLOW))
  parts.push(box([0.08, 0.4, 4.3], [1.45, 2.1, 0], YELLOW), box([0.08, 0.4, 4.3], [-1.45, 2.1, 0], YELLOW))
  // The canopy: tiers of cloth narrowing upward, red and yellow by turns.
  let y = 4.05
  ;[3.3, 2.95, 2.55, 2.1, 1.6, 1.1].forEach((size, tier) => {
    parts.push(box([size, 0.62, size * 1.25], [0, y + 0.31, 0], tier % 2 === 0 ? RED : YELLOW))
    parts.push(box([size * 1.04, 0.08, size * 1.29], [0, y + 0.64, 0], tier % 2 === 0 ? YELLOW : RED))
    y += 0.68
  })
  parts.push(solid(new THREE.SphereGeometry(0.34, 10, 8).translate(0, y + 0.3, 0), GOLD))
  parts.push(solid(new THREE.ConeGeometry(0.12, 0.5, 8).translate(0, y + 0.85, 0), GOLD))
  parts.push(box([0.04, 1.6, 0.04], [0, y + 1.7, 0], WOOD_DARK))
  const flag = new THREE.BufferGeometry()
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, y + 2.5, 0, 0, y + 1.9, 0, 0, y + 2.2, -1.0], 3))
  flag.computeVertexNormals()
  parts.push(colored(flag, RED))
  // Garlands hung along the stage's edge, and the two ropes out in front.
  for (const z of [-2.2, 2.2]) for (let i = -3; i <= 3; i++) parts.push(solid(new THREE.SphereGeometry(0.14, 6, 5).translate(i * 0.42, 3.85 - Math.abs(i % 2) * 0.14, z), i % 2 === 0 ? '#ee8a1f' : '#f4efe0'))
  for (const x of [-0.8, 0.8]) parts.push(box([0.07, 0.07, 7], [x, 1.25, 5.8], '#c9b38a'))
  return merge(parts)
}

/** A barricade across the street's end: striped boards on stands, the street's width, about `at` and across `dir`. */
function createBarricade(x: number, z: number, dirX: number, dirZ: number, width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const boards = Math.max(2, Math.round(width / 1.9))
  for (let i = 0; i < boards; i++) {
    const across = ((i + 0.5) / boards - 0.5) * width
    const board = merge([
      box([1.7, 0.28, 0.06], [0, 1.0, 0], i % 2 === 0 ? '#e9e6dc' : '#c9452f'),
      box([1.7, 0.28, 0.06], [0, 0.62, 0], i % 2 === 0 ? '#c9452f' : '#e9e6dc'),
      box([0.07, 1.15, 0.5], [-0.75, 0.57, 0], '#4a4d51'),
      box([0.07, 1.15, 0.5], [0.75, 0.57, 0], '#4a4d51'),
    ])
    // Its boards run across the street.
    board.rotateY(Math.atan2(dirX, dirZ)).translate(x + dirZ * across, 0, z - dirX * across)
    parts.push(board)
  }
  return merge(parts)
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })

/** `?festival` in the address (with ?debug) holds the procession on, for looking at it. */
const forced = typeof location !== 'undefined' && new URLSearchParams(location.search).has('festival') && new URLSearchParams(location.search).has('debug')

export function Festival({ festival, traffic, collisions, graph }: { festival: Agara['festival']; traffic: TrafficWorld; collisions: CollisionWorld; graph: RoadGraph }) {
  const day = useGameStore((state) => state.day)
  const evening = useHours(HOURS)
  const on = festival !== null && (forced || (isFestivalDay(day) && evening))

  const street = useMemo(() => {
    if (!festival) return null
    const length = Math.hypot(festival.bx - festival.ax, festival.bz - festival.az) || 1
    return { ...festival, length, dirX: (festival.bx - festival.ax) / length, dirZ: (festival.bz - festival.az) / length }
  }, [festival])
  const chariot = useMemo(() => createChariotGeometry(), [])
  const barricades = useMemo(() => {
    if (!street) return null
    const { ax, az, bx, bz, dirX, dirZ, width } = street
    return merge([createBarricade(ax, az, dirX, dirZ, width + 2), createBarricade(bx, bz, dirX, dirZ, width + 2)])
  }, [street])
  useEffect(() => () => {
    chariot.dispose()
    barricades?.dispose()
  }, [chariot, barricades])
  const crowd = useMemo(() => ({ standing: festival?.crowd ?? [], walkers: [] }), [festival])

  // The closure, for as long as the procession is on.
  useEffect(() => {
    if (!on || !street) return
    const { ax, az, bx, bz, dirX, dirZ, width, length } = street
    const within = (x: number, z: number, slack: number) => {
      const along = (x - ax) * dirX + (z - az) * dirZ
      const across = Math.abs((x - ax) * dirZ - (z - az) * dirX)
      return along > -slack && along < length + slack && across < width / 2 + 2
    }
    const side = (x: number, z: number, half: number): [[number, number], [number, number]] => [[x + dirZ * half, z - dirX * half], [x - dirZ * half, z + dirX * half]]
    const walls: Footprint[] = []
    for (const [x, z] of [[ax, az], [bx, bz]]) {
      const wall = addWall(collisions, ...side(x, z, width / 2 + 1.5), 0.5)
      if (wall) walls.push(wall)
    }
    closeLanes(traffic, (lane) => within((lane.startX + lane.endX) / 2, (lane.startZ + lane.endZ) / 2, 0))
    const closed: [number, number][] = []
    graph.links.forEach((links, from) => {
      for (const { to } of links) if (to > from && within((graph.xs[from] + graph.xs[to]) / 2, (graph.zs[from] + graph.zs[to]) / 2, 0)) closed.push([from, to])
    })
    setClosedLinks(closed)
    agaraPlaces.festival = true
    useGameStore.getState().raviSays("There's a festival procession at the Jagannath temple till 8. The street by the temple is closed: routes go round it. Ride gently past, maga.")
    return () => {
      for (const wall of walls) removeFootprint(collisions, wall)
      closeLanes(traffic, null)
      setClosedLinks([])
      agaraPlaces.festival = false
    }
  }, [on, street, traffic, collisions, graph])

  // The chariot: up the street and back, slowly, turning only at the ends (it's drawn, not driven).
  const car = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!car.current || !street || !on) return
    const run = Math.max(1, street.length - 24)
    const travelled = (liveSky.totalHours * 3600 * PACE) / 60
    const lap = travelled % (run * 2)
    const forward = lap < run
    const s = 12 + (forward ? lap : run * 2 - lap)
    car.current.position.set(street.ax + street.dirX * s, 0, street.az + street.dirZ * s)
    car.current.rotation.y = Math.atan2(street.dirX, street.dirZ) + (forward ? 0 : Math.PI)
  })

  if (!on || !street) return null
  return (
    <>
      <mesh ref={car} geometry={chariot} material={material} castShadow receiveShadow />
      {barricades && <mesh geometry={barricades} material={material} castShadow />}
      <ShopPeople people={crowd} />
    </>
  )
}
