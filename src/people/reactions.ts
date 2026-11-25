import type { ScooterState } from '../vehicle/ScooterController'
import { getTravelSpeed } from '../vehicle/ScooterController'
import { bark } from '../talk/talk'
import type { Pedestrian, TrafficWorld } from '../traffic/trafficLogic'

/*
 * What people on the street say about the player's riding (their words are in talk/characters.json):
 *
 *   cut close while crossing      a shout ("Yenri! Nodkond hogi!")
 *   stopped for, to let them over a wave, and thanks
 *   ridden at along the footpath  they step back, and say whose footpath it is
 *   just riding past              now and then somebody calls out "Delivery anna!" and waves
 *
 * The traffic's own code notices the first three (trafficLogic.ts sets `Pedestrian.did`); this
 * gives them a voice, a few times a second, each kind with a rest of its own so the street never
 * nags. The call-out is rare by design: once in a minute or two, and never while another is up.
 */

const CHECK_EVERY = 0.2
/** Seconds before the same kind of thing is said again. */
const REST = { cutOff: 7, letPass: 9, steppedBack: 12 }
const FAMILY = { cutOff: 'bark.cutoff', letPass: 'bark.thanks', steppedBack: 'bark.footpath' } as const
/** "Delivery anna!": between this many seconds apart (lowest to highest), from someone within `reach` metres ahead, while riding faster than `speed` m/s; they wave for `wave` seconds. */
const CALL = { every: [55, 120], reach: 13, speed: 3, wave: 1.8, anyGap: 6 }

const said = { cutOff: -Infinity, letPass: -Infinity, steppedBack: -Infinity, any: -Infinity }
let clock = 0
let since = 0
let callIn = 25 + Math.random() * 40
let waver: Pedestrian | null = null
let waveLeft = 0

/** Call every frame with the walkers in play. */
export function stepReactions(world: TrafficWorld, rider: ScooterState, walkers: number, dt: number) {
  clock += dt
  callIn -= dt
  if (waver) {
    waveLeft -= dt
    if (waveLeft <= 0) {
      waver.wave = 0
      waver = null
    }
  }
  since += dt
  if (since < CHECK_EVERY) return
  since = 0
  const riding = rider.rider.phase === 'on'
  let caller: Pedestrian | null = null
  for (let i = 0; i < walkers && i < world.pedestrians.length; i++) {
    const person = world.pedestrians[i]
    if (person.lane === -1 || person.far) continue
    const did = person.did
    if (did) {
      person.did = null
      if (clock - said[did] > REST[did] && clock - said.any > 2.5) {
        said[did] = clock
        said.any = clock
        bark(FAMILY[did], 'Passer-by')
      }
      continue
    }
    if (callIn > 0 || !riding || caller || person.cross || person.body || person.fallen) continue
    const offsetX = person.x - rider.x
    const offsetZ = person.z - rider.z
    if (Math.abs(offsetX) > CALL.reach || Math.abs(offsetZ) > CALL.reach) continue
    // Ahead of the rider, so they're seen calling.
    if (offsetX * Math.sin(rider.heading) + offsetZ * Math.cos(rider.heading) > 2) caller = person
  }
  if (caller && getTravelSpeed(rider) > CALL.speed && clock - said.any > CALL.anyGap) {
    callIn = CALL.every[0] + Math.random() * (CALL.every[1] - CALL.every[0])
    said.any = clock
    caller.wave = 1
    waver = caller
    waveLeft = CALL.wave
    bark('bark.anna', 'Passer-by')
  }
}
