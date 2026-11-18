import { useEffect, useMemo } from 'react'
import { useCompressedTextures } from './ktx2'
import { GROUND_PHOTO } from './assetUrls'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { createCoverMask } from './groundCover'
import { patchSoil } from './groundShaders'
import type { SurfaceMap } from './surfaceMap'
import { PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH } from './worldUtils'

/** The ground runs this far past the play area on every side, out to the horizon, in metres. */
const GROUND_MARGIN = 2000
const GROUND_WIDTH = PLAY_AREA_WIDTH + GROUND_MARGIN * 2
const GROUND_DEPTH = PLAY_AREA_DEPTH + GROUND_MARGIN * 2
const GROUND_CENTRE: [number, number, number] = [(PLAY_AREA.minX + PLAY_AREA.maxX) / 2, 0, (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2]
const PLAIN_COLOR = '#6e5444'
/**
 * The photo is a pale dusty soil. A colour multiplies a texture, so this turns it
 * into Bengaluru's red earth, as it looks on a dry verge: dusty and dulled, not
 * orange, so it sits between the grey paving and the green of the plants.
 */
const SOIL_TINT = '#a07a63'
/** How wide one repeat of the texture is, in metres. */
const GROUND_TILE = 16

function prepareGroundTextures([texture]: THREE.Texture[]) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(GROUND_WIDTH / GROUND_TILE, GROUND_DEPTH / GROUND_TILE)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
}

/**
 * The soil under everything. Inside `newSoilArea` (min x, min z, max x, max z),
 * where the new ground is being tried, it's the art direction's red earth
 * (groundShaders.ts), mostly under grass and weeds where the surface map has open
 * ground, parks and medians (groundCover.ts). The photo is used on every quality, for its grain.
 */
export function Ground({ newSoilArea, surface }: { newSoilArea: [number, number, number, number]; surface: SurfaceMap }) {
  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const [texture] = useCompressedTextures([GROUND_PHOTO], prepareGroundTextures)
  // Grass and weeds over the soil, where the surface map says (groundCover.ts): on every quality.
  const cover = useMemo(() => createCoverMask(surface), [surface])
  useEffect(() => () => cover.dispose(), [cover])

  const material = useMemo(() => {
    const soil = new THREE.MeshStandardMaterial({
      color: surfaces === 'plain' ? PLAIN_COLOR : SOIL_TINT,
      map: texture,
      roughness: 1,
    })
    const uniforms = patchSoil(soil)
    uniforms.uNewSoilArea.value.set(...newSoilArea)
    uniforms.uCover.value = cover
    uniforms.uCoverArea.value.set(PLAY_AREA.minX, PLAY_AREA.minZ, surface.width, surface.depth)
    return soil
  }, [surfaces, texture, newSoilArea, cover, surface])

  return (
    <mesh position={GROUND_CENTRE} rotation={[-Math.PI / 2, 0, 0]} material={material} receiveShadow>
      <planeGeometry args={[GROUND_WIDTH, GROUND_DEPTH]} />
    </mesh>
  )
}
