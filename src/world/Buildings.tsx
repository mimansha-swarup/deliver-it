import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { PolygonFeature } from './mapData'
import { FLOOR_HEIGHT, getFloors, hashString } from './buildingData'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { isRingInPlayArea, lonLatToLocal, type LonLat } from './worldUtils'


const WALL_COLORS = [
  '#e8e0d0', // off-white
  '#efe3bf', // cream
  '#e6c9a8', // sand
  '#d9b8ae', // dusty pink
  '#b9c7cc', // pale blue-grey
  '#c9c5bb', // concrete
  '#d6a184', // terracotta
].map((color) => new THREE.Color(color))

/** Resolution of one window bay, in pixels. */
const FACADE_SIZE = 512
/** How pale the wall photo ends up, and how much of its staining survives. */
const PLASTER_BRIGHTNESS = 0.94
const PLASTER_CONTRAST = 0.75
const WALL_BUMP_STRENGTH = 0.7

/** Width of one window and the wall around it, in metres. */
const WINDOW_BAY_WIDTH = 3.4
const ROOF_SHADE = 0.8
/** How far the pattern of lit windows runs before it repeats. */
const WINDOW_PATTERN_BAYS = 5
const WINDOW_PATTERN_FLOORS = 4
const LIT_WINDOW_SHARE = 0.45
const WINDOW_GLOW = 0.7
/** A spot on the texture that's plain wall, used for roofs. */
const PLAIN_SPOT = 0.02

/**
 * Strips the colour from a wall photo and lifts it close to white, keeping only
 * its stains and patches. That way, each building's own paint shows through.
 */
