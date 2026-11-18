import type { PeriodId } from '../game/duty'
import { roughStars, starsFromFrustration } from './customerChat'
/**
 * Who an order is for, what's in it, and how they feel when it arrives. The
 * dark store is a fashion one: clothes, shoes and accessories, delivered fast.
 * The base reward never depends on any of this: the rating only decides the
 * tip, which is always extra. Every name here is made up, and so is every item:
 * no real brand appears.
 */

/**
 * How an item wants to be carried. A fragile one minds bumps (speed breakers
 * and potholes taken fast). One for an event (a wedding, an interview, a
 * party) minds the clock.
 */
export type Care = 'none' | 'fragile' | 'event'

export type OrderStory = {
  customer: string
  item: string
  care: Care
  /** What the customer wrote when they ordered. */
  note: string
}

/** `when`: the times of day it's ordered; left out, any time. */
type Item = { item: string; care: Care; note: string; when?: PeriodId[] }

const ITEMS: Item[] = [
  { item: 'A bottle of perfume', care: 'fragile', note: "It's a gift, and it's glass! Gently over the humps please." },
  { item: 'Glass bangles', care: 'fragile', note: 'Two dozen glass bangles for the function. Handle with care, maga.' },
  { item: 'A pair of sunglasses', care: 'fragile', note: 'New sunglasses. Please no jumping over the breakers!' },
  { item: 'A gift-wrapped watch', care: 'fragile', note: "It's for my husband's birthday. Don't shake it too much!" },
  { item: 'A silk saree', care: 'event', note: "My cousin's wedding starts at 7. I need it before that!", when: ['lunch', 'evening'] },
  { item: 'A formal blazer', care: 'event', note: 'Interview in an hour and my blazer has a stain. Please hurry!', when: ['morning', 'lunch'] },
  { item: 'A party dress', care: 'event', note: "Office party tonight and I've nothing to wear. Bega banni!", when: ['evening'] },
  { item: 'A sherwani', care: 'event', note: "Sangeet is tonight. I'm the groom's brother, I can't be late!", when: ['evening'] },
  { item: 'White sneakers', care: 'none', note: "Size 9. I'll try them on at the gate, wait two minutes na." },
  { item: 'An oversized tee', care: 'none', note: 'Black, size L. Thank you!' },
  { item: 'A cotton kurta', care: 'none', note: "For the pooja tomorrow. Ring twice, the bell's a bit weak.", when: ['evening', 'night'] },
  { item: 'Jeans to try on', care: 'none', note: 'Try and buy. If they fit, I keep both pairs!' },
  { item: 'Silver jhumkas', care: 'none', note: 'To match my new saree. Thank you!' },
  { item: 'A hoodie', care: 'none', note: 'It got cold all of a sudden. Grey one please.', when: ['evening', 'night'] },
  { item: 'Running shoes', care: 'none', note: 'Starting my 5K training tomorrow morning!', when: ['evening', 'night'] },
  { item: 'Gym shorts', care: 'none', note: 'Gym at 7, forgot mine. Fast fast please!', when: ['morning'] },
  { item: 'A formal shirt', care: 'event', note: 'Client meeting at noon and my shirt is torn. Help!', when: ['morning'] },
  { item: 'A light kurti', care: 'none', note: 'For lunch with the office gang. Thank you!', when: ['lunch'] },
  { item: 'Comfy pyjamas', care: 'none', note: 'Late night order, sorry! The gate is open.', when: ['night'] },
  { item: 'A leather handbag', care: 'none', note: "Bruno will bark at the gate. He's friendly!" },
]

const CUSTOMERS = [
  'Priya',
  'Arjun',
  'Lakshmi aunty',
  'Rahul',
  'Divya',
  'Manju',
  'Suresh uncle',
  'Ayesha',
  'Karthik',
  'Nandini',
  'Farhan',
  'Meera',
  'Vikram',
  'Shwetha',
  'Joseph',
  'Ananya',
]

const pick = <T>(items: T[], random: () => number): T => items[Math.floor(random() * items.length)]

/** An order, with what's ordered fitting the time of day when `period` is given. */
export function createOrderStory(random: () => number, period?: PeriodId): OrderStory {
  const items = period ? ITEMS.filter(({ when }) => !when || when.includes(period)) : ITEMS
  const { item, care, note } = pick(items, random)
  return { customer: pick(CUSTOMERS, random), item, care, note }
}

/** What carrying an item needs, said on the phone while it's on board. */
export const CARE_HINTS: Record<Care, string> = {
  none: '',
  fragile: 'Fragile: take breakers and potholes below half speed',
  event: 'For an event: arrive on time',
}

