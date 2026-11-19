import { getNoise } from './instruments'

/**
 * Engine sounds, made from oscillators. A small petrol engine is a buzz at the
 * rate its cylinder fires, which climbs with revs, plus the rough hiss of air
 * and exhaust. So each voice is: a buzzing wave at the firing rate, a softer one
 * an octave down for body, filtered noise for the rasp, and a lowpass filter
 * that opens up under throttle, the way an engine gets brighter when you open it up.
 */
export type EngineKind = 'scooter' | 'car' | 'suv' | 'auto' | 'bike' | 'ev' | 'evCargo' | 'thumper' | 'diesel' | 'silent'

type Profile = {
  /** Firing rate at idle and at full revs, in hertz. */
  idleHz: number
  topHz: number
  wave: OscillatorType
  /** How bright it sounds, closed and fully open, in hertz. */
  dullHz: number
  brightHz: number
  /** How much rasp, and how loud overall. */
  rasp: number
  loudness: number
}

const PROFILES: Record<EngineKind, Profile> = {
  // A 110 cc scooter: a busy buzz that rises quickly.
  scooter: { idleHz: 42, topHz: 135, wave: 'sawtooth', dullHz: 500, brightHz: 1900, rasp: 0.12, loudness: 0.5 },
  // Cars hum lower and smoother.
  car: { idleHz: 30, topHz: 78, wave: 'triangle', dullHz: 300, brightHz: 800, rasp: 0.05, loudness: 0.45 },
  // An SUV's bigger diesel: lower still, with more growl and a little clatter.
  suv: { idleHz: 24, topHz: 60, wave: 'sawtooth', dullHz: 220, brightHz: 650, rasp: 0.1, loudness: 0.55 },
  // An auto rickshaw's two-stroke rattle: square, low and raspy.
  auto: { idleHz: 28, topHz: 55, wave: 'square', dullHz: 600, brightHz: 1300, rasp: 0.35, loudness: 0.4 },
  // A commuter motorbike: higher and sharper.
  bike: { idleHz: 45, topHz: 125, wave: 'sawtooth', dullHz: 600, brightHz: 2100, rasp: 0.14, loudness: 0.4 },
  // An electric scooter's motor: no firing at all, a clean whine that climbs a long way with speed.
  ev: { idleHz: 260, topHz: 1500, wave: 'triangle', dullHz: 2600, brightHz: 5200, rasp: 0.012, loudness: 0.16 },
  // An electric cargo three-wheeler: the same whine an octave down, with the gearbox's grind in it.
  evCargo: { idleHz: 130, topHz: 620, wave: 'sawtooth', dullHz: 900, brightHz: 2200, rasp: 0.06, loudness: 0.2 },
  // A 150 cc single: a slow, heavy thump at idle that hardens into a bark.
  thumper: { idleHz: 17, topHz: 92, wave: 'square', dullHz: 340, brightHz: 1700, rasp: 0.2, loudness: 0.55 },
  // A loaded van's diesel: low, clattering, never high.
  diesel: { idleHz: 19, topHz: 48, wave: 'sawtooth', dullHz: 260, brightHz: 720, rasp: 0.3, loudness: 0.6 },
  // Nothing: a bicycle. Its chain and freewheel are PlayerSounds' ticks.
  silent: { idleHz: 40, topHz: 60, wave: 'sine', dullHz: 200, brightHz: 300, rasp: 0, loudness: 0 },
}

/** How quickly the sound follows the engine, in seconds. Small, so revs sound smooth. */
const FOLLOW = 0.06

export type EngineVoice = {
  /** `revs` and `throttle` go from 0 to 1. `volume` is overall loudness, and `pan` from -1 left to 1 right. */
  update: (revs: number, throttle: number, volume: number, pan?: number) => void
  setKind: (kind: EngineKind) => void
  dispose: () => void
}

export function createEngineVoice(context: AudioContext, output: AudioNode, kind: EngineKind): EngineVoice {
  let profile = PROFILES[kind]

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 1.5
  const level = context.createGain()
  level.gain.value = 0
  const panner = context.createStereoPanner()
  filter.connect(level).connect(panner).connect(output)

  const buzz = context.createOscillator()
  const body = context.createOscillator()
  const bodyLevel = context.createGain()
  bodyLevel.gain.value = 0.6
  buzz.connect(filter)
  body.connect(bodyLevel).connect(filter)

  const rasp = context.createBufferSource()
  rasp.buffer = getNoise(context)
  rasp.loop = true
  const raspFilter = context.createBiquadFilter()
  raspFilter.type = 'bandpass'
  raspFilter.frequency.value = 1400
  raspFilter.Q.value = 0.8
  const raspLevel = context.createGain()
  rasp.connect(raspFilter).connect(raspLevel).connect(filter)

  const setKind = (next: EngineKind) => {
    profile = PROFILES[next]
    buzz.type = profile.wave
    body.type = profile.wave === 'triangle' ? 'sine' : 'square'
    raspLevel.gain.value = profile.rasp
  }
  setKind(kind)

  const now = context.currentTime
  buzz.start(now)
  body.start(now)
  rasp.start(now, Math.random())

  return {
    update: (revs, throttle, volume, pan = 0) => {
      const time = context.currentTime
      const hz = profile.idleHz + (profile.topHz - profile.idleHz) * revs
      buzz.frequency.setTargetAtTime(hz, time, FOLLOW)
      body.frequency.setTargetAtTime(hz / 2, time, FOLLOW)
      const open = Math.min(1, revs * 0.5 + throttle * 0.6)
      filter.frequency.setTargetAtTime(profile.dullHz + (profile.brightHz - profile.dullHz) * open, time, FOLLOW)
      // Louder under throttle, as an engine working is louder than one coasting.
      level.gain.setTargetAtTime(volume * profile.loudness * (0.55 + 0.45 * throttle), time, FOLLOW)
      panner.pan.setTargetAtTime(pan, time, FOLLOW)
    },
    setKind,
    dispose: () => {
      for (const source of [buzz, body, rasp]) source.stop()
      panner.disconnect()
    },
  }
}
