import * as THREE from 'three'
import { Surface, type SurfaceMap } from './surfaceMap'
import { PLAY_AREA } from './worldUtils'

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

/** The paving byte: plain paving, and where car parks' codes start (see createCoverMask). */
const PAVED = 64
const PARKING_FROM = 102

/** Whether a point is inside an outline, given as its xs and zs. */
function isInside(xs: number[], zs: number[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (zs[i] > z !== zs[j] > z && x < ((xs[j] - xs[i]) * (z - zs[i])) / (zs[j] - zs[i]) + xs[i]) inside = !inside
  }
  return inside
}

export function createCoverMask(surface: SurfaceMap): THREE.DataTexture {
  const { width, depth, cells } = surface
  // Cover by kind, looked up from a small table rather than an object for each of 11 million cells.
  const coverOf = new Uint8Array(256)
  for (const [kind, value] of Object.entries(COVER)) coverOf[Number(kind)] = value
  const cover = new Uint8Array(cells.length)
  for (let i = 0; i < cells.length; i++) cover[i] = coverOf[cells[i]]

  // Worn earth: from every walked cell that touches open ground, wear the open ground round it.
  // How much cover is left, out of 255: a byte a cell, as the map is large. The wear at each
  // offset within reach is worked out once.
  const wear = new Uint8Array(cells.length).fill(255)
  const reach = Math.ceil(WORN_REACH)
  const offsets: number[] = []
  const lefts: number[] = []
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const distance = Math.hypot(dx, dz)
      if (distance > WORN_REACH) continue
      offsets.push(dz * width + dx)
      lefts.push(Math.round(255 * (WORN_EDGE + (1 - WORN_EDGE) * (distance / WORN_REACH))))
    }
  }
  for (let row = reach; row < depth - reach; row++) {
    for (let column = reach; column < width - reach; column++) {
      const index = row * width + column
      const kind = cells[index]
      if (kind !== Surface.Footpath && kind !== Surface.Paved && kind !== Surface.Road) continue
      const touchesOpen =
        cells[index - 1] === Surface.Open || cells[index + 1] === Surface.Open || cells[index - width] === Surface.Open || cells[index + width] === Surface.Open
      if (!touchesOpen) continue
      for (let k = 0; k < offsets.length; k++) {
        const at = index + offsets[k]
        if (cells[at] === Surface.Open && lefts[k] < wear[at]) wear[at] = lefts[k]
      }
    }
  }
  for (let i = 0; i < cover.length; i++) if (wear[i] < 255) cover[i] = (cover[i] * wear[i] + 127) / 255

  // Under a flyover or the metro: no light and no rain reach it, so no grass, only bare earth.
  for (let i = 0; i < cover.length; i++) if (surface.overhead[i]) cover[i] = 0

  // Maidans: a cricket or football ground is worn to the red earth, with dry grass left at its
  // edges, and bare all round the middle where the game is. Courts are drawn over their own ground.
  for (const pitch of surface.pitches) {
    if (pitch.sport === 'basketball' || pitch.sport === 'net' || pitch.sport === 'kabaddi') continue
    const xs = pitch.outline.map(([x]) => x - PLAY_AREA.minX)
    const zs = pitch.outline.map(([, z]) => z - PLAY_AREA.minZ)
    const cos = Math.cos(pitch.angle)
    const sin = Math.sin(pitch.angle)
    for (let row = Math.max(0, Math.floor(Math.min(...zs))); row <= Math.min(depth - 1, Math.ceil(Math.max(...zs))); row++) {
      for (let column = Math.max(0, Math.floor(Math.min(...xs))); column <= Math.min(width - 1, Math.ceil(Math.max(...xs))); column++) {
        const index = row * width + column
        if (cells[index] !== Surface.Park || !isInside(xs, zs, column + 0.5, row + 0.5)) continue
        const dx = column + 0.5 + PLAY_AREA.minX - pitch.x
        const dz = row + 0.5 + PLAY_AREA.minZ - pitch.z
        const along = Math.abs(dx * cos + dz * sin) / Math.max(pitch.halfLength, 1)
        const across = Math.abs(-dx * sin + dz * cos) / Math.max(pitch.halfWidth, 1)
        const fromMiddle = Math.min(1, Math.hypot(along, across))
        cover[index] = Math.round(Math.min(cover[index], 20 + 130 * fromMiddle * fromMiddle))
      }
    }
  }

  // Two bytes a cell: the cover, then the paving (the soil shader draws concrete there). 0 is
  // none, PAVED plain paving, and PARKING_FROM up to 255 a car park, its bays turned by that much of half a turn.
  const both = new Uint8Array(cells.length * 2)
  for (let i = 0; i < cells.length; i++) {
    both[i * 2] = cover[i]
    if (cells[i] === Surface.Paved) both[i * 2 + 1] = PAVED
  }
  for (const { outline, angle } of surface.parkingAreas) {
    // The shader turns the ground by this angle to lay the bays along the car park's longest side.
    const turn = (((angle % Math.PI) + Math.PI) % Math.PI) / Math.PI
    const code = Math.round(PARKING_FROM + turn * (255 - PARKING_FROM))
    const xs = outline.map(([x]) => x - PLAY_AREA.minX)
    const zs = outline.map(([, z]) => z - PLAY_AREA.minZ)
    for (let row = Math.max(0, Math.floor(Math.min(...zs))); row <= Math.min(depth - 1, Math.ceil(Math.max(...zs))); row++) {
      for (let column = Math.max(0, Math.floor(Math.min(...xs))); column <= Math.min(width - 1, Math.ceil(Math.max(...xs))); column++) {
        const index = row * width + column
        if (cells[index] === Surface.Paved && isInside(xs, zs, column + 0.5, row + 0.5)) both[index * 2 + 1] = code
      }
    }
  }

  const texture = new THREE.DataTexture(both, width, depth, THREE.RGFormat, THREE.UnsignedByteType)
  texture.unpackAlignment = 2
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}
