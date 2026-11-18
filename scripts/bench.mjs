#!/usr/bin/env node
/**
 * Frame-time benchmark, the same every time: Low and High, unthrottled and with the CPU slowed
 * 4× (as DevTools' CPU throttling does), on a production build.
 *
 *     npm run build && npx vite preview --port 4173 &
 *     node --experimental-websocket scripts/bench.mjs [--streets shop-street,main-road] [--profile]
 *     node --experimental-websocket scripts/bench.mjs --ride [--quality High] [--profile] [--streets main-road]
 *     node --experimental-websocket scripts/bench.mjs --eval "window.__deliverIt.scene.getObjectByName('part:props').visible = false"
 *
 * --ride rides forward for 6 s with the resolution left to the game, and reports what a player
 * sees: frame intervals (FPS, frames over 20 ms, the worst), each frame's own work, and how many
 * long frames compiled a shader. It also prints the load timeline's steps.
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
/** JavaScript run in the page once the ride has started, before measuring. */
const EVAL = option('eval', '')
/** --ride: ride along the street on one quality at the screen's own resolution, as a player would, and count stutters. */
const RIDE = args.includes('--ride')
const RIDE_QUALITY = option('quality', 'High')
/** The time of day, set before measuring with a clear sky, so runs compare: 9 as the old baselines (a first visit now starts at 17:30). */
const HOUR = Number(option('hour', '9'))
const SET_SKY = `{ const sky = window.__deliverItSky; if (sky) { sky.hours = ${HOUR}; sky.weather = 'clear'; sky.weatherLeft = 9999; sky.clouds = 0.2; sky.rain = 0 } }`
/** --dpr 2: emulate a sharp (Retina) screen, whatever screen Chrome opens on. */
const SCREEN_DPR = Number(option('dpr', '0'))
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
  const bench = (window.__bench = { on: false, sync: true, frames: new Map() })
  window.requestAnimationFrame = (cb) => raf((stamp) => {
    const start = performance.now()
    cb(stamp)
    if (bench.on) {
      if (bench.sync) ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel)
      bench.frames.set(stamp, (bench.frames.get(stamp) ?? 0) + performance.now() - start)
    }
  })
})()`

const measure = (quality, dpr) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  ${SET_SKY}
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${quality}')?.click()
  window.__deliverItLockDpr = ${dpr}
  await sleep(4000)
  const sample = async (sync) => {
    window.__bench.sync = sync
    window.__bench.frames.clear()
    window.__bench.on = true
    await sleep(${SAMPLE_MS / 2})
    window.__bench.on = false
    const times = [...window.__bench.frames.values()].sort((a, b) => a - b)
    const at = (share) => +times[Math.min(times.length - 1, Math.floor(times.length * share))].toFixed(1)
    return { mean: +(times.reduce((n, t) => n + t, 0) / times.length).toFixed(1), p95: at(0.95) }
  }
  // Synced: the frame's work with the GPU's share waited for (an upper bound, see FLOOR).
  // CPU: the same frames without waiting, which is what CPU throttling slows.
  const synced = await sample(true)
  const cpu = await sample(false)
  return { meanMs: synced.mean, p95: synced.p95, cpuMs: cpu.mean, cpuP95: cpu.p95 }
})()`

/**
 * The cost of waiting for the GPU at all: an empty frame (scene hidden, effects on), synced. A real
 * frame doesn't pay this, as the GPU works on one frame while the next is prepared, so a frame's
 * own GPU work is roughly its synced time less this.
 */
