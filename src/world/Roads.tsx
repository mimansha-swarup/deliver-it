import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { ChunkedMesh } from './ChunkedMesh'
import { createSurfaceMaterial, prepareSurfaceTextures } from './surfaceMaterial'
import { createFlatGeometries, positionsFor, splitLongPiece, type ChunkedPositions } from './chunks'
import type { LineFeature } from './mapData'
import { getRoadWidth } from './roadData'
import { clipToPlayArea, pushStrip, pushTriangle } from './roadGeometry'
import { lonLatToWorld, type GroundPoint } from './worldUtils'

/** Just above the ground, so the two surfaces don't flicker against each other. */
const ROAD_HEIGHT = 0.05
const JOINT_SIDES = 12
/** A pavement runs under each road, showing this far past the edge on both sides. */
export const PAVEMENT_WIDTH = 3
const PAVEMENT_HEIGHT = 0.03
const PLAIN_ROAD_COLOR = new THREE.Color('#66676b')
const TEXTURED_ROAD_COLOR = new THREE.Color('#a4a4a6')
const PAVEMENT_COLOR = '#ffffff'
/** How wide one repeat of each texture is on the ground, in metres. */
const ROAD_TILE = 8
const PAVEMENT_TILE = 2.5

const ROAD_TEXTURES = ['/textures/road-color.jpg', '/textures/road-normal.jpg']
const PAVEMENT_TEXTURES = ['/textures/pavement-color.jpg', '/textures/pavement-normal.jpg']
/** Wet tarmac looks darker. A full downpour takes this share off. */
const WET_DARKENING = 0.35

/** A flat circle. These fill the gaps at bends and form the junctions. */
function pushJoint(positions: number[], [x, z]: GroundPoint, width: number, height: number) {
  const pointOnCircle = (step: number): GroundPoint => {
    const angle = (step / JOINT_SIDES) * Math.PI * 2
    return [x + (Math.cos(angle) * width) / 2, z + (Math.sin(angle) * width) / 2]
  }

  for (let step = 0; step < JOINT_SIDES; step++) {
    pushTriangle(positions, height, [x, z], pointOnCircle(step), pointOnCircle(step + 1))
  }
}

function createRoadGeometry(
  roads: LineFeature[],
  height: number,
  extraWidth: number,
): THREE.BufferGeometry[] {
  const chunks: ChunkedPositions = new Map()

  // Roads share points at junctions. Keeping only the widest joint at each
  // point avoids stacking several circles in the same place.
  const joints = new Map<string, { point: GroundPoint; width: number }>()
  const addJoint = (point: GroundPoint, width: number) => {
    const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`
    if ((joints.get(key)?.width ?? 0) < width) joints.set(key, { point, width })
  }

  for (const road of roads) {
    const width = getRoadWidth(road) + extraWidth
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })

    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue

      for (const [start, end] of splitLongPiece(clipped[0], clipped[1])) {
        pushStrip(positionsFor(chunks, start), height, start, end, width)
      }
      addJoint(clipped[0], width)
      addJoint(clipped[1], width)
    }
  }

  joints.forEach(({ point, width }) => {
    pushJoint(positionsFor(chunks, point), point, width, height)
  })

  return createFlatGeometries(chunks)
}

function updateWetness(material: THREE.MeshStandardMaterial, dryColor: THREE.Color) {
  material.color.copy(dryColor).multiplyScalar(1 - liveSky.rain * WET_DARKENING)
}

export function Roads({ roads }: { roads: LineFeature[] }) {
  const road = useMemo(() => createRoadGeometry(roads, ROAD_HEIGHT, 0), [roads])
  const pavement = useMemo(
    () => createRoadGeometry(roads, PAVEMENT_HEIGHT, PAVEMENT_WIDTH * 2),
    [roads],
  )

  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const roadMaps = useTexture(ROAD_TEXTURES, (maps) => prepareSurfaceTextures(maps, ROAD_TILE))
  const pavementMaps = useTexture(PAVEMENT_TEXTURES, (maps) =>
    prepareSurfaceTextures(maps, PAVEMENT_TILE),
  )
  const dryRoadColor = surfaces === 'plain' ? PLAIN_ROAD_COLOR : TEXTURED_ROAD_COLOR

  const roadMaterial = useMemo(
    () =>
      createSurfaceMaterial(roadMaps, surfaces, {
        color: dryRoadColor,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [roadMaps, surfaces, dryRoadColor],
  )
  const pavementMaterial = useMemo(
    () =>
      // The pavers show on every level, so Low only gives up their bumps.
      createSurfaceMaterial(pavementMaps, surfaces === 'plain' ? 'color' : surfaces, {
        color: PAVEMENT_COLOR,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [pavementMaps, surfaces],
  )

  useFrame(() => updateWetness(roadMaterial, dryRoadColor))

  return (
    <>
      <ChunkedMesh geometries={pavement} material={pavementMaterial} />
      <ChunkedMesh geometries={road} material={roadMaterial} />
    </>
  )
}
