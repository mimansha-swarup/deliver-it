import { duckMusicFor, getAudio, type AudioBuses } from './audioEngine'
import { showSubtitle } from './subtitle'
import script from './voiceScript.json'

/*
 * Voices, from recordings.
 *
 * Nothing is spoken by the browser's speech synthesis any more: it sounded like a machine reading,
 * and differently on every device. Every spoken line has an id and its words in voiceScript.json
 * (exported as VOICE_SCRIPT.csv for whoever records them), and its recording, if there is one, is
 * `/voice/<id>.ogg` (Opus). `/voice/manifest.json` lists the recordings that exist
 * (scripts/voice_files.mjs writes it from the folder), so the game never asks for one that isn't
 * there. A clip is downloaded the first time its line is spoken, and kept.
 *
 * A line with no recording is simply not heard: its words are on the phone already (the chat, the
 * RJ's banner), which is the fallback.
 *
 * Each character is heard through something: the RJ through a radio (tight band, compressed, a
 * little drive), Ravi and the customers through a phone (narrow band, a little grit), and each
 * playback is a shade faster or slower, higher or lower, so a line heard twice isn't the same twice.
 */

/** `english`: what a line with Kannada in it means, for the subtitle shown while it's spoken (subtitle.ts). */
export type VoiceLine = { id: string; character: string; line: string; notes: string; english?: string }

/** Who a line is said by, as the subtitle names them. */
const SPEAKERS: Record<string, string> = { 'RJ Manju': 'RJ Manju · radio', 'Ravi (dispatch)': 'Ravi', Customer: 'Customer', 'Security guard': 'Security guard', 'Dark store staff': 'Dark store' }
export const VOICE_LINES = script as VoiceLine[]
const BY_ID = new Map(VOICE_LINES.map((line) => [line.id, line]))

/** A line's words, for the screen. */
export function lineText(id: string): string {
  return BY_ID.get(id)?.line ?? ''
}

const lastPicked = new Map<string, string>()
/** One of the lines whose id starts with `prefix` ("cust.coming"), not the one picked last time. */
export function pickLine(prefix: string): VoiceLine {
  // A line can be asked for by its family (`cust.thanks`: any of them) or by its own name (`cust.thanks.1`).
  // The second used to match nothing: the recording played, and its words came up as an empty message.
  const all = VOICE_LINES.filter(({ id }) => id === prefix || id.startsWith(`${prefix}.`))
  const fresh = all.length > 1 ? all.filter(({ id }) => id !== lastPicked.get(prefix)) : all
  const line = fresh[Math.floor(Math.random() * fresh.length)] ?? { id: prefix, character: '', line: '', notes: '' }
  lastPicked.set(prefix, line.id)
  return line
}

export type Treatment = 'radio' | 'phone'

const VOICE_FOLDER = `${import.meta.env.BASE_URL}voice/`
let manifest: Promise<Set<string>> | null = null
/** The recordings that exist, asked for once. An empty set if the list can't be had. */
function recordings(): Promise<Set<string>> {
  manifest ??= fetch(`${VOICE_FOLDER}manifest.json`)
    .then((response) => (response.ok ? (response.json() as Promise<{ clips?: string[] }>) : { clips: [] }))
    .then(({ clips }) => new Set(clips ?? []))
    .catch(() => new Set<string>())
  return manifest
}

const clips = new Map<string, Promise<AudioBuffer | null>>()
function loadClip(context: AudioContext, name: string): Promise<AudioBuffer | null> {
  let clip = clips.get(name)
  if (!clip) {
    clip = fetch(`${VOICE_FOLDER}${name}.ogg`)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('missing'))))
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => null)
    clips.set(name, clip)
  }
  return clip
}

/** A soft clipper's curve: `drive` 0 is clean, 1 is a fuzzy handset. */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(1024 * 4))
  const k = 1 + drive * 14
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

const chains = new Map<Treatment, GainNode>()
/**
 * What a voice is heard through, built once each and shared:
 * - `radio`: no rumble (a high-pass at 160 Hz), presence lifted at 2.8 kHz, nothing above 7.5 kHz,
 *   squeezed hard by a compressor as broadcast voices are, a touch of drive. On the music bus, so
 *   the radio's own volume and "Music off" govern it.
 * - `phone`: 320 Hz to 3.3 kHz and nothing else, more drive, squeezed. On the effects bus.
 */