/** Tips by star rating, from 0 to 5 stars. */
const TIPS = [0, 0, 0, 5, 15, 30]
/** A 5-star tip, before any streak. */
export const TOP_TIP = TIPS[5]
/** Each 5-star delivery in a row after the first adds this to the tip, up to `STREAK_TIP_MAX`. */
const STREAK_TIP = 5
const STREAK_TIP_MAX = 25

/** Over this share of the time limit counts as very late. */
const VERY_LATE = 1.5

export type Rating = {
  stars: number
  tip: number
  /** Why stars were lost, in a few words each, so the rider learns what customers like. */
  lost: string[]
  /** What the customer says. */
  reaction: string
}

type RatingInput = {
  story: OrderStory
  seconds: number
  onTimeSeconds: number
  crashes: number
  /** Hard landings while the order was on board. */
  knocks: number
  /** 5-star deliveries in a row before this one. */
  streak: number
  /** How frustrated the customer got, 0 to 1 (customerChat.ts). Given, it sets the stars and trims the tip. */
  frustration?: number
  /** How roughly the order was carried (customerChat.ts): seen at the door, it costs stars and tip. */
  roughness?: number
}

/**
 * Starts at 5 stars and takes off for lateness, crashes, and the item's own
 * needs. Never below 1. The tip follows the stars.
 */
export function rateDelivery({ story, seconds, onTimeSeconds, crashes, knocks, streak, frustration, roughness = 0 }: RatingInput): Rating {
  let stars = 5
  const lost: string[] = []
  const take = (count: number, reason: string) => {
    if (count <= 0) return
    stars -= count
    lost.push(`${reason} −${count}★`)
  }

  const late = seconds > onTimeSeconds
  take(seconds > onTimeSeconds * VERY_LATE ? 2 : late ? 1 : 0, 'Late')
  take(Math.min(2, crashes), crashes === 1 ? '1 crash' : `${crashes} crashes`)
  // One bump is forgiven: HSR has a lot of breakers.
  if (story.care === 'fragile') take(knocks >= 4 ? 2 : knocks >= 2 ? 1 : 0, `${knocks} bumps`)
  if (story.care === 'event') take(late ? 1 : 0, 'Nearly missed the event')
  stars = Math.max(1, stars)

  // With the customer's frustration known, the wait sets the stars and the parcel's condition takes
  // some off at the door; the reasons above say what caused it.
  if (frustration !== undefined) {
    stars = Math.max(1, starsFromFrustration(frustration) - roughStars(roughness))
    lost.splice(0, lost.length, ...lost.map((reason) => reason.replace(/ −\d★$/, '')))
    if (stars < 5 && lost.length === 0) lost.push('Kept waiting')
  }

  const streakTip = stars === 5 ? Math.min(STREAK_TIP_MAX, streak * STREAK_TIP) : 0
  const tip = Math.round((TIPS[stars] + streakTip) * (1 - (frustration ?? 0) * 0.5) * (1 - Math.min(1, roughness) * 0.5))
  return { stars, tip, lost: stars === 5 ? [] : lost, reaction: reactionFor(story, stars, late, knocks, crashes) }
}

function reactionFor(story: OrderStory, stars: number, late: boolean, knocks: number, crashes: number): string {
  if (stars === 5) {
    if (story.care === 'fragile') return 'Perfect, not a scratch on it. Thank you so much!'
    if (story.care === 'event') return 'Just in time! I look sakkath, thank you!'
    return 'Super fast! Sakkath, thank you!'
  }
  if (stars === 1) return 'Finally! I was waiting so long.'
  // The customer talks about whatever they noticed most.
  if (story.care === 'event' && late) return stars === 4 ? 'I had to rush to get ready, but okay. Thanks!' : 'I nearly missed it! Next time faster, okay?'
  if (story.care === 'fragile' && knocks >= 2) return stars === 4 ? 'Bit bumpy, but it looks fine. Thanks!' : 'Quite a bumpy ride, no? But okay, thanks.'
  if (crashes > 0) return story.care === 'fragile' ? 'The box is all dented! I hope it\'s not broken inside.' : 'Why is the bag so crushed? Okay, thanks I guess.'
  if (late) return stars === 4 ? 'Bit late, but no problem. Thanks!' : 'Took quite long, no? Okay, thanks.'
  return 'Thank you! All good.'
}

/** The last ratings kept for the rider's average, like a delivery app's. */
export const RATINGS_KEPT = 20

/** The rider's rating: the average of their recent deliveries, or null before the first. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null
  return ratings.reduce((sum, stars) => sum + stars, 0) / ratings.length
}
