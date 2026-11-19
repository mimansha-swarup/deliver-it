/*
 * Where each saved thing lives in the browser. With `?debug` in the address everything saved goes
 * to its own "-debug" copy, so the debug panel (level, rating, credits, every vehicle) and test rides
 * never touch the player's real save. The debug copy starts as a copy of the real one.
 */

/** Whether this visit uses the debug save: `?debug` or `?debug=1` in the address. */
export const DEBUG_SAVE: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

/** Every debug key made so far, so the debug panel can clear them all. */
const debugKeys: string[] = []

/** The key something is saved under: its own, or its debug copy (seeded from the real one the first time). */
export function saveKey(name: string): string {
  if (!DEBUG_SAVE) return name
  const key = `${name}-debug`
  debugKeys.push(key)
  try {
    const real = localStorage.getItem(name)
    if (localStorage.getItem(key) === null && real !== null) localStorage.setItem(key, real)
  } catch {
    // Storage refused (a private window): nothing is saved either way.
  }
  return key
}

/** Throws the debug save away; the next load starts again from a copy of the real one. */
export function clearDebugSave() {
  if (!DEBUG_SAVE) return
  try {
    for (const key of debugKeys) localStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

/**
 * A save that used to live under another name (the project's earlier one) is moved to its new name,
 * once: the first load after the rename copies it across and removes the old key, so progress is kept.
 */
export function migrateSave(from: string, to: string) {
  try {
    const old = localStorage.getItem(from)
    if (old === null) return
    if (localStorage.getItem(to) === null) localStorage.setItem(to, old)
    localStorage.removeItem(from)
  } catch {
    // Storage refused: nothing to move.
  }
}
