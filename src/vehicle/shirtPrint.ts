import * as THREE from 'three'

/** The T-shirt worn by the rider and the dark store's staff. */
export const SHIRT_COLOR = '#121316'
const SHIRT_PRINT = 'SILK'
const PRINT_COLOR = '#f4f3ef'
const PRINT_FONT = "900 210px Impact, 'Arial Black', Arial, sans-serif"
/** How narrow the letters get, and how far they lean. */
const PRINT_SQUEEZE = 0.86
const PRINT_SLANT = 0.24
const PRINT_MAX_WIDTH = 450

/** The letters on a see-through image, drawn in code. */
export function createPrintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = PRINT_COLOR
    context.font = PRINT_FONT
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // Squeezing the letters and leaning them forward is what gives the heavy, fast look.
    const width = context.measureText(SHIRT_PRINT).width * PRINT_SQUEEZE
    const fit = Math.min(1, PRINT_MAX_WIDTH / width)
    context.translate(256, 128)
    context.transform(PRINT_SQUEEZE * fit, 0, -PRINT_SLANT, fit, 0, 0)
    context.fillText(SHIRT_PRINT, 0, 8)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
