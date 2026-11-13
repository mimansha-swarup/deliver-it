import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import type { ShopFront } from './shopFrontPlacement'
import { drawInterior } from './shopInteriors'
import {
  awningColor,
  BOARD_FONT_CHECK,
  drawBoard,
  KANNADA_SAMPLE,
  PHOTO_BOARDS,
  SHOP_TYPES,
  type ShopType,
} from './signboards'

/**
 * Every shop front: an open doorway with the shop inside, a signboard above
 * it, a striped awning, and on some a chalk menu board on the pavement.
 *
 * The boards and the insides are each drawn once into one big image (an atlas),
 * and every shop's quads point at their part of it, so a whole map square of
 * shops is one draw call per image.
 */

const AWNING_HEIGHT = 2.9
const STRIPE_WIDTH = 0.45

const INTERIOR_TOP = 2.86
const SIGN_BOTTOM = 3.0
const SIGN_TOP = 3.86
const WALL_GAP = 0.05
/** The board stands this far off the wall, on brackets. */
const SIGN_DEPTH = 0.16
const MENU = { width: 0.62, height: 0.95, lean: 0.2 }

const SIGN_GLOW = 0.85
const INTERIOR_GLOW = 0.6

// ---- The board atlas: boards in two columns, then a strip of chalk menu boards ----

const BOARD_WIDTH = 1024
const BOARD_HEIGHT = 224
const PHOTO_TYPES = SHOP_TYPES.filter((type) => PHOTO_BOARDS[type])
const BOARD_SLOTS = SHOP_TYPES.length + PHOTO_TYPES.length
const BOARD_ROWS = Math.ceil(BOARD_SLOTS / 2)
const MENU_TOP = BOARD_ROWS * BOARD_HEIGHT
const MENU_WIDTH = 256
const MENU_HEIGHT = 352
const BOARD_ATLAS = { width: BOARD_WIDTH * 2, height: MENU_TOP + MENU_HEIGHT }

/** What the menu boards say. Shops not listed don't put one out. */
const MENUS: Partial<Record<ShopType, string[]>> = {
  kirana: ['Groceries', 'Snacks', 'Home', 'Essentials'],
  darshini: ['Idli', 'Dosa', 'Vada', 'Meals', 'Filter Coffee'],
  chai: ['Chai', 'Coffee', 'Bun', 'Snacks'],
  bakery: ['Fresh Bakes', 'Cakes', 'Pastries', 'Puffs'],
  pharmacy: ['Medicines', 'Healthcare', 'Personal', 'Care'],
  coffee: ['Filter Coffee', 'Badam Milk', 'Snacks'],
  chats: ['Pani Puri', 'Masala Puri', 'Bhel'],
}
const MENU_TYPES = Object.keys(MENUS) as ShopType[]
/** The last menu slot is left plain dark, for the backs of boards. */
const DARK_SLOT = 7

const drawnSlot = (type: ShopType) => SHOP_TYPES.indexOf(type)
const photoSlot = (type: ShopType) => SHOP_TYPES.length + PHOTO_TYPES.indexOf(type)

type Rect = { u0: number; v0: number; u1: number; v1: number }

/** A pixel rectangle of an atlas as texture coordinates (v counts up from the bottom). */
function toRect(x: number, y: number, width: number, height: number, atlas: { width: number; height: number }): Rect {
  return {
    u0: x / atlas.width,
    u1: (x + width) / atlas.width,
    v0: 1 - (y + height) / atlas.height,
    v1: 1 - y / atlas.height,
  }
}

function boardRect(slot: number): Rect {
  return toRect((slot % 2) * BOARD_WIDTH, Math.floor(slot / 2) * BOARD_HEIGHT, BOARD_WIDTH, BOARD_HEIGHT, BOARD_ATLAS)
}

function menuRect(slot: number): Rect {
  // A few pixels in from the edges, so mipmaps don't bleed the next board in.
  return toRect(slot * MENU_WIDTH + 4, MENU_TOP + 4, MENU_WIDTH - 8, MENU_HEIGHT - 8, BOARD_ATLAS)
}

