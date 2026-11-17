import { useCallback, useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { getStreetReflection } from '../traffic/carModel'
import { pushSmoothTriangle, squareFor, toBlockGeometries, type Square } from './blocks'
import { StreamedChunks } from './StreamedChunks'
import { chunkKey } from './chunks'
import { QuadBuilder } from './quads'
import { BREAKER, breakerHeight, water, type RoadFeatures, type RoadPatch, type SpeedBreaker } from './roadFeatures'
import { ROAD_HEIGHT } from './surface'

/** Breakers, potholes and puddles are small, so they're only drawn this close, in metres. */
const BREAKER_DISTANCE = 220
const PATCH_DISTANCE = 120

/** A breaker is painted in stripes this wide, across the road. */
const STRIPE = 0.55
const STRIPE_COLORS = [new THREE.Color('#d9a826'), new THREE.Color('#2a2b2e')]
/** Slices along its depth, so the hump is smooth. */
const HUMP_STEPS = 8
/** Just above the road, so the two never flicker. */
const LIFT = 0.004

/** Puddles fill over this many seconds of rain, and take this long to dry. */
const FILL_TIME = 14
const DRY_TIME = 70

/** The top of one breaker: a smooth hump across the road, in painted stripes. */
function pushBreaker(square: Square, breaker: SpeedBreaker) {
  const { x, z, alongX, alongZ, halfWidth } = breaker
  const point = (along: number, across: number) =>
    new THREE.Vector3(x + alongX * along + alongZ * across, ROAD_HEIGHT + breakerHeight(along) + LIFT, z + alongZ * along - alongX * across)
  const normal = (along: number) => {
    // The hump's slope along the road tips the normal forwards or back.
    const slope = (breakerHeight(along + 0.01) - breakerHeight(along - 0.01)) / 0.02
    return new THREE.Vector3(-alongX * slope, 1, -alongZ * slope).normalize()
  }
  const stripes = Math.max(1, Math.round((halfWidth * 2) / STRIPE))
  for (let stripe = 0; stripe < stripes; stripe++) {
    const from = -halfWidth + (stripe / stripes) * halfWidth * 2
    const to = -halfWidth + ((stripe + 1) / stripes) * halfWidth * 2
    // Each breaker's paint is a little worn, in its own way.
    const wear = 0.82 + ((stripe * 7 + Math.abs(Math.round(x * 3))) % 5) * 0.04
    const color = STRIPE_COLORS[stripe % 2].clone().multiplyScalar(wear)
    for (let step = 0; step < HUMP_STEPS; step++) {
      const a = -BREAKER.halfDepth + (step / HUMP_STEPS) * BREAKER.halfDepth * 2
      const b = -BREAKER.halfDepth + ((step + 1) / HUMP_STEPS) * BREAKER.halfDepth * 2
      pushSmoothTriangle(square, [point(a, from), point(b, from), point(b, to)], [normal(a), normal(b), normal(b)], color)
      pushSmoothTriangle(square, [point(a, from), point(b, to), point(a, to)], [normal(a), normal(b), normal(a)], color)
    }
  }
}

function createBreakerGeometries(breakers: SpeedBreaker[]): THREE.BufferGeometry[] {
  const squares = new Map<number, Square>()
  for (const breaker of breakers) pushBreaker(squareFor(squares, breaker.x, breaker.z), breaker)
  return toBlockGeometries(squares)
}

/** Four shapes share one image, two across and two down. */
const PATCH_CELL = 128

/**
 * Draws four rough round shapes into one image. Potholes: broken tarmac, darker
 * in the middle, with a ragged edge and loose grit. Puddles: a soft-edged blob,
 * used only for its shape, as the water's look comes from the material.
 */
function createPatchTexture(kind: 'pothole' | 'puddle'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = PATCH_CELL * 2
  canvas.height = PATCH_CELL * 2
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not draw the road patches')
  let seed = kind === 'pothole' ? 11 : 29
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

  for (let shape = 0; shape < 4; shape++) {
    const middleX = (shape % 2) * PATCH_CELL + PATCH_CELL / 2
    const middleY = Math.floor(shape / 2) * PATCH_CELL + PATCH_CELL / 2
    // A ragged outline: a circle whose radius wanders.
    const outline = (scale: number) => {
      context.beginPath()
      const points = 22
      for (let point = 0; point <= points; point++) {
        const angle = (point / points) * Math.PI * 2
        const wobble = kind === 'pothole' ? 0.72 + random() * 0.28 : 0.8 + Math.sin(angle * 3 + shape) * 0.12 + random() * 0.08
        const radius = PATCH_CELL * 0.46 * wobble * scale
        context.lineTo(middleX + Math.cos(angle) * radius, middleY + Math.sin(angle) * radius)
      }
      context.closePath()
    }
    if (kind === 'puddle') {
      context.filter = 'blur(3px)'
      context.fillStyle = '#ffffff'
      outline(0.92)
      context.fill()
      context.filter = 'none'
      continue
    }
    // A rim of broken tarmac with the pale stone showing, then the dark hollow, then grit in it.
    context.fillStyle = '#8a857b'
    outline(1)
    context.fill()
    context.fillStyle = '#4a4741'
    outline(0.84)
    context.fill()
    context.fillStyle = '#161514'
    outline(0.66)
    context.fill()
    for (let grain = 0; grain < 90; grain++) {
      const angle = random() * Math.PI * 2
      const distance = random() * PATCH_CELL * 0.3
      context.fillStyle = random() < 0.5 ? '#6d685f' : '#0d0c0c'
      context.fillRect(middleX + Math.cos(angle) * distance, middleY + Math.sin(angle) * distance, 2, 2)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = kind === 'pothole' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.anisotropy = 4
  return texture
}

/** Flat patches lying on the road, each with one of the four shapes, turned its own way. */
function createPatchGeometries(patches: RoadPatch[], size: number, height: number): THREE.BufferGeometry[] {
  const builder = new QuadBuilder()
  const up = new THREE.Vector3(0, 1, 0)
  for (const { x, z, radius, rotation, variation } of patches) {
    const half = radius * size
    const cos = Math.cos(rotation) * half
    const sin = Math.sin(rotation) * half
    const corner = (a: number, b: number) => new THREE.Vector3(x + cos * a - sin * b, height, z + sin * a + cos * b)
    const shape = Math.floor(variation * 3.999)
    const u = (shape % 2) / 2
    const v = 0.5 - Math.floor(shape / 2) / 2
    builder.quad([corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)], up, [u, v, u + 0.5, v + 0.5])
  }
  return builder.toGeometries()
}

/** Puddles fill while it rains and dry slowly after, and show as they fill. */
function updateWater(puddle: THREE.MeshStandardMaterial, dt: number) {
  const rain = liveSky.rain
  const time = rain > water.level ? FILL_TIME : DRY_TIME
  water.level += (rain - water.level) * (1 - Math.exp(-dt / time))
  puddle.opacity = Math.min(1, water.level * 1.4) * 0.9
  puddle.envMapIntensity = liveSky.look.ambientIntensity * 1.2
}

/**
 * Speed breakers, potholes and, in the rain, puddles. The breakers and potholes
 * are also in the road's height (`Surface`), so the wheels ride over and into
 * them. Puddles fade in as the rain fills them (`water.level`), and shine,
 * reflecting the street like the wet road does.
 */
export function RoadDetails({ features }: { features: RoadFeatures }) {
  const gl = useThree((state) => state.gl)
  const reflection = getStreetReflection(gl)

  // Built a map square at a time, near the rider first (StreamedChunks.tsx).
  const squares = useMemo(() => {
    const byKey = new Map<number, { breakers: SpeedBreaker[]; potholes: RoadPatch[]; puddles: RoadPatch[] }>()
    const square = (x: number, z: number) => {
      const key = chunkKey(x, z)
      let found = byKey.get(key)
      if (!found) byKey.set(key, (found = { breakers: [], potholes: [], puddles: [] }))
      return found
    }
    for (const breaker of features.breakers) square(breaker.x, breaker.z).breakers.push(breaker)
    for (const pothole of features.potholes) square(pothole.x, pothole.z).potholes.push(pothole)
    for (const puddle of features.puddles) square(puddle.x, puddle.z).puddles.push(puddle)
    return byKey
  }, [features])
  const keys = useMemo(() => [...squares.keys()], [squares])
  const build = useCallback(
    (key: number) => {
      const { breakers = [], potholes = [], puddles = [] } = squares.get(key) ?? {}
      return [
        createBreakerGeometries(breakers)[0] ?? null,
        // A pothole's picture is a little bigger than its hollow, for the broken edge round it.
        createPatchGeometries(potholes, 1.25, ROAD_HEIGHT + LIFT)[0] ?? null,
        createPatchGeometries(puddles, 1.1, ROAD_HEIGHT + LIFT * 2)[0] ?? null,
      ]
    },
    [squares],
  )

  const materials = useMemo(
    () => ({
      breaker: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      pothole: new THREE.MeshStandardMaterial({
        map: createPatchTexture('pothole'),
        transparent: true,
        alphaTest: 0.05,
        roughness: 0.95,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      puddle: new THREE.MeshStandardMaterial({
        color: '#2a3136',
        alphaMap: createPatchTexture('puddle'),
        transparent: true,
        opacity: 0,
        roughness: 0.04,
        metalness: 0.85,
        envMap: reflection,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    }),
    [reflection],
  )

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) {
        material.map?.dispose()
        material.alphaMap?.dispose()
        material.dispose()
      }
    },
    [materials],
  )

  useFrame((_, delta) => updateWater(materials.puddle, Math.min(delta, 0.1)))

  const layers = useMemo(
    () => [
      { material: materials.breaker, maxDistance: BREAKER_DISTANCE },
      { material: materials.pothole, maxDistance: PATCH_DISTANCE },
      { material: materials.puddle, maxDistance: PATCH_DISTANCE },
    ],
    [materials],
  )
  // Nothing here is drawn past the breakers' distance, so further squares needn't be built.
  return <StreamedChunks keys={keys} build={build} layers={layers} reach={Math.max(BREAKER_DISTANCE, PATCH_DISTANCE)} />
}
