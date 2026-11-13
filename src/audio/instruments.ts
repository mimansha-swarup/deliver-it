/**
 * Instruments built from Web Audio parts. Each function schedules one note at
 * an exact time on the audio clock, then lets the nodes clean themselves up.
 *
 * Every sound here is one of three recipes:
 * - Drums are a quick pitch drop on a sine wave (kick, tabla's bass drum) or a
 *   burst of noise through a filter (snare, hi-hat, tabla's rim strokes).
 * - Tones are oscillators shaped by a volume envelope: rise, hold, fade.
 * - Plucks also sweep a filter down, which is what makes a string sound plucked.
 */

/** A MIDI note number as a frequency. 69 is the A above middle C, at 440 Hz. */
export function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

/** One second of white noise, made once and shared by every drum. */
export function getNoise(context: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(context)
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1
    noiseBuffers.set(context, buffer)
  }
  return buffer
}

/** A volume envelope: up to `peak` in `attack` seconds, then down to nothing by `end`. */
function envelope(context: BaseAudioContext, time: number, peak: number, attack: number, end: number) {
  const gain = context.createGain()
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(peak, time + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  return gain
}

function noiseBurst(
  output: AudioNode,
  time: number,
  length: number,
  filterType: BiquadFilterType,
  frequency: number,
  volume: number,
  q = 1,
) {
  const context = output.context
  const source = context.createBufferSource()
  source.buffer = getNoise(context)
  const filter = context.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = frequency
  filter.Q.value = q
  const gain = envelope(context, time, volume, 0.002, time + length)
  source.connect(filter).connect(gain).connect(output)
  source.start(time, Math.random() * 0.5)
  source.stop(time + length + 0.02)
}

/** A sine wave whose pitch drops fast: the thump of a kick drum. */
export function kick(output: AudioNode, time: number, volume = 0.9) {
  const context = output.context
  const oscillator = context.createOscillator()
  oscillator.frequency.setValueAtTime(130, time)
  oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12)
  const gain = envelope(context, time, volume, 0.004, time + 0.38)
  oscillator.connect(gain).connect(output)
  oscillator.start(time)
  oscillator.stop(time + 0.4)
}

export function snare(output: AudioNode, time: number, volume = 0.35) {
  noiseBurst(output, time, 0.18, 'bandpass', 1900, volume, 0.7)
  const context = output.context
  const body = context.createOscillator()
  body.type = 'triangle'
  body.frequency.setValueAtTime(190, time)
  const gain = envelope(context, time, volume * 0.6, 0.002, time + 0.09)
  body.connect(gain).connect(output)
  body.start(time)
  body.stop(time + 0.1)
}

export function hat(output: AudioNode, time: number, volume = 0.12, open = false) {
  noiseBurst(output, time, open ? 0.22 : 0.045, 'highpass', 7500, volume)
}

/** Lo-fi's crackle: a tiny click, scattered at random. */
export function crackle(output: AudioNode, time: number) {
  noiseBurst(output, time, 0.012, 'highpass', 2500, 0.05 + Math.random() * 0.05)
}

export type TablaStroke = 'dha' | 'dhin' | 'ge' | 'na' | 'tin' | 'ka' | 'ti'

/**
 * The tabla is two drums. The small one (dayan) rings at a clear pitch, and
 * the big one (bayan) booms, with a pitch that slides up as the palm presses
 * the skin. Each stroke name is one drum, the other, or both.
 */
export function tabla(output: AudioNode, time: number, stroke: TablaStroke, tonic: number, volume = 0.5) {
  const context = output.context
  const dayan = stroke === 'na' || stroke === 'tin' || stroke === 'dha' || stroke === 'dhin'
  const bayan = stroke === 'ge' || stroke === 'dha' || stroke === 'dhin'
  const muted = stroke === 'ka' || stroke === 'ti'

  if (dayan) {
    const ring = context.createOscillator()
    ring.frequency.value = midiToHz(tonic + 24)
    const length = stroke === 'tin' || stroke === 'dhin' ? 0.5 : 0.22
    const gain = envelope(context, time, volume * 0.5, 0.002, time + length)
    ring.connect(gain).connect(output)
    ring.start(time)
    ring.stop(time + length + 0.02)
    noiseBurst(output, time, 0.03, 'bandpass', 3200, volume * 0.35, 2)
  }
  if (bayan) {
    const boom = context.createOscillator()
    boom.frequency.setValueAtTime(70, time)
    boom.frequency.exponentialRampToValueAtTime(105, time + 0.25)
    const gain = envelope(context, time, volume * 0.9, 0.004, time + 0.45)
    boom.connect(gain).connect(output)
    boom.start(time)
    boom.stop(time + 0.5)
  }
  if (muted) noiseBurst(output, time, 0.05, 'bandpass', stroke === 'ka' ? 900 : 2400, volume * 0.4, 3)
}

type ToneOptions = {
  wave?: OscillatorType
  volume?: number
  attack?: number
  /** Brightness: the filter's cut-off, in hertz. */
  cutoff?: number
  /** Extra oscillators at these semitone offsets, such as 12 for an octave up. */
  layers?: number[]
  /** Slightly out of tune copies, in cents, which make a tone sound wide and warm. */
  detune?: number
}

/** A held note, such as a chord, a bass note or a pad. */
export function tone(output: AudioNode, time: number, note: number, length: number, options: ToneOptions = {}) {
  const { wave = 'sine', volume = 0.2, attack = 0.01, cutoff = 2000, layers = [0], detune = 0 } = options
  const context = output.context
  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  const gain = envelope(context, time, volume, attack, time + length)
  filter.connect(gain).connect(output)

  for (const layer of layers) {
    for (const cents of detune ? [-detune, detune] : [0]) {
      const oscillator = context.createOscillator()
      oscillator.type = wave
      oscillator.frequency.value = midiToHz(note + layer)
      oscillator.detune.value = cents
      oscillator.connect(filter)
      oscillator.start(time)
      oscillator.stop(time + length + 0.05)
    }
  }
}

/**
 * A plucked string. The filter starts bright and closes, as a real string's
 * high notes die first. `slide` starts the note this many semitones below and
 * glides up, like a sitar's meend.
 */
export function pluck(output: AudioNode, time: number, note: number, length: number, volume = 0.18, slide = 0) {
  const context = output.context
  const oscillator = context.createOscillator()
  oscillator.type = 'sawtooth'
  const target = midiToHz(note)
  oscillator.frequency.setValueAtTime(slide ? midiToHz(note - slide) : target, time)
  if (slide) oscillator.frequency.exponentialRampToValueAtTime(target, time + 0.12)

  const filter = context.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 4
  filter.frequency.setValueAtTime(4200, time)
  filter.frequency.exponentialRampToValueAtTime(500, time + Math.min(length, 0.6))

  const gain = envelope(context, time, volume, 0.004, time + length)
  oscillator.connect(filter).connect(gain).connect(output)
  oscillator.start(time)
  oscillator.stop(time + length + 0.05)
}
