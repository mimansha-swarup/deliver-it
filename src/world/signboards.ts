/**
 * Shop signboards, drawn in code. Bengaluru's boards put Kannada on top and
 * larger, with English below, and that's what these do. Every name is made up:
 * no real shop or brand appears in the game. A few are names so common they're
 * kinds of shop in Bengaluru: an Udupi darshini, an Iyengar bakery.
 *
 * Kannada spellings here are transliterations of the English names. Worth a check
 * by someone who reads Kannada before showing the game widely.
 */
export type ShopType =
  | 'kirana'
  | 'darshini'
  | 'chai'
  | 'bakery'
  | 'pharmacy'
  | 'clothing'
  | 'salon'
  | 'jewellery'
  | 'electronics'
  | 'supermarket'
  | 'chats'
  | 'coffee'
  | 'mobiles'
  | 'tailor'
  | 'hardware'
  | 'general'

type Board = {
  kannada: string
  english: string
  /** Background, lettering, and the band along the bottom. */
  colors: [string, string, string]
  /** What it sells, along the bottom band. */
  items: string[]
  /** The colour of its awning, striped with white. */
  awning: string
  icon: (context: CanvasRenderingContext2D, x: number, y: number, size: number) => void
}

/**
 * Painted boards, as photos, for the commonest shops. A street gets these and the
 * drawn boards in turn, so no two kiranas in a row look the same.
 */
export const PHOTO_BOARDS: Partial<Record<ShopType, string>> = {
  kirana: '/textures/board-kirana.jpg',
  darshini: '/textures/board-darshini.jpg',
  chai: '/textures/board-chai.jpg',
  bakery: '/textures/board-bakery.jpg',
  pharmacy: '/textures/board-pharmacy.jpg',
}

/** The order here is each board's place in the atlas image. */
export const SHOP_TYPES: ShopType[] = [
  'kirana',
  'darshini',
  'chai',
  'bakery',
  'pharmacy',
  'clothing',
  'salon',
  'jewellery',
  'electronics',
  'supermarket',
  'chats',
  'coffee',
  'mobiles',
  'tailor',
  'hardware',
  'general',
]

// ---- Icons, each in a square at (x, y) of the given size ----

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  context.fillStyle = color
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
}

