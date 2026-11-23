import { useEffect, useRef } from 'react'
import { useResolution } from '../game/resolution'
import { debugAsked } from './spawn'
import { counts, endFrame, ownFrames, report, timed, timing } from './frameTimes'
import { useGameStore } from '../game/gameStore'

/*
 * Only with `?debug=1` in the address (not just for being the dev server): frames per second and the worst frames, over the game, above the
 * minimap. It times frames with its own requestAnimationFrame, the gap between one picture and
 * the next as the player sees it, and writes the text straight into the page twice a second, so
 * it costs next to nothing and never re-renders React.
 *
 *   FPS        over the last second
 *   worst      the slowest frame in the last second, and in the last 10 s
 *   >20 ms     how many frames in the last 10 s took longer than 20 ms
 *   calls/tris the last frame's draw calls and triangles, and the resolution's pixels per point
 *   work       what the game itself spends on a frame (its JavaScript and handing the picture to
 *              the GPU), averaged over the last second, and the share of a frame's time that is.
 *              A low frame rate with little work in it is the browser or the GPU holding frames
 *              back (a battery saver, DevTools open, another tab's work), not the game's code.
 *   screen     the rate frames come at when nothing is late: the screen's own, as the browser gives it
 *
 * With `?debug=2`, under those: the five steps of a frame that cost the most (dev/frameTimes.ts), each
 * with its average and its worst milliseconds a frame; what's left of the frame's work that no step
 * accounts for; and, each second, how many times React committed (the page: HUD, phone and menus; and
 * the 3D scene's tree) and how many times the game's store was written to.
 */

/** What react-three-fiber keeps of the callbacks it runs each frame, as far as this needs it. */
type Subscriber = { ref: { current: ((...args: unknown[]) => void) & { timedBy?: string } }; priority: number }
type Fiber = { internal: { subscribers: Subscriber[] } }
type Renderer = { shadowMap: { render: (...args: unknown[]) => void; timedBy?: string } }

/**
 * Times what the game didn't register itself: the effects library's own callback, which draws the
 * picture (the scene, its shadows and every effect), and inside it the shadow pass. Looked for
 * again every second, as a callback is put back whenever its component renders.
 */
function timeLibraryFrames() {
  const game = (window as unknown as { __deliverIt?: { get?: () => Fiber; gl: Renderer } }).__deliverIt
  if (!game?.get) return
  for (const subscriber of game.get().internal.subscribers) {
    const callback = subscriber.ref.current
    if (callback.timedBy || ownFrames.has(callback)) continue
    const step = subscriber.priority > 0 ? 'draw: scene and effects' : 'other callbacks'
    subscriber.ref.current = Object.assign((...args: unknown[]) => timed(step, () => callback(...args)), { timedBy: step })
  }
  const shadows = game.gl.shadowMap
  if (!shadows.timedBy) {
    const render = shadows.render.bind(shadows)
    shadows.render = (...args: unknown[]) => timed('draw: shadows', () => render(...args))
    shadows.timedBy = 'draw: shadows'
  }
}

const WINDOW_MS = 10_000
const UPDATE_MS = 500

