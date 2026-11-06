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
import { prepareSurfaceTextures } from './surfaceMaterial'
import { isRingInPlayArea, lonLatToWorld, type GroundPoint, type LonLat } from './worldUtils'

/** Under the pavements, which sit at 0.03, so that a park's edge stops at the pavement. */
const PARK_HEIGHT = 0.02
const PATH_HEIGHT = 0.04
const PATH_WIDTH = 2
const PARK_TILE = 18
const PLAIN_PARK_COLOR = '#6f8f4f'
const PATH_COLOR = '#b9b2a2'

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
      new THREE.MeshStandardMaterial({
        color: PATH_COLOR,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -1.5,
      }),
    [],
  )

  return (
    <>
      <ChunkedMesh geometries={parks} material={parkMaterial} />
      <ChunkedMesh geometries={paths} material={pathMaterial} />
    </>
  )
}
