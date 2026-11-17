import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { PANEL, type FenceKind, type FenceRun } from './fencing'
import { groundLift } from './groundLift'
import { colored } from './simpleShapes'

/*
 * Draws the fences planned in fencing.ts, merged into one shape per map square
 * for the solid parts, and one each for the see-through parts: railing bars and
 * chain-link mesh. Those are flat strips with the pattern cut out of them by an
 * alpha map, two triangles a side per panel, rather than hundreds of thin boxes.
 */

const RAILING = { height: 1, rails: [0.22, 0.6, 0.97], rail: 0.05, post: 0.06, colors: ['#e0b52a', '#1d1e21'], postColor: '#2a2b2e' }

const PARK = {
  plinth: 0.45,
  plinthWidth: 0.26,
  plinthColor: '#c9c0ad',
  plinthTop: '#b3ab98',
  top: 1.6,
  rails: [0.55, 1.55],
  rail: 0.045,
  post: 0.09,
  green: '#2d5a3a',
}

const STEEL = { top: 1.2, rails: [0.15, 1.15], rail: 0.045, post: 0.06, color: '#8f9398' }

/** Chain-link on concrete posts, with three strands of barbed wire along the top. */
const CHAIN = { post: 0.12, postTop: 2, postColor: '#aaa69c', mesh: [0.08, 1.65], meshColor: '#9ba1a4', strands: [1.75, 1.85, 1.95], wire: '#55585b' }

/** Plastered boundary walls, with a coping on top and pillars at each panel's end. */
const WALL = { height: 1.8, width: 0.23, coping: 0.06, pillar: 0.34, colors: ['#d9cdb4', '#c8c2b6', '#e2d8c2', '#bdb6a8', '#d6c6a8'] }

const RETAINING = { height: 1, width: 0.4, color: '#8a8178', cap: '#9c948a' }

/** A W-beam crash barrier on posts. */
const GUARD = { post: 0.1, postTop: 0.75, beam: [0.42, 0.74], beamThickness: 0.06, color: '#b5b9bc', postColor: '#7c8084' }

/** A concrete road divider, its New Jersey profile in two steps, painted in yellow and black blocks. */
const JERSEY = { base: [0.6, 0.3], top: [0.24, 0.5], colors: ['#d8b22e', '#26272a'] }

/** A temple compound's wall: red-ochre and white stripes, a coping on top. */
const TEMPLE_WALL = { height: 1.5, width: 0.22, colors: ['#a8432b', '#f1ece0'], coping: '#d9cfbd' }

/** See-through strips: one bar every `spacing` metres, `share` of it solid; the mesh is a diamond grid that size. */
const BARS = { spacing: 0.14, share: 0.24 }
const MESH = { cell: 0.12 }

type Strip = 'bars' | 'mesh'

type Built = Record<'solid' | Strip, Map<number, THREE.BufferGeometry[]>>

/** A box `length` long along `direction`, its middle at `centre`, standing from `bottom` to `top`. */
function beam(
  [x, z]: [number, number],
  [dx, dz]: [number, number],
  length: number,
  width: number,
  bottom: number,
  top: number,
  color: string,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(length, top - bottom, width).toNonIndexed()
  geometry.rotateY(Math.atan2(-dz, dx))
  geometry.translate(x, (top + bottom) / 2, z)
  return colored(geometry, color)
}

/** A flat strip from `from` to `to`, `uv` in metres along and up so the cut-out pattern keeps its size. */
function strip(from: [number, number], to: [number, number], bottom: number, top: number, startAlong: number, color: string): THREE.BufferGeometry {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const u0 = startAlong
  const u1 = startAlong + length
  const positions = [
    from[0], bottom, from[1], to[0], bottom, to[1], to[0], top, to[1],
    from[0], bottom, from[1], to[0], top, to[1], from[0], top, from[1],
  ]
  const uvs = [u0, bottom, u1, bottom, u1, top, u0, bottom, u1, top, u0, top]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  const { r, g, b } = new THREE.Color(color)
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 6 }, () => [r, g, b]).flat(), 3))
  return geometry
}

function add(map: Map<number, THREE.BufferGeometry[]>, key: number, part: THREE.BufferGeometry) {
  const list = map.get(key)
  if (list) list.push(part)
  else map.set(key, [part])
}