function createPlasterCanvas(photo: CanvasImageSource, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return canvas

  context.drawImage(photo, 0, 0, size, size)
  const image = context.getImageData(0, 0, size, size)
  const { data } = image

  let total = 0
  for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2]
  const average = total / (data.length / 4)

  for (let i = 0; i < data.length; i += 4) {
    const shade = (data[i] + data[i + 1] + data[i + 2]) / average
    const value = Math.min(255, 255 * (PLASTER_BRIGHTNESS + (shade - 1) * PLASTER_CONTRAST))
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * One window bay, drawn in code over the plaster. The wall stays pale, so the
 * building's own colour shows through, and every wall repeats this image.
 */
function createFacadeTexture(photo: CanvasImageSource): THREE.CanvasTexture {
  const size = FACADE_SIZE
  const canvas = createPlasterCanvas(photo, size)

  const context = canvas.getContext('2d')
  if (context) {
    /** All these measurements are in a 128-unit square, so they don't depend on `size`. */
    context.scale(size / 128, size / 128)

    // A slightly darker band where each floor meets the next.
    context.fillStyle = 'rgb(0 0 0 / 14%)'
    context.fillRect(0, 122, 128, 6)

    // Grime that has run down from the sill, fading out.
    const grime = context.createLinearGradient(0, 96, 0, 122)
    grime.addColorStop(0, 'rgb(40 34 28 / 24%)')
    grime.addColorStop(1, 'rgb(40 34 28 / 0%)')
    context.fillStyle = grime
    context.fillRect(32, 96, 64, 26)

    // Frame, then glass, which is lighter towards the top where it catches the sky.
    context.fillStyle = '#6f6d68'
    context.fillRect(34, 26, 60, 66)
    const glass = context.createLinearGradient(0, 30, 0, 88)
    glass.addColorStop(0, '#70869a')
    glass.addColorStop(1, '#2c3843')
    context.fillStyle = glass
    context.fillRect(38, 30, 52, 58)

    // A shadow cast on the glass by the top of the frame, then the middle bar.
    context.fillStyle = 'rgb(0 0 0 / 32%)'
    context.fillRect(38, 30, 52, 4)
    context.fillStyle = '#6f6d68'
    context.fillRect(62, 30, 4, 58)

    // A sill with a shadow under it.
    context.fillStyle = '#c4c2bb'
    context.fillRect(30, 92, 68, 4)
    context.fillStyle = 'rgb(0 0 0 / 30%)'
    context.fillRect(30, 96, 68, 2)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * Which windows are lit at night. It covers several bays and floors before it
 * repeats, so that not every window is on. Black parts don't glow at all.
 */
function createWindowLightTexture(): THREE.CanvasTexture {
  const bay = 64
  const canvas = document.createElement('canvas')
  canvas.width = bay * WINDOW_PATTERN_BAYS
  canvas.height = bay * WINDOW_PATTERN_FLOORS

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    for (let column = 0; column < WINDOW_PATTERN_BAYS; column++) {
      for (let row = 0; row < WINDOW_PATTERN_FLOORS; row++) {
        const roll = hashString(`${column},${row}`) / 4294967296
        if (roll > LIT_WINDOW_SHARE) continue

        // These match the glass in the facade texture, at half its size.
        context.fillStyle = roll < LIT_WINDOW_SHARE / 3 ? '#ffe9b0' : '#ffc66e'
        context.fillRect(column * bay + 19, row * bay + 15, 26, 29)
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.repeat.set(1 / WINDOW_PATTERN_BAYS, 1 / WINDOW_PATTERN_FLOORS)
  return texture
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

  const floors = getFloors(building)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: floors * FLOOR_HEIGHT,
    bevelEnabled: false,
  })

  const color = WALL_COLORS[hashString(building.id) % WALL_COLORS.length]
  applyFacadeMapping(geometry, color)
  return geometry
}

/** Combines buildings into one geometry, so the GPU draws them in one call. */
function createBlockGeometry(buildings: PolygonFeature[]): THREE.BufferGeometry {
  const parts = buildings.map(createBuildingGeometry)
  const block = mergeGeometries(parts)
  if (!block) throw new Error('Could not merge building geometries')

  parts.forEach((part) => part.dispose())

  // Extrusion pushes along +Z. This stands the buildings up along +Y.
  block.rotateX(-Math.PI / 2)
  block.computeBoundingSphere()
  return block
}

/** One merged geometry per map square, so each square can be skipped on its own. */
function createCityGeometries(buildings: PolygonFeature[]): THREE.BufferGeometry[] {
  const squares = new Map<number, PolygonFeature[]>()

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue

    const [east, north] = lonLatToLocal(ring[0])
    const key = chunkKey(east, -north)
    const square = squares.get(key)
    if (square) square.push(building)
    else squares.set(key, [building])
  }

  return [...squares.values()].map(createBlockGeometry)
}

function prepareWallBumps([, bumps]: THREE.Texture[]) {
  bumps.wrapS = THREE.RepeatWrapping
  bumps.wrapT = THREE.RepeatWrapping
}

function updateWindowGlow(material: THREE.MeshStandardMaterial) {
  material.emissiveIntensity = liveSky.look.night * WINDOW_GLOW
}

export function Buildings({ buildings }: { buildings: PolygonFeature[] }) {
  const geometries = useMemo(() => createCityGeometries(buildings), [buildings])

  const { windows, surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const [wallPhoto, wallBumps] = useTexture(
    ['/textures/wall-color.jpg', '/textures/wall-normal.jpg'],
    prepareWallBumps,
  )
  const facade = useMemo(() => createFacadeTexture(wallPhoto.image as HTMLImageElement), [wallPhoto])

  // We created these by hand, so R3F won't free their GPU memory for us.
  const windowLights = useMemo(() => createWindowLightTexture(), [])

  useEffect(() => () => facade.dispose(), [facade])
  useEffect(() => () => windowLights.dispose(), [windowLights])

  // A new material each time, as a material can't gain or lose a texture freely.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: windows ? facade : null,
        normalMap: surfaces === 'bumps' ? wallBumps : null,
        normalScale: new THREE.Vector2(WALL_BUMP_STRENGTH, WALL_BUMP_STRENGTH),
        emissive: windows ? '#ffffff' : '#000000',
        emissiveMap: windows ? windowLights : null,
        emissiveIntensity: 0,
        vertexColors: true,
        roughness: 0.9,
      }),
    [windows, surfaces, facade, windowLights, wallBumps],
  )

  useFrame(() => updateWindowGlow(material))

  return <ChunkedMesh geometries={geometries} material={material} castShadow />
}
