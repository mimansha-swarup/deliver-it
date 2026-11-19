import { getAudio } from './audioEngine'

/*
 * Sounds at a door, made here like the rest (no recordings): a two-note doorbell, a dog's bark
 * behind a gate, a lift's chime, feet on stairs, and a pen's scratch for a register.
 */

function tone(frequency: number, at: number, length: number, volume: number, wave: OscillatorType = 'sine', slideTo?: number) {
  const audio = getAudio()
  if (!audio) return
  const { context, sfx } = audio
  const start = context.currentTime + at
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = wave
  oscillator.frequency.setValueAtTime(frequency, start)
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + length)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.001, start + length)
  oscillator.connect(gain).connect(sfx)
  oscillator.start(start)
  oscillator.stop(start + length + 0.03)
}

function noise(at: number, length: number, volume: number, lowpass: number, highpass = 80) {
  const audio = getAudio()
  if (!audio) return
  const { context, sfx } = audio
  const start = context.currentTime + at
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const source = context.createBufferSource()
  source.buffer = buffer
  const low = context.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = lowpass
  const high = context.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = highpass
  const gain = context.createGain()
  gain.gain.value = volume
  source.connect(low).connect(high).connect(gain).connect(sfx)
  source.start(start)
}

/** Ding-dong: two soft bell notes, each with an octave above it. */
export function playDoorbell() {
  for (const [frequency, at] of [[659, 0], [523, 0.42]] as const) {
    tone(frequency, at, 1.1, 0.5)
    tone(frequency * 2, at, 0.6, 0.14)
    tone(frequency * 3.01, at, 0.3, 0.05)
  }
}

/** A dog barking behind a gate: `times` barks, each a rough falling yelp over a breath of noise. */
export function playBarks(times = 3) {
  let at = 0
  for (let bark = 0; bark < times; bark++) {
    const pitch = 300 + Math.random() * 90
    tone(pitch, at, 0.13, 0.5, 'sawtooth', pitch * 0.55)
    tone(pitch * 1.9, at, 0.1, 0.16, 'square', pitch)
    noise(at, 0.12, 0.5, 2400, 500)
    at += 0.26 + Math.random() * 0.3
  }
}

/** A lift arriving: one bright chime, and the doors' rumble. */
export function playLift() {
  noise(0, 0.9, 0.25, 420)
  tone(1320, 0.75, 0.8, 0.32)
  tone(1760, 0.75, 0.5, 0.1)
}

/** Feet going up stairs: `steps` soft thuds. */
export function playStairs(steps: number) {
  for (let step = 0; step < steps; step++) noise(step * 0.3, 0.09, 0.42, 700 + (step % 2) * 160, 90)
}

/** A pen on a register. */
export function playPen() {
  for (let stroke = 0; stroke < 5; stroke++) noise(stroke * 0.16 + Math.random() * 0.04, 0.11, 0.2, 5200, 2200)
}
