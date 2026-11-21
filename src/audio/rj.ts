import { create } from 'zustand'
import type { CityEventKind } from '../game/cityEvents'
import { rushHour } from '../game/rush'
import { getAudioEvenIfPaused } from './audioEngine'
import { lineText, pickLine, readingTime, speak, VOICE_LINES, type Playing } from './voice'

/*
 * The radio's voice: RJ Manju (made up, like the stations), who comes on between the music with a
 * short traffic update in Kanglish, or an ad for a local business that doesn't exist. Every name
 * in here is invented.
 *
 * A break is a few recorded lines in a row (audio/voice.ts; their words are in voiceScript.json): a
 * hello, what the roads are doing, the rain if it's raining, a sign-off; or one ad. It opens with
 * the station's ident (a short plucked tune that plays her in), two soft notes separate the
 * lines, and she speaks over the station's own music turned down, as on a real station. The voice
 * comes through the radio's own filter and compressor.
 *
 * The words are on the phone as they're said. A line that hasn't been recorded yet is only there,
 * for as long as it takes to read: the browser's speech synthesis, which this used to use, is gone.
 */

export const RJ_NAME = 'RJ Manju'

/** What's being said on air now, for the phone to show. */
export const useOnAir = create<{ line: { id: number; station: string; kind: 'traffic' | 'ad'; text: string } | null }>(() => ({ line: null }))

/** What the update can talk about: the time, the weather, and anything happening on the roads (game/cityEvents.ts). */
export type RoadReport = { hours: number; rain: number; night: boolean; events: { kind: CityEventKind; road: string }[] }
export const roadReport: { get: () => RoadReport } = { get: () => ({ hours: 9, rain: 0, night: false, events: [] }) }

/** One line of a break: which recording, and its words on the phone (the road's name is only there: a recording can't know it). */
type Segment = { id: string; text: string }
const segment = (prefix: string, more = ''): Segment => {
  const line = pickLine(prefix)
  return { id: line.id, text: line.line + more }
}

/** A traffic update: hello, what's on the roads (an event first, else the hour's traffic), the rain, goodbye. Four short lines at most. */
function trafficUpdate({ hours, rain, night, events }: RoadReport): Segment[] {
  const lines = [segment('manju.hello')]
  const event = events[0]
  if (event) lines.push(segment(`manju.event.${event.kind}`, event.road ? ` (${event.road}.)` : ''))
  else if (rushHour(hours) > 0.4) lines.push(segment('manju.rush'))
  else if (night) lines.push(segment('manju.night'))
  else lines.push(segment('manju.free'))
  if (rain > 0.3) lines.push(segment('manju.rain'))
  lines.push(segment('manju.bye'))
  return lines
}

/** Ads for businesses that don't exist, in turn. */
const ADS = VOICE_LINES.filter(({ id }) => id.startsWith('manju.ad.')).map(({ id }) => id)

/**
 * The station's ident, before she speaks: a little tune, as a radio station plays you in before its
 * RJ. Ten plucked notes in D major over four soft bass notes, about four and a half seconds, ending
 * on a held high D with an echo that lets it ring. Each note is plucked and dies away (nothing is
 * held: held notes droned like a harmonium). She waits for it. Composed here; on the music bus.
 */
