/*
 * The textures and models the world's parts load, each list exactly as its part
 * asks for it. drei keeps a loaded texture or model under the list it was asked
 * with, so WarmAssets.tsx asks with these same lists, and the parts then find
 * them ready instead of suspending (see WarmAssets.tsx). Lists are kept in one order for the same reason.
 */

export { CONCRETE_PHOTO, PLASTER_PHOTO } from './plaster'

/** The wall photos: JPEG, as they're painted onto the facades' canvases (facadeTextures.ts). */
export const WALL_COLOR_PHOTOS = ['/textures/wall-color.jpg', '/textures/concrete-color.jpg', '/textures/brick-color.jpg']

// The rest are KTX2, loaded with `useCompressedTextures` (ktx2.ts).
export const WALL_BUMP_MAPS = ['/textures/wall-normal.ktx2', '/textures/concrete-normal.ktx2', '/textures/brick-normal.ktx2']
export const ROAD_TEXTURES = ['/textures/road-color.ktx2', '/textures/road-normal.ktx2']
export const PAVEMENT_TEXTURES = ['/textures/pavement-color.ktx2', '/textures/pavement-normal.ktx2']
export const GRASS_TEXTURES = ['/textures/grass-color.ktx2', '/textures/grass-alpha.ktx2']
export const FOLIAGE_TEXTURES = ['/textures/leaf-color.ktx2', '/textures/leaf-alpha.ktx2', '/textures/bark-color.ktx2']
export const GROUND_PHOTO = '/textures/ground-color.ktx2'
export const PARK_PHOTO = '/textures/park-color.ktx2'
export const KIT_URL = '/models/city-kit.glb'
