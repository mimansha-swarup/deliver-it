import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { pushBlock, squareFor, toBlockGeometries, type Square } from './blocks'
import { ChunkedMesh } from './ChunkedMesh'
import { isNearBuilding, type CollisionWorld } from './collision'
import type { LineFeature } from './mapData'
import { CONCRETE_PHOTO, createPlasterMaterial, preparePlasterPhoto } from './plaster'
import { indexRoadPieces, isClearOfRoads, toRoadPieces, type RoadIndex, type RoadPiece } from './props'
import { PAVEMENT_WIDTH } from './Roads'

/** The kerb between the road and the pavement: its width and how far it stands above the ground, in metres. */
const KERB = { width: 0.18, height: 0.13 }
/** The low concrete edge between the pavement and the soil. */
const EDGING = { width: 0.12, height: 0.07 }
/** Painted kerbs alternate black and yellow in blocks this long, in metres. */
const STRIPE = 0.9
/** Kerbs are checked against other roads, buildings and walls at points this far apart, in metres. */
const STEP = 0.5
/** Kerbs are small, so they're only drawn this close, in metres. */
const KERB_DISTANCE = 260
/** On these roads, the kerbs are painted. Elsewhere they're bare concrete. */
const PAINTED_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk'])

const CONCRETE = [new THREE.Color('#928e86'), new THREE.Color('#87837b'), new THREE.Color('#9b978e')]
const EDGING_COLOR = new THREE.Color('#7f7a71')
const STRIPES = [new THREE.Color('#1d1e20'), new THREE.Color('#e7b51e')]

/**
 * Walks along one edge of a road piece in short steps, and returns the stretches
 * where a kerb belongs: not on another road, and, if `walls` is given, not up
 * against a building or a wall. Junctions are left open this way.
 */
function findRuns(
  piece: RoadPiece,
  outX: number,
  outZ: number,
  middle: number,
  roads: RoadIndex,
  roadGap: number,
  walls: CollisionWorld | null,
): [number, number][] {
  const [startX, startZ] = piece.start
  const length = Math.hypot(piece.end[0] - startX, piece.end[1] - startZ)
  const alongX = (piece.end[0] - startX) / length
  const alongZ = (piece.end[1] - startZ) / length
  const isFree = (along: number) => {
    const x = startX + alongX * along + outX * middle
    const z = startZ + alongZ * along + outZ * middle
    return isClearOfRoads(roads, x, z, roadGap) && !(walls && isNearBuilding(walls, x, z, 0.15))
  }

  const runs: [number, number][] = []
  let runStart: number | null = null
  const steps = Math.max(1, Math.round(length / STEP))
  for (let step = 0; step <= steps; step++) {
    const along = (step / steps) * length
    if (isFree(along)) {
      runStart ??= along
    } else if (runStart !== null) {
      if (along - STEP - runStart > 0.3) runs.push([runStart, along - STEP])
      runStart = null
    }
  }
  if (runStart !== null && length - runStart > 0.3) runs.push([runStart, length])
  return runs
}

function createKerbGeometries(roads: LineFeature[], walls: CollisionWorld): THREE.BufferGeometry[] {
  const pieces = toRoadPieces(roads)
  const index = indexRoadPieces(pieces)
  const squares = new Map<number, Square>()

  for (const piece of pieces) {
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 0.5) continue
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    const painted = PAINTED_ROADS.has(roads[piece.road].properties.highway ?? '')
    const half = piece.width / 2

    for (const side of [1, -1]) {
      // A quarter turn from the way the road runs, one way or the other.
      const outX = alongZ * side
      const outZ = -alongX * side

      // ---- The kerb at the road's edge ----
      // Checked at its middle, which is just off this road, so only other roads cut it.
      const kerbMiddle = half + KERB.width / 2
      for (const [from, to] of findRuns(piece, outX, outZ, kerbMiddle, index, KERB.width / 2 - 0.02, null)) {
        const square = squareFor(squares, piece.start[0] + alongX * from, piece.start[1] + alongZ * from)
        if (!painted) {
          const shade = CONCRETE[Math.floor(Math.abs(piece.start[0] * 7 + piece.start[1] * 3)) % CONCRETE.length]
          pushBlock(square, piece.start, alongX, alongZ, outX, outZ, [from, to], [half, half + KERB.width], KERB.height, shade)
          continue
        }
        // Painted kerbs come in blocks, so the stripes line up with the joins between them.
        for (let at = from; at < to - 0.05; at += STRIPE) {
          const stripe = Math.floor((at + piece.start[0] + piece.start[1]) / STRIPE) % 2
          pushBlock(square, piece.start, alongX, alongZ, outX, outZ, [at, Math.min(to, at + STRIPE) - 0.015], [half, half + KERB.width], KERB.height, STRIPES[Math.abs(stripe)])
        }
      }

      // ---- The edging between the pavement and the soil ----
      // Not where another road's pavement carries on, nor through a building or a wall.
      const edge = half + PAVEMENT_WIDTH
      for (const [from, to] of findRuns(piece, outX, outZ, edge - EDGING.width / 2, index, PAVEMENT_WIDTH - EDGING.width, walls)) {
        const square = squareFor(squares, piece.start[0] + alongX * from, piece.start[1] + alongZ * from)
        pushBlock(square, piece.start, alongX, alongZ, outX, outZ, [from, to], [edge - EDGING.width, edge], EDGING.height, EDGING_COLOR)
      }
    }
  }

  return toBlockGeometries(squares)
}

/**
 * Built kerbs, kept outside React. While textures and models load, React starts
 * the world's rendering over many times, memos and all (Lesson 191), and the
 * kerbs take about half a second to build.
 */
const built = new WeakMap<LineFeature[], THREE.BufferGeometry[]>()

function getKerbGeometries(roads: LineFeature[], walls: CollisionWorld): THREE.BufferGeometry[] {
  let geometries = built.get(roads)
  if (!geometries) {
    geometries = createKerbGeometries(roads, walls)
    built.set(roads, geometries)
  }
  return geometries
}

/**
 * Kerbs along every road, raised between the tarmac and the pavement, painted
 * black and yellow on main roads, and a low edge where the pavement meets the soil.
 */
export function Kerbs({ roads, collisions }: { roads: LineFeature[]; collisions: CollisionWorld }) {
  const geometries = useMemo(() => getKerbGeometries(roads, collisions), [roads, collisions])
  const photo = useTexture(CONCRETE_PHOTO, preparePlasterPhoto)
  // Concrete grain on the grey kerbs, and wear showing through the paint on the striped ones.
  const material = useMemo(() => createPlasterMaterial(photo, { tile: 1.5, strength: 1.8 }, { roughness: 0.92 }), [photo])
  return <ChunkedMesh geometries={geometries} material={material} maxDistance={KERB_DISTANCE} />
}
