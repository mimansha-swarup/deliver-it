import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { livePlayer } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { Prop, RoadsideProps as Props } from './props'

const TRUNK_COLOR = '#6f5a43'
const LAMP_COLOR = '#55585c'
const CANOPY_COLORS = ['#4f7a3a', '#5e8a3f', '#3f6d3b', '#6c9347'].map((c) => new THREE.Color(c))

/** The list of what's nearby is only rebuilt after the rider moves this far, in metres. */
const REFRESH_DISTANCE = 20

const transform = new THREE.Object3D()

function createTrunkGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3, 6)
  trunk.translate(0, 1.5, 0)
  return trunk
}

function createCanopyGeometry(): THREE.BufferGeometry {
  const canopy = new THREE.IcosahedronGeometry(2.2, 1)
  canopy.translate(0, 4.4, 0)
  canopy.scale(1, 0.9, 1)
  return canopy
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
}: {
  props: Prop[]
  geometry: THREE.BufferGeometry
  color?: string
  colors?: THREE.Color[]
  sizeRange: number
}) {
  const { treeShadows, propDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const started = useGameStore((state) => state.started)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const lastRefresh = useRef<{ x: number; z: number; reach: number } | null>(null)

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

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
      castShadow={treeShadows}
      receiveShadow
    >
      <meshStandardMaterial color={colors ? '#ffffff' : color} roughness={0.95} flatShading />
    </instancedMesh>
  )
}

export function RoadsideProps({ props }: { props: Props }) {
  const trunk = useMemo(() => createTrunkGeometry(), [])
  const canopy = useMemo(() => createCanopyGeometry(), [])
  const lamp = useMemo(() => createLampGeometry(), [])

  useEffect(
    () => () => {
      trunk.dispose()
      canopy.dispose()
      lamp.dispose()
    },
    [trunk, canopy, lamp],
  )

  return (
    <>
      <PropInstances props={props.trees} geometry={trunk} color={TRUNK_COLOR} sizeRange={0.5} />
      <PropInstances props={props.trees} geometry={canopy} colors={CANOPY_COLORS} sizeRange={0.5} />
      <PropInstances props={props.lamps} geometry={lamp} color={LAMP_COLOR} sizeRange={0} />
    </>
  )
}
