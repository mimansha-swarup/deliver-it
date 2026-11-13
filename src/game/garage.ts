/**
 * What the Garage at the dark store sells: three upgrades, each with three
 * levels, and paint and helmet colours. Prices are in credits. A delivery pays
 * about 60–200, so the first upgrade is a couple of orders away and the whole
 * lot is about 40.
 */
export type UpgradeKind = 'engine' | 'tyres' | 'brakes'
export type UpgradeLevels = Record<UpgradeKind, number>

export const MAX_UPGRADE_LEVEL = 3

export const UPGRADES: Record<UpgradeKind, { name: string; effect: string; prices: number[] }> = {
  engine: { name: 'Engine', effect: '+2 km/h top speed and quicker pull-away', prices: [150, 350, 700] },
  tyres: { name: 'Tyres', effect: 'More grip, and less sliding in the rain', prices: [150, 350, 700] },
  brakes: { name: 'Brakes', effect: 'Stops harder', prices: [120, 280, 560] },
}

export const UPGRADE_KINDS = Object.keys(UPGRADES) as UpgradeKind[]

export type Colour = {
  id: string
  name: string
  color: string
  price: number
  /** Can't be bought: it's earned by finishing a career chapter. */
  careerOnly?: boolean
}

/** The first of each is what you start with, free. */
export const PAINTS: Colour[] = [
  { id: 'midnight', name: 'Midnight', color: '#17181b', price: 0 },
  { id: 'signal-red', name: 'Signal red', color: '#c62828', price: 100 },
  { id: 'rickshaw-yellow', name: 'Rickshaw yellow', color: '#f2b705', price: 100 },
  { id: 'mint', name: 'Mint', color: '#3ddc97', price: 100 },
  { id: 'sunset', name: 'Sunset orange', color: '#f26b1d', price: 100 },
  { id: 'ocean', name: 'Ocean blue', color: '#1e5fbf', price: 100 },
  { id: 'pearl', name: 'Pearl white', color: '#e9e7e1', price: 100 },
  { id: 'dark-store-green', name: 'Dark store green', color: '#0f6b4a', price: 0, careerOnly: true },
]

export const HELMETS: Colour[] = [
  { id: 'white', name: 'White', color: '#f4f3ef', price: 0 },
  { id: 'black', name: 'Gloss black', color: '#1a1b1e', price: 80 },
  { id: 'red', name: 'Racing red', color: '#d32f2f', price: 80 },
  { id: 'yellow', name: 'Hi-vis yellow', color: '#ffd400', price: 80 },
]

export function findColour(list: Colour[], id: string): Colour {
  return list.find((item) => item.id === id) ?? list[0]
}

/** How close to the dark store's kerb the rider must be, and how slow, for the Garage to open. */
export const GARAGE_RANGE = 16
export const GARAGE_MAX_SPEED = 1.5
