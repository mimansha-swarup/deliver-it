import type { EngineKind } from '../audio/engines'

/*
 * The vehicles the rider can use, through one framework: every vehicle is the same controller
 * (ScooterController.ts) with its own numbers (handling, tuning.ts), its own body (VehicleBody in
 * Scooter.tsx), engine voice (PlayerSounds.tsx) and camera (FollowCamera.tsx). The scooter is the
 * one the rider starts with; the rest are rented or bought through GaadiGo (game/fleet.ts).
 *
 * Every name here is made up.
 */

export type VehicleId = 'scooter' | 'bicycle' | 'ev' | 'bike' | 'trike' | 'van' | 'car'

/** Kinds of order a vehicle can carry, beyond the everyday parcel that anything takes. */
export type OrderType = 'parcel' | 'eco' | 'express' | 'bulk' | 'catering'

export const ORDER_TYPE_NAMES: Record<OrderType, string> = {
  parcel: 'Everyday parcels',
  eco: 'Green deliveries (bonus pay)',
  express: 'Express, cross-town',
  bulk: 'Bulk and heavy loads',
  catering: 'Catering and office lunches',
}

export type VehicleSpec = {
  id: VehicleId
  name: string
  /** What kind of thing it is, in a few words. */
  kind: string
  blurb: string
  /** Top speed in km/h; pull-away, turning, grip and braking against the scooter's (1 is the same). */
  topSpeed: number
  pull: number
  turn: number
  grip: number
  brake: number
  /**
   * How it leans in a corner, against the scooter's lean into it: a two-wheeler leans in (about 1);
   * three and four wheels roll the other way, out of the corner (negative), the heavier the more.
   */
  lean: number
  /**
   * What its power feels like:
   * - `topEnd`: the pull left near top speed, against the scooter's (an electric motor fades, a motorbike keeps pulling);
   * - `response`: how fast the drive follows the throttle, per second (an electric motor at once, a loaded van slowly);
   * - `coast`: how hard it slows off the throttle, in m/s² (regenerative braking is strong, a heavy van rolls on);
   * - `nitro`: whether it has the scooter's nitro and drift boost.
   */
  feel: { topEnd: number; response: number; coast: number; nitro: boolean }
  /** What the speedometer says under the speed: how it's driven. */
  drive: string
  /** Parcels it carries at once. */
  capacity: number
  /** Running cost in rupees a kilometre: petrol, charge or nothing. */
  costPerKm: number
  unlocks: OrderType[]
  /** What the rider needs to rent or buy it: level, and average rating (0 for none). */
  minLevel: number
  minRating: number
  /** Rent by the game hour and by the day, and the price to buy. */
  rentHour: number
  rentDay: number
  price: number
  /** Its engine's voice, and how loud against the scooter's: an electric motor is a quiet whine, a bicycle silent. */
  engine: EngineKind
  engineVolume: number
  /** The chase camera: how far behind and how high, against the scooter's, and where it looks. */
  camera: { distance: number; height: number; look: number }
  /** A view from the driver's seat, where there is one: the eye's place in the vehicle (x right, y up, z ahead). */
  cockpit: [number, number, number] | null
  /**
   * What's drawn: the scooter's own rig (with the rider), or a body from the models' file, with the
   * rider on it (a motorbike) or inside and unseen (`enclosed`).
   */
  body: { rig: 'scooter' | 'bicycle' } | { rig: 'model'; file: 'traffic' | 'yamaha'; model: string; scale: number; riderSeat: [number, number, number] | null }
  /** Paint that replaces the Garage's, for a vehicle that isn't the rider's own scooter. */
  paint: string | null
}

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  scooter: {
    id: 'scooter', name: 'Deliver It scooter', kind: 'Petrol scooter', blurb: 'Your own. Goes anywhere, carries a box.',
    topSpeed: 56, pull: 1, turn: 1, grip: 1, brake: 1, lean: 1, feel: { topEnd: 1, response: 8, coast: 1.6, nitro: true }, drive: 'Petrol', capacity: 2, costPerKm: 1.6, unlocks: ['parcel'],
    minLevel: 1, minRating: 0, rentHour: 0, rentDay: 0, price: 0, engine: 'scooter', engineVolume: 1,
    camera: { distance: 1, height: 1, look: 1 }, cockpit: null, body: { rig: 'scooter' }, paint: null,
  },
  bicycle: {
    id: 'bicycle', name: 'Pedalu City', kind: 'Bicycle', blurb: 'Slow, silent, free to run. Squeezes through anything.',
    topSpeed: 24, pull: 0.5, turn: 1.55, grip: 0.9, brake: 0.62, lean: 0.75, feel: { topEnd: 0.35, response: 2.6, coast: 0.8, nitro: false }, drive: 'Pedal', capacity: 1, costPerKm: 0, unlocks: ['parcel', 'eco'],
    minLevel: 1, minRating: 0, rentHour: 15, rentDay: 60, price: 900, engine: 'scooter', engineVolume: 0,
    camera: { distance: 0.9, height: 0.95, look: 0.95 }, cockpit: null, body: { rig: 'bicycle' }, paint: '#2f7d55',
  },
  ev: {
    id: 'ev', name: 'Minchu E1', kind: 'Electric scooter', blurb: 'Quick off the line, quiet, a third of the running cost.',
    topSpeed: 52, pull: 1.85, turn: 1.1, grip: 1.05, brake: 1.15, lean: 1, feel: { topEnd: 0.55, response: 22, coast: 3.4, nitro: false }, drive: 'Electric · regen', capacity: 2, costPerKm: 0.5, unlocks: ['parcel', 'eco'],
    minLevel: 2, minRating: 0, rentHour: 35, rentDay: 160, price: 3200, engine: 'scooter', engineVolume: 0.3,
    camera: { distance: 1, height: 1, look: 1 }, cockpit: null, body: { rig: 'scooter' }, paint: '#1aa7a1',
  },
  bike: {
    id: 'bike', name: 'Vega 150', kind: 'Commuter motorbike', blurb: 'Much faster on the main roads. Wider turns, harder to stop.',
    topSpeed: 86, pull: 1.2, turn: 0.7, grip: 1.1, brake: 0.66, lean: 1.2, feel: { topEnd: 2.2, response: 4.5, coast: 1.0, nitro: true }, drive: 'Petrol · 150 cc', capacity: 2, costPerKm: 2.2, unlocks: ['parcel', 'express'],
    minLevel: 4, minRating: 4, rentHour: 60, rentDay: 280, price: 6500, engine: 'bike', engineVolume: 1,
    camera: { distance: 1.12, height: 1.02, look: 1 }, cockpit: null,
    body: { rig: 'model', file: 'yamaha', model: 'bike', scale: 1, riderSeat: [0, 0.02, -0.12] }, paint: '#c62828',
  },
  trike: {
    id: 'trike', name: 'Bhaara E-Cargo', kind: 'Electric cargo three-wheeler', blurb: 'Carries a lot, never leans, never hurries.',
    topSpeed: 42, pull: 0.6, turn: 0.58, grip: 1.15, brake: 0.55, lean: -0.3, feel: { topEnd: 0.6, response: 2.4, coast: 1.2, nitro: false }, drive: 'Electric · loaded', capacity: 8, costPerKm: 0.9, unlocks: ['parcel', 'eco', 'bulk'],
    minLevel: 5, minRating: 4, rentHour: 80, rentDay: 380, price: 9500, engine: 'auto', engineVolume: 0.35,
    camera: { distance: 1.35, height: 1.25, look: 1.1 }, cockpit: [0, 1.25, 0.95],
    body: { rig: 'model', file: 'traffic', model: 'auto', scale: 1, riderSeat: null }, paint: '#e9e7e1',
  },
  van: {
    id: 'van', name: 'Saagane Loadstar', kind: 'Cargo van', blurb: 'The biggest loads on the map. Wide, heavy and thirsty.',
    topSpeed: 68, pull: 0.5, turn: 0.48, grip: 1.2, brake: 0.5, lean: -0.24, feel: { topEnd: 0.75, response: 1.7, coast: 0.9, nitro: false }, drive: 'Diesel · heavy', capacity: 20, costPerKm: 5.5, unlocks: ['parcel', 'bulk', 'catering'],
    minLevel: 8, minRating: 4.3, rentHour: 150, rentDay: 700, price: 24000, engine: 'suv', engineVolume: 1,
    camera: { distance: 1.75, height: 1.5, look: 1.25 }, cockpit: [-0.38, 1.38, 0.55],
    body: { rig: 'model', file: 'traffic', model: 'mpv', scale: 1.12, riderSeat: null }, paint: '#e9e7e1',
  },
  car: {
    id: 'car', name: 'Oota Hatch', kind: 'Catering car', blurb: 'Keeps the food level, warm and dry. Quick enough.',
    topSpeed: 78, pull: 0.8, turn: 0.64, grip: 1.2, brake: 0.82, lean: -0.12, feel: { topEnd: 1.1, response: 4, coast: 1.1, nitro: false }, drive: 'Petrol', capacity: 10, costPerKm: 4, unlocks: ['parcel', 'catering', 'express'],
    minLevel: 6, minRating: 4.2, rentHour: 110, rentDay: 520, price: 16000, engine: 'car', engineVolume: 1,
    camera: { distance: 1.55, height: 1.3, look: 1.15 }, cockpit: [-0.34, 1.12, 0.35],
    body: { rig: 'model', file: 'traffic', model: 'hatchback', scale: 1, riderSeat: null }, paint: '#f2b705',
  },
}

/** For sale and for rent, in the order the app lists them. */
export const MARKET: VehicleId[] = ['bicycle', 'ev', 'bike', 'trike', 'car', 'van']

/** The vehicle in use now, and whether the view is from its seat: read every frame by the body, sounds and camera. */
export const liveVehicle = { spec: VEHICLES.scooter, cockpit: false }