const EIGHTH = 0.3
/** The tune: [when, in eighths of a beat; pitch in Hz; how long it rings, in seconds]. */
const IDENT_TUNE: [number, number, number][] = [
  [0, 370, 0.5], [1, 440, 0.5], [2, 587.3, 0.9],
  [4, 493.9, 0.5], [5, 440, 0.5], [6, 370, 0.9],
  [8, 329.6, 0.5], [9, 370, 0.5], [10, 440, 0.7],
  [12, 587.3, 1.6],
]
/** Under it, one soft low note a bar: D, G, A, D. */
const IDENT_BASS: [number, number][] = [[0, 146.8], [4, 196], [8, 220], [12, 146.8]]
const IDENT_SECONDS = 12 * EIGHTH + 1.0
function jingle() {
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses
  const start = context.currentTime + 0.05
  // Everything through one soft filter, and an echo that fades on its own.
  const soften = context.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = 2600
  const echo = context.createDelay(1)
  echo.delayTime.value = EIGHTH * 1.5
  const again = context.createGain()
  again.gain.value = 0.25
  soften.connect(music)
  soften.connect(echo).connect(again).connect(echo)
  again.connect(music)
  const pluck = (at: number, hz: number, rings: number, loud: number, type: OscillatorType) => {
    const tone = context.createOscillator()
    tone.type = type
    tone.frequency.value = hz
    const level = context.createGain()
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(loud, at + 0.012)
    level.gain.exponentialRampToValueAtTime(0.0001, at + rings)
    tone.connect(level).connect(soften)
    tone.start(at)
    tone.stop(at + rings + 0.05)
  }
  for (const [when, hz, rings] of IDENT_TUNE) {
    const at = start + when * EIGHTH
    // A plucked string: the note, and a quieter octave over it that dies sooner.
    pluck(at, hz, rings, 0.2, 'triangle')
    pluck(at, hz * 2, rings * 0.5, 0.05, 'sine')
  }
  for (const [when, hz] of IDENT_BASS) pluck(start + when * EIGHTH, hz, 1.1, 0.16, 'sine')
  window.setTimeout(() => {
    soften.disconnect()
    again.disconnect()
  }, (IDENT_SECONDS + 4) * 1000)
}

/** Between two lines of a break, and at its end: two soft notes of the ident, quieter than it. */
function sting() {
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses
  const start = context.currentTime + 0.02
  ;[440, 587.3].forEach((hz, index) => {
    const at = start + index * 0.16
    const tone = context.createOscillator()
    tone.type = 'sine'
    tone.frequency.value = hz
    const level = context.createGain()
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(0.11, at + 0.03)
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.7)
    tone.connect(level).connect(music)
    tone.start(at)
    tone.stop(at + 0.8)
  })
}

/*
 * There is no bed under her voice. There was one: three held notes for as long as the break
 * lasted, which droned like a harmonium under every word. She speaks over the station's own song,
 * turned well down (radio.ts), which is what a radio does.
 */

let nextId = 1
let ad = Math.floor(Math.random() * Math.max(1, ADS.length))
let lastWasAd = Math.random() < 0.5
/** The break on air, and its voice while she's speaking. */
let onAir: { id: number; voice: Playing | null } | null = null

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/**
 * One break: the jingle, then a traffic update or an ad (they take turns), heard and shown.
 * `duck` turns the music down while it's on. `done` is called when it's over.
 */
export function playBreak(station: string, duck: (down: boolean) => void, done: () => void) {
  lastWasAd = !lastWasAd
  const kind = lastWasAd && ADS.length > 0 ? 'ad' : 'traffic'
  const lines: Segment[] = kind === 'ad' ? [{ id: ADS[ad % ADS.length], text: lineText(ADS[ad++ % ADS.length]) }] : trafficUpdate(roadReport.get())
  const id = nextId++
  jingle()
  duck(true)
  const live = { id, voice: null as Playing | null }
  onAir = live
  useOnAir.setState({ line: { id, station, kind, text: lines.map(({ text }) => text).join(' ') } })
  const stillOn = () => onAir === live

  void (async () => {
    // The ident plays her in first.
    await wait(IDENT_SECONDS * 1000)
    for (const [index, line] of lines.entries()) {
      if (!stillOn()) return
      if (index > 0) {
        sting()
        await wait(380)
      }
      const voice = await speak(line.id, 'radio')
      if (!stillOn()) {
        voice?.stop()
        return
      }
      live.voice = voice
      // Recorded: as long as the recording. Not yet: as long as its words take to read.
      if (voice) await voice.ended
      else await wait(readingTime(line.text))
      live.voice = null
    }
    if (!stillOn()) return
    sting()
    onAir = null
    useOnAir.setState({ line: null })
    duck(false)
    done()
  })()
}

/** Cuts the RJ off: the station was changed or the music turned off. */
export function stopBreak() {
  onAir?.voice?.stop()
  onAir = null
  useOnAir.setState({ line: null })
}
