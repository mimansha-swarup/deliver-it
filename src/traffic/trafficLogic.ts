import { timed } from '../dev/frameTimes'
import type { CrashPhysics, CrashShape, CrashSurface, Quaternion, Tumbler } from '../physics/crashPhysics'
import { tuning } from '../vehicle/tuning'
import { addDeckLanes, deckHeightOn, UP_ON_DECK_TRAFFIC } from './deckLanes'
import type { Flyover } from '../world/transitPlacement'
import { blendRotation, uprightness, yawRotation } from '../physics/crashPhysics'
import { liveRoom } from '../game/rooms'
import { applyImpact, getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { SCOOTER } from '../vehicle/vehicleConfig'
import { hasClearLine, pushOutOfBuildings, type CollisionWorld } from '../world/collision'
import { BREAKER, breakerHeight } from '../world/roadFeatures'
import type { Prop } from '../world/props'
import type { RoadGraph } from '../world/roadGraph'
import { STRIDE_PER_METRE } from './gait'
import { createJunctions, indicatorFor, planJunctions, type Crossing, type Junctions } from './junctions'
import { createLanes, type Lane } from './lanes'
import { createTrafficSignals, findStopAhead, getLight, type TrafficSignals } from './trafficSignals'

export const TRAFFIC_RULES = {
  /** The most vehicles and walkers there can be: the quality setting says how many are in play (qualitySettings.ts). */
  maxVehicles: 84,
  maxPedestrians: 48,

  /**
   * New vehicles appear in this ring around the rider, in metres. It's kept close,
   * so the traffic is packed around you rather than spread over the whole map.
   */
  vehicleSpawnMin: 110,
  vehicleSpawnMax: 200,
  vehicleRemoveAt: 240,
  /** New pedestrians appear in this ring around the rider, in metres. */
  pedestrianSpawnMin: 50,
  pedestrianSpawnMax: 115,
  pedestrianRemoveAt: 135,

  walkSpeed: 1.3,
  acceleration: 3,
  /** A new vehicle won't appear this close to another one, in metres. */
  spawnGap: 8,
  braking: 9,

  /**
   * Bumper to bumper, Bengaluru style: the space cars leave in front, and the
   * smaller space two-wheelers and autos leave, in metres.
   */
  carGap: 1.4,
  nimbleGap: 0.6,
  lookAhead: 20,
  /** Room left beside something when passing it, in metres. */
  sideClearance: 0.15,

  /**
   * How far two-wheelers and autos squeeze over to get past, in metres. Negative
   * is right. Right goes past cars, partly into the other side of the road. Left,
   * along the kerb, only fits past other two-wheelers.
   */
  squeezeRight: -1.8,
  squeezeLeft: 1,
  /** How quickly they move sideways, in metres per second. */
  squeezeSpeed: 1.3,
  /** Something nearer than this ahead, in metres, makes them look for a way round. */
  squeezeLookAt: 8,
  /** Share of two-wheelers and autos that don't stop for red lights. */
  bikeRebels: 0.35,
  autoRebels: 0.25,

  /** Honking. Stuck behind the rider, they lean on it after this many seconds. */
  honkAtRiderAfter: 0.5,
  /** Chance per second of a honk while stuck in a queue, or while moving. */
  queueHonkRate: 0.05,
  movingHonkRate: 0.012,
  /** Nobody further away than this is heard, in metres. */
  honkHearing: 70,
  /** A vehicle crossing this close in front counts as being in the way, in metres. */
  junctionRange: 9,
  /**
   * After waiting this long for a vehicle crossing in front, go anyway. It clears
   * a rare deadlock at junctions. It never applies in a queue, or vehicles would
   * drive through each other.
   */
  patience: 4,
  /** How hard vehicles brake for a red light, in metres per second squared. */
  signalBraking: 3,

  /** How bouncy a hit between machines is. 0 is a dead thud, and 1 is a perfect bounce. */
  bounciness: 0.25,
  /** A body soaks up a hit rather than bouncing off it. */
  bodyBounciness: 0.05,
  /** A knock of less than this doesn't launch anything, in metres per second. */
  launchKnock: 1,
  /** How long a bike rider takes to get up, in seconds. */
  bikeDownTime: 3.5,
  /** The longest anything stays a real body before rejoining traffic, in seconds. */
  maxCrashTime: 8,
  /** A wreck is only cleared away when the rider is at least this far off, in metres. */
  clearDistance: 30,
  /** How long a vehicle takes to get going again after a hit, in seconds. */
  recoveryTime: 2,

  /**
   * Everything steers: it aims at a point this far ahead on its path, in metres,
   * turns towards it no tighter than its turning circle, and only ever moves the
   * way it faces. Nothing slides sideways.
   */
  aimMin: 1.2,
  aimMax: 7,
  /** At speed, the aim point is this many seconds ahead. */
  aimTime: 0.55,
  /** The tightest turn each can make, as a radius in metres. */
  carTurnRadius: 4.5,
  nimbleTurnRadius: 2.4,
  /**
   * A curve round a corner can come out a little tighter than the turning circle, where the lanes
   * are short, so vehicles may turn this share tighter than it to keep to the curve.
   */
  steeringSlack: 0.45,
  /** Driving traffic keeps this share of its half-width clear of walls. */
  wallMargin: 0.7,
  /** Stuck against a wall this many seconds, and further than this from the rider, in metres, a vehicle is replaced. */
  pinnedTime: 3,
  pinnedRemoveDistance: 30,
  /** People turn on the spot, this fast, in radians per second, and look this far ahead, in metres. */
  walkTurnRate: 5,
  walkAim: 1.1,
  /** How fast cars, and then two-wheelers and autos, cross a speed breaker, in m/s. */
  breakerSpeed: 2.2,
  breakerSpeedNimble: 3.5,
  /** How hard vehicles brake for a turn, and how fast they take a right-angle turn, in m/s² and m/s. */
  cornerBraking: 2.5,
  cornerSpeed: 4.5,
  /** Something further than this from its path, in metres, heads straight back to it, this much faster than usual. */
  lostDistance: 2.5,
  catchUpPace: 1.4,

  /** Pedestrians step aside when the rider comes this close, by this much. */
  dodgeRange: 4,
  dodgeDistance: 1.8,
  dodgeResponse: 7,
  /** Faster than this, in metres per second, the rider is on them before they can step aside. */
  dodgeMaxRiderSpeed: 5,
  /** Walking back to their path after stepping aside or getting up, in metres per second. */
  returnSpeed: 1.4,
  /** A knock gentler than this just nudges a pedestrian, rather than throwing them. */
  pedestrianKnock: 3,
  /** How long someone stays down after being hit, before getting up, in seconds. */
  pedestrianDownTime: 3,
  /** How quickly someone goes limp when hit, per second, and how long getting up takes, in seconds. */
  goLimpRate: 5,
  getUpTime: 1.1,
  /** How long a fallen vehicle takes to be stood back up, in seconds. */
  rightingTime: 0.9,
  /**
   * Two vehicles locked into each other (neither can move without driving into the other) for this
   * many seconds, out of the rider's sight, and one is taken away to appear elsewhere. The junction
   * rules (junctions.ts) keep it rare; this ends what's left.
   */
  knotTime: 6,
  /** Locked into another this long, in seconds, the heavier of the two edges on through at this speed, in m/s. */
  /**
   * Two touching, each in the other's way: after `backOffAfter` seconds the lighter backs off, at
   * `backOffSpeed` m/s, up to `backOffMost` metres. Vehicles waiting for each other in a ring: after
   * `ringPatience` seconds the heaviest stops waiting and goes, at `bargeSpeed` m/s. And if they're
   * still locked after `pushAfter` seconds, the heavier pushes on through the other.
   */
  backOffAfter: 1.2,
  backOffSpeed: 1.2,
  backOffMost: 3,
  backOffWait: 3,
  ringPatience: 3,
  pushAfter: 12,
  bargeSpeed: 1.5,
  /**
   * Real hold-ups (`startHalts`). Now and then a vehicle stops for a reason: an auto or a car pulls
   * in to the kerb to let someone out, for `dropOff` seconds, or a car breaks down where it is,
   * hazard lamps flashing, for `breakdown` seconds. One is started every `haltEvery` seconds (lowest
   * to highest), `haltEveryRush` at the heart of a rush-hour jam, with at most `halts` at once and
   * `haltsRush` more in a jam, between `haltNear` and `haltFar` metres from the rider.
   */
  dropOff: [7, 14],
  breakdown: [25, 45],
  breakdownShare: 0.3,
  haltEvery: [9, 18],
  haltEveryRush: [3, 6],
  halts: 1,
  haltsRush: 3,
  haltNear: 30,
  haltFar: 130,
  /**
   * Traffic stops this far short of something standing in its lane (a breakdown, a cow, a bus
   * broken down), in metres: room to swing out round it. Cars and buses go round `passWide` metres
   * out (negative is right, over the middle of the road), and only with the other side clear of
   * oncoming traffic for `passClear` metres.
   */
  standingGap: 5,
  passWide: -2.5,
  passClear: 45,
  passClearNimble: 20,
  /** A two-wheeler or auto caught out on the wrong side, nose to nose with something, is paddled back towards its own lane at this speed, in m/s. */
  paddleSpeed: 0.7,
  /**
   * People cross the road. Walking along a footpath, one decides to every `crossEvery` seconds or
   * so (lowest to highest), and `zebraShare` of those passing a zebra crossing at the lights take
   * it. They stop at the kerb and look: they go when everything coming would reach their line
   * `crossMargin` seconds or more after they're clear of it, a margin that shrinks as they wait
   * (down to `crossLeast`), and at a zebra only while the light holds the traffic. After `kerbWait`
   * seconds at the kerb (`zebraWait` at a zebra) they give up and walk on. They cross at
   * `crossPace` times their walk, hand raised to the traffic, and stop short of a vehicle that isn't slowing.
   */
  crossEvery: [180, 420],
  zebraShare: 0.45,
  crossMargin: 1.6,
  crossLeast: 0.3,
  kerbWait: 10,
  zebraWait: 30,
  crossPace: 1.3,
  /** A driver takes this long to set off once the way opens, in seconds (lowest to highest): a queue moves off from its front, one after another. */
  setOff: [0.2, 0.55],
  /** A thrown bike rider walks back at this speed, in m/s, and gets on within this distance, in metres. */
  walkBackSpeed: 1.6,
  remountDistance: 1,
  /** A bike rider comes off the seat with this much extra upward speed, in m/s. */
  riderLaunchUp: 1.6,
  /** Share of the bike's speed the rider carries on with as they're thrown. */
  riderCarry: 0.9,
}

type Mover = {
  lane: number
  /** Time not yet stepped, in seconds, while it's far from the player and stepped less often (`FAR_SIM`). */
  owed?: number
  /** The lane it will take after this one, once chosen. -1 or missing until then. */
  nextLane?: number
  /** The lane it came from, for finishing the curve round the corner between them. -1 or missing if none. */
  prevLane?: number
  /**
   * The lanes after the next one, in order, as far as it has chosen: traffic knows its way a few
   * lanes on, to indicate in time and to see its way through a junction (`laneAhead`).
   */
  onward?: number[]
  /** Metres along the lane. */
  along: number
  speed: number
  /** What gets drawn. */
  x: number
  z: number
  heading: number
  lift: number
  /** The height of the road under it, up on a flyover (deckLanes.ts); 0 or unset on the ground. */
  deck?: number
  /** A 0 to 1 value used to pick a colour. */
  tint: number
}

export type VehicleKind = 'sedan' | 'hatchback' | 'suv' | 'mpv' | 'auto' | 'bike' | 'bus' | 'tempo' | 'cycle'

/**
 * The mix of traffic, as Bengaluru's is: of every twenty vehicles, twelve two-wheelers (60%), three
 * autos (15%), three cars (15%), a bus (5%) and one other (5%): a tempo or a bicycle. The round
 * repeats, so any number of vehicles in play (the quality's) keeps close to it; which car, and
 * which other, changes from round to round. Buses only take lanes on main roads (`Lane.buses`).
 */
const MIX_ROUND = ['bike', 'auto', 'bike', 'car', 'bike', 'bike', 'bus', 'bike', 'auto', 'bike', 'car', 'bike', 'bike', 'other', 'bike', 'auto', 'bike', 'car', 'bike', 'bike'] as const
const MIX_CARS: VehicleKind[] = ['sedan', 'hatchback', 'suv', 'mpv']
const MIX_OTHERS: VehicleKind[] = ['tempo', 'cycle']

/** The kind of the vehicle at a place in the pool. */
export function kindAt(index: number): VehicleKind {
  const slot = MIX_ROUND[index % MIX_ROUND.length]
  const round = Math.floor(index / MIX_ROUND.length)
  if (slot === 'car') return MIX_CARS[(round * 3 + Math.floor((index % MIX_ROUND.length) / 7)) % MIX_CARS.length]
  if (slot === 'other') return MIX_OTHERS[round % MIX_OTHERS.length]
  return slot
}

/**
 * How a kind of thing reacts to being knocked, for each m/s of knock. Real
 * things are rarely thrown into the air. A hit at wheel or leg height mostly
 * shoves the bottom along while the top lags, so things tip over, and then they
 * slide. What differs is which way they tip easily:
 * - People fall over any way.
 * - Two-wheelers fall onto their side, but hardly ever go end over end.
 * - Autos are tall and narrow, so they roll onto their side when hit from the
 *   side, and rock but stay up when hit from behind.
 * - Cars are low and wide, and mostly just get shoved.
 */
type ThrowStyle = {
  /** Upward speed, and the most it can be, in m/s. */
  lift: number
  maxLift: number
  /** Tipping speed sideways (roll) and end over end (pitch), and the most, in radians per second. */
  roll: number
  pitch: number
  maxTip: number
  /** A flat spin from being hit off-centre. */
  yaw: number
}

const PERSON_THROW: ThrowStyle = { lift: 0.1, maxLift: 1.4, roll: 0.5, pitch: 0.5, maxTip: 4.5, yaw: 0.05 }
const TWO_WHEELER_THROW: ThrowStyle = { lift: 0.04, maxLift: 0.7, roll: 0.7, pitch: 0.04, maxTip: 3.5, yaw: 0.12 }
const AUTO_THROW: ThrowStyle = { lift: 0.03, maxLift: 0.5, roll: 0.35, pitch: 0.05, maxTip: 2.5, yaw: 0.08 }
const CAR_THROW: ThrowStyle = { lift: 0.02, maxLift: 0.3, roll: 0.06, pitch: 0.02, maxTip: 0.8, yaw: 0.06 }
/** A bus hardly moves for anything a scooter can do to it. */
const BUS_THROW: ThrowStyle = { lift: 0, maxLift: 0.05, roll: 0.01, pitch: 0.005, maxTip: 0.15, yaw: 0.01 }

/** How things slide once they're down. A body drags to a stop, a bike on its side skids further. */
const BODY_SURFACE: CrashSurface = { friction: 0.75, bounce: 0, slideDamping: 0.2, spinDamping: 3 }
const TWO_WHEELER_SURFACE: CrashSurface = { friction: 0.5, bounce: 0.05, slideDamping: 0.3, spinDamping: 1.5 }
const AUTO_SURFACE: CrashSurface = { friction: 0.7, bounce: 0.05, slideDamping: 0.3, spinDamping: 1.2 }
const CAR_SURFACE: CrashSurface = { friction: 0.8, bounce: 0.1, slideDamping: 0.2, spinDamping: 0.8 }

export const THROW_STYLES: Record<VehicleKind, ThrowStyle> = {
  sedan: CAR_THROW,
  hatchback: CAR_THROW,
  suv: CAR_THROW,
  mpv: CAR_THROW,
  auto: AUTO_THROW,
  bike: TWO_WHEELER_THROW,
  bus: BUS_THROW,
  tempo: CAR_THROW,
  cycle: TWO_WHEELER_THROW,
}

/**
 * `mass` is in kilograms. A collision shares speed out according to these weights.
 * Each crash box runs from the ground up to the roof, so a vehicle lying on it
 * rests on its wheels instead of sinking them into the road.
 */
const VEHICLE_SHAPES: Record<
  VehicleKind,
  { speed: number; halfLength: number; radius: number; crash: CrashShape }
> = {
  sedan: {
    speed: 8,
    halfLength: 2.1,
    radius: 0.85,
    crash: { halfSize: [0.85, 0.67, 2.05], centre: 0.67, mass: 1200, surface: CAR_SURFACE },
  },
  hatchback: {
    speed: 8,
    halfLength: 1.8,
    radius: 0.85,
    crash: { halfSize: [0.82, 0.71, 1.76], centre: 0.71, mass: 950, surface: CAR_SURFACE },
  },
  suv: {
    speed: 8,
    halfLength: 2.3,
    radius: 0.92,
    crash: { halfSize: [0.92, 0.82, 2.25], centre: 0.82, mass: 1800, surface: CAR_SURFACE },
  },
  mpv: {
    speed: 8,
    halfLength: 2,
    radius: 0.88,
    crash: { halfSize: [0.86, 0.76, 1.96], centre: 0.76, mass: 1250, surface: CAR_SURFACE },
  },
  auto: {
    speed: 6,
    halfLength: 1.3,
    radius: 0.75,
    crash: { halfSize: [0.66, 0.84, 1.22], centre: 0.84, mass: 400, surface: AUTO_SURFACE },
  },
  bike: {
    speed: 9,
    halfLength: 0.95,
    radius: 0.4,
    crash: { halfSize: [0.22, 0.67, 0.9], centre: 0.67, mass: 200, surface: TWO_WHEELER_SURFACE },
  },
  // A city bus, 11 m long and 2.5 m wide (see createBusGeometry in vehicleShapes.ts).
  bus: {
    speed: 7,
    halfLength: 5.6,
    radius: 1.3,
    crash: { halfSize: [1.25, 1.5, 5.5], centre: 1.5, mass: 11000, surface: CAR_SURFACE },
  },
  // A small goods carrier with a covered back (the mini truck in fleet.glb), slower than a car.
  tempo: {
    speed: 6.5,
    halfLength: 1.75,
    radius: 0.9,
    crash: { halfSize: [0.88, 1.1, 1.72], centre: 1.1, mass: 1400, surface: CAR_SURFACE },
  },
  // Someone on a bicycle, keeping left, at a bicycle's pace.
  cycle: {
    speed: 4,
    halfLength: 0.85,
    radius: 0.35,
    crash: { halfSize: [0.2, 0.6, 0.8], centre: 0.6, mass: 95, surface: TWO_WHEELER_SURFACE },
  },
}

const PARKED_SCOOTER_SHAPE: CrashShape = {
  halfSize: [0.2, 0.5, 0.74],
  centre: 0.53,
  mass: 110,
  surface: TWO_WHEELER_SURFACE,
}
/** A standing person, as a box from the feet up, about 1.7 m tall. */
const PERSON_SHAPE: CrashShape = {
  halfSize: [0.24, 0.84, 0.14],
  centre: 0.85,
  mass: 70,
  surface: BODY_SURFACE,
  body: true,
}
/** How close the rider's middle gets to a person's middle before they touch. */
const PERSON_HIT_DISTANCE = SCOOTER.collisionRadius + 0.3
/** A person, as other things see them: a circle this wide, in metres. */
const PERSON_RADIUS = 0.3
/** Walking people keep at least this far apart, middle to middle, in metres. */
const PERSON_SPACING = 0.6
/**
 * The rider's shape for pushing things, which doesn't react to being pushed back.
 * It's kept small on purpose. A hit has to be noticed by `hitLoose` or `hitRider`
 * first, or this would bulldoze things along the ground without ever launching them.
 */
const RIDER_SHAPE: CrashShape = { halfSize: [0.2, 0.5, 0.25], centre: 0.65, mass: SCOOTER.mass }
/** How close the rider's middle gets to a parked scooter's middle before they hit. */
const LOOSE_HIT_DISTANCE = 1.35
/** Parked scooters become real bodies inside this distance of the rider, in metres. */
const LOOSE_BODY_DISTANCE = 40
/** Traffic further from the rider than this doesn't need a shape in the physics world. */
const PUSHER_DISTANCE = 70
export const LOOSE_DRAW_DISTANCE = 170

export type Vehicle = Mover & {
  kind: VehicleKind
  /** Half the vehicle's width, used for the radius of its collision shape. */
  radius: number
  crash: CrashShape
  /** Rapier's body for it while it's being thrown around, or null while it's driving. */
  body: Tumbler['body']
  rotation: Quaternion | null
  /** Its shape in the physics world while it's driving normally. */
  pusher: Tumbler['body']
  /** Seconds since it was hit. */
  crashTime: number
  /** From 0 just after a hit, up to 1 when it has fully gone back to normal driving. */
  recovery: number
  cruiseSpeed: number
  halfLength: number
  waiting: number
  /** Seconds it has spent pressed against a wall. See `stepVehicle`. */
  pinned: number
  /** Two-wheelers and autos weave through gaps. Cars keep to their lane. */
  nimble: boolean
  /** Ignores red lights. */
  rebel: boolean
  /** How far it has moved sideways from its lane, and where it's heading. Negative is right. */
  shift: number
  shiftTarget: number
  /** Seconds stuck behind the rider, and until it can honk again. */
  blockedTime: number
  honkWait: number
  /** While righting itself after a crash: how it was lying, how high, and how far back up it is. */
  fallen: Quaternion | null
  /** A bus at a stop: seconds left there, and which stop it last served (`busStopKey`), so it doesn't stop twice. */
  busDwell?: number
  servedStop?: number
  fallenLift: number
  rising: number
  /** A two-wheeler's rider, who is thrown off in a crash. Null for everything else. */
  thrownRider: Pedestrian | null
  /** Whether the rider is off the bike, so the seated rider isn't drawn. */
  riderOff: boolean
  /**
   * Taken by the player ("Use any vehicle", game/borrow.ts): `hailed`, it's pulling up for them;
   * `empty`, its driver has got out and it stands where it stopped; `driven`, the player is driving
   * it, and it goes where their controller does. Unset is ordinary traffic.
   */
  taken?: 'hailed' | 'empty' | 'driven'
  /** An empty one the player has left behind: gone once it's out of sight. */
  abandoned?: boolean
  /**
   * At junctions (junctions.ts). `atLine`: it's the front of a road into one. `junctionSpeed`: the
   * most it may do just now, 0 at its line while it's held there. `claim`: it has decided to go, and
   * its path is its own. `crossing`: it's in the junction. `heldFor`: seconds it has waited at the line.
   */
  atLine?: boolean
  /** Standing behind something in its way. */
  stalled?: boolean
  junctionSpeed?: number
  claim?: boolean
  crossing?: Crossing | null
  heldFor?: number
  /** Seconds locked with another vehicle, neither able to move (`knotTime`), and the one it has stopped waiting for and is going past. */
  knot?: number
  barging?: Vehicle | null
  /** How far it has backed off out of a lock, in metres, and seconds it still waits for the other to go. */
  backedOff?: number
  holdOff?: number
  /** The vehicle it's standing behind (the nearest in its way), and the one it's waiting for at a junction's line. */
  blocker?: Vehicle | null
  heldBy?: Vehicle | null
  /** What is limiting its speed, in words (only with `trafficDebug.reasons`). */
  reason?: string
  /** Stopped for a reason of its own (`startHalts`): which, how long is left, and whether it has pulled up yet. */
  halt?: { kind: 'dropOff' | 'breakdown'; left: number } | null
  /** Its hazard lamps are on: both indicators flashing. */
  hazard?: boolean
  /** Backing up from something standing in its lane, for the room to swing out round it. */
  reversing?: boolean
  /** Seconds until its driver sets off, counted while it stands with the way open (`setOff`). */
  setOffIn?: number
  /** What its lamps show (Traffic.tsx): the side it's indicating (1 left, -1 right, 0 neither), and whether it's on the brakes. */
  indicator?: -1 | 0 | 1
  braking?: boolean
  /**
   * On rails (`stepRail`): too far from the player to need driving properly, it follows its lane,
   * the lights and whatever is in front of it, ten times a second, with no physics. `railSpeed` is
   * how fast it's being drawn along, for the picture to carry it on between steps, and `railStamp`
   * when it was last stepped, on the world's `railClock`.
   */
  rail?: boolean
  railSpeed?: number
  railStamp?: number
  /**
   * On a wide road traffic runs in files side by side (`Lane.files`): which file this one keeps to
   * (a number, taken round the lane's files; a bus always keeps the first, by the kerb's stops),
   * and how far sideways from the lane's line that has it just now, in metres, eased as roads widen and narrow.
   */
  file: number
  fileShift: number
  /** Not put back on the road before this, on the world's `railClock`: it found no place last time. */
  retryAt?: number
  /** Drawn with its detailed model (vehicleLod.ts keeps this). */
  detailed?: boolean
}

/** A driver who has got out for the player: walking to the footpath, then standing there. */
export type Driver = Pedestrian & { goX: number; goZ: number; age: number }

/** A horn sounding somewhere, waiting to be played by the sound code. */
export type Honk = { x: number; z: number; kind: VehicleKind }

/** Something was hit hard enough to hear, with a strength from 0 to 1. */
export type HitSound = { x: number; z: number; strength: number }

export type Pedestrian = Mover & {
  /** Rapier's body for them while they've been knocked over, or null while walking. */
  body: Tumbler['body']
  rotation: Quaternion | null
  /** Seconds since they were knocked over. */
  downTime: number
  /** How limp they are, from 0 walking to 1 sprawled. The drawing poses their arms and legs by it. */
  down: number
  /** While getting up: how they were lying, how high, and how far up they've got, from 0 to 1. */
  fallen: Quaternion | null
  fallenLift: number
  rising: number
  dodgeX: number
  dodgeZ: number
  /** How far through the walking cycle they are, in radians. A whole turn is two steps. */
  stride: number
  /** How much they're walking, from 0 standing still to 1 walking. Unset is walking. */
  walking?: number
  /** How much they're waving, from 0 to 1: a customer greeting the rider. Unset is not waving. */
  wave?: number
  /** What they do while standing about: one of IDLE_POSE in gait.ts. Unset is just breathing. */
  idle?: number
  /** How dark their skin is, as a number the colour is multiplied by. */
  skin: number
  /** Not drawn. Used for a bike rider who is still on the bike. */
  hidden?: boolean
  /**
   * Crossing the road (`stepCrossing`): waiting at the kerb, or on the way over, to a place on the
   * footpath opposite; how long they've waited; and the light that holds the traffic, at a zebra.
   */
  cross?: { stage: 'wait' | 'go'; toX: number; toZ: number; lane: number; along: number; waited: number; light: { junction: number; group: number } | null; reacted?: boolean } | null
  /** Seconds until they next think of crossing, and the lane on which they last passed a zebra and chose. */
  crossIn?: number
  zebraSeen?: number
  /** Far from the player: stepped ten times a second, and drawn again only then (`FAR_PEOPLE`). `farStamp`: when, on the world's `railClock`. */
  far?: boolean
  farStamp?: number
  /** Seconds they stand where they are, startled: the player's horn while they were crossing. */
  startled?: number
  /** Seconds they keep a hand up in thanks: the player stopped to let them cross. */
  thanks?: number
  /** What they've just done about the player, for the street's reactions (people/reactions.ts) to take up: set here, cleared there. */
  did?: 'cutOff' | 'letPass' | 'steppedBack' | null
}

/** Something standing loose on the ground, which anything can knock about. */
export type LooseBody = Tumbler & { tint: number }

export type TrafficWorld = {
  /**
   * How much of the vehicle count is out, 0 to 1, set by the time of day (duty.ts). Vehicles past
   * it aren't sent out again when they'd respawn, so traffic thins out of sight, never on screen.
   */
  density: number
  physics: CrashPhysics
  /** Buildings and walls, which driving traffic is kept out of. */
  collisions: CollisionWorld
  /** For each road lane, where along it its speed breakers are, in metres. */
  breakers: number[][]
  riderPusher: NonNullable<Tumbler['body']>
  loose: LooseBody[]
  roadLanes: Lane[]
  /** Where the roads cross, and who goes first there (junctions.ts). */
  junctions: Junctions
  /** The flyovers whose lanes are among `roadLanes` (deckLanes.ts). */
  decks: Flyover[]
  /**
   * A rush-hour jam: within `reach` of it more of the traffic appears, and more of it stops for
   * one reason or another (`startHalts`), so the queues are real ones, the more the higher
   * `amount` (0 to 1), and more of the traffic appears there. Null when there's none.
   */
  jam: { x: number; z: number; reach: number; amount: number } | null
  walkLanes: Lane[]
  vehicles: Vehicle[]
  pedestrians: Pedestrian[]
  signals: TrafficSignals
  /** Seconds of game time, which every traffic light runs from. */
  signalClock: number
  random: () => number
  /** Whether any vehicle stands empty for the player just now: worked out once a step. */
  anyEmpty: boolean
  /** Drivers out of vehicles the player has taken: a few, used in turn (see `letDriverOut`). */
  drivers: Driver[]
  /** Horns that sounded this step. `Traffic` plays them and empties this. */
  honks: Honk[]
  /** Hits this step, to be heard. `Traffic` plays them and empties this. */
  impacts: HitSound[]
  /** Every person traffic must stop for this step, walking or down. See `listDowned`. */
  downed: Obstacle[]
  /** For each road lane, where along it buses stop, in metres (`setBusStops`). */
  busStops?: number[][]
  /** Things standing in the road that aren't traffic (a cow, a bus broken down: CityEvents.tsx), by who put them there. */
  obstacles: Map<string, RoadObstacle>
  /** Seconds until the next hold-up may start (`startHalts`). */
  haltIn: number
  /**
   * The near and far of it (`RAIL`). `railClock`: seconds of traffic time. `modeIn`: seconds until
   * who drives properly and who is on rails is next worked out. `lists`: the vehicles in play sorted
   * into kept lists, refilled each step and never made new: all of them, those driving properly on
   * the ground, and everything close enough to matter to those (on the ground, and up on a flyover).
   * `order` and `away`: the vehicles nearest first, and how far each is, for choosing.
   */
  railClock: number
  modeIn: number
  lists: { active: Vehicle[]; full: Vehicle[]; fullGround: Vehicle[]; nearGround: Vehicle[]; nearUp: Vehicle[]; near: Vehicle[] }
  order: Int16Array
  away: Float32Array
  /** How many vehicles drive properly, and how many are on rails, just now; and the same for people (near: stepped every frame). */
  counts: { full: number; rail: number; walkersNear: number; walkersFar: number }
  /** The last vehicle put on the road, and how many more are to come close behind it (`BUNCH`). */
  bunch: { lane: number; along: number; halfLength: number; left: number }
  /** The player sounded the horn `honked` seconds ago (Infinity: not lately): people crossing stop for it. */
  honked: number
  /** The auto the player last ran into, until whoever deals with it (the auto anna's argument) takes it up and clears it. */
  bumpedAuto: Vehicle | null
  /** For each footpath lane, the one along the other side of the same stretch of road (-1 if there's none). */
  walkAcross: Int32Array
  /** The zebra crossings at the lights, by the footpath lane that passes each: where along it, and the light of the road it crosses. */
  zebras: Map<number, { along: number; junction: number; group: number }>
}

function angleBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function placeOnLane(mover: Mover, lanes: Lane[], laneIndex: number, random: () => number) {
  const lane = lanes[laneIndex]
  const along = random() * lane.length
  mover.lane = laneIndex
  mover.nextLane = -1
  if (mover.onward) mover.onward.length = 0
  mover.prevLane = -1
  mover.along = along
  mover.x = lane.startX + lane.forwardX * along
  mover.z = lane.startZ + lane.forwardZ * along
  mover.heading = Math.atan2(lane.forwardX, lane.forwardZ)
}

/** Picks a random lane whose start lies inside a ring around (x, z). */
function findLaneInRing(
  lanes: Lane[],
  x: number,
  z: number,
  min: number,
  max: number,
  random: () => number,
  isFree: (lane: Lane) => boolean = () => true,
  attempts = 60,
): number {
  // Only lanes starting in grid squares that reach the ring are tried. Picking from
  // every lane in HSR, most would be kilometres away.
  const grid = getLaneGrid(lanes)
  const nearby = nearbyLanes
  nearby.length = 0
  for (let cellX = Math.floor((x - max) / LANE_CELL); cellX <= Math.floor((x + max) / LANE_CELL); cellX++) {
    for (let cellZ = Math.floor((z - max) / LANE_CELL); cellZ <= Math.floor((z + max) / LANE_CELL); cellZ++) {
      const cell = grid.get(laneCellKey(cellX, cellZ))
      if (cell) nearby.push(...cell)
    }
  }
  if (nearby.length === 0) return -1

  for (let attempt = 0; attempt < attempts; attempt++) {
    const index = nearby[Math.floor(random() * nearby.length)]
    const distance = Math.hypot(lanes[index].startX - x, lanes[index].startZ - z)
    if (distance >= min && distance <= max && isFree(lanes[index])) return index
  }
  return -1
}

/** Kept between searches, so looking for a lane makes nothing new. */
const nearbyLanes: number[] = []

/** The busiest street's traffic weight: a lane is picked in proportion to its own weight against this. */
const MAX_LANE_WEIGHT = 10

/** Lanes are sorted by where they start into squares this wide, in metres. */
const LANE_CELL = 60
const laneCellKey = (cellX: number, cellZ: number) => (cellX + 5000) * 10000 + (cellZ + 5000)
const laneGrids = new WeakMap<Lane[], Map<number, number[]>>()

/** Each list of lanes gets its grid the first time it's searched. Lanes never move, so it's kept. */
function getLaneGrid(lanes: Lane[]): Map<number, number[]> {
  let grid = laneGrids.get(lanes)
  if (grid) return grid
  grid = new Map()
  lanes.forEach(({ startX, startZ }, index) => {
    const key = laneCellKey(Math.floor(startX / LANE_CELL), Math.floor(startZ / LANE_CELL))
    const cell = grid?.get(key)
    if (cell) cell.push(index)
    else grid?.set(key, [index])
  })
  laneGrids.set(lanes, grid)
  return grid
}

/** A bike's rider, ready for when they're thrown off. Until then they're hidden and ride the bike. */
function createThrownRider(random: () => number): Pedestrian {
  return {
    lane: -1,
    along: 0,
    speed: 0,
    x: 0,
    z: 0,
    heading: 0,
    lift: 0,
    tint: random(),
    dodgeX: 0,
    dodgeZ: 0,
    stride: 0,
    skin: 0.6 + random() * 0.55,
    body: null,
    rotation: null,
    downTime: 0,
    down: 0,
    fallen: null,
    fallenLift: 0,
    rising: 0,
    hidden: true,
  }
}

export function createTrafficWorld(
  graph: RoadGraph,
  collisions: CollisionWorld,
  parked: Prop[],
  physics: CrashPhysics,
  breakersOnLink: (from: number, to: number) => number[] = () => [],
  random: () => number = Math.random,
  /** The kind of street at a point: how busy it is, and whether buses run there. */
  streetAt: (x: number, z: number) => { traffic: number; buses: boolean } | null = () => null,
  /** The flyovers, driven over as well (deckLanes.ts). */
  decks: Flyover[] = [],
): TrafficWorld {
  const roadLanes = createLanes(graph, collisions, {
    minRoadWidth: 5,
    // A quarter of the road out from the middle: 1.6 m on a 6.5 m residential street, never under 1.4.
    sideOffset: (roadWidth) => Math.max(1.4, roadWidth / 4),
    clearance: 1.1,
    obeyOneWay: true,
    files: true,
  })
  for (const lane of roadLanes) {
    const street = streetAt((lane.startX + lane.endX) / 2, (lane.startZ + lane.endZ) / 2)
    lane.weight = street?.traffic ?? 1
    lane.buses = street?.buses ?? false
  }
  const signals = createTrafficSignals(graph)
  for (const lane of roadLanes) {
    const signal = signals.byNode.get(lane.endNode)
    const group = signal?.groupFrom.get(lane.startNode)
    if (signal && group !== undefined) {
      lane.signal = { junction: signal.junction, group, stopBack: signal.stopBack }
    }
  }
  // The flyovers' lanes, after the ground's, joined to them at the ramps' feet.
  const deckLanes = addDeckLanes(roadLanes, decks)
  if (deckLanes.lanes > 0) console.info(`[traffic] flyovers: ${deckLanes.lanes} lanes, ${deckLanes.joins} joins`)

  const walkLanes = createLanes(graph, collisions, {
    minRoadWidth: 4,
    sideOffset: (roadWidth) => roadWidth / 2 + 0.7, // On the pavement, inside the lamp posts.
    clearance: 0.4,
  })

  // The footpath opposite each footpath: the same stretch of road walked the other way.
  const walkByEnds = new Map<number, number>()
  walkLanes.forEach((lane, index) => walkByEnds.set(lane.startNode * 1_000_000 + lane.endNode, index))
  const walkAcross = Int32Array.from(walkLanes, (lane) => walkByEnds.get(lane.endNode * 1_000_000 + lane.startNode) ?? -1)
  // And where each zebra crossing meets the footpaths either side of its road.
  const zebras: TrafficWorld['zebras'] = new Map()
  const walkGrid = getLaneGrid(walkLanes)
  for (const post of signals.posts) {
    const alongX = Math.sin(post.rotation)
    const alongZ = Math.cos(post.rotation)
    for (let cellX = Math.floor((post.crossX - 15) / LANE_CELL); cellX <= Math.floor((post.crossX + 15) / LANE_CELL); cellX++) {
      for (let cellZ = Math.floor((post.crossZ - 15) / LANE_CELL); cellZ <= Math.floor((post.crossZ + 15) / LANE_CELL); cellZ++) {
        for (const index of walkGrid.get(laneCellKey(cellX, cellZ)) ?? []) {
          const lane = walkLanes[index]
          // A footpath along the road the zebra crosses, beside it.
          if (Math.abs(lane.forwardX * alongX + lane.forwardZ * alongZ) < 0.8) continue
          const along = (post.crossX - lane.startX) * lane.forwardX + (post.crossZ - lane.startZ) * lane.forwardZ
          if (along < 1 || along > lane.length - 1) continue
          const beside = Math.hypot(post.crossX - lane.startX - lane.forwardX * along, post.crossZ - lane.startZ - lane.forwardZ * along)
          if (beside < post.crossWidth / 2 + 1.5) zebras.set(index, { along, junction: post.junction, group: post.group })
        }
      }
    }
  }

  const vehicles: Vehicle[] = Array.from({ length: TRAFFIC_RULES.maxVehicles }, (_, index) => {
    const kind = kindAt(index)
    const { speed, halfLength, radius, crash } = VEHICLE_SHAPES[kind]
    const nimble = kind === 'bike' || kind === 'auto' || kind === 'cycle'
    const rebelShare = kind === 'bike' ? TRAFFIC_RULES.bikeRebels : kind === 'auto' ? TRAFFIC_RULES.autoRebels : 0
    return {
      kind,
      radius,
      crash,
      body: null,
      rotation: null,
      pusher: physics.createPusher(crash),
      crashTime: 0,
      recovery: 1,
      lane: -1,
      along: 0,
      speed: 0,
      x: 0,
      z: 0,
      heading: 0,
      lift: 0,
      tint: random(),
      cruiseSpeed: speed * (0.85 + random() * 0.3),
      halfLength,
      waiting: 0,
      pinned: 0,
      nimble,
      rebel: random() < rebelShare,
      shift: 0,
      shiftTarget: 0,
      blockedTime: 0,
      honkWait: random() * 3,
      fallen: null,
      fallenLift: 0,
      rising: 0,
      thrownRider: kind === 'bike' ? createThrownRider(random) : null,
      riderOff: false,
      rail: true,
      file: Math.floor(random() * 6),
      fileShift: 0,
    }
  })

  const pedestrians: Pedestrian[] = Array.from({ length: TRAFFIC_RULES.maxPedestrians }, () => ({
    lane: -1,
    along: 0,
    speed: TRAFFIC_RULES.walkSpeed * (0.8 + random() * 0.4),
    x: 0,
    z: 0,
    heading: 0,
    lift: 0,
    tint: random(),
    dodgeX: 0,
    dodgeZ: 0,
    stride: random() * 6,
    skin: 0.6 + random() * 0.55,
    body: null,
    rotation: null,
    downTime: 0,
    down: 0,
    fallen: null,
    fallenLift: 0,
    rising: 0,
  }))

  const loose = parked.map(
    ({ x, z, rotation, variation }): LooseBody => ({
      x,
      z,
      heading: rotation,
      lift: 0,
      tint: variation,
      rotation: null,
      body: null,
    }),
  )

  const riderPusher = physics.createPusher(RIDER_SHAPE, true)

  return {
    physics,
    collisions,
    junctions: createJunctions(roadLanes),
    obstacles: new Map(),
    haltIn: 8,
    railClock: 0,
    modeIn: 0,
    lists: { active: [], full: [], fullGround: [], nearGround: [], nearUp: [], near: [] },
    order: new Int16Array(TRAFFIC_RULES.maxVehicles),
    away: new Float32Array(TRAFFIC_RULES.maxVehicles),
    counts: { full: 0, rail: 0, walkersNear: 0, walkersFar: 0 },
    bunch: { lane: -1, along: 0, halfLength: 0, left: 0 },
    honked: Infinity,
    bumpedAuto: null,
    walkAcross,
    zebras,
    breakers: roadLanes.map((lane) => (lane.startNode < 0 ? [] : breakersOnLink(lane.startNode, lane.endNode))),
    decks,
    jam: null,
    riderPusher,
    loose,
    roadLanes,
    walkLanes,
    vehicles,
    pedestrians,
    signals,
    signalClock: 0,
    density: 1,
    random,
    honks: [],
    anyEmpty: false,
    drivers: Array.from({ length: DRIVER_POOL }, () => ({ ...createThrownRider(random), goX: 0, goZ: 0, age: 0 })),
    impacts: [],
    downed: [],
  }
}

/** Moves along the lanes, and picks a new lane at the end of each. False at a dead end. */
function advance(mover: Mover, lanes: Lane[], distance: number, random: () => number): boolean {
  mover.along += distance

  while (mover.along >= lanes[mover.lane].length) {
    const lane = lanes[mover.lane]
    if (lane.next.length === 0) return false
    mover.along -= lane.length
    mover.prevLane = mover.lane
    mover.lane = pickNext(mover, lanes, random)
    // The lane after that was chosen too, if it had looked that far (`pickAfter`); `pickNext` checks it still holds.
    mover.nextLane = mover.onward?.shift() ?? -1
  }
  return true
}

/**
 * Which lane comes after this one. It's chosen early, so something steering
 * round a corner already knows which way it's going.
 */
function pickNext(mover: Mover, lanes: Lane[], random: () => number): number {
  const { next } = lanes[mover.lane]
  if (next.length === 0) return -1
  if (mover.nextLane === undefined || mover.nextLane < 0 || !next.includes(mover.nextLane) || lanes[mover.nextLane].closed) {
    // Not onto a closed road, if there's another way on.
    const open = next.filter((lane) => !lanes[lane].closed)
    const choices = open.length > 0 ? open : next
    mover.nextLane = choices[Math.floor(random() * choices.length)]
  }
  return mover.nextLane
}

/** Picks a lane to follow `from`, keeping `chosen` if it still holds: not onto a closed road, if there's another way on. */
function pickOnward(lanes: Lane[], from: number, chosen: number | undefined, random: () => number): number {
  const onward = lanes[from].next
  if (onward.length === 0) return -1
  if (chosen !== undefined && chosen >= 0 && onward.includes(chosen) && !lanes[chosen].closed) return chosen
  const open = onward.filter((lane) => !lanes[lane].closed)
  const choices = open.length > 0 ? open : onward
  return choices[Math.floor(random() * choices.length)]
}

/**
 * The lane a vehicle will be on `steps` lanes after the one it's on (1 is its next). Chosen early
 * as well, so a turn a few lanes off is indicated in time, and a way through a junction of several
 * short lanes is known before driving into it. -1 past a dead end.
 */
function laneAhead(mover: Mover, lanes: Lane[], steps: number, random: () => number): number {
  let lane = pickNext(mover, lanes, random)
  if (steps <= 1 || lane < 0) return lane
  const onward = (mover.onward ??= [])
  for (let step = 0; step < steps - 1; step++) {
    const chosen = pickOnward(lanes, lane, onward[step], random)
    // A choice that no longer holds (its road has closed) takes those after it with it.
    if (chosen !== onward[step]) onward.length = step
    if (chosen < 0) return -1
    onward[step] = chosen
    lane = chosen
  }
  return lane
}

/**
 * The curve that takes a vehicle round the corner from one lane to the next.
 * Lanes are straight, and meet at a sharp corner, which no car can follow. So
 * the corner is rounded off: the curve leaves the first lane `leg` metres before
 * the point where the two lanes' lines cross, and joins the second `leg` metres
 * after it, bending through that point (a quadratic Bézier curve, which stays
 * inside the corner's triangle). A leg of r × tan(angle / 2) makes the curve
 * about as tight as a turning circle of radius r, the tightest a car turns.
 *
 * `enter` is where on the first lane it starts, `exit` where on the second it
 * ends, and `span` how much lane distance it stands for, so a place on the lanes
 * maps onto it.
 */
type Corner = {
  enter: number
  exit: number
  span: number
  startX: number
  startZ: number
  cornerX: number
  cornerZ: number
  endX: number
  endZ: number
}

/** Corners are worked out once, and kept per set of lanes and turning circle. */
const cornerCache = new WeakMap<Lane[], Map<number, Map<number, Corner | null>>>()
/** Lanes that turn less than this, in radians, are just followed. Near U-turns are left to the steering. */
const GENTLEST_CORNER = 0.2
const SHARPEST_CORNER = 2.8
/** If the two lanes' lines cross further than this from where they join, in metres, it isn't a corner to round. */
const CORNER_REACH = 6

function findCorner(lanes: Lane[], from: number, to: number, radius: number): Corner | null {
  let byRadius = cornerCache.get(lanes)
  if (!byRadius) cornerCache.set(lanes, (byRadius = new Map()))
  let cache = byRadius.get(radius)
  if (!cache) byRadius.set(radius, (cache = new Map()))
  const key = from * 1_000_000 + to
  const known = cache.get(key)
  if (known !== undefined) return known

  const a = lanes[from]
  const b = lanes[to]
  const cross = a.forwardX * b.forwardZ - a.forwardZ * b.forwardX
  const angle = Math.atan2(Math.abs(cross), a.forwardX * b.forwardX + a.forwardZ * b.forwardZ)
  let corner: Corner | null = null
  if (angle > GENTLEST_CORNER && angle < SHARPEST_CORNER) {
    // Where the lines cross: `onA` metres along the first lane, and `onB` along the second.
    const dx = b.startX - a.startX
    const dz = b.startZ - a.startZ
    const onA = (dx * b.forwardZ - dz * b.forwardX) / cross
    const onB = (dx * a.forwardZ - dz * a.forwardX) / cross
    // The curve keeps to the far half of the first lane and the near half of the second, clear of their other corners.
    const leg = Math.min(radius * Math.tan(angle / 2), onA - a.length / 2, b.length / 2 - onB)
    if (Math.abs(onA - a.length) < CORNER_REACH && Math.abs(onB) < CORNER_REACH && leg > 0.5) {
      const cornerX = a.startX + a.forwardX * onA
      const cornerZ = a.startZ + a.forwardZ * onA
      corner = {
        enter: onA - leg,
        exit: onB + leg,
        span: a.length - (onA - leg) + onB + leg,
        startX: cornerX - a.forwardX * leg,
        startZ: cornerZ - a.forwardZ * leg,
        cornerX,
        cornerZ,
        endX: cornerX + b.forwardX * leg,
        endZ: cornerZ + b.forwardZ * leg,
      }
    }
  }
  cache.set(key, corner)
  return corner
}

/** A point on the curve, `t` from 0 to 1, moved `shift` to the left of the way it's heading there. */
function pointOnCorner(corner: Corner, t: number, shift: number): [number, number] {
  const u = Math.min(1, Math.max(0, t))
  const x = (1 - u) * (1 - u) * corner.startX + 2 * u * (1 - u) * corner.cornerX + u * u * corner.endX
  const z = (1 - u) * (1 - u) * corner.startZ + 2 * u * (1 - u) * corner.cornerZ + u * u * corner.endZ
  if (shift === 0) return [x, z]
  const tangentX = (1 - u) * (corner.cornerX - corner.startX) + u * (corner.endX - corner.cornerX)
  const tangentZ = (1 - u) * (corner.cornerZ - corner.startZ) + u * (corner.endZ - corner.cornerZ)
  const length = Math.hypot(tangentX, tangentZ) || 1
  return [x + (tangentZ / length) * shift, z - (tangentX / length) * shift]
}

/**
 * Where on its path a place on a lane is. Mostly that's the lane itself, but
 * near a corner it's on the curve round it: the end of a lane leads into the
 * curve to `next`, and the start of one comes out of the curve from `previous`.
 * `radius` 0 means no curves, for people, who simply turn on the spot.
 */
function pathPoint(
  lanes: Lane[],
  laneIndex: number,
  along: number,
  previous: number,
  next: number,
  radius: number,
  shift: number,
): [number, number] {
  const lane = lanes[laneIndex]
  if (radius > 0) {
    const ahead = next >= 0 ? findCorner(lanes, laneIndex, next, radius) : null
    if (ahead && along > ahead.enter) return pointOnCorner(ahead, (along - ahead.enter) / ahead.span, shift)
    const behind = previous >= 0 ? findCorner(lanes, previous, laneIndex, radius) : null
    if (behind && along < behind.exit) {
      return pointOnCorner(behind, (lanes[previous].length - behind.enter + along) / behind.span, shift)
    }
  }
  return [
    lane.startX + lane.forwardX * along + lane.forwardZ * shift,
    lane.startZ + lane.forwardZ * along - lane.forwardX * shift,
  ]
}

/**
 * The point `ahead` metres further along the path, carrying on into the next
 * lane if this one ends first, and `shift` metres to the left of it.
 */
function pointAhead(
  mover: Mover,
  lanes: Lane[],
  ahead: number,
  shift: number,
  radius: number,
  random: () => number,
): [number, number] {
  const lane = lanes[mover.lane]
  const next = pickNext(mover, lanes, random)
  const along = mover.along + ahead
  if (along <= lane.length || next < 0) {
    return pathPoint(lanes, mover.lane, Math.min(along, lane.length), mover.prevLane ?? -1, next, radius, shift)
  }
  const nextLane = lanes[next]
  return pathPoint(lanes, next, Math.min(along - lane.length, nextLane.length), mover.lane, -1, radius, shift)
}

/**
 * Moves something along its path the way a driver or walker would. It aims at
 * a point a little ahead, turns towards it, no faster than `turnRate` allows,
 * and moves `distance` straight ahead, so it never slides sideways. Corners come
 * out as curves.
 *
 * Its place on the path (`along`) runs on separately, so the traffic rules are
 * unchanged. If the body gets ahead of it, as it does when cutting a corner, it
 * goes a little slower until they're back in step, and a little faster if behind.
 */
function steerAlong(
  mover: Mover,
  lanes: Lane[],
  distance: number,
  aim: number,
  shift: number,
  turnRate: number,
  cornerRadius: number,
  dt: number,
  random: () => number,
) {
  const lane = lanes[mover.lane]
  const [pathX, pathZ] = pathPoint(lanes, mover.lane, mover.along, mover.prevLane ?? -1, mover.nextLane ?? -1, cornerRadius, shift)

  // Well away from its path, after a knock, or when the next path starts on the
  // other pavement, it heads straight for its place on the path, a little quicker,
  // as someone crossing the road does.
  const lost = Math.hypot(pathX - mover.x, pathZ - mover.z) > TRAFFIC_RULES.lostDistance
  const [aimX, aimZ] = lost ? [pathX, pathZ] : pointAhead(mover, lanes, aim, shift, cornerRadius, random)
  if (Math.hypot(aimX - mover.x, aimZ - mover.z) > 0.05) {
    const wanted = Math.atan2(aimX - mover.x, aimZ - mover.z)
    const turn = angleBetween(mover.heading, wanted)
    const most = turnRate * dt
    mover.heading += Math.max(-most, Math.min(most, turn))
  }

  // How far the body is ahead of its place on the path (negative is behind).
  const ahead = (mover.x - pathX) * lane.forwardX + (mover.z - pathZ) * lane.forwardZ
  const pace = lost ? TRAFFIC_RULES.catchUpPace : 1 - Math.max(-0.5, Math.min(0.8, ahead * 0.35))
  const step = distance * pace
  mover.x += Math.sin(mover.heading) * step
  mover.z += Math.cos(mover.heading) * step
}

/**
 * How far ahead the next speed breaker is, in metres, on this lane or the next,
 * measured from the vehicle's middle. Infinity if there's none that close. One
 * just behind the middle still counts as here, so the vehicle stays slow until
 * it's over.
 */
function breakerAhead(world: TrafficWorld, vehicle: Vehicle, random: () => number): number {
  const behind = vehicle.halfLength + BREAKER.halfDepth
  let nearest = Infinity
  for (const at of world.breakers[vehicle.lane]) {
    if (at > vehicle.along - behind) nearest = Math.min(nearest, Math.max(0, at - vehicle.along))
  }
  if (nearest < Infinity) return nearest
  const next = pickNext(vehicle, world.roadLanes, random)
  if (next < 0) return Infinity
  const toEnd = world.roadLanes[vehicle.lane].length - vehicle.along
  for (const at of world.breakers[next]) nearest = Math.min(nearest, toEnd + at)
  return nearest
}

/** How high a breaker lifts a vehicle here: the hump under its middle, as its wheels straddle it. */
function breakerLift(world: TrafficWorld, vehicle: Vehicle): number {
  let lift = 0
  for (const at of world.breakers[vehicle.lane]) lift = Math.max(lift, breakerHeight(vehicle.along - at))
  return lift
}

/** How sharply the path turns where this lane meets the next, in radians, and how far away that is. */
function nextTurn(mover: Mover, lanes: Lane[], random: () => number): { angle: number; distance: number } {
  const lane = lanes[mover.lane]
  const next = pickNext(mover, lanes, random)
  if (next < 0) return { angle: 0, distance: Infinity }
  const after = lanes[next]
  const angle = Math.abs(angleBetween(Math.atan2(lane.forwardX, lane.forwardZ), Math.atan2(after.forwardX, after.forwardZ)))
  return { angle, distance: Math.max(0, lane.length - mover.along) }
}

/** The rider's size, for traffic deciding whether it can squeeze past. */
const RIDER_HALF_LENGTH = 1
/** Someone lying down, as traffic sees them: about a body's length, any way round. */
const DOWNED_HALF_LENGTH = 0.9
const DOWNED_RADIUS = 0.9

/**
 * Something in the road that traffic must not drive into. A person: `lying` makes them a body's
 * length; standing, they're narrow; `crossing`, they're on their way over the road, and traffic
 * gives them room on either side. Or a thing with a size of its own (`halfLength` along the road,
 * `radius` across it): it stands there, and traffic goes round it.
 */
type Obstacle = { x: number; z: number; lying: boolean; crossing?: boolean; halfLength?: number; radius?: number }

/** Something standing in the road that isn't traffic: where, and its size along the road and across it, in metres. */
export type RoadObstacle = { x: number; z: number; halfLength: number; radius: number }

/**
 * Whether a lane is a plain stretch of road, with no junction on it or within two lanes either
 * way: somewhere a thing can stand in the road and be queued behind and gone round. Right by a
 * junction, the queue would stand in the junction, and nothing could get round anything.
 */
export function isPlainRoad(world: TrafficWorld, index: number): boolean {
  const { junctions, roadLanes } = world
  const near = (lane: number) => junctions.junctionOf[lane] >= 0 || junctions.clearAt[lane] > 0
  if (near(index)) return false
  for (const next of roadLanes[index].next) {
    if (near(next) || roadLanes[next].next.some(near)) return false
  }
  return true
}

/** Puts something in the road for traffic to queue behind and go round (or takes it away, with null). */
export function setObstacle(world: TrafficWorld, owner: string, obstacle: RoadObstacle | null) {
  if (obstacle) world.obstacles.set(owner, obstacle)
  else world.obstacles.delete(owner)
}

/** A person on their way across the road is given this much room either side by traffic, in metres. */
const CROSSING_ROOM = 1.4
/**
 * What's in a vehicle's way: the rider (or a person, or a vehicle standing empty for them), a
 * queue, something standing in the lane that won't move for a while (a breakdown, a drop-off, a
 * cow), or traffic crossing in front.
 */
type Blocked = 'rider' | 'queue' | 'standing' | 'crossing' | null
/** Nothing further from a vehicle than this, along either axis, is looked at when it looks ahead, in metres. */
const GAP_REACH = TRAFFIC_RULES.lookAhead + 7

/**
 * The space between this vehicle's front bumper and the back of whatever is in
 * its way, or Infinity. `sideways` asks "what if I moved over this far?", which
 * is how two-wheelers look for a gap. Negative is to the right.
 */
function findGapAhead(
  vehicle: Vehicle,
  lane: Lane,
  others: Vehicle[],
  rider: ScooterState,
  downed: Obstacle[],
  sideways = 0,
): { gap: number; blockedBy: Blocked; blocker: Vehicle | null } {
  let gap = Infinity
  let blockedBy: Blocked = null
  let blocker: Vehicle | null = null
  let checking: Vehicle | null = null
  const noseX = Math.sin(vehicle.heading)
  const noseZ = Math.cos(vehicle.heading)
  const turning = sideways === 0 && noseX * lane.forwardX + noseZ * lane.forwardZ < TURNING

  const check = (x: number, z: number, halfLength: number, radius: number, kind: 'rider' | 'queue' | 'standing', oncoming = false) => {
    const offsetX = x - vehicle.x
    const offsetZ = z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    // Positive is to the left, the same way round as `shift`.
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX - sideways
    if (ahead <= 0 || ahead > TRAFFIC_RULES.lookAhead) return
    if (Math.abs(side) > vehicle.radius + radius + TRAFFIC_RULES.sideClearance) return
    // Something coming the other way, on its own side of the road, isn't a queue to wait behind: they
    // pass. Two that each waited for the other to go would wait for ever. Only one dead ahead counts.
    if (oncoming && Math.abs(side) > Math.max(vehicle.radius, radius) * ONCOMING_IN_LINE) return
    const space = ahead - vehicle.halfLength - halfLength
    // Part-way round a corner it isn't lined up with its lane, and the lane's line ahead isn't where
    // it's pointing: something close that's ahead along the lane, but not in front of its nose, isn't
    // in its way (a bus swinging round past the vehicles waiting at the next road's line).
    if (turning && space < TURNING_NEAR) {
      const aheadOfNose = offsetX * noseX + offsetZ * noseZ
      const besideNose = offsetX * noseZ - offsetZ * noseX
      if (aheadOfNose <= 0 || Math.abs(besideNose) > vehicle.radius + radius + TRAFFIC_RULES.sideClearance) return
    }
    // Edging through a lock (`mayBarge`), what it's already in among can't be waited for.
    if (vehicle.barging && checking && space < 0) return
    if (space < gap) {
      gap = space
      blockedBy = kind
      blocker = checking
    }
  }

  /**
   * Two vehicles crossing can't see each other in their lanes. So at a crossing
   * the one earlier in the list gives way. Nobody can end up waiting in a circle,
   * as the last one in the list never gives way to anyone.
   */
  const checkCrossing = (other: Vehicle) => {
    const offsetX = other.x - vehicle.x
    const offsetZ = other.z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX
    if (ahead <= 0 || ahead > TRAFFIC_RULES.junctionRange || Math.abs(side) > ahead + 1) return
    // One waiting at its line outside a junction isn't in the way of anything in it, and whoever is at
    // a line is told what's in its way by the junction's own rules (junctions.ts).
    if (vehicle.atLine || other.atLine) return

    const sameLine = Math.abs(Math.sin(other.heading) * lane.forwardX + Math.cos(other.heading) * lane.forwardZ)
    // Crossing traffic is side-on, so its width is what's in the way.
    const space = ahead - vehicle.halfLength - other.radius
    if (sameLine < 0.7 && space < gap) {
      gap = space
      blockedBy = 'crossing'
      blocker = other
    }
  }

  // The rider's vehicle at its real size: traffic queues behind a van's tail, and leaves a van's width.
  check(rider.x, rider.z, Math.max(RIDER_HALF_LENGTH, tuning.halfLength), tuning.radius, 'rider')
  // Nobody drives over someone lying in the road. Stuck behind them, they lean on the horn.
  for (const body of downed) {
    if (body.halfLength !== undefined) check(body.x, body.z, body.halfLength, body.radius ?? body.halfLength, 'standing')
    else if (body.lying) check(body.x, body.z, DOWNED_HALF_LENGTH, DOWNED_RADIUS, 'rider')
    else check(body.x, body.z, PERSON_RADIUS, PERSON_RADIUS + (body.crossing ? CROSSING_ROOM : 0), 'rider')
  }
  const inLane = sideways === 0 && Math.abs(vehicle.shift) < 0.3
  // Its own place in the list comes up on the way through it: those after it are the ones it gives way to at a crossing.
  let passedSelf = false
  for (let place = 0; place < others.length; place++) {
    const other = others[place]
    if (other === vehicle) {
      passedSelf = true
      continue
    }
    if (other.lane === -1 || other === vehicle.barging) continue
    // Nothing further off than it looks (`lookAhead`, plus the longest vehicle) can be in its way: most of the list goes here.
    const apartX = other.x - vehicle.x
    const apartZ = other.z - vehicle.z
    if (apartX > GAP_REACH || apartX < -GAP_REACH || apartZ > GAP_REACH || apartZ < -GAP_REACH) continue
    // One standing empty for the player is gone round like the rider's own parked vehicle, not queued behind.
    // Keeping to its lane, that is: a two-wheeler out in the other side of the road still looks for everything.
    const oncoming = inLane && other.speed > 0.2 && Math.sin(other.heading) * lane.forwardX + Math.cos(other.heading) * lane.forwardZ < ONCOMING
    checking = other
    check(other.x, other.z, other.halfLength, other.radius, other.taken === 'empty' ? 'rider' : other.halt ? 'standing' : 'queue', oncoming)
    checking = null
    if (passedSelf) checkCrossing(other)
  }
  return { gap, blockedBy, blocker }
}

/** Heading this much against a lane's direction (a cosine) is coming the other way; and it's dead ahead within this share of the wider one's half width. */
const ONCOMING = -0.5
const ONCOMING_IN_LINE = 0.8
/** Pointing this far off its lane's line (a cosine: about 20°), a vehicle is turning; then what's within this of its nose along the lane, in metres, must be in front of the nose itself to be in its way. */
const TURNING = 0.94
const TURNING_NEAR = 2

/** Two footprints closer than this, in metres, count as touching: a sliver for the shapes' rounding. */
const TOUCH_SLACK = 0.05

/**
 * How deep a vehicle is into the others on the road, in metres, summed: each footprint is a
 * capsule along its heading (its length, rounded at the ends by its half width).
 */
function overlapWithTraffic(vehicle: Vehicle, others: Vehicle[]): number {
  let depth = 0
  const reach = vehicle.halfLength + 6
  for (const other of others) {
    if (other === vehicle || other.lane === -1 || other.body) continue
    if (Math.abs(other.x - vehicle.x) > reach + other.halfLength || Math.abs(other.z - vehicle.z) > reach + other.halfLength) continue
    const gap = capsuleDistance(vehicle, other) - vehicle.radius - other.radius + TOUCH_SLACK
    if (gap < 0) depth -= gap
  }
  return depth
}

/** The distance between two vehicles' middle lines, each running along its heading for its length less its rounded ends. */
function capsuleDistance(a: Vehicle, b: Vehicle): number {
  const ends = (v: Vehicle): [number, number, number, number] => {
    const half = Math.max(0, v.halfLength - v.radius)
    const fx = Math.sin(v.heading) * half
    const fz = Math.cos(v.heading) * half
    return [v.x - fx, v.z - fz, v.x + fx, v.z + fz]
  }
  return segmentDistance(...ends(a), ...ends(b))
}

function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const toSegment = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const ex = x1 - x0
    const ez = z1 - z0
    const lengthSquared = ex * ex + ez * ez
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * ex + (pz - z0) * ez) / lengthSquared))
    return Math.hypot(px - (x0 + ex * t), pz - (z0 + ez * t))
  }
  // Crossing segments touch; otherwise the nearest pair of points has an end of one segment in it.
  const cross = (x0: number, z0: number, x1: number, z1: number, x2: number, z2: number) => (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0)
  const d1 = cross(ax, az, bx, bz, cx, cz)
  const d2 = cross(ax, az, bx, bz, dx, dz)
  const d3 = cross(cx, cz, dx, dz, ax, az)
  const d4 = cross(cx, cz, dx, dz, bx, bz)
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0
  return Math.min(toSegment(ax, az, cx, cz, dx, dz), toSegment(bx, bz, cx, cz, dx, dz), toSegment(cx, cz, ax, az, bx, bz), toSegment(dx, dz, ax, az, bx, bz))
}

