import { useMemo } from 'react'
import * as THREE from 'three'
import { ChunkedMesh } from './ChunkedMesh'
import { createLineGeometries, positionsFor, type ChunkedPositions } from './chunks'
import { findNearestWall, isNearBuilding, type CollisionWorld } from './collision'
import type { RoadsideProps } from './props'

const CABLE_COLOR = '#17181b'
/** Each pole carries a bundle of wires, at these heights and with this much droop. */
const WIRES = [
  { height: 5.9, sag: 0.55 },
  { height: 5.6, sag: 0.8 },
  { height: 5.25, sag: 0.65 },
  { height: 4.9, sag: 1 },
]
/** Further off than this, a bundle of wires reads as one thick black bar, in metres. */
const CABLE_DISTANCE = 130
/** Straight pieces in each cable. More makes a smoother curve. */
const CABLE_PIECES = 8
/** Every this many lamps, a wire runs over to the nearest house. */
const HOUSE_LINE_EVERY = 2
const HOUSE_LINE_REACH = 13
const HOUSE_LINE_HEIGHT = 5.4
const HOUSE_LINE_END_HEIGHT = 4.6
const HOUSE_LINE_SAG = 0.45
/** How close to a wall a cable may pass, in metres. */
const WALL_GAP = 0.3

type Point = [x: number, y: number, z: number]

/** Adds a cable that hangs between two points, lowest in the middle. */
function pushCable(chunks: ChunkedPositions, start: Point, end: Point, sag: number) {
  const pointAt = (along: number): Point => [
    start[0] + (end[0] - start[0]) * along,
    // A parabola: 0 at both ends, and exactly `sag` at the middle.
    start[1] + (end[1] - start[1]) * along - sag * 4 * along * (1 - along),
    start[2] + (end[2] - start[2]) * along,
  ]

  const positions = positionsFor(chunks, [start[0], start[2]])
  for (let piece = 0; piece < CABLE_PIECES; piece++) {
    positions.push(...pointAt(piece / CABLE_PIECES), ...pointAt((piece + 1) / CABLE_PIECES))
  }
}

/** True when a line between two ground points stays clear of buildings along its length. */
function isClearSpan(
  collisions: CollisionWorld,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  // The ends are left out, as each one is at a post.
  for (let along = 0.1; along < 0.95; along += 0.1) {
    const x = fromX + (toX - fromX) * along
    const z = fromZ + (toZ - fromZ) * along
    if (isNearBuilding(collisions, x, z, WALL_GAP)) return false
  }
  return true
}

function createCableGeometries(
  { lamps, postPairs }: RoadsideProps,
  collisions: CollisionWorld,
): THREE.BufferGeometry[] {
  const chunks: ChunkedPositions = new Map()

  for (const { from, to } of postPairs) {
    if (!isClearSpan(collisions, from.x, from.z, to.x, to.z)) continue

    for (const { height, sag } of WIRES) {
      pushCable(chunks, [from.x, height, from.z], [to.x, height, to.z], sag)
    }
  }

  lamps.forEach((lamp, index) => {
    if (index % HOUSE_LINE_EVERY !== 0) return

    const wall = findNearestWall(collisions, lamp.x, lamp.z, HOUSE_LINE_REACH)
    // Trees and lamps are collision shapes too, with far shorter sides than a real wall.
    if (!wall || wall.length < 2) return

    const start: Point = [lamp.x, HOUSE_LINE_HEIGHT, lamp.z]
    pushCable(chunks, start, [wall.x, HOUSE_LINE_END_HEIGHT, wall.z], HOUSE_LINE_SAG)
  })

  return createLineGeometries(chunks)
}

/** The tangle of power and cable TV lines that follows every street. */
export function Cables({
  props,
  collisions,
}: {
  props: RoadsideProps
  collisions: CollisionWorld
}) {
  const geometries = useMemo(() => createCableGeometries(props, collisions), [props, collisions])
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: CABLE_COLOR }), [])

  return <ChunkedMesh geometries={geometries} material={material} lines maxDistance={CABLE_DISTANCE} />
}