function drawMenu(context: CanvasRenderingContext2D, lines: string[], x: number, y: number) {
  context.fillStyle = '#8a5a32'
  context.fillRect(x, y, MENU_WIDTH, MENU_HEIGHT)
  context.fillStyle = '#26302c'
  context.fillRect(x + 16, y + 16, MENU_WIDTH - 32, MENU_HEIGHT - 32)
  // Rubbed-out chalk.
  context.fillStyle = 'rgb(255 255 255 / 6%)'
  context.fillRect(x + 30, y + 60, MENU_WIDTH - 70, 40)
  context.fillRect(x + 50, y + 200, MENU_WIDTH - 90, 50)

  context.fillStyle = '#f4f1e6'
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  const size = lines.length > 4 ? 34 : 40
  context.font = `600 ${size}px 'Baloo Tamma 2', 'Kannada Sangam MN', sans-serif`
  lines.forEach((line, index) => {
    context.fillText(line, x + 32, y + 52 + index * size * 1.2, MENU_WIDTH - 60)
  })
}

/** Paints the board atlas. Called again when the photos and the Kannada font have arrived. */
function paintBoards(canvas: HTMLCanvasElement, photos: Map<ShopType, HTMLImageElement>) {
  const context = canvas.getContext('2d')
  if (!context) return

  SHOP_TYPES.forEach((type) => {
    const slot = drawnSlot(type)
    drawBoard(context, type, (slot % 2) * BOARD_WIDTH, Math.floor(slot / 2) * BOARD_HEIGHT, BOARD_WIDTH, BOARD_HEIGHT)
  })
  PHOTO_TYPES.forEach((type) => {
    const slot = photoSlot(type)
    const x = (slot % 2) * BOARD_WIDTH
    const y = Math.floor(slot / 2) * BOARD_HEIGHT
    const photo = photos.get(type)
    if (photo) context.drawImage(photo, x, y, BOARD_WIDTH, BOARD_HEIGHT)
    else drawBoard(context, type, x, y, BOARD_WIDTH, BOARD_HEIGHT)
  })

  MENU_TYPES.forEach((type, slot) => drawMenu(context, MENUS[type] ?? [], slot * MENU_WIDTH, MENU_TOP))
  context.fillStyle = '#2a2b2e'
  context.fillRect(DARK_SLOT * MENU_WIDTH, MENU_TOP, MENU_WIDTH, MENU_HEIGHT)
}

// ---- The interior atlas: one room per kind of shop, four by four ----

const ROOM_WIDTH = 384
const ROOM_HEIGHT = 288
const ROOM_COLUMNS = 4
const INTERIOR_ATLAS = { width: ROOM_WIDTH * ROOM_COLUMNS, height: ROOM_HEIGHT * Math.ceil(SHOP_TYPES.length / ROOM_COLUMNS) }

function roomRect(type: ShopType): Rect {
  const slot = SHOP_TYPES.indexOf(type)
  const x = (slot % ROOM_COLUMNS) * ROOM_WIDTH
  const y = Math.floor(slot / ROOM_COLUMNS) * ROOM_HEIGHT
  return toRect(x + 2, y + 2, ROOM_WIDTH - 4, ROOM_HEIGHT - 4, INTERIOR_ATLAS)
}

function createInteriorAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = INTERIOR_ATLAS.width
  canvas.height = INTERIOR_ATLAS.height
  const context = canvas.getContext('2d')
  if (context) {
    SHOP_TYPES.forEach((type, slot) => {
      const x = (slot % ROOM_COLUMNS) * ROOM_WIDTH
      const y = Math.floor(slot / ROOM_COLUMNS) * ROOM_HEIGHT
      drawInterior(context, type, x, y, ROOM_WIDTH, ROOM_HEIGHT, slot + 3)
    })
  }
  return canvas
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

// ---- Geometry ----

type Corner = { x: number; y: number; z: number; u: number; v: number }
type QuadChunk = { positions: number[]; uvs: number[]; normals: number[] }
type Chunks = Map<number, QuadChunk>

function pushQuad(chunks: Chunks, key: number, normal: THREE.Vector3, corners: Corner[]) {
  let chunk = chunks.get(key)
  if (!chunk) {
    chunk = { positions: [], uvs: [], normals: [] }
    chunks.set(key, chunk)
  }
  const [a, b, c, d] = corners
  for (const { x, y, z, u, v } of [a, b, c, a, c, d]) {
    chunk.positions.push(x, y, z)
    chunk.uvs.push(u, v)
    chunk.normals.push(normal.x, normal.y, normal.z)
  }
}

function toGeometries(chunks: Chunks): THREE.BufferGeometry[] {
  return [...chunks.values()].map(({ positions, uvs, normals }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.computeBoundingSphere()
    return geometry
  })
}

/**
 * Every board, menu board and doorway as flat quads, joined into one geometry
 * per map square for each atlas. "Right" is the viewer's right when facing the
 * wall, so that words read forwards.
 */
