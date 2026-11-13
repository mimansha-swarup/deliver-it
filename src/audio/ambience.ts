import type { HornVoice } from './horns'
import { playHorn } from './horns'
import { getNoise } from './instruments'

/**
 * The sound of the neighbourhood, all made in code:
 * - a low rumble of distant traffic, which is how a city sounds from any street
 * - busy streets out of sight: traffic swelling and fading as it passes, a murmur
 *   of voices and shops by day, and horns going off somewhere now and then
 * - the Asian koel, Bengaluru's loudest cuckoo: a run of "ku-OO" calls, each
 *   a little higher than the last
 * - rain, a hiss that follows how hard it's raining
 * - the common myna, Bengaluru's chattiest bird: whistles, harsh "chake" notes and gurgles
 * - a scooter going by out of sight, its pitch dropping as it passes
 * - small birds by day: short rising chirps, now and then
 * - in the rain, drips off roofs and leaves
 * - crickets at night: a high note, pulsing quickly
 * - tyre skid: a scrubbing noise, and a squeal on top, that follow how much the scooter slides
 */
export type AmbienceState = {
  /** 0 by day, 1 at night. */
  night: number
  /** How hard it's raining, from 0 to 1. */
  rain: number
  /** Sideways slide, in m/s, and speed, for the tyre skid. */
  slide: number
}

const RUMBLE_VOLUME = 0.45
/** Traffic passing on streets out of sight, and the murmur of people, at their busiest. */
const PASSING_VOLUME = 0.5
const MURMUR_VOLUME = 0.22
const KOEL_VOLUME = 0.28
/** Seconds between distant horns, by day and by night, at random within each range. */
const DISTANT_HORNS_DAY: [number, number] = [2.5, 8]
const DISTANT_HORNS_NIGHT: [number, number] = [10, 25]
const DISTANT_HORN_VOICES: HornVoice[] = ['sedan', 'hatchback', 'auto', 'auto', 'bike', 'bike', 'suv']
/** Seconds between koel songs. It sings mostly by day, and rarely at night. */
const KOEL_EVERY: [number, number] = [20, 45]
const MYNA_VOLUME = 0.24
const MYNA_EVERY: [number, number] = [8, 20]
/** A scooter going by on a street nearby, every so often, by day more than at night. */
const PASS_VOLUME = 0.17
const PASS_EVERY_DAY: [number, number] = [6, 15]
const PASS_EVERY_NIGHT: [number, number] = [18, 40]
const DRIP_VOLUME = 0.16
/** The tyre's squeal, on top of the scrub, at full slide. */
const SQUEAL_VOLUME = 0.12
const RAIN_VOLUME = 0.32
const CRICKET_VOLUME = 0.06
const BIRD_VOLUME = 0.05
const SKID_VOLUME = 0.7
/** A slide slower than this, in m/s, makes no sound. Above, it gets louder up to `SKID_FULL`. */
const SKID_START = 1.2
const SKID_FULL = 5

function noiseLoop(context: AudioContext, filterType: BiquadFilterType, frequency: number, q = 0.7) {
  const source = context.createBufferSource()
  source.buffer = getNoise(context)
  source.loop = true
  const filter = context.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = frequency
  filter.Q.value = q
  const level = context.createGain()
  level.gain.value = 0
  source.connect(filter).connect(level)
  source.start(context.currentTime, Math.random())
  return { source, filter, level }
}

const between = ([low, high]: [number, number]) => low + Math.random() * (high - low)

