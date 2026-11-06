import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'

/** How far the sun's shadows reach from the rider, in metres. */
const SHADOW_RANGE = 260

/** Where the sun sits, relative to the point it's lit around. */
const SUN_OFFSET = new THREE.Vector3(180, 260, 120)

// The sideways and upward directions of the picture the sun takes for its shadow map.
const SUN_FORWARD = SUN_OFFSET.clone().negate().normalize()
const SUN_RIGHT = new THREE.Vector3().crossVectors(SUN_FORWARD, THREE.Object3D.DEFAULT_UP).normalize()
const SUN_UP = new THREE.Vector3().crossVectors(SUN_RIGHT, SUN_FORWARD)

const focus = new THREE.Vector3()

/**
 * Moves the sun along with the rider. Its shadow map is a grid of pixels, so
 * each step is rounded to a whole pixel. If it slid smoothly, shadow edges
 * would land on different pixels each frame and shimmer.
 */
function followRider(sun: THREE.DirectionalLight, shadowSize: number) {
  const pixelSize = (SHADOW_RANGE * 2) / (shadowSize || 1)
  const snap = (metres: number) => Math.round(metres / pixelSize) * pixelSize

  const across = snap(livePlayer.x * SUN_RIGHT.x + livePlayer.z * SUN_RIGHT.z)
  const up = snap(livePlayer.x * SUN_UP.x + livePlayer.z * SUN_UP.z)

  focus.set(0, 0, 0).addScaledVector(SUN_RIGHT, across).addScaledVector(SUN_UP, up)
  // Sliding along the sun's own direction doesn't change the picture's pixels,
  // and this brings the point back down to the ground.
  focus.addScaledVector(SUN_FORWARD, -focus.y / SUN_FORWARD.y)

  sun.target.position.copy(focus)
  sun.target.updateMatrixWorld()
  sun.position.copy(focus).add(SUN_OFFSET)
}

export function Lighting() {
  const { shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const sun = useRef<THREE.DirectionalLight>(null)

  useFrame(() => {
    if (sun.current && shadowSize > 0) followRider(sun.current, shadowSize)
  })

  return (
    <>
      {/* Soft fill light: blue from the sky above, warm bounce from the ground. */}
      <hemisphereLight args={['#dcecff', '#a39a84', 1.1]} />

      {/* The sun. */}
      {/* The key rebuilds the light when the shadow size changes, as its map can't resize. */}
      <directionalLight
        key={shadowSize}
        ref={sun}
        castShadow={shadowSize > 0}
        color="#fff1dc"
        intensity={2.6}
        position={SUN_OFFSET.toArray()}
        shadow-mapSize={[shadowSize || 1, shadowSize || 1]}
        shadow-bias={-0.0004}
        shadow-camera-left={-SHADOW_RANGE}
        shadow-camera-right={SHADOW_RANGE}
        shadow-camera-top={SHADOW_RANGE}
        shadow-camera-bottom={-SHADOW_RANGE}
        shadow-camera-near={10}
        shadow-camera-far={800}
      />
    </>
  )
}
