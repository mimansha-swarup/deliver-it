import * as THREE from 'three'
import { hashString } from './buildingData'

export type FacadeLook = 'house' | 'apartment' | 'stilts' | 'shopFloors' | 'shopfront' | 'office' | 'civic'

/** The real material under the paint. */
export type WallBase = 'plaster' | 'concrete' | 'brick'

/** A rectangle in the 128-unit square that each bay is drawn in: left, top, width, height. */
type Rect = [number, number, number, number]

type LookStyle = {
  base: WallBase
  /** Width of one repeat of the pattern, in metres. */
  bayWidth: number
  roughness: number
  /** Glass shouldn't pick up the bumps of a plaster wall. */
  bumpy: boolean
  /**
   * Paints one bay. Roofs read the bottom-left corner of this image, so that
   * corner must stay plain wall.
   */
  paint: (context: CanvasRenderingContext2D) => void
  /**
   * More ways of painting the same bay, for variety from one building to the next: other frames,
   * grilles, shutters and sunshades round the same opening (the glass stays where `glow` says, so
   * the night's lit windows fit every one). Each building uses one, picked by its own number
   * (Buildings.tsx); the first is `paint`. Left out: every building of this look is the same.
   */
  variants?: ((context: CanvasRenderingContext2D) => void)[]
  /** The part that lights up at night, then how much of it does, then its two colours. */
  glow: Rect
  litShare: number
  glowColors: [string, string]
}

/** Resolution of one window bay, in pixels. */
const FACADE_SIZE = 512
/** How pale the wall photo ends up, and how much of its staining survives. */
const PLASTER_BRIGHTNESS = 0.94
const PLASTER_CONTRAST = 0.75

/** How far the pattern of lit windows runs before it repeats. */
const WINDOW_PATTERN_BAYS = 5
const WINDOW_PATTERN_FLOORS = 4

const WARM_GLOW: [string, string] = ['#ffe9b0', '#ffc66e']
const COOL_GLOW: [string, string] = ['#f2f7ff', '#dbe9f5']

const FRAME = '#6f6d68'
const IRON = '#3f4144'

function fill(context: CanvasRenderingContext2D, color: string, [x, y, w, h]: Rect) {
  context.fillStyle = color
  context.fillRect(x, y, w, h)
}

/** Fills a rectangle with glass, lighter at the top where it catches the sky. */
function paintGlass(
  context: CanvasRenderingContext2D,
  [x, y, w, h]: Rect,
  top = '#70869a',
  bottom = '#2c3843',
) {
  const glass = context.createLinearGradient(0, y, 0, y + h)
  glass.addColorStop(0, top)
  glass.addColorStop(1, bottom)
  context.fillStyle = glass
  context.fillRect(x, y, w, h)
}

/** A slightly darker band where each floor meets the next. */
function paintFloorBand(context: CanvasRenderingContext2D) {
  fill(context, 'rgb(0 0 0 / 14%)', [0, 122, 128, 6])
}

/** A small window with an iron grille, as on most homes here. */
function paintHouse(context: CanvasRenderingContext2D) {
  paintFloorBand(context)

  // Grime that has run down from the sill, fading out.
  const grime = context.createLinearGradient(0, 96, 0, 122)
  grime.addColorStop(0, 'rgb(40 34 28 / 24%)')
  grime.addColorStop(1, 'rgb(40 34 28 / 0%)')
  context.fillStyle = grime
  context.fillRect(32, 96, 64, 26)

  fill(context, FRAME, [34, 26, 60, 66])
  paintGlass(context, [38, 30, 52, 58])
  fill(context, 'rgb(0 0 0 / 32%)', [38, 30, 52, 4])
  for (let x = 46; x < 90; x += 8) fill(context, IRON, [x, 30, 2, 58])

  // A sill with a shadow under it.
  fill(context, '#c4c2bb', [30, 92, 68, 4])
  fill(context, 'rgb(0 0 0 / 30%)', [30, 96, 68, 2])
}

/** The sill, its shadow, and the grime run down from it, as every house window has. */
function paintHouseSill(context: CanvasRenderingContext2D, sill = '#c4c2bb') {
  const grime = context.createLinearGradient(0, 96, 0, 122)
  grime.addColorStop(0, 'rgb(40 34 28 / 24%)')
  grime.addColorStop(1, 'rgb(40 34 28 / 0%)')
  context.fillStyle = grime
  context.fillRect(32, 96, 64, 26)
  fill(context, sill, [30, 92, 68, 4])
  fill(context, 'rgb(0 0 0 / 30%)', [30, 96, 68, 2])
}

