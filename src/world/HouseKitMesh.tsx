import { useEffect, useMemo, useRef } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveView } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { CHUNK_SIZE } from './chunks'
import type { HouseKit } from './houseKit'
import { createPlasterMaterial, PLASTER_PHOTO, preparePlasterPhoto } from './plaster'
import { addWeathering } from './weathering'
import { createPosterAtlas } from './posters'
import { NEAR_BUDGET, setNearWaiting } from '../game/launch'

/** Chajjas are small, so past this they can't be told apart from the wall, in metres. */
const CHAJJA_DISTANCE = 180
/** Stains under balconies, sunshades and AC units are soft, so past this they aren't drawn, in metres. */
const STAIN_DISTANCE = 220
/** How weathered the kit's own walls look: compound walls, parapets, balconies. */
const KIT_WEATHER = 0.5
/** Balconies and roof rooms past this are a few pixels at most, so they aren't built, in metres. */
const KIT_REACH = 600
/** A square is freed once it's this much further than it needs to be, so riding back and forth doesn't rebuild it. */
const KEEP_EXTRA = CHUNK_SIZE * 1.5
/** Milliseconds of each frame that may go on building squares. */
const BUILD_BUDGET = 5
/**
 * The plaster photo is soft, so its light and shade is boosted a good deal to
 * match the house walls, whose paint is mixed with it more strongly.
 */
const KIT_PLASTER = { tile: 3, strength: 2.2 }

type BuiltSquare = { main: THREE.Mesh; chajjas: THREE.Mesh; stains: THREE.Mesh; posters: THREE.Mesh; fine: THREE.Mesh }

/**
 * Draws the HSR house kit: balconies, parapets, roof rooms, doors and compound
 * walls, and the many small chajjas up close on Medium and High.
 *
 * Only the map squares near the rider exist. Each frame, missing squares in
 * reach are built, nearest first, for a few milliseconds, and squares left far
 * behind are freed. Colours are stored on the shapes, so one material does every house.
 */
export function HouseKitMesh({ kit }: { kit: HouseKit }) {
  const { kitDetail, shadowSize, shadowRange, surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const photo = useTexture(PLASTER_PHOTO, preparePlasterPhoto)
  // Plaster grain on Medium and High. Low keeps flat paint, as its walls have no photo either.
  const material = useMemo(() => {
    const kitMaterial =
      surfaces === 'plain'
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
        : createPlasterMaterial(photo, KIT_PLASTER, { roughness: 0.9 })
    // Grime at the foot of compound walls, faded paint, damp: as on the houses (weathering.ts).
    addWeathering(kitMaterial, { weather: KIT_WEATHER })
    return kitMaterial
  }, [photo, surfaces])
  // Dark and see-through by corner, so the stains fade out and darken any paint they're on.
  const stainMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  )
  // Posters share one picture (posters.ts), drawn just off the wall.
  const posterMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: createPosterAtlas(),
        roughness: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  )
  const group = useRef<THREE.Group>(null)
  const built = useRef(new Map<number, BuiltSquare>())
  // Waiting until the first frame has built the squares round the rider (see `nearWaiting`).
  useEffect(() => {
    setNearWaiting('houseKit', true)
    return () => setNearWaiting('houseKit', false)
  }, [])

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
      parent.remove(square.main, square.chajjas, square.stains, square.posters, square.fine)
      square.posters.geometry.dispose()
      square.fine.geometry.dispose()
      square.main.geometry.dispose()
      square.chajjas.geometry.dispose()
      square.stains.geometry.dispose()
      squares.delete(key)
    }

    // Build what's missing, nearest first.
    const missing = kit.squares
      .filter(({ key, x, z }) => !squares.has(key) && distanceTo(x, z) < reach + CHUNK_SIZE)
      .sort((a, b) => distanceTo(a.x, a.z) - distanceTo(b.x, b.z))
    const started = performance.now()
    // Squares right round the rider: a big share of the frame behind the loading screen, a small one once riding.
    const urgentBudget = useGameStore.getState().started ? NEAR_BUDGET.riding : NEAR_BUDGET.loading
    let nearLeft = false
    for (const { key, x, z } of missing) {
      const urgent = distanceTo(x, z) < CHUNK_SIZE * 1.5
      if (performance.now() - started > (urgent ? urgentBudget : BUILD_BUDGET)) {
        nearLeft = missing.some((square) => !squares.has(square.key) && distanceTo(square.x, square.z) < CHUNK_SIZE * 1.5)
        break
      }
      const shapes = kit.buildSquare(key)
      const square: BuiltSquare = {
        main: new THREE.Mesh(shapes.main, material),
        chajjas: new THREE.Mesh(shapes.chajjas, material),
        stains: new THREE.Mesh(shapes.stains, stainMaterial),
        posters: new THREE.Mesh(shapes.posters, posterMaterial),
        fine: new THREE.Mesh(shapes.fine, material),
      }
      square.posters.receiveShadow = true
      square.fine.receiveShadow = true
      square.main.receiveShadow = true
      square.chajjas.receiveShadow = true
      square.stains.receiveShadow = true
      parent.add(square.main, square.chajjas, square.stains, square.posters, square.fine)
      squares.set(key, square)
    }

    setNearWaiting('houseKit', nearLeft)

    // Show what's in reach, as ChunkedMesh does for the rest of the world.
    for (const { main, chajjas, stains, posters, fine } of squares.values()) {
      main.material = material
      chajjas.material = material
      fine.material = material
      const sphere = main.geometry.boundingSphere
      const distance = sphere ? distanceTo(sphere.center.x, sphere.center.z) - sphere.radius : 0
      main.visible = distance < liveView.drawDistance
      // Only squares within the sun's shadow range cast: the rest fall outside its shadow map.
      main.castShadow = shadowSize > 0 && distance < shadowRange
      chajjas.visible = kitDetail >= 1 && distance < Math.min(liveView.drawDistance, CHAJJA_DISTANCE)
      // Small details fill in with the quality: none on Low, most on Medium, all on High.
      const detailed = distance < Math.min(liveView.drawDistance, CHAJJA_DISTANCE)
      stains.visible = kitDetail >= 1 && distance < Math.min(liveView.drawDistance, STAIN_DISTANCE)
      posters.visible = kitDetail >= 1 && detailed
      fine.visible = kitDetail >= 2 && detailed
    }
  })

  // Squares are freed only when the kit goes. A change of quality only swaps the material.
  useEffect(() => {
    const squares = built.current
    return () => {
      for (const { main, chajjas, stains, posters, fine } of squares.values()) {
        main.geometry.dispose()
        chajjas.geometry.dispose()
        stains.geometry.dispose()
        posters.geometry.dispose()
        fine.geometry.dispose()
      }
      squares.clear()
    }
  }, [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => stainMaterial.dispose(), [stainMaterial])
  useEffect(
    () => () => {
      posterMaterial.map?.dispose()
      posterMaterial.dispose()
    },
    [posterMaterial],
  )

  return <group ref={group} />
}
