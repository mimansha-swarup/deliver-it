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
  /**
   * Its real size on the road, in metres: what walls, poles, parked vehicles and traffic meet. `cab`:
   * the rider is inside it, so a crash is a jolt and a dent, not a fall.
   */
  size: { width: number; length: number; height: number; cab: boolean }
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
  /** Its horn: one of the traffic's (horns.ts), or a bicycle's bell. */
  horn: 'scooter' | 'bike' | 'auto' | 'hatchback' | 'bus' | 'bell'
  /** The chase camera: how far behind and how high, against the scooter's, and where it looks. */
  camera: { distance: number; height: number; look: number }
  /** A view from the driver's seat, where there is one: the eye's place in the vehicle (x right, y up, z ahead). */
  cockpit: [number, number, number] | null
  /**
   * What's drawn: the scooter's own rig (with the rider), or a body from the models' file, with the
   * rider on it (a motorbike) or inside and unseen (`enclosed`).
   */
  /** Which body it is (vehicleBodies.ts): every one built for the rider, in its own shape. */
  body: 'scooter' | 'bicycle' | 'ev' | 'bike' | 'trike' | 'car' | 'van'
  /**
   * How the rider sits on it or in it (Rider.tsx), in the vehicle's own space (x to the rider's left,
   * y up, z ahead):
   * - `hip`: the hips; `lean`: the back's lean forward, in radians (negative lies back in a car seat);
   * - `column`: how far ahead the steering column is; `grip`: a hand's place from it (half the bars'
   *   width, height, and how far behind the column);
   * - `foot`: the left ankle at rest (the right mirrors it), and whether a foot goes down at a stop;
   * - `pedals`: the feet go round on the bicycle's cranks;
   * - `side`: how far the driver sits to the side (negative is the right, as in India).
   */
  seat: { hip: [number, number, number]; lean: number; column: number; grip: [number, number, number]; foot: [number, number, number]; footDown: boolean; pedals: boolean; side: number }
  /** Paint that replaces the Garage's, for a vehicle that isn't the rider's own scooter. */
  paint: string | null  /**
   * Set on a vehicle taken off the street ("Use any vehicle", game/borrow.ts), which isn't the
   * rider's: its class. Its body is the traffic's own, drawn by the traffic; `id` is then only the
   * owned vehicle it handles most like.
   */
  borrowed?: BorrowClass
}

/** The classes of vehicle on the street, each with one set of handling, size, sound and camera. */
export type BorrowClass = 'twoWheeler' | 'auto' | 'car' | 'van' | 'bus' | 'tanker'

