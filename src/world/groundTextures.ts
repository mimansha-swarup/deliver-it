import * as THREE from 'three'
import { createRandom } from './props'

/*
 * Textures for the new ground, drawn in code at load time: interlocking paver
 * blocks for the footpaths, and one picture holding the four marks on the
 * asphalt. Nothing to download, and each is 1024 pixels square.
 */

/** One repeat of the paver picture covers this much footpath, in metres: 4 pavers across, 8 rows down. */
export const PAVER_TILE = 0.96
const SIZE = 1024

/**
 * An I-shaped paver ("dog bone"), in units of its length: full height at the
 * two heads, narrower at the waist. Rows step half a paver along and sit
 * `ROW` apart, so each head fills the waist notch of the row beside it.
 */
const HEIGHT = 0.6
const NOTCH = 0.1
const ROW = HEIGHT - NOTCH
const PAVER_SHAPE: [number, number][] = [
  [0, 0], [0.25, 0], [0.25, NOTCH], [0.75, NOTCH], [0.75, 0], [1, 0],
  [1, HEIGHT], [0.75, HEIGHT], [0.75, HEIGHT - NOTCH], [0.25, HEIGHT - NOTCH], [0.25, HEIGHT], [0, HEIGHT],
]
const ACROSS = 4
const ROWS = 8
/** Pixels per paver length. */
const UNIT = SIZE / ACROSS
/** The sand-filled joint between pavers, in pixels. */
const JOINT = 5

/** Calls `draw` with the outline of every paver touching the picture, and that paver's number in the repeat. */
function forEachPaver(draw: (outline: [number, number][], id: number) => void) {
  const rowPixels = ROW * UNIT
  for (let row = -1; row <= ROWS; row++) {
    const shift = (((row % 2) + 2) % 2) * 0.5
    for (let column = -1; column <= ACROSS; column++) {
      const x0 = (column + shift) * UNIT
      const y0 = row * rowPixels
      const outline = PAVER_SHAPE.map(([u, v]): [number, number] => [x0 + u * UNIT, y0 + v * UNIT])
      // The same paver on the other side of a wrap gets the same number, so its colour matches.
      const id = (((row % ROWS) + ROWS) % ROWS) * ACROSS + (((column % ACROSS) + ACROSS) % ACROSS)
      draw(outline, id)
    }
  }
}

function tracePath(context: CanvasRenderingContext2D, outline: [number, number][]) {
  context.beginPath()
  outline.forEach(([x, y], i) => (i === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
  context.closePath()
}

/**
 * The colour picture: grey concrete pavers, each a slightly different shade
 * (some warmer, a few darker with age), speckled, in pale sandy joints.
 */
function drawPaverColour(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.fillStyle = '#7d776c'
  context.fillRect(0, 0, SIZE, SIZE)

  const random = createRandom(4242)
  const shades = Array.from({ length: ACROSS * ROWS }, () => {
    const light = 128 + Math.round((random() - 0.5) * 26) - (random() < 0.12 ? 18 : 0)
    const warm = Math.round((random() - 0.4) * 8)
    return `rgb(${light + warm} ${light + Math.round(warm / 2)} ${light - 2})`
  })
  forEachPaver((outline, id) => {
    tracePath(context, outline)
    context.fillStyle = shades[id]
    context.fill()
    context.lineWidth = JOINT
    context.strokeStyle = '#857e72'
    context.stroke()
  })

  // Speckle: the grit in the concrete, and a little wear.
  const image = context.getImageData(0, 0, SIZE, SIZE)
  const speckle = createRandom(77)
  for (let i = 0; i < image.data.length; i += 4) {
    const grit = (speckle() - 0.5) * 22 + (speckle() < 0.01 ? -30 : 0)
    image.data[i] += grit
    image.data[i + 1] += grit
    image.data[i + 2] += grit
  }
  context.putImageData(image, 0, 0)
  return canvas
}

/** The height picture: pavers raised, joints sunk, edges rounded. Turned into a normal map below. */
function drawPaverHeight(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.fillStyle = '#000'
  context.fillRect(0, 0, SIZE, SIZE)
  context.filter = 'blur(2px)'
  forEachPaver((outline) => {
    tracePath(context, outline)
    context.fillStyle = '#fff'
    context.fill()
    context.lineWidth = JOINT + 2
    context.strokeStyle = '#000'
    context.stroke()
  })
  return canvas
}

/** A normal map from a height picture, wrapping at the edges so it repeats seamlessly. */
function heightToNormals(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const context = height.getContext('2d')
  const out = document.createElement('canvas')
  out.width = SIZE
  out.height = SIZE
  const outContext = out.getContext('2d')
  if (!context || !outContext) return out
  const source = context.getImageData(0, 0, SIZE, SIZE).data
  const target = outContext.createImageData(SIZE, SIZE)
  const h = (x: number, y: number) => source[(((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)) * 4] / 255
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      const length = Math.hypot(dx, dy, 1)
      const i = (y * SIZE + x) * 4
      target.data[i] = (-dx / length) * 127 + 128
      target.data[i + 1] = (dy / length) * 127 + 128
      target.data[i + 2] = (1 / length) * 127 + 128
      target.data[i + 3] = 255
    }
  }
  outContext.putImageData(target, 0, 0)
  return out
}

function toTexture(canvas: HTMLCanvasElement, colour: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1 / PAVER_TILE, 1 / PAVER_TILE)
  texture.anisotropy = 8
  texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return texture
}