function createStorefrontGeometries(shopFronts: ShopFront[]) {
  const boards: Chunks = new Map()
  const rooms: Chunks = new Map()

  for (const { x, z, rotation, width, type, variation, menuBoard } of shopFronts) {
    const key = chunkKey(x, z)
    const out = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation))
    const back = out.clone().negate()
    const rightX = Math.cos(rotation)
    const rightZ = -Math.sin(rotation)

    /** A rectangle facing out from the wall, `gap` in front of it. `flip` mirrors it left to right. */
    const rectangle = (gap: number, halfWidth: number, bottom: number, top: number, rect: Rect, flip = false): Corner[] => {
      const centreX = x + out.x * gap
      const centreZ = z + out.z * gap
      const [left, right] = flip ? [rect.u1, rect.u0] : [rect.u0, rect.u1]
      return [
        { x: centreX - rightX * halfWidth, y: bottom, z: centreZ - rightZ * halfWidth, u: left, v: rect.v0 },
        { x: centreX + rightX * halfWidth, y: bottom, z: centreZ + rightZ * halfWidth, u: right, v: rect.v0 },
        { x: centreX + rightX * halfWidth, y: top, z: centreZ + rightZ * halfWidth, u: right, v: rect.v1 },
        { x: centreX - rightX * halfWidth, y: top, z: centreZ - rightZ * halfWidth, u: left, v: rect.v1 },
      ]
    }

    // The shop inside, mirrored on every other one so neighbours of a kind differ.
    pushQuad(rooms, key, out, rectangle(WALL_GAP, width / 2, 0, INTERIOR_TOP, roomRect(type), variation >= 0.5))

    // The board: a photo board on some of the commonest shops, a drawn one on the rest.
    const slot = PHOTO_BOARDS[type] && variation < 0.5 ? photoSlot(type) : drawnSlot(type)
    pushQuad(boards, key, out, rectangle(SIGN_DEPTH + WALL_GAP, width / 2, SIGN_BOTTOM, SIGN_TOP, boardRect(slot)))
    // On a low roof the board stands clear, so its back needs drawing too.
    const dark = menuRect(DARK_SLOT)
    pushQuad(boards, key, back, rectangle(WALL_GAP, -width / 2, SIGN_BOTTOM, SIGN_TOP, dark))
    // And its top and ends, so it has some thickness from the side.
    const ends = [
      [-1, 1],
      [1, -1],
    ] as const
    for (const [side, facing] of ends) {
      const edgeX = x + rightX * side * (width / 2)
      const edgeZ = z + rightZ * side * (width / 2)
      const normal = new THREE.Vector3(rightX * side, 0, rightZ * side)
      const near = WALL_GAP
      const far = WALL_GAP + SIGN_DEPTH
      const corners: Corner[] = [
        { x: edgeX + out.x * near, y: SIGN_BOTTOM, z: edgeZ + out.z * near, u: dark.u0, v: dark.v0 },
        { x: edgeX + out.x * far, y: SIGN_BOTTOM, z: edgeZ + out.z * far, u: dark.u1, v: dark.v0 },
        { x: edgeX + out.x * far, y: SIGN_TOP, z: edgeZ + out.z * far, u: dark.u1, v: dark.v1 },
        { x: edgeX + out.x * near, y: SIGN_TOP, z: edgeZ + out.z * near, u: dark.u0, v: dark.v1 },
      ]
      pushQuad(boards, key, normal, facing > 0 ? corners.reverse() : corners)
    }

    // The chalk menu board on the pavement: two leaning faces, an A-frame.
    const menu = MENU_TYPES.indexOf(type)
    if (menuBoard && menu >= 0) {
      const [menuX, menuZ] = menuBoard
      const half = MENU.width / 2
      const face = (direction: THREE.Vector3, rect: Rect) => {
        const footX = menuX + direction.x * MENU.lean
        const footZ = menuZ + direction.z * MENU.lean
        const sideX = direction === out ? rightX : -rightX
        const sideZ = direction === out ? rightZ : -rightZ
        const normal = new THREE.Vector3(direction.x, MENU.lean / MENU.height, direction.z).normalize()
        pushQuad(boards, key, normal, [
          { x: footX - sideX * half, y: 0, z: footZ - sideZ * half, u: rect.u0, v: rect.v0 },
          { x: footX + sideX * half, y: 0, z: footZ + sideZ * half, u: rect.u1, v: rect.v0 },
          { x: menuX + sideX * half, y: MENU.height, z: menuZ + sideZ * half, u: rect.u1, v: rect.v1 },
          { x: menuX - sideX * half, y: MENU.height, z: menuZ - sideZ * half, u: rect.u0, v: rect.v1 },
        ])
      }
      face(out, menuRect(menu))
      face(back, menuRect(menu))
    }
  }

  return { boards: toGeometries(boards), rooms: toGeometries(rooms) }
}