export const VEHICLES: Record<VehicleId, VehicleSpec> = {
  scooter: {
    id: 'scooter', name: 'Deliver It scooter', kind: 'Petrol scooter', blurb: 'Your own. Goes anywhere, carries a box.',
    topSpeed: 56, pull: 1, turn: 1, grip: 1, brake: 1, lean: 1, feel: { topEnd: 1, response: 8, coast: 1.6, nitro: true }, drive: 'Petrol', size: { width: 0.7, length: 1.9, height: 1.5, cab: false }, capacity: 2, costPerKm: 1.6, unlocks: ['parcel'],
    minLevel: 1, minRating: 0, rentHour: 0, rentDay: 0, price: 0, engine: 'scooter', engineVolume: 1, horn: 'scooter',
    camera: { distance: 1, height: 1, look: 1 }, cockpit: null, body: 'scooter', paint: null,
    // Upright, feet flat on the footboard.
    // Fitted to the modelled scooter (the baking script prints these): its bars are at 1.05 m, 0.25 m
    // ahead of the middle, its floorboard's top at 0.39 m and its column at 0.285 m.
    seat: { hip: [0, 0.94, -0.34], lean: 0.12, column: 0.285, grip: [0.29, 1.07, -0.04], foot: [0.13, 0.43, 0.1], footDown: true, pedals: false, side: 0 },
  },
  bicycle: {
    id: 'bicycle', name: 'Pedalu City', kind: 'Bicycle', blurb: 'Slow, silent, free to run. Squeezes through anything.',
    topSpeed: 24, pull: 0.5, turn: 1.55, grip: 0.9, brake: 0.62, lean: 0.75, feel: { topEnd: 0.35, response: 2.6, coast: 0.8, nitro: false }, drive: 'Pedal', size: { width: 0.6, length: 1.75, height: 1.6, cab: false }, capacity: 1, costPerKm: 0, unlocks: ['parcel', 'eco'],
    minLevel: 1, minRating: 0, rentHour: 15, rentDay: 60, price: 900, engine: 'silent', engineVolume: 0, horn: 'bell',
    camera: { distance: 0.9, height: 0.95, look: 0.95 }, cockpit: null, body: 'bicycle', paint: '#2f7d55',
    // High on the saddle, reaching down to the bars, feet on the pedals going round.
    // Fitted to the modelled bicycle: its saddle is at 0.89 m and its bars at 0.9 m, 0.14 m ahead of the middle.
    seat: { hip: [0, 1.03, -0.32], lean: 0.5, column: 0.177, grip: [0.2, 0.93, -0.04], foot: [0.13, 0.4, -0.02], footDown: true, pedals: true, side: 0 },
  },
  ev: {
    id: 'ev', name: 'Minchu E1', kind: 'Electric scooter', blurb: 'Quick off the line, quiet, a third of the running cost.',
    topSpeed: 52, pull: 1.85, turn: 1.1, grip: 1.05, brake: 1.15, lean: 1, feel: { topEnd: 0.55, response: 22, coast: 3.4, nitro: false }, drive: 'Electric · regen', size: { width: 0.7, length: 1.85, height: 1.5, cab: false }, capacity: 2, costPerKm: 0.5, unlocks: ['parcel', 'eco'],
    minLevel: 2, minRating: 0, rentHour: 35, rentDay: 160, price: 3200, engine: 'ev', engineVolume: 1, horn: 'scooter',
    camera: { distance: 1, height: 1, look: 1 }, cockpit: null, body: 'ev', paint: '#1aa7a1',
    seat: { hip: [0, 0.92, -0.3], lean: 0.18, column: 0.44, grip: [0.29, 1.05, -0.11], foot: [0.12, 0.42, 0.1], footDown: true, pedals: false, side: 0 },
  },
  bike: {
    id: 'bike', name: 'Vega 150', kind: 'Commuter motorbike', blurb: 'Much faster on the main roads. Wider turns, harder to stop.',
    topSpeed: 86, pull: 1.2, turn: 0.7, grip: 1.1, brake: 0.66, lean: 1.2, feel: { topEnd: 2.2, response: 4.5, coast: 1.0, nitro: true }, drive: 'Petrol · 150 cc', size: { width: 0.8, length: 2.1, height: 1.6, cab: false }, capacity: 2, costPerKm: 2.2, unlocks: ['parcel', 'express'],
    minLevel: 4, minRating: 4, rentHour: 60, rentDay: 280, price: 6500, engine: 'thumper', engineVolume: 1, horn: 'bike',
    camera: { distance: 1.12, height: 1.02, look: 1 }, cockpit: null,
    // The model's own blue (art/tripo/vega150.glb): its tank is the paint.
    body: 'bike', paint: '#1f5fd0',
    // Fitted to the model: upright on a flat seat at 0.8 m, bars at 1.02 m a little ahead of the middle, feet on pegs under the knees.
    seat: { hip: [0, 0.96, -0.3], lean: 0.26, column: 0.235, grip: [0.3, 1.06, -0.03], foot: [0.2, 0.38, -0.08], footDown: true, pedals: false, side: 0 },
  },
  trike: {
    id: 'trike', name: 'Bhaara E-Cargo', kind: 'Electric cargo three-wheeler', blurb: 'Carries a lot, never leans, never hurries.',
    topSpeed: 42, pull: 0.6, turn: 0.58, grip: 1.15, brake: 0.55, lean: -0.3, feel: { topEnd: 0.6, response: 2.4, coast: 1.2, nitro: false }, drive: 'Electric · loaded', size: { width: 1.3, length: 2.9, height: 1.9, cab: true }, capacity: 8, costPerKm: 0.9, unlocks: ['parcel', 'eco', 'bulk'],
    minLevel: 5, minRating: 4, rentHour: 80, rentDay: 380, price: 9500, engine: 'evCargo', engineVolume: 1, horn: 'auto',
    camera: { distance: 1.5, height: 1.35, look: 1.15 }, cockpit: [0, 1.5, 0.3],
    // Its cargo box is the paint, in Deliver It's yellow, with the logo on it (art/tripo/bhaara_ecargo.glb).
    body: 'trike', paint: '#f2b82a',
    // On the cab's bench, upright, at scooter-style bars.
    seat: { hip: [0, 0.9, 0.12], lean: 0.1, column: 0.86, grip: [0.28, 1.15, -0.22], foot: [0.16, 0.49, 0.62], footDown: false, pedals: false, side: 0 },
  },
  van: {
    id: 'van', name: 'Saagane Loadstar', kind: 'Cargo van', blurb: 'The biggest loads on the map. Wide, heavy and thirsty.',
    topSpeed: 68, pull: 0.5, turn: 0.48, grip: 1.2, brake: 0.5, lean: -0.24, feel: { topEnd: 0.75, response: 1.7, coast: 0.9, nitro: false }, drive: 'Diesel · heavy', size: { width: 1.8, length: 4.4, height: 2.2, cab: true }, capacity: 20, costPerKm: 5.5, unlocks: ['parcel', 'bulk', 'catering'],
    minLevel: 8, minRating: 4.3, rentHour: 150, rentDay: 700, price: 24000, engine: 'diesel', engineVolume: 1, horn: 'bus',
    camera: { distance: 2.0, height: 1.7, look: 1.4 }, cockpit: [-0.42, 1.72, 1.45],
    body: 'van', paint: '#2b5fa8',
    // High in the cab, on the right, at a big wheel.
    seat: { hip: [0, 1.08, 1.22], lean: -0.06, column: 1.72, grip: [0.17, 1.28, 0], foot: [0.13, 0.68, 1.86], footDown: false, pedals: false, side: -0.42 },
  },
  car: {
    id: 'car', name: 'Oota Hatch', kind: 'Catering car', blurb: 'Keeps the food level, warm and dry. Quick enough.',
    topSpeed: 78, pull: 0.8, turn: 0.64, grip: 1.2, brake: 0.82, lean: -0.12, feel: { topEnd: 1.1, response: 4, coast: 1.1, nitro: false }, drive: 'Petrol', size: { width: 1.6, length: 3.7, height: 1.75, cab: true }, capacity: 10, costPerKm: 4, unlocks: ['parcel', 'catering', 'express'],
    minLevel: 6, minRating: 4.2, rentHour: 110, rentDay: 520, price: 16000, engine: 'car', engineVolume: 1, horn: 'hatchback',
    camera: { distance: 1.55, height: 1.3, look: 1.15 }, cockpit: [-0.36, 1.3, 0.05],
    body: 'car', paint: '#e8e2d2',
    // Low in the seat, on the right, lying back a little, arms out to the wheel.
    seat: { hip: [0, 0.76, -0.14], lean: -0.14, column: 0.38, grip: [0.17, 1.04, 0], foot: [0.12, 0.48, 0.5], footDown: false, pedals: false, side: -0.36 },
  },
}

