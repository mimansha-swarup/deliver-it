import { getAudioEvenIfPaused } from './audioEngine'
import type { CodeStation } from './stations'

/** How often the scheduler wakes up, in milliseconds. */
const WAKE_EVERY = 25
/** How far ahead it books notes, in seconds. Longer than a wake-up, so none are missed. */
const BOOK_AHEAD = 0.12
/** A new station fades in over this long, in seconds. */
const FADE_IN = 1.2

/**
 * Plays a code station.
 *
 * JavaScript timers drift by tens of milliseconds, which is easily heard in a
 * beat. So the timer only wakes the scheduler up. Each note is booked on the
 * audio clock, `context.currentTime`, which is exact, a little ahead of when it
 * should sound. This is the standard way to keep time in the browser.
 */
let timer: number | null = null
let output: GainNode | null = null

export function stopStation() {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (output) {
    const fading = output
    const now = fading.context.currentTime
    fading.gain.setTargetAtTime(0, now, 0.15)
    window.setTimeout(() => fading.disconnect(), 1000)
  }
  output = null
}

export function playStation(station: CodeStation) {
  stopStation()
  // The clock may still be starting up just after the first tap. Notes booked now play once it runs.
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses

  // Each station gets its own fader into the music bus, so the old one can fade
  // out while the new one fades in.
  const fader = context.createGain()
  fader.gain.setValueAtTime(0.0001, context.currentTime)
  fader.gain.exponentialRampToValueAtTime(1, context.currentTime + FADE_IN)
  fader.connect(music)
  output = fader

  const play = station.start()
  const stepLength = 60 / station.tempo / 4
  let step = 0
  let bar = 0
  let nextStep = context.currentTime + 0.05

  const book = () => {
    // After the tab was in the background, skip ahead rather than playing a backlog.
    if (nextStep < context.currentTime) nextStep = context.currentTime + 0.05
    while (nextStep < context.currentTime + BOOK_AHEAD) {
      const swung = step % 2 === 1 ? station.swing * stepLength : 0
      play(fader, nextStep + swung, step, bar, stepLength)
      nextStep += stepLength
      step = (step + 1) % 16
      if (step === 0) bar++
    }
  }

  book()
  timer = window.setInterval(book, WAKE_EVERY)
}
