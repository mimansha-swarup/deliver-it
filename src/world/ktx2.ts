import { useLayoutEffect } from 'react'
import { useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

/*
 * KTX2 textures: Basis-compressed pictures that stay compressed on the GPU, about an eighth
 * of the memory of a JPEG texture (made by scripts/compress_textures.mjs). The browser turns
 * them into whatever compressed format its GPU takes, with three.js's own transcoder, served
 * from public/basis (copied from three/examples/jsm/libs/basis, so the two always match).
 */

export const BASIS_PATH = '/basis/'

let shared: KTX2Loader | null = null

/** One KTX2 loader for the whole game: it keeps a pool of workers, which shouldn't be made twice. */
export function getKTX2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  shared ??= new KTX2Loader().setTranscoderPath(BASIS_PATH).detectSupport(gl)
  return shared
}

/**
 * Lets a glTF loader read models whose textures are KTX2 (city-kit.glb). For drei's `useGLTF`,
 * whose loader is three-stdlib's copy of GLTFLoader: it only needs to be handed the reader.
 */
export function withKTX2(gl: THREE.WebGLRenderer) {
  return (loader: { setKTX2Loader: (reader: never) => unknown }) => {
    loader.setKTX2Loader(getKTX2Loader(gl) as never)
  }
}

/**
 * Loads KTX2 textures, suspending until they're in, like drei's `useTexture`, and runs `prepare`
 * on them (wrapping, repeats, colour space) before they're first drawn. A list asked for in the same order elsewhere
 * gives the same textures, so WarmAssets.tsx can load them before any part asks.
 */
export function useCompressedTextures(urls: string[], prepare?: (textures: THREE.Texture[]) => void): THREE.Texture[] {
  const gl = useThree((state) => state.gl)
  const textures = useLoader(KTX2Loader, urls, (loader) => {
    loader.setTranscoderPath(BASIS_PATH).detectSupport(gl)
  }) as THREE.Texture[]
  // As drei's useTexture runs its onLoad: after rendering, before the first frame uploads them.
  useLayoutEffect(() => {
    prepare?.(textures)
  }, [textures, prepare])
  return textures
}
