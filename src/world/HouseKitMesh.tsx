import { useMemo } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { ChunkedMesh } from './ChunkedMesh'
import type { HouseKit } from './houseKit'

/** Chajjas are small, so past this they can't be told apart from the wall, in metres. */
const CHAJJA_DISTANCE = 180

/**
 * Draws the HSR house kit: balconies, parapets, roof rooms, doors and compound
 * walls everywhere, and the many small chajjas up close on Medium and High.
 * Colours are stored on the shapes, so one material does every house.
 */
export function HouseKitMesh({ kit }: { kit: HouseKit }) {
  const { kitDetail, shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), [])
  const chajjaMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), [])

  return (
    <>
      <ChunkedMesh geometries={kit.main} material={material} castShadow={shadowSize > 0} />
      {kitDetail >= 1 && (
        <ChunkedMesh geometries={kit.chajjas} material={chajjaMaterial} maxDistance={CHAJJA_DISTANCE} />
      )}
    </>
  )
}