/** A wooden window: a brown frame with a mullion, a horizontal-bar grille, and a concrete sunshade (chajja) over it. */
function paintHouseWooden(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  paintHouseSill(context, '#b9b2a4')
  fill(context, '#5d4030', [33, 25, 62, 68])
  paintGlass(context, [38, 30, 52, 58], '#667b8c', '#27323b')
  fill(context, '#5d4030', [62, 30, 4, 58])
  fill(context, 'rgb(0 0 0 / 32%)', [38, 30, 52, 4])
  for (let y = 40; y < 86; y += 10) fill(context, IRON, [38, y, 52, 2])
  // The sunshade: a pale slab over the window, and the shade it throws.
  fill(context, '#d9d6cd', [26, 15, 76, 7])
  fill(context, 'rgb(0 0 0 / 34%)', [26, 22, 76, 4])
}

/** A sliding aluminium window: a thin pale frame, two panes, a diamond grille, and a painted band round it. */
function paintHouseSliding(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  paintHouseSill(context, '#d2d0c8')
  // The painted surround, a shade darker than the wall whatever its colour.
  fill(context, 'rgb(0 0 0 / 13%)', [28, 20, 72, 78])
  fill(context, '#c9ccd0', [35, 27, 58, 64])
  paintGlass(context, [38, 30, 52, 58], '#7f97a8', '#33414c')
  fill(context, '#c9ccd0', [62, 30, 3, 58])
  fill(context, 'rgb(0 0 0 / 28%)', [38, 30, 52, 3])
  context.strokeStyle = IRON
  context.lineWidth = 1.2
  context.beginPath()
  for (let x = 38 - 58; x < 90; x += 13) {
    context.moveTo(Math.max(38, x), x < 38 ? 30 + (38 - x) : 30)
    context.lineTo(Math.min(90, x + 58), x + 58 > 90 ? 88 - (x + 58 - 90) : 88)
    context.moveTo(Math.min(90, x + 58), x + 58 > 90 ? 30 + (x + 58 - 90) : 30)
    context.lineTo(Math.max(38, x), x < 38 ? 88 - (38 - x) : 88)
  }
  context.stroke()
}

/** A shuttered window: green louvred shutters folded back either side of a plain opening with upright bars. */
function paintHouseShutters(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  paintHouseSill(context)
  fill(context, '#e4e1d8', [34, 26, 60, 66])
  paintGlass(context, [38, 30, 52, 58], '#5f7384', '#232d35')
  fill(context, 'rgb(0 0 0 / 34%)', [38, 30, 52, 4])
  for (let x = 48; x < 90; x += 11) fill(context, IRON, [x, 30, 2, 58])
  for (const x of [20, 94]) {
    fill(context, '#3f6650', [x, 27, 14, 64])
    for (let y = 31; y < 89; y += 5) fill(context, 'rgb(0 0 0 / 26%)', [x + 1, y, 12, 2])
  }
}

/** Flats with a deep band: the window under a continuous sunshade, with a pale spandrel panel below it. */
function paintApartmentBanded(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  fill(context, 'rgb(255 255 255 / 16%)', [0, 96, 128, 22])
  fill(context, '#dcd9d0', [0, 6, 128, 7])
  fill(context, 'rgb(0 0 0 / 32%)', [0, 13, 128, 4])
  fill(context, '#8a8d91', [20, 14, 88, 78])
  paintGlass(context, [24, 18, 80, 70], '#7890a2', '#2e3b46')
  for (const x of [50, 77]) fill(context, '#8a8d91', [x, 18, 3, 70])
  fill(context, 'rgb(0 0 0 / 30%)', [24, 18, 80, 4])
  for (let y = 30; y < 88; y += 11) fill(context, IRON, [24, y, 80, 1.6])
  fill(context, '#c9c7c0', [16, 92, 96, 4])
  fill(context, 'rgb(0 0 0 / 30%)', [16, 96, 96, 2])
}

