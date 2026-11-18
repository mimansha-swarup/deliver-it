import * as THREE from 'three'

/*
 * The rider's own branding: a marigold Deliver It jacket and delivery box,
 * matching the wordmark on the title and loading screens (index.css): marigold
 * with the name in heavy dark brown, tilted a little, over a chilli-red stroke.
 * The name is the game's own, made up, so no real brand appears.
 */

/** The wordmark's marigold (`--title-marigold`), as it looks on screen. */
export const BRAND_YELLOW = '#f6b32b'
/**
 * The dye of the jacket and the box: purer than the screen colour, with no blue
 * in it. From behind, the rider is lit mostly by the sky's fill, which greys a
 * muted yellow into tan; a pure yellow, as kerb paint is, still reads as the
 * logo's marigold under the same light. (The material is fixed, not the light:
 * ART_DIRECTION.md's golden rule.)
 */
export const BRAND_DYE = '#ffd200'
/** The dark brown of the name, and of the trim. */
export const BRAND_INK = '#2a1300'
const BRAND_CHILLI = '#e8462a'
const BRAND_NAME = 'Deliver It'
const BRAND_KANNADA = 'ಡೆಲಿವರ್ ಇಟ್'
/** The wordmark's font, which the page loads. Until it arrives, a heavy system font stands in. */
const FONT = "'Baloo Tamma 2', 'Arial Black', system-ui, sans-serif"
/** The same tilt as the wordmark on the loading screen. */
const TILT = (-3 * Math.PI) / 180

type Mark = {
  /** Where the middle of the name goes, and how wide it may be, in pixels. */
  x: number
  y: number
  width: number
  /** Adds the name in Kannada underneath, as on the title screen. */
  kannada: boolean
}

/** Draws the wordmark: the name, the chilli stroke under it, and the Kannada if asked. */
function drawMark(context: CanvasRenderingContext2D, { x, y, width, kannada }: Mark) {
  context.save()
  context.translate(x, y)
  context.rotate(TILT)
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  let size = width * 0.3
  context.font = `800 ${size}px ${FONT}`
  size *= Math.min(1, width / context.measureText(BRAND_NAME).width)
  context.font = `800 ${size}px ${FONT}`

  // The chilli stroke, a little like a road swept under the name.
  context.strokeStyle = BRAND_CHILLI
  context.lineWidth = size * 0.12
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(-width * 0.44, size * 0.22)
  context.quadraticCurveTo(0, size * 0.1, width * 0.44, size * 0.16)
  context.stroke()

  context.fillStyle = BRAND_INK
  context.fillText(BRAND_NAME, 0, 0)
  if (kannada) {
    context.font = `700 ${size * 0.42}px ${FONT}`
    context.fillText(BRAND_KANNADA, 0, size * 0.72)
  }
  context.restore()
}

/**
 * Wear on a branded surface (ART_DIRECTION.md: nothing looks brand new): a
 * faint grime gradient toward the bottom and a few scuffs.
 */
function weather(context: CanvasRenderingContext2D, width: number, height: number) {
  const grime = context.createLinearGradient(0, 0, 0, height)
  grime.addColorStop(0, 'rgb(0 0 0 / 0%)')
  grime.addColorStop(0.7, 'rgb(40 25 10 / 6%)')
  grime.addColorStop(1, 'rgb(40 25 10 / 22%)')
  context.fillStyle = grime
  context.fillRect(0, 0, width, height)
  let seed = 7
  const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 18; i++) {
    context.fillStyle = `rgb(60 40 20 / ${4 + random() * 8}%)`
    context.beginPath()
    context.ellipse(random() * width, height * (0.4 + random() * 0.6), 4 + random() * 16, 2 + random() * 5, random() * 3, 0, Math.PI * 2)
    context.fill()
  }
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Draws now, and again once the wordmark's font has loaded, if it hadn't yet. */
function paintWithFont(canvas: HTMLCanvasElement, paint: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const texture = toTexture(canvas)
  const context = canvas.getContext('2d')
  if (!context) return texture
  paint(context)
  if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(`800 40px 'Baloo Tamma 2'`)) {
    document.fonts
      .load(`800 40px 'Baloo Tamma 2'`, BRAND_NAME + BRAND_KANNADA)
      .then(() => {
        context.clearRect(0, 0, canvas.width, canvas.height)
        paint(context)
        texture.needsUpdate = true
      })
      .catch(() => {})
  }
  return texture
}

/** The print across the back of the jacket, on a see-through picture. */
export function createJacketPrintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  return paintWithFont(canvas, (context) => drawMark(context, { x: 256, y: 150, width: 430, kannada: false }))
}

/**
 * The logo for the delivery box's sides and back, on a see-through picture laid
 * just off the box, which is dyed marigold itself. With grime and scuffs over
 * the box around it, so the panel has no edge of its own.
 */
export function createBoxLogoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  return paintWithFont(canvas, (context) => {
    drawMark(context, { x: 256, y: 270, width: 440, kannada: true })
    weather(context, 512, 512)
  })
}

/**
 * The small sticker on the back of the helmet: the wordmark on a marigold pill, as the riders
 * stick the company's decal on. On a see-through picture, laid on the shell (Rider.tsx).
 */
export function createHelmetDecalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  return paintWithFont(canvas, (context) => {
    context.fillStyle = BRAND_YELLOW
    context.beginPath()
    context.roundRect(6, 10, 244, 76, 34)
    context.fill()
    drawMark(context, { x: 128, y: 62, width: 200, kannada: false })
  })
}
