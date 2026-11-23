import { useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('lights and sky')

/** How far the sun or moon sits from the point it lights around, in metres. */
const LIGHT_DISTANCE = 340
/**
 * Pushes shadow tests out along the surface, in world units, so lit faces
 * don't shadow themselves in stripes ("acne"). Too much and shadows float off
 * the things casting them.
 */
const SHADOW_NORMAL_BIAS = 0.035
const SHADOW_BIAS = -0.0002

// The direction the light shines, and the sideways and upward directions of
// the picture it takes for its shadow map. These change through the day.
const sunForward = new THREE.Vector3()
const sunRight = new THREE.Vector3()
const sunUp = new THREE.Vector3()

const focus = new THREE.Vector3()

/**
 * The sun turns about 0.2° a second (a day lasts half an hour). Turned a little
 * every frame, the shadow map's pixel grid turns with it, and every shadow edge
 * crawls and shimmers. So the light keeps one direction until the sun has
 * moved this far, in radians, then steps. 0.25° moves a 10 m building's shadow
 * by about 4 cm, too little to see, about once a second.
 */
const SUN_STEP = (0.25 * Math.PI) / 180
const shownDirection = new THREE.Vector3()
const wantedDirection = new THREE.Vector3()

/**
 * Moves the sun along with the rider. Its shadow map is a grid of pixels, so
 * each step is rounded to a whole pixel. If it slid smoothly, shadow edges
 * would land on different pixels each frame and shimmer.
 */
function followRider(sun: THREE.DirectionalLight, shadowSize: number, shadowRange: number) {
  wantedDirection.set(...liveSky.look.lightDirection).negate()
  // A big jump, such as sunset handing over to the moon, is taken at once.
  if (shownDirection.lengthSq() === 0 || shownDirection.angleTo(wantedDirection) > SUN_STEP) shownDirection.copy(wantedDirection)
  sunForward.copy(shownDirection)
  sunRight.crossVectors(sunForward, THREE.Object3D.DEFAULT_UP).normalize()
  sunUp.crossVectors(sunRight, sunForward)

  const pixelSize = (shadowRange * 2) / (shadowSize || 1)
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

/** Under a clear sky the shadow filter shrinks by up to this share of the preset's softness. */
const CLEAR_SHADOW_CRISPNESS = 0.6

export function Lighting() {
  const { shadowSize, shadowRange, shadowSoftness } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const sun = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.HemisphereLight>(null)

  useFrame(() => {
    const { look } = liveSky
    if (fill.current) {
      fill.current.intensity = look.ambientIntensity
      fill.current.color.setRGB(...look.ambientColor, THREE.SRGBColorSpace)
      fill.current.groundColor.setRGB(...look.groundColor, THREE.SRGBColorSpace)
    }
    if (sun.current) {
      followRider(sun.current, shadowSize, shadowRange)
      sun.current.intensity = look.lightIntensity
      sun.current.color.setRGB(...look.lightColor, THREE.SRGBColorSpace)
      sun.current.shadow.intensity = look.shadowStrength
      // Crisper edges under a clear sky: a smaller filter radius (the presets' softness is the most).
      sun.current.shadow.radius = shadowSoftness * (1 - CLEAR_SHADOW_CRISPNESS * look.shadowSharpness)
    }
  })

  return (
    <>
      {/* Soft fill light: cool from the sky above, warm bounce from the red earth below. */}
      <hemisphereLight ref={fill} />

      {/* The sun by day, and the moon by night. */}
      {/* The key rebuilds the light when the shadow size changes, as its map can't resize. */}
      <directionalLight
        key={`${shadowSize} ${shadowRange}`}
        ref={sun}
        castShadow={shadowSize > 0}
        shadow-mapSize={[shadowSize || 1, shadowSize || 1]}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
        shadow-radius={shadowSoftness}
        shadow-camera-left={-shadowRange}
        shadow-camera-right={shadowRange}
        shadow-camera-top={shadowRange}
        shadow-camera-bottom={-shadowRange}
        shadow-camera-near={10}
        shadow-camera-far={800}
      />
    </>
  )
}
