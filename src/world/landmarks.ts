import { findNearestWall, type CollisionWorld } from './collision'
import { indexRoadPieces, nearestRoadEdge, toRoadPieces } from './props'
import type { LineFeature } from './mapData'
import { isInsideBounds, lonLatToWorld } from './worldUtils'

/**
 * Well-known shops, cafes and food places in HSR Layout, at the real spots of
 * real stores (positions given by the project's owner). The game shows no real
 * brand, as the brief requires, so each chain has a made-up name and look. A
 * chain's branches share theirs, as real chains do.
 */
export type LandmarkCategory =
  | 'clothing'
  | 'footwear'
  | 'sportswear'
  | 'eyewear'
  | 'jewellery'
  | 'electronics'
  | 'fast_food'
  | 'cafe'

/** How a chain's sign looks. Each is drawn in code, so none copies a real logo. */
export type Chain = {
  name: string
  /** The small line under the name. */
  tagline: string
  background: string
  lettering: string
  /** A thin stripe along the bottom. */
  accent: string
  /** The name's style: a bold sans, spaced capitals, or a serif. */
  style: 'bold' | 'caps' | 'serif'
  category: LandmarkCategory
}

export const CHAINS = {
  stitchStrut: { name: 'Stitch & Strut', tagline: 'Streetwear', background: '#111111', lettering: '#ffffff', accent: '#ffd400', style: 'caps', category: 'clothing' },
  paisleyPop: { name: 'Paisley Pop', tagline: 'Fashion for everyone', background: '#f7f3ea', lettering: '#1b1b1b', accent: '#e8462a', style: 'bold', category: 'clothing' },
  denimDiaries: { name: 'Denim Diaries', tagline: 'Jeans · Tees · Jackets', background: '#1d3f8f', lettering: '#ffffff', accent: '#9cc3ff', style: 'bold', category: 'clothing' },
  banyanEdit: { name: 'Banyan Edit', tagline: 'Family fashion', background: '#2f2a26', lettering: '#f2e6d0', accent: '#c9a26b', style: 'serif', category: 'clothing' },
  malligeThreads: { name: 'Mallige Threads', tagline: 'Indie labels', background: '#ffffff', lettering: '#0f5c4d', accent: '#0f5c4d', style: 'serif', category: 'clothing' },
  fitcheck: { name: 'Fitcheck', tagline: 'Fashion · Home', background: '#0b7a3e', lettering: '#ffffff', accent: '#ffe066', style: 'bold', category: 'clothing' },
  strideShoe: { name: 'Stride Shoe Co.', tagline: 'Footwear for the family', background: '#d71f26', lettering: '#ffffff', accent: '#ffffff', style: 'bold', category: 'footwear' },
  sprintLab: { name: 'Sprint Lab', tagline: 'Sport · Run · Train', background: '#141414', lettering: '#ffffff', accent: '#39d353', style: 'caps', category: 'sportswear' },
  paceRepublic: { name: 'Pace Republic', tagline: 'Running store', background: '#1c2f6b', lettering: '#ffffff', accent: '#ff7a2e', style: 'caps', category: 'sportswear' },
  clearview: { name: 'Clearview Optics', tagline: 'Eyeglasses · Sunglasses', background: '#14b8a6', lettering: '#ffffff', accent: '#0b5d55', style: 'bold', category: 'eyewear' },
  swarnaMahal: { name: 'Swarna Mahal', tagline: 'Jewellers since 1962', background: '#5a1020', lettering: '#f5cf6b', accent: '#f5cf6b', style: 'serif', category: 'jewellery' },
  voltBazaar: { name: 'Volt Bazaar', tagline: 'Electronics megastore', background: '#0d47a1', lettering: '#ffffff', accent: '#ffca28', style: 'bold', category: 'electronics' },
  gadgetGalli: { name: 'Gadget Galli', tagline: 'Phones · Laptops · TVs', background: '#00a19a', lettering: '#ffffff', accent: '#ffffff', style: 'bold', category: 'electronics' },
  byteCorner: { name: 'Byte Corner', tagline: 'Phones & smart home', background: '#101820', lettering: '#ffffff', accent: '#4aa8ff', style: 'caps', category: 'electronics' },
  siliconSquare: { name: 'Silicon Square', tagline: 'Laptops · Tablets · Watches', background: '#f4f4f4', lettering: '#222222', accent: '#888888', style: 'caps', category: 'electronics' },
  crispyCoop: { name: 'Crispy Coop', tagline: 'Fried chicken', background: '#b71c1c', lettering: '#ffffff', accent: '#ffffff', style: 'bold', category: 'fast_food' },
  bigBun: { name: 'Big Bun Burgers', tagline: 'Burgers · Fries · Shakes', background: '#ffb300', lettering: '#7a1f00', accent: '#c62828', style: 'bold', category: 'fast_food' },
  burgerRaja: { name: 'Burger Raja', tagline: 'Flame grilled', background: '#5d2c0e', lettering: '#ffcc80', accent: '#e65100', style: 'bold', category: 'fast_food' },
  sliceStation: { name: 'Slice Station', tagline: 'Pizza in 30 minutes', background: '#0b5aa8', lettering: '#ffffff', accent: '#e53935', style: 'bold', category: 'fast_food' },
  rollSub: { name: 'Roll & Sub', tagline: 'Fresh subs and wraps', background: '#1b7a2f', lettering: '#ffde3b', accent: '#ffde3b', style: 'bold', category: 'fast_food' },
  filterHouse: { name: 'Filter House', tagline: 'Coffee roasters', background: '#0e3b2e', lettering: '#ffffff', accent: '#d9b26f', style: 'serif', category: 'cafe' },
  brewRepublic: { name: 'Brew Republic', tagline: 'Coffee · Bakes', background: '#f1e7d8', lettering: '#3b2416', accent: '#3b2416', style: 'caps', category: 'cafe' },
} satisfies Record<string, Chain>

