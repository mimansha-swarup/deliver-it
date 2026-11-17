import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { StreamedChunks } from './StreamedChunks'
import { chunkKey } from './chunks'
import type { ShopFront } from './shopFrontPlacement'
import { BACK_WALL_TILE } from './productCards'
import { drawInteriorTiles } from './shopInteriors'
import { createShopFrontKit, SHUTTER_BOTTOM } from './shopFrontKit'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import {
  awningColor,
  BOARD_FONT_CHECK,
  BOARD_FONT,
  drawBoard,
  KANNADA_SAMPLE,
  letteringOf,
  NAME_LINES,
  PHOTO_BOARDS,
  SHOP_TYPES,
  type ShopType,
} from './signboards'
import { groundLift } from './groundLift'
import { createRandom } from './props'
import { isDebug } from '../dev/spawn'
import { PREFIXES, TYPE_WORDS, type Name } from './shopNames'

/**
 * Every shop front: an open doorway with the shop inside, a signboard above
 * it, a striped awning, and on some a chalk menu board on the pavement.
 *
 * The inside is a room in 3D, drawn on one flat quad in the doorway by its
 * shader (interior mapping): for each pixel it finds where the line of sight
 * meets the room's back wall, side walls, floor or ceiling, and paints that,
 * so the room shifts in perspective as the rider passes. In front of it stand
 * real 3D pieces: the shutter box, rails, step, counters and goods (shopFrontKit.ts).
 *
 * The boards and the insides are each drawn once into one big image (an atlas),
 * and every shop's quads point at their part of it, so a whole map square of
 * shops is one draw call per image.
 */

const AWNING_HEIGHT = 2.9
const STRIPE_WIDTH = 0.45

const INTERIOR_TOP = SHUTTER_BOTTOM
/** How deep the rooms are, in metres: shallower and deeper ones by `variation`. */
const ROOM_DEPTH: [number, number] = [2.6, 4.2]
/** By day the rooms are lit by their tube lights a little; at night more. */
const INTERIOR_DAY_GLOW = 0.06
/** Rooms read a little darker than the street outside: the street is in sun, the room isn't. */
const ROOM_SHADE = 0.82
/** On Low, the shops' 3D fronts are drawn only this near, in metres. */
const LOW_KIT_DISTANCE = 60
const SIGN_BOTTOM = 3.0
const SIGN_TOP = 3.86
const WALL_GAP = 0.05
/** The board stands this far off the wall, on brackets. */
const SIGN_DEPTH = 0.16
const MENU = { width: 0.62, height: 0.95, lean: 0.2 }

const SIGN_GLOW = 0.85
const INTERIOR_GLOW = 0.6
/** About this share of boards are backlit boxes: at night they glow this much brighter than a painted board's `PAINTED_GLOW`. */
const BACKLIT_SHARE = 0.3
const BACKLIT_GLOW = 2.4
const PAINTED_GLOW = 0.55
/** The warm light from an open shop on the ground outside: how far out it reaches, how far past each side, and how bright at its brightest. */
const SPILL = { reach: 3.4, spread: 1.0, lift: 0.012, strength: 0.75, color: '#ffa652' }
const UP_NORMAL = new THREE.Vector3(0, 1, 0)

// ---- The board atlas: blank boards in four columns, then single words, then a strip of chalk menu boards ----
// A board is its kind's blank board with a name laid over it: one first word and
// one of the kind's words (shopNames.ts), in Kannada above English. So the atlas
// holds words, not whole boards, and there are dozens of names for each kind of
// shop. It must stay under 4,096 pixels tall, the most many GPUs take.

const BOARD_WIDTH = 1024
const BOARD_HEIGHT = 192
const BOARD_COLUMNS = 4
const PHOTO_TYPES = SHOP_TYPES.filter((type) => PHOTO_BOARDS[type])
const BOARD_SLOTS = SHOP_TYPES.length + PHOTO_TYPES.length
const BOARD_ROWS = Math.ceil(BOARD_SLOTS / BOARD_COLUMNS)
const WORDS_TOP = BOARD_ROWS * BOARD_HEIGHT

/** One word's picture in the atlas: where it is, in pixels, and how wide its letters are. */
type WordCell = { x: number; y: number; width: number; height: number }
type WordKey = `${'kannada' | 'english'}:${string}`