const BOARDS: Record<ShopType, Board> = {
  kirana: {
    kannada: 'ಶ್ರೀ ವೆಂಕಟೇಶ್ವರ ಪ್ರಾವಿಷನ್ ಸ್ಟೋರ್ಸ್',
    english: 'Sri Venkateshwara Provisions',
    colors: ['#1d4f9c', '#ffffff', '#f2c230'],
    items: ['Groceries', 'Pulses', 'Spices', 'Rice'],
    awning: '#f2b705',
    // A sack of rice, tied at the top.
    icon: (c, x, y, s) => {
      c.fillStyle = '#e8d6a8'
      c.beginPath()
      c.moveTo(x + s * 0.3, y + s * 0.3)
      c.lineTo(x + s * 0.7, y + s * 0.3)
      c.lineTo(x + s * 0.82, y + s * 0.88)
      c.lineTo(x + s * 0.18, y + s * 0.88)
      c.closePath()
      c.fill()
      c.fillStyle = '#b5893f'
      c.fillRect(x + s * 0.32, y + s * 0.22, s * 0.36, s * 0.1)
      c.fillStyle = '#c62f2f'
      c.fillRect(x + s * 0.28, y + s * 0.55, s * 0.44, s * 0.12)
    },
  },
  darshini: {
    kannada: 'ಶ್ರೀ ಕೃಷ್ಣ ಭವನ',
    english: 'Sri Krishna Bhavan',
    colors: ['#f6efdc', '#1f6b3a', '#1f6b3a'],
    items: ['Idli', 'Dosa', 'Vada', 'Meals'],
    awning: '#1f6b3a',
    // Idli on a banana leaf.
    icon: (c, x, y, s) => {
      c.fillStyle = '#2f8a3a'
      c.beginPath()
      c.ellipse(x + s / 2, y + s / 2, s * 0.44, s * 0.3, -0.4, 0, Math.PI * 2)
      c.fill()
      circle(c, x + s * 0.4, y + s * 0.5, s * 0.13, '#fbf7ec')
      circle(c, x + s * 0.62, y + s * 0.45, s * 0.13, '#fbf7ec')
      circle(c, x + s * 0.55, y + s * 0.66, s * 0.08, '#e6a23c')
    },
  },
  chai: {
    kannada: 'ನಂದಿ ಟೀ ಸ್ಟಾಲ್',
    english: 'Nandi Tea Stall',
    colors: ['#f3e7cf', '#6b2a1a', '#7a2e22'],
    items: ['Chai', 'Coffee', 'Bun', 'Biscuit'],
    awning: '#2f6b3f',
    // A small glass of tea, with steam.
    icon: (c, x, y, s) => {
      c.fillStyle = '#d8c9a8'
      c.beginPath()
      c.moveTo(x + s * 0.3, y + s * 0.4)
      c.lineTo(x + s * 0.7, y + s * 0.4)
      c.lineTo(x + s * 0.64, y + s * 0.88)
      c.lineTo(x + s * 0.36, y + s * 0.88)
      c.closePath()
      c.fill()
      c.fillStyle = '#9c4f17'
      c.fillRect(x + s * 0.34, y + s * 0.52, s * 0.32, s * 0.33)
      c.strokeStyle = '#9c7b5a'
      c.lineWidth = s * 0.04
      for (const offset of [0.42, 0.58]) {
        c.beginPath()
        c.moveTo(x + s * offset, y + s * 0.32)
        c.quadraticCurveTo(x + s * (offset - 0.06), y + s * 0.2, x + s * offset, y + s * 0.08)
        c.stroke()
      }
    },
  },
  bakery: {
    kannada: 'ಬೆಂಗಳೂರು ಅಯ್ಯಂಗಾರ್ ಬೇಕರಿ',
    english: 'Bangalore Iyengar Bakery',
    colors: ['#f3e2c4', '#7a1d2b', '#7a1d2b'],
    items: ['Cakes', 'Puffs', 'Bread', 'Cookies'],
    awning: '#8c2335',
    // A round loaf with scores across it.
    icon: (c, x, y, s) => {
      c.fillStyle = '#d99a4e'
      c.beginPath()
      c.ellipse(x + s / 2, y + s * 0.58, s * 0.4, s * 0.26, 0, 0, Math.PI * 2)
      c.fill()
      c.strokeStyle = '#8c5420'
      c.lineWidth = s * 0.04
      for (const offset of [-0.15, 0, 0.15]) {
        c.beginPath()
        c.moveTo(x + s * (0.5 + offset - 0.06), y + s * 0.45)
        c.lineTo(x + s * (0.5 + offset + 0.06), y + s * 0.7)
        c.stroke()
      }
    },
  },
  pharmacy: {
    kannada: 'ಶ್ರೀ ಸಾಯಿ ಮೆಡಿಕಲ್ಸ್',
    english: 'Sri Sai Medicals',
    colors: ['#f4f1ea', '#11603f', '#11603f'],
    items: ['Medicines', 'Wellness', 'Baby Care'],
    awning: '#14806b',
    // The green cross every pharmacy shows.
    icon: (c, x, y, s) => {
      c.fillStyle = '#11a35a'
      c.fillRect(x + s * 0.38, y + s * 0.14, s * 0.24, s * 0.72)
      c.fillRect(x + s * 0.14, y + s * 0.38, s * 0.72, s * 0.24)
    },
  },
  clothing: {
    kannada: 'ಸ್ನೇಹ ಫ್ಯಾಷನ್ಸ್',
    english: 'Sneha Fashions',
    colors: ['#6a2c8f', '#ffffff', '#f4c3ff'],
    items: ['Sarees', 'Kurtas', 'Kids Wear'],
    awning: '#a0479f',
    // A shirt.
    icon: (c, x, y, s) => {
      c.fillStyle = '#ff8fb1'
      c.beginPath()
      c.moveTo(x + s * 0.35, y + s * 0.18)
      c.lineTo(x + s * 0.65, y + s * 0.18)
      c.lineTo(x + s * 0.9, y + s * 0.38)
      c.lineTo(x + s * 0.78, y + s * 0.5)
      c.lineTo(x + s * 0.7, y + s * 0.44)
      c.lineTo(x + s * 0.7, y + s * 0.88)
      c.lineTo(x + s * 0.3, y + s * 0.88)
      c.lineTo(x + s * 0.3, y + s * 0.44)
      c.lineTo(x + s * 0.22, y + s * 0.5)
      c.lineTo(x + s * 0.1, y + s * 0.38)
      c.closePath()
      c.fill()
    },
  },
  salon: {
    kannada: 'ಸ್ಟೈಲ್ ಮೆನ್ಸ್ ಸಲೂನ್',
    english: "Style Men's Saloon",
    colors: ['#151515', '#ffffff', '#c9a14a'],
    items: ['Hair Cut', 'Shave', 'Facial'],
    awning: '#2f2f2f',
    // Scissors.
    icon: (c, x, y, s) => {
      c.strokeStyle = '#e5c07b'
      c.lineWidth = s * 0.06
      c.beginPath()
      c.moveTo(x + s * 0.3, y + s * 0.2)
      c.lineTo(x + s * 0.62, y + s * 0.62)
      c.moveTo(x + s * 0.7, y + s * 0.2)
      c.lineTo(x + s * 0.38, y + s * 0.62)
      c.stroke()
      for (const side of [0.32, 0.68]) {
        c.beginPath()
        c.arc(x + s * side, y + s * 0.74, s * 0.11, 0, Math.PI * 2)
        c.stroke()
      }
    },
  },
  jewellery: {
    kannada: 'ಗಂಗಾ ಜ್ಯುವೆಲ್ಲರ್ಸ್',
    english: 'Ganga Jewellers',
    colors: ['#5c0f0f', '#ffd700', '#c99a1f'],
    items: ['Gold', 'Silver', 'Diamonds'],
    awning: '#7a1414',
    // A gold ring with a stone.
    icon: (c, x, y, s) => {
      c.strokeStyle = '#ffd24a'
      c.lineWidth = s * 0.07
      c.beginPath()
      c.arc(x + s / 2, y + s * 0.6, s * 0.24, 0, Math.PI * 2)
      c.stroke()
      c.fillStyle = '#e83f5b'
      c.beginPath()
      c.moveTo(x + s / 2, y + s * 0.18)
      c.lineTo(x + s * 0.62, y + s * 0.3)
      c.lineTo(x + s / 2, y + s * 0.42)
      c.lineTo(x + s * 0.38, y + s * 0.3)
      c.closePath()
      c.fill()
    },
  },
  electronics: {
    kannada: 'ಸ್ಟಾರ್ ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್',
    english: 'Star Electronics',
    colors: ['#0d3b66', '#ffffff', '#2a8ac0'],
    items: ['TV', 'Fridge', 'Repairs'],
    awning: '#2a6fb0',
    // A television.
    icon: (c, x, y, s) => {
      c.fillStyle = '#5bc0eb'
      c.fillRect(x + s * 0.14, y + s * 0.22, s * 0.72, s * 0.48)
      c.fillStyle = '#0d3b66'
      c.fillRect(x + s * 0.2, y + s * 0.28, s * 0.6, s * 0.36)
      c.fillStyle = '#5bc0eb'
      c.fillRect(x + s * 0.4, y + s * 0.7, s * 0.2, s * 0.12)
    },
  },
  supermarket: {
    kannada: 'ಮಂಗಳ ಸೂಪರ್ ಮಾರ್ಕೆಟ್',
    english: 'Mangala Super Market',
    colors: ['#d7261e', '#ffffff', '#ffc928'],
    items: ['Fruits', 'Vegetables', 'Dairy', 'Home'],
    awning: '#d7261e',
    // A shopping trolley.
    icon: (c, x, y, s) => {
      c.strokeStyle = '#ffffff'
      c.lineWidth = s * 0.06
      c.beginPath()
      c.moveTo(x + s * 0.12, y + s * 0.25)
      c.lineTo(x + s * 0.25, y + s * 0.25)
      c.lineTo(x + s * 0.35, y + s * 0.65)
      c.lineTo(x + s * 0.8, y + s * 0.65)
      c.lineTo(x + s * 0.86, y + s * 0.35)
      c.lineTo(x + s * 0.28, y + s * 0.35)
      c.stroke()
      circle(c, x + s * 0.4, y + s * 0.8, s * 0.07, '#ffffff')
      circle(c, x + s * 0.74, y + s * 0.8, s * 0.07, '#ffffff')
    },
  },
  chats: {
    kannada: 'ಗಣೇಶ ಚಾಟ್ ಸೆಂಟರ್',
    english: 'Ganesh Chat Centre',
    colors: ['#f7b32b', '#2d1e2f', '#b3121f'],
    items: ['Pani Puri', 'Masala Puri', 'Bhel'],
    awning: '#e0561b',
    // A plate of pani puri.
    icon: (c, x, y, s) => {
      c.fillStyle = '#c0c4c8'
      c.beginPath()
      c.ellipse(x + s / 2, y + s * 0.68, s * 0.42, s * 0.14, 0, 0, Math.PI * 2)
      c.fill()
      for (const [px, py] of [
        [0.34, 0.54],
        [0.5, 0.5],
        [0.66, 0.54],
        [0.42, 0.4],
        [0.58, 0.4],
      ]) {
        circle(c, x + s * px, y + s * py, s * 0.09, '#d9a35b')
      }
    },
  },
  coffee: {
    kannada: 'ಫಿಲ್ಟರ್ ಕಾಫಿ ಬಾರ್',
    english: 'Filter Coffee Bar',
    colors: ['#3b2416', '#f5deb3', '#8a5a34'],
    items: ['Filter Coffee', 'Tea', 'Snacks'],
    awning: '#5a3820',
    // A steel tumbler in its davara.
    icon: (c, x, y, s) => {
      c.fillStyle = '#c9ced3'
      c.beginPath()
      c.moveTo(x + s * 0.36, y + s * 0.2)
      c.lineTo(x + s * 0.64, y + s * 0.2)
      c.lineTo(x + s * 0.6, y + s * 0.66)
      c.lineTo(x + s * 0.4, y + s * 0.66)
      c.closePath()
      c.fill()
      c.fillStyle = '#e1e5e8'
      c.fillRect(x + s * 0.2, y + s * 0.66, s * 0.6, s * 0.16)
      c.fillStyle = '#7a4a24'
      c.fillRect(x + s * 0.38, y + s * 0.2, s * 0.24, s * 0.06)
    },
  },
  mobiles: {
    kannada: 'ಸಿಟಿ ಮೊಬೈಲ್ಸ್',
    english: 'City Mobiles',
    colors: ['#00a8a8', '#ffffff', '#065c74'],
    items: ['Recharge', 'Accessories', 'Repairs'],
    awning: '#0a8f9a',
    // A phone.
    icon: (c, x, y, s) => {
      c.fillStyle = '#ffffff'
      c.fillRect(x + s * 0.32, y + s * 0.12, s * 0.36, s * 0.76)
      c.fillStyle = '#00a8a8'
      c.fillRect(x + s * 0.36, y + s * 0.2, s * 0.28, s * 0.52)
      circle(c, x + s / 2, y + s * 0.8, s * 0.035, '#00a8a8')
    },
  },
  tailor: {
    kannada: 'ಭಾರತ್ ಟೈಲರ್ಸ್',
    english: 'Bharat Tailors',
    colors: ['#f5f0e1', '#1f3c88', '#1f3c88'],
    items: ['Ladies', 'Gents', 'Alterations'],
    awning: '#3a5aa8',
    // A needle and thread.
    icon: (c, x, y, s) => {
      c.strokeStyle = '#1f3c88'
      c.lineWidth = s * 0.05
      c.beginPath()
      c.moveTo(x + s * 0.25, y + s * 0.8)
      c.lineTo(x + s * 0.72, y + s * 0.2)
      c.stroke()
      c.strokeStyle = '#d7261e'
      c.lineWidth = s * 0.03
      c.beginPath()
      c.moveTo(x + s * 0.68, y + s * 0.26)
      c.bezierCurveTo(x + s * 0.95, y + s * 0.4, x + s * 0.2, y + s * 0.5, x + s * 0.5, y + s * 0.85)
      c.stroke()
    },
  },
  hardware: {
    kannada: 'ವಿನಾಯಕ ಹಾರ್ಡ್‌ವೇರ್',
    english: 'Vinayaka Hardware',
    colors: ['#3a3a3a', '#ffcc00', '#b38a00'],
    items: ['Paints', 'Pipes', 'Tools'],
    awning: '#5a5a5a',
    // A spanner.
    icon: (c, x, y, s) => {
      c.strokeStyle = '#ffcc00'
      c.lineWidth = s * 0.1
      c.lineCap = 'round'
      c.beginPath()
      c.moveTo(x + s * 0.3, y + s * 0.75)
      c.lineTo(x + s * 0.66, y + s * 0.34)
      c.stroke()
      c.lineCap = 'butt'
      circle(c, x + s * 0.7, y + s * 0.3, s * 0.15, '#ffcc00')
      circle(c, x + s * 0.76, y + s * 0.24, s * 0.07, '#3a3a3a')
    },
  },
  general: {
    kannada: 'ಜನರಲ್ ಸ್ಟೋರ್ಸ್',
    english: 'General Stores',
    colors: ['#2e7d32', '#ffffff', '#f2c230'],
    items: ['Stationery', 'Xerox', 'Snacks'],
    awning: '#3d8b40',
    // A shopping basket.
    icon: (c, x, y, s) => {
      c.fillStyle = '#ffd54f'
      c.fillRect(x + s * 0.18, y + s * 0.45, s * 0.64, s * 0.38)
      c.strokeStyle = '#ffd54f'
      c.lineWidth = s * 0.05
      c.beginPath()
      c.arc(x + s / 2, y + s * 0.45, s * 0.22, Math.PI, 0)
      c.stroke()
    },
  },
}

