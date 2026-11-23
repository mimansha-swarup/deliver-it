import { areaAt, type Area } from '../game/areas'
import { cityEvents } from '../game/cityEvents'
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
 *   events         what's happening on the road nearby (game/cityEvents.ts): a wedding band's drums and
 *                  pipe, the rattle of a breaker at a dug-up road, a cow's moo
 *   homes          on a residential street: now and then a dog barking behind a gate, and at meal times
 *                  (morning, midday, evening) a pressure cooker's whistle from a kitchen
 *   rain           on what's around: drumming on tin awnings along the shops, pattering through
 *                  leaves on the quiet streets, hissing on open tarmac on the main roads
 */

export type AreaState = { x: number; z: number; night: number; rain: number; hours: number; speed: number; indoors: boolean }

const VOLUME = { dog: 0.17, cooker: 0.1, band: 0.3, breaker: 0.16, moo: 0.2, traffic: 0.2, honk: 0.1, music: 0.085, vendor: 0.13, bell: 0.15, birds: 0.1, tin: 0.16, leaves: 0.2, tarmac: 0.14 }
// Sparing, even at a signal: one every several seconds, a few more at rush hour (they were every 3 to 7 s, and under 3 s at rush).
const HONK_EVERY: [number, number] = [6, 15]
const HONK_EVERY_RUSH: [number, number] = [2.5, 6.5]
/** On a residential street: a dog somewhere behind a gate, and a pressure cooker's whistle from a kitchen, every so often (seconds). */
const HOME_SOUND_EVERY: [number, number] = [18, 50]
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

  /** A dog some way off: two to four rough barks, each a falling yelp through a throat's two bands, with a breath of noise. */
  const dogBarks = (volume: number, pan: number) => {
    const to = panned(pan)
    // Behind a wall, down the street: the top is taken off.
    const far = context.createBiquadFilter()
    far.type = 'lowpass'
    far.frequency.value = 1700
    far.connect(to)
    const pitch = 0.8 + Math.random() * 0.5
    let at = context.currentTime + 0.05
    const barks = 2 + Math.floor(Math.random() * 3)
    for (let bark = 0; bark < barks; bark++) {
      const throat = context.createBiquadFilter()
      throat.type = 'bandpass'
      throat.frequency.value = 780 * pitch
      throat.Q.value = 2.2
      throat.connect(far)
      note(throat, at, 430 * pitch, 0.13, volume * 1.6, 'sawtooth', 210 * pitch)
      tick(far, at, 0.09, volume * 0.5, 1200 * pitch)
      at += 0.2 + Math.random() * 0.22 + (bark === 1 ? 0.25 : 0)
    }
  }

  /** A pressure cooker's whistle from a kitchen window: steam hissing up to a breathy whistle for two seconds, cut off short. */
  const cookerWhistle = (volume: number, pan: number) => {
    const to = panned(pan)
    const at = context.currentTime + 0.05
    const length = 1.6 + Math.random() * 1.1
    const steam = context.createBufferSource()
    steam.buffer = getNoise(context)
    steam.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.setValueAtTime(2600, at)
    band.frequency.linearRampToValueAtTime(3500, at + 0.5)
    band.Q.value = 7
    const level = context.createGain()
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(volume, at + 0.45)
    level.gain.setValueAtTime(volume, at + length - 0.12)
    level.gain.linearRampToValueAtTime(0, at + length)
    steam.connect(band).connect(level).connect(to)
    steam.start(at, Math.random() * 0.5)
    steam.stop(at + length + 0.05)
    // The whistle itself, thin, with the flutter of the weight on its vent.
    const whistle = context.createOscillator()
    whistle.type = 'sine'
    whistle.frequency.setValueAtTime(2500, at)
    whistle.frequency.linearRampToValueAtTime(3350, at + 0.5)
    const flutter = context.createOscillator()
    flutter.frequency.value = 23
    const flutterDepth = context.createGain()
    flutterDepth.gain.value = 60
    flutter.connect(flutterDepth).connect(whistle.frequency)
    const whistleLevel = context.createGain()
    whistleLevel.gain.setValueAtTime(0, at)
    whistleLevel.gain.linearRampToValueAtTime(volume * 0.35, at + 0.5)
    whistleLevel.gain.setValueAtTime(volume * 0.35, at + length - 0.1)
    whistleLevel.gain.linearRampToValueAtTime(0, at + length)
    whistle.connect(whistleLevel).connect(to)
    for (const source of [whistle, flutter]) {
      source.start(at)
      source.stop(at + length + 0.05)
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

  /** A wedding band's bar: a dhol's low and high strokes, and a reedy pipe playing a short rising figure of our own. */
  const bandBar = (volume: number, pan: number, bar: number) => {
    const to = panned(pan)
    const start = context.currentTime + 0.04
    const beat = 0.19
    ;[1, 0, 1, 1, 0, 1, 1, 0].forEach((low, step) => {
      const at = start + step * beat
      if (low) note(to, at, 120, 0.16, volume, 'sine', 70)
      tick(to, at + beat / 2, 0.05, volume * 0.5, 1800)
    })
    const figure = [[0, 4, 7, 4], [7, 9, 7, 4], [4, 7, 9, 12], [9, 7, 4, 0]][bar % 4]
    figure.forEach((semitone, index) => note(to, start + index * beat * 2, midiToHz(69 + semitone), beat * 1.9, volume * 0.35, 'sawtooth'))
  }
  /** A breaker at the dug-up road: a second of hammering. */
  const breaker = (volume: number, pan: number) => {
    const to = panned(pan)
    for (let hit = 0; hit < 14; hit++) tick(to, context.currentTime + 0.02 + hit * 0.075, 0.05, volume, 900 + (hit % 2) * 500)
  }
  const moo = (volume: number, pan: number) => {
    const to = panned(pan)
    const at = context.currentTime + 0.03
    const mouth = context.createBiquadFilter()
    mouth.type = 'bandpass'
    mouth.frequency.value = 520
    mouth.Q.value = 2.2
    mouth.connect(to)
    note(mouth, at, 150, 1.5, volume * 3, 'sawtooth', 118)
  }
  let untilEvent = 1
  let bandBars = 0

  let area: Area = { junction: 0, shops: 0, temple: 0, water: 0, vendor: 0, street: null }
  let sinceLook = LOOK_EVERY
  let untilHonk = 2
  let untilHome = 12
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

      // Homes: on a residential street, a dog now and then, and a cooker's whistle at meal times.
      untilHome -= dt
      if (untilHome <= 0) {
        untilHome = between(HOME_SOUND_EVERY) * (1 + night * 0.8)
        if (area.street === 'residential' && !indoors) {
          const mealTime = (hours >= 6.5 && hours < 9.5) || (hours >= 12 && hours < 13.5) || (hours >= 18.5 && hours < 21)
          const pan = Math.random() * 1.6 - 0.8
          if (mealTime && Math.random() < 0.5) cookerWhistle(VOLUME.cooker * (0.6 + Math.random() * 0.4), pan)
          else dogBarks(VOLUME.dog * (0.5 + Math.random() * 0.5), pan)
        }
      }

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

      // What's happening on the road nearby.
      untilEvent -= dt
      if (untilEvent <= 0) {
        untilEvent = 1.6
        const event = cityEvents.active[0]
        const near = event ? Math.max(0, 1 - Math.hypot(event.x - x, event.z - z) / 110) : 0
        if (event && near > 0.03) {
          const pan = Math.max(-0.8, Math.min(0.8, (event.x - x) / 60))
          if (event.kind === 'wedding') {
            untilEvent = 0.19 * 8
            bandBar(VOLUME.band * near * outside, pan, bandBars++)
          } else if (event.kind === 'dig') {
            untilEvent = 2.5 + Math.random() * 3
            breaker(VOLUME.breaker * near * outside, pan)
          } else if (event.kind === 'cow') {
            untilEvent = 7 + Math.random() * 9
            if (near > 0.5) moo(VOLUME.moo * near * outside, pan)
          }
        }
      }

      // Rain on what's around: tin along the shops, leaves on the quiet streets, open tarmac on the main roads (louder at speed).
      const wet = rain * outside
      follow(tin.level.gain, VOLUME.tin * wet * Math.max(area.shops, area.street === 'shop' ? 0.5 : 0))
      follow(leaves.level.gain, VOLUME.leaves * wet * (area.street === 'residential' ? 1 : area.street === null ? 0.6 : 0.15))
      follow(tarmac.level.gain, VOLUME.tarmac * wet * (area.street === 'main' ? 1 : 0.3) * Math.min(1, 0.35 + speed / 12))
    },
  }
}
