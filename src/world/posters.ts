import * as THREE from 'three'

/*
 * The paper posters pasted on HSR's compound walls, drawn in code: tuition and
 * yoga classes, to-let notices, a film, a festival greeting, packers and movers,
 * a tuition centre's toppers with their photos, a lost dog, a ward election
 * poster and a PG room for rent. One picture of 12, 4 across and 3 down. Every
 * name, number, title, face and party is made up: the election poster's party
 * and candidate don't exist, and its symbol isn't any real party's
 * (ART_DIRECTION.md, and the project's no-real-brands rule). Phone numbers use
 * the 90000 range, which isn't given out.
 */

export const POSTER_COLUMNS = 4
export const POSTER_ROWS = 3
export const POSTER_COUNT = POSTER_COLUMNS * POSTER_ROWS
const WIDTH = 256
const HEIGHT = 360

type Poster = {
  background: [string, string]
  lines: { text: string; size: number; color: string; weight?: number }[]
  /** Pictures drawn under the text: faces in a row, one face, or a dog, between `top` and `bottom` (0 to 1 down the poster). */
  picture?: { kind: 'faces' | 'face' | 'dog' | 'symbol'; top: number; bottom: number; count?: number }
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
  {
    background: ['#fff7e0', '#ffe2a8'],
    picture: { kind: 'faces', top: 0.36, bottom: 0.62, count: 3 },
    lines: [
      { text: 'VIDYA TUTORIALS', size: 28, color: '#0d3c8c', weight: 900 },
      { text: 'Our SSLC Toppers', size: 22, color: '#b0151b' },
      { text: '', size: 10, color: '#000' },
      { text: '', size: 10, color: '#000' },
      { text: '98% · 97% · 96%', size: 22, color: '#0d3c8c', weight: 900 },
      { text: 'Admissions open · 90000 24410', size: 16, color: '#222' },
    ],
  },
  {
    background: ['#ffffff', '#f2f2f2'],
    picture: { kind: 'dog', top: 0.26, bottom: 0.6 },
    lines: [
      { text: 'LOST DOG', size: 46, color: '#c01818', weight: 900 },
      { text: '', size: 10, color: '#000' },
      { text: '', size: 10, color: '#000' },
      { text: '"Bruno" · brown, friendly', size: 20, color: '#111' },
      { text: 'Reward! 90000 81172', size: 24, color: '#c01818', weight: 900 },
    ],
  },
  {
    background: ['#f4f9ef', '#cfe8c0'],
    picture: { kind: 'face', top: 0.2, bottom: 0.52 },
    lines: [
      { text: 'Ward 174 · Vote for', size: 20, color: '#1d5c22' },
      { text: '', size: 10, color: '#000' },
      { text: '', size: 10, color: '#000' },
      { text: 'Shri K. Manjunatha', size: 28, color: '#1d5c22', weight: 900 },
      { text: 'Namma Nagara Paksha', size: 20, color: '#7a4a10' },
      { text: 'ಮತ ನೀಡಿ · Symbol: Street Lamp', size: 18, color: '#1d5c22' },
    ],
  },
  {
    background: ['#e9f4ff', '#c4dcf5'],
    lines: [
      { text: 'PG FOR GENTS', size: 34, color: '#0d3c8c', weight: 900 },
      { text: 'Room for rent', size: 26, color: '#c01818' },
      { text: 'Food · Wi-Fi · Washing', size: 20, color: '#222' },
      { text: 'Near 27th Main', size: 22, color: '#222' },
      { text: 'ಬಾಡಿಗೆಗೆ ಕೊಠಡಿ', size: 26, color: '#0d3c8c' },
      { text: '90000 47705', size: 24, color: '#c01818' },
    ],
  },
]

const SKIN = ['#8d5a3c', '#a86f4c', '#6e4630', '#b9825d']