export function FpsOverlay() {
  const text = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!debugAsked()) return
    const frames: { at: number; ms: number }[] = []
    // three.js resets its counts at every render call, and the effects make several a frame: the
    // overlay resets them once a frame instead, so they're the whole frame's.
    type Info = { autoReset: boolean; reset: () => void; render: { calls: number; triangles: number } }
    const info = () => (window as unknown as { __deliverIt?: { gl: { info: Info } } }).__deliverIt?.gl.info
    let counted = { calls: 0, triangles: 0 }
    let last = performance.now()
    let shown = last
    // The game's own work in each frame: every animation-frame callback of the frame, timed and added up.
    const works: { at: number; ms: number }[] = []
    const nativeFrame = window.requestAnimationFrame
    let workStamp = -1
    let workSoFar = 0
    window.requestAnimationFrame = (callback) =>
      nativeFrame.call(window, (stamp) => {
        const began = performance.now()
        callback(stamp)
        const took = performance.now() - began
        if (stamp !== workStamp) {
          if (workStamp >= 0) works.push({ at: began, ms: workSoFar })
          workStamp = stamp
          workSoFar = 0
        }
        workSoFar += took
      })
    // `?debug=2`: the library's callbacks timed, and the store's writes counted.
    const timer = timing.on ? window.setInterval(timeLibraryFrames, 1000) : 0
    const offStore = timing.on ? useGameStore.subscribe(() => void counts.storeWrites++) : () => {}
    let countedAt = performance.now()
    let perSecond = { page: 0, scene: 0, store: 0 }
    let id = requestAnimationFrame(function tick(now) {
      const ms = now - last
      if (timing.on) endFrame(now)
      last = now
      frames.push({ at: now, ms })
      const gl = info()
      if (gl) {
        if (gl.autoReset) gl.autoReset = false
        counted = { calls: gl.render.calls, triangles: gl.render.triangles }
        gl.reset()
      }
      while (frames.length && frames[0].at < now - WINDOW_MS) frames.shift()
      if (now - shown > UPDATE_MS && text.current) {
        shown = now
        const second = frames.filter((frame) => frame.at > now - 1000)
        const worstSecond = Math.max(...second.map((frame) => frame.ms))
        const worstWindow = Math.max(...frames.map((frame) => frame.ms))
        const slow = frames.filter((frame) => frame.ms > 20).length
        const ratio = useResolution.getState().pixelRatio
        if (timing.on && now - countedAt >= 1000) {
          const seconds = (now - countedAt) / 1000
          perSecond = { page: Math.round(counts.pageCommits / seconds), scene: Math.round(counts.sceneCommits / seconds), store: Math.round(counts.storeWrites / seconds) }
          counts.pageCommits = counts.sceneCommits = counts.storeWrites = 0
          countedAt = now
        }
        // The costliest five steps, what no step accounts for, and React's and the store's counts.
        const breakdown = (workMs: number) => {
          const all = report()
          const known = all.reduce((sum, step) => sum + step.average, 0)
          const rows = all.slice(0, 5).map((step) => `${step.average.toFixed(2).padStart(6)} ms  worst ${step.worst.toFixed(1).padStart(5)}  ${step.name}`)
          return (
            `\n${rows.join('\n')}\n` +
            `${Math.max(0, workMs - known).toFixed(2).padStart(6)} ms  not in any step (all steps: ${known.toFixed(1)} ms)\n` +
            `React commits a second: page ${perSecond.page}, 3D scene ${perSecond.scene}  ·  store writes a second: ${perSecond.store}`
          )
        }
        while (works.length && works[0].at < now - 1000) works.shift()
        const work = works.length ? works.reduce((sum, frame) => sum + frame.ms, 0) / works.length : 0
        const usual = second.length ? second.reduce((sum, frame) => sum + frame.ms, 0) / second.length : 0
        // The quickest tenth of the last ten seconds' frames: the screen's own rate, give or take.
        const quick = frames.map((frame) => frame.ms).sort((a, b) => a - b)[Math.floor(frames.length * 0.1)] ?? 0
        text.current.textContent =
          `${second.length} FPS  worst ${worstSecond.toFixed(1)} ms (10 s: ${worstWindow.toFixed(1)})\n` +
          `>20 ms in 10 s: ${slow}` +
          `  ${counted.calls} calls  ${Math.round(counted.triangles / 1000)}k tris` +
          `  ${ratio}×\n` +
          `work ${work.toFixed(1)} ms a frame (${usual > 0 ? Math.round((work / usual) * 100) : 0}% of it)  screen ~${quick > 0 ? Math.round(1000 / quick) : 0} Hz` +
          (timing.on ? breakdown(work) : '')
        text.current.dataset.slow = worstSecond > 33 ? 'bad' : worstSecond > 20 ? 'warn' : 'ok'
      }
      id = requestAnimationFrame(tick)
    })
    return () => {
      window.requestAnimationFrame = nativeFrame
      window.clearInterval(timer)
      offStore()
      cancelAnimationFrame(id)
      const gl = info()
      if (gl) gl.autoReset = true
    }
  }, [])
  if (!debugAsked()) return null
  return <pre ref={text} className="fps-overlay" aria-hidden="true" />
}
