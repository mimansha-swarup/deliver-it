import * as THREE from 'three'

/*
 * The paper posters pasted on HSR's compound walls, drawn in code: tuition and
 * yoga classes, to-let notices, a film, a festival greeting, packers and movers.
 * One picture of 8, 4 across and 2 down. Every name, number and title is made
 * up, and there are no political parties or real people (ART_DIRECTION.md, and
 * the project's no-real-brands rule). Phone numbers use the 90000 range, which
 * isn't given out.
 */

export const POSTER_COLUMNS = 4
export const POSTER_ROWS = 2
const WIDTH = 256
const HEIGHT = 360

type Poster = {
  background: [string, string]
  lines: { text: string; size: number; color: string; weight?: number }[]
}

const POSTERS: Poster[] = [
  {
    background: ['#ffe14d', '#f7b500'],
    lines: [
      { text: 'ಟ್ಯೂಷನ್', size: 44, color: '#b0151b' },
      { text: 'TUITION', size: 46, color: '#1b1b8f', weight: 900 },
      { text: 'Maths · Science', size: 22, color: '#222' },
      { text: '1st – 10th Std', size: 24, color: '#222' },
      { text: 'Ph: 90000 41520', size: 22, color: '#b0151b' },
    ],
  },
  {
    background: ['#2b9a8c', '#11625a'],
    lines: [
      { text: 'ಯೋಗ', size: 50, color: '#fff3c4' },
      { text: 'YOGA CLASSES', size: 30, color: '#ffffff', weight: 900 },
      { text: 'Morning 6 – 7 am', size: 22, color: '#e8fff9' },
      { text: 'Community Hall', size: 22, color: '#e8fff9' },
      { text: '90000 77213', size: 24, color: '#fff3c4' },
    ],
  },
  {
    background: ['#ffffff', '#ececec'],
    lines: [
      { text: 'TO-LET', size: 62, color: '#c01818', weight: 900 },
      { text: '2 BHK · 1st Floor', size: 26, color: '#111' },
      { text: 'Family only', size: 22, color: '#111' },
      { text: 'ಬಾಡಿಗೆಗೆ ಮನೆ', size: 30, color: '#c01818' },
      { text: '90000 30485', size: 24, color: '#111' },
    ],
  },
  {
    background: ['#2b1240', '#c2401f'],
    lines: [
      { text: 'ಮಳೆಯ ಹಾಡು', size: 46, color: '#ffd23d' },
      { text: 'MALEYA HAADU', size: 30, color: '#ffffff', weight: 900 },
      { text: 'In theatres now', size: 22, color: '#ffe9c9' },
      { text: '★ ★ ★ ★', size: 26, color: '#ffd23d' },
      { text: 'Shows 11 · 3 · 7 · 10', size: 20, color: '#ffe9c9' },
    ],
  },
  {
    background: ['#ffb02e', '#e8541c'],
    lines: [
      { text: 'ರಾಜ್ಯೋತ್ಸವದ', size: 36, color: '#7a1010' },
      { text: 'ಶುಭಾಶಯಗಳು', size: 36, color: '#7a1010' },
      { text: 'Happy Rajyotsava', size: 26, color: '#ffffff', weight: 900 },
      { text: '1 November', size: 22, color: '#3a1405' },
      { text: '27th Main Residents', size: 18, color: '#3a1405' },
    ],
  },
  {
    background: ['#1d4fa3', '#0f2c5f'],
    lines: [
      { text: 'PACKERS &', size: 36, color: '#ffffff', weight: 900 },
      { text: 'MOVERS', size: 42, color: '#ffd23d', weight: 900 },
      { text: 'Home · Office · Bike', size: 20, color: '#dbe7ff' },
      { text: 'ಸುರಕ್ಷಿತ ಸಾಗಣೆ', size: 26, color: '#ffffff' },
      { text: '90000 58801', size: 26, color: '#ffd23d' },
    ],
  },
  {
    background: ['#e6f2ff', '#b9d6f2'],
    lines: [
      { text: 'WATER TANK', size: 34, color: '#0d4c8c', weight: 900 },
      { text: 'CLEANING', size: 40, color: '#0d4c8c', weight: 900 },
      { text: 'Sump · Overhead', size: 22, color: '#222' },
      { text: 'ಟ್ಯಾಂಕ್ ಸ್ವಚ್ಛತೆ', size: 26, color: '#0d4c8c' },
      { text: '90000 19364', size: 24, color: '#c01818' },
    ],
  },
  {
    background: ['#f7f1d8', '#e9dfb5'],
    lines: [
      { text: 'ಸಂಗೀತ ಕ್ಲಾಸ್', size: 34, color: '#6a1b4d' },
      { text: 'MUSIC CLASSES', size: 28, color: '#6a1b4d', weight: 900 },
      { text: 'Veena · Vocal · Keyboard', size: 18, color: '#333' },
      { text: 'Weekends', size: 22, color: '#333' },
      { text: '90000 66027', size: 24, color: '#6a1b4d' },
    ],
  },
]

function drawPoster(context: CanvasRenderingContext2D, poster: Poster, x: number, y: number) {
  const gradient = context.createLinearGradient(0, y, 0, y + HEIGHT)
  gradient.addColorStop(0, poster.background[0])
  gradient.addColorStop(1, poster.background[1])
  context.fillStyle = gradient
  context.fillRect(x + 4, y + 4, WIDTH - 8, HEIGHT - 8)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const gap = (HEIGHT - 40) / poster.lines.length
  poster.lines.forEach(({ text, size, color, weight = 700 }, index) => {
    context.fillStyle = color
    context.font = `${weight} ${size}px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(text, x + WIDTH / 2, y + 30 + gap * (index + 0.5), WIDTH - 24)
  })
  // Sun-faded and rain-stained, as posters on a wall get.
  const fade = context.createLinearGradient(0, y, 0, y + HEIGHT)
  fade.addColorStop(0, 'rgb(255 255 255 / 18%)')
  fade.addColorStop(0.6, 'rgb(255 255 255 / 4%)')
  fade.addColorStop(1, 'rgb(60 40 20 / 22%)')
  context.fillStyle = fade
  context.fillRect(x + 4, y + 4, WIDTH - 8, HEIGHT - 8)
}

function paint(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  POSTERS.forEach((poster, index) => drawPoster(context, poster, (index % POSTER_COLUMNS) * WIDTH, Math.floor(index / POSTER_COLUMNS) * HEIGHT))
}

export function createPosterAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH * POSTER_COLUMNS
  canvas.height = HEIGHT * POSTER_ROWS
  paint(canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  // Painted again once the Kannada font has arrived.
  document.fonts?.load(`700 40px 'Baloo Tamma 2'`).then(() => {
    paint(canvas)
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** The poster's shape on a wall: its width to height. */
export const POSTER_ASPECT = WIDTH / HEIGHT
