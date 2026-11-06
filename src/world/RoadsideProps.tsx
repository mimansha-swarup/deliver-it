import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { Prop, RoadsideProps as Props } from './props'

const TRUNK_COLOR = '#6f5a43'
const LAMP_COLOR = '#55585c'
const CANOPY_COLORS = [
  // Mostly greens...
  '#4f7a3a',
  '#5e8a3f',
  '#3f6d3b',
  '#6c9347',
  '#47803f',
  '#7a9c45',
  '#356339',
  '#588f4c',
  // ...and some in flower, like the city's gulmohar, tabebuia and jacaranda.
  '#d9542b',
  '#e3c23d',
  '#d77fa1',
  '#8e6fc1',
].map((color) => new THREE.Color(color))

/** The number of tree shapes. */
const TREE_KINDS = 3

const GLOW_COLOR = new THREE.Color('#ffc67a')
const GLOW_RADIUS = 7
const GLOW_HEIGHT = 0.12
const GLOW_SIDES = 16
/** Where the lamp's light lands, under the head at the end of its arm. */
const GLOW_OFFSET = 1.5

/** Shared by every tree, so one update moves them all. */
const windUniforms = {
  uWindPhase: { value: 0 },
  uWindStrength: { value: 0.3 },
}

/**
 * Adds a little GLSL to the standard material. Everything moves sideways, more
 * the higher up it is, and each tree starts at a different point in the sway.
 */
function addSway(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uWindPhase = windUniforms.uWindPhase
  shader.uniforms.uWindStrength = windUniforms.uWindStrength
  shader.vertexShader = `
    uniform float uWindPhase;
    uniform float uWindStrength;
    ${shader.vertexShader}
  `.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float treeOffset = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
      float bend = max(position.y - 1.0, 0.0);
      float amount = (0.012 + uWindStrength * 0.045) * bend;
      transformed.x += sin(uWindPhase + treeOffset) * amount;
      transformed.z += sin(uWindPhase * 0.7 + treeOffset * 1.7) * amount * 0.7;
      // A faster flutter, which differs from corner to corner, reads as leaves.
      transformed += sin(uWindPhase * 3.1 + position.x * 2.0 + position.y * 1.7 + treeOffset)
        * 0.02 * bend * uWindStrength;
    #endif`,
  )
}

/** The list of what's nearby is only rebuilt after the rider moves this far, in metres. */
const REFRESH_DISTANCE = 20

const transform = new THREE.Object3D()

function createTrunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3, 6)
  trunk.translate(0, 1.5, 0)
  return trunk
}

/** Rough balls, joined together, make a leafy outline from very few triangles. */
function createBlobs(blobs: [number, number, number, number][]): THREE.BufferGeometry {
  const parts = blobs.map(([x, y, z, radius]) => {
    const blob = new THREE.IcosahedronGeometry(radius, 0)
    blob.rotateY(x + z)
    blob.translate(x, y, z)
    return blob
  })

  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Could not merge canopy geometry')
  parts.forEach((part) => part.dispose())
  return merged
}

/** One shape for each kind of tree. Each has 80 triangles or fewer. */
function createCanopyGeometries(): THREE.BufferGeometry[] {
  return [
    // Round and full.
    createBlobs([
      [0, 4.5, 0, 2.1],
      [1.2, 3.8, 0.5, 1.5],
      [-1.1, 3.9, -0.7, 1.6],
      [0.1, 5.5, -0.3, 1.4],
    ]),
    // Tall and narrow.
    createBlobs([
      [0, 3.8, 0, 1.6],
      [0.2, 5.2, 0.1, 1.35],
      [-0.1, 6.4, -0.1, 1],
    ]),
    // Wide and flat, like a rain tree.
    createBlobs([
      [0, 4.7, 0, 1.9],
      [1.9, 4.4, 0.4, 1.5],
      [-1.8, 4.4, -0.5, 1.6],
      [0.3, 4.3, 1.8, 1.4],
    ]),
  ]
}

function createLampGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.06, 0.09, 6.5, 6)
  post.translate(0, 3.25, 0)
  post.deleteAttribute('uv')

  const arm = new THREE.BoxGeometry(1.6, 0.07, 0.07)
  arm.translate(0.8, 6.45, 0)
  arm.deleteAttribute('uv')

  const head = new THREE.BoxGeometry(0.5, 0.1, 0.18)
  head.translate(1.5, 6.4, 0)
  head.deleteAttribute('uv')

  const lamp = mergeGeometries([post.toNonIndexed(), arm.toNonIndexed(), head.toNonIndexed()])
  if (!lamp) throw new Error('Could not merge lamp geometry')
  return lamp
}

