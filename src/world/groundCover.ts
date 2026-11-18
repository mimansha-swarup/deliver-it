import * as THREE from 'three'
import { Surface, type SurfaceMap } from './surfaceMap'

/*
 * How much of the red earth is covered by grass, weeds and low plants, a metre to a cell, from
 * the surface map: the soil shader (groundShaders.ts) reads it and lays grass over the soil in
 * patches, as much as it says. Parks are lawn, medians nearly so, open ground mostly covered,
 * empty plots and building sites only a few weeds. Where people walk, along the edge of every
 * footpath, forecourt and road, the ground is worn back to bare earth.
 */

/** Out of 255, by kind of ground. */
const COVER: Partial<Record<Surface, number>> = {
  [Surface.Park]: 255,
  [Surface.Median]: 235,
  [Surface.Open]: 205,
  [Surface.Plot]: 45,
}

/** Within this many metres of where people walk, open ground is worn: most at the edge, none past it. */
const WORN_REACH = 3
/** How much cover is left right at the edge. */
const WORN_EDGE = 0.2

const isWalked = (kind: number) => kind === Surface.Footpath || kind === Surface.Paved || kind === Surface.Road

export function createCoverMask(surface: SurfaceMap): THREE.DataTexture {
  const { width, depth, cells } = surface
  const cover = new Uint8Array(cells.length)
  for (let i = 0; i < cells.length; i++) cover[i] = COVER[cells[i] as Surface] ?? 0

  // Worn earth: from every walked cell that touches open ground, wear the open ground round it.
  // How much cover is left, out of 255: a byte a cell, as the map is large.
  const wear = new Uint8Array(cells.length).fill(255)
  const reach = Math.ceil(WORN_REACH)
  for (let row = 1; row < depth - 1; row++) {
    for (let column = 1; column < width - 1; column++) {
      const index = row * width + column
      if (!isWalked(cells[index])) continue
      const touchesOpen =
        cells[index - 1] === Surface.Open || cells[index + 1] === Surface.Open || cells[index - width] === Surface.Open || cells[index + width] === Surface.Open
      if (!touchesOpen) continue
      for (let dz = -reach; dz <= reach; dz++) {
        const r = row + dz
        if (r < 0 || r >= depth) continue
        for (let dx = -reach; dx <= reach; dx++) {
          const c = column + dx
          if (c < 0 || c >= width) continue
          const at = r * width + c
          if (cells[at] !== Surface.Open) continue
          const distance = Math.hypot(dx, dz)
          if (distance > WORN_REACH) continue
          const left = Math.round(255 * (WORN_EDGE + (1 - WORN_EDGE) * (distance / WORN_REACH)))
          if (left < wear[at]) wear[at] = left
        }
      }
    }
  }
  for (let i = 0; i < cover.length; i++) if (wear[i] < 255) cover[i] = Math.round((cover[i] * wear[i]) / 255)

  const texture = new THREE.DataTexture(cover, width, depth, THREE.RedFormat, THREE.UnsignedByteType)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
