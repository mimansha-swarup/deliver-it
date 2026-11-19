import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { agaraPlaces } from '../game/agaraPlaces'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { RUSH_ON, rushHour, SIGNAL_FINE, surgeShare } from '../game/rush'
import type { ScooterState } from '../vehicle/ScooterController'
import { setJam, type TrafficWorld } from './trafficLogic'
import { getLight } from './trafficSignals'

/*
 * The Agara junction's rules (game/rush.ts):
 * - at rush hour traffic near it crawls and bunches into a jam (the world's `jam`, read by
 *   trafficLogic.ts), and Ravi says the surge is on;
 * - a traffic policeman stands at its lights: riding over a stop line there on red is a fine.
 * Draws nothing.
 */

/** The jam reaches this far from the junction, in metres. */
const JAM_REACH = 420
/** After a fine, no other for this long, in seconds. */
const FINE_GAP = 25
/** Slower than this over the line isn't jumping it (m/s): creeping forward at a red is forgiven. */
const JUMP_SPEED = 2.5

export function JunctionWatch({ scooter, world }: { scooter: RefObject<ScooterState>; world: TrafficWorld }) {
  const last = useRef<{ x: number; z: number } | null>(null)
  const sinceFine = useRef(FINE_GAP)
  const surging = useRef(false)

  useFrame((_, delta) => {
    const state = scooter.current
    const { junction, police } = agaraPlaces
    const rush = rushHour(liveSky.hours)

    // The jam, and word of the surge as it starts.
    setJam(world, junction && rush > 0 ? { x: junction.x, z: junction.z, reach: JAM_REACH, amount: rush } : null)
    const on = rush > RUSH_ON
    if (on && !surging.current && useGameStore.getState().duty === 'online') {
      useGameStore.getState().raviSays(`Rush hour: Outer Ring Road is jammed at Agara. Surge pay is on, up to +${Math.round(surgeShare(liveSky.hours < 13 ? 9 : 18) * 100)}%.`)
    }
    surging.current = on

    // The policeman's lights: over a stop line on red, at speed.
    sinceFine.current += delta
    const before = last.current
    last.current = { x: state.x, z: state.z }
    if (!police || !before || sinceFine.current < FINE_GAP || state.crashLeft > 0) return
    if (Math.hypot(state.x - police.x, state.z - police.z) > 60) return
    const speed = Math.hypot(state.velocityX, state.velocityZ)
    if (speed < JUMP_SPEED) return
    for (const post of world.signals.posts) {
      if (post.junction !== police.junction) continue
      // Traffic comes at the lights' face: into the junction is the other way.
      const inX = -Math.sin(post.rotation)
      const inZ = -Math.cos(post.rotation)
      const was = (before.x - post.stopX) * inX + (before.z - post.stopZ) * inZ
      const now = (state.x - post.stopX) * inX + (state.z - post.stopZ) * inZ
      if (!(was < 0 && now >= 0)) continue
      const across = Math.abs((state.x - post.stopX) * inZ - (state.z - post.stopZ) * inX)
      if (across > post.stopWidth / 2 + 1.5) continue
      // Heading into the junction, not across the line's end sideways.
      if (state.velocityX * inX + state.velocityZ * inZ < speed * 0.5) continue
      if (getLight(world.signals.junctions[post.junction], post.group, world.signalClock) !== 'red') continue
      sinceFine.current = 0
      useGameStore.getState().fine('Signal jump · Agara junction', SIGNAL_FINE, `Traffic police at Agara: you jumped the red. ₹${SIGNAL_FINE} fine. Wait for the green, maga.`)
      break
    }
  })
  return null
}
