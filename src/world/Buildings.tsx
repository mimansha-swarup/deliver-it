import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { PolygonFeature } from './mapData'
import { isRingInPlayArea, lonLatToLocal, type LonLat } from './worldUtils'

const FLOOR_HEIGHT = 3.2

const WALL_COLORS = [
  '#e8e0d0', // off-white
  '#efe3bf', // cream
  '#e6c9a8', // sand
  '#d9b8ae', // dusty pink
  '#b9c7cc', // pale blue-grey
  '#c9c5bb', // concrete
  '#d6a184', // terracotta
].map((color) => new THREE.Color(color))

/** Width of one window and the wall around it, in metres. */
const WINDOW_BAY_WIDTH = 3.4
const ROOF_SHADE = 0.8
/** A spot on the texture that's plain wall, used for roofs. */
const PLAIN_SPOT = 0.02

/**
 * One window bay, drawn in code. It's white where the wall is, so the building's
 * own colour shows through there, and every wall in the city repeats this image.
 */
function createFacadeTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)

    // A slightly darker band where each floor meets the next.
    context.fillStyle = '#d9d9d9'
    context.fillRect(0, size - 6, size, 6)

    // Frame, then glass, then the bar down the middle of the window.
    context.fillStyle = '#8c8a84'
    context.fillRect(34, 26, 60, 66)
    context.fillStyle = '#3e4c58'
    context.fillRect(38, 30, 52, 58)
    context.fillStyle = '#8c8a84'
    context.fillRect(62, 30, 4, 58)

    // Window sill.
    context.fillStyle = '#b4b2ab'
    context.fillRect(30, 92, 68, 5)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * Turns text into a stable number (FNV-1a hash). A building's "random" height
 * and colour come from its id, so it looks the same on every page load.
 */
function hashString(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  }
  return hash >>> 0
}

/** Uses the mapped floor count if there is one, otherwise estimates from size. */
function getFloors(building: PolygonFeature, footprintArea: number): number {
  const mapped = Number(building.properties['building:levels'])
  if (mapped > 0) return mapped

  const variation = hashString(building.id) % 3
  if (footprintArea < 60) return 1 + (variation % 2) // 1 or 2
  if (footprintArea > 400) return 3 + variation // 3 to 5
  return 2 + variation // 2 to 4
}

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
function applyFacadeMapping(geometry: THREE.BufferGeometry, color: THREE.Color) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uvs = new Float32Array(position.count * 2)
  const colors = new Float32Array(position.count * 3)
  const roofColor = color.clone().multiplyScalar(ROOF_SHADE)

  for (let i = 0; i < position.count; i++) {
    const isRoof = Math.abs(normal.getZ(i)) > 0.5
    const alongWall = position.getX(i) * -normal.getY(i) + position.getY(i) * normal.getX(i)

    uvs[i * 2] = isRoof ? PLAIN_SPOT : alongWall / WINDOW_BAY_WIDTH
    uvs[i * 2 + 1] = isRoof ? PLAIN_SPOT : position.getZ(i) / FLOOR_HEIGHT
    ;(isRoof ? roofColor : color).toArray(colors, i * 3)
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function createBuildingGeometry(building: PolygonFeature): THREE.BufferGeometry {
  const [outerRing, ...holes] = building.geometry.coordinates

  const shape = new THREE.Shape(toRing(outerRing))
  shape.holes = holes.map((hole) => new THREE.Path(toRing(hole)))

  const floors = getFloors(building, Math.abs(THREE.ShapeUtils.area(shape.getPoints())))
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: floors * FLOOR_HEIGHT,
    bevelEnabled: false,
  })

  const color = WALL_COLORS[hashString(building.id) % WALL_COLORS.length]
  applyFacadeMapping(geometry, color)
  return geometry
}

/** Combines all buildings into one geometry, so the GPU draws them in one call. */
function createCityGeometry(buildings: PolygonFeature[]): THREE.BufferGeometry {
  const parts = buildings.map(createBuildingGeometry)
  const city = mergeGeometries(parts)
  if (!city) throw new Error('Could not merge building geometries')

  parts.forEach((part) => part.dispose())

  // Extrusion pushes along +Z. This stands the buildings up along +Y.
  city.rotateX(-Math.PI / 2)
  city.computeBoundingSphere()

  console.info(
    `[buildings] built ${buildings.length} buildings, ${city.attributes.position.count / 3} triangles`,
  )
  return city
}

export function Buildings({ buildings }: { buildings: PolygonFeature[] }) {
  const geometry = useMemo(
    () => createCityGeometry(buildings.filter((b) => isRingInPlayArea(b.geometry.coordinates[0]))),
    [buildings],
  )

  const { windows } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const facade = useMemo(() => createFacadeTexture(), [])

  // We created these by hand, so R3F won't free their GPU memory for us.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => facade.dispose(), [facade])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {/* The key makes a new material, as a material can't gain or lose a texture freely. */}
      <meshStandardMaterial
        key={String(windows)}
        map={windows ? facade : null}
        vertexColors
        roughness={0.9}
      />
    </mesh>
  )
}
