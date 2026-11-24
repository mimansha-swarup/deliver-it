import { liveHorn, livePlayer } from '../game/livePlayer'
import { liveVehicle } from '../vehicle/vehicleCatalog'
import { getAudio } from './audioEngine'
import type { VehicleKind } from '../traffic/trafficLogic'

/**
 * Horns, made in code with the Web Audio API, so there are no sound files.
 *
 * A horn is two or three tones played together, which is what makes the harsh,
 * buzzy sound, shaped by a filter. Each kind has its own pattern of beeps:
 * cars a long blast, autos a nasal double toot, two-wheelers a quick "peep peep".
 */
export type HornVoice = VehicleKind | 'scooter'

type Horn = {
  /** Tones played together, in hertz. */
  tones: number[]
  wave: OscillatorType
  /** How bright it sounds: the filter's cut-off, in hertz. */
  brightness: number
  /** Patterns to pick from, each a list of beep lengths in seconds. */
  patterns: number[][]
  loudness: number
}

const CAR: Horn = {
  tones: [370, 466],
  wave: 'sawtooth',
  brightness: 1900,
  patterns: [[0.45], [0.16, 0.16], [0.9], [0.12, 0.12, 0.4]],
  loudness: 1,
}

const HORNS: Record<HornVoice, Horn> = {
  sedan: CAR,
  hatchback: { ...CAR, tones: [415, 523] },
  suv: { ...CAR, tones: [330, 415], brightness: 1500 },
  // A deep air horn.
  bus: { ...CAR, tones: [220, 277, 330], brightness: 1100 },
  mpv: { ...CAR, tones: [392, 494] },
  auto: {
    tones: [640, 720],
    wave: 'square',
    brightness: 2600,
    patterns: [[0.18, 0.18], [0.3], [0.14, 0.14, 0.14]],
    loudness: 0.75,
  },
  bike: {
    tones: [560, 700],
    wave: 'square',
    brightness: 3000,
    patterns: [[0.1, 0.1], [0.1, 0.1, 0.1], [0.35]],
    loudness: 0.6,
  },
  scooter: {
    tones: [600, 760],
    wave: 'square',
    brightness: 3200,
    patterns: [[0.14, 0.14]],
    loudness: 0.55,
  },
  tempo: { ...CAR, tones: [440, 554], brightness: 2200 },
  // A bicycle bell: two quick high rings.
  cycle: { tones: [1900, 2850], wave: 'sine', brightness: 6000, patterns: [[0.07, 0.07]], loudness: 0.35 },
}

/**
 * Five horns' worth of character, one picked for each honk, so a street isn't one horn over and
 * over: the plain twin-tone; a higher, thinner pair; a low, slow growl; a single shrill note; and a
 * tired old horn whose pitch sags as it blows. `pitch` scales the tones, `spread` moves the second
 * tone away from the first, `bright` scales the filter, `sag` is how far the pitch falls (a share).
 */
const CHARACTERS = [
  { pitch: 1, spread: 1, bright: 1, sag: 0 },
  { pitch: 1.18, spread: 1.04, bright: 1.25, sag: 0 },
  { pitch: 0.8, spread: 0.97, bright: 0.75, sag: 0 },
  { pitch: 1.32, spread: 0, bright: 1.4, sag: 0 },
  { pitch: 0.93, spread: 1.02, bright: 0.85, sag: 0.09 },
]

/** Horns closer than this sound at full volume, in metres. */
const NEAR = 6
/** The most horns sounding at once, so a jam doesn't become noise. */
const MAX_PLAYING = 3
const BEEP_GAP = 0.07

let playing = 0

/** Where the rider is and which way they face. Sounds are placed relative to this. */
export type Listener = { x: number; z: number; heading: number }

