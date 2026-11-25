#!/usr/bin/env node
/**
 * Makes the game's voice lines with Sarvam's Bulbul text-to-speech, as files in public/voice.
 *
 *     node scripts/voice_generate.mjs --test          # six hard lines, two ways each, into clips/voice-test, to listen to
 *     node scripts/voice_generate.mjs                 # every line not yet recorded, into public/voice
 *     node scripts/voice_generate.mjs --only ravi.online.1,cust.thanks.1 [--force]
 *
 * The key is read from .env.local (SARVAM_API_KEY=...), which git ignores; it is never printed.
 * Each line's text is sent to api.sarvam.ai. Afterwards run scripts/voice_files.mjs, which lists
 * the recordings for the game and marks them in VOICE_SCRIPT.csv.
 *
 * The lines are English with Kannada words in them, in Roman letters, and are sent as they are
 * written, to be read as Indian English. (Bulbul's docs suggest Kannada script for Kannada words;
 * the listening test, `--test`, makes each of six lines both ways, and as written was the more
 * fluent.) A line can still carry a `say` beside its `line` in src/audio/voiceScript.json to be
 * spoken differently from how it's shown: with Kannada script in it, it's read as Kannada.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)

function readKey() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) throw new Error('No .env.local with SARVAM_API_KEY in it')
  for (const row of readFileSync(file, 'utf8').split('\n')) {
    const at = row.indexOf('=')
    // Forgiving of how it was typed: spaces round the key, quotes, or a stray second equals sign.
    if (at > 0 && row.slice(0, at).trim() === 'SARVAM_API_KEY') return row.slice(at + 1).replace(/^[\s=]+/, '').trim().replace(/^["']|["']$/g, '')
  }
  throw new Error('.env.local has no SARVAM_API_KEY line')
}

/**
 * Who speaks in which voice (Bulbul v3's named speakers), and how fast. Customers are recorded
 * twice: `.a` a woman, `.b` a man.
 */
const VOICES = {
  // Calmer than they were (kavya at 1.08, the highest voice of a dozen tried at about 267 Hz, and rahul): lower voices (about 190 and 111 Hz), slower, and steadier (a lower temperature is less excitable). MANJU=<speaker> or RAVI=<speaker> tries another.
  'RJ Manju': [{ speaker: process.env.MANJU ?? 'simran', pace: 0.98, pitch: -0.05, temperature: 0.4 }],
  'Ravi (dispatch)': [{ speaker: process.env.RAVI ?? 'vijay', pace: 0.95, pitch: -0.05, temperature: 0.4 }],
  Customer: [{ suffix: '.a', speaker: 'priya', pace: 1.0 }, { suffix: '.b', speaker: 'amit', pace: 1.0 }],
  'Security guard': [{ speaker: 'ratan', pace: 0.95 }],
  'Dark store staff': [{ speaker: 'neha', pace: 1.05 }],
}
const MODEL = 'bulbul:v3'

async function speak(key, text, language, voice) {
  const reply = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
    body: JSON.stringify({ text, language_code: language, model: MODEL, speaker: voice.speaker, pace: voice.pace, ...(voice.pitch !== undefined ? { pitch: voice.pitch } : {}), ...(voice.temperature !== undefined ? { temperature: voice.temperature } : {}), speech_sample_rate: 24000, output_audio_codec: 'wav' }),
  })
  if (!reply.ok) throw new Error(`Sarvam said ${reply.status}: ${(await reply.text()).slice(0, 300)}`)
  const { audios } = await reply.json()
  if (!audios?.[0]) throw new Error('Sarvam sent no audio')
  return Buffer.from(audios[0], 'base64')
}

/** The game's format: Opus in Ogg, mono, 48 kHz, about 32 kb/s (public/voice/README.txt). */
function toOgg(wav, ogg) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', ogg])
}

/** The six lines with the most Kannada in them, as written and with the Kannada in its own script. */
const TEST = {
  'manju.hello.2': 'Hello hello hello. RJ Manju. ಒಂದ್ ನಿಮಿಷ, traffic ನೋಡೋಣ.',
  'ravi.online.2': 'Good, good. Online ಆಗಿದ್ಯಾ. ಜೋಪಾನ, okay?',
  'ravi.crash.2': 'ಅಯ್ಯೋ, ಜೋಪಾನ ಮಗಾ! Order ನೋಡು, is it fine?',
  'ravi.offline.1': 'ಸರಿ, rest ಮಾಡು. ನಾಳೆ ಸಿಗೋಣ.',
  'cust.outside.2': 'Baby is sleeping, bell ಬೇಡ! Just leave it at the door.',
  'guard.match.1': 'ಸರಿ, it matches. Register ಅಲ್ಲಿ sign ಮಾಡಿ.',
}

const key = readKey()
const lines = JSON.parse(readFileSync(join(root, 'src/audio/voiceScript.json'), 'utf8'))

if (args.includes('--test')) {
  const out = join(root, 'clips/voice-test')
  mkdirSync(out, { recursive: true })
  for (const [id, native] of Object.entries(TEST)) {
    const line = lines.find((one) => one.id === id)
    for (const voice of VOICES[line.character]) {
      // Two ways: A as written (Roman letters), read as Indian English; B with the Kannada in Kannada script, read as Kannada.
      for (const [way, text, language] of [['A-roman', line.line, 'en-IN'], ['B-kannada-script', native, 'kn-IN']]) {
        const name = `${id}${voice.suffix ?? ''}.${way}`
        const wav = join(out, `${name}.wav`)
        writeFileSync(wav, await speak(key, text, language, voice))
        console.log(`${name}.wav  (${voice.speaker})`)
      }
    }
  }
  console.log(`\nListen in ${out}`)
} else {
  const only = option('only')?.split(',')
  const force = args.includes('--force')
  const out = join(root, 'public/voice')
  let made = 0
  for (const line of lines) {
    if (only && !only.includes(line.id)) continue
    for (const voice of VOICES[line.character] ?? []) {
      const ogg = join(out, `${line.id}${voice.suffix ?? ''}.ogg`)
      if (existsSync(ogg) && !force) continue
      const wav = join(root, 'clips', `voice-${line.id}${voice.suffix ?? ''}.wav`)
      mkdirSync(join(root, 'clips'), { recursive: true })
      // With Kannada in its own script the line is read as Kannada; all in Roman letters, as Indian English.
      writeFileSync(wav, await speak(key, line.say ?? line.line, line.say ? 'kn-IN' : 'en-IN', voice))
      toOgg(wav, ogg)
      made++
      console.log(`${line.id}${voice.suffix ?? ''}.ogg  (${voice.speaker})`)
    }
  }
  console.log(`${made} recordings made. Now run: node scripts/voice_files.mjs`)
}
