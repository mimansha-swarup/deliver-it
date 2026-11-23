import { useFrame as useFiberFrame, type RootState } from '@react-three/fiber'
import { timed, timing, type Step } from './frameSteps'

export { addTime, counts, debugLevel, endFrame, report, timed, timing, type Step } from './frameSteps'

/*
 * Where a frame's time goes, step by step: for `?debug=2`, in any build (the deployed one too).
 *
 * Every per-frame callback in the game is registered through `timedFrame('<step>')` in place of
 * react-three-fiber's `useFrame`, which is all it is unless timing is on. With timing on, each
 * call is timed and added to its step's total for the frame; `timed('<step>', fn)` does the same
 * for a piece inside a callback (the physics step inside the traffic's, the sounds inside it).
 * The picture itself is drawn by the effects library's own callback, which is found and timed by
 * the overlay (dev/FpsOverlay.tsx), with the shadow pass inside it timed apart.
 *
 * React's own work never happens in these callbacks: it's counted from the hook React reports
 * its commits to (installed in main.tsx before React loads), as commits a second for the page
 * (the HUD, the phone, the menus) and for the 3D scene's tree, and timed as the tasks React's
 * scheduler runs. Changes to the game's store are counted too: a store written to every frame
 * is what makes a HUD re-render every frame.
 */

/** The callbacks registered here, so the overlay can tell them from a library's (which it times itself). */
export const ownFrames = new WeakSet<object>()

/** `useFrame`, with the step its work belongs to. */
export function timedFrame(name: Step) {
  return function useFrame(callback: (state: RootState, delta: number, frame?: XRFrame) => void, priority?: number) {
    const run = (state: RootState, delta: number, frame?: XRFrame) => {
      if (timing.on) timed(name, () => callback(state, delta, frame))
      else callback(state, delta, frame)
    }
    if (timing.on) ownFrames.add(run)
    useFiberFrame(run, priority)
  }
}

