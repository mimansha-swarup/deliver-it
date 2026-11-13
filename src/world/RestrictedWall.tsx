import { useEffect, useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { pushBlock, squareFor, toBlockGeometries, type Square } from './blocks'
import { createLineGeometries, positionsFor, type ChunkedPositions } from './chunks'
import { ChunkedMesh } from './ChunkedMesh'
import type { PolygonFeature } from './mapData'
import { BOARD_FONT_CHECK, KANNADA_SAMPLE } from './signboards'
import { createPlasterMaterial, PLASTER_PHOTO, preparePlasterPhoto } from './plaster'
import { findWallEdges, WALL } from './restricted'
import type { GroundPoint } from './worldUtils'

const PILLAR = { every: 4, width: 0.45, depth: 0.6, height: 3.15 }
/** Barbed wire on posts above each pillar: the heights of its strands, in metres. */
const WIRE_POST = { width: 0.06, top: 3.8 }
const WIRE_HEIGHTS = [3.3, 3.47, 3.64, 3.8]
/** A "Restricted Area" board on the outside of the wall, about this often, in metres. */
const SIGN = { every: 140, width: 1.7, height: 1, bottom: 1.3 }

const PLASTER = new THREE.Color('#cdc5ae')
const BAND = new THREE.Color('#6f6b55')
const PILLAR_COLOR = new THREE.Color('#bdb59d')
const POST_COLOR = new THREE.Color('#3a3b3d')
const WIRE_COLOR = '#2e3033'
const SIGN_FONT = "'Baloo Tamma 2', 'Kannada Sangam MN', 'Noto Sans Kannada', sans-serif"

type WallParts = { blocks: THREE.BufferGeometry[]; wires: THREE.BufferGeometry[]; signs: THREE.BufferGeometry }

function createWallParts(zones: PolygonFeature[]): WallParts {
  const squares = new Map<number, Square>()
  const wires: ChunkedPositions = new Map()
  const signPositions: number[] = []
  const signUvs: number[] = []
  const signNormals: number[] = []
  // How far along the next edge the next board goes, carried on round corners so boards don't bunch up.
  let nextSign = SIGN.every / 2

  for (const { start, end, outX, outZ } of findWallEdges(zones)) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const alongX = (end[0] - start[0]) / length
    const alongZ = (end[1] - start[1]) / length
    const square = squareFor(squares, start[0], start[1])
    const block = (span: [number, number], out: [number, number], height: number, color: THREE.Color, ends = false, base = 0) =>
      pushBlock(square, start, alongX, alongZ, outX, outZ, span, out, height, color, ends, base)
    const half = WALL.thickness / 2

    // The wall, with a darker band along the bottom where rain splashes mud on it.
    block([0, length], [-half, half], WALL.height, PLASTER, false, WALL.band)
    block([0, length], [-half - 0.02, half + 0.02], WALL.band, BAND)

    // Pillars, each with a post on top holding the barbed wire.
    const posts: number[] = []
    for (let at = 0; at <= length; at += PILLAR.every) posts.push(at)
    if (length - posts[posts.length - 1] > 0.5) posts.push(length)
    for (const at of posts) {
      const from = Math.max(0, at - PILLAR.width / 2)
      const to = Math.min(length, at + PILLAR.width / 2)
      block([from, to], [-PILLAR.depth / 2, PILLAR.depth / 2], PILLAR.height, PILLAR_COLOR, true)
      block([at - WIRE_POST.width / 2, at + WIRE_POST.width / 2], [-WIRE_POST.width / 2, WIRE_POST.width / 2], WIRE_POST.top, POST_COLOR, true, PILLAR.height)
    }
    for (let index = 1; index < posts.length; index++) {
      const [from, to] = [posts[index - 1], posts[index]]
      const point = (along: number): GroundPoint => [start[0] + alongX * along, start[1] + alongZ * along]
      const line = positionsFor(wires, point(from))
      for (const height of WIRE_HEIGHTS) {
        // Each strand sags a little between posts.
        const [ax, az] = point(from)
        const [mx, mz] = point((from + to) / 2)
        const [bx, bz] = point(to)
        line.push(ax, height, az, mx, height - 0.04, mz, mx, height - 0.04, mz, bx, height, bz)
      }
    }

    // A board on the outside every so often.
    let signAt = nextSign
    for (; signAt < length - PILLAR.every; signAt += SIGN.every) {
      // Centred in the gap between two pillars, which stand out further than the wall.
      const at = Math.floor(signAt / PILLAR.every) * PILLAR.every + (PILLAR.every - SIGN.width) / 2
      const out = half + 0.012
      const corner = (along: number, y: number) => [
        start[0] + alongX * along + outX * out,
        y,
        start[1] + alongZ * along + outZ * out,
      ]
      // Seen from outside, the reader's right is up × out, which is (outZ, -outX).
      const rightIsAlong = outZ * alongX - outX * alongZ > 0
      const [left, right] = rightIsAlong ? [at, at + SIGN.width] : [at + SIGN.width, at]
      const top = SIGN.bottom + SIGN.height
      const corners = [corner(left, SIGN.bottom), corner(right, SIGN.bottom), corner(right, top), corner(left, top)]
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]
      for (const index of [0, 1, 2, 0, 2, 3]) {
        signPositions.push(...corners[index])
        signUvs.push(...uvs[index])
        signNormals.push(outX, 0, outZ)
      }
    }
    nextSign = Math.max(0, signAt - length)
  }

  const signs = new THREE.BufferGeometry()
  signs.setAttribute('position', new THREE.Float32BufferAttribute(signPositions, 3))
  signs.setAttribute('normal', new THREE.Float32BufferAttribute(signNormals, 3))
  signs.setAttribute('uv', new THREE.Float32BufferAttribute(signUvs, 2))
  return { blocks: toBlockGeometries(squares), wires: createLineGeometries(wires), signs }
}

