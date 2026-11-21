import { getAudio } from './audioEngine'

/*
 * Short notification sounds for the HUD and phone, made from a couple of sine tones: no files to
 * load. They go through the effects bus, so they follow its volume. A soft rising pair for a new
 * order or message; a quicker, brighter one as a reminder; a sharper, lower one when it's urgent.
 */

export type Ping = 'offer' | 'reminder' | 'message' | 'urgent' | 'nowPlaying' | 'menuMove' | 'menuSelect' | 'menuBack' | 'delivered'

const PINGS: Record<Ping, { notes: number[]; gap: number; length: number; volume: number; wave: OscillatorType }> = {
  offer: { notes: [880, 1320], gap: 0.11, length: 0.22, volume: 0.5, wave: 'sine' },
  // Delivered, but not well: two low notes going down, quietly.
  delivered: { notes: [392, 330], gap: 0.16, length: 0.3, volume: 0.22, wave: 'sine' },
  reminder: { notes: [1320, 1320], gap: 0.09, length: 0.12, volume: 0.45, wave: 'sine' },
  message: { notes: [990, 1180], gap: 0.08, length: 0.16, volume: 0.28, wave: 'sine' },
  urgent: { notes: [620, 520, 620], gap: 0.1, length: 0.14, volume: 0.45, wave: 'triangle' },
  nowPlaying: { notes: [660], gap: 0, length: 0.18, volume: 0.2, wave: 'sine' },
  // The menus: a soft tick moving between buttons, a rising pair choosing one, a falling one going back.
  menuMove: { notes: [740], gap: 0, length: 0.06, volume: 0.16, wave: 'triangle' },
  menuSelect: { notes: [660, 990], gap: 0.06, length: 0.13, volume: 0.3, wave: 'triangle' },
  menuBack: { notes: [620, 470], gap: 0.06, length: 0.11, volume: 0.22, wave: 'triangle' },
}

export function playPing(kind: Ping) {
  const audio = getAudio()
  if (!audio) return
  const { context } = audio
  // The menus' sounds have a bus of their own, which the pause menu doesn't hush.
  const sfx = kind.startsWith('menu') ? audio.ui : audio.sfx
  const { notes, gap, length, volume, wave } = PINGS[kind]
  const start = context.currentTime + 0.01
  notes.forEach((frequency, index) => {
    const at = start + index * gap
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = wave
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.001, at + length)
    oscillator.connect(gain).connect(sfx)
    oscillator.start(at)
    oscillator.stop(at + length + 0.02)
  })
}