/** A sloped sheet one metre wide, stretched to fit each shop. Its back edge is at the wall. */
function createAwningGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 0.06, 1.5)
  geometry.translate(0, 0, 0.75)
  geometry.rotateX(0.3)
  geometry.translate(0, AWNING_HEIGHT, 0)
  return geometry
}

/**
 * Awnings are striped: the shop's colour and white in turn, each stripe the
 * same width however wide the awning is stretched. The stripe count comes from
 * the instance's own scale, read off its matrix in the shader.
 */
function createAwningMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vStripe;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vStripe = (position.x + 0.5) * length(instanceMatrix[0].xyz) / ${STRIPE_WIDTH.toFixed(2)};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStripe;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.93, 0.88), step(0.5, fract(vStripe)));`,
      )
  }
  return material
}

function updateGlow(boards: THREE.MeshStandardMaterial, rooms: THREE.MeshStandardMaterial) {
  boards.emissiveIntensity = liveSky.look.night * SIGN_GLOW
  rooms.emissiveIntensity = liveSky.look.night * INTERIOR_GLOW
}

/** Starts loading the photo boards, calling `done` with each once it can be drawn. */
function loadPhotos(done: (type: ShopType, image: HTMLImageElement) => void) {
  for (const type of PHOTO_TYPES) {
    const url = PHOTO_BOARDS[type] as string
    const cached = THREE.Cache.get(`image:${url}`) as HTMLImageElement | undefined
    if (cached) {
      done(type, cached)
      continue
    }
    const image = new Image()
    image.onload = () => done(type, image)
    image.src = url
  }
}

export function ShopFronts({ shopFronts }: { shopFronts: ShopFront[] }) {
  const awningGeometry = useMemo(() => createAwningGeometry(), [])
  const awningMaterial = useMemo(() => createAwningMaterial(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometries = useMemo(() => createStorefrontGeometries(shopFronts), [shopFronts])

  const { boardMaterial, boardCanvas, photos } = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = BOARD_ATLAS.width
    canvas.height = BOARD_ATLAS.height
    const photoMap = new Map<ShopType, HTMLImageElement>()
    paintBoards(canvas, photoMap)
    const texture = toTexture(canvas)
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: '#ffffff',
      emissiveMap: texture,
      emissiveIntensity: 0,
      roughness: 0.7,
      // The menu boards and the board ends are seen from both sides.
      side: THREE.DoubleSide,
    })
    return { boardMaterial: material, boardCanvas: canvas, photos: photoMap }
  }, [])

  const roomMaterial = useMemo(() => {
    const texture = toTexture(createInteriorAtlas())
    return new THREE.MeshStandardMaterial({
      map: texture,
      emissive: '#ffffff',
      emissiveMap: texture,
      emissiveIntensity: 0,
      roughness: 0.9,
    })
  }, [])

  // Repaint the boards once the photos and the Kannada letters are ready.
  useEffect(() => {
    let live = true
    const repaint = () => {
      if (!live) return
      paintBoards(boardCanvas, photos)
      if (boardMaterial.map) boardMaterial.map.needsUpdate = true
    }
    loadPhotos((type, image) => {
      photos.set(type, image)
      repaint()
    })
    document.fonts?.load(BOARD_FONT_CHECK, KANNADA_SAMPLE).then(repaint, () => {})
    return () => {
      live = false
    }
  }, [boardCanvas, boardMaterial, photos])

  useEffect(
    () => () => {
      awningGeometry.dispose()
      awningMaterial.dispose()
    },
    [awningGeometry, awningMaterial],
  )
  useFrame(() => updateGlow(boardMaterial, roomMaterial))

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return

    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    shopFronts.forEach(({ x, z, rotation, width, type }, index) => {
      transform.position.set(x, 0, z)
      transform.rotation.y = rotation
      transform.scale.set(width, 1, 1)
      transform.updateMatrix()
      instances.setMatrixAt(index, transform.matrix)
      instances.setColorAt(index, color.set(awningColor(type)))
    })

    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    instances.computeBoundingSphere()
  }, [shopFronts])

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[awningGeometry, awningMaterial, shopFronts.length]}
        receiveShadow
      />
      <ChunkedMesh geometries={geometries.rooms} material={roomMaterial} />
      <ChunkedMesh geometries={geometries.boards} material={boardMaterial} />
    </>
  )
}
