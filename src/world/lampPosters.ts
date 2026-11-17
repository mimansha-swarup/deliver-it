import * as THREE from 'three'

/*
 * The posters strapped to the lamp posts: ads for a quick-commerce grocery app and a
 * streetwear label, the two kinds of brand plastered over every pole in HSR. Both are made up
 * (ART_DIRECTION.md: no real brand appears), with no app-store badges. They're drawn here,
 * side by side in one picture, sun-faded at the top and streaked by rain, like the hoardings.
 */

export const POSTER_COLUMNS = 2
const WIDTH = 512
const HEIGHT = 768
const FONT = "'Baloo Tamma 2', 'Kannada Sangam MN', 'Noto Sans Kannada', sans-serif"

/** A spot in each poster's plain lower corner, its own background colour: for the board's edges. */
export const POSTER_CORNER_UV = 0.03

function drawGrocery(context: CanvasRenderingContext2D, x: number) {
  const green = '#0c6b3a'
  context.fillStyle = '#f8cb46'
  context.fillRect(x, 0, WIDTH, HEIGHT)
  // A basket, drawn simply: a green tray with handles and a few groceries showing.
  context.fillStyle = '#e8532b'
  context.beginPath()
  context.arc(x + 210, 205, 34, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#7cc04b'
  context.beginPath()
  context.ellipse(x + 290, 200, 30, 42, 0.4, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#ffffff'
  context.fillRect(x + 236, 160, 26, 60)
  context.fillStyle = green
  context.beginPath()
  context.moveTo(x + 150, 225)
  context.lineTo(x + 362, 225)
  context.lineTo(x + 336, 320)
  context.lineTo(x + 176, 320)
  context.closePath()
  context.fill()
  context.strokeStyle = green
  context.lineWidth = 12
  context.beginPath()
  context.arc(x + 256, 225, 92, Math.PI * 1.08, Math.PI * 1.92)
  context.stroke()

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = green
  context.font = `800 96px ${FONT}`
  context.fillText('tez', x + WIDTH / 2, 405)
  context.font = `800 62px ${FONT}`
  context.fillText('basket', x + WIDTH / 2, 478)
  context.font = `700 40px ${FONT}`
  context.fillStyle = '#1d1d1b'
  context.fillText('Groceries in 10 minutes', x + WIDTH / 2, 560, WIDTH - 60)
  context.font = `600 38px ${FONT}`
  context.fillText('ಹತ್ತು ನಿಮಿಷದಲ್ಲಿ ದಿನಸಿ', x + WIDTH / 2, 614, WIDTH - 60)
  // The band along the bottom.
  context.fillStyle = green
  context.fillRect(x, 670, WIDTH, 98)
  context.fillStyle = '#f8cb46'
  context.font = `700 34px ${FONT}`
  context.fillText('Free delivery on your first order', x + WIDTH / 2, 719, WIDTH - 50)
}

function drawStreetwear(context: CanvasRenderingContext2D, x: number) {
  context.fillStyle = '#111113'
  context.fillRect(x, 0, WIDTH, HEIGHT)
  // An oversized tee, flat on the page.
  context.fillStyle = '#e9e4d8'
  context.beginPath()
  context.moveTo(x + 196, 120)
  context.lineTo(x + 316, 120)
  context.lineTo(x + 400, 168)
  context.lineTo(x + 372, 236)
  context.lineTo(x + 340, 222)
  context.lineTo(x + 340, 372)
  context.lineTo(x + 172, 372)
  context.lineTo(x + 172, 222)
  context.lineTo(x + 140, 236)
  context.lineTo(x + 112, 168)
  context.closePath()
  context.fill()
  context.fillStyle = '#111113'
  context.beginPath()
  context.arc(x + 256, 120, 30, 0, Math.PI)
  context.fill()

  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#ffffff'
  context.font = `800 92px ${FONT}`
  context.fillText('DRIFT', x + WIDTH / 2, 460)
  context.font = `700 30px ${FONT}`
  context.fillStyle = '#c9c4b8'
  context.fillText('C  O  .', x + WIDTH / 2, 515)
  context.fillStyle = '#ffffff'
  context.font = `700 40px ${FONT}`
  context.fillText('NEW DROP · OVERSIZED TEES', x + WIDTH / 2, 585, WIDTH - 50)
  context.font = `600 36px ${FONT}`
  context.fillText('ಹೊಸ ಸಂಗ್ರಹ ಬಂದಿದೆ', x + WIDTH / 2, 636, WIDTH - 60)
  context.fillStyle = '#e8462a'
  context.fillRect(x + 126, 680, 260, 58)
  context.fillStyle = '#ffffff'
  context.font = `800 36px ${FONT}`
  context.fillText('FROM ₹599', x + WIDTH / 2, 710)
}

function paint(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  drawGrocery(context, 0)
  drawStreetwear(context, WIDTH)
  for (let column = 0; column < POSTER_COLUMNS; column++) {
    const x = column * WIDTH
    // Faded by the sun at the top, grimy at the bottom, and streaked by the rain.
    const fade = context.createLinearGradient(0, 0, 0, HEIGHT)
    fade.addColorStop(0, 'rgb(255 250 235 / 22%)')
    fade.addColorStop(0.55, 'rgb(255 250 235 / 0%)')
    fade.addColorStop(1, 'rgb(40 30 20 / 20%)')
    context.fillStyle = fade
    context.fillRect(x, 0, WIDTH, HEIGHT)
    for (let k = 0; k < 10; k++) {
      context.fillStyle = 'rgb(40 30 20 / 8%)'
      context.fillRect(x + ((k * 89 + column * 41) % WIDTH), 0, 3 + (k % 3) * 2, HEIGHT * (0.25 + ((k * 13) % 7) / 10))
    }
  }
}

/** Both posters, side by side. Painted again once the Kannada font has arrived. */
export function createPosterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * POSTER_COLUMNS
  canvas.height = HEIGHT
  paint(canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Keeps the writing sharp when the poster is seen at an angle.
  texture.anisotropy = 8
  document.fonts?.load(`700 40px ${FONT}`, 'ಹತ್ತು Aa').then(
    () => {
      paint(canvas)
      texture.needsUpdate = true
    },
    () => {},
  )
  return texture
}
