import type { PeriodId } from '../game/duty'
import type { OrderType } from '../vehicle/vehicleCatalog'
import { roughStars, starsFromFrustration } from './customerChat'
import { CARGO, conditionStars, type CargoType } from './cargo'
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
  /** How patient they are: 1 is usual, more waits longer before getting annoyed (see CUSTOMERS). */
  patience: number
  item: string
  care: Care
  /** What the customer wrote when they ordered. */
  note: string
  /** A kind of order only some vehicles carry (vehicleCatalog.ts): bulk needs a cargo vehicle, catering a car or van. */
  needs?: OrderType
  /** What kind of thing it is to carry (cargo.ts): fragile, hot, frozen, medicine, bulk, or a plain parcel. */
  cargo: CargoType
}

/**
 * Whether an order of a kind can be offered at all: set by the fleet (game/fleet.ts) to "the rider's
 * vehicle carries it, or GaadiGo would rent them one that does". Until then, only everyday parcels.
 */
export const orderRules: { canOffer: (type: OrderType) => boolean } = { canOffer: () => false }

/** `when`: the times of day it's ordered; left out, any time. */
/** `cargo`: its kind to carry, when it isn't a plain parcel; left out, fragile care means fragile cargo and a bulk order bulk. */
type Item = { item: string; care: Care; note: string; when?: PeriodId[]; needs?: OrderType; cargo?: CargoType }

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
  // Local to the temples and offices round Agara.
  { item: 'Jasmine and marigold garlands', care: 'fragile', note: "For the evening pooja. Please don't crush the flowers!", when: ['morning', 'evening'] },
  { item: 'A dozen tender coconuts', care: 'none', note: 'For the function at home. Heavy, I know. Thank you, maga!', when: ['morning', 'lunch'], needs: 'bulk' },
  { item: 'Twenty kilos of rice and dal', care: 'none', note: "For the PG's kitchen. The cook will help you unload.", needs: 'bulk' },
  { item: 'Four crates of mangoes', care: 'fragile', note: "Season's first Badami! Please don't bruise them.", when: ['morning', 'lunch'], needs: 'bulk' },
  { item: 'A pooja thali set', care: 'fragile', note: 'Brass lamps and a glass of kumkum. Gently over the humps please.', when: ['morning', 'evening'] },
  { item: 'Agarbatti, camphor and oil', care: 'none', note: "It's Saturday, Hanuman's day. Before the aarti if you can!", when: ['morning', 'evening'] },
  { item: 'Six office lunch boxes', care: 'event', note: 'Team lunch at one sharp. The whole floor is hungry!', when: ['lunch'], needs: 'catering' },
  { item: 'Lunch for the stand-up meeting', care: 'event', note: 'Meeting ends at 1:30 and they eat at their desks. Bega banni!', when: ['lunch'], needs: 'catering' },
  { item: 'Biryani for forty', care: 'event', note: "It's my daughter's naming ceremony. Hot and on time, please!", when: ['lunch', 'evening'], needs: 'catering', cargo: 'hot' },
  // Cakes: fragile, and they show every bump.
  { item: 'A birthday cake', care: 'fragile', note: "It's Chintu's fifth birthday. The icing has his name on it, please keep it flat!", cargo: 'fragile' },
  { item: 'A box of cupcakes', care: 'fragile', note: 'Twelve cupcakes for the office farewell. No upside-down ones please!', when: ['lunch', 'evening'], cargo: 'fragile' },
  { item: 'An eggless plum cake', care: 'fragile', note: "For my in-laws' anniversary. Slowly over the humps, maga.", when: ['evening', 'night'], cargo: 'fragile' },
  // Hot food: it cools from the counter on.
  { item: 'Masala dosa and filter coffee', care: 'none', note: "Don't let the dosa go soft! Straight here please.", when: ['morning', 'evening'], cargo: 'hot' },
  { item: 'Two plates of chicken biryani', care: 'none', note: 'Starving since morning. Hot hot please!', when: ['lunch', 'evening', 'night'], cargo: 'hot' },
  { item: 'Bisi bele bath and vada', care: 'none', note: 'It has "bisi" in the name only. Bring it hot!', when: ['morning', 'lunch'], cargo: 'hot' },
  { item: 'Gobi manchurian and noodles', care: 'none', note: 'Movie night. If it comes cold I will cry.', when: ['evening', 'night'], cargo: 'hot' },
  // Ice cream: it melts, faster in the sun.
  { item: 'A tub of mango ice cream', care: 'none', note: 'Guests are here already. Before it becomes milkshake!', when: ['lunch', 'evening'], cargo: 'frozen' },
  { item: 'Six kulfi sticks', care: 'none', note: 'For the kids after their match. Bega, it is so hot today!', when: ['lunch', 'evening'], cargo: 'frozen' },
  { item: 'A family pack of butterscotch', care: 'none', note: 'Sunday special. Please come by the shady road!', cargo: 'frozen' },
  // Medicine: urgent, and it pays double.
  { item: 'Fever medicine and a thermometer', care: 'event', note: 'My son has 102. Please come fast, I can\'t leave him.', cargo: 'medicine' },
  { item: 'An asthma inhaler', care: 'event', note: "Ajji's inhaler is empty. As quick as you safely can!", cargo: 'medicine' },
  { item: 'Insulin, in a cool pack', care: 'event', note: 'Appa needs it before dinner. Thank you so much.', when: ['evening', 'night'], cargo: 'medicine' },
  { item: 'ORS and antacid', care: 'event', note: 'Bad chaat yesterday. Urgent urgent!', cargo: 'medicine' },
]

