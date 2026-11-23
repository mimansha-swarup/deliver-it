/**
 * The polish sprints' ride benchmark: a brand-new player (`?fresh=1&debug=1`), through the story
 * cards, then the first three seconds after the loading screen goes, then 60 s of an autopilot
 * riding a route across the layout. Steps for scripts/drive.mjs:
 *
 *     HOUR=10 WEATHER=clear QUALITY=high OUT=clips/polish-2/before/day-high.json \
 *       node --experimental-websocket scripts/drive.mjs scripts/ride_bench.mjs 1500x900 --windowed
 *
 * HOUR and WEATHER set the sky (night rain: HOUR=21 WEATHER=rain); QUALITY is low, medium or high
 * (left out: whatever a new player is given); THROTTLE=4 slows the CPU for the ride; SCALE=0.75
 * holds the render scale; SECONDS is the ride's length (60); SHOT saves a picture mid-ride.
 * It reports frame intervals as a player sees them: FPS, the worst frame, frames over 20 and 50 ms.
 */
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const HOUR = process.env.HOUR ?? '10'
const WEATHER = process.env.WEATHER ?? 'clear'
const QUALITY = process.env.QUALITY ?? ''
const THROTTLE = Number(process.env.THROTTLE ?? 1)
const SCALE = Number(process.env.SCALE ?? 0)
const SECONDS = Number(process.env.SECONDS ?? 60)
const SPEED = Number(process.env.SPEED ?? 40)

/** The autopilot, run inside the page ten times a second: follows the route line to the waypoint. */
export const AUTOPILOT = `
const held = new Set()
const set = (code, down) => { if (down === held.has(code)) return; down ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })) }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
window.__botStop = () => { clearInterval(window.__bot); for (const code of [...held]) set(code, false) }
window.__bot = setInterval(() => {
  const store = window.__deliverItStore, v = window.__deliverItScooter, f = window.__deliverItFoot
  if (!store || !v || !f) return
  const g = store.getState()
  const pts = f.route.points
  if (!f.route.active || pts.length < 4) { set('KeyW', true); set('KeyA', false); set('KeyD', false); return }
  let best = 0, bestD = Infinity
  for (let i = 0; i < pts.length; i += 2) { const d = Math.hypot(pts[i] - v.x, pts[i + 1] - v.z); if (d < bestD) { bestD = d; best = i } }
  let aim = best, run = 0
  while (aim + 2 < pts.length && run < 9) { run += Math.hypot(pts[aim + 2] - pts[aim], pts[aim + 3] - pts[aim + 1]); aim += 2 }
  const err = wrap(Math.atan2(pts[aim] - v.x, pts[aim + 1] - v.z) - v.heading)
  set('KeyA', err > 0.07); set('KeyD', err < -0.07)
  const want = Math.abs(err) > 0.45 ? 13 : Math.abs(err) > 0.2 ? 22 : ${SPEED}
  set('KeyW', g.speedKmh < want); set('KeyS', g.speedKmh > want + 9)
}, 100)
`

/** A waypoint about `metres` away by straight line, for the autopilot to ride to. */
export const WAYPOINT = (metres) => `
const g = window.__deliverItStore.getState(); const graph = g.planner.graph; const v = window.__deliverItScooter
let pick = 0, bestScore = -Infinity
for (let n = 0; n < graph.xs.length; n += 37) { const d = Math.hypot(graph.xs[n] - v.x, graph.zs[n] - v.z); const score = -Math.abs(d - ${metres}); if (score > bestScore) { bestScore = score; pick = n } }
g.setWaypoint({ x: graph.xs[pick], z: graph.zs[pick], node: pick })
`

const FRAMES = `window.__frames = []; let lastT = 0; window.__framesOn = true; const count = (t) => { if (lastT) window.__frames.push(t - lastT); lastT = t; if (window.__framesOn) requestAnimationFrame(count) }; requestAnimationFrame(count)`
const SUMMARY = `const f = window.__frames; window.__framesOn = false; const sum = f.reduce((a, b) => a + b, 0); const sorted = [...f].sort((a, b) => a - b)
let t = 0; const hitches = []; for (const ms of f) { t += ms; if (ms > 50) hitches.push({ at: +(t / 1000).toFixed(1), ms: Math.round(ms) }) }
const gl = window.__deliverIt?.gl
return JSON.stringify({ fps: +(1000 * f.length / sum).toFixed(1), worstMs: Math.round(sorted.at(-1)), over20: f.filter((x) => x > 20).length, over50: f.filter((x) => x > 50).length, p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), frames: f.length, seconds: +(sum / 1000).toFixed(1), hitches: hitches.slice(0, 12), drawRatio: gl ? +gl.getPixelRatio().toFixed(2) : null, quality: window.__deliverItStore.getState().quality, kmh: Math.round(window.__deliverItStore.getState().speedKmh) })`