/** Every word a name can use, in each language: the first words and every kind's words. */
const WORDS: { key: WordKey; text: string; line: 'kannada' | 'english' }[] = (() => {
  const seen = new Set<string>()
  const words: { key: WordKey; text: string; line: 'kannada' | 'english' }[] = []
  const add = (name: Name) => {
    for (const line of ['kannada', 'english'] as const) {
      const key: WordKey = `${line}:${name[line]}`
      if (seen.has(key)) continue
      seen.add(key)
      words.push({ key, text: name[line], line })
    }
  }
  PREFIXES.forEach(add)
  SHOP_TYPES.forEach((type) => TYPE_WORDS[type].forEach(add))
  return words
})()

const wordFont = (line: 'kannada' | 'english') => `${NAME_LINES[line].weight} ${Math.round(BOARD_HEIGHT * NAME_LINES[line].size)}px ${BOARD_FONT}`
/** A word's picture is this much taller than its letters, for Kannada's marks above and below the line. */
const WORD_CELL_HEIGHT = { kannada: Math.round(BOARD_HEIGHT * NAME_LINES.kannada.size * 1.45), english: Math.round(BOARD_HEIGHT * NAME_LINES.english.size * 1.35) }
const WORD_PAD = 8

/**
 * Packs the words into rows below the boards, measuring each in the board font.
 * Measured once, after the font has loaded, as the boards' shapes are built
 * from these widths.
 */
let wordCells: Map<WordKey, WordCell> | null = null
let wordsBottom = WORDS_TOP
function layOutWords(): Map<WordKey, WordCell> {
  if (wordCells) return wordCells
  const context = document.createElement('canvas').getContext('2d')
  const cells = new Map<WordKey, WordCell>()
  let x = 0
  let y = WORDS_TOP
  let rowHeight = 0
  for (const word of WORDS) {
    if (context) context.font = wordFont(word.line)
    const textWidth = Math.ceil(context?.measureText(word.text).width ?? word.text.length * 30)
    const width = textWidth + WORD_PAD * 2
    const height = WORD_CELL_HEIGHT[word.line]
    if (x + width > BOARD_WIDTH * BOARD_COLUMNS) {
      x = 0
      y += rowHeight
      rowHeight = 0
    }
    cells.set(word.key, { x, y, width, height })
    x += width
    rowHeight = Math.max(rowHeight, height)
  }
  wordsBottom = y + rowHeight
  wordCells = cells
  return cells
}

/** The menu boards' strip, below the words. */
const MENU_WIDTH = 256
const MENU_HEIGHT = 352
function boardAtlasSize() {
  layOutWords()
  return { width: BOARD_WIDTH * BOARD_COLUMNS, height: wordsBottom + MENU_HEIGHT }
}
let BOARD_ATLAS = { width: BOARD_WIDTH * BOARD_COLUMNS, height: 4096 }
let MENU_TOP = 0

/** Sizes the atlas to what the words need. Call once the board font has loaded. */
function prepareBoardAtlas() {
  BOARD_ATLAS = boardAtlasSize()
  MENU_TOP = wordsBottom
}

/**
 * The board font, loaded before the words are measured: the boards' shapes are
 * built from their widths. Gives up after a few seconds and uses whatever font there is.
 */
let fontsReady: Promise<void> | null = null
function boardFontsReady(): Promise<void> {
  fontsReady ??= Promise.race([
    Promise.all(['700', '800'].map((weight) => document.fonts?.load(`${weight} 64px 'Baloo Tamma 2'`, `${KANNADA_SAMPLE}Ag`))).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 4000)),
  ]).catch(() => undefined)
  return fontsReady
}

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

/** A shop's board: its kind's blank board with a name of first word and kind's word, or a photo board, whose name is its own. */
type BoardChoice = { slot: number; name: { prefix: Name; word: Name } | null; key: string }

/** Two shops this close never show the same name, while there's another to give, in metres. */
const BOARD_SPREAD = 300
/** Now and then a shop of a kind with a photo board has it, where its name isn't already up nearby. */
const PHOTO_SHARE = 0.12

