#!/usr/bin/env node
/**
 * Screenshots of the review spots, the same every time: for before/after comparisons.
 *
 *     npx vite preview --port 4173 &
 *     node --experimental-websocket scripts/shots.mjs --out <folder> [--spots 27th-main,residential-street,main-road,petrol-pump] [--hour 10]
 *
 * A fresh headless Chrome (your save is untouched, and keys typed elsewhere can't reach it; `--windowed` to watch) with the tutorial marked done, a 1440 × 810
 * window, the clock set to `--hour` and the weather clear (in the address, `?hour=` and `?weather=`,
 * so the world loads at that time), then each spot on High and on Low.
 * Files are <spot>-<quality>.png. `--press F8` (or `F8,F8`) presses keys before each shot, and
 * `--eval <js>` runs a script in the page after them (inside an async function: it may `await`).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : fallback
}
const BASE = option('url', 'http://localhost:4173')
const OUT = option('out', 'shots')
const SPOTS = option('spots', '27th-main,residential-street,main-road,petrol-pump').split(',')
const HOUR = Number(option('hour', '10'))
const QUALITIES = option('qualities', 'High,Low').split(',')
/** Keys pressed before each shot, by DevTools key code, e.g. `--press F8` for the surface map. */
const PRESS = option('press', '').split(',').filter(Boolean)
/** JavaScript run in the page before each shot, after the key presses. */
const EVAL = option('eval', '')
const SETTLE = Number(option('settle', '3000'))
const CHROME = option('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
/** --size 1280x720: the window's size, for checking the HUD on small and wide screens. */
const [WIDTH, HEIGHT] = option('size', '1440x810').split('x').map(Number)
const PORT = 9334

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
mkdirSync(OUT, { recursive: true })
const profileDir = mkdtempSync(join(tmpdir(), 'deliver-it-shots-'))
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', ...(args.includes('--windowed') ? [] : ['--headless=new']), '--window-size=1440,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' })

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

const START = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  while (!document.querySelector('.title-start')) await sleep(50)
  while (!document.querySelector('.loading-screen')) { document.querySelector('.title-start')?.click(); await sleep(100) }
  while (document.querySelector('.loading-screen')) await sleep(50)
  await sleep(1500)
})()`

const SET_SKY = `(async () => {
  const sky = window.__deliverItSky
  if (sky) { sky.hours = ${HOUR}; sky.weather = 'clear'; sky.weatherLeft = 9999; sky.clouds = 0.15; sky.rain = 0 }
  await new Promise((r) => setTimeout(r, 1500))
})()`

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${BASE}/?debug=1` })
  await sleep(1500)
  // With ?debug the game saves to its "-debug" copies (src/game/saveKeys.ts): both are set.
  await evaluate(`for (const key of ['swalpa-fast-tutorial', 'swalpa-fast-tutorial-debug']) localStorage.setItem(key, JSON.stringify({ state: { done: true }, version: 0 })); 'ok'`)
  for (const spot of SPOTS) {
    await send('Page.navigate', { url: `${BASE}/?spawn=${spot}&debug=1&hour=${HOUR}&weather=clear` })
    await sleep(1500)
    await evaluate(START)
    if (spot === SPOTS[0]) {
      // The placement fixes' counts, from the load timeline (lines with a report after a colon).
      const timeline = await evaluate('window.__deliverItLoad?.() ?? []')
      for (const { at, label } of timeline) if (label.includes(':')) console.log('load', at, label)
    }
    for (const quality of QUALITIES) {
      await evaluate(`(window.__deliverItQuality ? window.__deliverItQuality('${quality}'.toLowerCase()) : [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${quality}')?.click()); 'ok'`)
      await sleep(3500)
      await evaluate(SET_SKY)
      for (const code of PRESS) {
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${code}' })); 'ok'`)
        await sleep(800)
      }
      if (EVAL) {
        // Async, so a script can `await` (say, for traffic to settle) before the shot.
        await evaluate(`(async () => { ${EVAL} })().then(() => 'ok')`)
        // Long enough for the map squares round a new spot to stream in, if the script moved the rider.
        // `--settle 100` for a script that has timed a moment itself.
        await sleep(SETTLE)
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      const file = join(OUT, `${spot}-${quality.toLowerCase()}${WIDTH === 1440 && HEIGHT === 810 ? '' : `-${WIDTH}x${HEIGHT}`}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log('saved', file)
    }
  }
} finally {
  socket.close()
  chrome.kill()
  await sleep(500)
  rmSync(profileDir, { recursive: true, force: true })
}
