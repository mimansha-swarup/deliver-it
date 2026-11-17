#!/usr/bin/env node
/**
 * Frame-time benchmark, the same every time: Low and High, unthrottled and with the CPU slowed
 * 4× (as DevTools' CPU throttling does), on a production build.
 *
 *     npm run build && npx vite preview --port 4173 &
 *     node --experimental-websocket scripts/bench.mjs [--streets shop-street,main-road] [--profile]
 *
 * It opens its own Chrome (a fresh temporary profile, so your game save is untouched) at a fixed
 * window size, with background throttling off, and drives it over the DevTools protocol. Each
 * frame's time is the game's work for that frame, its JavaScript plus drawing, ended with a
 * one-pixel read-back so the GPU's share is in it too. The resolution is held at the quality's
 * own top (`__deliverItLockDpr`) so the automatic scaler can't move it mid-run. With --profile
 * it also records a CPU profile on High and prints where the JavaScript time went.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : fallback
}
const BASE = option('url', 'http://localhost:4173')
const STREETS = option('streets', 'shop-street,main-road').split(',')
const PROFILE = args.includes('--profile')
const CHROME = option('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const PORT = 9333
/** Each quality is measured at its top resolution: Low's is 1, High's 1.5 (qualitySettings.ts); Low also at its optional 0.75×. */
const QUALITIES = [['Low', 1], ['Low', 0.75], ['High', 1.5]]
const SAMPLE_MS = 6000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const profileDir = mkdtempSync(join(tmpdir(), 'deliver-it-bench-'))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1500,900',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  'about:blank',
], { stdio: 'ignore' })

async function connect() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const page = targets.find((target) => target.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await sleep(200)
  }
  throw new Error('Chrome did not open its debugging port')
}

const socket = new WebSocket(await connect())
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
let nextId = 1
const waiting = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id && waiting.has(message.id)) {
    const { resolve, reject } = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

/** Starts the game, and returns how long from Play the ride took to start and the loading screen to go. */
const START = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  while (!document.querySelector('.title-start')) await sleep(50)
  let clickAt = 0
  while (!document.querySelector('.loading-screen')) {
    document.querySelector('.title-start')?.click()
    if (!clickAt) clickAt = performance.now()
    await sleep(100)
  }
  while (document.querySelector('.loading-screen')) await sleep(50)
  const marks = window.__deliverItLoad?.() ?? []
  const starts = +(marks.find((m) => m.label === 'ride starts')?.at ?? NaN)
  return { rideStarts: +(starts - clickAt / 1000).toFixed(1), screenGone: +((performance.now() - clickAt) / 1000).toFixed(1) }
})()`

/** Installs the frame timer: every callback of a frame summed, then a read-back to wait for the GPU. */
const TIMER = `(() => {
  if (window.__bench) return
  const ctx = window.__deliverIt.gl.getContext()
  const pixel = new Uint8Array(4)
  const raf = window.requestAnimationFrame.bind(window)
  const bench = (window.__bench = { on: false, frames: new Map() })
  window.requestAnimationFrame = (cb) => raf((stamp) => {
    const start = performance.now()
    cb(stamp)
    if (bench.on) {
      ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel)
      bench.frames.set(stamp, (bench.frames.get(stamp) ?? 0) + performance.now() - start)
    }
  })
})()`

const measure = (quality, dpr) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${quality}')?.click()
  window.__deliverItLockDpr = ${dpr}
  await sleep(4000)
  window.__bench.frames.clear()
  window.__bench.on = true
  await sleep(${SAMPLE_MS})
  window.__bench.on = false
  const times = [...window.__bench.frames.values()].sort((a, b) => a - b)
  const at = (share) => +times[Math.min(times.length - 1, Math.floor(times.length * share))].toFixed(1)
  const mean = times.reduce((n, t) => n + t, 0) / times.length
  return { meanMs: +mean.toFixed(1), p50: at(0.5), p95: at(0.95), frames: times.length }
})()`

/** Self time by function, from a CPU profile: where the JavaScript actually goes. */
function summarize(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  const deltas = profile.timeDeltas
  profile.samples.forEach((id, index) => {
    const { callFrame } = byId.get(id)
    const name = `${callFrame.functionName || '(anonymous)'} ${callFrame.url.split('/').pop()}:${callFrame.lineNumber + 1}`
    self.set(name, (self.get(name) ?? 0) + (deltas[index] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((n, ms) => n + ms, 0)
  return [...self.entries()]
    .filter(([name]) => !name.startsWith('(idle)') && !name.startsWith('(program)'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, ms]) => `${((ms / total) * 100).toFixed(1).padStart(5)}%  ${name}`)
}

const results = {}
try {
  await send('Page.enable')
  await send('Runtime.enable')
  for (const street of STREETS) {
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await send('Page.navigate', { url: `${BASE}/?spawn=${street}&debug=1` })
    await sleep(1500)
    const load = await evaluate(START)
    await sleep(3000)
    await evaluate(TIMER)
    const state = await evaluate(`(async () => { let n = 0; const end = performance.now() + 1000; await new Promise((done) => { const tick = () => { n++; if (performance.now() < end) requestAnimationFrame(tick); else done() }; requestAnimationFrame(tick) }); return { hidden: document.hidden, framesPerSecond: n } })()`)
    console.log('page', JSON.stringify(state))
    const row = { load }
    for (const rate of [1, 4]) {
      await send('Emulation.setCPUThrottlingRate', { rate })
      for (const [quality, dpr] of QUALITIES) row[`${quality}${dpr === 0.75 ? '@0.75' : ''} ${rate}x`] = await evaluate(measure(quality, dpr))
    }
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })
    if (PROFILE) {
      await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'High')?.click()`)
      await sleep(3000)
      await send('Profiler.enable')
      await send('Profiler.start')
      await sleep(5000)
      const { profile } = await send('Profiler.stop')
      row.profile = summarize(profile)
    }
    results[street] = row
    console.log(street, JSON.stringify(row, null, 2))
  }
} finally {
  socket.close()
  chrome.kill()
  await sleep(500)
  rmSync(profileDir, { recursive: true, force: true })
}