export function createAmbience(context: AudioContext, output: AudioNode) {
  const rumble = noiseLoop(context, 'lowpass', 260)
  const passing = noiseLoop(context, 'bandpass', 650, 0.6)
  const murmur = noiseLoop(context, 'bandpass', 420, 2.5)
  const rain = noiseLoop(context, 'highpass', 1500)
  const skid = noiseLoop(context, 'bandpass', 950, 1.6)
  for (const { level } of [rumble, passing, murmur, rain, skid]) level.connect(output)

  // A tyre squeals at a pitch, as rubber catches and slips on the road over and over. Two
  // tones that wobble quickly, through a narrow filter, make that sound.
  const squealLevel = context.createGain()
  squealLevel.gain.value = 0
  const squealFilter = context.createBiquadFilter()
  squealFilter.type = 'bandpass'
  squealFilter.frequency.value = 1400
  squealFilter.Q.value = 4
  squealFilter.connect(squealLevel).connect(output)
  const wobble = context.createOscillator()
  wobble.frequency.value = 9
  const wobbleDepth = context.createGain()
  wobbleDepth.gain.value = 35
  wobble.connect(wobbleDepth)
  const squeals = [1250, 1630].map((hz) => {
    const tone = context.createOscillator()
    tone.type = 'triangle'
    tone.frequency.value = hz
    wobbleDepth.connect(tone.frequency)
    tone.connect(squealFilter)
    tone.start()
    return { tone, hz }
  })
  wobble.start()

  // The koel sings from a tree somewhere, so its calls go through a short echo
  // off the buildings around, which is what makes it carry the way it does.
  const koelBus = context.createGain()
  const echo = context.createDelay(1)
  echo.delayTime.value = 0.21
  const echoReturn = context.createGain()
  echoReturn.gain.value = 0.28
  koelBus.connect(output)
  koelBus.connect(echo).connect(echoReturn).connect(output)
  echoReturn.connect(echo)

  // Crickets: a high tone, switched on and off quickly by a second, slow tone.
  const cricket = context.createOscillator()
  cricket.frequency.value = 4400
  const chirp = context.createGain()
  chirp.gain.value = 0
  const pulse = context.createOscillator()
  pulse.type = 'square'
  pulse.frequency.value = 28
  const pulseDepth = context.createGain()
  pulseDepth.gain.value = 0.5
  pulse.connect(pulseDepth).connect(chirp.gain)
  const cricketLevel = context.createGain()
  cricketLevel.gain.value = 0
  cricket.connect(chirp).connect(cricketLevel).connect(output)
  cricket.start()
  pulse.start()

  let untilBird = 2

  /** A bird: two to four quick notes, each sliding up. */
  const sing = (volume: number) => {
    const start = context.currentTime + 0.02
    const notes = 2 + Math.floor(Math.random() * 3)
    const base = 2600 + Math.random() * 1600
    for (let note = 0; note < notes; note++) {
      const time = start + note * (0.09 + Math.random() * 0.05)
      const tone = context.createOscillator()
      tone.frequency.setValueAtTime(base, time)
      tone.frequency.exponentialRampToValueAtTime(base * 1.35, time + 0.07)
      const level = context.createGain()
      level.gain.setValueAtTime(0.0001, time)
      level.gain.exponentialRampToValueAtTime(volume, time + 0.01)
      level.gain.exponentialRampToValueAtTime(0.0001, time + 0.08)
      const panner = context.createStereoPanner()
      panner.pan.value = Math.random() * 1.6 - 0.8
      tone.connect(level).connect(panner).connect(output)
      tone.start(time)
      tone.stop(time + 0.1)
    }
  }

  /**
   * The Asian koel: four to seven calls, each a short low note and then a long
   * one sliding up, "ku-OO". Every call starts a little higher than the one
   * before, so the run climbs, as a real koel's does.
   */
  const koel = (volume: number) => {
    const calls = 4 + Math.floor(Math.random() * 4)
    const panner = context.createStereoPanner()
    panner.pan.value = Math.random() * 1.4 - 0.7
    panner.connect(koelBus)
    let pitch = 620 + Math.random() * 120
    let time = context.currentTime + 0.05

    const note = (start: number, length: number, from: number, to: number) => {
      const tone = context.createOscillator()
      tone.type = 'sine'
      tone.frequency.setValueAtTime(from, start)
      tone.frequency.exponentialRampToValueAtTime(to, start + length * 0.85)
      // A touch of the octave above gives the call its hollow, flute-like edge.
      const overtone = context.createOscillator()
      overtone.type = 'sine'
      overtone.frequency.setValueAtTime(from * 2, start)
      overtone.frequency.exponentialRampToValueAtTime(to * 2, start + length * 0.85)
      const overtoneLevel = context.createGain()
      overtoneLevel.gain.value = 0.18
      const level = context.createGain()
      level.gain.setValueAtTime(0.0001, start)
      level.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.05, length * 0.3))
      level.gain.setValueAtTime(volume, start + length * 0.7)
      level.gain.exponentialRampToValueAtTime(0.0001, start + length)
      tone.connect(level)
      overtone.connect(overtoneLevel).connect(level)
      level.connect(panner)
      for (const source of [tone, overtone]) {
        source.start(start)
        source.stop(start + length + 0.02)
      }
    }

    for (let call = 0; call < calls; call++) {
      note(time, 0.11, pitch, pitch * 1.02)
      note(time + 0.17, 0.4, pitch * 0.95, pitch * 1.3)
      time += 0.85 + Math.random() * 0.15
      pitch *= 1.06
    }
  }

  /**
   * The common myna: five to nine notes, picked from what mynas actually mix:
   * a clear whistle sliding up or down, a harsh "chake" of noise, and a bubbly
   * gurgle, a tone that wobbles fast.
   */
  const myna = (volume: number) => {
    const panner = context.createStereoPanner()
    panner.pan.value = Math.random() * 1.6 - 0.8
    panner.connect(output)
    let time = context.currentTime + 0.05
    const notes = 5 + Math.floor(Math.random() * 5)

    for (let index = 0; index < notes; index++) {
      const kind = Math.random()
      const level = context.createGain()
      level.connect(panner)

      if (kind < 0.4) {
        // A whistle.
        const length = 0.1 + Math.random() * 0.15
        const from = 1400 + Math.random() * 1600
        const tone = context.createOscillator()
        tone.frequency.setValueAtTime(from, time)
        tone.frequency.exponentialRampToValueAtTime(from * (Math.random() < 0.5 ? 1.4 : 0.7), time + length)
        level.gain.setValueAtTime(0.0001, time)
        level.gain.exponentialRampToValueAtTime(volume, time + 0.015)
        level.gain.exponentialRampToValueAtTime(0.0001, time + length)
        tone.connect(level)
        tone.start(time)
        tone.stop(time + length + 0.02)
        time += length + 0.05 + Math.random() * 0.08
      } else if (kind < 0.7) {
        // "Chake": a harsh burst, two of them quickly.
        for (let burst = 0; burst < 2; burst++) {
          const start = time + burst * 0.09
          const crack = context.createBufferSource()
          crack.buffer = getNoise(context)
          const filter = context.createBiquadFilter()
          filter.type = 'bandpass'
          filter.frequency.value = 2400 + Math.random() * 800
          filter.Q.value = 3
          const burstLevel = context.createGain()
          burstLevel.gain.setValueAtTime(0.0001, start)
          burstLevel.gain.exponentialRampToValueAtTime(volume * 1.4, start + 0.008)
          burstLevel.gain.exponentialRampToValueAtTime(0.0001, start + 0.06)
          crack.connect(filter).connect(burstLevel).connect(panner)
          crack.start(start, Math.random() * 0.5)
          crack.stop(start + 0.08)
        }
        time += 0.25 + Math.random() * 0.1
      } else {
        // A gurgle: a tone wobbling fast, so it bubbles.
        const length = 0.18 + Math.random() * 0.12
        const tone = context.createOscillator()
        tone.frequency.value = 900 + Math.random() * 700
        const bubble = context.createOscillator()
        bubble.frequency.value = 28 + Math.random() * 20
        const bubbleDepth = context.createGain()
        bubbleDepth.gain.value = 260
        bubble.connect(bubbleDepth).connect(tone.frequency)
        level.gain.setValueAtTime(0.0001, time)
        level.gain.exponentialRampToValueAtTime(volume * 0.8, time + 0.02)
        level.gain.exponentialRampToValueAtTime(0.0001, time + length)
        tone.connect(level)
        for (const source of [tone, bubble]) {
          source.start(time)
          source.stop(time + length + 0.02)
        }
        time += length + 0.06
      }
    }
  }

  /**
   * A scooter going by on a street nearby. It grows louder, then fades, while
   * its note drops as it passes (the Doppler effect) and it moves from one side
   * to the other.
   */
  const scooterPass = (volume: number) => {
    const start = context.currentTime + 0.05
    const length = 2.2 + Math.random() * 1.2
    const middle = start + length * (0.45 + Math.random() * 0.1)
    const pitch = 70 + Math.random() * 25

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(700, start)
    filter.frequency.linearRampToValueAtTime(1600, middle)
    filter.frequency.linearRampToValueAtTime(600, start + length)
    const level = context.createGain()
    level.gain.setValueAtTime(0.0001, start)
    level.gain.exponentialRampToValueAtTime(volume, middle)
    level.gain.exponentialRampToValueAtTime(0.0001, start + length)
    const panner = context.createStereoPanner()
    const from = Math.random() < 0.5 ? -0.85 : 0.85
    panner.pan.setValueAtTime(from, start)
    panner.pan.linearRampToValueAtTime(-from, start + length)
    filter.connect(level).connect(panner).connect(output)

    // A buzz at the engine's note, and a body an octave down. Coming towards you the note is a
    // little high, going away a little low, and it drops quickly as it passes.
    for (const [type, octave] of [
      ['sawtooth', 1],
      ['square', 0.5],
    ] as const) {
      const note = pitch * octave
      const engine = context.createOscillator()
      engine.type = type
      engine.frequency.setValueAtTime(note * 1.08, start)
      engine.frequency.setValueAtTime(note * 1.06, middle - 0.15)
      engine.frequency.exponentialRampToValueAtTime(note * 0.9, middle + 0.2)
      engine.connect(filter)
      engine.start(start)
      engine.stop(start + length + 0.05)
    }
  }

  /** A single drip: a tiny drop in pitch that rises fast, "plip". */
  const drip = (volume: number) => {
    const time = context.currentTime + Math.random() * 0.05
    const from = 900 + Math.random() * 1200
    const tone = context.createOscillator()
    tone.frequency.setValueAtTime(from, time)
    tone.frequency.exponentialRampToValueAtTime(from * 2.2, time + 0.03)
    const level = context.createGain()
    level.gain.setValueAtTime(0.0001, time)
    level.gain.exponentialRampToValueAtTime(volume, time + 0.004)
    level.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    const panner = context.createStereoPanner()
    panner.pan.value = Math.random() * 1.8 - 0.9
    tone.connect(level).connect(panner).connect(output)
    tone.start(time)
    tone.stop(time + 0.08)
  }

  const follow = (param: AudioParam, value: number) => param.setTargetAtTime(value, context.currentTime, 0.25)

  let untilMyna = between([3, 8])
  let untilPass = between([3, 8])
  let untilDrip = 0
  let untilSwell = 0
  let untilMurmur = 0
  let untilHorn = between(DISTANT_HORNS_DAY)
  let untilKoel = between([4, 10])

  return {
    update: ({ night, rain: raining, slide }: AmbienceState, dt: number) => {
      const busy = 1 - night * 0.65
      const now = context.currentTime

      // The city is quieter at night, and the rain partly drowns it.
      follow(rumble.level.gain, RUMBLE_VOLUME * (1 - night * 0.5))

      // Traffic out of sight swells and fades as vehicles pass, and its pitch wanders with them.
      untilSwell -= dt
      if (untilSwell <= 0) {
        untilSwell = between([0.6, 2])
        passing.level.gain.setTargetAtTime(PASSING_VOLUME * busy * between([0.3, 1]), now, 0.7)
        passing.filter.frequency.setTargetAtTime(between([480, 900]), now, 0.9)
      }

      // People and shops: a murmur that rises and falls faster, by day and not in the rain.
      untilMurmur -= dt
      if (untilMurmur <= 0) {
        untilMurmur = between([0.15, 0.45])
        const street = (1 - night) * (1 - raining * 0.7)
        murmur.level.gain.setTargetAtTime(MURMUR_VOLUME * street * between([0.5, 1]), now, 0.12)
      }

      // A horn goes off somewhere, a street or two away, from any direction.
      untilHorn -= dt
      if (untilHorn <= 0) {
        untilHorn = between(night > 0.5 ? DISTANT_HORNS_NIGHT : DISTANT_HORNS_DAY)
        const angle = Math.random() * Math.PI * 2
        const away = between([45, 85])
        const voice = DISTANT_HORN_VOICES[Math.floor(Math.random() * DISTANT_HORN_VOICES.length)]
        playHorn(voice, Math.sin(angle) * away, Math.cos(angle) * away, { x: 0, z: 0, heading: 0 })
      }

      // The koel: mostly by day, now and then at night, and never in a downpour.
      untilKoel -= dt
      if (untilKoel <= 0) {
        untilKoel = between(KOEL_EVERY)
        const chance = (night > 0.5 ? 0.25 : 1) * (1 - raining)
        if (Math.random() < chance) koel(KOEL_VOLUME)
      }

      follow(rain.level.gain, RAIN_VOLUME * raining)
      follow(cricketLevel.gain, CRICKET_VOLUME * night * (1 - raining))
      const skidAmount = Math.min(1, Math.max(0, (slide - SKID_START) / (SKID_FULL - SKID_START)))
      skid.level.gain.setTargetAtTime(SKID_VOLUME * skidAmount, context.currentTime, 0.05)
      // The squeal comes in only on a real slide, and rises in pitch the faster it goes.
      squealLevel.gain.setTargetAtTime(SQUEAL_VOLUME * skidAmount * skidAmount, now, 0.05)
      for (const { tone, hz } of squeals) tone.frequency.setTargetAtTime(hz * (0.9 + skidAmount * 0.25), now, 0.1)

      // Mynas chatter by day, from the trees and wires.
      untilMyna -= dt
      if (untilMyna <= 0) {
        untilMyna = between(MYNA_EVERY)
        const daylight = (1 - night) * (1 - raining)
        if (daylight > 0.4) myna(MYNA_VOLUME * daylight)
      }

      // A scooter goes by on a street nearby.
      untilPass -= dt
      if (untilPass <= 0) {
        untilPass = between(night > 0.5 ? PASS_EVERY_NIGHT : PASS_EVERY_DAY)
        scooterPass(PASS_VOLUME * busy)
      }

      // In the rain, water drips off roofs and leaves: more often the harder it rains.
      untilDrip -= dt
      if (raining > 0.05 && untilDrip <= 0) {
        untilDrip = between([0.08, 0.5]) / raining
        drip(DRIP_VOLUME * (0.4 + Math.random() * 0.6))
      }

      // Birds sing by day, and not in the rain.
      untilBird -= dt
      if (untilBird <= 0) {
        untilBird = 1.5 + Math.random() * 4
        const daylight = (1 - night) * (1 - raining)
        if (daylight > 0.3) sing(BIRD_VOLUME * daylight)
      }
    },
  }
}