/** Flats with dark-framed windows in a painted recess, and a box grille standing proud of each. */
function paintApartmentBoxGrille(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  fill(context, 'rgb(0 0 0 / 12%)', [12, 8, 104, 90])
  fill(context, '#3d3f43', [20, 14, 88, 78])
  paintGlass(context, [24, 18, 80, 70], '#6b8194', '#26313a')
  fill(context, '#3d3f43', [62, 18, 4, 70])
  fill(context, 'rgb(0 0 0 / 30%)', [24, 18, 80, 4])
  for (let x = 28; x < 104; x += 6) fill(context, '#2d2f32', [x, 18, 1.4, 70])
  for (const y of [18, 52, 86]) fill(context, '#2d2f32', [24, y, 80, 2])
  const grime = context.createLinearGradient(0, 96, 0, 122)
  grime.addColorStop(0, 'rgb(40 34 28 / 24%)')
  grime.addColorStop(1, 'rgb(40 34 28 / 0%)')
  context.fillStyle = grime
  context.fillRect(20, 96, 88, 26)
  fill(context, '#bdbbb4', [16, 92, 96, 4])
  fill(context, 'rgb(0 0 0 / 30%)', [16, 96, 96, 2])
}

/** Upstairs from a shop, plastered rather than tiled: two separate windows with sunshades. */
function paintShopFloorsPair(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  fill(context, '#6b6660', [12, 28, 104, 62])
  paintGlass(context, [16, 32, 96, 54], '#74899a', '#2b3741')
  // The pier between the two windows is wall again.
  fill(context, 'rgb(235 232 224)', [56, 26, 16, 66])
  fill(context, '#6b6660', [54, 28, 2, 62])
  fill(context, '#6b6660', [72, 28, 2, 62])
  for (let x = 22; x < 110; x += 9) if (x < 54 || x > 74) fill(context, IRON, [x, 32, 1.6, 54])
  fill(context, '#d6d3ca', [8, 18, 112, 7])
  fill(context, 'rgb(0 0 0 / 32%)', [8, 25, 112, 4])
  fill(context, 'rgb(0 0 0 / 28%)', [12, 90, 104, 3])
}

/** Upstairs from a shop behind dark glass: one long tinted window in a slim frame, as newer shop buildings have. */
function paintShopFloorsGlazed(context: CanvasRenderingContext2D) {
  paintFloorBand(context)
  fill(context, '#2f3338', [8, 24, 112, 70])
  paintGlass(context, [16, 32, 96, 54], '#8fa7b6', '#3c4c58')
  for (const x of [40, 64, 88]) fill(context, '#2f3338', [x, 28, 2, 62])
  fill(context, '#2f3338', [12, 58, 104, 2])
  fill(context, 'rgb(0 0 0 / 28%)', [8, 94, 112, 3])
}

/**
 * A wide window in each bay of a block of flats, from 0.9 m to 2.85 m above
 * its floor. The balconies out front are real shapes from the house kit (see
 * buildApartment), so nothing here is painted to look like one.
 */
function paintApartment(context: CanvasRenderingContext2D) {
  paintFloorBand(context)

  const grime = context.createLinearGradient(0, 96, 0, 122)
  grime.addColorStop(0, 'rgb(40 34 28 / 20%)')
  grime.addColorStop(1, 'rgb(40 34 28 / 0%)')
  context.fillStyle = grime
  context.fillRect(20, 96, 88, 26)

  fill(context, FRAME, [20, 14, 88, 78])
  paintGlass(context, [24, 18, 80, 70])
  fill(context, FRAME, [62, 18, 4, 70])
  fill(context, 'rgb(0 0 0 / 30%)', [24, 18, 80, 4])
  for (let x = 30; x < 104; x += 9) fill(context, IRON, [x, 18, 2, 70])

  fill(context, '#d8d6cf', [16, 92, 96, 4])
  fill(context, 'rgb(0 0 0 / 30%)', [16, 96, 96, 2])
}

/** The open parking level under a block of flats: pillars, shade and a tube light. */
function paintStilts(context: CanvasRenderingContext2D) {
  const shade = context.createLinearGradient(0, 14, 0, 128)
  shade.addColorStop(0, '#17181a')
  shade.addColorStop(1, '#303234')
  context.fillStyle = shade
  context.fillRect(18, 14, 110, 114)

  fill(context, 'rgb(0 0 0 / 30%)', [0, 14, 128, 3])
  fill(context, '#55585c', [58, 22, 44, 3])
}

