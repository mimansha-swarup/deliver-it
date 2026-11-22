#!/usr/bin/env node
/**
 * Drives a fresh Chrome through a steps file, for benchmarks, screenshots and playthroughs:
 *
 *     npx vite preview --port 4173 &
 *     node --experimental-websocket scripts/drive.mjs <steps.mjs> [WIDTHxHEIGHT] [--windowed]
 *
 * The steps file exports `run(page)`. Headless by default (60 Hz, fine for screenshots);
 * `--windowed` opens a real window, which paces frames at the screen's own rate and is what
 * frame-rate numbers should be measured in. A temporary profile, so no save is touched.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const WINDOWED = args.includes('--windowed')
const [stepsFile, size = '1440x810'] = args.filter((arg) => !arg.startsWith('--'))
const [WIDTH, HEIGHT] = size.split('x').map(Number)
const PORT = Number(process.env.DRIVE_PORT ?? 9347)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), 'swalpa-drive-'))
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(WINDOWED ? [] : ['--headless=new']),
    `--window-size=${WIDTH},${HEIGHT + (WINDOWED ? 90 : 0)}`,
    '--autoplay-policy=no-user-gesture-required',
    // Silent: the game's sound still runs (so its code is exercised), but nothing comes out of the speakers. SOUND=1 to hear it.
    ...(process.env.SOUND ? [] : ['--mute-audio']),
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
let url
for (let i = 0; i < 60 && !url; i++) {
  try {
    url = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {
    // Chrome is still starting.
  }
  if (!url) await sleep(200)
}
const socket = new WebSocket(url)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
let nextId = 1
const waiting = new Map()
const logs = []
let recording = null
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (m.id && waiting.has(m.id)) {
    const w = waiting.get(m.id)
    waiting.delete(m.id)
    if (m.error) w.reject(new Error(m.error.message))
    else w.resolve(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type))
    logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
  if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400))
  if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) logs.push('log ' + m.params.entry.level + ': ' + m.params.entry.text.slice(0, 300) + ' ' + (m.params.entry.url ?? ''))
  if (recording && m.method === 'Page.screencastFrame') {
    const name = String(recording.frames.length).padStart(6, '0') + '.jpg'
    writeFileSync(join(recording.dir, name), Buffer.from(m.params.data, 'base64'))
    recording.frames.push({ name, at: m.params.metadata.timestamp })
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {})
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
if (!WINDOWED) await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })

const page = {
  sleep,
  logs,
  send,
  windowed: WINDOWED,
  /** Records the page's own frames as JPEGs with their times, for ffmpeg's concat to join. */
  record: async (dir, every = 3) => {
    recording = { dir, frames: [] }
    await send('Page.startScreencast', { format: 'jpeg', quality: 62, everyNthFrame: every })
  },
  stopRecord: async () => {
    await send('Page.stopScreencast')
    const { dir, frames } = recording
    recording = null
    let list = ''
    for (let i = 0; i < frames.length; i++) {
      const next = frames[i + 1]?.at ?? frames[i].at + 0.05
      list += `file '${frames[i].name}'\nduration ${Math.max(0.005, next - frames[i].at).toFixed(4)}\n`
    }
    writeFileSync(join(dir, 'frames.txt'), list)
    return frames.length
  },
  goto: async (address, wait = 1500) => {
    await send('Page.navigate', { url: address })
    await sleep(wait)
  },
  /** Runs the code inside an async function in the page: it may `await`, and `return` a value. */
  evaluate: async (code) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  },
  mouse: async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 })
  },
  /** A real key press, as the browser delivers one (focus, default actions and all). */
  key: async (key, code = key, keyCode = 0) => {
    // Enter needs its character too, or a focused button doesn't take it as a press.
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, ...(key === 'Enter' ? { text: '\r' } : {}) })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
  },
  shot: async (file) => {
    const { data } = await send('Page.captureScreenshot', { format: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 88 : undefined })
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  },
  throttle: (rate) => send('Emulation.setCPUThrottlingRate', { rate }),
}
try {
  const { run } = await import(pathToFileURL(resolve(stepsFile)).href)
  await run(page)
} catch (error) {
  console.error('FAILED', error.stack ?? error.message)
  process.exitCode = 1
} finally {
  socket.close()
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