/** The font for both lines. Baloo Tamma 2 covers English and Kannada; the rest are fallbacks. */
const BOARD_FONT = "'Baloo Tamma 2', 'Kannada Sangam MN', 'Noto Sans Kannada', 'Tunga', sans-serif"
/** Kannada letters, for checking the font is ready before drawing. */
export const KANNADA_SAMPLE = 'ಕನ್ನಡ'
export const BOARD_FONT_CHECK = `700 64px 'Baloo Tamma 2'`

/**
 * Draws one board into a rectangle, laid out as HSR's printed flex boards are:
 * the icon on the left, the name in Kannada over the name in English, and a band
 * along the bottom listing what's sold.
 */
export function drawBoard(context: CanvasRenderingContext2D, type: ShopType, x: number, y: number, width: number, height: number) {
  const { kannada, english, colors, icon, items } = BOARDS[type]
  const [background, lettering, band] = colors

  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()

  context.fillStyle = background
  context.fillRect(x, y, width, height)
  const bandTop = y + height * 0.74
  context.fillStyle = band
  context.fillRect(x, bandTop, width, height * 0.26)

  // Sun and grime: lighter at the top, dirtier at the bottom, as a board out in the weather gets.
  const weather = context.createLinearGradient(0, y, 0, y + height)
  weather.addColorStop(0, 'rgb(255 255 255 / 14%)')
  weather.addColorStop(0.55, 'rgb(255 255 255 / 0%)')
  weather.addColorStop(1, 'rgb(40 25 10 / 22%)')
  context.fillStyle = weather
  context.fillRect(x, y, width, height)
  // A metal frame round the edge.
  context.strokeStyle = 'rgb(60 50 40 / 85%)'
  context.lineWidth = height * 0.05
  context.strokeRect(x, y, width, height)

  const iconSize = height * 0.6
  icon(context, x + height * 0.12, y + height * 0.08, iconSize)

  const textLeft = x + height * 0.12 + iconSize + height * 0.08
  const textWidth = x + width - height * 0.12 - textLeft
  const centre = textLeft + textWidth / 2
  context.fillStyle = lettering
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `700 ${Math.round(height * 0.3)}px ${BOARD_FONT}`
  context.fillText(kannada, centre, y + height * 0.24, textWidth)
  context.font = `800 ${Math.round(height * 0.25)}px ${BOARD_FONT}`
  context.fillText(english, centre, y + height * 0.55, textWidth)

  context.fillStyle = background === band ? lettering : '#ffffff'
  context.font = `600 ${Math.round(height * 0.14)}px ${BOARD_FONT}`
  context.fillText(items.join('   |   '), x + width / 2, bandTop + height * 0.13, width - height * 0.4)
  context.restore()
}