/** Plays a horn at a place in the world. Further away is quieter, and it pans left or right. */
export function playHorn(voice: HornVoice, x: number, z: number, listener: Listener) {
  const buses = getAudio()
  if (!buses || playing >= MAX_PLAYING) return
  const audio = buses.context

  const horn = HORNS[voice]
  const offsetX = x - listener.x
  const offsetZ = z - listener.z
  const distance = Math.hypot(offsetX, offsetZ)
  const volume = horn.loudness * Math.min(1, NEAR / Math.max(distance, 0.001))
  if (volume < 0.03) return

  // To the rider's right is (-cos, sin) of their heading, so this is -1 on the left and 1 on the right.
  const right = distance > 0.5
    ? (-offsetX * Math.cos(listener.heading) + offsetZ * Math.sin(listener.heading)) / distance
    : 0

  const start = audio.currentTime + 0.01
  const pattern = horn.patterns[Math.floor(Math.random() * horn.patterns.length)]
  // A slight detune per honk, so two of the same car don't sound identical.
  const pitch = 0.97 + Math.random() * 0.06

  const filter = audio.createBiquadFilter()
  filter.type = 'lowpass'
  const character = voice === 'scooter' ? CHARACTERS[0] : CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
  filter.frequency.value = horn.brightness * character.bright
  const panner = audio.createStereoPanner()
  panner.pan.value = right * 0.8
  const envelope = audio.createGain()
  envelope.gain.value = 0
  filter.connect(envelope).connect(panner).connect(buses.sfx)

  let time = start
  for (const length of pattern) {
    // Quick fades on each beep stop the clicks a sudden start or stop makes.
    envelope.gain.setValueAtTime(0, time)
    envelope.gain.linearRampToValueAtTime(volume, time + 0.012)
    envelope.gain.setValueAtTime(volume, time + length - 0.02)
    envelope.gain.linearRampToValueAtTime(0, time + length)
    time += length + BEEP_GAP
  }

  // A single-note horn plays only its first tone.
  const tones = character.spread === 0 ? horn.tones.slice(0, 1) : horn.tones
  const oscillators = tones.map((tone, index) => {
    const oscillator = audio.createOscillator()
    oscillator.type = horn.wave
    const hz = tone * pitch * character.pitch * (index > 0 ? character.spread : 1)
    oscillator.frequency.setValueAtTime(hz, start)
    if (character.sag > 0) oscillator.frequency.linearRampToValueAtTime(hz * (1 - character.sag), time)
    oscillator.connect(filter)
    oscillator.start(start)
    oscillator.stop(time)
    return oscillator
  })

  playing++
  oscillators[0].onended = () => {
    playing--
    panner.disconnect()
  }
}

/** The rider's own horn, which sounds from right where they are. */
/** The rider's horn: the vehicle's own (vehicleCatalog.ts). A bicycle has a bell. */
export function honkPlayerHorn() {
  liveHorn.at = performance.now()
  const horn = liveVehicle.spec.horn
  if (horn === 'bell') ringBell()
  else playHorn(horn, livePlayer.x, livePlayer.z, livePlayer)
}

/** A bicycle bell: "tring-tring", two bright strikes that ring on. */
function ringBell() {
  const buses = getAudio()
  if (!buses) return
  const { context, sfx } = buses
  for (const [at, pitch] of [[0, 2350], [0.16, 2500]] as const) {
    const start = context.currentTime + 0.01 + at
    for (const [ratio, share, ring] of [[1, 1, 0.9], [2.7, 0.45, 0.5], [5.2, 0.2, 0.25]] as const) {
      const tone = context.createOscillator()
      tone.frequency.value = pitch * ratio
      const level = context.createGain()
      level.gain.setValueAtTime(0, start)
      level.gain.linearRampToValueAtTime(0.16 * share, start + 0.004)
      level.gain.exponentialRampToValueAtTime(0.0001, start + ring)
      tone.connect(level).connect(sfx)
      tone.start(start)
      tone.stop(start + ring + 0.05)
    }
  }
}
