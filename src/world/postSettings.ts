import type { N8AOPostPass } from 'n8ao'
import type * as THREE from 'three'

/** Overall brightness going into the tone mapping. AgX is darker than ACES at the same value. */
export const EXPOSURE = 1.15

/** Ambient occlusion: how far round a point it looks for things blocking light, in metres, and how dark it gets. */
export const AO = { radius: 1.6, distanceFalloff: 0.6, intensity: 2.2, color: '#2a1a12' }

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
