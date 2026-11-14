import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { getRoadWidth } from './roadData'
import { PAVEMENT_WIDTH } from './surface'
import type { MapData } from './mapData'
import {
  isRingInPlayArea,
  lonLatToWorld,
  PLAY_AREA,
  PLAY_AREA_DEPTH,
  PLAY_AREA_WIDTH,
  type LonLat,
} from './worldUtils'
import { windUniforms } from './wind'

/** The square of grass around the rider, in metres. It moves with them. */
const FIELD_SIZE = 90
/** Each tuft is a star of cards, each showing a different photographed clump. */
const CARDS_PER_TUFT = 4
const CARD_WIDTH = 0.8
const CARD_HEIGHT = 0.42
/** Where each clump sits on the image, as [left, top, right, bottom] from 0 to 1. */
const CLUMPS = [
  [0.2, 0.745, 0.48, 0.92],
  [0.6, 0.76, 0.8, 0.885],
  [0.0, 0.87, 0.19, 0.995],
  [0.27, 0.885, 0.5, 0.995],
  [0.58, 0.835, 0.78, 0.995],
]
/** The map of where grass grows has this many pixels per metre. */
const MASK_SCALE = 1
/** On that map: full density in parks, thinner on open ground, and none on black. */
const PARK_DENSITY = 255
const OPEN_GROUND_DENSITY = 95
const PATH_WIDTH = 2.5

// The photo is dark, so these go above 1 to lift it. The roots stay darker than the tips.
const BASE_COLOR = new THREE.Color(1.1, 1.25, 0.8)
const TIP_COLOR = new THREE.Color(2.3, 2.5, 1.6)

const uniforms = {
  uRider: { value: new THREE.Vector2() },
  uMask: { value: null as THREE.Texture | null },
  ...windUniforms,
}

function toMask(position: LonLat): [number, number] {
  const [x, , z] = lonLatToWorld(position)
  return [(x - PLAY_AREA.minX) * MASK_SCALE, (z - PLAY_AREA.minZ) * MASK_SCALE]
}

function traceOutline(context: CanvasRenderingContext2D, points: LonLat[]) {
  context.beginPath()
  points.forEach((point, index) => {
    const [x, y] = toMask(point)
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
}

/**
 * A top-down map of where grass may grow, drawn once. A shader can't look up
 * roads or buildings, but it can read an image, so each tuft checks this.
 */
function createGrassMask(data: MapData): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = PLAY_AREA_WIDTH * MASK_SCALE
  canvas.height = PLAY_AREA_DEPTH * MASK_SCALE

  const context = canvas.getContext('2d')
  if (context) {
    const shade = (value: number) => `rgb(${value} ${value} ${value})`
    context.fillStyle = shade(OPEN_GROUND_DENSITY)
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.fillStyle = shade(PARK_DENSITY)
    for (const park of data.parks) {
      traceOutline(context, park.geometry.coordinates[0])
      context.fill()
    }

    context.strokeStyle = '#000000'
    context.fillStyle = '#000000'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const road of data.roads) {
      context.lineWidth = (getRoadWidth(road) + PAVEMENT_WIDTH * 2) * MASK_SCALE
      traceOutline(context, road.geometry.coordinates)
      context.stroke()
    }

    context.lineWidth = PATH_WIDTH * MASK_SCALE
    for (const path of data.footways) {
      traceOutline(context, path.geometry.coordinates)
      context.stroke()
    }

    context.lineWidth = 1.5 * MASK_SCALE
    for (const building of data.buildings) {
      const ring = building.geometry.coordinates[0]
      if (!isRingInPlayArea(ring)) continue
      traceOutline(context, ring)
      context.fill()
      context.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.generateMipmaps = false
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  return texture
}

/** One tuft: photographed clumps on cards that cross in the middle, seen well from any side. */
function createTuftGeometry(count: number): THREE.InstancedBufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  const add = (x: number, y: number, z: number, u: number, v: number, color: THREE.Color) => {
    positions.push(x, y, z)
    uvs.push(u, v)
    colors.push(color.r, color.g, color.b)
    // Facing up, so that blades are lit like the ground around them.
    normals.push(0, 1, 0)
  }

  for (let card = 0; card < CARDS_PER_TUFT; card++) {
    const angle = (card / CARDS_PER_TUFT) * Math.PI + card * 0.4
    const sideX = (Math.cos(angle) * CARD_WIDTH) / 2
    const sideZ = (Math.sin(angle) * CARD_WIDTH) / 2
    const [left, top, right, bottom] = CLUMPS[card % CLUMPS.length]
    // Images count from the bottom, so 1 minus each row.
    const low = 1 - bottom
    const high = 1 - top

    add(-sideX, 0, -sideZ, left, low, BASE_COLOR)
    add(sideX, 0, sideZ, right, low, BASE_COLOR)
    add(sideX, CARD_HEIGHT, sideZ, right, high, TIP_COLOR)
    add(-sideX, 0, -sideZ, left, low, BASE_COLOR)
    add(sideX, CARD_HEIGHT, sideZ, right, high, TIP_COLOR)
    add(-sideX, CARD_HEIGHT, -sideZ, left, high, TIP_COLOR)
  }

  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))

  // Each tuft's place in the field, and a random number of its own.
  const roots = new Float32Array(count * 3)
  for (let tuft = 0; tuft < count; tuft++) {
    roots.set([Math.random() * FIELD_SIZE, Math.random() * FIELD_SIZE, Math.random()], tuft * 3)
  }
  geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 3))
  geometry.instanceCount = count
  return geometry
}