/** Upstairs from a shop: wide windows in a wall of tiles. */
function paintShopFloors(context: CanvasRenderingContext2D) {
  for (let y = 12; y < 122; y += 22) fill(context, 'rgb(0 0 0 / 6%)', [0, y, 128, 2])
  paintFloorBand(context)

  fill(context, '#55565a', [12, 28, 104, 62])
  paintGlass(context, [16, 32, 96, 54])
  fill(context, '#55565a', [46, 32, 3, 54])
  fill(context, '#55565a', [79, 32, 3, 54])
  fill(context, 'rgb(0 0 0 / 28%)', [12, 90, 104, 3])
}

/** Two shops side by side at street level: one with a display window, one shuttered. */
function paintShopfront(context: CanvasRenderingContext2D) {
  fill(context, '#33383f', [0, 8, 128, 24])

  fill(context, '#2b2f33', [6, 36, 54, 92])
  paintGlass(context, [8, 38, 50, 90], '#b6cad6', '#46535c')

  fill(context, '#8d9196', [68, 36, 54, 92])
  for (let y = 38; y < 128; y += 5) fill(context, 'rgb(0 0 0 / 22%)', [68, y, 54, 2])
}

/** Glass from floor to ceiling, with a pale panel hiding each floor's edge. */
function paintOffice(context: CanvasRenderingContext2D) {
  paintGlass(context, [0, 0, 128, 104], '#c2d6e4', '#7d97aa')

  // A soft diagonal streak, as if the glass is reflecting a bright sky.
  context.fillStyle = 'rgb(255 255 255 / 12%)'
  context.beginPath()
  context.moveTo(30, 0)
  context.lineTo(70, 0)
  context.lineTo(26, 104)
  context.lineTo(0, 104)
  context.lineTo(0, 70)
  context.fill()

  fill(context, '#55606a', [0, 0, 3, 104])
  fill(context, '#55606a', [62, 0, 4, 104])
  fill(context, '#55606a', [125, 0, 3, 104])

  fill(context, 'rgb(0 0 0 / 22%)', [0, 104, 128, 2])
}

/** Long runs of windows under a concrete sunshade, above a painted band. */
function paintCivic(context: CanvasRenderingContext2D) {
  paintFloorBand(context)

  paintGlass(context, [0, 34, 128, 48], '#8a9dab', '#39454f')
  for (let x = 0; x < 128; x += 32) fill(context, '#eae7df', [x, 34, 5, 48])

  fill(context, '#dedbd2', [0, 24, 128, 7])
  fill(context, 'rgb(0 0 0 / 34%)', [0, 31, 128, 5])
  fill(context, '#a8432f', [0, 98, 128, 12])
}

export const FACADE_LOOKS: Record<FacadeLook, LookStyle> = {
  house: {
    base: 'plaster',
    bayWidth: 3.4,
    roughness: 0.9,
    bumpy: true,
    paint: paintHouse,
    variants: [paintHouse, paintHouseWooden, paintHouseSliding, paintHouseShutters],
    glow: [38, 30, 52, 58],
    litShare: 0.45,
    glowColors: WARM_GLOW,
  },
  apartment: {
    base: 'concrete',
    bayWidth: 3.8,
    roughness: 0.85,
    bumpy: true,
    paint: paintApartment,
    variants: [paintApartment, paintApartmentBanded, paintApartmentBoxGrille],
    glow: [24, 18, 80, 70],
    litShare: 0.5,
    glowColors: WARM_GLOW,
  },
  stilts: {
    base: 'concrete',
    bayWidth: 6,
    roughness: 0.95,
    bumpy: true,
    paint: paintStilts,
    glow: [58, 22, 44, 3],
    litShare: 0.7,
    glowColors: COOL_GLOW,
  },
  shopFloors: {
    base: 'brick',
    bayWidth: 4.5,
    roughness: 0.6,
    bumpy: false,
    paint: paintShopFloors,
    variants: [paintShopFloors, paintShopFloorsPair, paintShopFloorsGlazed],
    glow: [16, 32, 96, 54],
    litShare: 0.55,
    glowColors: COOL_GLOW,
  },
  shopfront: {
    base: 'concrete',
    bayWidth: 9,
    roughness: 0.7,
    bumpy: false,
    paint: paintShopfront,
    glow: [8, 38, 50, 90],
    litShare: 0.85,
    glowColors: WARM_GLOW,
  },
  office: {
    base: 'concrete',
    bayWidth: 3,
    roughness: 0.3,
    bumpy: false,
    paint: paintOffice,
    glow: [6, 6, 116, 92],
    litShare: 0.55,
    glowColors: COOL_GLOW,
  },
  civic: {
    base: 'concrete',
    bayWidth: 4,
    roughness: 0.9,
    bumpy: true,
    paint: paintCivic,
    glow: [6, 36, 116, 44],
    litShare: 0.25,
    glowColors: COOL_GLOW,
  },
}

