import type { ShopType } from './signboards'

/*
 * Simple product picture cards for the back walls of shops (the 3D rooms in
 * ShopFronts.tsx): each card a little framed picture of one thing the shop
 * sells, drawn in code, in rows on shelves, so a shop reads as what it is from
 * the road. All products are generic: no brand, logo or real packaging.
 */

type Context = CanvasRenderingContext2D
type Box = { x: number; y: number; w: number; h: number }
/** Draws one product inside a card's picture area. `tone` (0 to 1) varies its colours. */
type Painter = (c: Context, box: Box, tone: number) => void

const GOLD = '#e2b443'
const GOLD_DARK = '#a8781e'
const STEEL = '#c9ccd0'
const PACK_COLORS = ['#e8352b', '#f6c21c', '#2a7fc2', '#2fa34a', '#f07a1a', '#b23aa8', '#14a3a3']

function pick<T>(list: T[], tone: number): T {
  return list[Math.floor(tone * list.length * 0.999)]
}

function round(c: Context, x: number, y: number, w: number, h: number, r: number, fill: string) {
  c.fillStyle = fill
  c.beginPath()
  c.roundRect(x, y, w, h, r)
  c.fill()
}

function disc(c: Context, x: number, y: number, rx: number, ry: number, fill: string) {
  c.fillStyle = fill
  c.beginPath()
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  c.fill()
}

function line(c: Context, points: [number, number][], width: number, stroke: string) {
  c.strokeStyle = stroke
  c.lineWidth = width
  c.lineCap = 'round'
  c.beginPath()
  points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)))
  c.stroke()
}

// ---- Jewellery ----

const necklace: Painter = (c, { x, y, w, h }) => {
  const cx = x + w / 2
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI * (0.1 + 0.8 * (i / 14))
    disc(c, cx + Math.cos(a) * w * 0.36, y + h * 0.15 + Math.sin(a) * h * 0.5, w * 0.035, w * 0.035, GOLD)
  }
  disc(c, cx, y + h * 0.78, w * 0.08, h * 0.1, '#c0182b')
  disc(c, cx, y + h * 0.78, w * 0.1, h * 0.12, GOLD_DARK)
  disc(c, cx, y + h * 0.78, w * 0.06, h * 0.075, '#d8213a')
}

const bangles: Painter = (c, { x, y, w, h }) => {
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = i % 2 ? GOLD : GOLD_DARK
    c.lineWidth = w * 0.05
    c.beginPath()
    c.ellipse(x + w / 2, y + h * (0.3 + i * 0.13), w * 0.32, h * 0.12, 0, 0, Math.PI * 2)
    c.stroke()
  }
}

const ring: Painter = (c, { x, y, w, h }) => {
  c.strokeStyle = GOLD
  c.lineWidth = w * 0.07
  c.beginPath()
  c.ellipse(x + w / 2, y + h * 0.6, w * 0.22, h * 0.22, 0, 0, Math.PI * 2)
  c.stroke()
  disc(c, x + w / 2, y + h * 0.33, w * 0.1, h * 0.1, '#bfe9ff')
}

const earrings: Painter = (c, { x, y, w, h }) => {
  for (const side of [0.33, 0.67]) {
    disc(c, x + w * side, y + h * 0.25, w * 0.05, w * 0.05, GOLD)
    c.fillStyle = GOLD
    c.beginPath()
    c.moveTo(x + w * (side - 0.12), y + h * 0.45)
    c.lineTo(x + w * (side + 0.12), y + h * 0.45)
    c.lineTo(x + w * side, y + h * 0.85)
    c.closePath()
    c.fill()
    disc(c, x + w * side, y + h * 0.55, w * 0.04, w * 0.04, '#2f9e6a')
  }
}

// ---- Phones ----