/** A passport-style photo: a face with dark hair on shoulders, in a pale frame. */
function drawFace(context: CanvasRenderingContext2D, cx: number, cy: number, size: number, seed: number) {
  context.fillStyle = '#f3f3f3'
  context.fillRect(cx - size * 0.55, cy - size * 0.7, size * 1.1, size * 1.4)
  context.fillStyle = seed % 2 ? '#2f5d9a' : '#ffffff'
  context.beginPath()
  context.ellipse(cx, cy + size * 0.62, size * 0.5, size * 0.3, 0, Math.PI, 0)
  context.fill()
  context.fillStyle = SKIN[seed % SKIN.length]
  context.beginPath()
  context.ellipse(cx, cy, size * 0.27, size * 0.34, 0, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#1b1410'
  context.beginPath()
  context.ellipse(cx, cy - size * 0.2, size * 0.29, size * 0.18, 0, Math.PI, 0)
  context.fill()
}

function drawPicture(context: CanvasRenderingContext2D, picture: NonNullable<Poster['picture']>, x: number, y: number) {
  const top = y + HEIGHT * picture.top
  const height = HEIGHT * (picture.bottom - picture.top)
  const middle = top + height / 2
  if (picture.kind === 'faces') {
    const count = picture.count ?? 3
    for (let i = 0; i < count; i++) drawFace(context, x + (WIDTH * (i + 0.5)) / count, middle, height * 0.62, i + 1)
  } else if (picture.kind === 'face') {
    drawFace(context, x + WIDTH * 0.38, middle, height * 0.75, 2)
    // The made-up party's symbol beside the photo: a street lamp in a circle (no real party's).
    const sx = x + WIDTH * 0.75
    context.strokeStyle = '#1d5c22'
    context.lineWidth = 4
    context.beginPath()
    context.arc(sx, middle, 34, 0, Math.PI * 2)
    context.stroke()
    context.beginPath()
    context.moveTo(sx - 6, middle + 24)
    context.lineTo(sx - 6, middle - 18)
    context.lineTo(sx + 14, middle - 18)
    context.stroke()
    context.fillStyle = '#e8b52a'
    context.beginPath()
    context.ellipse(sx + 14, middle - 12, 8, 5, 0, 0, Math.PI * 2)
    context.fill()
  } else if (picture.kind === 'dog') {
    // A friendly brown dog, side on.
    const cx = x + WIDTH / 2
    context.fillStyle = '#8a5a2b'
    context.beginPath()
    context.ellipse(cx, middle + 6, 62, 28, 0, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    context.ellipse(cx + 66, middle - 22, 26, 22, 0, 0, Math.PI * 2)
    context.fill()
    context.fillRect(cx + 78, middle - 24, 30, 14)
    for (const dx of [-44, -22, 26, 46]) context.fillRect(cx + dx, middle + 20, 10, 34)
    context.fillStyle = '#5c3a18'
    context.beginPath()
    context.ellipse(cx + 54, middle - 38, 9, 16, -0.4, 0, Math.PI * 2)
    context.fill()
    context.strokeStyle = '#8a5a2b'
    context.lineWidth = 8
    context.beginPath()
    context.moveTo(cx - 60, middle)
    context.quadraticCurveTo(cx - 92, middle - 20, cx - 84, middle - 44)
    context.stroke()
    context.fillStyle = '#c01818'
    context.fillRect(cx + 48, middle - 6, 22, 6)
  }
}

function drawPoster(context: CanvasRenderingContext2D, poster: Poster, x: number, y: number) {
  const gradient = context.createLinearGradient(0, y, 0, y + HEIGHT)
  gradient.addColorStop(0, poster.background[0])
  gradient.addColorStop(1, poster.background[1])
  context.fillStyle = gradient
  context.fillRect(x + 4, y + 4, WIDTH - 8, HEIGHT - 8)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  if (poster.picture) drawPicture(context, poster.picture, x, y)
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
