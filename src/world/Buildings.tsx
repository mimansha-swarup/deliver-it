import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PolygonFeature } from './mapData'
import { isInsidePlayArea, lonLatToLocal, type LonLat } from './worldUtils'

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

function createBuildingGeometry(building: PolygonFeature): THREE.BufferGeometry {
  const [outerRing, ...holes] = building.geometry.coordinates

  const shape = new THREE.Shape(toRing(outerRing))
  shape.holes = holes.map((hole) => new THREE.Path(toRing(hole)))

  const floors = getFloors(building, Math.abs(THREE.ShapeUtils.area(shape.getPoints())))
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: floors * FLOOR_HEIGHT,
    bevelEnabled: false,
  })

  // Every corner of this building gets the same colour. Storing colour on the
  // geometry is what lets all buildings share a single material.
  const color = WALL_COLORS[hashString(building.id) % WALL_COLORS.length]
  const vertexCount = geometry.attributes.position.count
  const colors = new Float32Array(vertexCount * 3)
  for (let i = 0; i < vertexCount; i++) {
    color.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // There are no textures yet, so texture coordinates would be wasted memory.
  geometry.deleteAttribute('uv')
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

function isBuildingInPlayArea(building: PolygonFeature): boolean {
  const ring = building.geometry.coordinates[0].slice(0, -1)
  const lon = ring.reduce((sum, [pointLon]) => sum + pointLon, 0) / ring.length
  const lat = ring.reduce((sum, [, pointLat]) => sum + pointLat, 0) / ring.length
  return isInsidePlayArea([lon, lat])
}

export function Buildings({ buildings }: { buildings: PolygonFeature[] }) {
  const geometry = useMemo(
    () => createCityGeometry(buildings.filter(isBuildingInPlayArea)),
    [buildings],
  )

  // We created this geometry by hand, so R3F won't free its GPU memory for us.
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.9} />
    </mesh>
  )
}
