import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { ChunkedMesh } from './ChunkedMesh'
import {
  createFlatGeometries,
  positionsFor,
  splitLongPiece,
  type ChunkedPositions,
} from './chunks'
import type { LineFeature, MapData, PolygonFeature } from './mapData'
import { clipToPlayArea, pushStrip, pushTriangle } from './roadGeometry'
import { createSurfaceMaterial, prepareSurfaceTextures } from './surfaceMaterial'
import { isRingInPlayArea, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

/** Under the pavements, which sit at 0.03, so that a park's edge stops at the pavement. */
const PARK_HEIGHT = 0.02
const PATH_HEIGHT = 0.04
const PATH_WIDTH = 2
const PARK_TILE = 18
const PLAIN_PARK_COLOR = '#6f8f4f'
/** Paths are paved with the pavements' stones, a shade warmer so they read as the park's own. */
const PATH_TINT = '#d6d0c6'
const PLAIN_PATH_COLOR = '#9c9384'
/** Shared with the pavements in Roads.tsx, so both come from one download and one GPU copy. */
const PAVEMENT_TEXTURES = ['/textures/pavement-color.jpg', '/textures/pavement-normal.jpg']
const PAVEMENT_TILE = 1.8
/**
 * OSM maps some pavements and zebra crossings as footpaths of their own. The
 * game's pavements already run along every road, and a crossing would be drawn
 * over the tarmac, so these are left out.
 */
const DRAWN_ELSEWHERE = new Set(['sidewalk', 'crossing'])

function toPoints(ring: LonLat[]): THREE.Vector2[] {
  return ring.slice(0, -1).map((position) => {
    const [x, , z] = lonLatToWorld(position)
    return new THREE.Vector2(x, z)
  })
}

/** Cuts each park's outline into triangles, which is what a GPU can draw. */
function createParkGeometries(parks: PolygonFeature[]): THREE.BufferGeometry[] {
  const chunks: ChunkedPositions = new Map()

  parks.forEach((park, index) => {
    const [outer, ...holes] = park.geometry.coordinates
    if (!isRingInPlayArea(outer)) return

    const outline = toPoints(outer)
    const holeOutlines = holes.map(toPoints)
    const corners = [outline, ...holeOutlines].flat()
    const positions: number[] = []

    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(outline, holeOutlines)) {
      const toPoint = (corner: number): GroundPoint => [corners[corner].x, corners[corner].y]
      pushTriangle(positions, PARK_HEIGHT, toPoint(a), toPoint(b), toPoint(c))
    }
    chunks.set(index, positions)
  })

  return createFlatGeometries(chunks)
}

function createPathGeometries(paths: LineFeature[]): THREE.BufferGeometry[] {
  const chunks: ChunkedPositions = new Map()

  for (const path of paths) {
    if (DRAWN_ELSEWHERE.has(path.properties.footway ?? '')) continue
    const points = path.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue

      for (const [start, end] of splitLongPiece(clipped[0], clipped[1])) {
        pushStrip(positionsFor(chunks, start), PATH_HEIGHT, start, end, PATH_WIDTH)
      }
    }
  }

  return createFlatGeometries(chunks)
}

function prepareParkTexture(texture: THREE.Texture) {
  prepareSurfaceTextures([texture, texture], PARK_TILE)
}

/** The city's real parks and footpaths, from the map. */
export function Parks({ data }: { data: MapData }) {
  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const grass = useTexture('/textures/park-color.jpg', prepareParkTexture)
  const pavers = useTexture(PAVEMENT_TEXTURES, (maps) => prepareSurfaceTextures(maps, PAVEMENT_TILE))

  const parks = useMemo(() => createParkGeometries(data.parks), [data])
  const paths = useMemo(() => createPathGeometries(data.footways), [data])

  const parkMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: surfaces === 'plain' ? PLAIN_PARK_COLOR : '#ffffff',
        map: surfaces === 'plain' ? null : grass,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -0.5,
        polygonOffsetUnits: -0.5,
      }),
    [surfaces, grass],
  )
  const pathMaterial = useMemo(
    () =>
      createSurfaceMaterial(pavers, surfaces, {
        color: surfaces === 'plain' ? PLAIN_PATH_COLOR : PATH_TINT,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -1.5,
      }),
    [pavers, surfaces],
  )

  return (
    <>
      <ChunkedMesh geometries={parks} material={parkMaterial} />
      <ChunkedMesh geometries={paths} material={pathMaterial} />
    </>
  )
}