/** Each kind of shop's awning colour. */
export function awningColor(type: ShopType): string {
  return BOARDS[type].awning
}

/** What a mapped place's tags say it sells. */
export function typeForPlace({ shop, amenity, cuisine }: { shop?: string; amenity?: string; cuisine?: string }): ShopType {
  if (amenity === 'pharmacy' || shop === 'chemist') return 'pharmacy'
  if (shop === 'bakery' || shop === 'pastry' || shop === 'confectionery') return 'bakery'
  if (shop === 'tea' || cuisine === 'tea') return 'chai'
  if (amenity === 'cafe') return 'coffee'
  if (amenity === 'restaurant') return 'darshini'
  if (amenity === 'fast_food' || amenity === 'ice_cream') return 'chats'
  if (shop === 'supermarket' || shop === 'department_store') return 'supermarket'
  if (shop === 'convenience' || shop === 'grocery' || shop === 'greengrocer') return 'kirana'
  if (shop === 'clothes' || shop === 'shoes' || shop === 'boutique') return 'clothing'
  if (shop === 'hairdresser' || shop === 'beauty') return 'salon'
  if (shop === 'jewelry') return 'jewellery'
  if (shop === 'electronics' || shop === 'computer') return 'electronics'
  if (shop === 'mobile_phone') return 'mobiles'
  if (shop === 'tailor') return 'tailor'
  if (shop === 'hardware' || shop === 'doityourself') return 'hardware'
  return 'general'
}

/**
 * A shop in a row with no mapped place gets a type by chance, weighted the way
 * an HSR street is: lots of kiranas, darshinis and medicals, fewer of the rest.
 */
const STREET_MIX: [ShopType, number][] = [
  ['kirana', 18],
  ['darshini', 12],
  ['pharmacy', 10],
  ['bakery', 9],
  ['chai', 9],
  ['mobiles', 8],
  ['clothing', 7],
  ['salon', 6],
  ['tailor', 5],
  ['hardware', 4],
  ['general', 4],
  ['chats', 4],
  ['coffee', 3],
  ['electronics', 3],
  ['jewellery', 2],
]
const STREET_TOTAL = STREET_MIX.reduce((sum, [, weight]) => sum + weight, 0)

export function typeByChance(roll: number): ShopType {
  let left = roll * STREET_TOTAL
  for (const [type, weight] of STREET_MIX) {
    left -= weight
    if (left < 0) return type
  }
  return 'general'
}
