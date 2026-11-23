import { useCallback, useEffect, useMemo } from 'react'
import { WALL_BUMP_MAPS, WALL_COLOR_PHOTOS } from './assetUrls'
import { useCompressedTextures } from './ktx2'
import { useTexture } from '@react-three/drei'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { APARTMENT_COLORS, FLOOR_HEIGHT, getFloors, hashString, hasStilts, HOUSE_COLORS } from './buildingData'
import type { BuildingKind } from './buildingKinds'
import { StreamedChunks } from './StreamedChunks'
import { chunkKey } from './chunks'
import { createFacadeTextures, FACADE_LOOKS, type FacadeLook } from './facadeTextures'
import type { BuildingFeature } from './mapData'
import { addWeathering } from './weathering'
import { isRingInPlayArea, lonLatToLocal, type LonLat } from './worldUtils'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

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
    // HSR's own palette, shared with the house kit so balconies match their walls.
    colors: toColors(HOUSE_COLORS),
  },
  apartment: {
    ground: 'stilts',
    upper: 'apartment',
    colors: toColors(APARTMENT_COLORS),
  },
  // Shops are houses with shops on the ground floor, so they're painted the same upstairs.
  shop: {
    ground: 'shopfront',
    upper: 'house',
    colors: toColors(HOUSE_COLORS),
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
  // Not drawn here: Temples.tsx draws places of worship whole.
  temple: {
    ground: 'civic',
    upper: 'civic',
    colors: toColors(['#f2ead8']),
  },
}

/** Where each look's windows are across a bay, for the streaks that run down from their sills (see facadeTextures.ts). */
const WINDOW_SPANS: Partial<Record<FacadeLook, [number, number]>> = {
  house: [0.27, 0.73],
  apartment: [0.16, 0.84],
  shopFloors: [0.1, 0.9],
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
function applyFacadeMapping(geometry: THREE.BufferGeometry, color: THREE.Color, bayWidth: number, weather: number, variant: number) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const uvs = new Float32Array(position.count * 2)
  const colors = new Float32Array(position.count * 3)
  // How weathered this building is, for the shader (weathering.ts): some are freshly painted, some not for years.
  geometry.setAttribute('aWeather', new THREE.BufferAttribute(new Float32Array(position.count).fill(weather), 1))
  // Which of its look's window designs this building has (facadeTextures.ts' `variants`).
  geometry.setAttribute('aVariant', new THREE.BufferAttribute(new Float32Array(position.count).fill(variant), 1))
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
  weather: number,
  pick: number,
): BuildingPart {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: (toFloor - fromFloor) * FLOOR_HEIGHT,
    bevelEnabled: false,
  })
  geometry.translate(0, 0, fromFloor * FLOOR_HEIGHT)
  applyFacadeMapping(geometry, color, FACADE_LOOKS[look].bayWidth, weather, pick % (FACADE_LOOKS[look].variants?.length ?? 1))
  return { look, geometry }
}

function createBuildingParts(building: BuildingFeature): BuildingPart[] {
  const [outerRing, ...holes] = building.geometry.coordinates

  const shape = new THREE.Shape(toRing(outerRing))
  shape.holes = holes.map((hole) => new THREE.Path(toRing(hole)))

  const { ground, upper, colors } = KIND_STYLES[building.kind]
  const hash = hashString(building.id)
  const color = colors[hash % colors.length]
  const weather = ((hash >>> 8) % 1000) / 1000
  const floors = getFloors(building)

  // On stilts the ground floor is open: pillars and parking from the house kit, under the floors above.
  // Its own window design, from another part of its number than its colour, so the two don't go together.
  const pick = (hash >>> 18) % 12
  if (hasStilts(building)) return [createFloors(shape, 1, floors, upper, color, weather, pick)]
  if (ground === upper || floors <= 1) return [createFloors(shape, 0, floors, ground, color, weather, pick)]
  return [
    createFloors(shape, 0, 1, ground, color, weather, pick),
    createFloors(shape, 1, floors, upper, color, weather, pick),
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

/** Every look, in a fixed order: a streamed square makes one shape per look (see StreamedChunks.tsx). */
const LOOKS = Object.keys(FACADE_LOOKS) as FacadeLook[]

/** The buildings in each map square, by the square their first corner is in. */
function groupBySquare(buildings: BuildingFeature[]): Map<number, BuildingFeature[]> {
  const squares = new Map<number, BuildingFeature[]>()
  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    if (!isRingInPlayArea(ring) || building.kind === 'temple') continue
    const [east, north] = lonLatToLocal(ring[0])
    const key = chunkKey(east, -north)
    const list = squares.get(key)
    if (list) list.push(building)
    else squares.set(key, [building])
  }
  return squares
}

/**
 * One square's buildings, as one merged shape per look (null where it has none), as one draw
 * call can only use one material. With `plain` set there are no textures to tell the looks apart,
 * so everything goes in the plain house look and no extra draw calls are spent.
 */
function buildSquare(buildings: BuildingFeature[], plain: boolean): (THREE.BufferGeometry | null)[] {
  const byLook = new Map<FacadeLook, THREE.BufferGeometry[]>()
  for (const building of buildings) {
    for (const part of createBuildingParts(building)) {
      const look = plain ? 'house' : part.look
      const list = byLook.get(look)
      if (list) list.push(part.geometry)
      else byLook.set(look, [part.geometry])
    }
  }
  return LOOKS.map((look) => {
    const parts = byLook.get(look)
    return parts ? createBlockGeometry(parts) : null
  })
}

/** Bumps have to repeat with the wall. The colour photos are only copied onto a canvas. */
function prepareWallPhotos(textures: THREE.Texture[]) {
  for (const texture of textures) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  }
}

