import { agaraPlaces } from '../game/agaraPlaces'
import { rushHour } from '../game/rush'
import { noiseLoop } from './ambience'

/*
 * Sounds that belong to places, all made here like the rest (no recordings):
 * - temple bells near the Anjaneya and Jagannath temples: a struck bell every few seconds, more at
 *   the morning and evening aarti, over a soft drone, both fading with distance;
 * - horns at the Agara junction: impatient short blasts, thick at rush hour;
 * - rain on the flyover: up on the deck, the hiss of rain on open concrete and spray; under it, the
 *   rain drumming on the deck overhead, and drips from its edge.
 */

/** Bells carry this far, and the drone less, in metres. */
const BELL_REACH = 170
const DRONE_REACH = 70
const BELL_VOLUME = 0.2
const DRONE_VOLUME = 0.035
/** Seconds between bells, ordinarily and at aarti (about 6 to 8 and 18 to 20). */
const BELL_EVERY: [number, number] = [5, 12]
const BELL_EVERY_AARTI: [number, number] = [1.2, 3.5]
/** Horns at the junction: heard this near it, this often ordinarily and at rush hour, in seconds. */
const JUNCTION_REACH = 230
const HONK_VOLUME = 0.11
const HONK_EVERY: [number, number] = [3.5, 9]
const HONK_EVERY_RUSH: [number, number] = [0.8, 2.6]
const DECK_RAIN_VOLUME = 0.2
const UNDER_RAIN_VOLUME = 0.3
const DECK_DRIP_VOLUME = 0.12
/** Higher than this, the rider is up on a deck. */
const UP_ON_DECK = 2.2

export type PlaceState = { x: number; z: number; height: number; rain: number; night: number; hours: number }

const between = ([low, high]: [number, number]) => low + Math.random() * (high - low)
/** 1 at a place, falling to 0 at `reach` metres from it. */
const nearness = (spot: { x: number; z: number } | null, x: number, z: number, reach: number) =>
  spot ? Math.max(0, 1 - Math.hypot(spot.x - x, spot.z - z) / reach) : 0