const phone: Painter = (c, { x, y, w, h }, tone) => {
  const pw = w * 0.42
  const ph = h * 0.82
  const px = x + (w - pw) / 2
  const py = y + (h - ph) / 2
  round(c, px, py, pw, ph, pw * 0.15, '#1b1c1f')
  const screen = c.createLinearGradient(px, py, px + pw, py + ph)
  screen.addColorStop(0, pick(['#3a7bd5', '#e8536b', '#2fb38a', '#8a5be6'], tone))
  screen.addColorStop(1, pick(['#11285a', '#5a1030', '#0d4a3a', '#2a1660'], tone))
  round(c, px + pw * 0.08, py + ph * 0.06, pw * 0.84, ph * 0.88, pw * 0.1, '#000')
  c.fillStyle = screen
  c.fillRect(px + pw * 0.1, py + ph * 0.08, pw * 0.8, ph * 0.84)
  for (let i = 0; i < 6; i++) round(c, px + pw * (0.18 + (i % 3) * 0.24), py + ph * (0.2 + Math.floor(i / 3) * 0.16), pw * 0.16, pw * 0.16, 3, 'rgb(255 255 255 / 70%)')
}

const earphones: Painter = (c, { x, y, w, h }) => {
  line(c, [[x + w * 0.3, y + h * 0.3], [x + w * 0.4, y + h * 0.7], [x + w * 0.5, y + h * 0.85], [x + w * 0.6, y + h * 0.7], [x + w * 0.7, y + h * 0.3]], w * 0.03, '#f2f2f2')
  disc(c, x + w * 0.3, y + h * 0.25, w * 0.08, h * 0.09, '#f7f7f7')
  disc(c, x + w * 0.7, y + h * 0.25, w * 0.08, h * 0.09, '#f7f7f7')
}

const charger: Painter = (c, { x, y, w, h }) => {
  round(c, x + w * 0.3, y + h * 0.2, w * 0.4, h * 0.35, 6, '#f2f2f2')
  c.fillStyle = '#9a9a9a'
  c.fillRect(x + w * 0.38, y + h * 0.1, w * 0.06, h * 0.1)
  c.fillRect(x + w * 0.56, y + h * 0.1, w * 0.06, h * 0.1)
  line(c, [[x + w * 0.5, y + h * 0.55], [x + w * 0.5, y + h * 0.7], [x + w * 0.3, y + h * 0.85], [x + w * 0.7, y + h * 0.9]], w * 0.03, '#e6e6e6')
}

const powerBank: Painter = (c, { x, y, w, h }, tone) => {
  round(c, x + w * 0.22, y + h * 0.2, w * 0.56, h * 0.62, 8, pick(['#2b2f33', '#3a6fd8', '#e85d2a', '#f0f0f0'], tone))
  for (let i = 0; i < 4; i++) disc(c, x + w * (0.38 + i * 0.08), y + h * 0.7, w * 0.025, w * 0.025, '#5dfc9a')
}

// ---- Hardware ----

const hammer: Painter = (c, { x, y, w, h }) => {
  line(c, [[x + w * 0.3, y + h * 0.85], [x + w * 0.62, y + h * 0.3]], w * 0.08, '#b9804a')
  c.save()
  c.translate(x + w * 0.62, y + h * 0.3)
  c.rotate(-1.05)
  round(c, -w * 0.22, -h * 0.07, w * 0.44, h * 0.14, 3, '#4a4d52')
  c.restore()
}

const spanner: Painter = (c, { x, y, w, h }) => {
  line(c, [[x + w * 0.25, y + h * 0.8], [x + w * 0.7, y + h * 0.3]], w * 0.08, '#b6bac0')
  disc(c, x + w * 0.73, y + h * 0.27, w * 0.12, w * 0.12, '#b6bac0')
  disc(c, x + w * 0.78, y + h * 0.2, w * 0.06, w * 0.06, '#f4efe2')
  disc(c, x + w * 0.23, y + h * 0.82, w * 0.08, w * 0.08, '#b6bac0')
}

const paintTin: Painter = (c, { x, y, w, h }, tone) => {
  round(c, x + w * 0.25, y + h * 0.22, w * 0.5, h * 0.65, 4, '#d9d9d9')
  c.fillStyle = pick(['#e8352b', '#2a7fc2', '#2fa34a', '#f6c21c', '#f07a1a'], tone)
  c.fillRect(x + w * 0.25, y + h * 0.38, w * 0.5, h * 0.3)
  disc(c, x + w / 2, y + h * 0.22, w * 0.25, h * 0.05, '#bdbdbd')
  c.strokeStyle = '#7a7a7a'
  c.lineWidth = 2
  c.beginPath()
  c.arc(x + w / 2, y + h * 0.22, w * 0.22, Math.PI, 0)
  c.stroke()
}

