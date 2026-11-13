import type RAPIER from '@dimforge/rapier3d-compat'
import type { CollisionWorld } from '../world/collision'
import { PLAY_AREA } from '../world/worldUtils'

type RapierModule = typeof RAPIER
type RigidBody = RAPIER.RigidBody

export type Quaternion = [x: number, y: number, z: number, w: number]

/** How something behaves once it's loose: how it grips, bounces and slows down. */
export type CrashSurface = {
  /** Grip against the ground. A body drags, rubber grips, metal on its side skids. */
  friction: number
  /** How much of a landing it bounces back. 0 is a dead thud. */
  bounce: number
  /** Slows sliding along, from air and scraping. */
  slideDamping: number
  /** Slows spinning. High for a floppy body, which can't keep rolling like a box. */
  spinDamping: number
}

/** The size of something as a box, with the height of that box's middle above the ground. */
export type CrashShape = {
  halfSize: [x: number, y: number, z: number]
  centre: number
  /** In kilograms. */
  mass: number
  /** How it behaves when loose. Hard objects are used if this is left out. */
  surface?: CrashSurface
  /**
   * A person on the ground. The rider's shape doesn't touch it, so riding on
   * past a fallen body doesn't shove it down the road like a bulldozer.
   */
  body?: boolean
}

/** Anything that Rapier can take over. It writes the result straight back here. */
export type Tumbler = {
  x: number
  z: number
  heading: number
  /** Height of the base above the ground. */
  lift: number
  /** A full 3D rotation, once it's no longer simply upright. */
  rotation: Quaternion | null
  body: RigidBody | null
}

const GRAVITY = -9.81
/** Walls are this tall. Nothing thrown in the game gets higher. */
const WALL_HEIGHT = 12
const FRICTION = 0.75
/*
 * Collision groups. Rapier packs two masks into one number: the top 16 bits say
 * which groups a shape is in, and the bottom 16 which groups it will touch. Two
 * shapes touch only if each is in a group the other will touch.
 */
const EVERYTHING = 0xffff
const RIDER_GROUP = 0x0002
const BODY_GROUP = 0x0004
const groups = (member: number, touches: number) => (member << 16) | touches
const RIDER_GROUPS = groups(RIDER_GROUP, EVERYTHING & ~BODY_GROUP)
const BODY_GROUPS = groups(BODY_GROUP, EVERYTHING & ~RIDER_GROUP)

/** A hard object: some bounce, and air and scraping slow it a little, so that nothing rolls for ever. */
const HARD_SURFACE: CrashSurface = { friction: FRICTION, bounce: 0.12, slideDamping: 0.12, spinDamping: 0.5 }
/** Things that the arcade rules move are parked out of the way here when not in use. */
const OUT_OF_THE_WAY = -60

function rotateVector([x, y, z, w]: Quaternion, vx: number, vy: number, vz: number) {
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ]
}

export function yawRotation(heading: number): Quaternion {
  return [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)]
}

/** Turns smoothly from one rotation to another, `amount` of the way, along the shortest path. */
export function blendRotation(from: Quaternion, to: Quaternion, amount: number): Quaternion {
  let [bx, by, bz, bw] = to
  let cosine = from[0] * bx + from[1] * by + from[2] * bz + from[3] * bw
  // A rotation and its negative are the same turn. Using the nearer one avoids going the long way round.
  if (cosine < 0) {
    ;[bx, by, bz, bw] = [-bx, -by, -bz, -bw]
    cosine = -cosine
  }
  if (cosine > 0.9995) {
    const mixed: Quaternion = [
      from[0] + (bx - from[0]) * amount,
      from[1] + (by - from[1]) * amount,
      from[2] + (bz - from[2]) * amount,
      from[3] + (bw - from[3]) * amount,
    ]
    const length = Math.hypot(...mixed)
    return mixed.map((value) => value / length) as Quaternion
  }
  const angle = Math.acos(cosine)
  const fromShare = Math.sin((1 - amount) * angle) / Math.sin(angle)
  const toShare = Math.sin(amount * angle) / Math.sin(angle)
  return [
    from[0] * fromShare + bx * toShare,
    from[1] * fromShare + by * toShare,
    from[2] * fromShare + bz * toShare,
    from[3] * fromShare + bw * toShare,
  ]
}

/** How upright something is: 1 is standing, 0 is on its side, and -1 is on its roof. */
export function uprightness(rotation: Quaternion | null): number {
  return rotation ? rotateVector(rotation, 0, 1, 0)[1] : 1
}