export function createPlaceSounds(context: AudioContext, output: AudioNode) {
  // The drone: a low fifth, each note two tones a hair apart so it shimmers, breathing slowly.
  const droneLevel = context.createGain()
  droneLevel.gain.value = 0
  const breath = context.createGain()
  breath.gain.value = 0.8
  const slow = context.createOscillator()
  slow.frequency.value = 0.13
  const slowDepth = context.createGain()
  slowDepth.gain.value = 0.2
  slow.connect(slowDepth).connect(breath.gain)
  slow.start()
  for (const hz of [138.6, 139.3, 207.7, 208.4, 277.2]) {
    const tone = context.createOscillator()
    tone.type = 'sine'
    tone.frequency.value = hz
    tone.connect(breath)
    tone.start()
  }
  breath.connect(droneLevel).connect(output)

  const deckRain = noiseLoop(context, 'highpass', 2600)
  const underRain = noiseLoop(context, 'lowpass', 240)
  deckRain.level.connect(output)
  underRain.level.connect(output)

  /** A temple bell struck once: a few partials that aren't quite in tune, ringing down over seconds. */
  const bell = (volume: number, pitch: number, pan: number) => {
    const start = context.currentTime + 0.02
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    panner.connect(output)
    for (const [ratio, share, ring] of [[1, 1, 3.2], [2.02, 0.55, 2.2], [2.76, 0.4, 1.6], [4.1, 0.22, 1.0], [5.43, 0.14, 0.7]] as const) {
      const tone = context.createOscillator()
      tone.frequency.value = pitch * ratio
      const level = context.createGain()
      level.gain.setValueAtTime(0, start)
      level.gain.linearRampToValueAtTime(volume * share, start + 0.006)
      level.gain.exponentialRampToValueAtTime(0.0001, start + ring)
      tone.connect(level).connect(panner)
      tone.start(start)
      tone.stop(start + ring + 0.05)
    }
  }

  /** A horn at the junction: two notes together through a narrow filter, a short blast or two. */
  const honk = (volume: number, pan: number) => {
    const base = 360 + Math.random() * 160
    const blasts = Math.random() < 0.35 ? 2 : 1
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = base * 2.4
    filter.Q.value = 1.2
    filter.connect(panner).connect(output)
    for (let blast = 0; blast < blasts; blast++) {
      const start = context.currentTime + 0.02 + blast * 0.32
      const length = 0.14 + Math.random() * 0.3
      const level = context.createGain()
      level.gain.setValueAtTime(0, start)
      level.gain.linearRampToValueAtTime(volume, start + 0.015)
      level.gain.setValueAtTime(volume, start + length)
      level.gain.linearRampToValueAtTime(0, start + length + 0.04)
      level.connect(filter)
      for (const ratio of [1, 1.26]) {
        const tone = context.createOscillator()
        tone.type = 'square'
        tone.frequency.value = base * ratio
        tone.connect(level)
        tone.start(start)
        tone.stop(start + length + 0.06)
      }
    }
  }

  /** A drip from the deck's edge: a quick rising "plip". */
  const drip = (volume: number) => {
    const start = context.currentTime + 0.01
    const from = 700 + Math.random() * 900
    const tone = context.createOscillator()
    tone.frequency.setValueAtTime(from, start)
    tone.frequency.exponentialRampToValueAtTime(from * 2.1, start + 0.035)
    const level = context.createGain()
    level.gain.setValueAtTime(volume, start)
    level.gain.exponentialRampToValueAtTime(0.0001, start + 0.09)
    const panner = context.createStereoPanner()
    panner.pan.value = Math.random() * 1.6 - 0.8
    tone.connect(level).connect(panner).connect(output)
    tone.start(start)
    tone.stop(start + 0.12)
  }

  let untilBell = 2
  let untilHonk = 2
  let untilDrip = 0.5

  return {
    update: ({ x, z, height, rain, night, hours }: PlaceState, dt: number) => {
      const now = context.currentTime
      const follow = (gain: AudioParam, value: number) => gain.setTargetAtTime(value, now, 0.4)

      // The temples: whichever is nearer. Quiet late at night, when they're shut.
      const anjaneya = nearness(agaraPlaces.temple, x, z, BELL_REACH)
      const jagannath = nearness(agaraPlaces.jagannath, x, z, BELL_REACH)
      const open = hours >= 5 && hours < 21.5 ? 1 : 0
      const temple = Math.max(anjaneya, jagannath) * open
      const drone = Math.max(nearness(agaraPlaces.temple, x, z, DRONE_REACH), nearness(agaraPlaces.jagannath, x, z, DRONE_REACH)) * open
      follow(droneLevel.gain, DRONE_VOLUME * drone)
      untilBell -= dt
      if (untilBell <= 0) {
        const aarti = (hours >= 6 && hours < 8) || (hours >= 18 && hours < 20)
        untilBell = between(aarti ? BELL_EVERY_AARTI : BELL_EVERY)
        // The Anjaneya temple's bell is the deeper of the two.
        if (temple > 0.02) bell(BELL_VOLUME * temple * temple, anjaneya >= jagannath ? 410 : 560, Math.random() * 1.2 - 0.6)
      }

      // The junction's horns.
      const junction = nearness(agaraPlaces.junction, x, z, JUNCTION_REACH)
      const rush = rushHour(hours)
      untilHonk -= dt
      if (untilHonk <= 0) {
        const [low, high] = HONK_EVERY
        const [rushLow, rushHigh] = HONK_EVERY_RUSH
        untilHonk = between([low + (rushLow - low) * rush, high + (rushHigh - high) * rush]) * (1 + night * 2)
        if (junction > 0.03) honk(HONK_VOLUME * (0.35 + 0.65 * junction) * (0.6 + 0.4 * rush), Math.random() * 1.8 - 0.9)
      }

      // Rain on the flyover: on top of it, or under it.
      const up = height > UP_ON_DECK ? 1 : 0
      const under = !up && agaraPlaces.isUnderDeck(x, z) ? 1 : 0
      follow(deckRain.level.gain, DECK_RAIN_VOLUME * rain * up)
      follow(underRain.level.gain, UNDER_RAIN_VOLUME * rain * under)
      untilDrip -= dt
      if (untilDrip <= 0) {
        untilDrip = 0.15 + Math.random() * 0.7
        if (under && rain > 0.15) drip(DECK_DRIP_VOLUME * rain)
      }
    },
  }
}
