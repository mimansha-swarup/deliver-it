import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { FLOOR_HEIGHT, getFloors, hashString } from './buildingData'
import type { BuildingKind } from './buildingKinds'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { createFacadeTextures, FACADE_LOOKS, type FacadeLook } from './facadeTextures'
import type { BuildingFeature } from './mapData'
import { isRingInPlayArea, lonLatToLocal, type LonLat } from './worldUtils'

type KindStyle = {
  /** The street level can look different from the floors above it. */
  ground: FacadeLook
  upper: FacadeLook
  colors: THREE.Color[]
}

const toColors = (colors: string[]) => colors.map((color) => new THREE.Color(color))

const KIND_STYLES: Record<BuildingKind, KindStyle> = {
  house: {
    ground: 'house',
    upper: 'house',
    // Bright paint, as homes here so often are.
    colors: toColors([
      '#efe3bf', // cream
      '#e6c9a8', // sand
      '#d9b8ae', // dusty pink
      '#d6a184', // terracotta
      '#b7d1bd', // mint
      '#c7bcdc', // lilac
      '#ecd27e', // turmeric
    ]),
  },
  apartment: {
    ground: 'stilts',
    upper: 'apartment',
    colors: toColors(['#e8e0d0', '#d8d4cc', '#c9c5bb', '#b9c7cc', '#e0d3c0']),
  },
  shop: {
    ground: 'shopfront',
    upper: 'shopFloors',
    colors: toColors(['#d7cfc3', '#c5b8a6', '#b8c0c4', '#d3c098', '#c9a79b']),
  },
  office: {
    ground: 'office',
    upper: 'office',
    colors: toColors(['#a9cde4', '#9cc5c9', '#b4c3d6', '#90b4d8']),
  },
  civic: {
    ground: 'civic',
    upper: 'civic',
    colors: toColors(['#efe6cf', '#e9dcc0', '#e6e1d6']),
  },
}

const WALL_BUMP_STRENGTH = 0.7
const ROOF_SHADE = 0.8
const WINDOW_GLOW = 0.7
/** A spot on every texture that's plain wall, used for roofs. */
const PLAIN_SPOT = 0.02

function toRing(ring: LonLat[]): THREE.Vector2[] {
  // GeoJSON repeats the first point at the end. Three.js closes shapes itself.
  return ring.slice(0, -1).map((position) => new THREE.Vector2(...lonLatToLocal(position)))
}

/**
 * Sets each corner's colour and its place on the window texture. Colour stored
 * on the geometry is what lets all buildings share a single material.
 *
 * On walls, one repeat of the texture covers one window bay and one floor, and
 * the horizontal position is measured along the wall so windows line up. Roofs
 * all use one plain spot on the texture, so they get no windows.
 */
function applyFacadeMapping(geometry: THREE.BufferGeometry, color: THREE.Color, bayWidth: number) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uvs = new Float32Array(position.count * 2)
  const colors = new Float32Array(position.count * 3)
  const roofColor = color.clone().multiplyScalar(ROOF_SHADE)

  for (let i = 0; i < position.count; i++) {
    const isRoof = Math.abs(normal.getZ(i)) > 0.5
    const alongWall = position.getX(i) * -normal.getY(i) + position.getY(i) * normal.getX(i)

    uvs[i * 2] = isRoof ? PLAIN_SPOT : alongWall / bayWidth
    uvs[i * 2 + 1] = isRoof ? PLAIN_SPOT : position.getZ(i) / FLOOR_HEIGHT
    ;(isRoof ? roofColor : color).toArray(colors, i * 3)
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Part of a building: a stack of floors that all share one look. */
type BuildingPart = { look: FacadeLook; geometry: THREE.BufferGeometry }

function createFloors(
  shape: THREE.Shape,
  fromFloor: number,
  toFloor: number,
  look: FacadeLook,
  color: THREE.Color,
): BuildingPart {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: (toFloor - fromFloor) * FLOOR_HEIGHT,
    bevelEnabled: false,
  })
  geometry.translate(0, 0, fromFloor * FLOOR_HEIGHT)
  applyFacadeMapping(geometry, color, FACADE_LOOKS[look].bayWidth)
  return { look, geometry }
}

