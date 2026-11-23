/*
 * The part of the frame timing (dev/frameTimes.ts) that has to load before React does: no imports,
 * so nothing of React's is pulled in ahead of the hook it reports to.
 */

/** 0: off. 1: `?debug` (the frame-rate overlay). 2: `?debug=2` (the breakdown as well). */
export const debugLevel: number = (() => {
  if (typeof location === 'undefined') return 0
  const value = new URLSearchParams(location.search).get('debug')
  if (value === null) return 0
  return Math.max(1, Number(value) || 1)
})()

export const timing = { on: debugLevel >= 2 }

/** The steps, as the overlay names them. */
export type Step =
  | 'physics (Rapier)'
  | 'traffic AI'
  | 'traffic drawing (instances, wheels, lamps)'
  | 'pedestrians'
  | 'rider and vehicle'
  | 'camera'
  | 'rain and particles'
  | 'audio updates'
  | 'minimap and arrow'
  | 'lights and sky'
  | 'missions and markers'
  | 'world upkeep (streaming, culling, signs)'
  | 'resolution scaler'
  | 'draw: shadows'
  | 'draw: scene and effects'
  | 'React: page (HUD, phone)'
  | 'other callbacks'

type Totals = { now: number; sum: number; frames: number; worst: number; worstAt: number }
const steps = new Map<string, Totals>()
const entry = (name: string): Totals => {
  let totals = steps.get(name)
  if (!totals) {
    totals = { now: 0, sum: 0, frames: 0, worst: 0, worstAt: 0 }
    steps.set(name, totals)
  }
  return totals
}

/** Adds time to a step for the frame being made. */
export function addTime(name: Step, ms: number) {
  entry(name).now += ms
}

/** Runs `fn`, timing it as part of a step when timing is on. Time it spends in a step nested inside it is that step's, not its own. */
let nested = 0
export function timed<T>(name: Step, fn: () => T): T {
  if (!timing.on) return fn()
  const outer = nested
  nested = 0
  const began = performance.now()
  try {
    return fn()
  } finally {
    const took = performance.now() - began
    entry(name).now += Math.max(0, took - nested)
    nested = outer + took
  }
}

/** Counted between two looks of the overlay. */
export const counts = { pageCommits: 0, sceneCommits: 0, storeWrites: 0 }

/** How long the averages run over, and how long a worst frame is remembered, in milliseconds. */
const WINDOW = { frames: 120, worstMs: 5000 }

/** The end of a frame: each step's time for it goes into its running average and its worst. */
export function endFrame(now: number) {
  for (const totals of steps.values()) {
    // A running average over about the last `WINDOW.frames` frames.
    totals.frames = Math.min(WINDOW.frames, totals.frames + 1)
    totals.sum += (totals.now - totals.sum) / totals.frames
    if (totals.now >= totals.worst || now - totals.worstAt > WINDOW.worstMs) {
      totals.worst = totals.now
      totals.worstAt = now
    }
    totals.now = 0
  }
}

/** Every step, costliest first: its average and worst milliseconds a frame. */
export function report(): { name: string; average: number; worst: number }[] {
  return [...steps.entries()].map(([name, totals]) => ({ name, average: totals.sum, worst: totals.worst })).sort((a, b) => b.average - a.average)
}

/**
 * Before React loads (main.tsx imports this first): the hook React tells of its commits, and a
 * timer round the tasks its scheduler runs. Only with `?debug=2`; nothing is touched otherwise.
 */
export function watchReact() {
  if (!timing.on || typeof window === 'undefined') return
  const global = window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Record<string, unknown> }
  // Left alone if React's own developer tools are there: they're the hook then.
  if (!global.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let nextId = 0
    const kinds = new Map<number, string>()
    global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      checkDCE() {},
      inject(renderer: { rendererPackageName?: string }) {
        const id = ++nextId
        kinds.set(id, renderer?.rendererPackageName ?? '')
        return id
      },
      onCommitFiberRoot(id: number) {
        if (kinds.get(id) === 'react-dom') counts.pageCommits++
        else counts.sceneCommits++
      },
      onPostCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onScheduleFiberRoot() {},
      setStrictMode() {},
    }
  }
  // React's scheduler does its work in tasks posted through a MessageChannel: each is timed.
  const Native = window.MessageChannel
  window.MessageChannel = class extends Native {
    constructor() {
      super()
      const port = this.port1
      let handler: ((event: MessageEvent) => void) | null = null
      Object.defineProperty(port, 'onmessage', {
        configurable: true,
        get: () => handler,
        set: (next: ((event: MessageEvent) => void) | null) => {
          handler = next
          port.addEventListener('message', (event) => {
            if (!handler) return
            const began = performance.now()
            handler.call(port, event)
            entry('React: page (HUD, phone)').now += performance.now() - began
          })
          port.start()
        },
      })
    }
  }
}
