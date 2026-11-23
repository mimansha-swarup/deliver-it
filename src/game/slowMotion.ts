/**
 * Slow motion: for a moment after a crash the world runs slow, so the hit is seen. One number,
 * `liveTime.scale`, multiplies the time the rider's vehicle and the traffic step by (Scooter.tsx,
 * Traffic.tsx); the camera, the sky and the screen keep real time. It holds at `SLOW.scale` for
 * `SLOW.seconds` of real time, then eases back over `SLOW.ease`.
 */
export const SLOW = { scale: 0.35, seconds: 0.4, ease: 0.18 }

export const liveTime = { scale: 1, left: 0 }

export function startSlowMotion() {
  // Not again while one is still running: a second knock in the same tumble doesn't stretch it.
  if (liveTime.left > 0) return
  liveTime.left = SLOW.seconds + SLOW.ease
}

/** Run once a frame, with real seconds (Scooter.tsx). */
export function stepSlowMotion(realDelta: number) {
  if (liveTime.left <= 0) {
    liveTime.scale = 1
    return
  }
  liveTime.left = Math.max(0, liveTime.left - realDelta)
  const back = liveTime.left >= SLOW.ease ? 0 : 1 - liveTime.left / SLOW.ease
  liveTime.scale = SLOW.scale + (1 - SLOW.scale) * back * back * (3 - 2 * back)
}

/** How dark the screen is while the rider gets back up after a crash, 0 to 1: written each frame from the controller's `recoverDark`, drawn by ui/CrashFade.tsx. */
export const liveCrash = { dark: 0 }