/** A vehicle in the air or on its side, until it's ready to rejoin traffic. */
function stepCrashedVehicle(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, dt: number) {
  const rules = TRAFFIC_RULES
  const { physics } = world

  physics.readBack(vehicle, vehicle.crash)
  vehicle.crashTime += dt

  const settled = vehicle.body?.isSleeping() === true
  const isBike = vehicle.kind === 'bike'
  const upright = uprightness(vehicle.rotation) > 0.8
  // A bike is picked up once its rider has walked back to it.
  const finished = isBike
    ? (vehicle.crashTime > rules.bikeDownTime && !vehicle.riderOff) || vehicle.crashTime > rules.maxCrashTime * 2
    : (settled && upright) || vehicle.crashTime > rules.maxCrashTime
  if (!finished) return

  const farAway = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.clearDistance
  if (!isBike && !upright && !farAway) return

  physics.removeBody(vehicle)
  vehicle.recovery = 0
  // A wreck that can't drive away is cleared, and a new vehicle appears elsewhere.
  if (!isBike && !upright) {
    vehicle.lane = -1
    vehicle.rotation = null
    vehicle.lift = 0
    return
  }
  if (vehicle.thrownRider) mountRider(vehicle, vehicle.thrownRider)
  vehicle.fallen = vehicle.rotation ?? yawRotation(vehicle.heading)
  vehicle.fallenLift = vehicle.lift
  vehicle.rising = 0
}

