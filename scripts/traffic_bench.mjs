/**
 * The traffic and street-life benchmark: stood still at 6 pm on 27th Main and at the Agara junction
 * with `?debug=2`, so the frame's steps (dev/frameTimes.ts) are timed. Steps for scripts/drive.mjs:
 *
 *     npx vite preview --port 4173 &
 *     CHROME_FLAGS="--disable-frame-rate-limit --disable-gpu-vsync" QUALITY=high OUT=after.json \
 *       node --experimental-websocket scripts/drive.mjs scripts/traffic_bench.mjs 1500x900 --windowed
 *
 * BASE is the address of the build (two builds on two ports compare a branch with main); SPOTS the
 * `?spawn=` places (27th-main,agara-flyover: the second is the road at the Agara junction);
 * QUALITY low, medium or high; HOUR the time of day (18); SETTLE the seconds stood before measuring
 * (30: traffic eases to the hour's density); SECONDS the sample's length (12).
 *
 * For each spot it reports frames a second, the frame's own work, each traffic and people step's
 * milliseconds a frame, draw calls and triangles, and how many vehicles and people are out in each
 * band of distance from the rider. FPS on a laptop on battery swings between runs: the work and the
 * steps are the steadier numbers, and a branch is only compared with main run back to back.
 */
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const SPOTS = (process.env.SPOTS ?? '27th-main,agara-flyover').split(',')
const QUALITY = process.env.QUALITY ?? 'high'
const HOUR = process.env.HOUR ?? '18'
const SETTLE = Number(process.env.SETTLE ?? 30)
const SECONDS = Number(process.env.SECONDS ?? 12)

const STEPS = ['traffic AI', 'physics (Rapier)', 'traffic drawing (instances, wheels, lamps)', 'pedestrians', 'audio updates', 'draw: shadows', 'draw: scene and effects']

/** Keeps the game from resting (it draws at 30 when nothing has been touched for a while), and holds the hour. */
const KEEP_AWAKE = `window.__awake = setInterval(() => { window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); const sky = window.__deliverItSky; if (sky) { sky.hours = ${HOUR}; sky.weather = 'clear'; sky.weatherLeft = 9999; sky.rain = 0; sky.clouds = 0.2 } }, 400)`

const SAMPLE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const frames = []; const works = []
let last = 0, on = true
const native = window.requestAnimationFrame
let stamp0 = -1, soFar = 0
window.requestAnimationFrame = (cb) => native.call(window, (stamp) => { const began = performance.now(); cb(stamp); const took = performance.now() - began; if (stamp !== stamp0) { if (stamp0 >= 0 && on) works.push(soFar); stamp0 = stamp; soFar = 0 } soFar += took })
const tick = (t) => { if (last) frames.push(t - last); last = t; if (on) requestAnimationFrame(tick) }
requestAnimationFrame(tick)
const calls = []; const tris = []
const read = setInterval(() => { const m = /(\\d+) calls\\s+(\\d+)k tris/.exec(document.querySelector('.fps-overlay')?.textContent ?? ''); if (m) { calls.push(+m[1]); tris.push(+m[2]) } }, 500)
await sleep(${SECONDS * 1000})
on = false; clearInterval(read)
window.requestAnimationFrame = native
const mean = (list) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0
const sorted = [...frames].sort((a, b) => a - b)
const steps = Object.fromEntries((window.__deliverItSteps?.() ?? []).map((s) => [s.name, +s.average.toFixed(3)]))
const me = window.__deliverItScooter
const bands = [[0, 60], [60, 120], [120, 220], [220, 1e9]]
const band = (items) => bands.map(([from, to]) => items.filter((i) => { const d = Math.hypot(i.x - me.x, i.z - me.z); return d >= from && d < to && Math.abs(i.x) < 5000 }).length)
const t = window.__deliverItTraffic ?? {}
const counts = window.__deliverItCounts ? window.__deliverItCounts() : { vehicles: band((t.vehicles ?? []).filter((v) => v.lane !== -1)), walkers: band((t.people ?? []).filter((p) => p.lane !== -1)) }
return JSON.stringify({
  fps: +(1000 / mean(frames)).toFixed(1), worstMs: +sorted.at(-1).toFixed(1), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1),
  workMs: +mean(works).toFixed(2), calls: Math.round(mean(calls)), trisK: Math.round(mean(tris)),
  steps, counts, drawRatio: +window.__deliverIt.gl.getPixelRatio().toFixed(2), overlay: document.querySelector('.fps-overlay')?.textContent.split('\\n').slice(0, 4).join(' | '),
})`

export async function run(page) {
  const out = { settings: { base: BASE, quality: QUALITY, hour: +HOUR, settle: SETTLE, seconds: SECONDS }, spots: {} }
  for (const spot of SPOTS) {
    await page.goto(`${BASE}/?debug=2&spawn=${spot}&hour=${HOUR}&weather=clear&fps=unlimited`, 2500)
    await page.evaluate(`for (let i = 0; i < 120 && !document.querySelector('.title-start'); i++) await new Promise((r) => setTimeout(r, 250)); document.querySelector('.title-start').click()`)
    // The story's cards for a new player, then the loading screen.
    for (let i = 0; i < 14; i++) {
      await page.sleep(500)
      const where = await page.evaluate(`const s = document.querySelector('.story'); if (s) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true })); return s ? 'story' : 'on'`)
      if (where !== 'story') break
    }
    await page.evaluate(`const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 100 && !document.querySelector('.loading-screen'); i++) await sleep(50); for (let i = 0; i < 600 && (document.querySelector('.loading-screen') || !window.__deliverItScooter); i++) await sleep(100)`)
    await page.evaluate(`window.__deliverItQuality('${QUALITY}'); window.__deliverItLockDpr = 1; ${KEEP_AWAKE}`)
    await page.sleep(SETTLE * 1000)
    out.spots[spot] = JSON.parse(await page.evaluate(SAMPLE))
    if (process.env.SHOT) await page.shot(`${process.env.SHOT}-${spot}.jpg`)
    await page.evaluate(`clearInterval(window.__awake)`)
  }
  out.console = page.logs.filter((l) => !/Clock|KTX2|non-indexed/.test(l)).slice(0, 6)
  console.log(JSON.stringify(out, null, 1))
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1))
}
