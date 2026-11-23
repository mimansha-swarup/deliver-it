// One build, as the playtest measures it: a fresh player, 10 s standing at the first spawn, then 15 s riding the first order's route.
import { writeFileSync } from 'node:fs'
const BASE = process.env.BASE
const AUTOPILOT = `
const held = new Set()
const set = (code, down) => { if (down === held.has(code)) return; down ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })) }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
window.__botStop = () => { clearInterval(window.__bot); for (const code of [...held]) set(code, false) }
window.__bot = setInterval(() => {
  const v = window.__deliverItScooter, f = window.__deliverItFoot, g = window.__deliverItStore.getState()
  const pts = f.route.points
  if (!f.route.active || pts.length < 4) { set('KeyW', true); return }
  let best = 0, bestD = Infinity
  for (let i = 0; i < pts.length; i += 2) { const d = Math.hypot(pts[i] - v.x, pts[i + 1] - v.z); if (d < bestD) { bestD = d; best = i } }
  let aim = best, run = 0
  while (aim + 2 < pts.length && run < 9) { run += Math.hypot(pts[aim + 2] - pts[aim], pts[aim + 3] - pts[aim + 1]); aim += 2 }
  const err = wrap(Math.atan2(pts[aim] - v.x, pts[aim + 1] - v.z) - v.heading)
  set('KeyA', err > 0.07); set('KeyD', err < -0.07)
  const want = Math.abs(err) > 0.45 ? 13 : Math.abs(err) > 0.2 ? 22 : 38
  set('KeyW', g.speedKmh < want); set('KeyS', g.speedKmh > want + 9)
}, 100)`
const MEASURE = (ms) => `const f = []; let last = 0; const end = performance.now() + ${ms}
  await new Promise((done) => { const tick = (t) => { if (last) f.push(t - last); last = t; if (performance.now() < end) requestAnimationFrame(tick); else done() }; requestAnimationFrame(tick) })
  const sum = f.reduce((a, b) => a + b, 0); const gl = window.__deliverIt.gl; const s = [...f].sort((a, b) => a - b)
  return JSON.stringify({ fps: Math.round(1000 * f.length / sum), worst: Math.round(Math.max(...f)), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), scale: +gl.getPixelRatio().toFixed(2), kmh: Math.round(window.__deliverItStore.getState().speedKmh), calls: null })`
// What a frame costs, whatever the screen's rate: every callback of a frame timed, ending with a one-pixel read-back so the GPU's work is waited for.
const WORK = (ms) => `if (!window.__work) { const ctx = window.__deliverIt.gl.getContext(); const pixel = new Uint8Array(4); const raf = window.requestAnimationFrame.bind(window); const w = (window.__work = { on: false, frames: new Map(), cpu: new Map() })
    window.requestAnimationFrame = (cb) => raf((stamp) => { const start = performance.now(); cb(stamp); if (w.on) { const mid = performance.now(); ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel); w.frames.set(stamp, (w.frames.get(stamp) ?? 0) + performance.now() - start); w.cpu.set(stamp, (w.cpu.get(stamp) ?? 0) + mid - start) } }) }
  const w = window.__work; await new Promise(r => setTimeout(r, 300)); w.frames.clear(); w.cpu.clear(); w.on = true; await new Promise(r => setTimeout(r, ${ms})); w.on = false
  const all = [...w.frames.values()].sort((a, b) => a - b), cpu = [...w.cpu.values()]; const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  return JSON.stringify({ ms: +mean(all).toFixed(2), p95: +all[Math.floor(all.length * 0.95)].toFixed(1), js: +mean(cpu).toFixed(2) })`
export async function run(page) {
  // Nothing here should take two minutes: if it does, the page never loaded.
  const guard = setTimeout(() => { console.error('timed out'); process.exit(1) }, 120000)
  await page.goto(`${BASE}/?fresh=1&debug=1${process.env.QUERY ?? ''}`, 2500)
  await page.evaluate(`for (let i = 0; i < 80 && !document.querySelector('.title-start'); i++) await new Promise(r => setTimeout(r, 250))`)
  await page.evaluate(`document.querySelector('.title-start').click()`)
  for (let i = 0; i < 12; i++) {
    await page.sleep(500)
    const where = await page.evaluate(`const s = document.querySelector('.story'); if (s) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true })); return s ? 'story' : 'loading'`)
    if (where !== 'story') break
  }
  const t0 = Date.now()
  // From the last story card to the cover starting to lift, with every frame under and after it timed.
  await page.evaluate(`const sleep = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 100 && !document.querySelector('.loading-screen'); i++) await sleep(50)
    window.__all = []; let last = 0; const tick = (t) => { if (last) window.__all.push([t, t - last]); last = t; requestAnimationFrame(tick) }; requestAnimationFrame(tick)
    await new Promise((done) => { const look = () => { const cover = document.querySelector('.loading-screen'); if ((!cover || cover.dataset.leaving === 'true') && window.__deliverItFoot) { window.__lift = performance.now(); done() } else requestAnimationFrame(look) }; requestAnimationFrame(look) })`)
  const load = (Date.now() - t0) / 1000
  await page.sleep(4200)
  const first = JSON.parse(await page.evaluate(`const lift = window.__lift; const after = window.__all.filter(([t]) => t >= lift && t < lift + 4000); const per = [0, 0, 0, 0]; for (const [t] of after) per[Math.min(3, Math.floor((t - lift) / 1000))]++
    const under = window.__all.filter(([t]) => t < lift && t > lift - 3000).map(([, ms]) => ms)
    return JSON.stringify({ perSecond: per, worstAfter: Math.round(Math.max(...after.map(([, ms]) => ms))), worstUnderCover: Math.round(Math.max(0, ...under)) })`))
  if (process.env.LOCK) { await page.evaluate(`window.__deliverItLockDpr = ${process.env.LOCK}`); await page.sleep(2500) }
  const standing = JSON.parse(await page.evaluate(MEASURE(10000)))
  const standingWork = JSON.parse(await page.evaluate(WORK(4000)))
  // The first order, accepted, and its route ridden.
  await page.evaluate(`for (let i = 0; i < 40 && !window.__deliverItStore.getState().offer; i++) await new Promise(r => setTimeout(r, 250)); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true })); await new Promise(r => setTimeout(r, 600))`)
  await page.evaluate(AUTOPILOT)
  await page.sleep(1500)
  const riding = JSON.parse(await page.evaluate(MEASURE(15000)))
  const ridingWork = JSON.parse(await page.evaluate(WORK(6000)))
  await page.evaluate(`window.__botStop()`)
  const info = await page.evaluate(`const s = window.__deliverItScaler; return JSON.stringify({ scaler: s ?? null, overlay: document.querySelector('.fps-overlay')?.textContent.replace(/\\n/g, ' | ') ?? '' })`)
  const out = { name: process.env.NAME, load: +load.toFixed(1), first, standing, riding, standingWork, ridingWork, info: JSON.parse(info) }
  console.log(JSON.stringify(out))
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out))
  clearTimeout(guard)
}