/** A fallen vehicle is stood back up over a moment, rather than snapping upright. */
function stepRightingVehicle(vehicle: Vehicle, dt: number) {
  if (!vehicle.fallen) return
  vehicle.rising = Math.min(1, vehicle.rising + dt / TRAFFIC_RULES.rightingTime)
  const amount = smooth(vehicle.rising)
  vehicle.rotation = blendRotation(vehicle.fallen, yawRotation(vehicle.heading), amount)
  vehicle.lift = vehicle.fallenLift * (1 - amount)
  if (vehicle.rising < 1) return
  vehicle.fallen = null
  vehicle.rotation = null
  vehicle.lift = 0
}

/**
 * Throws a bike's rider off as the bike is hit. They carry on with most of the
 * bike's speed plus some of the knock, come up off the seat, and tumble.
 */
function throwRiderOff(
  world: TrafficWorld,
  vehicle: Vehicle,
  thrown: Pedestrian,
  bikeX: number,
  bikeZ: number,
  knockX: number,
  knockZ: number,
) {
  const rules = TRAFFIC_RULES
  thrown.x = vehicle.x
  thrown.z = vehicle.z
  // The same clothes as the rider drawn on the bike.
  thrown.tint = vehicle.tint
  thrown.heading = vehicle.heading
  thrown.lift = 0.35
  thrown.rotation = null
  thrown.fallen = null
  thrown.downTime = 0
  thrown.down = 0.3
  thrown.hidden = false
  vehicle.riderOff = true

  world.physics.addBody(thrown, PERSON_SHAPE, false)
  const { velocity, spin } = throwFor(
    knockX * 0.6,
    knockZ * 0.6,
    bikeX * rules.riderCarry,
    bikeZ * rules.riderCarry,
    PERSON_THROW,
    thrown.heading,
  )
  velocity[1] += rules.riderLaunchUp
  world.physics.launch(thrown, velocity, spin)
}