/**
 * All the tufts stay in a square around the rider, and the shader wraps any
 * that fall behind round to the front, so JavaScript never has to move them.
 */
function addGrassMovement(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = `
    attribute vec3 aRoot;
    uniform vec2 uRider;
    uniform sampler2D uMask;
    uniform float uWindPhase;
    uniform float uWindStrength;
    ${shader.vertexShader}
  `.replace(
    '#include <begin_vertex>',
    `
    vec2 fromRider = mod(aRoot.xy - uRider, ${FIELD_SIZE.toFixed(1)}) - ${(FIELD_SIZE / 2).toFixed(1)};
    vec2 root = fromRider + uRider;

    // The image's top row is the world's lowest z, and its v runs the other way.
    vec2 maskUv = vec2(
      (root.x - (${PLAY_AREA.minX.toFixed(1)})) / ${PLAY_AREA_WIDTH.toFixed(1)},
      1.0 - (root.y - (${PLAY_AREA.minZ.toFixed(1)})) / ${PLAY_AREA_DEPTH.toFixed(1)}
    );
    bool onMap = maskUv.x > 0.0 && maskUv.x < 1.0 && maskUv.y > 0.0 && maskUv.y < 1.0;
    float density = onMap ? texture2D(uMask, maskUv).r : 0.0;

    // Tufts shrink to nothing at the field's edge, so nobody sees them wrap around.
    float fade = 1.0 - smoothstep(0.7, 1.0, length(fromRider) / ${(FIELD_SIZE / 2).toFixed(1)});
    float size = step(aRoot.z, density) * fade * (0.7 + aRoot.z * 0.6);

    // Each tuft turns a different way, so that the same clumps don't line up.
    float turn = aRoot.z * 40.0;
    vec3 transformed = vec3(
      position.x * cos(turn) - position.z * sin(turn),
      position.y,
      position.x * sin(turn) + position.z * cos(turn)
    ) * size;
    float sway = sin(uWindPhase * 1.6 + root.x * 0.4 + root.y * 0.3) * (0.03 + uWindStrength * 0.1);
    transformed.xz += sway * position.y * 1.6;
    transformed.xz += root;
    `,
  )

  // Normally a surface's back is lit as if it faced the other way, which would
  // turn half the blades black. Here, both sides use the upward direction.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_begin>',
    `float faceDirection = 1.0;
    vec3 normal = normalize(vNormal);
    vec3 nonPerturbedNormal = normal;`,
  )
}

const GRASS_TEXTURES = ['/textures/grass-color.jpg', '/textures/grass-alpha.jpg']
const GRASS_CUTOFF = 0.4

function prepareGrassTextures([color]: THREE.Texture[]) {
  color.colorSpace = THREE.SRGBColorSpace
}

/** Swaying tufts of grass near the rider. */
export function GrassField({ data }: { data: MapData }) {
  const { grassTufts } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const mask = useMemo(() => createGrassMask(data), [data])
  const geometry = useMemo(() => createTuftGeometry(grassTufts), [grassTufts])
  const [color, alpha] = useTexture(GRASS_TEXTURES, prepareGrassTextures)

  useEffect(() => {
    uniforms.uMask.value = mask
    return () => mask.dispose()
  }, [mask])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    uniforms.uRider.value.set(livePlayer.x, livePlayer.z)
  })

  if (grassTufts === 0) return null

  return (
    <mesh geometry={geometry} frustumCulled={false} receiveShadow>
      <meshStandardMaterial
        vertexColors
        map={color}
        alphaMap={alpha}
        alphaTest={GRASS_CUTOFF}
        roughness={1}
        side={THREE.DoubleSide}
        onBeforeCompile={addGrassMovement}
      />
    </mesh>
  )
}