/**
 * The customers, made up, each with their patience: the aunties and uncles have seen worse and
 * wait; the start-up founder and the student on a deadline don't. 1 is usual.
 */
const CUSTOMERS: { name: string; patience: number }[] = [
  { name: 'Priya', patience: 1 },
  { name: 'Arjun', patience: 0.8 },
  { name: 'Lakshmi aunty', patience: 1.45 },
  { name: 'Rahul', patience: 0.75 },
  { name: 'Divya', patience: 1.1 },
  { name: 'Manju', patience: 1.2 },
  { name: 'Suresh uncle', patience: 1.35 },
  { name: 'Ayesha', patience: 0.9 },
  { name: 'Karthik', patience: 0.85 },
  { name: 'Nandini', patience: 1.15 },
  { name: 'Farhan', patience: 1 },
  { name: 'Meera', patience: 1.05 },
  { name: 'Vikram', patience: 0.7 },
  { name: 'Shwetha', patience: 0.95 },
  { name: 'Joseph', patience: 1.25 },
  { name: 'Ananya', patience: 0.9 },
]

const pick = <T>(items: T[], random: () => number): T => items[Math.floor(random() * items.length)]

/** The customers who are women: the body at the door, and the voice, go by the name (the rest are men). */
const WOMEN = new Set(['Priya', 'Lakshmi aunty', 'Divya', 'Ayesha', 'Nandini', 'Meera', 'Shwetha', 'Ananya'])
export const isWoman = (name: string) => WOMEN.has(name)

/**
 * Which of the four bodies a customer has (Handoff.tsx: the man, the teenager, the older woman, the
 * younger woman), as the 0 to 1 `look` they're picked by: a woman's name gets a woman, an uncle or
 * an aunty the older one, and the same name is always the same person.
 */
export function customerLook(name: string): number {
  let sum = 0
  for (let i = 0; i < name.length; i++) sum = (sum * 31 + name.charCodeAt(i)) % 9973
  const older = /uncle|aunty/.test(name) || sum % 3 === 0
  const body = (isWoman(name) ? 2 : 0) + (older ? 0 : 1)
  return (body + 0.5) / 4
}

/** An order, with what's ordered fitting the time of day when `period` is given. */
export function createOrderStory(random: () => number, period?: PeriodId): OrderStory {
  const timely = period ? ITEMS.filter(({ when }) => !when || when.includes(period)) : ITEMS
  // Orders that need a kind of vehicle are only offered when the rider has, or could rent, one.
  const items = timely.filter(({ needs }) => !needs || orderRules.canOffer(needs))
  const { item, care, note, needs, cargo: kind } = pick(items, random)
  const { name, patience } = pick(CUSTOMERS, random)
  const cargo: CargoType = kind ?? (needs === 'bulk' ? 'bulk' : care === 'fragile' ? 'fragile' : 'parcel')
  // Someone waiting on medicine is short of patience.
  return { customer: name, patience: cargo === 'medicine' ? patience * 0.8 : patience, item, care, note, cargo, ...(needs ? { needs } : {}) }
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
  /** The state it arrives in, 1 as it left the counter to 0 spoiled (cargo.ts). */
  condition?: number
}