/** Puts a thrown rider back on their bike, and hides them again. */
function mountRider(vehicle: Vehicle, thrown: Pedestrian) {
  thrown.hidden = true
  thrown.fallen = null
  thrown.rotation = null
  thrown.down = 0
  vehicle.riderOff = false
}

/** A thrown rider lies there, gets up, and walks back to their bike. */
function stepThrownRider(world: TrafficWorld, vehicle: Vehicle, thrown: Pedestrian, dt: number) {
  if (thrown.body || thrown.fallen) {
    stepKnockedPedestrian(world, thrown, dt)
    return
  }

  const toBikeX = vehicle.x - thrown.x
  const toBikeZ = vehicle.z - thrown.z
  const distance = Math.hypot(toBikeX, toBikeZ)
  if (distance <= TRAFFIC_RULES.remountDistance) {
    // Waits by the bike a moment, then picks it up and gets on.
    if (vehicle.body && vehicle.crashTime < TRAFFIC_RULES.bikeDownTime) return
    mountRider(vehicle, thrown)
    return
  }

  const step = Math.min(distance, TRAFFIC_RULES.walkBackSpeed * dt)
  thrown.x += (toBikeX / distance) * step
  thrown.z += (toBikeZ / distance) * step
  thrown.heading = Math.atan2(toBikeX, toBikeZ)
  thrown.stride += step * STRIDE_PER_METRE
}

/**
 * Two-wheelers and autos don't queue. With something close ahead, they try the
 * gap to the right (towards the middle of the road, and often into it) and the
 * gap to the left (along the kerb), and take whichever leaves the most room.
 * With the way clear again, they drift back to their lane.
 */
function squeezeThrough(
  vehicle: Vehicle,
  lane: Lane,
  active: Vehicle[],
  rider: ScooterState,
  downed: Obstacle[],
  dt: number,
  /** The furthest left it may go here, past a parked vehicle (see `parkedLimit`). */
  limit = Infinity,
) {
  const rules = TRAFFIC_RULES
  const roomAt = (shift: number) => findGapAhead(vehicle, lane, active, rider, downed, Math.min(shift, limit) - vehicle.shift).gap

  const here = roomAt(vehicle.shiftTarget)
  if (here < rules.squeezeLookAt) {
    let best = vehicle.shiftTarget
    let bestRoom = here
    // Cars and buses need more room to get by, and take the other side of the road only when nothing is coming along it.
    const shifts = vehicle.nimble ? NIMBLE_SHIFTS : WIDE_SHIFTS
    for (const shift of shifts) {
      // Two-wheelers and autos look a shorter way: they're past in a moment, but not into the face of something coming.
      if (shift < vehicle.shiftTarget - 0.1 && !otherSideClear(vehicle, lane, active, shift, vehicle.nimble ? rules.passClearNimble : rules.passClear)) continue
      const room = roomAt(shift)
      // A clear margin is needed to change, or it would dither between two gaps.
      if (room > bestRoom + 1.5) {
        best = shift
        bestRoom = room
      }
    }
    vehicle.shiftTarget = best
  } else if (vehicle.shiftTarget !== 0 && roomAt(0) >= rules.squeezeLookAt) {
    vehicle.shiftTarget = 0
  }
  vehicle.shiftTarget = Math.min(vehicle.shiftTarget, limit)
  easeShift(vehicle, dt)
}

const NIMBLE_SHIFTS = [0, TRAFFIC_RULES.squeezeRight, TRAFFIC_RULES.passWide, TRAFFIC_RULES.squeezeLeft]
const WIDE_SHIFTS = [0, TRAFFIC_RULES.squeezeRight, TRAFFIC_RULES.passWide, TRAFFIC_RULES.passWide - 0.6, TRAFFIC_RULES.squeezeLeft]

/**
 * Whether the way is clear of oncoming traffic, for pulling out `shift` metres to the right to pass
 * something: nothing coming this way within `passClear` metres along the strip it would drive in.
 */
function otherSideClear(vehicle: Vehicle, lane: Lane, others: Vehicle[], shift: number, reach: number): boolean {
  for (const other of others) {
    if (other === vehicle || other.lane === -1 || other.speed < 0.5) continue
    if (Math.sin(other.heading) * lane.forwardX + Math.cos(other.heading) * lane.forwardZ > ONCOMING) continue
    const offsetX = other.x - vehicle.x
    const offsetZ = other.z - vehicle.z
    const ahead = offsetX * lane.forwardX + offsetZ * lane.forwardZ
    if (ahead < 0 || ahead > reach) continue
    const side = offsetX * lane.forwardZ - offsetZ * lane.forwardX - shift
    if (Math.abs(side) < vehicle.radius + other.radius + 0.5) return false
  }
  return true
}

/** A rider on foot in the way is honked at from this far, in metres. */
const WALKER_HONK_GAP = 9
const aheadIsRider = (ahead: { gap: number; blockedBy: string | null }) => ahead.blockedBy === 'rider' && ahead.gap < TRAFFIC_RULES.squeezeLookAt
const aheadIsStanding = (ahead: { gap: number; blockedBy: string | null }) => ahead.blockedBy === 'standing' && ahead.gap < TRAFFIC_RULES.squeezeLookAt + TRAFFIC_RULES.standingGap

/** Where a vehicle's file runs on a lane, sideways from the lane's line. */
function fileOffset(vehicle: Vehicle, lane: Lane): number {
  const files = lane.files
  if (!files) return 0
  return files[vehicle.kind === 'bus' ? 0 : vehicle.file % files.length]
}

/** Moves a vehicle over to its file, as a driver changes lanes: at `FILE_SPEED` m/s sideways. */
const FILE_SPEED = 1.5
function easeFile(vehicle: Vehicle, lane: Lane, dt: number) {
  const change = fileOffset(vehicle, lane) - vehicle.fileShift
  vehicle.fileShift += Math.sign(change) * Math.min(Math.abs(change), FILE_SPEED * dt)
}

function easeShift(vehicle: Vehicle, dt: number) {
  const change = vehicle.shiftTarget - vehicle.shift
  vehicle.shift += Math.sign(change) * Math.min(Math.abs(change), TRAFFIC_RULES.squeezeSpeed * dt)
}

/** Looks this far ahead for parked vehicles to ease out around, in metres, so the move starts in time. */
const PARKED_LOOK_AHEAD = 7

/**
 * The furthest left a vehicle may run on its lane here, as a shift: past a vehicle parked at the
 * kerb, its left side stays right of the parked one's inner side. Infinity where nothing's parked.
 */
function parkedLimit(vehicle: Vehicle, lane: Lane): number {
  if (!lane.parked) return Infinity
  let limit = Infinity
  const back = vehicle.along - vehicle.halfLength
  const front = vehicle.along + vehicle.halfLength + PARKED_LOOK_AHEAD
  for (const { from, to, edge } of lane.parked) {
    if (to < back || from > front) continue
    limit = Math.min(limit, edge - vehicle.radius)
  }
  return limit
}

/** Horns: long and often when the rider is in the way, now and then in a queue, and the odd one anyway. */
function maybeHonk(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, riderInWay: boolean, dt: number) {
  const rules = TRAFFIC_RULES
  vehicle.honkWait -= dt
  vehicle.blockedTime = riderInWay ? vehicle.blockedTime + dt : 0
  if (vehicle.honkWait > 0) return
  if (Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.honkHearing) return

  const random = world.random
  const stuck = vehicle.speed < 0.5
  const atRider = vehicle.blockedTime > rules.honkAtRiderAfter
  const rate = stuck ? rules.queueHonkRate : rules.movingHonkRate
  if (!atRider && random() > rate * dt) return

  world.honks.push({ x: vehicle.x, z: vehicle.z, kind: vehicle.kind })
  vehicle.honkWait = atRider ? 0.8 + random() * 1.5 : 2 + random() * 3
}

/** How long a bus waits at a stop, in seconds, and how far ahead it looks for one, in metres. */
const BUS_STOP = { dwell: 9, lookAhead: 70, reach: 15 }

const busStopKey = (lane: number, along: number) => lane * 100000 + Math.round(along)

/**
 * Gives each lane buses run on the stops beside it: a stop belongs to the bus lane nearest it
 * (the kerb lane on its side), where along that lane it is. Shelters are at OSM's stops
 * (landmarkPlacement.ts), so buses stop where the city's do.
 */
export function setBusStops(world: TrafficWorld, stops: { x: number; z: number }[]) {
  const byLane: number[][] = world.roadLanes.map(() => [])
  for (const { x, z } of stops) {
    let best = -1
    let bestDistance: number = BUS_STOP.reach
    let bestAlong = 0
    world.roadLanes.forEach((lane, index) => {
      if (!lane.buses || lane.length < 1) return
      const along = (x - lane.startX) * lane.forwardX + (z - lane.startZ) * lane.forwardZ
      if (along < 0 || along > lane.length) return
      const distance = Math.hypot(x - (lane.startX + lane.forwardX * along), z - (lane.startZ + lane.forwardZ * along))
      if (distance < bestDistance) {
        best = index
        bestDistance = distance
        bestAlong = along
      }
    })
    if (best >= 0) byLane[best].push(bestAlong)
  }
  byLane.forEach((list) => list.sort((a, b) => a - b))
  world.busStops = byLane
}

/**
 * For a bus: the speed that stops it at the next stop ahead on its lane, Infinity with none near,
 * 0 while it waits there. Starts the wait when it arrives.
 */
function busStopSpeed(world: TrafficWorld, vehicle: Vehicle, dt: number): number {
  if ((vehicle.busDwell ?? 0) > 0) {
    vehicle.busDwell = (vehicle.busDwell ?? 0) - dt
    return 0
  }
  // Lanes are short pieces of road: look along this one, then the one it has chosen next.
  const ahead: { lane: number; offset: number }[] = [{ lane: vehicle.lane, offset: -vehicle.along }]
  const current = world.roadLanes[vehicle.lane]
  if (current && vehicle.nextLane !== undefined && vehicle.nextLane >= 0) ahead.push({ lane: vehicle.nextLane, offset: current.length - vehicle.along })
  for (const { lane, offset } of ahead) {
    for (const along of world.busStops?.[lane] ?? []) {
      const distance = along + offset
      if (distance < -1 || distance > BUS_STOP.lookAhead) continue
      const key = busStopKey(lane, along)
      if (vehicle.servedStop === key) continue
      if (distance < 0.8 && vehicle.speed < 0.6) {
        vehicle.busDwell = BUS_STOP.dwell
        vehicle.servedStop = key
        return 0
      }
      return Math.sqrt(2 * TRAFFIC_RULES.signalBraking * Math.max(0, distance))
    }
  }
  return Infinity
}

/** For looking into a standstill from the console or a headless run: with `reasons` on, each vehicle says what is limiting its speed. */
export const trafficDebug = { reasons: false }

/** A turn is indicated from this far before the junction, in metres. */
const INDICATE_FROM = 30

function stepVehicle(world: TrafficWorld, vehicle: Vehicle, active: Vehicle[], rider: ScooterState, dt: number) {
  const { roadLanes, random } = world
  const rules = TRAFFIC_RULES

  vehicle.recovery = Math.min(1, vehicle.recovery + dt / rules.recoveryTime)

  const lane = roadLanes[vehicle.lane]

  // On a wide road it keeps to its own file.
  easeFile(vehicle, lane, dt)
  // Out around anything parked at the kerb; two-wheelers and autos squeeze about as well, no further left.
  const limit = parkedLimit(vehicle, lane) - vehicle.fileShift
  // Up on a deck, nobody lying in the road below is in the way.
  const downed = (vehicle.deck ?? 0) > UP_ON_DECK_TRAFFIC ? [] : world.downed
  // With the rider on foot, cars and buses too ease out around them and their parked vehicle, as around anyone in the road.
  const afoot = rider.rider.phase === 'afoot'
  // And round anything standing in the lane: a breakdown, someone being let out, a cow.
  const look = vehicle.nimble || vehicle.halt ? null : findGapAhead(vehicle, lane, active, rider, downed)
  const aroundWalker = look !== null && (vehicle.shiftTarget !== 0 || aheadIsStanding(look) || ((afoot || world.anyEmpty) && aheadIsRider(look)))
  if (vehicle.halt) {
    // Letting someone out, it pulls in to the kerb; broken down, it stops where it is.
    vehicle.shiftTarget = Math.min(vehicle.halt.kind === 'dropOff' ? rules.squeezeLeft : 0, limit)
    easeShift(vehicle, dt)
  } else if (vehicle.nimble || aroundWalker) squeezeThrough(vehicle, lane, active, rider, downed, dt, limit)
  else {
    vehicle.shiftTarget = Math.min(0, limit)
    easeShift(vehicle, dt)
  }

  const { gap, blockedBy, blocker } = findGapAhead(vehicle, lane, active, rider, downed)
  const hasWaited = blockedBy === 'crossing' && vehicle.waiting > rules.patience
  // Behind something standing in the lane, traffic leaves room to swing out round it; once it's
  // pulling out, it closes up as it goes.
  const pullingOut = Math.abs(vehicle.shiftTarget) > 0.5
  const keep = blockedBy !== 'standing' ? (vehicle.nimble ? rules.nimbleGap : rules.carGap) : vehicle.nimble ? rules.standingGap / 2 : pullingOut ? rules.carGap : rules.standingGap

  // Two fixes for a vehicle that's stopped with no room to steer where it wants to go.
  const tryMove = (stepX: number, stepZ: number): boolean => {
    const fromX = vehicle.x
    const fromZ = vehicle.z
    const before = overlapWithTraffic(vehicle, active)
    vehicle.x += stepX
    vehicle.z += stepZ
    if (overlapWithTraffic(vehicle, active) <= before + 0.001) return true
    vehicle.x = fromX
    vehicle.z = fromZ
    return false
  }
  const noseToNose = blocker !== null && gap < 2 && Math.sin(blocker.heading) * lane.forwardX + Math.cos(blocker.heading) * lane.forwardZ < ONCOMING
  const tooClose = blockedBy === 'standing' && pullingOut && gap < keep + 0.4
  if (vehicle.speed < 0.2 && vehicle.nimble && ((vehicle.shift < -0.4 && noseToNose) || tooClose)) {
    // A two-wheeler or an auto is paddled sideways, the only time anything moves that way: back
    // towards its own lane from in front of something coming, or out round what's standing in front.
    const wanted = (noseToNose ? 0 : vehicle.shiftTarget) + vehicle.fileShift
    const lateral = (vehicle.x - lane.startX) * lane.forwardZ - (vehicle.z - lane.startZ) * lane.forwardX
    const step = Math.max(-rules.paddleSpeed * dt, Math.min(rules.paddleSpeed * dt, wanted - lateral))
    if (Math.abs(step) > 0.0005 && tryMove(lane.forwardZ * step, -lane.forwardX * step) && noseToNose) {
      vehicle.shift = Math.min(0, vehicle.shift + Math.abs(step))
      vehicle.shiftTarget = Math.max(vehicle.shiftTarget, vehicle.shift)
    }
  } else if (!vehicle.nimble && vehicle.speed < 0.2 && (vehicle.reversing || tooClose)) {
    // A car or a bus backs up for the room to swing out, if there's nothing behind it.
    const step = rules.backOffSpeed * dt
    vehicle.reversing = blockedBy === 'standing' && gap < rules.standingGap && tryMove(-Math.sin(vehicle.heading) * step, -Math.cos(vehicle.heading) * step)
    if (vehicle.reversing) vehicle.along = Math.max(0, vehicle.along - step)
  } else vehicle.reversing = false
  const cruise = vehicle.cruiseSpeed
  const free = hasWaited ? cruise : Math.min(cruise, Math.max(0, gap - keep))

  // Patience never overrules a red light, unless this one doesn't stop for them at all.
  // The speed that stops it in time is sqrt(2 x braking x distance).
  const toStop = vehicle.rebel
    ? Infinity
    : findStopAhead(
        roadLanes,
        vehicle.lane,
        vehicle.along,
        vehicle.halfLength,
        vehicle.speed,
        world.signals,
        world.signalClock,
      )
  const held = Math.sqrt(2 * rules.signalBraking * toStop)
  // Slow for a speed breaker ahead, on this lane or the next, and crawl over it.
  const bump = breakerAhead(world, vehicle, random)
  const bumpSpeed = vehicle.nimble ? rules.breakerSpeedNimble : rules.breakerSpeed
  const forBump = Math.sqrt(bumpSpeed * bumpSpeed + 2 * rules.cornerBraking * Math.max(0, bump - vehicle.halfLength))
  // Slow for a sharp turn ahead: a right angle at `cornerSpeed`, gentler bends faster.
  const turn = nextTurn(vehicle, roadLanes, random)
  const bendSpeed = turn.angle < 0.3 ? Infinity : rules.cornerSpeed * Math.max(0.6, (Math.PI / 2 / turn.angle) ** 0.7)
  const forBend = Math.sqrt(bendSpeed * bendSpeed + 2 * rules.cornerBraking * turn.distance)
  // A bus pulls up at each stop on its lane, and waits (setBusStops).
  const forStop = vehicle.kind === 'bus' ? busStopSpeed(world, vehicle, dt) : Infinity
  // Hailed by the player on foot, it pulls up where it is, a little more firmly than for a light.
  const hailed = vehicle.taken === 'hailed'
  // At a junction: slow to look, and stop at the line until the way through is clear (junctions.ts).
  const forJunction = vehicle.junctionSpeed ?? Infinity
  const halt = vehicle.halt
  let target = hailed || halt || vehicle.reversing ? 0 : Math.min(free, held, forBend, forBump, forStop, forJunction) * vehicle.recovery
  // Its own hold-up runs out once it has pulled up: then it's ordinary traffic again.
  if (halt && vehicle.speed < 0.1) {
    halt.left -= dt
    if (halt.left <= 0) {
      vehicle.halt = null
      vehicle.hazard = false
    }
  }
  // A driver takes a moment to set off once the way opens, so a queue moves off from its front, one after another.
  if (vehicle.speed < 0.15 && target > 0.5) {
    vehicle.setOffIn ??= (rules.setOff[0] + vehicle.tint * (rules.setOff[1] - rules.setOff[0])) * (vehicle.nimble ? 0.5 : 1)
    vehicle.setOffIn -= dt
    if (vehicle.setOffIn > 0) target = 0
  } else if (vehicle.speed > 0.5) vehicle.setOffIn = undefined

  if (trafficDebug.reasons) {
    vehicle.reason = `gap ${gap.toFixed(1)} (${blockedBy ?? 'clear'}), light ${held.toFixed(1)}, bend ${forBend.toFixed(1)}, bus stop ${forStop.toFixed(1)}, junction ${forJunction.toFixed(1)}${vehicle.claim ? ' going' : vehicle.atLine ? ' at line' : ''}${vehicle.crossing ? ' crossing' : ''}`
  }
  // Stopped by what's in front of it, not by a line or a light: it isn't about to go anywhere (junctions.ts).
  vehicle.stalled = free < 0.3 && vehicle.speed < 0.5 && !halt
  vehicle.blocker = vehicle.stalled ? blocker : null
  // The brake lamps: slowing down, or standing with a foot on the brake.
  vehicle.braking = target < vehicle.speed - 0.05 || (vehicle.speed < 0.2 && target < 0.2)
  const rate = target < vehicle.speed ? (halt ? rules.signalBraking : rules.braking * (hailed ? HAIL_BRAKING : 1)) : rules.acceleration
  const change = target - vehicle.speed
  vehicle.speed += Math.sign(change) * Math.min(Math.abs(change), rate * dt)

  // Waiting at a light isn't a deadlock, or the whole queue would barge off together on green.
  const atLight = toStop !== Infinity
  // Nor is waiting at a junction's line for a gap.
  const atJunction = forJunction < 0.3
  vehicle.waiting = vehicle.speed < 0.3 && !atLight && !atJunction && !halt && !((vehicle.busDwell ?? 0) > 0) ? vehicle.waiting + dt : 0
  if (hasWaited) vehicle.waiting = rules.patience + 1

  // On foot they're honked at from further back: a horn as it slows, not only once it has stopped.
  const walkerInWay = afoot && blockedBy === 'rider' && gap < WALKER_HONK_GAP
  // The first sight of them in the way brings the horn forward, so it sounds as the vehicle slows.
  if (walkerInWay && vehicle.blockedTime === 0) vehicle.honkWait = Math.min(vehicle.honkWait, 0.5)
  maybeHonk(world, vehicle, rider, walkerInWay || (blockedBy === 'rider' && gap < 3), dt)

  if (!advance(vehicle, roadLanes, vehicle.speed * dt, random)) {
    vehicle.lane = -1
    return
  }
  // Onto a closed road with no other way to go (a procession's street): it's taken off the road.
  if (roadLanes[vehicle.lane].closed) {
    vehicle.lane = -1
    return
  }

  // The indicator: for its turn at the junction ahead, from a little way off, and on until it's through.
  vehicle.indicator = vehicle.halt?.kind === 'dropOff' ? 1 : indicatorFor(world.junctions, roadLanes, vehicle, (mover, steps) => laneAhead(mover, roadLanes, steps, random), INDICATE_FROM)

  // Corners are rounded to about the vehicle's turning circle (see `findCorner`), and it follows that
  // curve. It turns no tighter than a little inside that circle, so the slower it goes, the slower it turns.
  const radius = vehicle.nimble ? rules.nimbleTurnRadius : rules.carTurnRadius
  const aim = Math.max(rules.aimMin, Math.min(rules.aimMax, vehicle.speed * rules.aimTime))
  const turnRate = vehicle.speed / (radius * rules.steeringSlack)
  // `shift` moves its line sideways: positive left, negative right. It steers over to it.
  steerAlong(vehicle, roadLanes, vehicle.speed * dt, aim, vehicle.shift + vehicle.fileShift, turnRate, radius, dt, random)
  // Up and over a breaker. The body rises with the hump under its middle. On a flyover, it's at the deck's height.
  vehicle.deck = deckHeightOn(roadLanes[vehicle.lane], vehicle.along, world.decks)
  vehicle.lift = breakerLift(world, vehicle) + vehicle.deck

  // If a tight corner still carries it wide, the wall stops it, rather than it driving through.
  // Not up on a deck: the buildings and pillars are below.
  const beforeX = vehicle.x
  const beforeZ = vehicle.z
  if (vehicle.deck <= UP_ON_DECK_TRAFFIC) pushOutOfBuildings(world.collisions, vehicle, vehicle.radius * rules.wallMargin)
  const pushed = vehicle.x !== beforeX || vehicle.z !== beforeZ
  vehicle.pinned = pushed ? vehicle.pinned + dt : Math.max(0, vehicle.pinned - dt)
  // One that stays stuck, out of the rider's sight, is taken away, and a new one appears elsewhere.
  const unseen = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) > rules.pinnedRemoveDistance
  if (vehicle.pinned > rules.pinnedTime && unseen) vehicle.lane = -1
}