function chainFor({ context, music, voice }: AudioBuses, treatment: Treatment): GainNode {
  const made = chains.get(treatment)
  if (made) return made
  const input = context.createGain()
  const radio = treatment === 'radio'
  const low = context.createBiquadFilter()
  low.type = 'highpass'
  low.frequency.value = radio ? 160 : 320
  low.Q.value = 0.7
  const presence = context.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = radio ? 2800 : 1800
  presence.Q.value = 0.9
  presence.gain.value = radio ? 2 : 6
  const high = context.createBiquadFilter()
  high.type = 'lowpass'
  high.frequency.value = radio ? 7500 : 3300
  high.Q.value = 0.7
  const drive = context.createWaveShaper()
  drive.curve = driveCurve(radio ? 0.04 : 0.3)
  drive.oversample = '2x'
  const squeeze = context.createDynamicsCompressor()
  squeeze.threshold.value = radio ? -26 : -22
  squeeze.ratio.value = radio ? 7 : 5
  squeeze.attack.value = 0.004
  squeeze.release.value = 0.14
  const level = context.createGain()
  // The RJ is part of the radio: on the music's bus, over its ducked song, and silent when music is off.
  // A phone voice has the voices' own bus (and volume), above the music and the street.
  level.gain.value = radio ? 2.2 : 1
  input.connect(low).connect(presence).connect(high).connect(drive).connect(squeeze).connect(level).connect(radio ? music : voice)
  chains.set(treatment, input)
  return input
}

/** How much a playback's speed (and with it its pitch) may differ from the recording, either way. */
const VARIATION = 0.035

export type Playing = { stop: () => void; ended: Promise<void> }

/**
 * Speaks a line, if it has a recording: null if not (or sound isn't on yet), and then its words on
 * the screen are all there is. `voice`: which of a line's recorded voices ("a", "b"), for customers,
 * who aren't all one person; the plain recording is used if that voice wasn't recorded.
 */
/**
 * People don't talk over each other. Voices on the phone and at the door (Ravi, a customer, the
 * guard, the store's staff) take turns: one that comes while another is speaking waits for it to
 * finish, with a short breath between, and one that would have to wait too long isn't said at all
 * (its words are in the chat already). At the dark store's counter the staff's "order ready" and
 * Ravi's "picked up?" used to come at the same moment, one on top of the other. The RJ is the
 * radio, playing on in the background, and isn't part of the turn-taking.
 */
const TURNS = { breath: 0.35, patience: 7 }
/** When the last voice in the queue will have finished, in the audio clock's seconds. */
let phoneFreeAt = 0

export async function speak(id: string, treatment: Treatment, voice?: string): Promise<Playing | null> {
  const buses = getAudio()
  if (!buses) return null
  const have = await recordings()
  const name = voice && have.has(`${id}.${voice}`) ? `${id}.${voice}` : have.has(id) ? id : [...have].find((clip) => clip.startsWith(`${id}.`)) ?? null
  if (!name) return null
  const buffer = await loadClip(buses.context, name)
  if (!buffer) return null
  const source = buses.context.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = 1 + (Math.random() * 2 - 1) * VARIATION
  source.connect(chainFor(buses, treatment))
  const ended = new Promise<void>((resolve) => {
    source.onended = () => resolve()
  })
  // Its turn: now, or when whoever is speaking has finished.
  let at = buses.context.currentTime
  if (treatment === 'phone') {
    at = Math.max(at, phoneFreeAt)
    if (at - buses.context.currentTime > TURNS.patience) return null
    phoneFreeAt = at + buffer.duration / source.playbackRate.value + TURNS.breath
    duckMusicFor(at, buffer.duration / source.playbackRate.value)
  }
  source.start(at)
  // What it means, on screen from the moment it's heard until it ends.
  const spoken = BY_ID.get(id)
  if (spoken?.english) showSubtitle(SPEAKERS[spoken.character] ?? spoken.character, spoken.english, at - buses.context.currentTime, buffer.duration / source.playbackRate.value)
  return {
    stop: () => {
      try {
        source.stop()
      } catch {
        // Already over.
      }
    },
    ended,
  }
}

/** About how long a line takes to read on the screen, in milliseconds, when nothing speaks it. */
export const readingTime = (text: string) => 1200 + text.length * 62