/**
 * Lets one wall material show several window designs. The look's image has its designs stacked
 * (`count` of them, facadeTextures.ts); each building says which is its own in `aVariant`, and
 * the wall's colour is read from that band of the image: the bay and floor repeat within the
 * band, with the smoothing worked out from the unbroken coordinates, so there's no seam where
 * they wrap. One draw call and one texture per look, as before.
 */
function addWindowVariants(material: THREE.MeshStandardMaterial, count: number) {
  if (count <= 1) return
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader.replace('void main() {', 'attribute float aVariant;\nvarying float vVariant;\nvoid main() {\n  vVariant = aVariant;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vVariant;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec2 bayUv = vec2(vMapUv.x, (fract(vMapUv.y) + floor(vVariant + 0.5)) / ${count.toFixed(1)});
          vec4 sampledDiffuseColor = textureGrad(map, bayUv, dFdx(vMapUv), dFdy(vMapUv) / ${count.toFixed(1)});
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
  }
  const previousKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${previousKey()}|variants:${count}`
}

function updateWindowGlow(material: THREE.MeshStandardMaterial) {
  material.emissiveIntensity = liveSky.look.night * WINDOW_GLOW
}

export function Buildings({ buildings }: { buildings: BuildingFeature[] }) {
  const { windows, surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const squares = useMemo(() => groupBySquare(buildings), [buildings])
  const keys = useMemo(() => [...squares.keys()], [squares])
  // Built a square at a time, near the rider first (StreamedChunks.tsx).
  const build = useCallback((key: number) => buildSquare(squares.get(key) ?? [], !windows), [squares, windows])

  const [plaster, concrete, brick] = useTexture(WALL_COLOR_PHOTOS, prepareWallPhotos)
  const [plasterBumps, concreteBumps, brickBumps] = useCompressedTextures(WALL_BUMP_MAPS, prepareWallPhotos)
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
      LOOKS.map((look) => {
        const { base, bumpy, roughness } = FACADE_LOOKS[look]
        const { facade, lights } = textures[look]
        const bumps = { plaster: plasterBumps, concrete: concreteBumps, brick: brickBumps }[base]

        const material = new THREE.MeshStandardMaterial({
          map: windows ? facade : null,
          normalMap: surfaces === 'bumps' && bumpy ? bumps : null,
          normalScale: new THREE.Vector2(WALL_BUMP_STRENGTH, WALL_BUMP_STRENGTH),
          emissive: windows ? '#ffffff' : '#000000',
          emissiveMap: windows ? lights : null,
          emissiveIntensity: 0,
          vertexColors: true,
          roughness,
        })
        // Streaks follow the windows, so only where they're drawn.
        addWeathering(material, { streaks: windows ? WINDOW_SPANS[look] : null })
        if (windows) addWindowVariants(material, FACADE_LOOKS[look].variants?.length ?? 1)
        return material
      }),
    [windows, surfaces, textures, plasterBumps, concreteBumps, brickBumps],
  )

  useFrame(() => materials.forEach(updateWindowGlow))

  const layers = useMemo(() => materials.map((material) => ({ material, castShadow: true })), [materials])
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  return <StreamedChunks keys={keys} build={build} layers={layers} />
}
