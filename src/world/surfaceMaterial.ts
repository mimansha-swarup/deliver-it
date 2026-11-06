import * as THREE from 'three'
import type { SurfaceDetail } from '../game/qualitySettings'

/** Sets up a [colour, bumps] pair to repeat across the ground. */
export function prepareSurfaceTextures([color, bumps]: THREE.Texture[], tileSize: number) {
  color.colorSpace = THREE.SRGBColorSpace

  for (const texture of [color, bumps]) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(1 / tileSize, 1 / tileSize)
    // Keeps the surface sharp when seen at a shallow angle, as a road always is.
    texture.anisotropy = 8
  }
}

/** A material with as much of the [colour, bumps] pair as the quality level allows. */
export function createSurfaceMaterial(
  [color, bumps]: THREE.Texture[],
  detail: SurfaceDetail,
  settings: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    ...settings,
    map: detail === 'plain' ? null : color,
    normalMap: detail === 'bumps' ? bumps : null,
  })
}