export type ChainId = keyof typeof CHAINS

/** The chains in a fixed order: each one's row in the sign picture. */
export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[]

export type Landmark = { chain: ChainId; lat: number; lng: number }

/** Where each branch is. Comments say which road it's on, so it's easy to find in the game. */
export const LANDMARKS: Landmark[] = [
  { chain: 'stitchStrut', lat: 12.9111048, lng: 77.6382391 }, // 14th Main, Sector 3
  { chain: 'stitchStrut', lat: 12.9152561, lng: 77.6516934 }, // 27th Main, Sector 1
  { chain: 'crispyCoop', lat: 12.9054175, lng: 77.65109 }, // 27th Main, Sector 2
  { chain: 'crispyCoop', lat: 12.9133776, lng: 77.6383158 }, // 14th Main, by the BDA Complex
  { chain: 'bigBun', lat: 12.9121069, lng: 77.6379062 }, // 14th Main, Sector 7
  { chain: 'burgerRaja', lat: 12.9119096, lng: 77.638191 }, // Sector 6
  { chain: 'sliceStation', lat: 12.9127896, lng: 77.652029 }, // PWD Quarters, Sector 1
  { chain: 'sliceStation', lat: 12.9230442, lng: 77.6464492 }, // Agara, Sector 1
  { chain: 'sliceStation', lat: 12.9127862, lng: 77.6322633 }, // Sector 6
  { chain: 'rollSub', lat: 12.911839, lng: 77.6379424 }, // 14th Main, Sector 7
  { chain: 'filterHouse', lat: 12.9121583, lng: 77.6507972 }, // 24th Main, Sector 1
  { chain: 'brewRepublic', lat: 12.9117774, lng: 77.6502136 }, // 17th Cross, Sector 1
  { chain: 'brewRepublic', lat: 12.9099471, lng: 77.6378504 }, // 14th Main, Sector 7
  { chain: 'brewRepublic', lat: 12.9095219, lng: 77.6326659 }, // 5th Main, Sector 7
  { chain: 'paisleyPop', lat: 12.9120831, lng: 77.6492 }, // Sector 2
  { chain: 'denimDiaries', lat: 12.9105711, lng: 77.6379491 }, // 14th Main, Sector 7
  { chain: 'banyanEdit', lat: 12.9139985, lng: 77.6382908 }, // 14th Main, by the BDA Complex
  { chain: 'malligeThreads', lat: 12.9117648, lng: 77.6491872 }, // Parangi Palya, Sector 2
  { chain: 'fitcheck', lat: 12.9115614, lng: 77.6382888 }, // Sector 3
  { chain: 'strideShoe', lat: 12.9141813, lng: 77.6383091 }, // 14th Main, by the BDA Complex
  { chain: 'strideShoe', lat: 12.9070104, lng: 77.6490084 }, // 24th Main, Sector 2
  { chain: 'strideShoe', lat: 12.9233279, lng: 77.6514953 }, // 27th Main, Sector 1
  { chain: 'sprintLab', lat: 12.9168048, lng: 77.6519015 }, // 27th Main, Sector 1
  { chain: 'paceRepublic', lat: 12.9186936, lng: 77.6518104 }, // 27th Main, Sector 1
  { chain: 'voltBazaar', lat: 12.9125903, lng: 77.6337177 }, // 17th Cross, Sector 6
  { chain: 'gadgetGalli', lat: 12.9122409, lng: 77.6374743 }, // Sarjapur Road, Sector 7
  { chain: 'byteCorner', lat: 12.9159808, lng: 77.6519143 }, // 27th Main, Sector 1
  { chain: 'siliconSquare', lat: 12.9166206, lng: 77.6518859 }, // 27th Main, Sector 1
  { chain: 'clearview', lat: 12.9076745, lng: 77.6517358 }, // 27th Main, Sector 2
  { chain: 'clearview', lat: 12.9122287, lng: 77.6359457 }, // 17th Cross, Sector 7
  { chain: 'clearview', lat: 12.9234944, lng: 77.6514531 }, // 27th Main, Agara
  { chain: 'clearview', lat: 12.9060117, lng: 77.6491305 }, // 24th Main, Sector 2
  { chain: 'swarnaMahal', lat: 12.9122258, lng: 77.6369507 }, // 17th Cross, Sector 7
]

