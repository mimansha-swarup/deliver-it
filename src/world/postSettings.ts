import type { N8AOPostPass } from 'n8ao'
import type * as THREE from 'three'

/** Overall brightness going into the tone mapping. AgX is darker than ACES at the same value. */
export const EXPOSURE = 1.15

/**
 * Ambient occlusion: how far round a point it looks for things blocking light, in metres, and how dark it gets.
 * The radius reaches up under a stilt floor (3.2 m) and a balcony's depth, so those read as shaded.
 */
export const AO = { radius: 2.2, distanceFalloff: 0.8, intensity: 3.0, color: '#24160f' }

/**
 * Bloom: only what's brighter than `threshold` glows (lit signs, lamps, the sun
 * disc, headlights), and only a little.
 */
export const BLOOM = { intensity: 0.35, threshold: 0.95, smoothing: 0.2, radius: 0.7 }

/** The tone mapping reads the renderer's exposure. */
export function applyExposure(renderer: THREE.WebGLRenderer) {
  renderer.toneMappingExposure = EXPOSURE
}

/**
 * N8AO looks through the whole scene every frame for anything transparent and,
 * finding some (rain, glass, flames, signs' glow), draws the scene twice more
 * so they don't get dark corners. That cost about 5 ms a frame. Transparent
 * things don't need ambient occlusion here, so it's turned off.
 */
export function skipTransparencyPass(pass: N8AOPostPass | null) {
  if (!pass) return
  pass.autoDetectTransparency = false
  pass.configuration.transparencyAware = false
}

/**
 * The sun's light in the haze. `hazeGlow` is how bright the air glows looking towards the sun
 * (sunHaze.ts), at full sun and the thickest haze. `fullLight` is the sun's light at which it's
 * at full strength. The shafts shine from a disc `discRadius` across, `discDistance` away, with
 * `shaftSamples` steps from each pixel towards it, each adding `shaftWeight`, worked out at
 * `shaftResolution` of the picture's size (32 samples at 0.4: about 40% of the cost of 48 at 0.5).
 * They're on only while the sun is lower than `shaftsBelow` (its direction's height: about 18°, so
 * from about 16:20 in the evening and until about 7:40 in the morning).
 */
export const SUN = { hazeGlow: 0.55, fullLight: 3, discRadius: 22, discDistance: 900, shaftSamples: 32, shaftWeight: 0.4, shaftResolution: 0.4, shaftsBelow: 0.33 }