/**
 * Strips the colour from a wall photo and lifts it close to white, keeping only
 * its stains, patches and joints. That way, each building's own paint shows through.
 */
function createPlasterCanvas(photo: CanvasImageSource, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const context = canvas.getContext('2d')
  if (!context) return canvas

  context.drawImage(photo, 0, 0, size, size)
  const image = context.getImageData(0, 0, size, size)
  const { data } = image

  let total = 0
  for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2]
  const average = total / (data.length / 4)

  for (let i = 0; i < data.length; i += 4) {
    const shade = (data[i] + data[i + 1] + data[i + 2]) / average
    const value = Math.min(255, 255 * (PLASTER_BRIGHTNESS + (shade - 1) * PLASTER_CONTRAST))
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  context.putImageData(image, 0, 0)
  return canvas
}

/**
 * One bay, drawn in code over the plaster. The wall stays pale, so the building's
 * own colour shows through, and every wall repeats this image.
 */
function createFacadeTexture(plaster: HTMLCanvasElement, style: LookStyle): THREE.CanvasTexture {
  // The variants are stacked up the image, the first at the bottom: the wall's shader reads the one
  // each building asks for (Buildings.tsx's `addWindowVariants`).
  const paints = style.variants ?? [style.paint]
  const canvas = document.createElement('canvas')
  canvas.width = plaster.width
  canvas.height = plaster.height * paints.length

  const context = canvas.getContext('2d')
  if (context) {
    paints.forEach((paint, variant) => {
      context.save()
      context.translate(0, (paints.length - 1 - variant) * plaster.height)
      context.drawImage(plaster, 0, 0)
      /** All the paint functions work in a 128-unit square, so they don't depend on size. */
      context.scale(plaster.width / 128, plaster.height / 128)
      paint(context)
      context.restore()
    })
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * Which windows are lit at night. It covers several bays and floors before it
 * repeats, so that not every window is on. Black parts don't glow at all.
 */
function createLightTexture({ glow, glowColors, litShare }: LookStyle): THREE.CanvasTexture {
  const bay = 64
  const canvas = document.createElement('canvas')
  canvas.width = bay * WINDOW_PATTERN_BAYS
  canvas.height = bay * WINDOW_PATTERN_FLOORS

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#000000'
    context.fillRect(0, 0, canvas.width, canvas.height)

    /** The bay is drawn at half size here, so the facade's measurements are halved. */
    const [left, top, width, height] = glow.map((value) => value / 2)

    for (let column = 0; column < WINDOW_PATTERN_BAYS; column++) {
      for (let row = 0; row < WINDOW_PATTERN_FLOORS; row++) {
        // Hashed twice, as one hash barely changes when only the last character does.
        const roll = hashString(String(hashString(`${column},${row}`))) / 4294967296
        if (roll > litShare) continue

        context.fillStyle = roll < litShare / 3 ? glowColors[0] : glowColors[1]
        context.fillRect(column * bay + left, row * bay + top, width, height)
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.repeat.set(1 / WINDOW_PATTERN_BAYS, 1 / WINDOW_PATTERN_FLOORS)
  return texture
}

export type FacadeTextures = { facade: THREE.CanvasTexture; lights: THREE.CanvasTexture }

/** Makes the day and night textures for every look. */
export function createFacadeTextures(
  photos: Record<WallBase, CanvasImageSource>,
): Record<FacadeLook, FacadeTextures> {
  const canvases = {
    plaster: createPlasterCanvas(photos.plaster, FACADE_SIZE),
    concrete: createPlasterCanvas(photos.concrete, FACADE_SIZE),
    brick: createPlasterCanvas(photos.brick, FACADE_SIZE),
  }
  const entries = Object.entries(FACADE_LOOKS).map(([look, style]) => [
    look,
    { facade: createFacadeTexture(canvases[style.base], style), lights: createLightTexture(style) },
  ])
  return Object.fromEntries(entries) as Record<FacadeLook, FacadeTextures>
}