type Impact = { pushX: number; pushZ: number; changeX: number; changeZ: number; otherX: number; otherZ: number }

/**
 * Shares out a collision by weight, which is all of the rule "the lighter one
 * moves". The push along the line between them is the same on both, so the same
 * push changes a light thing's speed far more than a heavy thing's. `normal`
 * points from the second thing to the first. Null means they're already parting.
 */
function resolveHit(
  normalX: number,
  normalZ: number,
  overlap: number,
  [firstX, firstZ, firstMass]: [number, number, number],
  [secondX, secondZ, secondMass]: [number, number, number],
  bounciness = TRAFFIC_RULES.bounciness,
): Impact {
  const firstShare = secondMass / (firstMass + secondMass)
  const closing = (firstX - secondX) * normalX + (firstZ - secondZ) * normalZ
  const push = closing < 0 ? (-(1 + bounciness) * closing) / (1 / firstMass + 1 / secondMass) : 0

  return {
    pushX: normalX * overlap * firstShare,
    pushZ: normalZ * overlap * firstShare,
    changeX: (normalX * push) / firstMass,
    changeZ: (normalZ * push) / firstMass,
    otherX: (-normalX * push) / secondMass,
    otherZ: (-normalZ * push) / secondMass,
  }
}

/** Finds where a circle meets a vehicle, whose shape is a capsule: a line with a radius. */
function touchVehicle(vehicle: Vehicle, x: number, z: number, radius: number) {
  const forwardX = Math.sin(vehicle.heading)
  const forwardZ = Math.cos(vehicle.heading)
  const spine = Math.max(0, vehicle.halfLength - vehicle.radius)

  const along = (x - vehicle.x) * forwardX + (z - vehicle.z) * forwardZ
  const clamped = Math.max(-spine, Math.min(spine, along))
  const awayX = x - (vehicle.x + forwardX * clamped)
  const awayZ = z - (vehicle.z + forwardZ * clamped)
  const distance = Math.hypot(awayX, awayZ)
  const touching = vehicle.radius + radius
  if (distance >= touching || distance === 0) return null

  return { normalX: awayX / distance, normalZ: awayZ / distance, overlap: touching - distance, clamped }
}

function vehicleVelocity(vehicle: Vehicle): [number, number] {
  return [Math.sin(vehicle.heading) * vehicle.speed, Math.cos(vehicle.heading) * vehicle.speed]
}

/**
 * What a knock does to something loose. It keeps the speed it had, plus the
 * knock, and gets a little lift. Then it tips away from the hit, as its bottom
 * is shoved and its top lags. How much it tips sideways and end over end
 * depends on which way it's facing (`heading`) and on its `style`.
 */
function throwFor(
  changeX: number,
  changeZ: number,
  baseX: number,
  baseZ: number,
  style: ThrowStyle,
  heading: number,
) {
  const knock = Math.hypot(changeX, changeZ)
  if (knock === 0) return { velocity: [baseX, 0, baseZ] as [number, number, number], spin: [0, 0, 0] as [number, number, number] }
  const pushX = changeX / knock
  const pushZ = changeZ / knock

  // The push, split into along the thing (end over end) and across it (onto its side).
  const forwardX = Math.sin(heading)
  const forwardZ = Math.cos(heading)
  const across = pushX * forwardZ - pushZ * forwardX
  const along = pushX * forwardX + pushZ * forwardZ

  // For the top to move in the direction (u, w), it turns about the axis (w, 0, -u).
  const tipX = style.roll * across * forwardZ + style.pitch * along * forwardX
  const tipZ = style.roll * across * -forwardX + style.pitch * along * forwardZ
  const tipSpeed = Math.min(Math.hypot(tipX, tipZ) * knock, style.maxTip)
  const tipLength = Math.hypot(tipX, tipZ) || 1

  return {
    velocity: [baseX + changeX, Math.min(knock * style.lift, style.maxLift), baseZ + changeZ] as [
      number,
      number,
      number,
    ],
    spin: [
      (tipZ / tipLength) * tipSpeed,
      knock * style.yaw * Math.sign(across * along || 1),
      (-tipX / tipLength) * tipSpeed,
    ] as [number, number, number],
  }
}

/** Where a vehicle touches the rider's own vehicle, at its real size: circles of its half width along its length. */
function touchRider(vehicle: Vehicle, rider: ScooterState) {
  const reach = tuning.halfLength - tuning.radius
  if (reach <= 0.05) return touchVehicle(vehicle, rider.x, rider.z, tuning.radius)
  const forwardX = Math.sin(rider.heading)
  const forwardZ = Math.cos(rider.heading)
  let deepest: ReturnType<typeof touchVehicle> = null
  for (const along of [-reach, 0, reach]) {
    const touch = touchVehicle(vehicle, rider.x + forwardX * along, rider.z + forwardZ * along, tuning.radius)
    if (touch && (!deepest || touch.overlap > deepest.overlap)) deepest = touch
  }
  return deepest
}

function hitRider(world: TrafficWorld, vehicle: Vehicle, rider: ScooterState, dt: number) {
  const touch = touchRider(vehicle, rider)
  if (!touch) return

  const { normalX, normalZ, overlap } = touch
  const [velocityX, velocityZ] = vehicleVelocity(vehicle)
  const hit = resolveHit(
    normalX,
    normalZ,
    overlap,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocityX, velocityZ, vehicle.crash.mass],
  )

  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ, dt)

  if (Math.hypot(hit.otherX, hit.otherZ) < TRAFFIC_RULES.launchKnock) return

  // Hit hard enough, it stops being a car on rails and becomes a real object.
  soundImpact(world, vehicle.x, vehicle.z, Math.hypot(hit.otherX, hit.otherZ) * 2)
  // An auto the player has run into: its driver will have something to say (talk/TalkSpots.tsx).
  if (vehicle.kind === 'auto' && !vehicle.taken && !vehicle.halt) world.bumpedAuto = vehicle
  world.physics.hidePusher(vehicle.pusher as NonNullable<Tumbler['body']>)
  world.physics.addBody(vehicle, vehicle.crash, false)
  const { velocity, spin } = throwFor(
    hit.otherX,
    hit.otherZ,
    velocityX,
    velocityZ,
    THROW_STYLES[vehicle.kind],
    vehicle.heading,
  )
  world.physics.launch(vehicle, velocity, spin)
  if (vehicle.thrownRider && !vehicle.riderOff) {
    throwRiderOff(world, vehicle, vehicle.thrownRider, velocityX, velocityZ, hit.otherX, hit.otherZ)
  }
  vehicle.speed = 0
  vehicle.crashTime = 0
}

/**
 * A crashed or righting vehicle is still solid. It's a real body by now, so the
 * scooter bumps it by weight: a wrecked car stops you, a fallen bike gets shoved.
 * (Rapier pushes the body; this stops the scooter, which Rapier doesn't move.)
 */
function blockRider(vehicle: Vehicle, rider: ScooterState, dt: number) {
  const touch = touchRider(vehicle, rider)
  if (!touch) return
  const velocity = vehicle.body?.linvel() ?? { x: 0, z: 0 }
  const hit = resolveHit(
    touch.normalX,
    touch.normalZ,
    touch.overlap,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocity.x, velocity.z, vehicle.crash.mass],
  )
  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ, dt)
}

/** The rider's body, once thrown off the scooter, is this wide for bumping into things, in metres. */
const THROWN_RIDER_RADIUS = 0.3
/** How bouncy the rider's body is against a vehicle: a little, as people are soft. */
const THROWN_RIDER_BOUNCE = 0.25
/** Thrown off, the rider clears anything this much lower than their hips, in metres. */
const THROWN_RIDER_CLEARANCE = 0.15

/**
 * Once the rider has come off the scooter, vehicles and parked bikes stop them
 * as walls do. Thrown high enough, they sail over. The rider is light, so a
 * moving car doesn't slow for them here. Traffic already brakes for anyone down.
 */
function blockThrownRider(world: TrafficWorld, rider: ScooterState, vehicles: Vehicle[]) {
  const body = rider.rider
  if (body.phase === 'on' || body.phase === 'mounting') return

  const bounceOff = (normalX: number, normalZ: number, overlap: number) => {
    body.x += normalX * overlap
    body.z += normalZ * overlap
    const into = body.velocityX * normalX + body.velocityZ * normalZ
    if (into >= 0) return
    // Off the vehicle, keeping the speed along its side, as you'd slide along a car.
    body.velocityX -= into * (1 + THROWN_RIDER_BOUNCE) * normalX
    body.velocityZ -= into * (1 + THROWN_RIDER_BOUNCE) * normalZ
    body.rollSpeed *= 0.4
    if (-into > 2) soundImpact(world, body.x, body.z, -into)
  }

  for (const vehicle of vehicles) {
    if (vehicle.lane === -1) continue
    const top = vehicle.lift + vehicle.crash.centre + vehicle.crash.halfSize[1]
    if (body.y > top + THROWN_RIDER_CLEARANCE) continue
    const touch = touchVehicle(vehicle, body.x, body.z, THROWN_RIDER_RADIUS)
    if (touch) bounceOff(touch.normalX, touch.normalZ, touch.overlap)
  }

  // Parked scooters: about a bike's length round, and waist high.
  for (const parked of world.loose) {
    if (body.y > PARKED_SCOOTER_SHAPE.centre + PARKED_SCOOTER_SHAPE.halfSize[1] + parked.lift + THROWN_RIDER_CLEARANCE) continue
    const awayX = body.x - parked.x
    const awayZ = body.z - parked.z
    const distance = Math.hypot(awayX, awayZ)
    const touching = LOOSE_HIT_DISTANCE - SCOOTER.collisionRadius + THROWN_RIDER_RADIUS
    if (distance >= touching || distance === 0) continue
    bounceOff(awayX / distance, awayZ / distance, touching - distance)
  }
}

/** The rider feels a loose thing as a real weight, and sends it on its way. */
function hitLoose(world: TrafficWorld, body: LooseBody, rider: ScooterState, dt: number) {
  const awayX = rider.x - body.x
  const awayZ = rider.z - body.z
  const distance = Math.hypot(awayX, awayZ)
  const touching = LOOSE_HIT_DISTANCE
  if (distance >= touching || distance === 0 || !body.body) return

  const velocity = body.body.linvel()
  const hit = resolveHit(
    awayX / distance,
    awayZ / distance,
    touching - distance,
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    [velocity.x, velocity.z, PARKED_SCOOTER_SHAPE.mass],
  )
  const change = Math.hypot(hit.otherX, hit.otherZ)
  applyImpact(rider, hit.changeX, hit.changeZ, hit.pushX, hit.pushZ, dt)
  if (change < TRAFFIC_RULES.launchKnock) return

  soundImpact(world, body.x, body.z, change * 2)
  const thrown = throwFor(hit.otherX, hit.otherZ, velocity.x, velocity.z, TWO_WHEELER_THROW, body.heading)
  world.physics.launch(body, thrown.velocity, thrown.spin)
}

/** Parked scooters near the rider are real bodies, resting until something touches them. */
function updateLoose(world: TrafficWorld, rider: ScooterState, dt: number) {
  const { physics } = world

  for (const body of world.loose) {
    const near = Math.hypot(body.x - rider.x, body.z - rider.z) < LOOSE_BODY_DISTANCE

    if (near && !body.body) physics.addBody(body, PARKED_SCOOTER_SHAPE, true)
    if (!near && body.body) physics.removeBody(body)

    if (body.body) {
      hitLoose(world, body, rider, dt)
      if (!body.body.isSleeping()) physics.readBack(body, PARKED_SCOOTER_SHAPE)
    }
  }
}

/** Keeps the physics world's copy of the rider and of traffic up to date. */
function updatePushers(world: TrafficWorld, vehicles: Vehicle[], rider: ScooterState) {
  const { physics, riderPusher } = world
  physics.movePusher(riderPusher, rider.x, RIDER_SHAPE.centre, rider.z, rider.heading)

  for (const vehicle of vehicles) {
    const pusher = vehicle.pusher as NonNullable<Tumbler['body']>
    const close = Math.hypot(vehicle.x - rider.x, vehicle.z - rider.z) < PUSHER_DISTANCE
    // Up on a deck, it has no shape in the physics world, whose walls and bodies are all on the ground.
    if (vehicle.lane !== -1 && !vehicle.body && close && (vehicle.deck ?? 0) <= UP_ON_DECK_TRAFFIC) {
      physics.movePusher(pusher, vehicle.x, vehicle.crash.centre, vehicle.z, vehicle.heading)
    } else {
      physics.hidePusher(pusher)
    }
  }
}

/** A place on the road and the way it's moving, for someone at the kerb judging the traffic. */
type Coming = { x: number; z: number; dirX: number; dirZ: number; speed: number; halfLength: number; radius: number }
const coming: Coming[] = []

/**
 * How people take the player (people/reactions.ts gives them their words). The horn stops someone
 * crossing within `hornReach` metres for `startled` seconds. Passed within `cutOffWithin` metres at
 * more than `cutOffSpeed` m/s while crossing, they shout; stopped for within `letPassWithin`, they
 * wave for `thanks` seconds. A rider up on the footpath (within `footpath` metres of its line) is
 * seen from `footpathRange` metres at any speed, and stepped back from by `footpathStep` metres.
 */
const REACT = { hornReach: 28, startled: 2.2, cutOffWithin: 2.4, cutOffSpeed: 4.5, letPassWithin: 9, thanks: 2.2, footpath: 1.1, footpathRange: 8, footpathStep: 1.3 }

/** Everything on the road near a person, as they see it: the traffic, and the rider. */
function listComing(person: Pedestrian, vehicles: Vehicle[], rider: ScooterState): Coming[] {
  let count = 0
  const add = (x: number, z: number, dirX: number, dirZ: number, speed: number, halfLength: number, radius: number) => {
    if (Math.abs(x - person.x) > 70 || Math.abs(z - person.z) > 70) return
    const entry = (coming[count] ??= { x: 0, z: 0, dirX: 0, dirZ: 0, speed: 0, halfLength: 0, radius: 0 })
    Object.assign(entry, { x, z, dirX, dirZ, speed, halfLength, radius })
    count++
  }
  for (const vehicle of vehicles) {
    if (vehicle.lane === -1 || vehicle.body || (vehicle.deck ?? 0) > UP_ON_DECK_TRAFFIC) continue
    add(vehicle.x, vehicle.z, Math.sin(vehicle.heading), Math.cos(vehicle.heading), vehicle.speed, vehicle.halfLength, vehicle.radius)
  }
  if (rider.rider.phase === 'on') {
    const speed = Math.hypot(rider.velocityX, rider.velocityZ)
    const dirX = speed > 0.5 ? rider.velocityX / speed : Math.sin(rider.heading)
    const dirZ = speed > 0.5 ? rider.velocityZ / speed : Math.cos(rider.heading)
    add(rider.x, rider.z, dirX, dirZ, speed, Math.max(RIDER_HALF_LENGTH, tuning.halfLength), tuning.radius)
  }
  coming.length = count
  return coming
}

/**
 * Where something on the road meets the line a person is crossing along: `at` metres along the
 * crossing from the person, and `ahead` metres in front of the thing's middle. Null if it's going
 * the same way as the crossing, near enough, and never meets it.
 */
function meetsCrossing(thing: Coming, fromX: number, fromZ: number, dirX: number, dirZ: number): { at: number; ahead: number } | null {
  const turn = thing.dirX * dirZ - thing.dirZ * dirX
  if (Math.abs(turn) < 0.2) return null
  const offsetX = fromX - thing.x
  const offsetZ = fromZ - thing.z
  return { ahead: (offsetX * dirZ - offsetZ * dirX) / turn, at: (offsetX * thing.dirZ - offsetZ * thing.dirX) / turn }
}

const approach = (value: number, target: number, step: number) => value + Math.max(-step, Math.min(step, target - value))

/**
 * Someone crossing the road: at the kerb, looking, until there's a gap (or, at a zebra, until the
 * light holds the traffic and there's a gap); then straight over to the footpath opposite, a hand
 * up to the traffic, stopping short of anything that isn't slowing for them. Traffic slows for
 * someone on their way across as it does for anyone in the road (`listDowned`).
 */
function stepCrossing(world: TrafficWorld, person: Pedestrian, vehicles: Vehicle[], rider: ScooterState, dt: number) {
  const rules = TRAFFIC_RULES
  const cross = person.cross
  if (!cross) return
  const awayX = cross.toX - person.x
  const awayZ = cross.toZ - person.z
  const width = Math.hypot(awayX, awayZ)
  const dirX = awayX / (width || 1)
  const dirZ = awayZ / (width || 1)
  const pace = person.speed * rules.crossPace
  const traffic = listComing(person, vehicles, rider)
  // They face the way they're going, or about to.
  const turn = angleBetween(person.heading, Math.atan2(dirX, dirZ))
  person.heading += Math.max(-rules.walkTurnRate * dt, Math.min(rules.walkTurnRate * dt, turn))

  if (cross.stage === 'wait') {
    cross.waited += dt
    person.walking = approach(person.walking ?? 1, 0, dt * 4)
    const margin = Math.max(rules.crossLeast, rules.crossMargin - cross.waited * 0.13)
    let clear = cross.waited > 0.7
    // At a zebra they wait for the light to hold the traffic coming up to it.
    if (clear && cross.light && getLight(world.signals.junctions[cross.light.junction], cross.light.group, world.signalClock) !== 'red') clear = false
    for (const thing of traffic) {
      if (!clear) break
      const meets = meetsCrossing(thing, person.x, person.z, dirX, dirZ)
      // Going along the kerb beside them, it's only in the way if it's close.
      if (!meets) continue
      if (meets.at < -1.5 || meets.at > width + 1.5) continue
      const nose = meets.ahead - thing.halfLength
      // Gone past already.
      if (meets.ahead < -thing.halfLength - 1) continue
      if (thing.speed < 0.8) {
        // Standing traffic is walked between, but not through: not here, if one stands on the line.
        if (nose < 1.2) clear = false
        continue
      }
      // It would be at their line before they're past its strip of road, with the margin they want.
      const past = (Math.max(0, Math.min(width, meets.at)) + thing.radius + 1) / pace
      if (nose / thing.speed < past + margin) clear = false
    }
    if (clear) {
      cross.stage = 'go'
      person.lane = cross.lane
      person.along = cross.along
      person.nextLane = -1
      person.prevLane = -1
      if (person.onward) person.onward.length = 0
    } else if (cross.waited > (cross.light ? rules.zebraWait : rules.kerbWait)) {
      // No gap: they give up, and walk on.
      person.cross = null
      person.walking = 1
      person.crossIn = 15 + world.random() * 30
    }
    return
  }

  // On the way over. Anything still coming fast at the strip of road just ahead of them, they let pass.
  let wait = false
  let near = false
  // The player's horn stops them where they are for a moment; cut close at speed, they shout; waited for, they wave their thanks.
  const riding = rider.rider.phase === 'on'
  const riderAway = Math.hypot(rider.x - person.x, rider.z - person.z)
  const riderSpeed = riding ? Math.hypot(rider.velocityX, rider.velocityZ) : 0
  if (world.honked < 0.25 && riding && riderAway < REACT.hornReach && !(person.startled && person.startled > 0)) person.startled = REACT.startled
  if (person.startled && person.startled > 0) {
    person.startled -= dt
    wait = true
  }
  if (riding && !cross.reacted) {
    if (riderAway < REACT.cutOffWithin && riderSpeed > REACT.cutOffSpeed) {
      cross.reacted = true
      person.did = 'cutOff'
    } else if (riderAway < REACT.letPassWithin && riderSpeed < 0.8) {
      // Only when they're crossing in front of the rider, not behind.
      const inFront = (person.x - rider.x) * Math.sin(rider.heading) + (person.z - rider.z) * Math.cos(rider.heading)
      if (inFront > 1) {
        cross.reacted = true
        person.did = 'letPass'
        person.thanks = REACT.thanks
      }
    }
  }
  if (person.thanks && person.thanks > 0) person.thanks -= dt
  for (const thing of traffic) {
    if (Math.hypot(thing.x - person.x, thing.z - person.z) < 30 && thing.speed > 1) near = true
    if (thing.speed < 1.5) continue
    const meets = meetsCrossing(thing, person.x, person.z, dirX, dirZ)
    if (!meets || meets.at < thing.radius + 0.4 || meets.at > thing.radius + 2.2) continue
    const nose = meets.ahead - thing.halfLength
    if (nose > -thing.halfLength * 2 && nose / thing.speed < 1.3) wait = true
  }
  person.walking = approach(person.walking ?? 1, wait ? 0 : 1, dt * 5)
  person.wave = approach(person.wave ?? 0, near || (person.thanks ?? 0) > 0 ? 1 : 0, dt * 3)
  if (!wait) {
    const step = Math.min(width, pace * dt)
    person.x += dirX * step
    person.z += dirZ * step
    person.stride += step * STRIDE_PER_METRE
  }
  if (width < 0.4) {
    // Over. They walk on along the far footpath, and don't think of crossing again for a while.
    person.cross = null
    person.wave = 0
    person.walking = 1
    person.crossIn = rules.crossEvery[0] + world.random() * (rules.crossEvery[1] - rules.crossEvery[0])
  }
}

