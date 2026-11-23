import { useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import type { Object3D } from 'three'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/*
 * Nearly nothing in the city moves as an object: roads, kerbs, markings, buildings, cables and
 * trees stay where they were put, and what does move (traffic, people, leaves) moves inside its
 * own instances or its shader. Yet three.js works out every object's placement afresh each frame:
 * some 3,700 of them, a sixth of the game's own work on a slow processor.
 *
 * So what has stayed put is frozen: its placement is worked out once and kept. It is watched, a
 * slice each frame: anything frozen that then moves (a gate, a train, a prop given a new place)
 * is thawed at once and never frozen again. The player, the sky and the lights are left alone.
 */

const LEFT_ALONE = new Set(['part:player', 'part:sky', 'part:lighting'])
/** How many objects are looked at each frame, how often the scene is searched for new ones (seconds), and how many looks in a row unmoved before freezing. */
const WATCH = { each: 320, searchEvery: 1, settled: 2 }

type Kept = { pose: Float64Array; still: number; frozen: boolean; moves: boolean }

function sameAndKeep(object: Object3D, pose: Float64Array): boolean {
  const { position: p, quaternion: q, scale: s } = object
  const now = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]
  let same = true
  for (let i = 0; i < 10; i++) {
    if (pose[i] !== now[i]) same = false
    pose[i] = now[i]
  }
  return same
}

export function StaticMatrices() {
  const kept = useRef(new WeakMap<Object3D, Kept>())
  const watched = useRef<Object3D[]>([])
  const at = useRef({ next: 0, since: Infinity })

  useFrame(({ scene }, delta) => {
    const state = at.current
    state.since += delta
    if (state.since >= WATCH.searchEvery) {
      state.since = 0
      const list: Object3D[] = []
      for (const part of scene.children) {
        if (LEFT_ALONE.has(part.name)) continue
        part.traverse((object) => {
          // Placed by hand already (matrixAutoUpdate off, and not by this): not ours to watch.
          if (!object.matrixAutoUpdate && !kept.current.has(object)) return
          list.push(object)
        })
      }
      watched.current = list
    }
    const list = watched.current
    const count = Math.min(WATCH.each, list.length)
    for (let n = 0; n < count; n++) {
      state.next = (state.next + 1) % list.length
      const object = list[state.next]
      let entry = kept.current.get(object)
      if (!entry) {
        entry = { pose: new Float64Array(10), still: 0, frozen: false, moves: false }
        sameAndKeep(object, entry.pose)
        kept.current.set(object, entry)
        continue
      }
      if (entry.moves) continue
      if (sameAndKeep(object, entry.pose)) {
        if (!entry.frozen && ++entry.still >= WATCH.settled) {
          object.updateMatrix()
          object.matrixAutoUpdate = false
          entry.frozen = true
        }
      } else {
        // It moved: live from now on.
        entry.moves = true
        entry.frozen = false
        object.matrixAutoUpdate = true
      }
    }
  })
  return null
}