const FLOOR = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const { scene } = window.__deliverIt
  const shown = scene.children.filter((child) => !child.isCamera && child.visible)
  shown.forEach((child) => (child.visible = false))
  await sleep(800)
  window.__bench.sync = true
  window.__bench.frames.clear()
  window.__bench.on = true
  await sleep(2000)
  window.__bench.on = false
  shown.forEach((child) => (child.visible = true))
  const times = [...window.__bench.frames.values()].sort((a, b) => a - b)
  return +times[Math.floor(times.length / 2)].toFixed(1)
})()`

/** Rides forward on the chosen quality and records every frame. */
const RIDE_RUN = (quality) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  ${SET_SKY}
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${quality}')?.click()
  await sleep(3000)
  const { gl } = window.__deliverIt
  const raf = window.requestAnimationFrame
  const frames = []
  let last = 0
  let on = true
  const programs = () => gl.info.programs?.length ?? 0
  const tick = (stamp) => {
    if (!on) return
    const before = programs()
    raf((next) => {
      if (last) frames.push({ interval: next - last, compiled: programs() - before })
      last = next
      tick(next)
    })
  }
  tick(0)
  window.__bench.sync = false
  window.__bench.frames.clear()
  window.__bench.on = true
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
  key('KeyW', true)
  await sleep(6000)
  key('KeyW', false)
  on = false
  window.__bench.on = false
  const work = [...window.__bench.frames.values()].sort((a, b) => a - b)
  const intervals = frames.map((f) => f.interval)
  const long = frames.filter((f) => f.interval > 20)
  return {
    dpr: +window.devicePixelRatio.toFixed(2),
    drawRatio: +gl.getPixelRatio().toFixed(2),
    fps: +(1000 / (intervals.reduce((n, t) => n + t, 0) / intervals.length)).toFixed(0),
    over20: long.length,
    worst: +Math.max(...intervals).toFixed(1),
    longWithCompile: long.filter((f) => f.compiled > 0).length,
    programs: programs(),
    vehicles: window.__deliverItTraffic?.vehicles?.length ?? null,
    workMean: +(work.reduce((n, t) => n + t, 0) / work.length).toFixed(1),
    workP95: +work[Math.floor(work.length * 0.95)].toFixed(1),
    workOver20: work.filter((t) => t > 20).length,
  }
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
  // Shares of the time that wasn't idle, so they add up to the JavaScript and the browser's own work.
  const busy = total - [...self.entries()].filter(([name]) => name.startsWith('(idle)')).reduce((n, [, ms]) => n + ms, 0)
  return [`busy ${((busy / total) * 100).toFixed(0)}% of ${(total / 1000).toFixed(1)} s`].concat(
    [...self.entries()]
      .filter(([name]) => !name.startsWith('(idle)'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([name, ms]) => `${((ms / busy) * 100).toFixed(1).padStart(5)}%  ${name}`),
  )
}

const results = {}
try {
  await send('Page.enable')
  await send('Runtime.enable')
  if (SCREEN_DPR) await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: SCREEN_DPR, mobile: false })
  for (const street of STREETS) {
    await send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await send('Page.navigate', { url: `${BASE}/?spawn=${street}&debug=1` })
    await sleep(1500)
    // --profile-load file.cpuprofile: a CPU profile of loading, Play to riding.
    const loadProfile = option('profile-load', '')
    if (loadProfile) {
      await send('Profiler.enable')
      await send('Profiler.setSamplingInterval', { interval: 200 })
      await send('Profiler.start')
    }
    const load = await evaluate(START)
    if (loadProfile) {
      // On through the first seconds of riding, where traffic and nearby squares are built.
      await evaluate(`(async () => { const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); key('KeyW', true); await new Promise((r) => setTimeout(r, 4000)); key('KeyW', false) })()`)
      ;(await import('node:fs')).writeFileSync(loadProfile, JSON.stringify((await send('Profiler.stop')).profile))
    }
    await sleep(3000)
    await evaluate(TIMER)
    // --eval <js>: run in the page before measuring, e.g. to hide a part and see what it costs.
    if (EVAL) await evaluate(`(() => { ${EVAL} })(); 'ok'`)
    if (RIDE) {
      // Rides need the frame timer installed but idle, not the samples below.
    }
    const state = await evaluate(`(async () => { let n = 0; const end = performance.now() + 1000; await new Promise((done) => { const tick = () => { n++; if (performance.now() < end) requestAnimationFrame(tick); else done() }; requestAnimationFrame(tick) }); return { hidden: document.hidden, framesPerSecond: n } })()`)
    console.log('page', JSON.stringify(state))
    const row = { load }
    if (RIDE) {
      row.timeline = (await evaluate('window.__deliverItLoad?.() ?? []')).map((m) => `${m.at} ${m.label}`)
      if (PROFILE) {
        await send('Profiler.enable')
        await send('Profiler.start')
      }
      row.ride = await evaluate(RIDE_RUN(RIDE_QUALITY))
      if (PROFILE) {
        const { profile } = await send('Profiler.stop')
        row.profile = summarize(profile).slice(0, 25)
        // --save-profile file.cpuprofile: the whole profile, for opening in DevTools or reading callers.
        const saveTo = option('save-profile', '')
        if (saveTo) (await import('node:fs')).writeFileSync(saveTo, JSON.stringify(profile))
      }
      results[street] = row
      console.log(street, JSON.stringify(row, null, 2))
      continue
    }
    row.floorMs = await evaluate(FLOOR)
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