/**
 * A thud: a low drop in pitch for the weight of the hit, and a burst of noise for
 * the crunch. `strength` from 0 to 1, `pan` from -1 to 1.
 */
export function playThud(context: AudioContext, output: AudioNode, strength: number, pan = 0) {
  const time = context.currentTime + 0.01
  const loudness = 0.25 + strength * 0.6
  const panner = context.createStereoPanner()
  panner.pan.value = pan
  panner.connect(output)

  const thump = context.createOscillator()
  thump.frequency.setValueAtTime(110, time)
  thump.frequency.exponentialRampToValueAtTime(38, time + 0.25)
  const thumpLevel = context.createGain()
  thumpLevel.gain.setValueAtTime(0.0001, time)
  thumpLevel.gain.exponentialRampToValueAtTime(loudness, time + 0.008)
  thumpLevel.gain.exponentialRampToValueAtTime(0.0001, time + 0.35)
  thump.connect(thumpLevel).connect(panner)
  thump.start(time)
  thump.stop(time + 0.4)

  const crunch = context.createBufferSource()
  crunch.buffer = getNoise(context)
  const crunchFilter = context.createBiquadFilter()
  crunchFilter.type = 'bandpass'
  crunchFilter.frequency.value = 700 + strength * 900
  const crunchLevel = context.createGain()
  crunchLevel.gain.setValueAtTime(0.0001, time)
  crunchLevel.gain.exponentialRampToValueAtTime(loudness * 0.6, time + 0.005)
  crunchLevel.gain.exponentialRampToValueAtTime(0.0001, time + 0.18 + strength * 0.2)
  crunch.connect(crunchFilter).connect(crunchLevel).connect(panner)
  crunch.start(time, Math.random() * 0.5)
  crunch.stop(time + 0.5)
}
