import { useEffect, useRef } from 'react'
import { useResolution } from '../game/resolution'
import { debugAsked } from './spawn'

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
 */

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
    let id = requestAnimationFrame(function tick(now) {
      const ms = now - last
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
          `work ${work.toFixed(1)} ms a frame (${usual > 0 ? Math.round((work / usual) * 100) : 0}% of it)  screen ~${quick > 0 ? Math.round(1000 / quick) : 0} Hz`
        text.current.dataset.slow = worstSecond > 33 ? 'bad' : worstSecond > 20 ? 'warn' : 'ok'
      }
      id = requestAnimationFrame(tick)
    })
    return () => {
      window.requestAnimationFrame = nativeFrame
      cancelAnimationFrame(id)
      const gl = info()
      if (gl) gl.autoReset = true
    }
  }, [])
  if (!debugAsked()) return null
  return <pre ref={text} className="fps-overlay" aria-hidden="true" />
}
