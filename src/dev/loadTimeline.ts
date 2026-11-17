/**
 * A timeline of loading, for finding what makes the wait long: when Play was
 * pressed, when the map arrived and was read, how long each planning step took,
 * when each part of the world went on screen, and when the ride began. Kept in
 * every build (it's a few numbers), and printed as a table with `?debug`.
 *
 * Read it from the console: `__deliverItLoad()`.
 */

type Mark = { label: string; at: number }

const marks: Mark[] = []

/** Records that something happened now. */
export function markLoad(label: string) {
  marks.push({ label, at: performance.now() })
}

/**
 * Times the steps of one long job, such as planning the world: call `lap(name)`
 * after each step and it's recorded with how long it took since the last lap.
 */
export function startLaps(label: string): (step: string) => void {
  let lastLap = performance.now()
  markLoad(`${label} start`)
  return (step) => {
    const now = performance.now()
    marks.push({ label: `  ${label}: ${step} (${Math.round(now - lastLap)} ms)`, at: now })
    lastLap = now
  }
}

/** The timeline so far, each mark with its time since the page opened, in seconds. */
export function loadTimeline(): { label: string; at: string }[] {
  return marks.map(({ label, at }) => ({ label, at: (at / 1000).toFixed(2) }))
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __deliverItLoad?: () => unknown }).__deliverItLoad = loadTimeline
}
