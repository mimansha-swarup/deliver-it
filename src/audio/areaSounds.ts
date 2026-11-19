import { areaAt, type Area } from '../game/areas'
import { rushHour } from '../game/rush'
import { noiseLoop } from './ambience'
import { getNoise, midiToHz } from './instruments'

/*
 * The sound of where you are, on top of the city's general hum (ambience.ts) and Agara's own
 * sounds (placeSounds.ts). All of it is made here; nothing is recorded, and the tune is our own.
 *
 *   traffic        a wash of passing traffic, loud on a main road, thinner on a shop street, faint on a residential one
 *   junctions      horns at every signal: a blast every few seconds, thick at rush hour
 *   shop music     near a run of shops by day: a small speaker playing a bright looping tune
 *   vendors        near a cart: a seller's two-note cry, a hand bell, a rubber horn
 *   temple bells   near any temple, in its opening hours
 *   lake birds     by the water, by day: coots, a lapwing, a kingfisher's rattle
 *   rain           on what's around: drumming on tin awnings along the shops, pattering through
 *                  leaves on the quiet streets, hissing on open tarmac on the main roads
 */

export type AreaState = { x: number; z: number; night: number; rain: number; hours: number; speed: number; indoors: boolean }

const VOLUME = { traffic: 0.2, honk: 0.1, music: 0.085, vendor: 0.13, bell: 0.15, birds: 0.1, tin: 0.16, leaves: 0.2, tarmac: 0.14 }
const HONK_EVERY: [number, number] = [2.8, 7.5]
const HONK_EVERY_RUSH: [number, number] = [0.9, 2.8]
const VENDOR_EVERY: [number, number] = [5, 12]
const BELL_EVERY: [number, number] = [6, 14]
const BIRD_EVERY: [number, number] = [1.2, 4.5]
/** How often where the rider is gets looked up, in seconds. */
const LOOK_EVERY = 0.4

const between = ([low, high]: [number, number]) => low + Math.random() * (high - low)

/** The shop radio's tune: a bright pentatonic melody of our own, eight bars, with a bass note under each bar. */
const SCALE = [0, 2, 4, 7, 9]
const TUNE = [
  [0, 2, 4, 2, 0, -1, 4, 5],
  [4, 5, 7, 5, 4, 2, 0, -1],
  [2, 4, 5, 4, 2, 0, 2, 4],
  [5, 4, 2, 0, 2, -1, 0, -1],
]
const BASS = [0, 3, 1, 0]
const STEP = 0.21

