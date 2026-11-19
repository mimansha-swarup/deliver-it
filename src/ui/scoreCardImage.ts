import { findColour, HELMETS } from '../game/garage'
import { useGameStore } from '../game/gameStore'
import { levelFromXp } from '../game/progression'
import { challengeFor, useToday } from '../game/today'
import { VEHICLES } from '../vehicle/vehicleCatalog'
import { loadMapData } from '../world/mapData'
import { PLAY_AREA } from '../world/worldUtils'
import { createMapImage, IMAGE_SCALE } from './mapDrawing'

/*
 * The daily challenge's score card: a picture to share (sized for a phone chat, 1080 × 1350): the
 * day's challenge and whether it's done, the rider, the day's route on the map of HSR, and the
 * numbers: orders, earnings, rating, distance. Drawn on a canvas here; nothing leaves the device
 * until the rider shares it.
 */

const SIZE = { width: 1080, height: 1350 }
const FONT = "'Baloo Tamma 2', 'Arial Black', system-ui, sans-serif"
const INK = '#2a1300'
const MARIGOLD = '#f6b32b'
const CHILLI = '#e8462a'
const PAPER = '#fbf3df'

let mapImage: HTMLCanvasElement | null = null

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}

/** The rider, as a badge: the helmet in its own colour with its visor, over the marigold jacket. */
function drawRider(context: CanvasRenderingContext2D, x: number, y: number, size: number, helmet: string, bare: boolean) {
  context.save()
  context.translate(x, y)
  context.scale(size / 100, size / 100)
  context.fillStyle = MARIGOLD
  context.strokeStyle = INK
  context.lineWidth = 5
  roundRect(context, -46, 34, 92, 70, 26)
  context.fill()
  context.stroke()
  context.fillStyle = bare ? '#9a6a48' : helmet
  context.beginPath()
  context.arc(0, 0, 40, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  if (bare) {
    context.fillStyle = '#1c1714'
    context.beginPath()
    context.arc(0, -6, 40, Math.PI, 0)
    context.fill()
  } else {
    context.fillStyle = '#14191e'
    roundRect(context, -31, -12, 62, 26, 12)
    context.fill()
    context.fillStyle = 'rgba(255,255,255,0.35)'
    roundRect(context, -24, -8, 22, 7, 3)
    context.fill()
  }
  context.restore()
}

/** Draws the day's route on the map: the part of HSR it covers, with room round it. */
function drawRoute(context: CanvasRenderingContext2D, map: HTMLCanvasElement, route: number[], x: number, y: number, width: number, height: number) {
  context.save()
  roundRect(context, x, y, width, height, 28)
  context.clip()
  context.fillStyle = '#22252a'
  context.fillRect(x, y, width, height)
  // The box round the route, at least 700 m across, in the panel's proportions.
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < route.length; i += 2) {
    minX = Math.min(minX, route[i])
    maxX = Math.max(maxX, route[i])
    minZ = Math.min(minZ, route[i + 1])
    maxZ = Math.max(maxZ, route[i + 1])
  }
  if (route.length < 2) {
    minX = maxX = 120
    minZ = maxZ = -330
  }
  const centreX = (minX + maxX) / 2
  const centreZ = (minZ + maxZ) / 2
  const spanX = Math.max(700, (maxX - minX) * 1.25, (maxZ - minZ) * 1.25 * (width / height))
  const scale = width / spanX
  const spanZ = height / scale
  const sourceX = (centreX - spanX / 2 - PLAY_AREA.minX) * IMAGE_SCALE
  const sourceZ = (centreZ - spanZ / 2 - PLAY_AREA.minZ) * IMAGE_SCALE
  context.drawImage(map, sourceX, sourceZ, spanX * IMAGE_SCALE, spanZ * IMAGE_SCALE, x, y, width, height)
  const toPanel = (wx: number, wz: number): [number, number] => [x + (wx - (centreX - spanX / 2)) * scale, y + (wz - (centreZ - spanZ / 2)) * scale]
  if (route.length >= 4) {
    for (const [color, line] of [[INK, 13], [MARIGOLD, 7]] as const) {
      context.beginPath()
      for (let i = 0; i < route.length; i += 2) {
        const [px, py] = toPanel(route[i], route[i + 1])
        // A gap in the trace (the rider was moved, not riding) breaks the line.
        if (i === 0 || Math.hypot(route[i] - route[i - 2], route[i + 1] - route[i - 1]) > 250) context.moveTo(px, py)
        else context.lineTo(px, py)
      }
      context.strokeStyle = color
      context.lineWidth = line
      context.lineJoin = 'round'
      context.lineCap = 'round'
      context.stroke()
    }
    const [endX, endY] = toPanel(route[route.length - 2], route[route.length - 1])
    context.fillStyle = CHILLI
    context.strokeStyle = PAPER
    context.lineWidth = 5
    context.beginPath()
    context.arc(endX, endY, 13, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }
  context.restore()
  context.fillStyle = 'rgba(15,17,21,0.78)'
  roundRect(context, x + 18, y + height - 62, 330, 44, 22)
  context.fill()
  context.fillStyle = PAPER
  context.font = `600 26px ${FONT}`
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.fillText('Today’s route · HSR Layout', x + 38, y + height - 38)
}

/** Builds today's card. The map is loaded (it already is, in the game) and drawn once. */
export async function buildScoreCard(): Promise<HTMLCanvasElement> {
  mapImage ??= createMapImage(await loadMapData())
  try {
    await document.fonts.load(`800 60px ${FONT}`)
  } catch {
    // The stand-in font will do.
  }
  const { stats } = useToday.getState()
  const game = useGameStore.getState()
  const challenge = challengeFor(stats.date)
  const progress = challenge.progress(stats)
  const done = progress >= challenge.target
  const canvas = document.createElement('canvas')
  canvas.width = SIZE.width
  canvas.height = SIZE.height
  const context = canvas.getContext('2d')
  if (!context) return canvas

  // Paper, with the marigold band across the top.
  context.fillStyle = PAPER
  context.fillRect(0, 0, SIZE.width, SIZE.height)
  context.fillStyle = MARIGOLD
  context.fillRect(0, 0, SIZE.width, 250)
  context.fillStyle = INK
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.save()
  context.translate(60, 138)
  context.rotate((-3 * Math.PI) / 180)
  context.font = `800 108px ${FONT}`
  context.fillText('Deliver It', 0, 0)
  context.fillStyle = CHILLI
  context.fillRect(4, 18, 430, 12)
  context.restore()
  context.fillStyle = INK
  context.font = `700 36px ${FONT}`
  const date = new Date(`${stats.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  context.fillText(`Daily challenge · ${date}`, 62, 216)

  // The rider, top right.
  // In a round paper badge, so the marigold jacket shows against the marigold band.
  context.save()
  context.fillStyle = PAPER
  context.strokeStyle = INK
  context.lineWidth = 6
  context.beginPath()
  context.arc(946, 104, 84, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.clip()
  drawRider(context, 946, 92, 96, findColour(HELMETS, game.helmetId).color, !game.helmetOn)
  context.restore()
  context.textAlign = 'right'
  context.font = `700 28px ${FONT}`
  context.fillText(`Level ${levelFromXp(game.xp)} · ${(VEHICLES[game.vehicleId] ?? VEHICLES.scooter).name}`, 1030, 232, 400)

  // The challenge, and whether it's done.
  context.fillStyle = INK
  roundRect(context, 50, 286, 980, 150, 30)
  context.fill()
  context.textAlign = 'left'
  context.fillStyle = PAPER
  context.font = `800 50px ${FONT}`
  context.fillText(challenge.text, 86, 352, 700)
  context.font = `600 30px ${FONT}`
  context.fillStyle = '#e8d9b0'
  const shown = challenge.id === 'far' ? `${Math.min(progress, challenge.target).toFixed(1)} of ${challenge.target} km · ${stats.orders} orders` : `${Math.min(Math.floor(progress), challenge.target)} of ${challenge.target} ${challenge.unit}`
  context.fillText(shown, 86, 404)
  context.fillStyle = done ? '#3ddc97' : MARIGOLD
  roundRect(context, 818, 322, 180, 78, 39)
  context.fill()
  context.fillStyle = INK
  context.textAlign = 'center'
  context.font = `800 38px ${FONT}`
  context.fillText(done ? 'DONE ✓' : 'ON IT', 908, 374)

  drawRoute(context, mapImage, stats.route, 50, 466, 980, 560)

  // The numbers.
  const rating = stats.ratings.length ? stats.ratings.reduce((sum, stars) => sum + stars, 0) / stats.ratings.length : null
  const tiles: [string, string][] = [
    ['Orders', String(stats.orders)],
    ['Earned', `₹${stats.earnings.toLocaleString('en-IN')}`],
    ['Rating', rating === null ? '—' : `★ ${rating.toFixed(1)}`],
    ['Distance', `${(stats.metres / 1000).toFixed(1)} km`],
  ]
  tiles.forEach(([label, value], index) => {
    const x = 50 + index * 250
    context.fillStyle = '#f1e3bd'
    roundRect(context, x, 1056, 230, 170, 26)
    context.fill()
    context.fillStyle = INK
    context.textAlign = 'center'
    context.font = `800 62px ${FONT}`
    context.fillText(value, x + 115, 1150, 210)
    context.font = `600 28px ${FONT}`
    context.fillStyle = '#7a5a2a'
    context.fillText(label, x + 115, 1198)
  })

  context.fillStyle = INK
  context.textAlign = 'left'
  context.font = `600 28px ${FONT}`
  context.fillText(stats.crashes === 0 && stats.orders > 0 ? 'Not one crash today. Jopana!' : `${stats.crashes} crash${stats.crashes === 1 ? '' : 'es'} · best run ${stats.bestStars} five-star${stats.bestStars === 1 ? '' : 's'} in a row`, 56, 1286)
  context.textAlign = 'right'
  context.fillStyle = '#7a5a2a'
  context.fillText('A delivery rider’s day in HSR Layout · free in your browser', 1024, 1322, 940)
  return canvas
}

/** The words that go with the picture. */
export function scoreCardText(): string {
  const { stats } = useToday.getState()
  const challenge = challengeFor(stats.date)
  const done = challenge.progress(stats) >= challenge.target
  return `Deliver It daily challenge: ${challenge.text} ${done ? '✅ done!' : '⏳ on it'} ${stats.orders} orders, ₹${stats.earnings} today.`
}