/** A soft pool of light on the ground, plus a bright spot at the lamp's head. */
function createLampGlowGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const add = (x: number, y: number, z: number, brightness: number) => {
    positions.push(x, y, z)
    colors.push(GLOW_COLOR.r * brightness, GLOW_COLOR.g * brightness, GLOW_COLOR.b * brightness)
  }

  for (let side = 0; side < GLOW_SIDES; side++) {
    const start = (side / GLOW_SIDES) * Math.PI * 2
    const end = ((side + 1) / GLOW_SIDES) * Math.PI * 2
    add(GLOW_OFFSET, GLOW_HEIGHT, 0, 0.3)
    add(GLOW_OFFSET + Math.cos(end) * GLOW_RADIUS, GLOW_HEIGHT, Math.sin(end) * GLOW_RADIUS, 0)
    add(GLOW_OFFSET + Math.cos(start) * GLOW_RADIUS, GLOW_HEIGHT, Math.sin(start) * GLOW_RADIUS, 0)
  }

  const pool = new THREE.BufferGeometry()
  pool.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  pool.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const head = new THREE.IcosahedronGeometry(0.2, 0)
  head.translate(GLOW_OFFSET, 6.33, 0)
  head.deleteAttribute('normal')
  head.deleteAttribute('uv')
  head.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(head.getAttribute('position').count * 3).fill(1), 3),
  )

  const merged = mergeGeometries([pool, head])
  if (!merged) throw new Error('Could not merge lamp glow geometry')
  pool.dispose()
  head.dispose()
  return merged
}

/**
 * Draws many copies of one shape in a single draw call. Each copy only needs a
 * transform matrix: its position, rotation and size packed into 16 numbers.
 *
 * Only copies near the rider are written into the list, and `count` tells the
 * GPU to stop there. In the title screen's aerial view, everything is drawn.
 */
function PropInstances({
  props,
  geometry,
  color,
  colors,
  sizeRange,
  sway = false,
  glow = false,
}: {
  props: Prop[]
  geometry: THREE.BufferGeometry
  color?: string
  colors?: THREE.Color[]
  sizeRange: number
  sway?: boolean
  /** Draws a light that adds to the scene and shows only at night. */
  glow?: boolean
}) {
  const { treeShadows, propDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const started = useGameStore((state) => state.started)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const glowMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const lastRefresh = useRef<{ x: number; z: number; reach: number } | null>(null)

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

    if (glowMaterial.current) {
      glowMaterial.current.opacity = liveSky.look.night
      instances.visible = liveSky.look.night > 0.01
    }

    const reach = started ? propDistance : Infinity
    const last = lastRefresh.current
    if (
      last &&
      last.reach === reach &&
      Math.hypot(last.x - livePlayer.x, last.z - livePlayer.z) < REFRESH_DISTANCE
    ) {
      return
    }
    lastRefresh.current = { x: livePlayer.x, z: livePlayer.z, reach }

    let count = 0
    for (const { x, z, rotation, variation } of props) {
      if (Math.hypot(x - livePlayer.x, z - livePlayer.z) > reach) continue

      transform.position.set(x, 0, z)
      transform.rotation.y = rotation
      transform.scale.setScalar(1 - sizeRange / 2 + variation * sizeRange)
      transform.updateMatrix()
      instances.setMatrixAt(count, transform.matrix)
      if (colors) {
        instances.setColorAt(count, colors[Math.floor(variation * colors.length * 0.999)])
      }
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, props.length]}
      frustumCulled={false}
      castShadow={treeShadows && !glow}
      receiveShadow={!glow}
    >
      {glow ? (
        <meshBasicMaterial
          ref={glowMaterial}
          vertexColors
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-6}
        />
      ) : (
        <meshStandardMaterial
          color={colors ? '#ffffff' : color}
          roughness={0.95}
          flatShading
          onBeforeCompile={sway ? addSway : undefined}
        />
      )}
    </instancedMesh>
  )
}

export function RoadsideProps({ props }: { props: Props }) {
  const trunk = useMemo(() => createTrunkGeometry(), [])
  const canopies = useMemo(() => createCanopyGeometries(), [])
  const lamp = useMemo(() => createLampGeometry(), [])
  const lampGlow = useMemo(() => createLampGlowGeometry(), [])
  const windPhase = useRef(0)

  // Each kind of tree needs its own instanced mesh, as a mesh holds one shape.
  const treesByKind = useMemo(
    () =>
      canopies.map((_, kind) =>
        props.trees.filter(({ variation }) => Math.floor(variation * 997) % TREE_KINDS === kind),
      ),
    [canopies, props.trees],
  )

  useFrame((_, delta) => {
    // A phase that speeds up in wind, so a change in wind can't make the trees jump.
    windPhase.current += Math.min(delta, 0.1) * (1 + liveSky.wind * 2.5)
    windUniforms.uWindPhase.value = windPhase.current
    windUniforms.uWindStrength.value = liveSky.wind
  })

  useEffect(
    () => () => {
      trunk.dispose()
      canopies.forEach((canopy) => canopy.dispose())
      lamp.dispose()
      lampGlow.dispose()
    },
    [trunk, canopies, lamp, lampGlow],
  )

  return (
    <>
      <PropInstances props={props.trees} geometry={trunk} color={TRUNK_COLOR} sizeRange={0.5} sway />
      {canopies.map((canopy, kind) => (
        <PropInstances
          key={kind}
          props={treesByKind[kind]}
          geometry={canopy}
          colors={CANOPY_COLORS}
          sizeRange={0.5}
          sway
        />
      ))}
      <PropInstances props={props.lamps} geometry={lamp} color={LAMP_COLOR} sizeRange={0} />
      <PropInstances props={props.lamps} geometry={lampGlow} sizeRange={0} glow />
    </>
  )
}