/**
 * Starts at 5 stars and takes off for lateness, crashes, and the item's own
 * needs. Never below 1. The tip follows the stars.
 */
export function rateDelivery({ story, seconds, onTimeSeconds, crashes, knocks, streak, frustration, roughness = 0, condition = 1 }: RatingInput): Rating {
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
  // A bump or two on a fragile order is forgiven: it takes four to cost a star, and eight to cost two.
  if (story.care === 'fragile') take(knocks >= 8 ? 2 : knocks >= 4 ? 1 : 0, `${knocks} bumps`)
  if (story.care === 'event') take(late ? 1 : 0, 'Nearly missed the event')
  stars = Math.max(1, stars)

  // With the customer's frustration known, the wait sets the stars and the parcel's condition takes
  // some off at the door; the reasons above say what caused it.
  if (frustration !== undefined) {
    // On time is on time: however the wait felt to them (an impatient customer, most of the clock
    // used), an order that arrives inside its time loses no star for the wait. Their mood still
    // shows on the meter and trims the tip. Late, the wait sets the stars.
    stars = Math.max(1, (late ? starsFromFrustration(frustration) : 5) - roughStars(roughness))
    lost.splice(0, lost.length, ...lost.map((reason) => reason.replace(/ −\d★$/, '')))
    // Say what it was: a rough ride is not a long wait.
    if (roughStars(roughness) > 0 && crashes === 0 && !lost.some((reason) => reason.includes('bumps'))) lost.push('Rough ride')
    if (stars < 5 && lost.length === 0) lost.push('Kept waiting')
  }

  // What it's like when it arrives: a cake dented, food gone cold, ice cream melted (cargo.ts).
  const state = conditionStars(story.cargo, condition)
  if (state.stars > 0) {
    stars = Math.max(1, stars - state.stars)
    lost.push(state.reason)
  }

  const streakTip = stars === 5 ? Math.min(STREAK_TIP_MAX, streak * STREAK_TIP) : 0
  const spoilt = CARGO[story.cargo].meter ? Math.max(0, Math.min(1, condition)) : 1
  const tip = Math.round((TIPS[stars] + streakTip) * (1 - (frustration ?? 0) * 0.5) * (1 - Math.min(1, roughness) * 0.5) * (0.4 + 0.6 * spoilt))
  const reaction = state.stars > 0 ? conditionReaction(story, condition) : reactionFor(story, stars, late, knocks, crashes)
  return { stars, tip, lost: stars === 5 ? [] : lost, reaction }
}

/** What the customer says about an order that arrived the worse for the ride. */
function conditionReaction(story: OrderStory, condition: number): string {
  const ruined = condition < 0.25
  if (story.cargo === 'hot') return ruined ? 'This is stone cold! I could have cooked by now.' : 'Hmm, it has gone a bit cold. I will heat it up, okay.'
  if (story.cargo === 'frozen') return ruined ? 'Ayyo, it is soup! I ordered ice cream, not milkshake.' : 'It has melted a bit. Straight into the freezer with it.'
  return ruined ? 'Ayyo! It is completely smashed. What happened on the way?' : 'It got knocked about a bit, no? Okay, it will do.'
}

function reactionFor(story: OrderStory, stars: number, late: boolean, knocks: number, crashes: number): string {
  if (story.cargo === 'medicine') {
    if (stars === 5) return 'You came so fast. Thank you, thank you. God bless you!'
    return late ? 'We were waiting and waiting. But thank you for coming.' : 'Thank you. That was needed.'
  }
  if (stars === 5) {
    if (story.cargo === 'hot') return 'Still piping hot! Super, thank you!'
    if (story.cargo === 'frozen') return 'Still frozen solid. Sakkath, thank you!'
    if (story.care === 'fragile') return 'Perfect, not a scratch on it. Thank you so much!'
    if (story.care === 'event') return 'Just in time! I look sakkath, thank you!'
    return 'Super fast! Sakkath, thank you!'
  }
  if (stars === 1) return 'Finally! I was waiting so long.'
  // The customer talks about whatever they noticed most.
  if (story.care === 'event' && late) return stars === 4 ? 'I had to rush to get ready, but okay. Thanks!' : 'I nearly missed it! Next time faster, okay?'
  if (story.care === 'fragile' && knocks >= 4) return stars === 4 ? 'Bit bumpy, but it looks fine. Thanks!' : 'Quite a bumpy ride, no? But okay, thanks.'
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