/** Whether a point on the ground has a flyover's deck or ramp over it (or through it, at a ramp's foot). */
function underDeck(decks: Flyover[], x: number, z: number): boolean {
  for (const deck of decks) {
    const { points } = deck.path
    const reach = deck.width / 2 + 0.5
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]
      const [bx, bz] = points[i]
      // Quickly past the pieces nowhere near.
      if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach || z < Math.min(az, bz) - reach || z > Math.max(az, bz) + reach) continue
      const lengthSquared = (bx - ax) ** 2 + (bz - az) ** 2
      const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / lengthSquared))
      if (Math.hypot(x - ax - (bx - ax) * along, z - az - (bz - az) * along) > reach) continue
      if (deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * along > 0.1) return true
    }
  }
  return false
}

/** Now and then someone walking along decides to cross: here, or at the zebra they're passing. */
function thinkOfCrossing(world: TrafficWorld, person: Pedestrian, dt: number) {
  const rules = TRAFFIC_RULES
  const { walkLanes, random } = world
  person.crossIn = (person.crossIn ?? 5 + random() * rules.crossEvery[1]) - dt
  const opposite = world.walkAcross[person.lane]
  if (opposite < 0) return
  const lane = walkLanes[person.lane]
  if (person.along < 1 || person.along > lane.length - 1 || Math.hypot(person.dodgeX, person.dodgeZ) > 0.2) return

  const zebra = world.zebras.get(person.lane)
  let light: { junction: number; group: number } | null = null
  if (zebra && Math.abs(person.along - zebra.along) < 0.7) {
    // One choice each time they pass it.
    if (person.zebraSeen === person.lane) return
    person.zebraSeen = person.lane
    if (random() > rules.zebraShare) return
    light = zebra
  } else {
    if (person.crossIn > 0) return
    person.crossIn = rules.crossEvery[0] + random() * (rules.crossEvery[1] - rules.crossEvery[0])
  }

  // The same place along the road, on the footpath opposite.
  const other = walkLanes[opposite]
  const along = Math.max(0.5, Math.min(other.length - 0.5, other.length - person.along))
  const toX = other.startX + other.forwardX * along
  const toZ = other.startZ + other.forwardZ * along
  const width = Math.hypot(toX - person.x, toZ - person.z)
  // Not where there's nothing to cross, nor a highway's width; nor through a median, a railing or a parked car.
  if (width < 4 || width > 26 || !hasClearLine(world.collisions, person.x, person.z, toX, toZ, 0.25)) return
  // Nor where a flyover or its ramp is in the way: the road they'd be walking over is up in the
  // air, or rising out of the ground, and they'd wade through it.
  for (let step = 0; step <= width; step += 1) {
    if (underDeck(world.decks, person.x + ((toX - person.x) * step) / width, person.z + ((toZ - person.z) * step) / width)) return
  }
  person.cross = { stage: 'wait', toX, toZ, lane: opposite, along, waited: 0, light }
}

/** Someone far from the player: along their footpath, and nothing else (`FAR_PEOPLE`). */
function stepFarPedestrian(world: TrafficWorld, person: Pedestrian, dt: number) {
  const { walkLanes, random } = world
  if (!advance(person, walkLanes, person.speed * dt, random)) {
    person.lane = -1
    return
  }
  const lane = walkLanes[person.lane]
  const toX = lane.startX + lane.forwardX * person.along
  const toZ = lane.startZ + lane.forwardZ * person.along
  const share = 1 - Math.exp(-dt * 6)
  const moveX = (toX - person.x) * share
  const moveZ = (toZ - person.z) * share
  person.x += moveX
  person.z += moveZ
  const moved = Math.hypot(moveX, moveZ)
  if (moved > 0.01) person.heading += angleBetween(person.heading, Math.atan2(moveX, moveZ)) * Math.min(1, dt * 8)
  person.stride += moved * STRIDE_PER_METRE
  person.dodgeX = 0
  person.dodgeZ = 0
  person.walking = 1
  person.wave = 0
}

function stepPedestrian(world: TrafficWorld, person: Pedestrian, rider: ScooterState, vehicles: Vehicle[], dt: number) {
  const { walkLanes, random } = world
  const rules = TRAFFIC_RULES

  if (person.cross) {
    stepCrossing(world, person, vehicles, rider, dt)
    return
  }
  thinkOfCrossing(world, person, dt)

  if (!advance(person, walkLanes, person.speed * dt, random)) {
    person.lane = -1
    return
  }

  const lane = walkLanes[person.lane]
  const pathX = lane.startX + lane.forwardX * person.along
  const pathZ = lane.startZ + lane.forwardZ * person.along

  // A slow rider is seen coming, and they step out of the way. A fast one isn't.
  const fromRiderX = pathX - rider.x
  const fromRiderZ = pathZ - rider.z
  const riderDistance = Math.hypot(fromRiderX, fromRiderZ)
  const slowRider = getTravelSpeed(rider) < rules.dodgeMaxRiderSpeed
  // A rider up on the footpath is another matter: they're seen coming from further off, and stepped well back from.
  let onFootpath = false
  if (rider.rider.phase === 'on' && riderDistance < REACT.footpathRange && getTravelSpeed(rider) > 1) {
    const riderAlong = (rider.x - lane.startX) * lane.forwardX + (rider.z - lane.startZ) * lane.forwardZ
    const riderAside = (rider.x - lane.startX) * lane.forwardZ - (rider.z - lane.startZ) * lane.forwardX
    onFootpath = riderAlong > 0 && riderAlong < lane.length && Math.abs(riderAside) < REACT.footpath
  }
  const dodging = riderDistance > 0 && (onFootpath || (slowRider && riderDistance < rules.dodgeRange))
  if (dodging) {
    const blend = 1 - Math.exp(-rules.dodgeResponse * dt)
    let awayX = fromRiderX / riderDistance
    let awayZ = fromRiderZ / riderDistance
    let reach = rules.dodgeDistance
    if (onFootpath) {
      // Back from the kerb, towards the walls: the footpath runs to the left of the road's traffic, so away from the road is the lane's left.
      awayX = lane.forwardZ
      awayZ = -lane.forwardX
      reach = REACT.footpathStep
      if (Math.hypot(person.dodgeX, person.dodgeZ) < 0.3) person.did = 'steppedBack'
    }
    person.dodgeX += (awayX * reach - person.dodgeX) * blend
    person.dodgeZ += (awayZ * reach - person.dodgeZ) * blend
  } else {
    // Back to their path at a walk, so someone who was thrown doesn't slide back.
    const offset = Math.hypot(person.dodgeX, person.dodgeZ)
    const keep = offset > 0 ? Math.max(0, offset - rules.returnSpeed * dt) / offset : 0
    person.dodgeX *= keep
    person.dodgeZ *= keep
  }

  // Stepping aside is a sideways shift of their path, which they walk over to, as anyone would.
  const dodgeShift = person.dodgeX * lane.forwardZ - person.dodgeZ * lane.forwardX
  // Someone stepping aside walks a little quicker to get out of the way.
  const pace = person.speed + Math.min(1, Math.hypot(person.dodgeX, person.dodgeZ)) * 0.6
  const fromX = person.x
  const fromZ = person.z
  steerAlong(person, walkLanes, pace * dt, rules.walkAim, dodgeShift, rules.walkTurnRate, 0, dt, random)

  // Strides follow the ground actually covered, so the feet stay planted when they hurry or slow.
  person.stride += Math.hypot(person.x - fromX, person.z - fromZ) * STRIDE_PER_METRE
}

/**
 * The rider knocks a pedestrian flying, by weight like any other hit. The faster
 * the rider, the further and higher they go. The rider loses a little speed but
 * never falls, so this goes straight to the velocity rather than `applyImpact`.
 */
function hitPedestrian(world: TrafficWorld, person: Pedestrian, rider: ScooterState) {
  const awayX = person.x - rider.x
  const awayZ = person.z - rider.z
  const distance = Math.hypot(awayX, awayZ)
  if (distance >= PERSON_HIT_DISTANCE || distance === 0) return

  // `resolveHit` works from the first thing's side, so the person goes first.
  const normalX = awayX / distance
  const normalZ = awayZ / distance
  const hit = resolveHit(
    normalX,
    normalZ,
    PERSON_HIT_DISTANCE - distance,
    [0, 0, PERSON_SHAPE.mass],
    [rider.velocityX, rider.velocityZ, SCOOTER.mass],
    TRAFFIC_RULES.bodyBounciness,
  )
  const knock = Math.hypot(hit.changeX, hit.changeZ)

  if (knock < TRAFFIC_RULES.pedestrianKnock) {
    // A gentle bump moves them aside, all the way, so the scooter never ends up inside them.
    const overlap = PERSON_HIT_DISTANCE - distance
    shove(person, normalX * overlap, normalZ * overlap)
    return
  }

  rider.velocityX += hit.otherX
  rider.velocityZ += hit.otherZ
  rider.impact = Math.max(rider.impact, Math.min(knock / 20, 0.6))
  soundImpact(world, person.x, person.z, knock)

  world.physics.addBody(person, PERSON_SHAPE, false)
  const { velocity, spin } = throwFor(hit.changeX, hit.changeZ, 0, 0, PERSON_THROW, person.heading)
  world.physics.launch(person, velocity, spin)
  person.downTime = 0
}

/** Moves a walking person by this much, and keeps it as a step aside so they don't snap back. */
function shove(person: Pedestrian, x: number, z: number) {
  person.x += x
  person.z += z
  person.dodgeX += x
  person.dodgeZ += z
}

/**
 * A vehicle meets someone walking. Moving, it knocks them over, by weight like
 * any other hit, and the driver brakes hard and leans on the horn. Crawling, it
 * just nudges them aside. Either way, nobody passes through anybody.
 */
function hitPersonWithVehicle(world: TrafficWorld, vehicle: Vehicle, person: Pedestrian) {
  const touch = touchVehicle(vehicle, person.x, person.z, PERSON_RADIUS)
  if (!touch) return

  const { normalX, normalZ, overlap } = touch
  const [velocityX, velocityZ] = vehicleVelocity(vehicle)
  const hit = resolveHit(
    normalX,
    normalZ,
    overlap,
    [0, 0, PERSON_SHAPE.mass],
    [velocityX, velocityZ, vehicle.crash.mass],
    TRAFFIC_RULES.bodyBounciness,
  )
  const knock = Math.hypot(hit.changeX, hit.changeZ)
  if (knock < TRAFFIC_RULES.pedestrianKnock) {
    shove(person, normalX * overlap, normalZ * overlap)
    return
  }

  vehicle.speed *= 0.4
  world.honks.push({ x: vehicle.x, z: vehicle.z, kind: vehicle.kind })
  soundImpact(world, person.x, person.z, knock)
  world.physics.addBody(person, PERSON_SHAPE, false)
  const { velocity, spin } = throwFor(hit.changeX, hit.changeZ, 0, 0, PERSON_THROW, person.heading)
  world.physics.launch(person, velocity, spin)
  person.downTime = 0
}

/** People notice someone coming this far off, in metres, and start stepping aside. */
const PERSON_NOTICE = 2.2
/**
 * How quickly they step aside, in metres of sideways path per second, at the
 * closest. It has to beat `returnSpeed`, which walks them back to their path all the while.
 */
const PERSON_SIDESTEP = 4

/**
 * Walking people step around each other instead of through. Each moves its own
 * path aside, the two opposite ways, and steers over to it, so they pass each
 * other as people on a footpath do. Only if they still end up touching are they
 * pushed apart, which is rare.
 */
function separatePeople(people: Pedestrian[], count: number, dt: number) {
  for (let first = 0; first < count; first++) {
    const a = people[first]
    // Only those near the player: far off, nobody sees two people walk through each other.
    if (a.lane === -1 || a.body || a.fallen || a.far) continue
    for (let second = first + 1; second < count; second++) {
      const b = people[second]
      if (b.lane === -1 || b.body || b.fallen || b.far) continue
      const awayX = b.x - a.x
      const awayZ = b.z - a.z
      if (awayX > PERSON_NOTICE || awayX < -PERSON_NOTICE || awayZ > PERSON_NOTICE || awayZ < -PERSON_NOTICE) continue
      const distance = Math.hypot(awayX, awayZ)
      if (distance >= PERSON_NOTICE || distance === 0) continue
      const backX = awayX / distance
      const backZ = awayZ / distance
      // Each moves its path to its own right of the other, so two people meeting head-on pass
      // left side to left side instead of standing nose to nose.
      const step = ((PERSON_NOTICE - distance) / PERSON_NOTICE) * PERSON_SIDESTEP * dt
      a.dodgeX += -backZ * step
      a.dodgeZ += backX * step
      b.dodgeX += backZ * step
      b.dodgeZ += -backX * step
      if (distance < PERSON_SPACING) {
        const half = (PERSON_SPACING - distance) / 2
        shove(a, -backX * half, -backZ * half)
        shove(b, backX * half, backZ * half)
      }
    }
  }
}

/** Whether two driving vehicles overlap: three circles along one, against the other's capsule. */
function vehiclesOverlap(a: Vehicle, b: Vehicle): boolean {
  const reach = a.halfLength + b.halfLength + a.radius + b.radius
  if (Math.hypot(a.x - b.x, a.z - b.z) > reach) return false
  const forwardX = Math.sin(a.heading)
  const forwardZ = Math.cos(a.heading)
  const spine = Math.max(0, a.halfLength - a.radius)
  for (const along of [-spine, 0, spine]) {
    if (touchVehicle(b, a.x + forwardX * along, a.z + forwardZ * along, a.radius)) return true
  }
  return false
}

/**
 * Whether this vehicle must stop to keep out of another. The gap rules keep
 * queues apart, but at a crossing, or with a bike squeezing past, two can still
 * meet. Then whichever has the other in front of it stops. If they're side by
 * side, the one earlier in the list goes first.
 */
function mustGiveWay(vehicle: Vehicle, others: Vehicle[]): Vehicle | null {
  const forwardX = Math.sin(vehicle.heading)
  const forwardZ = Math.cos(vehicle.heading)
  const ownPlace = others.indexOf(vehicle)
  const found = others.find((other, place) => {
    if (other === vehicle || other.lane === -1 || other.body || other.fallen) return false
    if (!vehiclesOverlap(vehicle, other)) return false
    const toOtherX = other.x - vehicle.x
    const toOtherZ = other.z - vehicle.z
    const ahead = (toOtherX * forwardX + toOtherZ * forwardZ) / (Math.hypot(toOtherX, toOtherZ) || 1)
    return ahead > 0.3 || (ahead > -0.3 && place < ownPlace)
  })
  return found ?? null
}

/**
 * Whether this vehicle is the one of a locked pair that pushes on through the other, as the last
 * resort (`pushAfter`): the heavier, or of two alike the later in the list. Never through a wreck,
 * or a vehicle standing empty for the player.
 */
function mayBarge(vehicle: Vehicle, other: Vehicle, places: Vehicle[]): boolean {
  if (other.body || other.fallen || other.halt || other.taken === 'empty' || other.taken === 'driven') return false
  return outranks(vehicle, other, places)
}

const outranks = (vehicle: Vehicle, other: Vehicle, places: Vehicle[]) =>
  vehicle.crash.mass !== other.crash.mass ? vehicle.crash.mass > other.crash.mass : places.indexOf(vehicle) > places.indexOf(other)

/**
 * A ring of vehicles each standing still for the next: behind it, or at a junction's line waiting
 * for it to cross. Nobody in a ring can ever move, so its heaviest member edges through the one in
 * its way (`mayBarge`). Returns that one for the vehicle that should go, null for the rest and for
 * anything not in a ring.
 */
function ringToBreak(vehicle: Vehicle, places: Vehicle[]): Vehicle | null {
  const waitsFor = (one: Vehicle) => (one.speed < 0.3 ? (one.blocker ?? one.heldBy ?? null) : null)
  const first = waitsFor(vehicle)
  let at = first
  for (let hops = 0; hops < 6 && at; hops++) {
    if (at === vehicle) {
      // It's a ring. Is this its heaviest?
      for (let other = first; other && other !== vehicle; other = waitsFor(other)) if (outranks(other, vehicle, places)) return null
      return first
    }
    if (at.body || at.fallen || at.halt || at.taken === 'empty' || at.taken === 'driven') return null
    at = waitsFor(at)
  }
  return null
}

/** Eases in and out, so a movement starts and ends gently instead of at full speed. */
function smooth(amount: number): number {
  return amount * amount * (3 - 2 * amount)
}

/**
 * Someone who was knocked over goes limp as they fall, lies there a while, then
 * gets up: they turn from however they're lying back to standing, over about a
 * second, and walk back to their path from where they landed.
 */
function stepKnockedPedestrian(world: TrafficWorld, person: Pedestrian, dt: number) {
  const rules = TRAFFIC_RULES
  const { physics, walkLanes } = world

  if (person.body) {
    physics.readBack(person, PERSON_SHAPE)
    person.downTime += dt
    person.down = Math.min(1, person.down + rules.goLimpRate * dt)

    const settled = person.body.isSleeping()
    const ready = person.downTime > rules.pedestrianDownTime
    if (!ready || (!settled && person.downTime < rules.maxCrashTime)) return

    physics.removeBody(person)
    person.fallen = person.rotation ?? yawRotation(person.heading)
    person.fallenLift = person.lift
    person.rising = 0
    return
  }

  if (!person.fallen) return
  person.rising = Math.min(1, person.rising + dt / rules.getUpTime)
  const amount = smooth(person.rising)
  person.rotation = blendRotation(person.fallen, yawRotation(person.heading), amount)
  person.lift = person.fallenLift * (1 - amount)
  person.down = 1 - amount
  if (person.rising < 1) return

  person.fallen = null
  person.rotation = null
  person.lift = 0
  person.down = 0
  // They walk back to their path from where they got up.
  const lane = walkLanes[person.lane]
  if (!lane) return
  person.dodgeX = person.x - (lane.startX + lane.forwardX * person.along)
  person.dodgeZ = person.z - (lane.startZ + lane.forwardZ * person.along)
}

/**
 * Collects every person traffic must not drive into: anyone lying down or
 * getting up, thrown bike riders, the rider when off the scooter, and people
 * walking. Walkers are usually on the pavement, out of a vehicle's path, so
 * they only count when they step into it, such as on a corner.
 */
function listDowned(world: TrafficWorld, rider: ScooterState, vehicles: Vehicle[], pedestrianCount: number) {
  // The entries are kept and refilled each step, rather than made new 60 times a second.
  const downed = world.downed
  let count = 0
  const add = (x: number, z: number, lying: boolean, crossing = false) => {
    const entry = (downed[count] ??= { x: 0, z: 0, lying: false })
    entry.x = x
    entry.z = z
    entry.lying = lying
    entry.crossing = crossing
    entry.halfLength = undefined
    entry.radius = undefined
    count++
    return entry
  }
  for (let i = 0; i < pedestrianCount; i++) {
    const person = world.pedestrians[i]
    // Those far from the player are far from everything that drives properly.
    if (person.lane !== -1 && !person.far) add(person.x, person.z, !!(person.body || person.fallen), person.cross?.stage === 'go')
  }
  // And what stands in the road that isn't traffic: a cow, a bus broken down.
  for (const obstacle of world.obstacles.values()) {
    const entry = add(obstacle.x, obstacle.z, false)
    entry.halfLength = obstacle.halfLength
    entry.radius = obstacle.radius
  }
  for (const { thrownRider, riderOff } of vehicles) {
    if (thrownRider && riderOff) add(thrownRider.x, thrownRider.z, true)
  }
  for (const driver of world.drivers) if (!driver.hidden) add(driver.x, driver.z, false)
  // The rider off the vehicle: lying after a crash, standing when walking (and out of it altogether indoors).
  const { phase, x, z } = rider.rider
  const upright = phase === 'walking' || phase === 'afoot' || phase === 'dismounting' || phase === 'mounting'
  if (phase !== 'on' && !liveRoom.kind) add(x, z, !upright)
  downed.length = count
}

/**
 * Starts a hold-up now and then: one vehicle, driving along a plain stretch of road away from any
 * junction, pulls in to let someone out, or breaks down. The traffic behind it queues, two-wheelers
 * squeeze by, cars go round when the other side is clear, and when it moves off the queue follows.
 * These are the city's jams: each has a cause, and an end.
 */
function startHalts(world: TrafficWorld, vehicles: Vehicle[], at: { x: number; z: number }, dt: number) {
  const rules = TRAFFIC_RULES
  const { random, jam, junctions, roadLanes } = world
  world.haltIn -= dt
  if (world.haltIn > 0) return
  // How much of a rush-hour jam this is, here.
  const rush = jam ? jam.amount * Math.max(0, 1 - Math.hypot(at.x - jam.x, at.z - jam.z) / jam.reach) : 0
  const [least, most] = rush > 0.3 ? rules.haltEveryRush : rules.haltEvery
  world.haltIn = least + random() * (most - least)
  const standing = vehicles.filter((vehicle) => vehicle.lane !== -1 && vehicle.halt).length
  if (standing >= rules.halts + Math.round(rules.haltsRush * rush)) return

  const able = vehicles.filter((vehicle) => {
    if (vehicle.lane === -1 || vehicle.halt || vehicle.taken || vehicle.body || vehicle.fallen || vehicle.crossing) return false
    if (vehicle.kind === 'bus' || vehicle.kind === 'bike' || vehicle.speed < 3) return false
    const away = Math.hypot(vehicle.x - at.x, vehicle.z - at.z)
    if (away < rules.haltNear || away > rules.haltFar) return false
    // Not coming up to a junction, nor in one.
    if (junctions.junctionOf[vehicle.lane] >= 0) return false
    for (let steps = 1; steps <= 3; steps++) {
      const ahead = laneAhead(vehicle, roadLanes, steps, random)
      if (ahead < 0 || junctions.junctionOf[ahead] >= 0) return false
    }
    return true
  })
  if (able.length === 0) return
  const vehicle = able[Math.floor(random() * able.length)]
  const breakdown = vehicle.kind !== 'auto' && random() < rules.breakdownShare
  const [shortest, longest] = breakdown ? rules.breakdown : rules.dropOff
  vehicle.halt = { kind: breakdown ? 'breakdown' : 'dropOff', left: shortest + random() * (longest - shortest) }
  vehicle.hazard = breakdown
}

