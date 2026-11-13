import type { ShopType } from './signboards'

/**
 * The inside of an open shop, painted in perspective onto one flat picture that
 * fills the doorway: a back wall, side walls running back to it, a floor and a
 * ceiling, and the shop's goods. From the road it reads as a room behind the
 * shutter, for the cost of one quad.
 */

type Context = CanvasRenderingContext2D

/** The room, in the picture's own 0 to 1 coordinates. */
const BACK = { left: 0.24, right: 0.76, top: 0.24, bottom: 0.7 }
/** The rolled-up shutter, in its box along the top. */
const SHUTTER_BOX = 0.09

const PACKET_COLORS = ['#e8352b', '#f6c21c', '#2a7fc2', '#2fa34a', '#f07a1a', '#b23aa8', '#ffffff', '#d9262b', '#14a3a3']

/** A stable sequence of 0 to 1 numbers, so the shelves look the same every time. */
function sequence(seed: number) {
  let value = seed * 9301 + 49297
  return () => {
    value = (value * 9301 + 49297) % 233280
    return value / 233280
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

type Box = { x: number; y: number; w: number; h: number }

/** Walls, floor and ceiling, with a tube light. Returns the back wall's rectangle in pixels. */
function drawRoom(c: Context, box: Box, wall: string, floor: string): Box {
  const { x, y, w, h } = box
  const back = {
    x: x + w * BACK.left,
    y: y + h * BACK.top,
    w: w * (BACK.right - BACK.left),
    h: h * (BACK.bottom - BACK.top),
  }
  const top = y + h * SHUTTER_BOX

  const shape = (points: [number, number][], color: string) => {
    c.fillStyle = color
    c.beginPath()
    points.forEach(([px, py], index) => (index ? c.lineTo(px, py) : c.moveTo(px, py)))
    c.closePath()
    c.fill()
  }
  // Ceiling, floor, then the side walls a little darker than the back.
  shape([[x, top], [x + w, top], [back.x + back.w, back.y], [back.x, back.y]], shade(wall, 0.82))
  shape([[x, y + h], [x + w, y + h], [back.x + back.w, back.y + back.h], [back.x, back.y + back.h]], floor)
  shape([[x, top], [back.x, back.y], [back.x, back.y + back.h], [x, y + h]], shade(wall, 0.88))
  shape([[x + w, top], [back.x + back.w, back.y], [back.x + back.w, back.y + back.h], [x + w, y + h]], shade(wall, 0.88))
  c.fillStyle = wall
  c.fillRect(back.x, back.y, back.w, back.h)

  // Floor tiles, running back.
  c.strokeStyle = 'rgb(0 0 0 / 12%)'
  c.lineWidth = 1
  for (let line = 1; line < 6; line++) {
    const t = line / 6
    c.beginPath()
    c.moveTo(lerp(x, x + w, t), y + h)
    c.lineTo(lerp(back.x, back.x + back.w, t), back.y + back.h)
    c.stroke()
  }

  // A tube light across the ceiling.
  c.fillStyle = '#fbfdff'
  c.fillRect(back.x + back.w * 0.25, lerp(top, back.y, 0.55), back.w * 0.5, h * 0.018)
  return back
}

/** Mixes a colour towards black by `amount` (1 keeps it, 0 is black). */
function shade(color: string, amount: number): string {
  const value = parseInt(color.slice(1), 16)
  const r = Math.round(((value >> 16) & 255) * amount)
  const g = Math.round(((value >> 8) & 255) * amount)
  const b = Math.round((value & 255) * amount)
  return `rgb(${r} ${g} ${b})`
}

/** Shelves across a rectangle, filled with small packets of the given colours. */
function shelves(c: Context, area: Box, rows: number, colors: string[], seed: number, itemWidth = 0.05, fill = 0.85) {
  const random = sequence(seed)
  const rowHeight = area.h / rows
  for (let row = 0; row < rows; row++) {
    const shelfY = area.y + (row + 1) * rowHeight
    let left = area.x + 2
    while (left < area.x + area.w - 4) {
      const width = area.w * itemWidth * (0.6 + random() * 0.8)
      if (random() < fill) {
        const height = rowHeight * (0.45 + random() * 0.4)
        c.fillStyle = colors[Math.floor(random() * colors.length)]
        c.fillRect(left, shelfY - height - 2, Math.min(width - 2, area.x + area.w - left - 2), height)
      }
      left += width
    }
    c.fillStyle = '#8a6a48'
    c.fillRect(area.x, shelfY - 3, area.w, 3)
  }
}

/** Shelves up a side wall, drawn in strips so they follow the wall back into the room. */
function sideShelves(c: Context, box: Box, back: Box, side: -1 | 1, rows: number, colors: string[], seed: number) {
  const random = sequence(seed)
  const strips = 7
  for (let strip = 0; strip < strips; strip++) {
    const t0 = strip / strips
    const t1 = (strip + 0.8) / strips
    const outerX = side < 0 ? box.x : box.x + box.w
    const innerX = side < 0 ? back.x : back.x + back.w
    const x0 = lerp(outerX, innerX, t0)
    const x1 = lerp(outerX, innerX, t1)
    const top = lerp(box.y + box.h * 0.18, back.y + back.h * 0.05, (t0 + t1) / 2)
    const bottom = lerp(box.y + box.h * 0.92, back.y + back.h, (t0 + t1) / 2)
    const rowHeight = (bottom - top) / rows
    for (let row = 0; row < rows; row++) {
      if (random() < 0.15) continue
      c.fillStyle = colors[Math.floor(random() * colors.length)]
      const height = rowHeight * (0.5 + random() * 0.35)
      c.fillRect(Math.min(x0, x1), top + (row + 1) * rowHeight - height, Math.abs(x1 - x0), height)
    }
  }
}

/** A counter across the front of the shop. */
function counter(c: Context, box: Box, color: string, top = 0.72, inset = 0.1) {
  const left = box.x + box.w * inset
  const width = box.w * (1 - inset * 2)
  const y = box.y + box.h * top
  c.fillStyle = color
  c.fillRect(left, y, width, box.y + box.h - y)
  c.fillStyle = 'rgb(255 255 255 / 25%)'
  c.fillRect(left, y, width, box.h * 0.025)
  c.fillStyle = 'rgb(0 0 0 / 18%)'
  c.fillRect(left, y + box.h * 0.025, width, box.h * 0.01)
  return { x: left, y, w: width, h: box.y + box.h - y }
}

/** Snack packets on strips, hanging from the front of the ceiling, as every kirana has. */
function hangingStrips(c: Context, box: Box, seed: number, count = 9) {
  const random = sequence(seed)
  for (let strip = 0; strip < count; strip++) {
    const x = box.x + box.w * (0.04 + (strip / count) * 0.92)
    const length = 3 + Math.floor(random() * 4)
    const color = PACKET_COLORS[Math.floor(random() * PACKET_COLORS.length)]
    for (let packet = 0; packet < length; packet++) {
      c.fillStyle = color
      c.fillRect(x, box.y + box.h * (SHUTTER_BOX + 0.01 + packet * 0.055), box.w * 0.045, box.h * 0.048)
      c.fillStyle = 'rgb(255 255 255 / 35%)'
      c.fillRect(x + 2, box.y + box.h * (SHUTTER_BOX + 0.02 + packet * 0.055), box.w * 0.02, box.h * 0.01)
    }
  }
}

function circle(c: Context, x: number, y: number, radius: number, color: string) {
  c.fillStyle = color
  c.beginPath()
  c.arc(x, y, radius, 0, Math.PI * 2)
  c.fill()
}

/** A string of marigolds across the top, as on shop fronts after a festival. */
function garland(c: Context, box: Box) {
  for (let i = 0; i < 26; i++) {
    const t = i / 25
    const sag = Math.sin(t * Math.PI * 3) ** 2 * box.h * 0.035
    circle(c, box.x + box.w * t, box.y + box.h * (SHUTTER_BOX + 0.02) + sag, box.h * 0.018, i % 2 ? '#f39c12' : '#f7c600')
  }
}

/** The rolled-up shutter in its box, the dark frame round the doorway, and some dimming toward the back. */
function finish(c: Context, box: Box) {
  const { x, y, w, h } = box
  const depth = c.createLinearGradient(0, y + h * SHUTTER_BOX, 0, y + h)
  depth.addColorStop(0, 'rgb(0 0 0 / 10%)')
  depth.addColorStop(1, 'rgb(0 0 0 / 0%)')
  c.fillStyle = depth
  c.fillRect(x, y, w, h)

  c.fillStyle = '#7d8186'
  c.fillRect(x, y, w, h * SHUTTER_BOX)
  for (let rib = 0; rib < 5; rib++) {
    c.fillStyle = 'rgb(0 0 0 / 25%)'
    c.fillRect(x, y + h * SHUTTER_BOX * (rib / 5) + 2, w, 2)
  }
  c.fillStyle = '#2b2c2f'
  c.fillRect(x, y + h * SHUTTER_BOX - 5, w, 5)
  c.strokeStyle = '#3a3633'
  c.lineWidth = w * 0.025
  c.strokeRect(x, y, w, h)
}

const DRAW: Record<ShopType, (c: Context, box: Box, seed: number) => void> = {
  kirana: (c, box, seed) => {
    const back = drawRoom(c, box, '#e9e2cc', '#b9ab92')
    shelves(c, back, 4, PACKET_COLORS, seed)
    sideShelves(c, box, back, -1, 5, PACKET_COLORS, seed + 1)
    sideShelves(c, box, back, 1, 5, PACKET_COLORS, seed + 2)
    hangingStrips(c, box, seed + 3)
    // Rice sacks and a crate of tomatoes by the door.
    for (const at of [0.1, 0.2]) {
      c.fillStyle = '#e8dcbc'
      c.fillRect(box.x + box.w * at, box.y + box.h * 0.8, box.w * 0.09, box.h * 0.2)
      c.fillStyle = '#f5efe0'
      c.beginPath()
      c.ellipse(box.x + box.w * (at + 0.045), box.y + box.h * 0.8, box.w * 0.045, box.h * 0.025, 0, 0, Math.PI * 2)
      c.fill()
    }
    c.fillStyle = '#2f8a3a'
    c.fillRect(box.x + box.w * 0.72, box.y + box.h * 0.84, box.w * 0.16, box.h * 0.16)
    for (let i = 0; i < 6; i++) circle(c, box.x + box.w * (0.74 + i * 0.024), box.y + box.h * 0.84, box.h * 0.018, '#d9301e')
  },
  general: (c, box, seed) => {
    const back = drawRoom(c, box, '#dfe7e0', '#b0aa9a')
    shelves(c, back, 4, ['#ffffff', '#2a7fc2', '#f6c21c', '#e8352b', '#9aa3ab'], seed, 0.04)
    sideShelves(c, box, back, -1, 5, PACKET_COLORS, seed + 1)
    counter(c, box, '#6d5844', 0.74, 0.3)
    hangingStrips(c, box, seed + 2, 5)
  },
  supermarket: (c, box, seed) => {
    const back = drawRoom(c, box, '#f4f4f0', '#d0cdc4')
    shelves(c, back, 5, PACKET_COLORS, seed, 0.035)
    sideShelves(c, box, back, -1, 6, PACKET_COLORS, seed + 1)
    sideShelves(c, box, back, 1, 6, PACKET_COLORS, seed + 2)
    // An aisle down the middle.
    shelves(c, { x: box.x + box.w * 0.4, y: box.y + box.h * 0.5, w: box.w * 0.2, h: box.h * 0.3 }, 3, PACKET_COLORS, seed + 3)
  },
  darshini: (c, box, seed) => {
    const back = drawRoom(c, box, '#f3efe4', '#9c9a92')
    // White wall tiles, a menu board, and a steel counter with plates.
    c.strokeStyle = 'rgb(0 0 0 / 10%)'
    for (let i = 1; i < 8; i++) {
      c.beginPath()
      c.moveTo(back.x + (back.w * i) / 8, back.y)
      c.lineTo(back.x + (back.w * i) / 8, back.y + back.h)
      c.stroke()
    }
    c.fillStyle = '#1f4a2e'
    c.fillRect(back.x + back.w * 0.12, back.y + back.h * 0.08, back.w * 0.76, back.h * 0.3)
    c.fillStyle = '#f2f0dc'
    for (let line = 0; line < 4; line++) c.fillRect(back.x + back.w * 0.18, back.y + back.h * (0.13 + line * 0.06), back.w * (0.3 + (line % 2) * 0.25), 3)
    // Steel tables and stools in the room.
    for (const at of [0.3, 0.62]) {
      c.fillStyle = '#c8ccd0'
      c.fillRect(box.x + box.w * at, box.y + box.h * 0.6, box.w * 0.14, box.h * 0.03)
      c.fillStyle = '#8f949a'
      c.fillRect(box.x + box.w * (at + 0.06), box.y + box.h * 0.63, box.w * 0.015, box.h * 0.12)
    }
    const top = counter(c, box, '#aeb4ba', 0.76, 0.5)
    for (let i = 0; i < 5; i++) circle(c, top.x + top.w * (0.15 + i * 0.17), top.y - 2, box.h * 0.02, '#e5e8ea')
    void seed
  },
  chai: (c, box, seed) => {
    drawRoom(c, box, '#5a4030', '#4a3a2e')
    garland(c, box)
    const top = counter(c, box, '#d9d2c2', 0.66, 0.06)
    // Glass jars of biscuits, a big kettle, and small glasses of tea.
    const random = sequence(seed)
    for (let i = 0; i < 5; i++) {
      const x = top.x + top.w * (0.05 + i * 0.09)
      c.fillStyle = 'rgb(220 235 240 / 70%)'
      c.fillRect(x, top.y - box.h * 0.13, box.w * 0.065, box.h * 0.13)
      c.fillStyle = random() < 0.5 ? '#d39b52' : '#c0703a'
      c.fillRect(x + 3, top.y - box.h * 0.09, box.w * 0.065 - 6, box.h * 0.085)
    }
    c.fillStyle = '#c9ced3'
    c.beginPath()
    c.ellipse(top.x + top.w * 0.66, top.y - box.h * 0.08, box.w * 0.07, box.h * 0.08, 0, 0, Math.PI * 2)
    c.fill()
    for (let i = 0; i < 4; i++) {
      c.fillStyle = '#c56b2a'
      c.fillRect(top.x + top.w * (0.8 + i * 0.045), top.y - box.h * 0.05, box.w * 0.025, box.h * 0.05)
    }
    // Steam off the kettle.
    c.strokeStyle = 'rgb(255 255 255 / 55%)'
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(top.x + top.w * 0.66, top.y - box.h * 0.17)
    c.quadraticCurveTo(top.x + top.w * 0.62, top.y - box.h * 0.27, top.x + top.w * 0.67, top.y - box.h * 0.36)
    c.stroke()
  },
  coffee: (c, box, seed) => {
    const back = drawRoom(c, box, '#6b4a33', '#4f3b2c')
    shelves(c, back, 2, ['#c9ced3', '#e5e8ea', '#a7764a'], seed, 0.06)
    const top = counter(c, box, '#b9bec3', 0.68, 0.08)
    // The coffee boiler, and a row of steel tumblers.
    c.fillStyle = '#d4d8dc'
    c.fillRect(top.x + top.w * 0.08, top.y - box.h * 0.22, box.w * 0.1, box.h * 0.22)
    for (let i = 0; i < 6; i++) circle(c, top.x + top.w * (0.4 + i * 0.09), top.y - box.h * 0.03, box.h * 0.025, '#e5e8ea')
  },
  chats: (c, box, seed) => {
    drawRoom(c, box, '#c94b2c', '#5b4a3c')
    garland(c, box)
    const top = counter(c, box, '#a9aeb3', 0.66, 0.08)
    const random = sequence(seed)
    // Big steel pots and a heap of puris.
    for (let i = 0; i < 3; i++) {
      c.fillStyle = '#d5d9dd'
      c.fillRect(top.x + top.w * (0.08 + i * 0.16), top.y - box.h * 0.1, box.w * 0.11, box.h * 0.1)
    }
    for (let i = 0; i < 14; i++) circle(c, top.x + top.w * (0.62 + random() * 0.28), top.y - box.h * (0.02 + random() * 0.07), box.h * 0.022, '#d9a35b')
  },
  bakery: (c, box, seed) => {
    const back = drawRoom(c, box, '#f0d9b5', '#8a6748')
    shelves(c, back, 3, ['#c98a45', '#a8652c', '#e7b77a', '#f3e1c2', '#7a3b1e'], seed, 0.07)
    sideShelves(c, box, back, -1, 4, ['#c98a45', '#e7b77a', '#f5f0e6'], seed + 1)
    sideShelves(c, box, back, 1, 4, ['#c98a45', '#e7b77a', '#d84f6f'], seed + 2)
    // Pendant lamps, and the glass display case of cakes and puffs.
    for (const at of [0.35, 0.5, 0.65]) {
      c.fillStyle = '#3a2a1e'
      c.fillRect(box.x + box.w * at, box.y + box.h * SHUTTER_BOX, 2, box.h * 0.1)
      c.fillStyle = '#ffd88a'
      c.beginPath()
      c.arc(box.x + box.w * at, box.y + box.h * (SHUTTER_BOX + 0.12), box.w * 0.025, Math.PI, 0)
      c.fill()
    }
    const top = counter(c, box, '#6b3b22', 0.82, 0.08)
    c.fillStyle = 'rgb(200 230 240 / 55%)'
    c.fillRect(top.x, top.y - box.h * 0.2, top.w, box.h * 0.2)
    const random = sequence(seed + 3)
    for (const row of [0.06, 0.15]) {
      for (let i = 0; i < 12; i++) {
        const color = ['#e7b77a', '#f6e9e2', '#d84f6f', '#7a3b1e'][Math.floor(random() * 4)]
        c.fillStyle = color
        c.fillRect(top.x + top.w * (0.03 + i * 0.08), top.y - box.h * row - box.h * 0.035, top.w * 0.06, box.h * 0.035)
      }
    }
  },
  pharmacy: (c, box, seed) => {
    const back = drawRoom(c, box, '#f6f8f7', '#d5d8d6')
    const boxes = ['#ffffff', '#e8f1f8', '#2a7fc2', '#e8352b', '#2fa34a', '#f6c21c', '#ffffff']
    shelves(c, back, 5, boxes, seed, 0.03, 0.95)
    sideShelves(c, box, back, -1, 7, boxes, seed + 1)
    sideShelves(c, box, back, 1, 7, boxes, seed + 2)
    // A glowing green cross on the back wall, over a white counter.
    const crossX = back.x + back.w / 2
    const crossY = back.y + back.h * 0.22
    const arm = back.h * 0.16
    c.fillStyle = '#25d366'
    c.fillRect(crossX - arm / 3, crossY - arm, (arm * 2) / 3, arm * 2)
    c.fillRect(crossX - arm, crossY - arm / 3, arm * 2, (arm * 2) / 3)
    counter(c, box, '#f2f4f3', 0.74, 0.12)
  },
  clothing: (c, box, seed) => {
    const back = drawRoom(c, box, '#f3ece4', '#c9b9a8')
    const clothes = ['#c62f5c', '#f2b705', '#2a7fc2', '#7b3fa0', '#e86a1c', '#3f9b5a', '#f5f0e6', '#1f3c88']
    const random = sequence(seed)
    // Saris and shirts folded on the back shelves, and hanging on rails at the sides.
    shelves(c, back, 4, clothes, seed, 0.08, 1)
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 10; i++) {
        const t = i / 10
        const x = side < 0 ? lerp(box.x + box.w * 0.02, back.x, t) : lerp(box.x + box.w * 0.98, back.x + back.w, t)
        c.fillStyle = clothes[Math.floor(random() * clothes.length)]
        c.fillRect(x - box.w * 0.015, lerp(box.y + box.h * 0.25, back.y + back.h * 0.1, t), box.w * 0.03, lerp(box.h * 0.45, back.h * 0.6, t))
      }
    }
    // A mannequin in a sari.
    circle(c, box.x + box.w * 0.5, box.y + box.h * 0.48, box.h * 0.035, '#e8d2b5')
    c.fillStyle = '#d7263d'
    c.fillRect(box.x + box.w * 0.47, box.y + box.h * 0.52, box.w * 0.06, box.h * 0.4)
  },
  salon: (c, box, seed) => {
    const back = drawRoom(c, box, '#eeeeee', '#2b2b2b')
    // Mirrors along the back, with chairs in front of them.
    for (let i = 0; i < 3; i++) {
      const x = back.x + back.w * (0.06 + i * 0.32)
      const mirror = c.createLinearGradient(x, back.y, x + back.w * 0.26, back.y + back.h)
      mirror.addColorStop(0, '#d8eef7')
      mirror.addColorStop(1, '#8fb3c4')
      c.fillStyle = mirror
      c.fillRect(x, back.y + back.h * 0.1, back.w * 0.26, back.h * 0.55)
      c.fillStyle = '#1c1c1c'
      c.fillRect(x + back.w * 0.05, back.y + back.h * 0.6, back.w * 0.16, back.h * 0.35)
    }
    void seed
  },
  jewellery: (c, box, seed) => {
    const back = drawRoom(c, box, '#7a1d1d', '#5a3a2a')
    shelves(c, back, 3, ['#ffd24a', '#f2c230', '#e5c07b'], seed, 0.05, 0.7)
    const top = counter(c, box, '#4a1010', 0.7, 0.08)
    c.fillStyle = 'rgb(220 240 250 / 45%)'
    c.fillRect(top.x, top.y, top.w, box.h * 0.08)
    const random = sequence(seed + 1)
    for (let i = 0; i < 24; i++) circle(c, top.x + random() * top.w, top.y + random() * box.h * 0.07, box.h * 0.008, '#ffe680')
  },
  electronics: (c, box, seed) => {
    const back = drawRoom(c, box, '#e7ebef', '#b8bec4')
    // Televisions on the wall, glowing blue, and boxed fridges.
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        c.fillStyle = '#111'
        const x = back.x + back.w * (0.05 + i * 0.32)
        const y = back.y + back.h * (0.08 + row * 0.42)
        c.fillRect(x, y, back.w * 0.28, back.h * 0.32)
        c.fillStyle = ['#2a8ac0', '#3fb07a', '#e86a1c'][(i + row + seed) % 3]
        c.fillRect(x + 3, y + 3, back.w * 0.28 - 6, back.h * 0.32 - 6)
      }
    }
    for (const at of [0.08, 0.8]) {
      c.fillStyle = '#c9a777'
      c.fillRect(box.x + box.w * at, box.y + box.h * 0.55, box.w * 0.12, box.h * 0.45)
    }
  },
  mobiles: (c, box, seed) => {
    const back = drawRoom(c, box, '#f0f0f0', '#c8c8c8')
    // Bright posters, and phones under the glass counter.
    const posters = ['#e8352b', '#2a7fc2', '#f6c21c', '#14a3a3']
    for (let i = 0; i < 4; i++) {
      c.fillStyle = posters[(i + seed) % posters.length]
      c.fillRect(back.x + back.w * (0.04 + i * 0.24), back.y + back.h * 0.1, back.w * 0.2, back.h * 0.5)
    }
    const top = counter(c, box, '#2b2f33', 0.7, 0.08)
    c.fillStyle = 'rgb(200 235 250 / 45%)'
    c.fillRect(top.x, top.y, top.w, box.h * 0.1)
    for (let i = 0; i < 9; i++) {
      c.fillStyle = '#111'
      c.fillRect(top.x + top.w * (0.05 + i * 0.1), top.y + box.h * 0.02, top.w * 0.04, box.h * 0.07)
    }
  },
  tailor: (c, box, seed) => {
    const back = drawRoom(c, box, '#e4dccb', '#a69a86')
    // Rolls of cloth standing on the shelves, and a sewing machine at the front.
    shelves(c, back, 3, ['#1f3c88', '#c62f5c', '#f2b705', '#f5f0e6', '#3f9b5a', '#7b3fa0'], seed, 0.05, 1)
    const top = counter(c, box, '#7a5a3a', 0.76, 0.2)
    c.fillStyle = '#1b1b1b'
    c.fillRect(top.x + top.w * 0.35, top.y - box.h * 0.1, top.w * 0.25, box.h * 0.04)
    c.fillRect(top.x + top.w * 0.55, top.y - box.h * 0.1, top.w * 0.05, box.h * 0.1)
  },
  hardware: (c, box, seed) => {
    const back = drawRoom(c, box, '#b8bbbd', '#77746f')
    // Pipes racked on the wall and paint tins stacked up.
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#d9d9d9' : '#f0f0f0'
      c.fillRect(back.x, back.y + back.h * (0.06 + i * 0.05), back.w, back.h * 0.03)
    }
    shelves(c, { x: back.x, y: back.y + back.h * 0.5, w: back.w, h: back.h * 0.5 }, 2, ['#e8352b', '#2a7fc2', '#f6c21c', '#ffffff'], seed, 0.06)
    sideShelves(c, box, back, 1, 5, ['#c0c4c8', '#e8352b', '#2a7fc2'], seed + 1)
  },
}

/** Draws the inside of one shop into a rectangle of a canvas. */
export function drawInterior(context: Context, type: ShopType, x: number, y: number, width: number, height: number, seed = 1) {
  const box = { x, y, w: width, h: height }
  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()
  DRAW[type](context, box, seed)
  finish(context, box)
  context.restore()
}