const tap: Painter = (c, { x, y, w, h }) => {
  line(c, [[x + w * 0.25, y + h * 0.5], [x + w * 0.65, y + h * 0.5], [x + w * 0.65, y + h * 0.72]], w * 0.09, STEEL)
  round(c, x + w * 0.35, y + h * 0.28, w * 0.2, h * 0.14, 3, '#9ea3a8')
  disc(c, x + w * 0.65, y + h * 0.8, w * 0.03, h * 0.04, '#7fc8ff')
}

const padlock: Painter = (c, { x, y, w, h }) => {
  c.strokeStyle = '#a7abb0'
  c.lineWidth = w * 0.07
  c.beginPath()
  c.arc(x + w / 2, y + h * 0.42, w * 0.16, Math.PI, 0)
  c.stroke()
  round(c, x + w * 0.28, y + h * 0.42, w * 0.44, h * 0.42, 5, '#c7a03a')
  disc(c, x + w / 2, y + h * 0.6, w * 0.04, w * 0.04, '#3a3a3a')
}

const screwdriver: Painter = (c, { x, y, w, h }) => {
  line(c, [[x + w * 0.5, y + h * 0.15], [x + w * 0.5, y + h * 0.55]], w * 0.04, STEEL)
  round(c, x + w * 0.4, y + h * 0.55, w * 0.2, h * 0.32, 6, '#e8352b')
}

// ---- Darshini food ----

const plate = (c: Context, { x, y, w, h }: Box) => disc(c, x + w / 2, y + h * 0.62, w * 0.42, h * 0.24, '#f3f1ea')

const dosa: Painter = (c, box) => {
  const { x, y, w, h } = box
  plate(c, box)
  c.fillStyle = '#d9962f'
  c.beginPath()
  c.moveTo(x + w * 0.12, y + h * 0.66)
  c.lineTo(x + w * 0.88, y + h * 0.58)
  c.lineTo(x + w * 0.82, y + h * 0.7)
  c.closePath()
  c.fill()
  disc(c, x + w * 0.3, y + h * 0.42, w * 0.08, h * 0.06, '#f0efe6')
  disc(c, x + w * 0.5, y + h * 0.4, w * 0.08, h * 0.06, '#c9452a')
  disc(c, x + w * 0.7, y + h * 0.42, w * 0.08, h * 0.06, '#e1a73b')
}

const idli: Painter = (c, box) => {
  const { x, y, w, h } = box
  plate(c, box)
  for (const [dx, dy] of [[0.36, 0.58], [0.6, 0.6], [0.48, 0.5]]) disc(c, x + w * dx, y + h * dy, w * 0.13, h * 0.08, '#fbfaf3')
  disc(c, x + w * 0.76, y + h * 0.66, w * 0.07, h * 0.05, '#c9452a')
}

const vada: Painter = (c, box) => {
  const { x, y, w, h } = box
  plate(c, box)
  for (const dx of [0.36, 0.62]) {
    disc(c, x + w * dx, y + h * 0.58, w * 0.14, h * 0.1, '#a7581f')
    disc(c, x + w * dx, y + h * 0.58, w * 0.04, h * 0.03, '#f3f1ea')
  }
}

const coffee: Painter = (c, { x, y, w, h }) => {
  disc(c, x + w / 2, y + h * 0.8, w * 0.3, h * 0.07, STEEL)
  round(c, x + w * 0.36, y + h * 0.3, w * 0.28, h * 0.48, 4, STEEL)
  disc(c, x + w / 2, y + h * 0.3, w * 0.14, h * 0.04, '#c99a6a')
  line(c, [[x + w * 0.46, y + h * 0.22], [x + w * 0.52, y + h * 0.12]], 2, 'rgb(255 255 255 / 60%)')
}