type PanelPlace = {
  /** The panel's start, middle and end on the ground, and its direction along. */
  from: [number, number]
  middle: [number, number]
  to: [number, number]
  direction: [number, number]
  length: number
  /** How far along the run the panel starts, and which panel it is. */
  along: number
  index: number
  /** The ground height under the panel. */
  lift: number
}

/** Draws one panel of a fence, between two posts. The posts are drawn by `drawPost`. */
function drawPanel(kind: FenceKind, place: PanelPlace, variation: number, built: Built, key: number) {
  const { from, middle, to, direction, length, along, index, lift } = place
  const solid = (geometry: THREE.BufferGeometry) => add(built.solid, key, geometry)
  switch (kind) {
    case 'railing': {
      // Panels alternate yellow and black, as the kerbs do.
      const color = RAILING.colors[index % 2]
      for (const height of RAILING.rails) solid(beam(middle, direction, length, RAILING.rail, lift + height - RAILING.rail / 2, lift + height + RAILING.rail / 2, color))
      break
    }
    case 'parkRailing':
      solid(beam(middle, direction, length, PARK.plinthWidth, lift - 0.05, lift + PARK.plinth - 0.03, PARK.plinthColor))
      solid(beam(middle, direction, length, PARK.plinthWidth + 0.04, lift + PARK.plinth - 0.03, lift + PARK.plinth, PARK.plinthTop))
      for (const height of PARK.rails) solid(beam(middle, direction, length, PARK.rail, lift + height - PARK.rail / 2, lift + height + PARK.rail / 2, PARK.green))
      add(built.bars, key, strip(from, to, lift + PARK.plinth, lift + PARK.rails[1], along, PARK.green))
      break
    case 'steelRailing':
      for (const height of STEEL.rails) solid(beam(middle, direction, length, STEEL.rail, lift + height - STEEL.rail / 2, lift + height + STEEL.rail / 2, STEEL.color))
      add(built.bars, key, strip(from, to, lift + STEEL.rails[0], lift + STEEL.rails[1], along, STEEL.color))
      break
    case 'chainLink':
      add(built.mesh, key, strip(from, to, lift + CHAIN.mesh[0], lift + CHAIN.mesh[1], along, CHAIN.meshColor))
      for (const height of CHAIN.strands) solid(beam(middle, direction, length, 0.012, lift + height - 0.006, lift + height + 0.006, CHAIN.wire))
      break
    case 'wall': {
      const color = WALL.colors[Math.floor(variation * WALL.colors.length)]
      solid(beam(middle, direction, length, WALL.width, lift - 0.05, lift + WALL.height, color))
      solid(beam(middle, direction, length, WALL.width + 0.06, lift + WALL.height, lift + WALL.height + WALL.coping, '#a9a294'))
      break
    }
    case 'retaining':
      solid(beam(middle, direction, length, RETAINING.width, lift - 0.05, lift + RETAINING.height, RETAINING.color))
      solid(beam(middle, direction, length, RETAINING.width + 0.04, lift + RETAINING.height, lift + RETAINING.height + 0.08, RETAINING.cap))
      break
    case 'guardRail':
      solid(beam(middle, direction, length, GUARD.beamThickness, lift + GUARD.beam[0], lift + GUARD.beam[1], GUARD.color))
      break
    case 'templeWall':
      solid(beam(middle, direction, length, TEMPLE_WALL.width, lift - 0.05, lift + TEMPLE_WALL.height, TEMPLE_WALL.colors[index % 2]))
      solid(beam(middle, direction, length, TEMPLE_WALL.width + 0.06, lift + TEMPLE_WALL.height, lift + TEMPLE_WALL.height + 0.07, TEMPLE_WALL.coping))
      break
    case 'jersey': {
      const color = JERSEY.colors[index % 2]
      solid(beam(middle, direction, length, JERSEY.base[0], lift - 0.02, lift + JERSEY.base[1], color))
      solid(beam(middle, direction, length, JERSEY.top[0], lift + JERSEY.base[1], lift + JERSEY.base[1] + JERSEY.top[1], color))
      break
    }
  }
}