/** A red and white board: "Restricted area, no entry", in Kannada and English. */
function paintSign(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  context.fillStyle = '#f4f1ea'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#b3201c'
  context.fillRect(0, 0, width, height * 0.36)
  context.strokeStyle = '#b3201c'
  context.lineWidth = 10
  context.strokeRect(5, 5, width - 10, height - 10)

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.font = `800 ${Math.round(height * 0.2)}px ${SIGN_FONT}`
  context.fillText('ನಿರ್ಬಂಧಿತ ಪ್ರದೇಶ', width / 2, height * 0.19, width - 40)
  context.fillStyle = '#b3201c'
  context.font = `800 ${Math.round(height * 0.17)}px ${SIGN_FONT}`
  context.fillText('RESTRICTED AREA', width / 2, height * 0.52, width - 40)
  context.fillStyle = '#1f2023'
  context.font = `700 ${Math.round(height * 0.13)}px ${SIGN_FONT}`
  context.fillText('NO ENTRY · NO PHOTOGRAPHY', width / 2, height * 0.77, width - 40)
}

const built = new WeakMap<PolygonFeature[], WallParts>()

/**
 * A high wall with barbed wire round military land, wherever it falls inside
 * the play area, with warning boards on the outside. It's made solid by
 * `addRestrictedWalls`, which the world calls before placing anything else.
 */
export function RestrictedWall({ zones }: { zones: PolygonFeature[] }) {
  const parts = useMemo(() => {
    let found = built.get(zones)
    if (!found) {
      found = createWallParts(zones)
      built.set(zones, found)
    }
    return found
  }, [zones])
  const photo = useTexture(PLASTER_PHOTO, preparePlasterPhoto)
  // A long, plain wall shows its plaster more than a house does, so the grain is stronger.
  const material = useMemo(() => createPlasterMaterial(photo, { tile: 3.5, strength: 2.6 }, { roughness: 0.95 }), [photo])
  useEffect(() => () => material.dispose(), [material])
  const wireMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: WIRE_COLOR }), [])

  const { signMaterial, canvas } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 300
    paintSign(canvas)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    return { signMaterial: new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }), canvas }
  }, [])

  // Paint again once the Kannada letters have arrived.
  useEffect(() => {
    let live = true
    document.fonts?.load(BOARD_FONT_CHECK, KANNADA_SAMPLE).then(
      () => {
        if (!live) return
        paintSign(canvas)
        if (signMaterial.map) signMaterial.map.needsUpdate = true
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [canvas, signMaterial])

  useEffect(
    () => () => {
      signMaterial.map?.dispose()
      signMaterial.dispose()
    },
    [signMaterial],
  )

  return (
    <>
      <ChunkedMesh geometries={parts.blocks} material={material} castShadow />
      <ChunkedMesh geometries={parts.wires} material={wireMaterial} lines maxDistance={220} />
      <mesh geometry={parts.signs} material={signMaterial} />
    </>
  )
}
