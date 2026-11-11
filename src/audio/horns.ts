import { livePlayer } from '../game/livePlayer'
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
}

/** Horns closer than this sound at full volume, in metres. */
const NEAR = 6
/** The most horns sounding at once, so a jam doesn't become noise. */
const MAX_PLAYING = 5
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
  filter.frequency.value = horn.brightness
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

  const oscillators = horn.tones.map((tone) => {
    const oscillator = audio.createOscillator()
    oscillator.type = horn.wave
    oscillator.frequency.value = tone * pitch
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
export function honkPlayerHorn() {
  playHorn('scooter', livePlayer.x, livePlayer.z, livePlayer)
}