/** Every wall as one fixed mesh of thin sides. No roofs, as nothing gets that high. */
function createWallMesh(collisions: CollisionWorld) {
  const footprints = new Set([...collisions.values()].flat())
  const vertices: number[] = []
  const indices: number[] = []

  for (const footprint of footprints) {
    footprint.forEach(([x, z], index) => {
      const [nextX, nextZ] = footprint[(index + 1) % footprint.length]
      const first = vertices.length / 3
      vertices.push(x, 0, z, nextX, 0, nextZ, nextX, WALL_HEIGHT, nextZ, x, WALL_HEIGHT, z)
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
    })
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

export type CrashPhysics = ReturnType<typeof createCrashPhysics>

/**
 * The physics world, used only for crashes. Your scooter and normal traffic stay
 * arcade: in here they're "kinematic", meaning they push things but nothing pushes
 * them. Only things that have been hit, or that stand loose, are real bodies.
 */
export function createCrashPhysics(R: RapierModule, collisions: CollisionWorld) {
  const world = new R.World({ x: 0, y: GRAVITY, z: 0 })

  // The ground, and the wall around the edge of the map.
  const fixed = (x: number, y: number, z: number, hx: number, hy: number, hz: number) =>
    world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(FRICTION))

  const { minX, maxX, minZ, maxZ } = PLAY_AREA
  const middleX = (minX + maxX) / 2
  const middleZ = (minZ + maxZ) / 2
  // Half the width and depth, with a little over at each end so the corners close.
  const halfX = (maxX - minX) / 2 + 2
  const halfZ = (maxZ - minZ) / 2 + 2
  fixed(middleX, -1, middleZ, halfX, 1, halfZ)
  fixed(minX - 1, 5, middleZ, 1, 5, halfZ)
  fixed(maxX + 1, 5, middleZ, 1, 5, halfZ)
  fixed(middleX, 5, minZ - 1, halfX, 5, 1)
  fixed(middleX, 5, maxZ + 1, halfX, 5, 1)

  const { vertices, indices } = createWallMesh(collisions)
  if (indices.length > 0) world.createCollider(R.ColliderDesc.trimesh(vertices, indices))

  /** A shape that follows the arcade rules. Something hitting it stops, and it doesn't care. */
  const createPusher = (shape: CrashShape, isRider = false) => {
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, OUT_OF_THE_WAY, 0),
    )
    const [hx, hy, hz] = shape.halfSize
    const collider = R.ColliderDesc.cuboid(hx, hy, hz)
    if (isRider) collider.setCollisionGroups(RIDER_GROUPS)
    world.createCollider(collider, body)
    return body
  }

  const movePusher = (body: RigidBody, x: number, y: number, z: number, heading: number) => {
    const [qx, qy, qz, qw] = yawRotation(heading)
    body.setNextKinematicTranslation({ x, y, z })
    body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw })
  }

  /** Instant, as something launched from where this was mustn't touch it on the way out. */
  const hidePusher = (body: RigidBody) => {
    body.setTranslation({ x: 0, y: OUT_OF_THE_WAY, z: 0 }, false)
  }

  /** Makes something a real physical body, exactly where and however it's sitting. */
  const addBody = (
    thing: Tumbler,
    { halfSize, centre, mass, surface = HARD_SURFACE, body: isBody = false }: CrashShape,
    sleeping: boolean,
  ) => {
    const rotation = thing.rotation ?? yawRotation(thing.heading)
    const [offsetX, offsetY, offsetZ] = rotateVector(rotation, 0, centre, 0)
    const [qx, qy, qz, qw] = rotation

    const description = R.RigidBodyDesc.dynamic()
      .setTranslation(thing.x + offsetX, thing.lift + offsetY, thing.z + offsetZ)
      .setRotation({ x: qx, y: qy, z: qz, w: qw })
      .setLinearDamping(surface.slideDamping)
      .setAngularDamping(surface.spinDamping)
      .setCcdEnabled(true)
      .setCanSleep(true)
      .setSleeping(sleeping)
    const body = world.createRigidBody(description)

    const [hx, hy, hz] = halfSize
    const collider = R.ColliderDesc.cuboid(hx, hy, hz)
      .setMass(mass)
      .setFriction(surface.friction)
      .setRestitution(surface.bounce)
    if (isBody) collider.setCollisionGroups(BODY_GROUPS)
    world.createCollider(collider, body)
    thing.body = body
  }

  /** Gives a real body a sudden change of speed and spin. */
  const launch = (
    thing: Tumbler,
    velocity: [x: number, y: number, z: number],
    spin: [x: number, y: number, z: number],
  ) => {
    if (!thing.body) return
    const [x, y, z] = velocity
    const [spinX, spinY, spinZ] = spin
    thing.body.wakeUp()
    thing.body.setLinvel({ x, y, z }, true)
    thing.body.setAngvel({ x: spinX, y: spinY, z: spinZ }, true)
  }

  /** Copies where a real body has got to back onto the game object. */
  const readBack = (thing: Tumbler, { centre }: CrashShape) => {
    const body = thing.body
    if (!body) return

    const { x, y, z } = body.translation()
    const { x: qx, y: qy, z: qz, w } = body.rotation()
    const rotation: Quaternion = [qx, qy, qz, w]
    const [offsetX, offsetY, offsetZ] = rotateVector(rotation, 0, centre, 0)

    thing.x = x - offsetX
    thing.z = z - offsetZ
    thing.lift = y - offsetY
    thing.rotation = rotation
    const [forwardX, , forwardZ] = rotateVector(rotation, 0, 0, 1)
    thing.heading = Math.atan2(forwardX, forwardZ)
  }

  /** Hands something back to the arcade rules. */
  const removeBody = (thing: Tumbler) => {
    if (thing.body) world.removeRigidBody(thing.body)
    thing.body = null
  }

  const step = (dt: number) => {
    world.timestep = dt
    world.step()
  }

  return { world, createPusher, movePusher, hidePusher, addBody, launch, readBack, removeBody, step }
}