/** Advances everything. Only the first `vehicleCount` and `pedestrianCount` are in play. */
/** Moves the traffic's density towards the time of day's, gently, so a change of period isn't a jump. */
/**
 * Closes (or reopens) the road lanes a test picks, and takes the traffic on them off the road.
 * Returns how many lanes it closed.
 */
const laneClosers = new Map<string, (lane: Lane) => boolean>()

/** `owner`: who is closing them (the festival, a city event): each closes and reopens its own, and a lane is shut while anyone has it shut. */
export function closeLanes(world: TrafficWorld, isClosed: ((lane: Lane) => boolean) | null, owner = 'festival'): number {
  if (isClosed) laneClosers.set(owner, isClosed)
  else laneClosers.delete(owner)
  const tests = [...laneClosers.values()]
  let count = 0
  world.roadLanes.forEach((lane, index) => {
    lane.closed = tests.some((test) => test(lane))
    if (!lane.closed) return
    count++
    for (const vehicle of world.vehicles) if (vehicle.lane === index && !vehicle.body) vehicle.lane = -1
  })
  return count
}

/** Sets (or lifts, with null) the rush-hour jam: see `TrafficWorld.jam`. */
export function setJam(world: TrafficWorld, jam: TrafficWorld['jam']) {
  world.jam = jam
}

export function easeDensity(world: TrafficWorld, target: number, dt: number) {
  world.density += (target - world.density) * Math.min(1, dt * 0.2)
}

/** Makes a vehicle pull in to the kerb and wait `seconds` (its driver has got out to argue), and lets it go again. */
export function holdVehicle(vehicle: Vehicle, seconds: number) {
  vehicle.halt = { kind: 'dropOff', left: seconds }
}
export function releaseVehicle(vehicle: Vehicle) {
  if (vehicle.halt) vehicle.halt.left = 0
}

/** The auto the player has just run into, if any, handed over once (whoever asks deals with it). */
export function takeBumpedAuto(world: TrafficWorld): Vehicle | null {
  const auto = world.bumpedAuto
  world.bumpedAuto = null
  return auto
}

/** The player's horn: people crossing the road stop where they are for it (`stepCrossing`). */
export function hearHorn(world: TrafficWorld) {
  world.honked = 0
}

/** Above this, the rider is up on a flyover (transitPlacement.ts' UP_ON_DECK). */
const RIDER_UP = 2.2

function riderUpOnDeck(rider: ScooterState): boolean {
  const wheels = Math.min(rider.frontWheel.height, rider.rearWheel.height)
  return rider.rider.phase === 'on' ? wheels > RIDER_UP : Math.min(wheels, rider.rider.ground) > RIDER_UP
}

/** The rider, as the traffic below a flyover sees them: somewhere far off, where nothing reaches. */
function farRider(rider: ScooterState): ScooterState {
  const far = 1e6
  return { ...rider, x: rider.x + far, z: rider.z + far, rider: { ...rider.rider, x: rider.rider.x + far, z: rider.rider.z + far } }
}

/** How many drivers can be out of taken vehicles at once, how much harder a hailed vehicle brakes, and how far off an abandoned one goes. */
const DRIVER_POOL = 4
const HAIL_BRAKING = 1.8
const ABANDON_DISTANCE = 75
/** A driver looks for a footpath within this of the vehicle, in metres; with none, walks this far to the left of it. */
const FOOTPATH_SEARCH = 16
const KERB_WALK = 4.5
/** A driver stays about for this long, in seconds, or until the player is this far off. */
const DRIVER_STAYS = 45
const DRIVER_GONE_AT = 55

/**
 * The nearest vehicle the player, on foot at (x, z), could take: on the ground, upright, within
 * `reach` of its side. Not the one they're already driving.
 */
export function vehicleNear(world: TrafficWorld, x: number, z: number, reach: number, count: number): Vehicle | null {
  let best: Vehicle | null = null
  let bestGap = reach
  for (let i = 0; i < count && i < world.vehicles.length; i++) {
    const vehicle = world.vehicles[i]
    if (vehicle.lane === -1 || vehicle.body || vehicle.fallen || vehicle.taken === 'driven' || (vehicle.deck ?? 0) > UP_ON_DECK_TRAFFIC) continue
    if (Math.abs(vehicle.x - x) > 12 || Math.abs(vehicle.z - z) > 12) continue
    const forwardX = Math.sin(vehicle.heading)
    const forwardZ = Math.cos(vehicle.heading)
    const spine = Math.max(0, vehicle.halfLength - vehicle.radius)
    const along = Math.max(-spine, Math.min(spine, (x - vehicle.x) * forwardX + (z - vehicle.z) * forwardZ))
    const gap = Math.hypot(x - (vehicle.x + forwardX * along), z - (vehicle.z + forwardZ * along)) - vehicle.radius
    if (gap < bestGap) {
      best = vehicle
      bestGap = gap
    }
  }
  return best
}

/** The nearest parked scooter still standing within `reach` of a point, or null. */
export function parkedNear(world: TrafficWorld, x: number, z: number, reach: number): LooseBody | null {
  let best: LooseBody | null = null
  let bestDistance = reach
  for (const parked of world.loose) {
    if (parked.body || parked.rotation) continue
    if (Math.abs(parked.x - x) > reach || Math.abs(parked.z - z) > reach) continue
    const distance = Math.hypot(parked.x - x, parked.z - z)
    if (distance < bestDistance) {
      best = parked
      bestDistance = distance
    }
  }
  return best
}

/**
 * A parked vehicle becomes one the player can drive: a vehicle from the traffic that isn't in sight
 * (out of play, or the furthest off) stands in its place, empty; the caller takes the parked one
 * away. `kinds`: what it may be, the first that's spare winning; `isLike`: among those, the ones that
 * look most like it. Null if there's none to spare just now.
 */
export function standInForParked(world: TrafficWorld, pose: { x: number; z: number; heading: number }, kinds: VehicleKind[], count: number, at: { x: number; z: number }, isLike: (vehicle: Vehicle) => boolean = () => true): Vehicle | null {
  let pick: Vehicle | null = null
  let pickScore = -Infinity
  for (let i = 0; i < count && i < world.vehicles.length; i++) {
    const vehicle = world.vehicles[i]
    const rank = kinds.indexOf(vehicle.kind)
    if (rank === -1 || vehicle.taken || vehicle.body || vehicle.fallen) continue
    const away = vehicle.lane === -1 ? 1e5 : Math.hypot(vehicle.x - at.x, vehicle.z - at.z)
    // Never one near enough to be seen vanishing.
    if (away < STAND_IN_FROM) continue
    const score = away + (isLike(vehicle) ? 1e6 : 0) + (kinds.length - rank) * 1e7
    if (score > pickScore) {
      pick = vehicle
      pickScore = score
    }
  }
  if (!pick) return null
  pick.x = pose.x
  pick.z = pose.z
  pick.heading = pose.heading
  pick.lane = world.roadLanes.findIndex((lane) => !lane.closed)
  pick.along = 0
  pick.speed = 0
  pick.lift = 0
  pick.deck = 0
  pick.shift = 0
  pick.fileShift = 0
  pick.rail = false
  pick.shiftTarget = 0
  pick.rotation = null
  pick.taken = 'empty'
  pick.abandoned = false
  if (pick.kind === 'bike') {
    pick.riderOff = true
    if (pick.thrownRider) pick.thrownRider.hidden = true
  }
  return pick
}
/** A traffic two-wheeler this near the player, in metres, isn't taken to stand in for a parked one. */
const STAND_IN_FROM = 90

/** Waved down: it pulls up, and its driver gets out (see `stepTraffic`). An empty one stays as it is. */
export function hailVehicle(vehicle: Vehicle) {
  if (!vehicle.taken) vehicle.taken = 'hailed'
}

/** The player drives it from now: it follows their controller. */
export function driveVehicle(vehicle: Vehicle) {
  vehicle.taken = 'driven'
  vehicle.abandoned = false
  vehicle.speed = 0
}

/** The player has left it for another: it stands empty until it's out of sight. */
export function abandonVehicle(vehicle: Vehicle) {
  if (vehicle.taken !== 'driven' && vehicle.taken !== 'empty') return
  vehicle.taken = 'empty'
  vehicle.abandoned = true
  vehicle.speed = 0
}

/** One the player drives, or has left standing. */
function stepTaken(vehicle: Vehicle, rider: ScooterState, at: { x: number; z: number }) {
  if (vehicle.taken === 'driven') {
    vehicle.x = rider.x
    vehicle.z = rider.z
    vehicle.heading = rider.heading
    vehicle.speed = getTravelSpeed(rider)
    vehicle.lift = Math.min(rider.frontWheel.height, rider.rearWheel.height)
    vehicle.shift = 0
    vehicle.shiftTarget = 0
    return
  }
  vehicle.speed = 0
  // Left behind, or never got into: it's taken away once the player is well off (and returns as traffic elsewhere).
  if (Math.hypot(vehicle.x - at.x, vehicle.z - at.z) > ABANDON_DISTANCE) {
    vehicle.taken = undefined
    vehicle.abandoned = false
    vehicle.lane = -1
    if (vehicle.thrownRider) mountRider(vehicle, vehicle.thrownRider)
  }
}

/**
 * The driver gets out, calmly: at the driver's door (the right, in India; a two-wheeler's rider steps
 * off to the left), and walks to the nearest footpath, where they stand. Nobody is thrown, and
 * nothing is said: it's a game about a city, not about taking cars.
 */
function letDriverOut(world: TrafficWorld, vehicle: Vehicle) {
  const driver = world.drivers.find((one) => one.hidden) ?? world.drivers.reduce((oldest, one) => (one.age > oldest.age ? one : oldest))
  const forwardX = Math.sin(vehicle.heading)
  const forwardZ = Math.cos(vehicle.heading)
  // A quarter turn to the left of forward is (fz, -fx).
  const side = vehicle.kind === 'bike' ? 1 : -1
  const out = vehicle.radius + 0.45
  driver.x = vehicle.x + forwardZ * side * out
  driver.z = vehicle.z - forwardX * side * out
  driver.hidden = false
  driver.age = 0
  driver.tint = world.random()
  driver.skin = 0.6 + world.random() * 0.55
  driver.lift = 0
  driver.walking = 1
  if (vehicle.kind === 'bike') vehicle.riderOff = true

  // The nearest point on a footpath, or failing one, the left-hand kerb.
  let nearest = FOOTPATH_SEARCH
  driver.goX = vehicle.x + forwardZ * KERB_WALK
  driver.goZ = vehicle.z - forwardX * KERB_WALK
  for (const lane of world.walkLanes) {
    if (Math.abs(lane.startX - vehicle.x) > 80 || Math.abs(lane.startZ - vehicle.z) > 80) continue
    const along = Math.max(0, Math.min(lane.length, (driver.x - lane.startX) * lane.forwardX + (driver.z - lane.startZ) * lane.forwardZ))
    const px = lane.startX + lane.forwardX * along
    const pz = lane.startZ + lane.forwardZ * along
    const distance = Math.hypot(px - driver.x, pz - driver.z)
    if (distance < nearest) {
      nearest = distance
      driver.goX = px
      driver.goZ = pz
    }
  }
  driver.heading = Math.atan2(driver.goX - driver.x, driver.goZ - driver.z)
}

function stepDrivers(world: TrafficWorld, rider: ScooterState, dt: number) {
  for (const driver of world.drivers) {
    if (driver.hidden) continue
    driver.age += dt
    const walker = rider.rider.phase === 'on' ? rider : rider.rider
    if (driver.age > DRIVER_STAYS || Math.hypot(driver.x - walker.x, driver.z - walker.z) > DRIVER_GONE_AT) {
      driver.hidden = true
      continue
    }
    const toX = driver.goX - driver.x
    const toZ = driver.goZ - driver.z
    const distance = Math.hypot(toX, toZ)
    if (distance < 0.15) {
      // There: standing on the footpath, looking back at the road.
      driver.walking = Math.max(0, (driver.walking ?? 0) - dt * 3)
      continue
    }
    const step = Math.min(distance, TRAFFIC_RULES.walkSpeed * dt)
    driver.x += (toX / distance) * step
    driver.z += (toZ / distance) * step
    driver.heading = Math.atan2(toX, toZ)
    driver.stride += step * STRIDE_PER_METRE
    driver.walking = 1
  }
}

/**
 * The near and the far.
 *
 * Near the player, at most `cap` vehicles (the quality's: twenty on High) drive properly: they
 * steer, squeeze through gaps, give way at junctions, honk, and are solid things in the physics
 * world. They're the nearest, out to `fullWithin` metres (and a vehicle already driving properly
 * stays so until `fullUntil`, so one at the edge doesn't flip to and fro); anything nearer than
 * `always` drives properly whatever the cap, as does anything knocked over, taken by the player or
 * stopped for a reason of its own.
 *
 * Everything else is on rails (`stepRail`): it keeps to its lane, stops for red lights and for
 * what's in front of it, pulls up at bus stops, and that's all, `1 / every` times a second. Its
 * place eases towards its place on the lane, which also rounds its corners. It's drawn as its far
 * stand-in, carried on between steps by its speed (Traffic.tsx), so it doesn't move in jerks.
 *
 * Who is which is worked out `1 / every` times a second, and new traffic is put on the road then
 * too, at most `spawns` vehicles a time.
 */
/**
 * Traffic comes in bunches, on the busy roads. `chance`: how often a vehicle put on the road
 * brings up to `most` more close behind it (a gap of about `gap` metres, `gapNimble` for
 * two-wheelers and autos). `sideLanes`: a lane gets its street's share of the traffic to this
 * power, so a side lane (a tenth of a main road's weight) gets a twentieth, not a tenth.
 * `awayShare`: how much of the traffic heading away from the player is put out at all.
 */
const BUNCH = { chance: 0.6, most: 4, gap: 5, gapNimble: 2.2, sideLanes: 1.3, awayShare: 0.3 }

export const RAIL = { fullWithin: 120, fullUntil: 135, always: 40, every: 0.1, most: 0.25, look: 28, spawns: 3, patience: 3, stuck: 40 }
/** Where a two-wheeler on rails goes to filter past standing traffic: between the lanes, or along the kerb. Sideways from its lane, in metres (left is positive). */
const RAIL_LINES = [-1.5, 0.9]
/** People further than `from` metres from the player are stepped `1 / every` times a second, and only walk along: no crossing, no stepping aside. */
const FAR_PEOPLE = { from: 60, every: 0.1, most: 0.25 }

/** A vehicle driving properly more than `from` metres off (along either axis) is stepped every other frame, for at most `most` seconds at once. */
const FAR_FULL = { from: 75, most: 0.05 }

const needsDriving = (vehicle: Vehicle) => !!(vehicle.body || vehicle.fallen || vehicle.taken || vehicle.riderOff || vehicle.halt)

/** A vehicle comes off its rails to be driven properly: whatever it remembered of junctions and queues is forgotten. */
function driveProperly(vehicle: Vehicle) {
  vehicle.rail = false
  vehicle.owed = 0
  vehicle.waiting = 0
  vehicle.pinned = 0
  vehicle.crossing = null
  vehicle.claim = false
  vehicle.atLine = false
  vehicle.heldFor = 0
  vehicle.knot = 0
  vehicle.backedOff = 0
  vehicle.holdOff = 0
  vehicle.setOffIn = undefined
  vehicle.barging = null
  vehicle.blocker = null
  vehicle.heldBy = null
  vehicle.stalled = false
  vehicle.reversing = false
  vehicle.shiftTarget = vehicle.shift
}

function putOnRails(world: TrafficWorld, vehicle: Vehicle) {
  vehicle.rail = true
  vehicle.owed = 0
  vehicle.waiting = 0
  vehicle.crossing = null
  vehicle.claim = false
  vehicle.barging = null
  vehicle.blocker = null
  vehicle.heldBy = null
  vehicle.indicator = 0
  vehicle.hazard = false
  vehicle.railSpeed = vehicle.speed
  vehicle.railStamp = world.railClock
  if (vehicle.pusher) world.physics.hidePusher(vehicle.pusher)
}

/** Chooses who drives properly: the nearest `cap`, and whoever must (see `RAIL`). */
function chooseModes(world: TrafficWorld, active: Vehicle[], at: { x: number; z: number }, cap: number) {
  const { order, away } = world
  const count = active.length
  for (let i = 0; i < count; i++) {
    const vehicle = active[i]
    away[i] = vehicle.lane === -1 ? Infinity : Math.hypot(vehicle.x - at.x, vehicle.z - at.z)
    order[i] = i
  }
  // Nearest first. The order hardly changes between one tenth of a second and the next, so this is quick.
  for (let i = 1; i < count; i++) {
    const index = order[i]
    let j = i - 1
    while (j >= 0 && away[order[j]] > away[index]) {
      order[j + 1] = order[j]
      j--
    }
    order[j + 1] = index
  }
  let full = 0
  let rail = 0
  for (let k = 0; k < count; k++) {
    const vehicle = active[order[k]]
    if (vehicle.lane === -1) {
      vehicle.rail = true
      continue
    }
    const distance = away[order[k]]
    const proper = needsDriving(vehicle) || distance < RAIL.always || (full < cap && distance < (vehicle.rail ? RAIL.fullWithin : RAIL.fullUntil))
    if (proper) {
      full++
      if (vehicle.rail) driveProperly(vehicle)
    } else {
      rail++
      if (!vehicle.rail) putOnRails(world, vehicle)
    }
  }
  world.counts.full = full
  world.counts.rail = rail
}

/** One step of a vehicle on rails (see `RAIL`). `others`: every vehicle in play. */
function stepRail(world: TrafficWorld, vehicle: Vehicle, others: Vehicle[], at: { x: number; z: number }, dt: number) {
  const rules = TRAFFIC_RULES
  const { roadLanes, random } = world
  let lane = roadLanes[vehicle.lane]
  const up = (vehicle.deck ?? 0) > UP_ON_DECK_TRAFFIC
  const noseX = Math.sin(vehicle.heading)
  const noseZ = Math.cos(vehicle.heading)
  // A little in front of its nose: anything standing there that isn't in its own queue is crossing its path.
  const aheadX = vehicle.x + noseX * (vehicle.halfLength + 1.6)
  const aheadZ = vehicle.z + noseZ * (vehicle.halfLength + 1.6)
  const filters = vehicle.kind === 'bike' || vehicle.kind === 'cycle'
  const line = RAIL_LINES[vehicle.tint < 0.6 ? 0 : 1]
  const own = vehicle.shift + vehicle.fileShift
  const patient = vehicle.waiting < RAIL.patience
  let gap: number = RAIL.look
  let queue = false
  for (let i = 0; i < others.length; i++) {
    const other = others[i]
    if (other === vehicle || other.lane === -1) continue
    const offsetX = other.x - vehicle.x
    const offsetZ = other.z - vehicle.z
    if (offsetX > 45 || offsetX < -45 || offsetZ > 45 || offsetZ < -45) continue
    let ahead = Infinity
    if (other.lane === vehicle.lane) {
      if (other.along > vehicle.along || (other.along === vehicle.along && other.tint > vehicle.tint)) ahead = other.along - vehicle.along
    } else if (other.lane === vehicle.nextLane) ahead = lane.length - vehicle.along + other.along
    if (ahead !== Infinity) {
      // In another file, beside it: not in its way.
      if (Math.abs(other.shift + other.fileShift - own) > vehicle.radius + other.radius + 0.2) continue
      ahead -= other.halfLength + vehicle.halfLength
      if (filters && other.speed < 2 && ahead < 14) {
        // Standing traffic: a two-wheeler goes up the side of it, and queues only behind another on the same line.
        queue = true
        if (!other.nimble || Math.abs(other.shift + other.fileShift - vehicle.fileShift - line) > 0.6) continue
      }
      if (ahead < gap) gap = ahead
    } else if (patient && ((other.deck ?? 0) > UP_ON_DECK_TRAFFIC) === up) {
      // Across its nose (a junction with no lights): it waits, a few seconds at most. Not for what's coming the other way, on its own side.
      const facing = noseX * Math.sin(other.heading) + noseZ * Math.cos(other.heading)
      if (facing > -0.5 && facing < 0.9 && Math.hypot(other.x - aheadX, other.z - aheadZ) < vehicle.radius + other.radius + 0.5) gap = 0
    }
  }
  vehicle.shiftTarget = filters && queue ? line : 0
  easeShift(vehicle, dt)

  const toStop = vehicle.rebel ? Infinity : findStopAhead(roadLanes, vehicle.lane, vehicle.along, vehicle.halfLength, vehicle.speed, world.signals, world.signalClock)
  const held = Math.sqrt(2 * rules.signalBraking * toStop)
  const turn = nextTurn(vehicle, roadLanes, random)
  const bendSpeed = turn.angle < 0.3 ? Infinity : rules.cornerSpeed * Math.max(0.6, (Math.PI / 2 / turn.angle) ** 0.7)
  const forBend = Math.sqrt(bendSpeed * bendSpeed + 2 * rules.cornerBraking * turn.distance)
  const forStop = vehicle.kind === 'bus' ? busStopSpeed(world, vehicle, dt) : Infinity
  const keep = vehicle.nimble ? rules.nimbleGap : rules.carGap
  const target = Math.min(vehicle.cruiseSpeed, Math.max(0, gap - keep), held, forBend, forStop)
  vehicle.braking = target < vehicle.speed - 0.05 || (vehicle.speed < 0.2 && target < 0.2)
  const change = target - vehicle.speed
  vehicle.speed += Math.sign(change) * Math.min(Math.abs(change), (change < 0 ? rules.braking : rules.acceleration) * dt)
  // Held by what's in front (not a light, not a stop): counted, so a wait at a junction ends, and a knot out of sight is cleared away.
  const standing = vehicle.speed < 0.3 && gap - keep < 0.3
  vehicle.waiting = standing ? vehicle.waiting + dt : gap > 3 ? 0 : vehicle.waiting
  if (vehicle.waiting > RAIL.stuck && Math.hypot(vehicle.x - at.x, vehicle.z - at.z) > 70) {
    vehicle.lane = -1
    return
  }

  if (!advance(vehicle, roadLanes, vehicle.speed * dt, random)) {
    vehicle.lane = -1
    return
  }
  lane = roadLanes[vehicle.lane]
  if (lane.closed) {
    vehicle.lane = -1
    return
  }
  // Towards its place on the lane, most of the way each step: it trails the corner a little, which rounds it.
  easeFile(vehicle, lane, dt)
  const sideways = vehicle.shift + vehicle.fileShift
  const toX = lane.startX + lane.forwardX * vehicle.along + lane.forwardZ * sideways
  const toZ = lane.startZ + lane.forwardZ * vehicle.along - lane.forwardX * sideways
  const share = 1 - Math.exp(-dt * 7)
  const moveX = (toX - vehicle.x) * share
  const moveZ = (toZ - vehicle.z) * share
  const moved = Math.hypot(moveX, moveZ)
  vehicle.x += moveX
  vehicle.z += moveZ
  if (moved > 0.03) {
    const turnTo = angleBetween(vehicle.heading, Math.atan2(moveX, moveZ))
    vehicle.heading += turnTo * Math.min(1, dt * 9)
  }
  vehicle.railSpeed = moved / dt
  vehicle.railStamp = world.railClock
  vehicle.deck = deckHeightOn(lane, vehicle.along, world.decks)
  vehicle.lift = vehicle.deck
}

