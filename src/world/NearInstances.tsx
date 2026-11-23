import { useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { livePlayer, liveView } from '../game/livePlayer'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/*
 * Many things in the city are one shape copied all over the map and drawn in one call: signal
 * poles, zebra stripes, the edge wall's panels, the goods on shop shelves. One call is cheap, but
 * the graphics card still works through every copy on the map each frame, twice where they cast
 * shadows: over half a million triangles a frame for things mostly kilometres away.
 *
 * This keeps such a shape to the copies within sight. Each big, unmoving set of copies is found
 * (searched for once a second, and only taken once it has stayed unchanged for a few looks, so
 * nothing that moves is touched), its copies' places are kept, and as the rider moves the ones
 * within the draw distance are put at the front and only those are drawn. If anything else then
 * changes the set, it is put back exactly as it was and left alone for good. A set can also ask
 * to be left alone (`userData.keepAll`): one whose copies are recoloured by their numbers.
 */

/** A set is worth it from this many copies and this many triangles in all. */
const WORTH = { copies: 250, triangles: 12000 }
/** Looked for every `search` seconds; taken after `steady` unchanged looks; repacked after the rider has moved `moved` metres; kept `margin` metres past the draw distance. */
const WATCH = { search: 1, steady: 3, moved: 12, margin: 40 }

type Kept = {
  matrices: Float32Array
  colors: Float32Array | null
  /** Each copy's place in the world, x then z. */
  places: Float32Array
  total: number
  matrixVersion: number
  colorVersion: number
  reach: number
}
type Seen = { matrixVersion: number; colorVersion: number; steady: number; kept: Kept | null; leave: boolean }

const place = new THREE.Vector3()

function capture(mesh: THREE.InstancedMesh): Kept {
  const total = mesh.count
  const matrices = (mesh.instanceMatrix.array as Float32Array).slice(0, total * 16)
  const colors = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array).slice(0, total * 3) : null
  const places = new Float32Array(total * 2)
  mesh.updateWorldMatrix(true, false)
  for (let i = 0; i < total; i++) {
    place.set(matrices[i * 16 + 12], matrices[i * 16 + 13], matrices[i * 16 + 14]).applyMatrix4(mesh.matrixWorld)
    places[i * 2] = place.x
    places[i * 2 + 1] = place.z
  }
  return { matrices, colors, places, total, matrixVersion: -1, colorVersion: -1, reach: -1 }
}

/** Puts the copies within `reach` of the rider at the front, and draws only those. */
function pack(mesh: THREE.InstancedMesh, kept: Kept, reach: number) {
  const matrices = mesh.instanceMatrix.array as Float32Array
  const colors = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null
  const limit = reach * reach
  let drawn = 0
  for (let i = 0; i < kept.total; i++) {
    const dx = kept.places[i * 2] - livePlayer.x
    const dz = kept.places[i * 2 + 1] - livePlayer.z
    if (dx * dx + dz * dz > limit) continue
    matrices.set(kept.matrices.subarray(i * 16, i * 16 + 16), drawn * 16)
    if (colors && kept.colors) colors.set(kept.colors.subarray(i * 3, i * 3 + 3), drawn * 3)
    drawn++
  }
  mesh.count = drawn
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  // Marking them changed moves their versions on by one: remembered, to tell our change from anyone else's.
  kept.matrixVersion = mesh.instanceMatrix.version
  kept.colorVersion = mesh.instanceColor?.version ?? -1
  kept.reach = reach
}

function restore(mesh: THREE.InstancedMesh, kept: Kept) {
  ;(mesh.instanceMatrix.array as Float32Array).set(kept.matrices)
  if (mesh.instanceColor && kept.colors) (mesh.instanceColor.array as Float32Array).set(kept.colors)
  mesh.count = kept.total
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

export function NearInstances() {
  const seen = useRef(new WeakMap<THREE.InstancedMesh, Seen>())
  const held = useRef<THREE.InstancedMesh[]>([])
  const at = useRef({ since: Infinity, x: Infinity, z: Infinity, reach: 0 })

  useFrame(({ scene }, delta) => {
    const state = at.current
    state.since += delta
    if (state.since >= WATCH.search) {
      state.since = 0
      const list: THREE.InstancedMesh[] = []
      scene.traverse((object) => {
        const mesh = object as THREE.InstancedMesh
        if (!mesh.isInstancedMesh || mesh.userData.keepAll) return
        let entry = seen.current.get(mesh)
        if (!entry) {
          entry = { matrixVersion: mesh.instanceMatrix.version, colorVersion: mesh.instanceColor?.version ?? -1, steady: 0, kept: null, leave: false }
          seen.current.set(mesh, entry)
          return
        }
        if (entry.leave) return
        const matrixVersion = mesh.instanceMatrix.version
        const colorVersion = mesh.instanceColor?.version ?? -1
        if (entry.kept) {
          // Changed by something other than this: back as it was, and never again.
          if (matrixVersion !== entry.kept.matrixVersion || colorVersion !== entry.kept.colorVersion) {
            restore(mesh, entry.kept)
            entry.kept = null
            entry.leave = true
          } else list.push(mesh)
          return
        }
        if (matrixVersion !== entry.matrixVersion || colorVersion !== entry.colorVersion) {
          entry.matrixVersion = matrixVersion
          entry.colorVersion = colorVersion
          entry.steady = 0
          return
        }
        const geometry = mesh.geometry
        const triangles = (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3
        if (mesh.count < WORTH.copies || mesh.count * triangles < WORTH.triangles) return
        if (++entry.steady < WATCH.steady) return
        entry.kept = capture(mesh)
        list.push(mesh)
      })
      held.current = list
      // A newly taken set is packed straight away.
      state.x = Infinity
    }

    const reach = liveView.drawDistance + WATCH.margin
    if (Math.hypot(livePlayer.x - state.x, livePlayer.z - state.z) < WATCH.moved && Math.abs(reach - state.reach) < 5) return
    state.x = livePlayer.x
    state.z = livePlayer.z
    state.reach = reach
    for (const mesh of held.current) {
      const entry = seen.current.get(mesh)
      if (entry?.kept) pack(mesh, entry.kept, reach)
    }
  })

  return null
}
