import { useEffect, useId, useRef } from 'react'
import { NEAR_BUDGET, setNearWaiting } from '../game/launch'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { useGameStore } from '../game/gameStore'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { livePlayer, liveView } from '../game/livePlayer'
import { CHUNK_SIZE, chunkCentre } from './chunks'
import { RECHECK_DISTANCE, RECHECK_FRAMES } from './ChunkedMesh'

/*
 * Builds a part of the world one map square at a time, near the rider first, a
 * few milliseconds per frame, the way HouseKitMesh builds the house kit.
 *
 * Building every square of HSR before the ride could start kept the loading
 * screen up for seconds per part. Now a part mounts at once, the squares right
 * round the rider are built in the first frames (the loading screen is still
 * fading out over them), and the rest come in the background as the rider goes,
 * nearest first. Squares left far behind are freed, so riding across the whole
 * map never holds all of it at once.
 */

/** A square is freed once it's this much further than it needs to be, so riding back and forth doesn't rebuild it. */
const KEEP_EXTRA = CHUNK_SIZE * 1.5
/** Milliseconds of each frame that may go on building squares, shared by every streamed part. */
const BUILD_BUDGET = 4
/** Squares this close to the rider are urgent: see NEAR_BUDGET in launch.ts. */
const URGENT_REACH = CHUNK_SIZE * 1.5

/** One layer of a streamed part: its material, and how far it's drawn. */
export type StreamLayer = {
  material: THREE.Material
  castShadow?: boolean
  receiveShadow?: boolean
  /** Drawn only this close, in metres. The draw distance always applies too. */
  maxDistance?: number
  renderOrder?: number
}

/** Built squares, and the frame budget shared by every streamed part (one frame's clock). */
const frameClock = { frame: -1, started: 0 }

/**
 * Draws a part built square by square. `build(key)` makes a square's shapes, one per layer
 * (null for a layer with nothing in that square). `keys` lists the squares that have anything.
 * A new `build` rebuilds every square, as when a quality setting changes the shapes.
 */
export function StreamedChunks({ keys, build, layers, reach = Infinity }: { keys: number[]; build: (key: number) => (THREE.BufferGeometry | null)[]; layers: StreamLayer[]; reach?: number }) {
  const group = useRef<THREE.Group>(null)
  const built = useRef(new Map<number, (THREE.Mesh | null)[]>())
  const squares = useRef(keys.map((key) => ({ key, ...chunkCentre(key) })))
  const last = useRef({ x: Infinity, z: Infinity, frames: 0, pending: true })
  // Each streamed part tells the loading screen whether it's still building round the rider.
  const id = useId()
  useEffect(() => {
    setNearWaiting(id, true)
    return () => setNearWaiting(id, false)
  }, [id])

  // New squares or a new way of building them: start again.
  useEffect(() => {
    squares.current = keys.map((key) => ({ key, ...chunkCentre(key) }))
    last.current.pending = true
    const parent = group.current
    const all = built.current
    return () => {
      for (const meshes of all.values()) {
        for (const mesh of meshes) {
          if (!mesh) continue
          parent?.remove(mesh)
          mesh.geometry.dispose()
        }
      }
      all.clear()
    }
  }, [keys, build])

  useFrame(({ clock }) => {
    const parent = group.current
    if (!parent) return
    // Nothing changes until the rider moves, unless squares are still waiting to be built.
    const seen = last.current
    if (!seen.pending && Math.hypot(livePlayer.x - seen.x, livePlayer.z - seen.z) < RECHECK_DISTANCE && ++seen.frames < RECHECK_FRAMES) return
    seen.x = livePlayer.x
    seen.z = livePlayer.z
    seen.frames = 0
    const all = built.current
    const far = Math.min(liveView.drawDistance, reach)
    const distanceTo = (x: number, z: number) => Math.hypot(x - livePlayer.x, z - livePlayer.z)

    // Free what's been left well behind.
    for (const [key, meshes] of all) {
      const { x, z } = chunkCentre(key)
      if (distanceTo(x, z) < far + CHUNK_SIZE + KEEP_EXTRA) continue
      for (const mesh of meshes) {
        if (!mesh) continue
        parent.remove(mesh)
        mesh.geometry.dispose()
      }
      all.delete(key)
    }

    // Build what's missing, nearest first, within this frame's share of time.
    const now = performance.now()
    if (frameClock.frame !== clock.elapsedTime) {
      frameClock.frame = clock.elapsedTime
      frameClock.started = now
    }
    let missing: { key: number; x: number; z: number; distance: number }[] | null = null
    for (const square of squares.current) {
      if (all.has(square.key)) continue
      const distance = distanceTo(square.x, square.z)
      if (distance > far + CHUNK_SIZE) continue
      ;(missing ??= []).push({ ...square, distance })
    }
    seen.pending = false
    const urgentBudget = useGameStore.getState().started ? NEAR_BUDGET.riding : NEAR_BUDGET.loading
    let nearLeft = false
    if (missing) {
      missing.sort((a, b) => a.distance - b.distance)
      for (const { key, distance } of missing) {
        const budget = distance < URGENT_REACH ? urgentBudget : BUILD_BUDGET
        if (performance.now() - frameClock.started > budget) {
          // Out of time this frame: carry on next frame.
          seen.pending = true
          nearLeft = distance < URGENT_REACH
          break
        }
        const meshes = build(key).map((geometry, index) => {
          if (!geometry) return null
          const layer = layers[index]
          const mesh = new THREE.Mesh(geometry, layer.material)
          mesh.castShadow = layer.castShadow ?? false
          mesh.receiveShadow = layer.receiveShadow ?? true
          mesh.renderOrder = layer.renderOrder ?? 0
          if (!geometry.boundingSphere) geometry.computeBoundingSphere()
          parent.add(mesh)
          return mesh
        })
        all.set(key, meshes)
      }
    }

    setNearWaiting(id, nearLeft)

    // Show what's in reach, with each layer's current material. Only squares within the sun's
    // shadow range cast shadows: the rest are outside its shadow map, but would still be drawn into it.
    const shadowRange = QUALITY_PRESETS[useGameStore.getState().quality].shadowRange
    for (const meshes of all.values()) {
      meshes.forEach((mesh, index) => {
        if (!mesh) return
        const layer = layers[index]
        mesh.material = layer.material
        const sphere = mesh.geometry.boundingSphere
        const distance = sphere ? distanceTo(sphere.center.x, sphere.center.z) - sphere.radius : 0
        mesh.visible = distance < Math.min(liveView.drawDistance, layer.maxDistance ?? Infinity)
        mesh.castShadow = (layer.castShadow ?? false) && distance < shadowRange
      })
    }
  })

  return <group ref={group} />
}