/**
 * Picks every shop's board and name, so the same name doesn't turn up within
 * BOARD_SPREAD: each shop tries its kind's names in an order of its own (from
 * where it stands, so it's the same on every visit), and takes the first not
 * already up nearby. If every one is, it takes the one whose nearest copy is
 * furthest away. Names are kept in a grid, so a check looks only at shops nearby.
 */
function assignBoards(shopFronts: ShopFront[]): BoardChoice[] {
  const CELL = BOARD_SPREAD
  const used = new Map<string, Map<string, [number, number][]>>()
  const nearestUse = (key: string, x: number, z: number) => {
    let nearest = Infinity
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        for (const [px, pz] of used.get(`${i},${j}`)?.get(key) ?? []) nearest = Math.min(nearest, Math.hypot(px - x, pz - z))
      }
    }
    return nearest
  }
  let repeats = 0
  const choices = shopFronts.map(({ x, z, type }) => {
    const random = createRandom(Math.abs(Math.round(x * 31 + z * 17)) + 1)
    const options: BoardChoice[] = []
    const words = TYPE_WORDS[type]
    for (const prefix of PREFIXES) for (const word of words) options.push({ slot: drawnSlot(type), name: { prefix, word }, key: `${prefix.english}|${word.english}` })
    // Shuffled in the shop's own order.
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[options[i], options[j]] = [options[j], options[i]]
    }
    if (PHOTO_BOARDS[type] && random() < PHOTO_SHARE) options.unshift({ slot: photoSlot(type), name: null, key: `photo|${type}` })
    const choice = options.find((option) => nearestUse(option.key, x, z) > BOARD_SPREAD) ?? options.reduce((best, option) => (nearestUse(option.key, x, z) > nearestUse(best.key, x, z) ? option : best))
    if (nearestUse(choice.key, x, z) <= BOARD_SPREAD) repeats++
    const cellKey = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
    const cell = used.get(cellKey) ?? new Map<string, [number, number][]>()
    used.set(cellKey, cell)
    const list = cell.get(choice.key) ?? []
    cell.set(choice.key, list)
    list.push([x, z])
    return choice
  })
  // Debug: how many shops had to share a name with one within BOARD_SPREAD, as every name of their kind was taken.
  if (isDebug()) (window as unknown as { __deliverItBoards?: unknown }).__deliverItBoards = { shops: shopFronts.length, repeats, atlas: BOARD_ATLAS }
  return choices
}

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

/** Where a board's slot is in the atlas, in pixels. */
function slotAt(slot: number): [number, number] {
  return [(slot % BOARD_COLUMNS) * BOARD_WIDTH, Math.floor(slot / BOARD_COLUMNS) * BOARD_HEIGHT]
}

function boardRect(slot: number): Rect {
  // A pixel in from each side, so mipmaps don't bleed the next board in.
  const [x, y] = slotAt(slot)
  return toRect(x + 1, y + 1, BOARD_WIDTH - 2, BOARD_HEIGHT - 2, BOARD_ATLAS)
}

/** A word's picture in the atlas, as texture coordinates, with its size in pixels. */
function wordRect(key: WordKey): { rect: Rect; width: number; height: number } | null {
  const cell = layOutWords().get(key)
  if (!cell) return null
  return { rect: toRect(cell.x, cell.y, cell.width, cell.height, BOARD_ATLAS), width: cell.width, height: cell.height }
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
    const [x, y] = slotAt(drawnSlot(type))
    drawBoard(context, type, x, y, BOARD_WIDTH, BOARD_HEIGHT, null)
  })
  PHOTO_TYPES.forEach((type) => {
    const [x, y] = slotAt(photoSlot(type))
    const photo = photos.get(type)
    if (photo) context.drawImage(photo, x, y, BOARD_WIDTH, BOARD_HEIGHT)
    else drawBoard(context, type, x, y, BOARD_WIDTH, BOARD_HEIGHT)
  })

  // The words, in white, to be tinted with each kind's lettering colour where they're laid on a board.
  const cells = layOutWords()
  context.clearRect(0, WORDS_TOP, canvas.width, wordsBottom - WORDS_TOP)
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const word of WORDS) {
    const cell = cells.get(word.key)
    if (!cell) continue
    context.font = wordFont(word.line)
    context.fillText(word.text, cell.x + cell.width / 2, cell.y + cell.height / 2)
  }

  MENU_TYPES.forEach((type, slot) => drawMenu(context, MENUS[type] ?? [], slot * MENU_WIDTH, MENU_TOP))
  context.fillStyle = '#2a2b2e'
  context.fillRect(DARK_SLOT * MENU_WIDTH, MENU_TOP, MENU_WIDTH, MENU_HEIGHT)
}

