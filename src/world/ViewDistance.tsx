import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveView } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'

/** The title screen's aerial view sees the whole map. */
const TITLE_VIEW = 1300
/** Fog starts at this share of the draw distance. */
const FOG_START = 0.4
/** How quickly the view closes in or opens up. Higher is faster. */
const CHANGE_RESPONSE = 2

/**
 * Keeps the fog and the draw distance in step. The fog is fully thick exactly
 * where drawing stops, so map squares appear and vanish behind it, unseen.
 */
export function ViewDistance() {
  const started = useGameStore((state) => state.started)
  const { drawDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  useFrame(({ scene }, delta) => {
    const target = started ? drawDistance : TITLE_VIEW
    liveView.drawDistance += (target - liveView.drawDistance) * (1 - Math.exp(-CHANGE_RESPONSE * delta))

    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = liveView.drawDistance * FOG_START
      scene.fog.far = liveView.drawDistance
    }
  })

  return null
}
