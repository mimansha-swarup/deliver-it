#!/usr/bin/env node
/**
 * The voice script and the list of recordings, from their sources:
 *
 *     node scripts/voice_files.mjs
 *
 * - VOICE_SCRIPT.csv (id, character, line, emotion/notes), from src/audio/voiceScript.json and the
 *   `lines` of src/talk/characters.json (the people talked to on the street, and what's called out): what
 *   to record, for real voices or a licensed voice service. A last column says whether each line's
 *   recording is in public/voice yet.
 * - public/voice/manifest.json: the recordings that exist (every .ogg in public/voice), which the
 *   game reads so it never asks for one that isn't there (src/audio/voice.ts).
 *
 * A recording is `public/voice/<id>.ogg`, Opus in an Ogg file, mono, 48 kHz, about 32 kb/s (speech):
 *
 *     ffmpeg -i take.wav -ac 1 -c:a libopus -b:a 32k -application voip public/voice/manju.hello.1.ogg
 *
 * Customers' lines are recorded in two voices: `<id>.a.ogg` (a woman) and `<id>.b.ogg` (a man).
 * Record them dry (no effects, no music): the game adds the radio and the phone itself.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
// The script, and the lines of the people the rider talks to on the street (src/talk/characters.json).
const lines = [...JSON.parse(readFileSync(`${root}src/audio/voiceScript.json`, 'utf8')), ...JSON.parse(readFileSync(`${root}src/talk/characters.json`, 'utf8')).lines]
const clips = readdirSync(`${root}public/voice`).filter((file) => file.endsWith('.ogg')).map((file) => file.slice(0, -4)).sort()
writeFileSync(`${root}public/voice/manifest.json`, `${JSON.stringify({ clips }, null, 1)}\n`)

const cell = (text) => `"${String(text).replaceAll('"', '""')}"`
const recorded = (id) => (clips.some((clip) => clip === id || clip.startsWith(`${id}.`)) ? 'yes' : 'no')
const rows = [['id', 'character', 'line', 'emotion/notes', 'recorded'], ...lines.map(({ id, character, line, notes }) => [id, character, line, notes, recorded(id)])]
writeFileSync(`${root}VOICE_SCRIPT.csv`, `${rows.map((row) => row.map(cell).join(',')).join('\n')}\n`)
const ids = new Set(lines.map(({ id }) => id))
const strays = clips.filter((clip) => !ids.has(clip) && !ids.has(clip.replace(/\.[ab]$/, '')))
console.log(`${lines.length} lines, ${clips.length} recordings${strays.length ? `; not in the script: ${strays.join(', ')}` : ''}`)