function drawPost(kind: FenceKind, at: [number, number], direction: [number, number], lift: number, built: Built, key: number) {
  const solid = (geometry: THREE.BufferGeometry) => add(built.solid, key, geometry)
  switch (kind) {
    case 'railing':
      solid(beam(at, direction, RAILING.post, RAILING.post, lift, lift + RAILING.height + 0.03, RAILING.postColor))
      break
    case 'parkRailing':
      solid(beam(at, direction, PARK.post, PARK.post, lift + PARK.plinth, lift + PARK.top, PARK.green))
      break
    case 'steelRailing':
      solid(beam(at, direction, STEEL.post, STEEL.post, lift, lift + STEEL.top, STEEL.color))
      break
    case 'chainLink':
      solid(beam(at, direction, CHAIN.post, CHAIN.post, lift - 0.05, lift + CHAIN.postTop, CHAIN.postColor))
      break
    case 'wall':
      solid(beam(at, direction, WALL.pillar, WALL.pillar, lift - 0.05, lift + WALL.height + 0.12, '#b8b0a0'))
      break
    case 'guardRail':
      solid(beam(at, direction, GUARD.post, GUARD.post, lift - 0.05, lift + GUARD.postTop, GUARD.postColor))
      break
    case 'retaining':
    case 'jersey':
    case 'templeWall':
      break
  }
}

function buildRun(run: FenceRun, built: Built) {
  const [fromX, fromZ] = run.from
  const [toX, toZ] = run.to
  const length = Math.hypot(toX - fromX, toZ - fromZ)
  if (length === 0) return
  const direction: [number, number] = [(toX - fromX) / length, (toZ - fromZ) / length]
  const key = chunkKey(fromX, fromZ)
  const count = Math.max(1, Math.round(length / PANEL[run.kind]))
  const step = length / count
  const at = (along: number): [number, number] => [fromX + direction[0] * along, fromZ + direction[1] * along]

  for (let index = 0; index <= count; index++) {
    const post = at(index * step)
    drawPost(run.kind, post, direction, groundLift.at(...post), built, key)
    if (index === count) break
    const middle = at((index + 0.5) * step)
    drawPanel(
      run.kind,
      { from: post, middle, to: at((index + 1) * step), direction, length: step, along: index * step, index, lift: groundLift.at(...middle) },
      run.variation,
      built,
      key,
    )
  }
}

function mergeChunks(map: Map<number, THREE.BufferGeometry[]>): THREE.BufferGeometry[] {
  return [...map.values()].map((parts) => {
    const merged = mergeGeometries(parts)
    parts.forEach((part) => part.dispose())
    if (!merged) throw new Error('Could not merge fences')
    merged.computeBoundingSphere()
    return merged
  })
}

/** A cut-out pattern. An alpha map is read from its green channel, so the pattern goes in RGB. */
function patternTexture(size: number, isSolid: (u: number, v: number) => boolean, repeat: [number, number]): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = isSolid((x + 0.5) / size, (y + 0.5) / size) ? 255 : 0
      data.set([value, value, value, 255], (y * size + x) * 4)
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function cutOutMaterial(alphaMap: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.2, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide })
}

export function Fences({ runs }: { runs: FenceRun[] }) {
  const { propDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const { solid, bars, mesh } = useMemo(() => {
    const built: Built = { solid: new Map(), bars: new Map(), mesh: new Map() }
    for (const run of runs) buildRun(run, built)
    return { solid: mergeChunks(built.solid), bars: mergeChunks(built.bars), mesh: mergeChunks(built.mesh) }
  }, [runs])

  const solidMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 }), [])
  // Vertical bars: solid for the first part of each repeat across, all the way up.
  const barMaterial = useMemo(() => cutOutMaterial(patternTexture(32, (u) => u < BARS.share, [1 / BARS.spacing, 1])), [])
  // Chain-link: wires running both ways on the diagonal, which makes the diamonds.
  const meshMaterial = useMemo(
    () =>
      cutOutMaterial(
        patternTexture(32, (u, v) => {
          const a = Math.abs(((u + v) % 1) - 0.5)
          const b = Math.abs(((u - v + 1) % 1) - 0.5)
          return a > 0.43 || b > 0.43
        }, [1 / MESH.cell, 1 / MESH.cell]),
      ),
    [],
  )

  return (
    <>
      <ChunkedMesh geometries={solid} material={solidMaterial} castShadow maxDistance={propDistance} />
      <ChunkedMesh geometries={bars} material={barMaterial} castShadow maxDistance={propDistance} />
      <ChunkedMesh geometries={mesh} material={meshMaterial} maxDistance={propDistance * 0.6} />
    </>
  )
}
