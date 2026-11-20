/*
 * Where each saved thing lives in the browser. With `?debug` in the address everything saved goes
 * to its own "-debug" copy, so the debug panel (level, rating, credits, every vehicle) and test rides
 * never touch the player's real save. The debug copy starts as a copy of the real one.
 */

/** Whether this visit uses the debug save: `?debug` or `?debug=1` in the address. */
export const DEBUG_SAVE: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

/** Every debug key made so far, so the debug panel can clear them all. */
const debugKeys: string[] = []

/**
 * Everything saved is under a key starting with the game's name. It was "Deliver It" before it was
 * "Swalpa Fast", and saves made then are under the old start: each is moved to its new key the
 * first time it's asked for, so nobody's progress is lost to the rename.
 */
const PREFIX = 'swalpa-fast-'
const OLD_PREFIX = 'deliver-it-'

/** Every key in use, real and debug, so a fresh start can clear them all. */
const allKeys = new Set<string>()

/** The key something is saved under: its own, or its debug copy (seeded from the real one the first time). */
export function saveKey(name: string): string {
  if (name.startsWith(PREFIX)) migrateSave(OLD_PREFIX + name.slice(PREFIX.length), name)
  allKeys.add(name)
  if (!DEBUG_SAVE) return name
  const key = `${name}-debug`
  debugKeys.push(key)
  allKeys.add(key)
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

/**
 * A fresh start: everything this visit saves under is thrown away (the debug copies with `?debug`,
 * the real ones without), and the page is loaded again from nothing. Settings that aren't progress
 * (the keys, the picture and sound) are kept.
 */
export function clearProgress(keep: string[] = []) {
  try {
    for (const key of allKeys) {
      if (keep.includes(key) || key.endsWith('-debug') !== DEBUG_SAVE) continue
      localStorage.removeItem(key)
    }
  } catch {
    // Nothing to clear.
  }
}