export function createAreaSounds(context: AudioContext, output: AudioNode) {
  // Passing traffic: a band of noise that swells and thins by itself, and by the street.
  const traffic = noiseLoop(context, 'bandpass', 420, 0.5)
  traffic.level.connect(output)
  const swell = context.createOscillator()
  swell.frequency.value = 0.11
  const swellDepth = context.createGain()
  swellDepth.gain.value = 0
  swell.connect(swellDepth).connect(traffic.level.gain)
  swell.start()

  // Rain on things.
  const tin = noiseLoop(context, 'bandpass', 4200, 1.4)
  const leaves = noiseLoop(context, 'bandpass', 1500, 0.6)
  const tarmac = noiseLoop(context, 'highpass', 3200)
  for (const loop of [tin, leaves, tarmac]) loop.level.connect(output)

  // The shop's little speaker: everything through a narrow band, so it's tinny and across the road.
  const speaker = context.createBiquadFilter()
  speaker.type = 'bandpass'
  speaker.frequency.value = 1500
  speaker.Q.value = 0.9
  const musicLevel = context.createGain()
  musicLevel.gain.value = 0
  const musicPan = context.createStereoPanner()
  speaker.connect(musicLevel).connect(musicPan).connect(output)

  const note = (to: AudioNode, at: number, hz: number, length: number, volume: number, wave: OscillatorType = 'triangle', slideTo?: number) => {
    const tone = context.createOscillator()
    tone.type = wave
    tone.frequency.setValueAtTime(hz, at)
    if (slideTo) tone.frequency.exponentialRampToValueAtTime(slideTo, at + length)
    const level = context.createGain()
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(volume, at + 0.012)
    level.gain.exponentialRampToValueAtTime(0.0001, at + length)
    tone.connect(level).connect(to)
    tone.start(at)
    tone.stop(at + length + 0.03)
  }
  const tick = (to: AudioNode, at: number, length: number, volume: number, frequency: number) => {
    const source = context.createBufferSource()
    source.buffer = getNoise(context)
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    const level = context.createGain()
    level.gain.setValueAtTime(volume, at)
    level.gain.exponentialRampToValueAtTime(0.0001, at + length)
    source.connect(filter).connect(level).connect(to)
    source.start(at, Math.random() * 0.5)
    source.stop(at + length + 0.02)
  }
  const panned = (pan: number) => {
    const panner = context.createStereoPanner()
    panner.pan.value = pan
    panner.connect(output)
    return panner
  }

  /** One bar of the shop's tune, scheduled a little ahead. */
  const playBar = (bar: number, key: number) => {
    const start = context.currentTime + 0.05
    const line = TUNE[bar % TUNE.length]
    line.forEach((degree, step) => {
      const at = start + step * STEP
      if (degree >= 0) note(speaker, at, midiToHz(key + 12 + SCALE[degree % 5] + 12 * Math.floor(degree / 5)), STEP * 1.6, 0.5, 'square')
      // A dholak-like pattern under it: low on the beat, a light slap between.
      if (step % 4 === 0) note(speaker, at, 150, 0.12, 0.6, 'sine', 90)
      else if (step % 2 === 1) tick(speaker, at, 0.04, 0.35, 2600)
    })
    note(speaker, start, midiToHz(key - 12 + SCALE[BASS[bar % BASS.length]]), STEP * 7, 0.35, 'triangle')
  }

  /** A horn at a signal: two notes together, a short blast or two. */
  const honk = (volume: number, pan: number) => {
    const base = 340 + Math.random() * 190
    const to = panned(pan)
    for (let blast = 0; blast < (Math.random() < 0.35 ? 2 : 1); blast++) {
      const at = context.currentTime + 0.02 + blast * 0.3
      const length = 0.12 + Math.random() * 0.28
      for (const ratio of [1, 1.26]) note(to, at, base * ratio, length + 0.05, volume * 0.7, 'square')
    }
  }

  /** A seller's cry: a voice-like tone through two vowel bands, long and falling; or the ice-candy man's bell; or a rubber horn. */
  const vendorCall = (volume: number, pan: number) => {
    const to = panned(pan)
    const kind = Math.random()
    const at = context.currentTime + 0.03
    if (kind < 0.55) {
      const mouth = context.createBiquadFilter()
      mouth.type = 'bandpass'
      mouth.frequency.value = 760 + Math.random() * 250
      mouth.Q.value = 3.5
      const nose = context.createBiquadFilter()
      nose.type = 'bandpass'
      nose.frequency.value = 1350 + Math.random() * 300
      nose.Q.value = 5
      mouth.connect(to)
      nose.connect(to)
      const pitch = 170 + Math.random() * 90
      // Two or three syllables, the last one held and dropping, as a street cry goes.
      const syllables = Math.random() < 0.5 ? [[0, 0.22, 1.12], [0.3, 0.75, 1]] : [[0, 0.18, 1.2], [0.24, 0.18, 1.2], [0.5, 0.8, 1]]
      for (const [offset, length, lift] of syllables) {
        for (const filter of [mouth, nose]) note(filter, at + offset, pitch * lift, length, volume * 2.2, 'sawtooth', pitch * lift * (length > 0.5 ? 0.82 : 0.97))
      }
    } else if (kind < 0.8) {
      // A hand bell: three quick rings.
      for (let ring = 0; ring < 3; ring++) for (const [ratio, share] of [[1, 1], [2.7, 0.5], [5.2, 0.2]]) note(to, at + ring * 0.19, 1900 * ratio, 0.3, volume * 0.5 * share, 'sine')
    } else {
      // A rubber bulb horn: pom-pom.
      for (const offset of [0, 0.3]) note(to, at + offset, 290, 0.2, volume * 0.9, 'square', 240)
    }
  }

  const bell = (volume: number, pitch: number, pan: number) => {
    const to = panned(pan)
    const at = context.currentTime + 0.02
    for (const [ratio, share, ring] of [[1, 1, 3], [2.02, 0.55, 2.1], [2.76, 0.4, 1.5], [4.1, 0.2, 0.9]] as const) note(to, at, pitch * ratio, ring, volume * share, 'sine')
  }

  /** A water bird: a coot's sharp "kik", a lapwing's four notes, or a kingfisher's rattle. */
  const waterBird = (volume: number, pan: number) => {
    const to = panned(pan)
    const at = context.currentTime + 0.02
    const kind = Math.random()
    if (kind < 0.5) {
      for (let call = 0; call < 1 + Math.floor(Math.random() * 3); call++) note(to, at + call * 0.22, 1500 + Math.random() * 200, 0.07, volume, 'square', 1150)
    } else if (kind < 0.8) {
      // "Did-he-do-it".
      ;[2500, 2900, 2500, 2300].forEach((hz, index) => note(to, at + index * 0.15, hz, 0.11, volume * 0.8, 'sine', hz * 0.88))
    } else {
      for (let chip = 0; chip < 9; chip++) note(to, at + chip * 0.055, 3600 - chip * 60, 0.035, volume * 0.6, 'sine')
    }
  }

  let area: Area = { junction: 0, shops: 0, temple: 0, water: 0, vendor: 0, street: null }
  let sinceLook = LOOK_EVERY
  let untilHonk = 2
  let untilVendor = 4
  let untilBell = 3
  let untilBird = 2
  let untilBar = 0
  let bar = 0
  let key = 62
  let musicOn = false

  return {
    update: ({ x, z, night, rain, hours, speed, indoors }: AreaState, dt: number) => {
      const now = context.currentTime
      const follow = (gain: AudioParam, value: number, over = 0.5) => gain.setTargetAtTime(value, now, over)
      sinceLook += dt
      if (sinceLook >= LOOK_EVERY) {
        sinceLook = 0
        area = areaAt(x, z)
      }
      // In a room, the street is behind a wall.
      const outside = indoors ? 0.12 : 1
      const day = 1 - night

      // Traffic by the street: its level, and how much it swells as things pass.
      const busy = (area.street === 'main' ? 1 : area.street === 'shop' ? 0.6 : area.street === 'residential' ? 0.22 : 0.12) * (1 - night * 0.65) * (0.75 + 0.25 * rushHour(hours))
      follow(traffic.level.gain, VOLUME.traffic * busy * outside, 0.9)
      follow(swellDepth.gain, VOLUME.traffic * busy * outside * 0.45, 0.9)

      // Horns at the signal.
      untilHonk -= dt
      if (untilHonk <= 0) {
        const rush = rushHour(hours)
        untilHonk = between([HONK_EVERY[0] + (HONK_EVERY_RUSH[0] - HONK_EVERY[0]) * rush, HONK_EVERY[1] + (HONK_EVERY_RUSH[1] - HONK_EVERY[1]) * rush]) * (1 + night * 2.5)
        if (area.junction > 0.05) honk(VOLUME.honk * (0.3 + 0.7 * area.junction) * outside, Math.random() * 1.8 - 0.9)
      }

      // The shop's music: by day and into the evening, along a run of shops.
      const open = hours >= 9 && hours < 21.5
      const music = open && area.street !== 'main' ? Math.max(0, area.shops - 0.35) / 0.65 : 0
      follow(musicLevel.gain, VOLUME.music * music * outside, 1.2)
      if (music > 0.02 && !musicOn) {
        // A different shop, a different key and side of the road.
        musicOn = true
        key = 57 + Math.floor(Math.random() * 7)
        musicPan.pan.value = Math.random() < 0.5 ? -0.55 : 0.55
        bar = 0
        untilBar = 0
      } else if (music <= 0.02) musicOn = false
      untilBar -= dt
      if (musicOn && untilBar <= 0) {
        untilBar = STEP * 8
        playBar(bar++, key)
      }

      // A vendor's cry, near a cart, by day.
      untilVendor -= dt
      if (untilVendor <= 0) {
        untilVendor = between(VENDOR_EVERY)
        if (area.vendor > 0.05 && hours >= 6.5 && hours < 20.5) vendorCall(VOLUME.vendor * (0.35 + 0.65 * area.vendor) * outside, Math.random() * 1.6 - 0.8)
      }

      // A temple's bell, in its hours; more at the morning and evening aarti.
      untilBell -= dt
      if (untilBell <= 0) {
        const aarti = (hours >= 6 && hours < 8) || (hours >= 18 && hours < 20)
        untilBell = between(BELL_EVERY) * (aarti ? 0.4 : 1)
        if (area.temple > 0.05 && hours >= 5 && hours < 21.5) bell(VOLUME.bell * area.temple * area.temple * outside, 430 + ((Math.round(x / 97) * 31) % 5) * 45, Math.random() * 1.2 - 0.6)
      }

      // Birds on the water.
      untilBird -= dt
      if (untilBird <= 0) {
        untilBird = between(BIRD_EVERY) * (1 + night * 6)
        if (area.water > 0.05 && day > 0.2) waterBird(VOLUME.birds * area.water * outside * (0.6 + 0.4 * Math.random()), Math.random() * 1.8 - 0.9)
      }

      // Rain on what's around: tin along the shops, leaves on the quiet streets, open tarmac on the main roads (louder at speed).
      const wet = rain * outside
      follow(tin.level.gain, VOLUME.tin * wet * Math.max(area.shops, area.street === 'shop' ? 0.5 : 0))
      follow(leaves.level.gain, VOLUME.leaves * wet * (area.street === 'residential' ? 1 : area.street === null ? 0.6 : 0.15))
      follow(tarmac.level.gain, VOLUME.tarmac * wet * (area.street === 'main' ? 1 : 0.3) * Math.min(1, 0.35 + speed / 12))
    },
  }
}
