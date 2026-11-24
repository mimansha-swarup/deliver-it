/**
 * What the game costs the machine on the menu, standing and riding: frames a second, the main
 * thread's work (per frame, and as a share of each second), GPU time a frame where the browser
 * gives it, and the CPU the browser's page and GPU processes use (the nearest thing to power a
 * script can read without administrator rights).
 *
 *     npx vite preview --port 4173 &
 *     BASE=http://localhost:4173 node --experimental-websocket scripts/drive.mjs scripts/power_bench.mjs 1512x860 --windowed
 *
 * QUERY adds to the address (QUERY="&fps=unlimited"); SECONDS is how long each part is measured (15).
 */
import { execSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const SECONDS = Number(process.env.SECONDS ?? 15)

/** CPU use of this run's own Chrome, by kind of process, in percent of one core. */
function chromeCpu() {
  const rows = execSync('ps -axo pcpu=,command=', { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n').filter((row) => row.includes('swalpa-drive-'))
  const sum = (test) => rows.filter(test).reduce((total, row) => total + parseFloat(row), 0)
  return { page: sum((row) => row.includes('--type=renderer')), gpu: sum((row) => row.includes('--type=gpu-process')), all: sum(() => true) }
}

const MEASURE = `
  const { gl } = window.__deliverIt
  const context = gl.getContext()
  const timer = context.getExtension('EXT_disjoint_timer_query_webgl2')
  const native = window.requestAnimationFrame
  let work = 0, ticks = 0, frames = 0, seenTick = -1, lastFrame = gl.info.render.frame, gpuNs = 0, gpuFrames = 0, query = null
  const waiting = []
  window.requestAnimationFrame = (callback) => native.call(window, (stamp) => {
    if (stamp !== seenTick) {
      seenTick = stamp
      ticks++
      if (gl.info.render.frame !== lastFrame) { frames++; lastFrame = gl.info.render.frame }
      if (timer) {
        if (query) { context.endQuery(timer.TIME_ELAPSED_EXT); waiting.push(query) }
        query = context.createQuery(); context.beginQuery(timer.TIME_ELAPSED_EXT, query)
        while (waiting.length && context.getQueryParameter(waiting[0], context.QUERY_RESULT_AVAILABLE)) { const done = waiting.shift(); gpuNs += context.getQueryParameter(done, context.QUERY_RESULT); gpuFrames++; context.deleteQuery(done) }
      }
    }
    const began = performance.now(); callback(stamp); work += performance.now() - began
  })
  const began = performance.now()
  await new Promise((resolve) => setTimeout(resolve, ${SECONDS * 1000}))
  const seconds = (performance.now() - began) / 1000
  window.requestAnimationFrame = native
  if (query) context.endQuery(timer.TIME_ELAPSED_EXT)
  return { fps: frames / seconds, screenTicks: ticks / seconds, workPerFrame: work / Math.max(1, frames), busy: work / (seconds * 10), gpuMs: gpuFrames ? gpuNs / gpuFrames / 1e6 : null, scale: gl.getPixelRatio(), overlay: document.querySelector('.fps-overlay')?.textContent.split('\\n').slice(0, 2).join(' | ') ?? '' }`

const BOT = `const held = new Set(); const set = (code, down) => { if (down === held.has(code)) return; down ? held.add(code) : held.delete(code); window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true })) }; const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)); window.__stop = () => { clearInterval(window.__bot); for (const c of [...held]) set(c, false) }
window.__bot = setInterval(() => { const v = window.__deliverItScooter, f = window.__deliverItFoot, g = window.__deliverItStore.getState(); const pts = f.route.points; if (!f.route.active || pts.length < 4) { set('KeyW', true); return } let best = 0, bestD = Infinity; for (let i = 0; i < pts.length; i += 2) { const d = Math.hypot(pts[i] - v.x, pts[i + 1] - v.z); if (d < bestD) { bestD = d; best = i } } let aim = best, run = 0; while (aim + 2 < pts.length && run < 9) { run += Math.hypot(pts[aim + 2] - pts[aim], pts[aim + 3] - pts[aim + 1]); aim += 2 } const err = wrap(Math.atan2(pts[aim] - v.x, pts[aim + 1] - v.z) - v.heading); set('KeyA', err > 0.07); set('KeyD', err < -0.07); const want = Math.abs(err) > 0.45 ? 13 : Math.abs(err) > 0.2 ? 22 : 38; set('KeyW', g.speedKmh < want); set('KeyS', g.speedKmh > want + 9) }, 100)`

export async function run(page) {
  const guard = setTimeout(() => { console.error('timed out'); process.exit(1) }, 240000)
  const measure = async (name) => {
    const samples = []
    const sampler = setInterval(() => samples.push(chromeCpu()), 1000)
    const result = await page.evaluate(MEASURE)
    clearInterval(sampler)
    const mean = (key) => samples.reduce((total, sample) => total + sample[key], 0) / Math.max(1, samples.length)
    console.log(JSON.stringify({ part: name, fps: +result.fps.toFixed(1), workMsPerFrame: +result.workPerFrame.toFixed(2), mainThreadBusyPercent: +result.busy.toFixed(1), gpuMsPerFrame: result.gpuMs === null ? 'n/a' : +result.gpuMs.toFixed(2), pageCpuPercent: +mean('page').toFixed(0), gpuProcessCpuPercent: +mean('gpu').toFixed(0), chromeCpuPercent: +mean('all').toFixed(0), renderScale: result.scale, screenHz: Math.round(result.screenTicks), overlay: result.overlay }))
  }
  await page.goto(`${BASE}/?fresh=1&debug=1${process.env.QUERY ?? ''}`, 2500)
  await page.evaluate(`for (let i = 0; i < 120 && !(document.querySelector('.title-start') && window.__deliverIt); i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 6000))`)
  await measure('menu')
  await page.evaluate(`const sleep = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('.title-start').click()
    for (let i = 0; i < 12; i++) { await sleep(400); const s = document.querySelector('.story'); if (s) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })); else break }
    for (let i = 0; i < 300 && (document.querySelector('.loading-screen') || !window.__deliverItFoot); i++) await sleep(100); await sleep(10000)`)
  await measure('standing')
  await page.evaluate(`for (let i = 0; i < 40 && !window.__deliverItStore.getState().offer; i++) await new Promise(r => setTimeout(r, 250)); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true })); await new Promise(r => setTimeout(r, 600)); ${BOT}; await new Promise(r => setTimeout(r, 5000))`)
  await measure('riding')
  await page.evaluate(`window.__stop()`)
  clearTimeout(guard)
}
