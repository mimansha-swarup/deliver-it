import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky, liveView } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'

/** The title screen's aerial view sees the whole map. */
const TITLE_VIEW = 1300
/**
 * Where the haze starts, in metres from the camera: near when it's thickest
 * (sun low), further out when it's thin (noon, night). See `haze.ts` for its curve.
 */
const HAZE_START_THICK = 15
const HAZE_START_THIN = 90
/**
 * Heavy rain moves the haze's start this share of the draw distance behind the
 * camera. The haze curve then begins part-way, so the air is misty from a little way off. It was
 * 0.5, which put a sixth of the haze's colour over things right beside the rider and a quarter over
 * the far side of the street: with the light flattened as well, every wall, road and footpath lost
 * its texture and the city turned to plain boxes whenever it rained.
 */
const RAIN_FOG = 0.1
/** How quickly the view closes in or opens up. Higher is faster. */
const CHANGE_RESPONSE = 2

/**
 * Keeps the haze and the draw distance in step. The fog is fully thick exactly
 * where drawing stops, so map squares appear and vanish behind it, unseen.
 */
export function ViewDistance() {
  const started = useGameStore((state) => state.started)
  const { drawDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  useFrame(({ scene }, delta) => {
    const target = started ? drawDistance : TITLE_VIEW
    liveView.drawDistance += (target - liveView.drawDistance) * (1 - Math.exp(-CHANGE_RESPONSE * delta))

    if (scene.fog instanceof THREE.Fog) {
      const start = HAZE_START_THIN + (HAZE_START_THICK - HAZE_START_THIN) * liveSky.look.haze
      const dry = Math.min(start, liveView.drawDistance * 0.5)
      scene.fog.near = dry * (1 - liveSky.rain) - liveSky.rain * RAIN_FOG * liveView.drawDistance
      scene.fog.far = liveView.drawDistance
    }
  })

  return null
}
