import { getNoise } from './instruments'

/**
 * The sound of the neighbourhood, all made in code:
 * - a low rumble of distant traffic, which is how a city sounds from any street
 * - rain, a hiss that follows how hard it's raining
 * - birds by day: short rising chirps, now and then
 * - crickets at night: a high note, pulsing quickly
 * - tyre skid, a scrubbing noise that follows how much the scooter is sliding
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

export function createAmbience(context: AudioContext, output: AudioNode) {
  const rumble = noiseLoop(context, 'lowpass', 260)
  const rain = noiseLoop(context, 'highpass', 1500)
  const skid = noiseLoop(context, 'bandpass', 950, 1.6)
  for (const { level } of [rumble, rain, skid]) level.connect(output)

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

  const follow = (param: AudioParam, value: number) => param.setTargetAtTime(value, context.currentTime, 0.25)

  return {
    update: ({ night, rain: raining, slide }: AmbienceState, dt: number) => {
      // The city is quieter at night, and the rain partly drowns it.
      follow(rumble.level.gain, RUMBLE_VOLUME * (1 - night * 0.5))
      follow(rain.level.gain, RAIN_VOLUME * raining)
      follow(cricketLevel.gain, CRICKET_VOLUME * night * (1 - raining))
      const skidAmount = Math.min(1, Math.max(0, (slide - SKID_START) / (SKID_FULL - SKID_START)))
      skid.level.gain.setTargetAtTime(SKID_VOLUME * skidAmount, context.currentTime, 0.05)

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