// ---- The interior atlas: one square per kind of shop, four by four ----
// Each square has the back wall across its top three quarters, and the floor
// and ceiling side by side below (see drawInteriorTiles in shopInteriors.ts).

const ROOM_TILE = 512
const ROOM_COLUMNS = 4
const ROOM_ROWS = Math.ceil(SHOP_TYPES.length / ROOM_COLUMNS)
const INTERIOR_ATLAS = { width: ROOM_TILE * ROOM_COLUMNS, height: ROOM_TILE * ROOM_ROWS }

/** Where a kind of shop's square is in the atlas: its bottom-left corner, in texture coordinates. */
function roomCell(type: ShopType): [number, number] {
  const slot = SHOP_TYPES.indexOf(type)
  return [(slot % ROOM_COLUMNS) / ROOM_COLUMNS, 1 - (Math.floor(slot / ROOM_COLUMNS) + 1) / ROOM_ROWS]
}

function createInteriorAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = INTERIOR_ATLAS.width
  canvas.height = INTERIOR_ATLAS.height
  const context = canvas.getContext('2d')
  if (context) {
    SHOP_TYPES.forEach((type, slot) => {
      drawInteriorTiles(context, type, (slot % ROOM_COLUMNS) * ROOM_TILE, Math.floor(slot / ROOM_COLUMNS) * ROOM_TILE, ROOM_TILE, slot + 3)
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
type QuadChunk = { positions: number[]; uvs: number[]; normals: number[]; glows: number[]; colors: number[] }
type Chunks = Map<number, QuadChunk>

/** `glow` scales how brightly the quad lights up at night: backlit boards more, the rest less. */
const WHITE = new THREE.Color('#ffffff')

/** `color` tints it: white for pictures, a kind's lettering colour for the words of a name. */
function pushQuad(chunks: Chunks, key: number, normal: THREE.Vector3, corners: Corner[], glow = 1, color = WHITE) {
  let chunk = chunks.get(key)
  if (!chunk) {
    chunk = { positions: [], uvs: [], normals: [], glows: [], colors: [] }
    chunks.set(key, chunk)
  }
  const [a, b, c, d] = corners
  for (const { x, y, z, u, v } of [a, b, c, a, c, d]) {
    chunk.positions.push(x, y, z)
    chunk.uvs.push(u, v)
    chunk.normals.push(normal.x, normal.y, normal.z)
    chunk.glows.push(glow)
    chunk.colors.push(color.r, color.g, color.b)
  }
}

function toGeometries(chunks: Chunks): THREE.BufferGeometry[] {
  return [...chunks.values()].map(({ positions, uvs, normals, glows, colors }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('aGlow', new THREE.Float32BufferAttribute(glows, 1))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.computeBoundingSphere()
    return geometry
  })
}

type Room = {
  x: number
  z: number
  out: THREE.Vector3
  rightX: number
  rightZ: number
  width: number
  bottom: number
  top: number
  depth: number
  cell: [number, number]
  flip: boolean
}
type RoomChunk = { positions: number[]; normals: number[]; uvs: number[]; cells: number[]; sizes: number[]; rights: number[]; flips: number[] }
type RoomChunks = Map<number, RoomChunk>

/** The doorway quad of one room. `uv` runs 0 to 1 across and up it; the rest tells the shader the room's size and which way it faces. */
function pushRoom(chunks: RoomChunks, key: number, room: Room) {
  let chunk = chunks.get(key)
  if (!chunk) {
    chunk = { positions: [], normals: [], uvs: [], cells: [], sizes: [], rights: [], flips: [] }
    chunks.set(key, chunk)
  }
  const centreX = room.x + room.out.x * WALL_GAP
  const centreZ = room.z + room.out.z * WALL_GAP
  const half = room.width / 2
  const corner = (u: number, v: number) => ({
    x: centreX + room.rightX * half * (u * 2 - 1),
    y: v ? room.top : room.bottom,
    z: centreZ + room.rightZ * half * (u * 2 - 1),
    u,
    v,
  })
  const a = corner(0, 0)
  const b = corner(1, 0)
  const c = corner(1, 1)
  const d = corner(0, 1)
  for (const point of [a, b, c, a, c, d]) {
    chunk.positions.push(point.x, point.y, point.z)
    chunk.normals.push(room.out.x, 0, room.out.z)
    chunk.uvs.push(point.u, point.v)
    chunk.cells.push(...room.cell)
    chunk.sizes.push(room.width, room.top - room.bottom, room.depth)
    chunk.rights.push(room.rightX, 0, room.rightZ)
    chunk.flips.push(room.flip ? 1 : 0)
  }
}

function toRoomGeometries(chunks: RoomChunks): THREE.BufferGeometry[] {
  return [...chunks.values()].map(({ positions, normals, uvs, cells, sizes, rights, flips }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('aRoomCell', new THREE.Float32BufferAttribute(cells, 2))
    geometry.setAttribute('aRoomSize', new THREE.Float32BufferAttribute(sizes, 3))
    geometry.setAttribute('aRoomRight', new THREE.Float32BufferAttribute(rights, 3))
    geometry.setAttribute('aRoomFlip', new THREE.Float32BufferAttribute(flips, 1))
    geometry.computeBoundingSphere()
    return geometry
  })
}

/**
 * The room shader (interior mapping). In the room's own frame, x runs across
 * the doorway, y up, and z out of it, so the room is the box from (0, 0, -depth)
 * to (width, height, 0). Each pixel follows the line of sight from the camera
 * into that box, finds which face it meets first, and paints that face from the
 * shop's square in the atlas, darker further back.
 */
function createRoomMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ map: texture, emissive: '#ffffff', emissiveIntensity: INTERIOR_DAY_GLOW, roughness: 0.9 })
  const cell = (1 / ROOM_COLUMNS).toFixed(5)
  const cellHeight = (1 / ROOM_ROWS).toFixed(5)
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec2 aRoomCell;
        attribute vec3 aRoomSize;
        attribute vec3 aRoomRight;
        attribute float aRoomFlip;
        varying vec3 vRoomWorld;
        varying vec2 vRoomUv;
        varying vec2 vRoomCell;
        varying vec3 vRoomSize;
        varying vec3 vRoomRight;
        varying vec3 vRoomOut;
        varying float vRoomFlip;
        void main() {
          vRoomUv = uv;
          vRoomCell = aRoomCell;
          vRoomSize = aRoomSize;
          vRoomRight = aRoomRight;
          vRoomOut = normal;
          vRoomFlip = aRoomFlip;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRoomWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vRoomWorld;
        varying vec2 vRoomUv;
        varying vec2 vRoomCell;
        varying vec3 vRoomSize;
        varying vec3 vRoomRight;
        varying vec3 vRoomOut;
        varying float vRoomFlip;
        void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 roomView = normalize(vRoomWorld - cameraPosition);
        vec3 rd = vec3(dot(roomView, vRoomRight), roomView.y, min(dot(roomView, vRoomOut), -0.0001));
        vec3 ro = vec3(vRoomUv.x * vRoomSize.x, vRoomUv.y * vRoomSize.y, 0.0);
        float tx = rd.x > 0.00001 ? (vRoomSize.x - ro.x) / rd.x : (rd.x < -0.00001 ? -ro.x / rd.x : 1e6);
        float ty = rd.y > 0.00001 ? (vRoomSize.y - ro.y) / rd.y : (rd.y < -0.00001 ? -ro.y / rd.y : 1e6);
        float tz = -vRoomSize.z / rd.z;
        float t = min(tx, min(ty, tz));
        vec3 hit = ro + rd * t;
        float roomDepth = clamp(-hit.z / vRoomSize.z, 0.0, 1.0);
        vec2 tileUv;
        vec2 tileOrigin = vec2(0.0, 0.25);
        vec2 tileSize = vec2(1.0, 0.75);
        float roomLight = 1.0;
        // The back wall repeats every BACK_WALL_TILE metres, so its goods are the same real size in a
        // narrow shop and a wide one, rather than stretched across whatever the doorway's width is.
        float wallRepeats = vRoomSize.x / ${BACK_WALL_TILE.toFixed(3)};
        if (t == tz) {
          tileUv = vec2(fract(hit.x / ${BACK_WALL_TILE.toFixed(3)}), hit.y / vRoomSize.y);
        } else if (t == tx) {
          // The side walls carry on the back wall's shelves, from its edge forwards.
          float along = 0.3 * (1.0 - roomDepth);
          tileUv = vec2(rd.x > 0.0 ? 1.0 - along : along, hit.y / vRoomSize.y);
          roomLight = 0.8;
        } else if (rd.y < 0.0) {
          tileUv = vec2(hit.x / vRoomSize.x, 1.0 - roomDepth);
          tileOrigin = vec2(0.0, 0.0);
          tileSize = vec2(0.5, 0.25);
        } else {
          tileUv = vec2(hit.x / vRoomSize.x, roomDepth);
          tileOrigin = vec2(0.5, 0.0);
          tileSize = vec2(0.5, 0.25);
          roomLight = 0.9;
        }
        if (vRoomFlip > 0.5 && t != ty) tileUv.x = 1.0 - tileUv.x;
        tileUv = clamp(tileUv, 0.01, 0.99);
        vec2 roomCellSize = vec2(${cell}, ${cellHeight});
        vec2 roomUv = vRoomCell + (tileOrigin + tileUv * tileSize) * roomCellSize;
        // Gradients from the smooth doorway coordinates, so the face edges don't flash the smallest mip.
        vec2 roomScale = roomCellSize * vec2(t == tz ? wallRepeats : 1.0, 0.75);
        vec4 roomColor = textureGrad(map, roomUv, dFdx(vRoomUv) * roomScale, dFdy(vRoomUv) * roomScale);
        roomColor.rgb *= roomLight * mix(1.0, 0.62, roomDepth) * ${ROOM_SHADE.toFixed(2)};
        diffuseColor *= roomColor;`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= roomColor.rgb;')
  }
  material.customProgramCacheKey = () => 'shop-room'
  return material
}

/**
 * Every board, menu board and doorway as flat quads, joined into one geometry
 * per map square for each atlas. "Right" is the viewer's right when facing the
 * wall, so that words read forwards.
 */
/** The rooms, boards and light spill of some shops, `boardSlots` holding each one's board, in the same order. */
function createStorefrontGeometries(shopFronts: ShopFront[], boardSlots: BoardChoice[]) {
  const boards: Chunks = new Map()
  const rooms: RoomChunks = new Map()
  const spills: Chunks = new Map()

  shopFronts.forEach(({ x, z, rotation, width, type, variation, menuBoard }, shopIndex) => {
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

    // The shop inside: a room drawn by its shader, mirrored on every other one so neighbours of a kind differ.
    const lift = groundLift.at(x + out.x * 0.6, z + out.z * 0.6)
    const depth = ROOM_DEPTH[0] + (ROOM_DEPTH[1] - ROOM_DEPTH[0]) * ((variation * 7.31) % 1)
    pushRoom(rooms, key, { x, z, out, rightX, rightZ, width, bottom: lift, top: INTERIOR_TOP + lift, depth, cell: roomCell(type), flip: variation >= 0.5 })

    // The board: a photo board on some of the commonest shops, a drawn one on the rest.
    const { slot, name } = boardSlots[shopIndex]
    // A few boards are backlit boxes, bright at night; the rest are painted and lit from the street.
    const backlit = (variation * 13.7) % 1 < BACKLIT_SHARE
    const glow = backlit ? BACKLIT_GLOW : PAINTED_GLOW
    pushQuad(boards, key, out, rectangle(SIGN_DEPTH + WALL_GAP, width / 2, SIGN_BOTTOM, SIGN_TOP, boardRect(slot)), glow)
    // The name, laid over the blank board word by word, at the letters' own shape rather than
    // stretched with the board, and squeezed only if a line is too long for it.
    if (name) {
      const metresPerPixel = (SIGN_TOP - SIGN_BOTTOM) / BOARD_HEIGHT
      // The name sits between the board's icon and its right edge, as drawBoard lays it out.
      const across = width / BOARD_WIDTH
      const textLeft = -width / 2 + BOARD_HEIGHT * 0.8 * across
      const textRight = width / 2 - BOARD_HEIGHT * 0.12 * across
      const lettering = new THREE.Color(letteringOf(type))
      const face = SIGN_DEPTH + WALL_GAP + 0.004
      for (const line of ['kannada', 'english'] as const) {
        const cells = [`${line}:${name.prefix[line]}`, `${line}:${name.word[line]}`].map((wordKey) => wordRect(wordKey as WordKey))
        if (cells.some((cell) => !cell)) continue
        const widths = cells.map((cell) => cell!.width * metresPerPixel)
        const total = widths[0] + widths[1]
        const squeeze = Math.min(1, (textRight - textLeft) / total)
        const middleY = SIGN_TOP - NAME_LINES[line].middle * (SIGN_TOP - SIGN_BOTTOM)
        let along = (textLeft + textRight) / 2 - (total * squeeze) / 2
        cells.forEach((cell, i) => {
          const halfHeight = (cell!.height * metresPerPixel) / 2
          const w = widths[i] * squeeze
          const at = (offset: number, y: number, u: number, v: number): Corner => ({
            x: x + out.x * face + rightX * offset,
            y,
            z: z + out.z * face + rightZ * offset,
            u,
            v,
          })
          const r = cell!.rect
          pushQuad(boards, key, out, [at(along, middleY - halfHeight, r.u0, r.v0), at(along + w, middleY - halfHeight, r.u1, r.v0), at(along + w, middleY + halfHeight, r.u1, r.v1), at(along, middleY + halfHeight, r.u0, r.v1)], glow, lettering)
          along += w
        })
      }
    }
    // On a low roof the board stands clear, so its back needs drawing too.
    const dark = menuRect(DARK_SLOT)
    pushQuad(boards, key, back, rectangle(WALL_GAP, -width / 2, SIGN_BOTTOM, SIGN_TOP, dark), 0)
    // Warm light from the open shop, spilling onto the ground in front of it at night.
    const spillLift = groundLift.at(x + out.x * SPILL.reach * 0.5, z + out.z * SPILL.reach * 0.5) + SPILL.lift
    pushQuad(spills, key, UP_NORMAL, [
      { x: x + out.x * WALL_GAP - rightX * (width / 2 + SPILL.spread), y: spillLift, z: z + out.z * WALL_GAP - rightZ * (width / 2 + SPILL.spread), u: 0, v: 1 },
      { x: x + out.x * WALL_GAP + rightX * (width / 2 + SPILL.spread), y: spillLift, z: z + out.z * WALL_GAP + rightZ * (width / 2 + SPILL.spread), u: 1, v: 1 },
      { x: x + out.x * SPILL.reach + rightX * (width / 2 + SPILL.spread), y: spillLift, z: z + out.z * SPILL.reach + rightZ * (width / 2 + SPILL.spread), u: 1, v: 0 },
      { x: x + out.x * SPILL.reach - rightX * (width / 2 + SPILL.spread), y: spillLift, z: z + out.z * SPILL.reach - rightZ * (width / 2 + SPILL.spread), u: 0, v: 0 },
    ])
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
  })

  return { boards: toGeometries(boards), rooms: toRoomGeometries(rooms), spills: toGeometries(spills) }
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

/** A soft pool of light, brightest at the doorway's middle and fading out and to the sides. Black adds nothing. */
function createSpillTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#000'
    context.fillRect(0, 0, 128, 128)
    context.save()
    context.scale(1, 1.6)
    const glow = context.createRadialGradient(64, 0, 4, 64, 0, 78)
    glow.addColorStop(0, '#ffffff')
    glow.addColorStop(0.45, '#7a7a7a')
    glow.addColorStop(1, '#000000')
    context.fillStyle = glow
    context.fillRect(0, 0, 128, 80)
    context.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function updateGlow(boards: THREE.MeshStandardMaterial, rooms: THREE.MeshStandardMaterial, spill: THREE.MeshBasicMaterial) {
  const { night } = liveSky.look
  spill.opacity = night * SPILL.strength
  spill.visible = night > 0.05
  boards.emissiveIntensity = liveSky.look.night * SIGN_GLOW
  rooms.emissiveIntensity = INTERIOR_DAY_GLOW + liveSky.look.night * INTERIOR_GLOW
}

/**
 * Starts loading the photo boards, calling `done` with each once it can be drawn.
 * Through three.js's image loader, which hands back the page's own download if
 * it's done or still under way, rather than starting another.
 */
function loadPhotos(done: (type: ShopType, image: HTMLImageElement) => void) {
  const loader = new THREE.ImageLoader()
  for (const type of PHOTO_TYPES) {
    loader.load(PHOTO_BOARDS[type] as string, (image) => done(type, image))
  }
}

export function ShopFronts({ shopFronts }: { shopFronts: ShopFront[] }) {
  const awningGeometry = useMemo(() => createAwningGeometry(), [])
  const awningMaterial = useMemo(() => createAwningMaterial(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  use(boardFontsReady())
  // Every shop's board is chosen across the whole map, so no name repeats nearby; the shapes are
  // then built a map square at a time, near the rider first (StreamedChunks.tsx).
  const choices = useMemo(() => {
    prepareBoardAtlas()
    return assignBoards(shopFronts)
  }, [shopFronts])
  const squares = useMemo(() => {
    const byKey = new Map<number, number[]>()
    shopFronts.forEach(({ x, z }, index) => {
      const key = chunkKey(x, z)
      const list = byKey.get(key)
      if (list) list.push(index)
      else byKey.set(key, [index])
    })
    return byKey
  }, [shopFronts])
  const keys = useMemo(() => [...squares.keys()], [squares])
  const build = useCallback(
    (key: number): (THREE.BufferGeometry | null)[] => {
      const indices = squares.get(key) ?? []
      const shops = indices.map((index) => shopFronts[index])
      const { rooms, boards, spills } = createStorefrontGeometries(shops, indices.map((index) => choices[index]))
      const [kit] = createShopFrontKit(shops, indices)
      return [rooms[0] ?? null, kit ?? null, boards[0] ?? null, spills[0] ?? null]
    },
    [squares, shopFronts, choices],
  )

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
      // Names' words are white letters on clear ground, tinted with each kind's lettering colour.
      vertexColors: true,
      transparent: true,
    })
    // Each board's own glow at night (aGlow): backlit boxes bright, painted boards dim.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('void main() {', 'attribute float aGlow;\nvarying float vGlow;\nvoid main() {\n vGlow = aGlow;')
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'varying float vGlow;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vGlow * vColor.rgb;')
    }
    material.customProgramCacheKey = () => 'shop-boards'
    return { boardMaterial: material, boardCanvas: canvas, photos: photoMap }
  }, [])

  const roomMaterial = useMemo(() => createRoomMaterial(toTexture(createInteriorAtlas())), [])
  const kitMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }), [])
  const { propDistance, kitDetail } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  // On Low, the counters and goods out front only near the rider.
  const kitDistance = kitDetail === 0 ? LOW_KIT_DISTANCE : propDistance

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
  const spillMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: createSpillTexture(),
        color: SPILL.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      }),
    [],
  )
  useFrame(() => updateGlow(boardMaterial, roomMaterial, spillMaterial))
  const layers = useMemo(
    () => [
      { material: roomMaterial },
      { material: kitMaterial, castShadow: true, maxDistance: kitDistance },
      { material: boardMaterial },
      { material: spillMaterial, maxDistance: kitDistance },
    ],
    [roomMaterial, kitMaterial, boardMaterial, spillMaterial, kitDistance],
  )
  // The materials were freed by ChunkedMesh; streamed squares leave that to their owner.
  useEffect(
    () => () => {
      for (const material of [roomMaterial, kitMaterial, boardMaterial, spillMaterial]) material.dispose()
    },
    [roomMaterial, kitMaterial, boardMaterial, spillMaterial],
  )

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return

    const transform = new THREE.Object3D()
    const color = new THREE.Color()
    shopFronts.forEach(({ x, z, rotation, width, type }, index) => {
      transform.position.set(x, groundLift.at(x, z), z)
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
      <StreamedChunks keys={keys} build={build} layers={layers} />
    </>
  )
}