export function stepTraffic(
  world: TrafficWorld,
  rider: ScooterState,
  vehicleCount: number,
  pedestrianCount: number,
  dt: number,
  /** How many vehicles may drive properly at once (see `RAIL`). */
  fullCap = 20,
) {
  const { roadLanes, walkLanes, random } = world
  const rules = TRAFFIC_RULES
  // Up on a flyover, the traffic and people below don't meet the rider: they deal with a stand-in
  // far away. Where traffic appears and goes still follows the real rider.
  // Where the player is: on foot, wherever they've walked, not where their vehicle stands. Traffic and
  // people come and go around them.
  const at = rider.rider.phase === 'on' ? rider : rider.rider
  const riderUp = riderUpOnDeck(rider)
  const far = farRider(rider)
  const contact = riderUp ? far : rider
  const lists = world.lists
  const activeVehicles = lists.active
  if (activeVehicles.length !== Math.min(vehicleCount, world.vehicles.length)) {
    activeVehicles.length = 0
    for (let i = 0; i < vehicleCount && i < world.vehicles.length; i++) activeVehicles.push(world.vehicles[i])
    // Those no longer in play (a lower quality) leave the road.
    for (let i = activeVehicles.length; i < world.vehicles.length; i++) {
      const spare = world.vehicles[i]
      if (spare.lane === -1 || spare.taken) continue
      if (spare.body) world.physics.removeBody(spare)
      if (spare.pusher) world.physics.hidePusher(spare.pusher)
      spare.lane = -1
      spare.x = 1e6
      spare.z = 1e6
    }
  }
  world.railClock += dt
  world.honked += dt
  // Ten times a second: who drives properly and who is on rails, and new traffic onto the road.
  world.modeIn -= dt
  const tick = world.modeIn <= 0
  if (tick) {
    world.modeIn = RAIL.every
    chooseModes(world, activeVehicles, at, fullCap)
  }
  let spawnsLeft = tick ? RAIL.spawns : 0
  // Traffic up on the flyovers and on the ground never meet: each deals only with its own level,
  // and with the rider only on the same level.
  const isUp = (vehicle: Vehicle) => vehicle.lane !== -1 && (vehicle.deck ?? 0) > UP_ON_DECK_TRAFFIC
  // The vehicles driving properly, and everything near enough to matter to them, on each level.
  const fullVehicles = lists.full
  const fullGround = lists.fullGround
  const groundVehicles = lists.nearGround
  const upVehicles = lists.nearUp
  const nearVehicles = lists.near
  fullVehicles.length = fullGround.length = groundVehicles.length = upVehicles.length = nearVehicles.length = 0
  const nearReach = RAIL.fullUntil + 35
  for (let i = 0; i < activeVehicles.length; i++) {
    const vehicle = activeVehicles[i]
    if (vehicle.lane === -1) continue
    const up = isUp(vehicle)
    if (!vehicle.rail) {
      fullVehicles.push(vehicle)
      if (!up) fullGround.push(vehicle)
    } else if (Math.abs(vehicle.x - at.x) > nearReach || Math.abs(vehicle.z - at.z) > nearReach) continue
    nearVehicles.push(vehicle)
    if (up) upVehicles.push(vehicle)
    else groundVehicles.push(vehicle)
  }
  world.anyEmpty = fullVehicles.some((vehicle) => vehicle.taken === 'empty')
  world.signalClock += dt
  listDowned(world, contact, fullVehicles, pedestrianCount)

  startHalts(world, fullGround, at, dt)
  // Who may drive into each junction this step. Only on the ground: nothing crosses up on a deck.
  planJunctions(world.junctions, roadLanes, fullGround, world.signals, world.signalClock, (vehicle, steps) => laneAhead(vehicle, roadLanes, steps, random), dt)

  const outNow = Math.round(vehicleCount * world.density)
  for (let index = 0; index < activeVehicles.length; index++) {
    const vehicle = activeVehicles[index]
    // Empty or driven by the player, it isn't traffic: it stands, or goes where they drive it.
    if (vehicle.taken && vehicle.taken !== 'hailed' && vehicle.lane !== -1) {
      stepTaken(vehicle, rider, at)
      continue
    }
    const tooFar = Math.hypot(vehicle.x - at.x, vehicle.z - at.z) > rules.vehicleRemoveAt
    if (vehicle.lane === -1 || tooFar) {
      // Already off the road, it waits for its turn to be put back on: a few each tenth of a second.
      // One that found no place (a bus where no buses run) waits a moment before trying again, so it doesn't take every turn.
      if (vehicle.lane === -1 && vehicle.rail && Math.abs(vehicle.x) > 1e5 && (spawnsLeft <= 0 || index >= outNow || world.railClock < (vehicle.retryAt ?? 0))) continue
      vehicle.rail = true
      vehicle.taken = undefined
      vehicle.abandoned = false
      if (vehicle.body) world.physics.removeBody(vehicle)
      vehicle.rotation = null
      vehicle.fallen = null
      vehicle.lift = 0
      vehicle.deck = 0
      vehicle.lane = -1
      if (vehicle.thrownRider) {
        if (vehicle.thrownRider.body) world.physics.removeBody(vehicle.thrownRider)
        mountRider(vehicle, vehicle.thrownRider)
      }
      // Busier streets take more of the traffic (streetPresets.ts), and buses keep to the main roads.
      // In a jam, lanes near its heart take traffic whatever their street's weight: it bunches there.
      const jam = world.jam
      const inJam = (lane: Lane) => jam !== null && Math.hypot(lane.startX - jam.x, lane.startZ - jam.z) < jam.reach * 0.6 && random() < jam.amount
      // Side lanes get far less than their share (`SIDE_LANES`), and most of what appears is heading
      // towards the player, not away: traffic that comes past, not traffic that was never seen.
      const towards = (lane: Lane) => lane.forwardX * (at.x - lane.startX) + lane.forwardZ * (at.z - lane.startZ) > 0 || random() < BUNCH.awayShare
      const isFree = (lane: Lane) =>
        (vehicle.kind !== 'bus' || lane.buses === true) &&
        !lane.closed &&
        !lane.inJunction &&
        (inJam(lane) || random() < ((lane.weight ?? 1) / MAX_LANE_WEIGHT) ** BUNCH.sideLanes) &&
        towards(lane) &&
        activeVehicles.every(
          (other) =>
            other.lane === -1 ||
            Math.hypot(other.x - lane.startX, other.z - lane.startZ) >= Math.max(rules.spawnGap, other.halfLength + vehicle.halfLength + 2),
        )
      // Quieter times of day keep some vehicles in: off the road, far away, until it's busy again.
      if (index >= outNow || spawnsLeft <= 0) {
        vehicle.x = 1e6
        vehicle.z = 1e6
        continue
      }
      spawnsLeft--
      // In bunches, as traffic comes: the next few appear close behind the last one put out, on its lane.
      const bunch = world.bunch
      let lane = -1
      let bunchAlong = -1
      if (bunch.left > 0 && bunch.lane >= 0 && !roadLanes[bunch.lane].closed && (vehicle.kind !== 'bus' || roadLanes[bunch.lane].buses === true)) {
        bunch.left--
        bunchAlong = bunch.along - vehicle.halfLength - bunch.halfLength - (vehicle.nimble ? BUNCH.gapNimble : BUNCH.gap) * (0.6 + random())
        if (bunchAlong > 0.5) lane = bunch.lane
      }
      if (lane === -1) lane = findLaneInRing(
        roadLanes,
        at.x,
        at.z,
        rules.vehicleSpawnMin,
        rules.vehicleSpawnMax,
        random,
        isFree,
        150,
      )
      if (lane === -1) {
        vehicle.x = 1e6
        vehicle.z = 1e6
        vehicle.retryAt = world.railClock + 1 + random() * 2
        spawnsLeft++
        continue
      }
      placeOnLane(vehicle, roadLanes, lane, random)
      if (bunchAlong > 0.5) {
        vehicle.along = bunchAlong
        vehicle.x = roadLanes[lane].startX + roadLanes[lane].forwardX * bunchAlong
        vehicle.z = roadLanes[lane].startZ + roadLanes[lane].forwardZ * bunchAlong
      } else bunch.left = random() < BUNCH.chance ? 1 + Math.floor(random() * BUNCH.most) : 0
      bunch.lane = lane
      bunch.along = vehicle.along
      bunch.halfLength = vehicle.halfLength
      vehicle.file = Math.floor(random() * 6)
      vehicle.fileShift = fileOffset(vehicle, roadLanes[lane])
      vehicle.x += roadLanes[lane].forwardZ * vehicle.fileShift
      vehicle.z -= roadLanes[lane].forwardX * vehicle.fileShift
      vehicle.railSpeed = vehicle.cruiseSpeed
      vehicle.railStamp = world.railClock
      vehicle.detailed = undefined
      vehicle.deck = deckHeightOn(roadLanes[lane], vehicle.along, world.decks)
      vehicle.lift = vehicle.deck
      vehicle.speed = vehicle.cruiseSpeed
      vehicle.waiting = 0
      vehicle.pinned = 0
      vehicle.recovery = 1
      vehicle.shift = 0
      vehicle.shiftTarget = 0
      vehicle.crossing = null
      vehicle.claim = false
      vehicle.heldFor = 0
      vehicle.knot = 0
      vehicle.backedOff = 0
      vehicle.holdOff = 0
      vehicle.halt = null
      vehicle.hazard = false
      vehicle.reversing = false
      vehicle.setOffIn = undefined
      vehicle.barging = null
      vehicle.indicator = 0
      vehicle.braking = false
      // Never on top of another: a lane can start clear and still run through one a little way along.
      if (activeVehicles.some((other) => other !== vehicle && other.lane !== -1 && Math.abs(other.x - vehicle.x) < 30 && capsuleDistance(vehicle, other) < vehicle.radius + other.radius + 1.5)) {
        vehicle.lane = -1
        vehicle.x = 1e6
        vehicle.z = 1e6
        continue
      }
    }

    if (vehicle.thrownRider && vehicle.riderOff) stepThrownRider(world, vehicle, vehicle.thrownRider, dt)

    if (vehicle.body) {
      stepCrashedVehicle(world, vehicle, rider, dt)
      if (vehicle.lane !== -1) blockRider(vehicle, contact, dt)
      continue
    }
    if (vehicle.fallen) {
      stepRightingVehicle(vehicle, dt)
      blockRider(vehicle, contact, dt)
      continue
    }

    // On rails: stepped ten times a second, each in its own turn so they don't all fall in one frame.
    if (vehicle.rail) {
      vehicle.owed = (vehicle.owed ?? vehicle.tint * RAIL.every) + dt
      if (vehicle.owed < RAIL.every) continue
      const owed = Math.min(vehicle.owed, RAIL.most)
      vehicle.owed = 0
      stepRail(world, vehicle, activeVehicles, at, owed)
      continue
    }
    // Driving properly but well off (`FAR_FULL`), it's stepped every other frame, with both frames' time.
    let stepDt = dt
    if (!vehicle.taken && !vehicle.halt && (Math.abs(vehicle.x - at.x) > FAR_FULL.from || Math.abs(vehicle.z - at.z) > FAR_FULL.from)) {
      vehicle.owed = (vehicle.owed ?? 0) + dt
      if (vehicle.owed < dt * 1.5) continue
      stepDt = Math.min(vehicle.owed, FAR_FULL.most)
    }
    vehicle.owed = 0

    const up = isUp(vehicle)
    const peers = up ? upVehicles : groundVehicles
    const seen = up === riderUp ? rider : far
    // Locked into another (neither can move without driving further into the other): the heavier
    // edges through after a moment (`mayBarge`). One still locked where the rider can't see is taken
    // away, and appears elsewhere.
    const locked = () => {
      vehicle.knot = (vehicle.knot ?? 0) + stepDt
      if (vehicle.knot > rules.knotTime && !vehicle.taken && Math.hypot(vehicle.x - at.x, vehicle.z - at.z) > rules.pinnedRemoveDistance) vehicle.lane = -1
    }
    // Touching another that's in front of it: it stops. If the other is stopped by this one too,
    // they're locked, and it's sorted out as drivers do: after a moment the lighter of the two backs
    // off a little, and the heavier goes on. `ring` is the same thing at a distance: vehicles each
    // waiting for the next, round in a circle.
    const inWay = mustGiveWay(vehicle, peers)
    const ring = inWay ? null : ringToBreak(vehicle, activeVehicles)
    const knot = vehicle.knot ?? 0
    if (!inWay && (vehicle.holdOff ?? 0) > 0) {
      vehicle.holdOff = (vehicle.holdOff ?? 0) - stepDt
      vehicle.speed = 0
      vehicle.braking = true
      if (trafficDebug.reasons) vehicle.reason = 'backed off, letting the other through'
      continue
    }
    // Once going through, it keeps on until it's past the one it was locked with.
    let through = vehicle.barging ?? null
    if (through) {
      const ahead = (through.x - vehicle.x) * Math.sin(vehicle.heading) + (through.z - vehicle.z) * Math.cos(vehicle.heading)
      const apart = Math.hypot(through.x - vehicle.x, through.z - vehicle.z)
      if (through.lane === -1 || ahead < 0 || apart > vehicle.halfLength + through.halfLength + 2) through = null
    }
    if (!through && ring && knot >= rules.ringPatience) through = ring
    // The last resort, when backing off hasn't freed them: the heavier pushes on through.
    if (!through && inWay && knot >= rules.pushAfter && mayBarge(vehicle, inWay, activeVehicles)) through = inWay
    vehicle.barging = through
    const pushing = through !== null && knot >= rules.pushAfter
    if (inWay && !pushing) {
      vehicle.speed = 0
      vehicle.braking = true
      if (trafficDebug.reasons) vehicle.reason = 'touching another in front of it'
      maybeHonk(world, vehicle, seen, false, stepDt)
      locked()
      if (vehicle.lane === -1) continue
      // Back off, if it's the lighter: straight back a little way, never into anything behind.
      const backed = vehicle.backedOff ?? 0
      if (knot > rules.backOffAfter && backed < rules.backOffMost && !vehicle.taken && !outranks(vehicle, inWay, activeVehicles)) {
        const before = overlapWithTraffic(vehicle, peers)
        const step = rules.backOffSpeed * stepDt
        const fromX = vehicle.x
        const fromZ = vehicle.z
        vehicle.x -= Math.sin(vehicle.heading) * step
        vehicle.z -= Math.cos(vehicle.heading) * step
        if (!up) pushOutOfBuildings(world.collisions, vehicle, vehicle.radius * rules.wallMargin)
        // It's leaving the one in front, so its overlap may only shrink: growing means something is behind it.
        if (overlapWithTraffic(vehicle, peers) > before + 0.001 || Math.hypot(vehicle.x - fromX, vehicle.z - fromZ) < step * 0.5) {
          vehicle.x = fromX
          vehicle.z = fromZ
        } else {
          vehicle.backedOff = backed + step
          vehicle.along = Math.max(0, vehicle.along - step)
          // And having made room, it waits a moment for the other to use it.
          vehicle.holdOff = rules.backOffWait
        }
      }
      continue
    }
    // Never into another vehicle: a step that would push this one further into another's
    // footprint is taken back, and it waits (see `overlapWithTraffic`).
    const before = overlapWithTraffic(vehicle, peers)
    const kept = { x: vehicle.x, z: vehicle.z, heading: vehicle.heading, along: vehicle.along, lane: vehicle.lane, prevLane: vehicle.prevLane, nextLane: vehicle.nextLane, onward: vehicle.onward ? [...vehicle.onward] : undefined, shift: vehicle.shift, deck: vehicle.deck, lift: vehicle.lift }
    // Going through a lock: at a crawl, and not held at a line by the very one it's locked with.
    if (vehicle.barging) vehicle.junctionSpeed = rules.bargeSpeed
    stepVehicle(world, vehicle, peers, seen, stepDt)
    if (vehicle.lane === -1) continue
    // Pulled up for the player: the driver gets out, and it stands empty.
    if (vehicle.taken === 'hailed' && vehicle.speed < 0.15) {
      vehicle.speed = 0
      vehicle.taken = 'empty'
      letDriverOut(world, vehicle)
    }
    if (!vehicle.body && overlapWithTraffic(vehicle, peers) > before + 0.001) {
      locked()
      if (vehicle.lane === -1) continue
      // Locked this long, whichever way round they are (a bus's tail swinging into a bike beside it), it goes on regardless.
      if (pushing || knot >= rules.pushAfter) vehicle.speed = Math.min(vehicle.speed, rules.bargeSpeed)
      else {
        Object.assign(vehicle, kept)
        vehicle.speed = 0
        if (trafficDebug.reasons) vehicle.reason += '; step taken back (it would drive into another)'
        // A two-wheeler squeezing sideways into something beside it gives up that gap.
        vehicle.shiftTarget = vehicle.shift
      }
    } else if (vehicle.barging || ring) locked()
    else {
      vehicle.knot = Math.max(0, knot - stepDt)
      if (vehicle.knot === 0) vehicle.backedOff = 0
    }
    // Up on a deck there's no crash physics (it's all on the ground): it just never drives through the rider.
    if (up) {
      blockRider(vehicle, seen, stepDt)
      continue
    }
    hitRider(world, vehicle, contact, stepDt)
    for (let i = 0; i < pedestrianCount; i++) {
      const person = world.pedestrians[i]
      if (person.lane === -1 || person.body || person.fallen) continue
      if (Math.abs(person.x - vehicle.x) > 4 || Math.abs(person.z - vehicle.z) > 4) continue
      hitPersonWithVehicle(world, vehicle, person)
    }
  }

  stepDrivers(world, rider, dt)
  updateLoose(world, contact, dt)
  updatePushers(world, fullVehicles, contact)
  // The city's walls are in the physics world only round the rider; this adds them as the rider goes.
  world.physics.wallsNear(rider.x, rider.z)
  timed('physics (Rapier)', () => world.physics.step(dt))
  blockThrownRider(world, contact, fullVehicles)

  let walkersNear = 0
  let walkersFar = 0
  let walkerSpawns = RAIL.spawns
  for (let index = 0; index < world.pedestrians.length; index++) {
    const person = world.pedestrians[index]
    // Fewer are out at quiet hours: the rest wait, off the map, and come back as it gets busy.
    if (index >= pedestrianCount) {
      if (person.lane !== -1 && !person.body && !person.fallen) {
        person.lane = -1
        person.x = 1e6
        person.z = 1e6
      }
      if (person.lane === -1) continue
    }
    const tooFar = Math.hypot(person.x - at.x, person.z - at.z) > rules.pedestrianRemoveAt
    if (person.lane === -1 || tooFar) {
      if (person.body) world.physics.removeBody(person)
      person.rotation = null
      person.fallen = null
      person.down = 0
      person.lift = 0
      person.lane = -1
      // Put back on a footpath a few at a time, as the traffic is.
      if (!tick || walkerSpawns <= 0) {
        person.x = 1e6
        person.z = 1e6
        continue
      }
      walkerSpawns--
      // Mostly walking towards the player, as the traffic is put out: people who come past.
      const lane = findLaneInRing(walkLanes, at.x, at.z, rules.pedestrianSpawnMin, rules.pedestrianSpawnMax, random, (walk) => walk.forwardX * (at.x - walk.startX) + walk.forwardZ * (at.z - walk.startZ) > 0 || random() < BUNCH.awayShare)
      if (lane === -1) continue
      placeOnLane(person, walkLanes, lane, random)
      person.dodgeX = 0
      person.dodgeZ = 0
      person.cross = null
      person.wave = 0
      person.walking = 1
    }

    if (person.body || person.fallen) {
      // Knocked down on the way over: once up, they walk on to where they were going.
      person.cross = null
      person.wave = 0
      person.walking = 1
      stepKnockedPedestrian(world, person, dt)
      continue
    }
    // Far from the player, people only walk along, ten times a second (`FAR_PEOPLE`); someone crossing finishes crossing properly.
    const farOff = Math.hypot(person.x - at.x, person.z - at.z) > FAR_PEOPLE.from + (person.far ? 0 : 6)
    person.far = farOff && !person.cross
    if (person.far) {
      walkersFar++
      person.owed = (person.owed ?? person.tint * FAR_PEOPLE.every) + dt
      if (person.owed < FAR_PEOPLE.every) continue
      const owed = Math.min(person.owed, FAR_PEOPLE.most)
      person.owed = 0
      person.farStamp = world.railClock
      stepFarPedestrian(world, person, owed)
      continue
    }
    walkersNear++
    stepPedestrian(world, person, contact, nearVehicles, dt)
    hitPedestrian(world, person, contact)
  }
  world.counts.walkersNear = walkersNear
  world.counts.walkersFar = walkersFar
  separatePeople(world.pedestrians, pedestrianCount, dt)
}

/** Records a hit to be heard. A knock of 10 m/s or more is as loud as it gets. */
function soundImpact(world: TrafficWorld, x: number, z: number, knock: number) {
  world.impacts.push({ x, z, strength: Math.min(1, knock / 10) })
}

/** Hands each hit that happened this step to `play`, then forgets them. */
export function takeImpacts(world: TrafficWorld, play: (impact: HitSound) => void) {
  world.impacts.forEach(play)
  world.impacts.length = 0
}

/** Hands each horn that sounded this step to `play`, then forgets them. */
export function takeHonks(world: TrafficWorld, play: (honk: Honk) => void) {
  world.honks.forEach(play)
  world.honks.length = 0
}