/** The footpath's pavers: a colour picture and a normal map, repeating every PAVER_TILE metres. */
export function createPaverTextures(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  return {
    map: toTexture(drawPaverColour(), true),
    normalMap: toTexture(heightToNormals(drawPaverHeight(), 6), false),
  }
}

// ---------------------------------------------------------------------------
// The asphalt's marks: tar patch, crack, manhole and a newer patch, two across and two down.

const CELL = SIZE / 2

function blobPath(context: CanvasRenderingContext2D, cx: number, cy: number, radius: number, random: () => number, roughness: number) {
  const points = 28
  const wobble = Array.from({ length: 5 }, () => random() * Math.PI * 2)
  context.beginPath()
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2
    const r = radius * (1 - roughness + roughness * (0.6 + 0.25 * Math.sin(angle * 2 + wobble[0]) + 0.15 * Math.sin(angle * 5 + wobble[1]) + random() * 0.15))
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    if (i === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
}

function drawTar(context: CanvasRenderingContext2D, random: () => number) {
  context.save()
  context.shadowColor = 'rgba(16,16,18,0.6)'
  context.shadowBlur = 10
  context.fillStyle = 'rgba(20,20,23,0.92)'
  blobPath(context, CELL / 2, CELL / 2, CELL * 0.36, random, 0.55)
  context.fill()
  // Drips and splashes round the main patch.
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2
    const distance = CELL * (0.32 + random() * 0.1)
    blobPath(context, CELL / 2 + Math.cos(angle) * distance, CELL / 2 + Math.sin(angle) * distance, CELL * (0.03 + random() * 0.05), random, 0.4)
    context.fill()
  }
  context.restore()
}

function drawCrack(context: CanvasRenderingContext2D, random: () => number) {
  context.save()
  context.translate(CELL, 0)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  const branch = (x: number, y: number, angle: number, width: number, steps: number) => {
    context.beginPath()
    context.moveTo(x, y)
    for (let i = 0; i < steps; i++) {
      angle += (random() - 0.5) * 0.9
      x += Math.cos(angle) * 14
      y += Math.sin(angle) * 14
      if (x < 8 || y < 8 || x > CELL - 8 || y > CELL - 8) break
      context.lineTo(x, y)
      if (random() < 0.12 && width > 1.5) branch(x, y, angle + (random() < 0.5 ? 0.9 : -0.9), width * 0.6, Math.floor(steps / 2))
    }
    context.lineWidth = width * 3
    context.strokeStyle = 'rgba(25,25,28,0.25)'
    context.stroke()
    context.lineWidth = width
    context.strokeStyle = 'rgba(10,10,12,0.9)'
    context.stroke()
  }
  branch(CELL * 0.1, CELL * 0.5, 0, 4, 32)
  branch(CELL * 0.5, CELL * 0.5, -1.4, 3, 12)
  context.restore()
}

