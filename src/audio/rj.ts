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
 * the station's three-note jingle, a small sting separates the lines, and a soft bed of held notes
 * sits under the voice with the station's music turned down, as on a real station. The voice comes
 * through the radio's own filter and compressor.
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

/** The jingle: three rising notes and a shimmer, on the music bus. */
function jingle() {
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses
  const start = context.currentTime + 0.05
  ;[659, 784, 1047].forEach((hz, index) => {
    const at = start + index * 0.14
    for (const [ratio, share] of [[1, 1], [2, 0.3]]) {
      const tone = context.createOscillator()
      tone.type = 'triangle'
      tone.frequency.value = hz * ratio
      const level = context.createGain()
      level.gain.setValueAtTime(0, at)
      level.gain.linearRampToValueAtTime(0.5 * share, at + 0.015)
      level.gain.exponentialRampToValueAtTime(0.0001, at + (index === 2 ? 0.9 : 0.3))
      tone.connect(level).connect(music)
      tone.start(at)
      tone.stop(at + 1)
    }
  })
}

/** Between two lines of a break: two quick notes, quieter than the jingle. */
function sting() {
  const buses = getAudioEvenIfPaused()
  if (!buses) return
  const { context, music } = buses
  const start = context.currentTime + 0.02
  ;[880, 1175].forEach((hz, index) => {
    const at = start + index * 0.09
    const tone = context.createOscillator()
    tone.type = 'triangle'
    tone.frequency.value = hz
    const level = context.createGain()
    level.gain.setValueAtTime(0, at)
    level.gain.linearRampToValueAtTime(0.22, at + 0.012)
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
    tone.connect(level).connect(music)
    tone.start(at)
    tone.stop(at + 0.3)
  })
}

/**
 * The bed under the voice: three held notes, soft and filtered, swelling a little, for as long as the
 * break lasts. Returns what fades it out.
 */
function startBed(): () => void {
  const buses = getAudioEvenIfPaused()
  if (!buses) return () => {}
  const { context, music } = buses
  const now = context.currentTime
  const out = context.createGain()
  out.gain.setValueAtTime(0.0001, now)
  out.gain.exponentialRampToValueAtTime(0.16, now + 0.6)
  const soften = context.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = 900
  // A slow swell, so it isn't a flat drone.
  const swell = context.createOscillator()
  swell.frequency.value = 0.35
  const depth = context.createGain()
  depth.gain.value = 0.05
  swell.connect(depth).connect(out.gain)
  swell.start(now)
  const tones = [220, 277.2, 329.6].map((hz, index) => {
    const tone = context.createOscillator()
    tone.type = index === 0 ? 'sine' : 'triangle'
    tone.frequency.value = hz
    tone.detune.value = (index - 1) * 6
    tone.connect(soften)
    tone.start(now)
    return tone
  })
  soften.connect(out).connect(music)
  return () => {
    const end = context.currentTime
    out.gain.cancelScheduledValues(end)
    out.gain.setTargetAtTime(0.0001, end, 0.18)
    for (const tone of [...tones, swell]) tone.stop(end + 1)
    window.setTimeout(() => out.disconnect(), 1300)
  }
}

let nextId = 1
let ad = Math.floor(Math.random() * Math.max(1, ADS.length))
let lastWasAd = Math.random() < 0.5
/** The break on air: what stops its bed and its voice. */
let onAir: { id: number; stopBed: () => void; voice: Playing | null } | null = null

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
  const live = { id, stopBed: startBed(), voice: null as Playing | null }
  onAir = live
  useOnAir.setState({ line: { id, station, kind, text: lines.map(({ text }) => text).join(' ') } })
  const stillOn = () => onAir === live

  void (async () => {
    // The jingle rings out first.
    await wait(750)
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
    live.stopBed()
    useOnAir.setState({ line: null })
    duck(false)
    done()
  })()
}

/** Cuts the RJ off: the station was changed or the music turned off. */
export function stopBreak() {
  onAir?.voice?.stop()
  onAir?.stopBed()
  onAir = null
  useOnAir.setState({ line: null })
}