/** A landmark's sign, on the front of its building. */
export type LandmarkSign = {
  chain: ChainId
  x: number
  z: number
  /** Which way it faces, in radians around Y. */
  rotation: number
  width: number
  height: number
}

/** A mapped point is usually within this of its building, in metres. */
const REACH = 22
/** Points round the mapped spot to look for walls from, so a wall facing the street can win over a nearer side wall. */
const SEARCH_RADIUS = 7
const SEARCH_POINTS = 8
const MIN_WALL = 3.5
const MAX_SIGN_WIDTH = 8
/** A wall counts as facing the street if a road starts within this far in front of it. */
const STREET_IN_FRONT = 9
/** Signs closer than this are on the same shop front: the second moves along the wall or is dropped. */
const MIN_GAP = 2

/**
 * Finds each landmark's building and the wall it faces the street with, and
 * puts a sign above the ground floor there. Of the walls near the mapped spot,
 * it takes the nearest one with a road in front of it.
 */
export function placeLandmarkSigns(roads: LineFeature[], collisions: CollisionWorld): LandmarkSign[] {
  const roadIndex = indexRoadPieces(toRoadPieces(roads))
  const signs: LandmarkSign[] = []

  for (const { chain, lat, lng } of LANDMARKS) {
    const [x, , z] = lonLatToWorld([lng, lat])
    if (!isInsideBounds(x, z)) continue

    const starts: [number, number][] = [[x, z]]
    for (let i = 0; i < SEARCH_POINTS; i++) {
      const angle = (i / SEARCH_POINTS) * Math.PI * 2
      starts.push([x + Math.cos(angle) * SEARCH_RADIUS, z + Math.sin(angle) * SEARCH_RADIUS])
    }

    let best: { score: number; sign: LandmarkSign } | null = null
    for (const [startX, startZ] of starts) {
      const wall = findNearestWall(collisions, startX, startZ, REACH)
      if (!wall || wall.length < MIN_WALL) continue
      const ahead = nearestRoadEdge(roadIndex, wall.x + wall.normalX * 1.5, wall.z + wall.normalZ * 1.5, STREET_IN_FRONT)
      const facesStreet = ahead < STREET_IN_FRONT
      const score = Math.hypot(wall.x - x, wall.z - z) + (facesStreet ? 0 : 100)
      if (best && score >= best.score) continue

      const width = Math.min(MAX_SIGN_WIDTH, wall.length * 0.85)
      // Centred on the nearest point of the wall, but kept between its corners.
      const half = width / 2 + 0.2
      const along = Math.min(Math.max(wall.offset, half), wall.length - half)
      best = {
        score,
        sign: {
          chain,
          x: wall.startX + wall.alongX * along,
          z: wall.startZ + wall.alongZ * along,
          rotation: Math.atan2(wall.normalX, wall.normalZ),
          width,
          height: Math.min(1.3, Math.max(0.85, width * 0.17)),
        },
      }
    }
    if (!best) continue
    if (signs.some((sign) => Math.hypot(sign.x - best.sign.x, sign.z - best.sign.z) < MIN_GAP)) continue
    signs.push(best.sign)
  }
  return signs
}