function drawManhole(context: CanvasRenderingContext2D, random: () => number) {
  context.save()
  context.translate(CELL / 2, CELL + CELL / 2)
  const r = CELL * 0.4
  // A ring of patched asphalt round the frame.
  context.fillStyle = 'rgba(40,40,44,0.6)'
  context.beginPath()
  context.arc(0, 0, r * 1.18, 0, Math.PI * 2)
  context.fill()
  // The frame and cover: cast iron, worn smooth where tyres cross it.
  context.fillStyle = '#3b3c40'
  context.beginPath()
  context.arc(0, 0, r, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#4b4c51'
  context.beginPath()
  context.arc(0, 0, r * 0.86, 0, Math.PI * 2)
  context.fill()
  // A raised grid pattern.
  context.strokeStyle = '#5b5c62'
  context.lineWidth = 6
  for (let k = -5; k <= 5; k++) {
    const offset = k * r * 0.16
    const span = Math.sqrt(Math.max(0, (r * 0.8) ** 2 - offset ** 2))
    context.beginPath()
    context.moveTo(offset, -span)
    context.lineTo(offset, span)
    context.moveTo(-span, offset)
    context.lineTo(span, offset)
    context.stroke()
  }
  context.strokeStyle = '#2c2d30'
  context.lineWidth = 5
  context.beginPath()
  context.arc(0, 0, r * 0.86, 0, Math.PI * 2)
  context.stroke()
  // Rust and grime.
  for (let i = 0; i < 40; i++) {
    const angle = random() * Math.PI * 2
    const distance = random() * r * 0.95
    context.fillStyle = random() < 0.5 ? 'rgba(110,60,30,0.25)' : 'rgba(20,20,20,0.3)'
    context.beginPath()
    context.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 3 + random() * 10, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function drawNewPatch(context: CanvasRenderingContext2D, random: () => number) {
  context.save()
  context.translate(CELL, CELL)
  context.shadowColor = 'rgba(30,30,34,0.5)'
  context.shadowBlur = 6
  context.fillStyle = 'rgba(44,45,50,0.88)'
  // A rough-edged rectangle, the shape a road crew cuts and fills.
  context.beginPath()
  const inset = 26
  const top = CELL * 0.22
  const bottom = CELL * 0.78
  const edge = (from: [number, number], to: [number, number]) => {
    for (let i = 1; i <= 10; i++) {
      const t = i / 10
      context.lineTo(from[0] + (to[0] - from[0]) * t + (random() - 0.5) * 8, from[1] + (to[1] - from[1]) * t + (random() - 0.5) * 8)
    }
  }
  context.moveTo(inset, top)
  edge([inset, top], [CELL - inset, top])
  edge([CELL - inset, top], [CELL - inset, bottom])
  edge([CELL - inset, bottom], [inset, bottom])
  edge([inset, bottom], [inset, top])
  context.fill()
  context.restore()
  // Grain in the fresh tar.
  const image = context.getImageData(CELL, CELL, CELL, CELL)
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] === 0) continue
    const grain = (random() - 0.5) * 14
    image.data[i] += grain
    image.data[i + 1] += grain
    image.data[i + 2] += grain
  }
  context.putImageData(image, CELL, CELL)
}

/** The four marks on the asphalt, in one picture shared by them all. See DECAL in streetEdgeGeometry.ts. */
export function createDecalAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (context) {
    const random = createRandom(1309)
    drawTar(context, random)
    drawCrack(context, random)
    drawManhole(context, random)
    drawNewPatch(context, random)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
