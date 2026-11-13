import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveView } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { CHUNK_SIZE } from './chunks'
import type { HouseKit } from './houseKit'

/** Chajjas are small, so past this they can't be told apart from the wall, in metres. */
const CHAJJA_DISTANCE = 180
/** Balconies and roof rooms past this are a few pixels at most, so they aren't built, in metres. */
const KIT_REACH = 600
/** A square is freed once it's this much further than it needs to be, so riding back and forth doesn't rebuild it. */
const KEEP_EXTRA = CHUNK_SIZE * 1.5
/** Milliseconds of each frame that may go on building squares. */
const BUILD_BUDGET = 5
/** While the squares right around the rider are missing, a frame may spend this long. */
const URGENT_BUDGET = 40

type BuiltSquare = { main: THREE.Mesh; chajjas: THREE.Mesh }

/**
 * Draws the HSR house kit: balconies, parapets, roof rooms, doors and compound
 * walls, and the many small chajjas up close on Medium and High.
 *
 * Only the map squares near the rider exist. Each frame, missing squares in
 * reach are built, nearest first, for a few milliseconds, and squares left far
 * behind are freed. Colours are stored on the shapes, so one material does every house.
 */
export function HouseKitMesh({ kit }: { kit: HouseKit }) {
  const { kitDetail, shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), [])
  const group = useRef<THREE.Group>(null)
  const built = useRef(new Map<number, BuiltSquare>())

  useFrame(() => {
    const parent = group.current
    if (!parent) return
    const squares = built.current
    const reach = Math.min(liveView.drawDistance, KIT_REACH)
    const distanceTo = (x: number, z: number) => Math.hypot(x - livePlayer.x, z - livePlayer.z)

    // Free what's been left well behind.
    for (const [key, square] of squares) {
      const sphere = square.main.geometry.boundingSphere
      if (!sphere || distanceTo(sphere.center.x, sphere.center.z) - sphere.radius < reach + KEEP_EXTRA) continue
      parent.remove(square.main, square.chajjas)
      square.main.geometry.dispose()
      square.chajjas.geometry.dispose()
      squares.delete(key)
    }

    // Build what's missing, nearest first.
    const missing = kit.squares
      .filter(({ key, x, z }) => !squares.has(key) && distanceTo(x, z) < reach + CHUNK_SIZE)
      .sort((a, b) => distanceTo(a.x, a.z) - distanceTo(b.x, b.z))
    const started = performance.now()
    for (const { key, x, z } of missing) {
      const urgent = distanceTo(x, z) < CHUNK_SIZE * 1.5
      if (performance.now() - started > (urgent ? URGENT_BUDGET : BUILD_BUDGET)) break
      const shapes = kit.buildSquare(key)
      const square: BuiltSquare = {
        main: new THREE.Mesh(shapes.main, material),
        chajjas: new THREE.Mesh(shapes.chajjas, material),
      }
      square.main.receiveShadow = true
      square.chajjas.receiveShadow = true
      parent.add(square.main, square.chajjas)
      squares.set(key, square)
    }

    // Show what's in reach, as ChunkedMesh does for the rest of the world.
    for (const { main, chajjas } of squares.values()) {
      const sphere = main.geometry.boundingSphere
      const distance = sphere ? distanceTo(sphere.center.x, sphere.center.z) - sphere.radius : 0
      main.visible = distance < liveView.drawDistance
      main.castShadow = shadowSize > 0
      chajjas.visible = kitDetail >= 1 && distance < Math.min(liveView.drawDistance, CHAJJA_DISTANCE)
    }
  })

  useEffect(() => {
    const squares = built.current
    return () => {
      for (const { main, chajjas } of squares.values()) {
        main.geometry.dispose()
        chajjas.geometry.dispose()
      }
      squares.clear()
      material.dispose()
    }
  }, [material])

  return <group ref={group} />
}
