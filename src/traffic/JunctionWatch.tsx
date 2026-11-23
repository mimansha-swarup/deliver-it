import { useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { agaraPlaces } from '../game/agaraPlaces'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { RUSH_ON, rushHour, SIGNAL_FINE, surgeShare } from '../game/rush'
import type { ScooterState } from '../vehicle/ScooterController'
import { setJam, type TrafficWorld } from './trafficLogic'
import { getLight } from './trafficSignals'
import { POLICE, policePosts, showPoliceCard } from '../game/police'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import { playWhistle } from '../audio/doorSounds'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('traffic AI')

/*
 * The Agara junction's rules (game/rush.ts):
 * - at rush hour traffic bunches near it, and more of it stops for one reason or another, so the
 *   queues are real ones (the world's `jam`, read by trafficLogic.ts' `startHalts`), and Ravi says
 *   the surge is on;
 * and the traffic police's, there and at the other major junctions (game/police.ts):
 * - riding over a stop line on red where a policeman stands is a challan;
 * - coming up to him slowly, the rider may be waved down for a helmet check: a nod with one on, a
 *   challan without.
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
  /** Seconds since the last helmet check, and the junction whose policeman the rider is close to now (-1: none). */
  const sinceCheck = useRef(POLICE.checkGap)
  const nearPost = useRef(-1)

  useFrame((_, delta) => {
    const state = scooter.current
    const { junction } = agaraPlaces
    const rush = rushHour(liveSky.hours)

    // The jam, and word of the surge as it starts.
    setJam(world, junction && rush > 0 ? { x: junction.x, z: junction.z, reach: JAM_REACH, amount: rush } : null)
    const on = rush > RUSH_ON
    if (on && !surging.current && useGameStore.getState().duty === 'online') {
      useGameStore.getState().raviSays(`Rush hour: Outer Ring Road is jammed at Agara. Surge pay is on, up to +${Math.round(surgeShare(liveSky.hours < 13 ? 9 : 18) * 100)}%.`)
    }
    surging.current = on

    // The policemen's lights: over a stop line on red, at speed, at any junction one stands at.
    sinceFine.current += delta
    sinceCheck.current += delta
    const before = last.current
    last.current = { x: state.x, z: state.z }
    if (!before || state.crashLeft > 0 || state.rider.phase !== 'on') return
    let police: (typeof policePosts.list)[number] | null = null
    for (const post of policePosts.list) if (Math.hypot(state.x - post.x, state.z - post.z) < 60) police = post
    if (!police) {
      nearPost.current = -1
      return
    }
    const speed = Math.hypot(state.velocityX, state.velocityZ)

    // A helmet check, as the rider comes up to him slowly enough to be waved down: once per approach.
    // Not for a cab (nobody's bare-headed in a car) or a bicycle.
    const close = Math.hypot(state.x - police.x, state.z - police.z) < POLICE.checkRange
    if (close && nearPost.current !== police.junction && speed < POLICE.checkSpeed) {
      nearPost.current = police.junction
      const game = useGameStore.getState()
      const spec = liveVehicle.spec
      const bare = !game.helmetOn && !spec.size.cab && spec.id !== 'bicycle'
      if (sinceCheck.current > POLICE.checkGap && !spec.size.cab && spec.id !== 'bicycle' && (bare || Math.random() < POLICE.checkChance)) {
        sinceCheck.current = 0
        playWhistle()
        if (bare) {
          game.fine(`No helmet · ${police.name}`, POLICE.helmetFine, `Traffic police at ${police.name}: riding without a helmet. ₹${POLICE.helmetFine} challan. Wear it, maga: it's in your Garage.`)
          showPoliceCard({ title: 'Helmet check', line: 'No helmet. “Helmet yelli? Challan.”', fine: POLICE.helmetFine, where: police.name })
        } else showPoliceCard({ title: 'Helmet check', line: 'Helmet on, strap done up. “Sari, hogi.”', fine: 0, where: police.name }, 3200)
      }
    } else if (!close && nearPost.current === police.junction) nearPost.current = -1

    if (sinceFine.current < FINE_GAP || speed < JUMP_SPEED) return
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
      playWhistle()
      useGameStore.getState().fine(`Signal jump · ${police.name}`, SIGNAL_FINE, `Traffic police at ${police.name}: you jumped the red. ₹${SIGNAL_FINE} challan. Wait for the green, maga.`)
      showPoliceCard({ title: 'Signal jump', line: 'Over the stop line on red.', fine: SIGNAL_FINE, where: police.name })
      break
    }
  })
  return null
}
