import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'

const GROUND_SIZE = 6000
const PLAIN_COLOR = '#97907a'
/** How wide one repeat of the texture is, in metres. */
const GROUND_TILE = 16

function prepareGroundTexture(texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE)
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={material} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
    </mesh>
  )
}