const meals: Painter = (c, { x, y, w, h }) => {
  disc(c, x + w / 2, y + h * 0.58, w * 0.44, h * 0.3, '#3f8f3a')
  disc(c, x + w / 2, y + h * 0.62, w * 0.18, h * 0.12, '#f7f3e6')
  const colors = ['#e1a73b', '#c9452a', '#6a9a3a', '#f0d36a', '#8a4a2c']
  colors.forEach((color, i) => {
    const a = Math.PI * (1.1 + i * 0.2)
    disc(c, x + w / 2 + Math.cos(a) * w * 0.28, y + h * 0.58 + Math.sin(a) * h * 0.18, w * 0.06, h * 0.045, color)
  })
}

// ---- Snacks ----

const chips: Painter = (c, { x, y, w, h }, tone) => {
  const color = pick(PACK_COLORS, tone)
  c.fillStyle = color
  c.beginPath()
  c.moveTo(x + w * 0.22, y + h * 0.12)
  c.lineTo(x + w * 0.78, y + h * 0.12)
  c.quadraticCurveTo(x + w * 0.86, y + h * 0.5, x + w * 0.78, y + h * 0.9)
  c.lineTo(x + w * 0.22, y + h * 0.9)
  c.quadraticCurveTo(x + w * 0.14, y + h * 0.5, x + w * 0.22, y + h * 0.12)
  c.fill()
  disc(c, x + w / 2, y + h * 0.42, w * 0.18, h * 0.12, '#fff3c0')
  disc(c, x + w * 0.45, y + h * 0.7, w * 0.12, h * 0.07, '#f3c54a')
  disc(c, x + w * 0.58, y + h * 0.72, w * 0.1, h * 0.06, '#e8b13a')
}

const biscuits: Painter = (c, { x, y, w, h }, tone) => {
  round(c, x + w * 0.12, y + h * 0.3, w * 0.76, h * 0.42, 5, pick(['#2a7fc2', '#e8352b', '#f6c21c', '#7a3f1a'], tone))
  for (let i = 0; i < 3; i++) disc(c, x + w * (0.32 + i * 0.18), y + h * 0.51, w * 0.08, h * 0.12, '#d79a4a')
}

const noodles: Painter = (c, { x, y, w, h }) => {
  round(c, x + w * 0.18, y + h * 0.25, w * 0.64, h * 0.5, 4, '#f6c21c')
  disc(c, x + w / 2, y + h * 0.52, w * 0.2, h * 0.14, '#fff3c0')
  for (let i = 0; i < 4; i++) line(c, [[x + w * 0.38, y + h * (0.46 + i * 0.03)], [x + w * 0.62, y + h * (0.48 + i * 0.03)]], 1.5, '#e8b13a')
}

const bottle: Painter = (c, { x, y, w, h }, tone) => {
  const liquid = pick(['#3a1a0e', '#f07a1a', '#2fa34a', '#e8352b'], tone)
  round(c, x + w * 0.38, y + h * 0.3, w * 0.24, h * 0.58, 6, liquid)
  round(c, x + w * 0.44, y + h * 0.12, w * 0.12, h * 0.2, 3, liquid)
  disc(c, x + w / 2, y + h * 0.11, w * 0.07, h * 0.03, '#d9262b')
  c.fillStyle = 'rgb(255 255 255 / 85%)'
  c.fillRect(x + w * 0.38, y + h * 0.5, w * 0.24, h * 0.14)
}

const chocolate: Painter = (c, { x, y, w, h }, tone) => {
  round(c, x + w * 0.15, y + h * 0.35, w * 0.7, h * 0.32, 3, pick(['#6b2fa0', '#c0182b', '#7a3f1a'], tone))
  c.fillStyle = '#f7e3b0'
  c.fillRect(x + w * 0.4, y + h * 0.35, w * 0.2, h * 0.32)
}

type CardWall = {
  wall: string
  floor: string
  card: string
  shelf: string
  painters: Painter[]
  rows: number
  columns: number
  /** A price under each picture, as on a darshini's menu board. */
  prices?: boolean
}

const SNACKS: Painter[] = [chips, biscuits, noodles, bottle, chips, chocolate, biscuits, chips]