/** For sale and for rent, in the order the app lists them. */
export const MARKET: VehicleId[] = ['bicycle', 'ev', 'bike', 'trike', 'car', 'van']

/** The vehicle in use now, and whether the view is from its seat: read every frame by the body, sounds and camera. */
export const liveVehicle = { spec: VEHICLES.scooter, cockpit: false }

/**
 * Any vehicle on the street, through the same framework as the rider's own: a preset for each class,
 * built on the owned vehicle it's most like, with its own speed, weight, voice and camera. None has
 * nitro, none carries orders, and none costs anything to run: they aren't the rider's.
 */
const borrowedFrom = (base: VehicleSpec, borrowed: BorrowClass, change: Partial<VehicleSpec>): VehicleSpec => ({
  ...base,
  ...change,
  borrowed,
  blurb: 'Borrowed off the street.',
  feel: { ...base.feel, ...change.feel, nitro: false },
  capacity: 0,
  costPerKm: 0,
  unlocks: [],
  rentHour: 0,
  rentDay: 0,
  price: 0,
  cockpit: null,
  paint: null,
})

export const BORROWED: Record<BorrowClass, VehicleSpec> = {
  twoWheeler: borrowedFrom(VEHICLES.bike, 'twoWheeler', {
    name: 'Borrowed two-wheeler', kind: 'Commuter bike', drive: 'Petrol · borrowed', topSpeed: 72, pull: 1.05, turn: 0.85, brake: 0.8,
    engine: 'bike', horn: 'bike', camera: { distance: 1.05, height: 1, look: 1 },
    // As the traffic's own riders sit on it: upright, hands on the bars.
    seat: { hip: [0, 0.98, -0.34], lean: 0.34, column: 0.44, grip: [0.31, 1.08, -0.1], foot: [0.18, 0.44, -0.08], footDown: true, pedals: false, side: 0 },
  }),
  auto: borrowedFrom(VEHICLES.trike, 'auto', {
    name: 'Borrowed auto', kind: 'Auto-rickshaw', drive: 'CNG · borrowed', topSpeed: 50, pull: 0.72, turn: 0.82, grip: 1.05, brake: 0.62, lean: -0.34,
    feel: { topEnd: 0.6, response: 3.2, coast: 1.3, nitro: false }, engine: 'auto', horn: 'auto', camera: { distance: 1.4, height: 1.3, look: 1.15 },
  }),
  car: borrowedFrom(VEHICLES.car, 'car', {
    name: 'Borrowed car', kind: 'Car', drive: 'Petrol · borrowed', topSpeed: 84, pull: 0.86, turn: 0.62, brake: 0.85,
    engine: 'car', horn: 'hatchback', camera: { distance: 1.6, height: 1.3, look: 1.15 },
  }),
  van: borrowedFrom(VEHICLES.van, 'van', {
    name: 'Borrowed people-carrier', kind: 'People-carrier', drive: 'Diesel · borrowed', topSpeed: 76, pull: 0.62, turn: 0.54, brake: 0.62, lean: -0.2,
    feel: { topEnd: 0.85, response: 2.4, coast: 1, nitro: false }, engine: 'suv', horn: 'hatchback', camera: { distance: 1.8, height: 1.5, look: 1.3 },
  }),
  bus: borrowedFrom(VEHICLES.van, 'bus', {
    name: 'Borrowed city bus', kind: 'City bus', drive: 'Diesel · borrowed', topSpeed: 58, pull: 0.34, turn: 0.3, grip: 1.25, brake: 0.4, lean: -0.3,
    feel: { topEnd: 0.6, response: 1.1, coast: 0.7, nitro: false }, engine: 'diesel', horn: 'bus', camera: { distance: 3.6, height: 2.9, look: 2.1 },
  }),
  // No water tanker runs in this city's traffic yet: its preset is here for when one does.
  tanker: borrowedFrom(VEHICLES.van, 'tanker', {
    name: 'Borrowed water tanker', kind: 'Water tanker', drive: 'Diesel · borrowed', topSpeed: 52, pull: 0.3, turn: 0.32, grip: 1.2, brake: 0.36, lean: -0.34,
    feel: { topEnd: 0.55, response: 1, coast: 0.6, nitro: false }, engine: 'diesel', horn: 'bus', camera: { distance: 3.2, height: 2.7, look: 2 },
  }),
}

/** A street vehicle's preset, at that vehicle's own size on the road (half its width, half its length), so walls and traffic meet its real shape. */
export function borrowedSpec(kind: BorrowClass, radius: number, halfLength: number): VehicleSpec {
  const base = BORROWED[kind]
  return { ...base, size: { ...base.size, width: radius * 2, length: halfLength * 2, cab: kind !== 'twoWheeler' } }
}
