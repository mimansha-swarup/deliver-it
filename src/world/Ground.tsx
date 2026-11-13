import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH } from './worldUtils'

/** The ground runs this far past the play area on every side, out to the horizon, in metres. */
const GROUND_MARGIN = 2000
const GROUND_WIDTH = PLAY_AREA_WIDTH + GROUND_MARGIN * 2
const GROUND_DEPTH = PLAY_AREA_DEPTH + GROUND_MARGIN * 2
const GROUND_CENTRE: [number, number, number] = [(PLAY_AREA.minX + PLAY_AREA.maxX) / 2, 0, (PLAY_AREA.minZ + PLAY_AREA.maxZ) / 2]
const PLAIN_COLOR = '#97907a'
/** How wide one repeat of the texture is, in metres. */
const GROUND_TILE = 16

function prepareGroundTexture(texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(GROUND_WIDTH / GROUND_TILE, GROUND_DEPTH / GROUND_TILE)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
}

export function Ground() {
  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const texture = useTexture('/textures/ground-color.jpg', prepareGroundTexture)

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: surfaces === 'plain' ? PLAIN_COLOR : '#ffffff',
        map: surfaces === 'plain' ? null : texture,
        roughness: 1,
      }),
    [surfaces, texture],
  )

  return (
    <mesh position={GROUND_CENTRE} rotation={[-Math.PI / 2, 0, 0]} material={material} receiveShadow>
      <planeGeometry args={[GROUND_WIDTH, GROUND_DEPTH]} />
    </mesh>
  )
}
