import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'

/** How far the sun's shadows reach from the rider, in metres. */
const SHADOW_RANGE = 260

/** How far the sun or moon sits from the point it lights around, in metres. */
const LIGHT_DISTANCE = 340

// The direction the light shines, and the sideways and upward directions of
// the picture it takes for its shadow map. These change through the day.
const sunForward = new THREE.Vector3()
const sunRight = new THREE.Vector3()
const sunUp = new THREE.Vector3()

const focus = new THREE.Vector3()

/**
 * Moves the sun along with the rider. Its shadow map is a grid of pixels, so
 * each step is rounded to a whole pixel. If it slid smoothly, shadow edges
 * would land on different pixels each frame and shimmer.
 */
function followRider(sun: THREE.DirectionalLight, shadowSize: number) {
  sunForward.set(...liveSky.look.lightDirection).negate()
  sunRight.crossVectors(sunForward, THREE.Object3D.DEFAULT_UP).normalize()
  sunUp.crossVectors(sunRight, sunForward)

  const pixelSize = (SHADOW_RANGE * 2) / (shadowSize || 1)
  const snap = (metres: number) => Math.round(metres / pixelSize) * pixelSize

  const across = snap(livePlayer.x * sunRight.x + livePlayer.z * sunRight.z)
  const up = snap(livePlayer.x * sunUp.x + livePlayer.z * sunUp.z)

  focus.set(0, 0, 0).addScaledVector(sunRight, across).addScaledVector(sunUp, up)
  // Sliding along the sun's own direction doesn't change the picture's pixels,
  // and this brings the point back down to the ground.
  focus.addScaledVector(sunForward, -focus.y / sunForward.y)

  sun.target.position.copy(focus)
  sun.target.updateMatrixWorld()
  sun.position.copy(focus).addScaledVector(sunForward, -LIGHT_DISTANCE)
}

export function Lighting() {
  const { shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const sun = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.HemisphereLight>(null)

  useFrame(() => {
    const { look } = liveSky
    if (fill.current) {
      fill.current.intensity = look.ambientIntensity
      fill.current.color.setRGB(...look.ambientColor, THREE.SRGBColorSpace)
    }
    if (sun.current) {
      followRider(sun.current, shadowSize)
      sun.current.intensity = look.lightIntensity
      sun.current.color.setRGB(...look.lightColor, THREE.SRGBColorSpace)
      sun.current.shadow.intensity = look.shadowStrength
    }
  })

  return (
    <>
      {/* Soft fill light: blue from the sky above, warm bounce from the ground. */}
      <hemisphereLight ref={fill} args={['#dcecff', '#a39a84', 1.1]} />

      {/* The sun by day, and the moon by night. */}
      {/* The key rebuilds the light when the shadow size changes, as its map can't resize. */}
      <directionalLight
        key={shadowSize}
        ref={sun}
        castShadow={shadowSize > 0}
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