const CARD_WALLS: Partial<Record<ShopType, CardWall>> = {
  jewellery: { wall: '#6e1a1a', floor: '#5a3a2a', card: '#3a0d10', shelf: '#c9a24a', painters: [necklace, bangles, ring, earrings], rows: 2, columns: 4 },
  mobiles: { wall: '#eef0f2', floor: '#c8c8c8', card: '#ffffff', shelf: '#2b2f33', painters: [phone, phone, earphones, charger, powerBank, phone], rows: 3, columns: 5 },
  electronics: { wall: '#e7ebef', floor: '#b8bec4', card: '#ffffff', shelf: '#6a6f75', painters: [phone, powerBank, earphones, charger], rows: 3, columns: 4 },
  hardware: { wall: '#b8bbbd', floor: '#77746f', card: '#f1efe9', shelf: '#5a5d61', painters: [hammer, spanner, paintTin, tap, padlock, screwdriver, paintTin], rows: 3, columns: 5 },
  darshini: { wall: '#f3efe4', floor: '#9c9a92', card: '#1f4d2b', shelf: '#1f4d2b', painters: [dosa, idli, vada, coffee, meals], rows: 2, columns: 5, prices: true },
  chats: { wall: '#f6e7c8', floor: '#9c8e78', card: '#7a1d1d', shelf: '#7a1d1d', painters: [chips, bottle, meals, vada], rows: 2, columns: 4, prices: true },
  kirana: { wall: '#e9e2cc', floor: '#b9ab92', card: '#fbf8ef', shelf: '#8a6a48', painters: SNACKS, rows: 4, columns: 6 },
  general: { wall: '#dfe7e0', floor: '#b0aa9a', card: '#fbf8ef', shelf: '#8a6a48', painters: SNACKS, rows: 4, columns: 6 },
  supermarket: { wall: '#f4f4f0', floor: '#d0cdc4', card: '#ffffff', shelf: '#9aa3ab', painters: SNACKS, rows: 4, columns: 7 },
}

const PRICES = ['₹40', '₹35', '₹30', '₹25', '₹60', '₹80', '₹20']

/**
 * Draws a back wall of product cards for a kind of shop, filling `box`, and
 * returns its wall and floor colours. Null if this kind has no card wall.
 */
export function drawCardWall(c: Context, type: ShopType, box: Box, seed: number): { wall: string; floor: string } | null {
  const style = CARD_WALLS[type]
  if (!style) return null
  const { x, y, w, h } = box
  c.fillStyle = style.wall
  c.fillRect(x, y, w, h)
  // A skirting along the floor, and the cards above a counter's height.
  c.fillStyle = 'rgb(0 0 0 / 18%)'
  c.fillRect(x, y + h * 0.95, w, h * 0.05)
  const top = y + h * 0.06
  const bottom = y + h * (style.prices ? 0.62 : 0.86)
  const rowHeight = (bottom - top) / style.rows
  const columnWidth = (w * 0.92) / style.columns
  const left = x + w * 0.04
  let n = seed
  for (let row = 0; row < style.rows; row++) {
    for (let column = 0; column < style.columns; column++) {
      n = (n * 9301 + 49297) % 233280
      const tone = n / 233280
      const painter = style.painters[(row * style.columns + column + seed) % style.painters.length]
      const cx = left + column * columnWidth + columnWidth * 0.06
      const cy = top + row * rowHeight + rowHeight * 0.06
      const cw = columnWidth * 0.88
      const ch = rowHeight * (style.prices ? 0.86 : 0.8)
      round(c, cx + 2, cy + 3, cw, ch, 6, 'rgb(0 0 0 / 22%)')
      round(c, cx, cy, cw, ch, 6, style.card)
      const pictureHeight = style.prices ? ch * 0.74 : ch
      painter(c, { x: cx + cw * 0.06, y: cy + pictureHeight * 0.05, w: cw * 0.88, h: pictureHeight * 0.9 }, tone)
      if (style.prices) {
        c.fillStyle = '#ffe9a8'
        c.font = `700 ${Math.round(ch * 0.17)}px 'Baloo Tamma 2', system-ui, sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText(PRICES[(row * style.columns + column) % PRICES.length], cx + cw / 2, cy + ch * 0.86)
      }
    }
    // The shelf under the row.
    if (!style.prices) {
      c.fillStyle = style.shelf
      c.fillRect(x, top + (row + 1) * rowHeight - 4, w, 4)
    }
  }
  return { wall: style.wall, floor: style.floor }
}
