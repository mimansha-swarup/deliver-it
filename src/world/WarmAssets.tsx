import type { ReactNode } from 'react'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useCompressedTextures, withKTX2 } from './ktx2'
import { TRAFFIC_MODELS_URL, YAMAHA_MODEL_URL, FLEET_MODELS_URL, PEOPLE_MODELS_URL, TRIPO_MODELS_URL } from '../traffic/modelFiles'
import {
  CONCRETE_PHOTO,
  FOLIAGE_TEXTURES,
  GRASS_TEXTURES,
  GROUND_PHOTO,
  KIT_URL,
  PARK_PHOTO,
  PAVEMENT_TEXTURES,
  PLASTER_PHOTO,
  ROAD_TEXTURES,
  WALL_BUMP_MAPS,
  WALL_COLOR_PHOTOS,
} from './assetUrls'

/**
 * Waits for every texture and model the world's parts use before any part renders.
 *
 * A part that asks for a texture drei hasn't loaded yet "suspends": React throws
 * away what the part has rendered so far, memos included, and renders it again
 * once the texture is in. Most parts build their shapes before asking for their
 * textures, so every map square of buildings was built twice. The files are
 * downloaded from the title screen on, so waiting here costs only the moment it
 * takes to turn them into textures; then every part builds once.
 */
export function WarmAssets({ children }: { children: ReactNode }) {
  useTexture(WALL_COLOR_PHOTOS)
  useTexture(PLASTER_PHOTO)
  useTexture(CONCRETE_PHOTO)
  useCompressedTextures(WALL_BUMP_MAPS)
  useCompressedTextures(ROAD_TEXTURES)
  useCompressedTextures(PAVEMENT_TEXTURES)
  useCompressedTextures(GRASS_TEXTURES)
  useCompressedTextures(FOLIAGE_TEXTURES)
  useCompressedTextures([GROUND_PHOTO])
  useCompressedTextures([PARK_PHOTO])
  const gl = useThree((state) => state.gl)
  // city-kit.glb's textures are KTX2, so its loader needs the KTX2 reader; every later use of it gets this load.
  for (const { scene } of [useGLTF(TRAFFIC_MODELS_URL), useGLTF(YAMAHA_MODEL_URL), useGLTF(PEOPLE_MODELS_URL), useGLTF(FLEET_MODELS_URL), useGLTF(TRIPO_MODELS_URL), useGLTF(KIT_URL, true, true, withKTX2(gl))]) toFloats(scene)
  return children
}

const unpacked = new WeakSet<THREE.Object3D>()

/**
 * The models are compressed with Meshopt (scripts/compress_models.mjs), which stores normals
 * and colours as small whole numbers. The game merges model shapes with its own, which needs
 * every attribute as plain floats, so they're unpacked once, as the models arrive.
 */
function toFloats(scene: THREE.Object3D) {
  if (unpacked.has(scene)) return
  unpacked.add(scene)
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry as THREE.BufferGeometry
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const interleaved = attribute instanceof THREE.InterleavedBufferAttribute
      if (!interleaved && attribute.array instanceof Float32Array && !attribute.normalized) continue
      const floats = new Float32Array(attribute.count * attribute.itemSize)
      for (let i = 0; i < attribute.count; i++) {
        for (let k = 0; k < attribute.itemSize; k++) floats[i * attribute.itemSize + k] = attribute.getComponent(i, k)
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(floats, attribute.itemSize))
    }
  })
}