function createBuildingParts(building: BuildingFeature): BuildingPart[] {
  const [outerRing, ...holes] = building.geometry.coordinates

  const shape = new THREE.Shape(toRing(outerRing))
  shape.holes = holes.map((hole) => new THREE.Path(toRing(hole)))

  const { ground, upper, colors } = KIND_STYLES[building.kind]
  const color = colors[hashString(building.id) % colors.length]
  const floors = getFloors(building)

  if (ground === upper || floors <= 1) return [createFloors(shape, 0, floors, ground, color)]
  return [
    createFloors(shape, 0, 1, ground, color),
    createFloors(shape, 1, floors, upper, color),
  ]
}

/** Combines building parts into one geometry, so the GPU draws them in one call. */
function createBlockGeometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const block = mergeGeometries(parts)
  if (!block) throw new Error('Could not merge building geometries')

  parts.forEach((part) => part.dispose())

  // Extrusion pushes along +Z. This stands the buildings up along +Y.
  block.rotateX(-Math.PI / 2)
  block.computeBoundingSphere()
  return block
}

/** Everything drawn with one look. */
type CityLayer = { look: FacadeLook; geometries: THREE.BufferGeometry[] }

/**
 * One merged geometry per map square and per look, as one draw call can only use
 * one material. With `plain` set there are no textures to tell the looks apart,
 * so everything shares a layer and no extra draw calls are spent.
 */
function createCityLayers(buildings: BuildingFeature[], plain: boolean): CityLayer[] {
  const looks = new Map<FacadeLook, Map<number, THREE.BufferGeometry[]>>()

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue

    const [east, north] = lonLatToLocal(ring[0])
    const key = chunkKey(east, -north)

    for (const part of createBuildingParts(building)) {
      const look = plain ? 'house' : part.look
      const squares = looks.get(look) ?? new Map<number, THREE.BufferGeometry[]>()
      looks.set(look, squares)

      const square = squares.get(key) ?? []
      squares.set(key, square)
      square.push(part.geometry)
    }
  }

  return [...looks].map(([look, squares]) => ({
    look,
    geometries: [...squares.values()].map(createBlockGeometry),
  }))
}

const WALL_PHOTOS = [
  '/textures/wall-color.jpg',
  '/textures/concrete-color.jpg',
  '/textures/brick-color.jpg',
  '/textures/wall-normal.jpg',
  '/textures/concrete-normal.jpg',
  '/textures/brick-normal.jpg',
]

/** Bumps have to repeat with the wall. The colour photos are only copied onto a canvas. */
function prepareWallPhotos(textures: THREE.Texture[]) {
  for (const texture of textures) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
}

function updateWindowGlow(material: THREE.MeshStandardMaterial) {
  material.emissiveIntensity = liveSky.look.night * WINDOW_GLOW
}

export function Buildings({ buildings }: { buildings: BuildingFeature[] }) {
  const { windows, surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const layers = useMemo(() => createCityLayers(buildings, !windows), [buildings, windows])

  const [plaster, concrete, brick, plasterBumps, concreteBumps, brickBumps] = useTexture(
    WALL_PHOTOS,
    prepareWallPhotos,
  )
  const textures = useMemo(
    () =>
      createFacadeTextures({
        plaster: plaster.image as HTMLImageElement,
        concrete: concrete.image as HTMLImageElement,
        brick: brick.image as HTMLImageElement,
      }),
    [plaster, concrete, brick],
  )

  // We created these by hand, so R3F won't free their GPU memory for us.
  useEffect(
    () => () => {
      for (const { facade, lights } of Object.values(textures)) {
        facade.dispose()
        lights.dispose()
      }
    },
    [textures],
  )

  // New materials each time, as a material can't gain or lose a texture freely.
  const materials = useMemo(
    () =>
      layers.map(({ look }) => {
        const { base, bumpy, roughness } = FACADE_LOOKS[look]
        const { facade, lights } = textures[look]
        const bumps = { plaster: plasterBumps, concrete: concreteBumps, brick: brickBumps }[base]

        return new THREE.MeshStandardMaterial({
          map: windows ? facade : null,
          normalMap: surfaces === 'bumps' && bumpy ? bumps : null,
          normalScale: new THREE.Vector2(WALL_BUMP_STRENGTH, WALL_BUMP_STRENGTH),
          emissive: windows ? '#ffffff' : '#000000',
          emissiveMap: windows ? lights : null,
          emissiveIntensity: 0,
          vertexColors: true,
          roughness,
        })
      }),
    [layers, windows, surfaces, textures, plasterBumps, concreteBumps, brickBumps],
  )

  useFrame(() => materials.forEach(updateWindowGlow))

  return layers.map(({ look, geometries }, index) => (
    <ChunkedMesh key={look} geometries={geometries} material={materials[index]} castShadow />
  ))
}