export async function start(page, query) {
  await page.goto(`${BASE}/?fresh=1&debug=1${query}`, 2500)
  await page.evaluate(`const s = document.createElement('style'); s.textContent = '.fps-overlay { display: none !important }'; document.head.append(s); for (let i = 0; i < 80 && !document.querySelector('.title-start'); i++) await new Promise(r => setTimeout(r, 250))`)
  const t0 = Date.now()
  await page.evaluate(`document.querySelector('.title-start').click()`)
  // The story's cards, then the loading screen, timing frames from the moment it has gone.
  for (let i = 0; i < 12; i++) {
    await page.sleep(500)
    const where = await page.evaluate(`const s = document.querySelector('.story'); if (s) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true })); return s ? 'story' : 'loading'`)
    if (where !== 'story') break
  }
  const storyDone = Date.now()
  // Frames are timed from the moment the loading screen starts to fade: that is when the player first sees the street.
  await page.evaluate(`const sleep = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 100 && !document.querySelector('.loading-screen'); i++) await sleep(50)
    await new Promise((done) => { const tick = () => { const cover = document.querySelector('.loading-screen'); if ((!cover || cover.dataset.leaving === 'true') && window.__deliverItFoot) done(); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    ${FRAMES}`)
  return { loadSeconds: +((Date.now() - storyDone) / 1000).toFixed(1), t0 }
}

export async function run(page) {
  const out = {}
  const { loadSeconds } = await start(page, `&hour=${HOUR}&weather=${WEATHER}`)
  out.loadSeconds = loadSeconds
  await page.sleep(3000)
  // The first three seconds a new player sees, second by second.
  out.first3s = JSON.parse(await page.evaluate(`const f = [...window.__frames]; const per = [0, 0, 0]; let t = 0; for (const ms of f) { const s = Math.floor(t / 1000); if (s < 3) per[s]++; t += ms } ; const r = JSON.parse(await (async () => { ${SUMMARY} })()); return JSON.stringify({ fpsPerSecond: per, fps: r.fps, worstMs: r.worstMs, over20: r.over20, over50: r.over50, quality: r.quality })`))
  if (QUALITY) await page.evaluate(`window.__deliverItQuality('${QUALITY}')`)
  if (SCALE) await page.evaluate(`window.__deliverItLockDpr = ${SCALE}`)
  await page.evaluate(`const sky = window.__deliverItSky; if (sky) { sky.hours = ${HOUR}; sky.weather = '${WEATHER}'; sky.weatherLeft = 9999; ${WEATHER === 'rain' ? 'sky.rain = 1; sky.clouds = 1' : 'sky.rain = 0; sky.clouds = 0.2'} }`)
  await page.sleep(5000)
  await page.evaluate(WAYPOINT(1300))
  await page.sleep(500)
  if (THROTTLE > 1) await page.throttle(THROTTLE)
  await page.evaluate(AUTOPILOT)
  await page.evaluate(FRAMES)
  if (process.env.SHOT) {
    await page.sleep((SECONDS * 1000) / 2)
    await page.shot(process.env.SHOT)
    await page.sleep((SECONDS * 1000) / 2)
  } else await page.sleep(SECONDS * 1000)
  out.ride = JSON.parse(await page.evaluate(SUMMARY))
  if (THROTTLE > 1) await page.throttle(1)
  await page.evaluate(`window.__botStop()`)
  out.settings = { hour: +HOUR, weather: WEATHER, quality: QUALITY || 'default', throttle: THROTTLE, scale: SCALE || 'auto', seconds: SECONDS }
  out.console = page.logs.filter((l) => !/Clock|KTX2|non-indexed/.test(l)).slice(0, 6)
  console.log(JSON.stringify(out, null, 1))
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1))
}
