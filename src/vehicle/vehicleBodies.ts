import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * The bodies of the vehicles that aren't the scooter's own rig (vehicleCatalog.ts): a model from
 * the models' files, wheels and all, in the vehicle's paint; or one built here (the bicycle, the
 * electric scooter, the cargo three-wheeler), each its own shape.
 */

const tube = (from: [number, number, number], to: [number, number, number], radius: number, color: string) => {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const geometry = new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 6)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return tint(geometry, color)
}

function tint(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  flat.deleteAttribute('uv')
  const { r, g, b } = new THREE.Color(color)
  const count = flat.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return flat
}

const boxAt = (size: [number, number, number], at: [number, number, number], color: string, turn: [number, number, number] = [0, 0, 0]) => {
  const geometry = new THREE.BoxGeometry(...size)
  geometry.rotateX(turn[0]).rotateY(turn[1]).rotateZ(turn[2])
  geometry.translate(...at)
  return tint(geometry, color)
}

/** A rounded lump: a ball squashed to `size` (its full width, height and length), smooth-shaded. */
const lump = (size: [number, number, number], at: [number, number, number], color: string, tilt = 0) => {
  const geometry = new THREE.SphereGeometry(0.5, 14, 10)
  geometry.scale(...size)
  geometry.computeVertexNormals()
  geometry.rotateX(tilt)
  geometry.translate(...at)
  return tint(geometry, color)
}

/** A wheel standing at the origin, its axle along x: a dark tyre, a rim, and a hub in `hub`. */
function wheelShape(radius: number, width: number, hub: string, spokes = 0): THREE.BufferGeometry {
  const parts = [
    tint(new THREE.TorusGeometry(radius - width / 2, width / 2, 8, 22).rotateY(Math.PI / 2), '#1c1c1e'),
    tint(new THREE.CylinderGeometry(radius * 0.36, radius * 0.36, width * 0.9, 12).rotateZ(Math.PI / 2), hub),
  ]
  if (spokes > 0) {
    for (let spoke = 0; spoke < spokes; spoke++) {
      const angle = (spoke / spokes) * Math.PI
      const reach = radius - width
      parts.push(tube([0, -Math.cos(angle) * reach, -Math.sin(angle) * reach], [0, Math.cos(angle) * reach, Math.sin(angle) * reach], 0.006, '#b8bcc0'))
    }
  } else {
    parts.push(tint(new THREE.CylinderGeometry(radius - width, radius - width, width * 0.5, 14).rotateZ(Math.PI / 2), '#8f9499'))
  }
  return join(parts)
}

function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Could not build a vehicle')
  return merged
}

/**
 * A vehicle built here, in pieces that move: the body; the parts that turn with the bars or the
 * steering (fork, handlebars, front mudguard) about the steering column; its wheels, each at its
 * axle, which spin with the road and, at the front, steer; and, on the bicycle, the cranks and
 * pedals, which go round as it's pedalled.
 */
export type BuiltVehicle = {
  body: THREE.BufferGeometry
  /** What turns with the bars, in the vehicle's own space, and where the column stands (x, z). Null on four wheels. */
  column: { geometry: THREE.BufferGeometry; pivot: [number, number] } | null
  /** `steers`: a front wheel. With a column it turns about that; without, about its own middle (a car's). */
  wheels: { geometry: THREE.BufferGeometry; at: [number, number, number]; steers: boolean }[]
  crank: { geometry: THREE.BufferGeometry; at: [number, number, number] } | null
  /** Window glass, drawn tinted and see-through: a cab's screens and side windows. Null with none. */
  glass: THREE.BufferGeometry | null
  /** How far the front wheels turn at full lock, in radians. */
  lock: number
  /** A delivery crate that carries the Deliver It logo on its back and sides (Scooter.tsx): its corners. */
  logoBox?: { min: [number, number, number]; max: [number, number, number] }
  /** Its lamps, where the model has them as pieces of their own: they glow (Scooter.tsx). `headTurns`: the head lamp is on the bars. */
  lamps?: { head: THREE.BufferGeometry | null; tail: THREE.BufferGeometry | null; headTurns: boolean }
  /** A cab with open sides, in which the driver is seen. */
  openCab?: boolean
}

export function disposeBuilt(built: BuiltVehicle) {
  built.body.dispose()
  built.column?.geometry.dispose()
  built.wheels.forEach(({ geometry }) => geometry.dispose())
  built.crank?.geometry.dispose()
  built.glass?.dispose()
  built.lamps?.head?.dispose()
  built.lamps?.tail?.dispose()
}

const STEEL = '#8f9499'
const DARK = '#1d2024'
const SEAT = '#2a211c'
const LAMP = '#f1ead0'
const TAIL = '#d3262b'
const WHITE = '#e9e7e1'

/** A mudguard: part of a hoop over a wheel at `at`. */
const mudguard = (at: [number, number, number], radius: number, color: string, arc = 0.7, start = -0.35) =>
  tint(new THREE.TorusGeometry(radius, 0.016, 4, 14, Math.PI * arc).rotateY(Math.PI / 2).rotateX(Math.PI * start).translate(...at), color)

/**
 * The rider's vehicles as modelled (models/fleet.glb, each cut into its moving pieces by
 * scripts/prepare_traffic_models.mjs): a body, on two wheels what turns with the bars, and each wheel
 * about its own axle, with where the axles and the steering column are. Set once the file has loaded
 * (Scooter.tsx); every vehicle built after that is its model, and one with no model (or before the
 * file comes) is the shape built here.
 */
type FleetModel = {
  body: THREE.BufferGeometry
  front: THREE.BufferGeometry | null
  wheels: { geometry: THREE.BufferGeometry; at: [number, number, number]; steers: boolean }[]
  pivot: [number, number]
  head: THREE.BufferGeometry | null
  tail: THREE.BufferGeometry | null
  headTurns: boolean
  /** The whole vehicle as one simple shape, for far away. */
  far: THREE.BufferGeometry | null
  logoBox?: { min: [number, number, number]; max: [number, number, number] }
}
/** Which model in the file is which vehicle. The electric scooter and the cargo three-wheeler have none. */
const FLEET_NAMES: Partial<Record<BuiltKind, string>> = { scooter: 'scooty', bicycle: 'cycle', bike: 'vega', trike: 'ecargo', car: 'minitruck', van: 'cargovan' }
const fleetModels: Partial<Record<BuiltKind, FleetModel>> = {}

/** Takes whatever vehicles a loaded file holds (fleet.glb, tripo.glb): called with each. */
export function setFleetModels(scene: THREE.Object3D) {
  const piece = (name: string) => {
    let geometry: THREE.BufferGeometry | null = null
    scene.getObjectByName(name)?.traverse((child) => {
      if (child instanceof THREE.Mesh) geometry = child.geometry
    })
    return geometry as THREE.BufferGeometry | null
  }
  for (const [kind, name] of Object.entries(FLEET_NAMES) as [BuiltKind, string][]) {
    if (fleetModels[kind]) continue
    const body = piece(name)
    const data = scene.getObjectByName(name)?.userData as { wheels?: { at: [number, number, number]; steers: boolean }[]; pivot?: [number, number]; headTurns?: boolean; logoBox?: FleetModel['logoBox'] } | undefined
    if (!body || !data?.wheels || !data.pivot) continue
    const wheels = data.wheels.map(({ at, steers }, index) => ({ geometry: piece(`${name}-wheel-${index}`), at, steers }))
    if (wheels.some(({ geometry }) => !geometry)) continue
    fleetModels[kind] = { body, front: piece(`${name}-front`), wheels: wheels as FleetModel['wheels'], pivot: data.pivot, head: piece(`${name}-head`), tail: piece(`${name}-tail`), headTurns: data.headTurns ?? false, far: piece(`${name}-far`), logoBox: data.logoBox }
  }
}

/** Whether a vehicle is drawn from a model (so a cab's driver, who'd poke through its roof, is left unseen inside it). */
export function isModelled(kind: BuiltKind): boolean {
  return fleetModels[kind] !== undefined
}

/** A modelled vehicle in a paint, with whatever the game adds to it (`extra`: shapes joined to the body). */
function fromModel(model: FleetModel, paint: string, lock: number, extra: THREE.BufferGeometry[] = []): BuiltVehicle {
  return {
    body: join([paintPiece(model.body, paint), ...extra]),
    column: model.front ? { geometry: paintPiece(model.front, paint), pivot: model.pivot } : null,
    wheels: model.wheels.map(({ geometry, at, steers }) => ({ geometry: paintPiece(geometry, paint), at, steers })),
    crank: null,
    glass: null,
    lock,
    logoBox: model.logoBox,
    lamps: model.head || model.tail ? { head: model.head ? paintPiece(model.head, paint) : null, tail: model.tail ? paintPiece(model.tail, paint) : null, headTurns: model.headTurns } : undefined,
  }
}

/** A modelled vehicle as one simple shape for far away, in its paint; null where there's none. */
export function createBuiltFar(kind: BuiltKind, paint: string): THREE.BufferGeometry | null {
  const far = fleetModels[kind]?.far
  return far ? paintPiece(far, paint) : null
}

/**
 * A piece of the modelled scooter in a paint: its painted panels (`_paint`) take the colour, under
 * their own light and shade, and the rest keeps its colours. Plain corners, as the built shapes are.
 */
function paintPiece(piece: THREE.BufferGeometry, paint: string): THREE.BufferGeometry {
  const flat = piece.index ? piece.toNonIndexed() : piece.clone()
  const { r, g, b } = new THREE.Color(paint)
  const color = flat.getAttribute('color')
  const painted = flat.getAttribute('_paint')
  const colors = new Float32Array(color.count * 3)
  for (let i = 0; i < color.count; i++) {
    const shade = color.getX(i)
    if (painted && painted.getX(i) > 0.5) colors.set([r * shade, g * shade, b * shade], i * 3)
    else colors.set([color.getX(i), color.getY(i), color.getZ(i)], i * 3)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', flat.getAttribute('position').clone())
  out.setAttribute('normal', flat.getAttribute('normal').clone())
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  flat.dispose()
  return out
}

/**
 * The Deliver It scooter, its front to +z: a Bengaluru family scooter. A step-through frame with a
 * flat footboard, a wide front apron, the handlebar cowl with a small round headlamp, a long seat
 * over rounded side panels, and a rack at the back for the yellow box (drawn by Scooter.tsx, with its logos).
 */
function createScooter(paint: string): BuiltVehicle {
  // The modelled scooter, once its file is in (above), with a rack behind the seat for the yellow box to
  // stand on (the model has none): a plate on two stays. Until then, and if it never comes, the one built here.
  if (fleetModels.scooter) {
    return fromModel(fleetModels.scooter, paint, 0.5, [
      boxAt([0.4, 0.02, 0.44], [0, 0.815, -0.73], '#3a3d42'),
      tube([-0.15, 0.81, -0.9], [-0.1, 0.64, -0.8], 0.014, STEEL),
      tube([0.15, 0.81, -0.9], [0.1, 0.64, -0.8], 0.014, STEEL),
    ])
  }
  const radius = 0.24
  const rear: [number, number, number] = [0, radius, -0.62]
  const front: [number, number, number] = [0, radius, 0.66]
  const parts: THREE.BufferGeometry[] = []
  // The footboard, flat and low, and the tunnel-free floor under it.
  parts.push(boxAt([0.42, 0.05, 0.46], [0, 0.31, 0.1], DARK))
  parts.push(lump([0.4, 0.2, 0.62], [0, 0.24, 0.08], paint))
  // The apron: wide, upright, curving back at the top to the column; a dark inner shield with a hook.
  parts.push(lump([0.46, 0.66, 0.15], [0, 0.63, 0.4], paint, -0.16))
  parts.push(boxAt([0.36, 0.5, 0.03], [0, 0.6, 0.325], DARK, [-0.16, 0, 0]))
  parts.push(lump([0.2, 0.2, 0.3], [0, 0.42, 0.52], paint, 0.5))
  // The body: round side panels swelling over the back wheel, and the long seat on them.
  parts.push(lump([0.5, 0.46, 1.0], [0, 0.5, -0.45], paint))
  parts.push(lump([0.36, 0.3, 0.5], [0, 0.6, -0.08], paint))
  parts.push(lump([0.34, 0.11, 0.78], [0, 0.77, -0.36], SEAT))
  for (const side of [-1, 1]) parts.push(lump([0.04, 0.16, 0.5], [side * 0.245, 0.48, -0.5], '#b8bcc0'))
  parts.push(boxAt([0.22, 0.07, 0.03], [0, 0.6, -0.945], TAIL))
  parts.push(boxAt([0.2, 0.1, 0.02], [0, 0.44, -0.95], WHITE))
  // The grab rail and the rack the box stands on.
  parts.push(tube([-0.17, 0.74, -0.72], [-0.17, 0.8, -0.95], 0.014, STEEL), tube([0.17, 0.74, -0.72], [0.17, 0.8, -0.95], 0.014, STEEL), tube([-0.17, 0.8, -0.95], [0.17, 0.8, -0.95], 0.014, STEEL))
  parts.push(boxAt([0.4, 0.02, 0.44], [0, 0.8, -0.73], '#3a3d42'))
  // The engine and the exhaust, on the right, beside the back wheel.
  parts.push(lump([0.2, 0.2, 0.34], [-0.05, 0.3, -0.4], '#4a4d51'))
  parts.push(tube([-0.19, 0.26, -0.3], [-0.2, 0.3, -0.86], 0.045, STEEL))
  const column = join([
    // The cowl with its small round headlamp, the bars, grips and mirrors.
    lump([0.44, 0.18, 0.22], [0, 1.0, 0.4], paint),
    lump([0.13, 0.13, 0.07], [0, 0.99, 0.51], LAMP),
    tube([-0.33, 1.02, 0.37], [0.33, 1.02, 0.37], 0.016, DARK),
    ...[-1, 1].flatMap((side) => [
      tube([side * 0.22, 1.02, 0.37], [side * 0.34, 1.02, 0.37], 0.022, '#3a3d42'),
      tube([side * 0.2, 1.04, 0.38], [side * 0.3, 1.22, 0.36], 0.007, DARK),
      lump([0.11, 0.07, 0.02], [side * 0.31, 1.24, 0.36], DARK),
      tube([side * 0.07, 0.9, 0.44], [side * 0.07, radius, 0.66], 0.02, DARK),
    ]),
    tube([0, 0.7, 0.42], [0, 0.94, 0.4], 0.035, DARK),
    lump([0.17, 0.13, 0.52], [0, 0.5, 0.66], paint),
  ])
  return {
    body: join(parts),
    column: { geometry: column, pivot: [0, 0.42] },
    wheels: [
      { geometry: wheelShape(radius, 0.1, STEEL), at: rear, steers: false },
      { geometry: wheelShape(radius, 0.09, STEEL), at: front, steers: true },
    ],
    crank: null,
    glass: null,
    lock: 0.5,
  }
}

/** A wire basket: a tray at `at` (the middle of its floor) of `size` (width, height, length), open on top, its sides upright wires and a rim. */
function basket(at: [number, number, number], size: [number, number, number]): THREE.BufferGeometry[] {
  const WIRE = '#77726a'
  const [x, y, z] = at
  const [w, h, l] = size
  const parts = [boxAt([w, 0.012, l], [x, y, z], '#6a655e')]
  const corners: [number, number][] = [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]]
  corners.forEach(([cx, cz], index) => {
    const [nx, nz] = corners[(index + 1) % 4]
    // The rim, and a mid rail, along each side; uprights between them.
    parts.push(tube([x + cx, y + h, z + cz], [x + nx, y + h, z + nz], 0.008, WIRE), tube([x + cx, y + h * 0.5, z + cz], [x + nx, y + h * 0.5, z + nz], 0.005, WIRE))
    for (let step = 0; step < 4; step++) {
      const t = step / 4
      const px = x + cx + (nx - cx) * t
      const pz = z + cz + (nz - cz) * t
      parts.push(tube([px, y, pz], [px, y + h, pz], 0.005, WIRE))
    }
  })
  return parts
}

/**
 * A city bicycle, its front to +z: a diamond frame in the vehicle's paint, a saddle, swept
 * handlebars, mudguards, and a carrier with a crate on the back for the parcel. Spoked wheels
 * that turn, a fork and bars that steer, and cranks and pedals that go round.
 */
function createBicycle(paint: string): BuiltVehicle {
  const wheel = 0.34
  const rear: [number, number, number] = [0, wheel, -0.52]
  const front: [number, number, number] = [0, wheel, 0.55]
  const crank: [number, number, number] = [0, 0.3, -0.02]
  const seat: [number, number, number] = [0, 0.86, -0.22]
  const head: [number, number, number] = [0, 0.92, 0.38]
  const parts: THREE.BufferGeometry[] = []
  parts.push(tube(crank, seat, 0.022, paint), tube(seat, head, 0.02, paint), tube(crank, head, 0.024, paint))
  parts.push(tube(rear, crank, 0.016, paint), tube(rear, seat, 0.014, paint))
  parts.push(tube([0, 0.86, -0.22], [0, 0.98, -0.25], 0.016, STEEL))
  parts.push(lump([0.17, 0.06, 0.28], [0, 1.0, -0.26], SEAT))
  parts.push(mudguard(rear, wheel + 0.03, paint))
  parts.push(boxAt([0.2, 0.02, 0.42], [0, 0.74, -0.6], STEEL))
  parts.push(boxAt([0.34, 0.26, 0.36], [0, 0.88, -0.62], '#f2b82a'))
  const column = join([
    tube(head, front, 0.02, paint),
    tube(head, [0, 1.06, 0.36], 0.016, STEEL),
    tube([-0.27, 1.06, 0.3], [0.27, 1.06, 0.3], 0.014, STEEL),
    ...[-1, 1].map((side) => tube([side * 0.27, 1.06, 0.3], [side * 0.29, 1.05, 0.18], 0.017, SEAT)),
    mudguard(front, wheel + 0.03, paint),
    // A front basket on the bars, as every city bicycle here has: a wire tray with slatted sides,
    // steel gone a little brown, on two stays down to the axle. The lamp hangs under its front edge.
    ...basket([0, 0.84, 0.56], [0.3, 0.19, 0.24]),
    tube([-0.11, 0.84, 0.6], [-0.05, wheel, 0.55], 0.007, STEEL),
    tube([0.11, 0.84, 0.6], [0.05, wheel, 0.55], 0.007, STEEL),
    lump([0.07, 0.07, 0.06], [0, 0.8, 0.7], LAMP),
  ])
  // The cranks, one each side and opposite, with their pedals, about the bottom bracket.
  const cranks = join([
    tint(new THREE.CylinderGeometry(0.085, 0.085, 0.015, 14).rotateZ(Math.PI / 2).translate(0.05, 0, 0), STEEL),
    tube([0.07, 0, 0], [0.07, -BICYCLE_CRANK, 0], 0.012, STEEL),
    tube([-0.07, 0, 0], [-0.07, BICYCLE_CRANK, 0], 0.012, STEEL),
    boxAt([0.1, 0.02, 0.07], [0.13, -BICYCLE_CRANK, 0], '#1c1c1e'),
    boxAt([0.1, 0.02, 0.07], [-0.13, BICYCLE_CRANK, 0], '#1c1c1e'),
  ])
  return {
    body: join(parts),
    column: { geometry: column, pivot: [0, 0.4] },
    wheels: [
      { geometry: wheelShape(wheel, 0.045, STEEL, 6), at: rear, steers: false },
      { geometry: wheelShape(wheel, 0.045, STEEL, 6), at: front, steers: true },
    ],
    crank: { geometry: cranks, at: crank },
    glass: null,
    lock: 0.6,
    logoBox: { min: [-0.17, 0.75, -0.8], max: [0.17, 1.01, -0.44] },
  }
}

/** The bicycle's crank length, and where its bottom bracket is: the rider's feet go round on these (Rider.tsx). */
export const BICYCLE_CRANK = 0.17
export const BICYCLE_BRACKET: [number, number, number] = [0, 0.3, -0.02]

/**
 * The Minchu E1, its front to +z: a slim electric scooter, nothing like the petrol one's round
 * body. A flat floor, a tall narrow apron in white with the paint as a blade down it, a ring of
 * light for a headlamp, a thin seat on a battery box, an upswept tail with a light bar, a hub
 * motor filling the back wheel, and an insulated bag on a rack.
 */
function createElectricScooter(paint: string): BuiltVehicle {
  const white = '#eef0ee'
  const radius = 0.25
  const rear: [number, number, number] = [0, radius, -0.62]
  const front: [number, number, number] = [0, radius, 0.66]
  const parts: THREE.BufferGeometry[] = []
  parts.push(boxAt([0.36, 0.05, 0.56], [0, 0.31, 0.06], DARK))
  parts.push(lump([0.34, 0.14, 0.7], [0, 0.24, 0.02], paint))
  // The apron: narrow, tall, leaning back, the paint a blade down its face, a ring of light on it.
  parts.push(lump([0.3, 0.72, 0.13], [0, 0.66, 0.44], white, -0.24))
  parts.push(boxAt([0.07, 0.6, 0.03], [0, 0.66, 0.515], paint, [-0.24, 0, 0]))
  parts.push(tint(new THREE.TorusGeometry(0.07, 0.014, 6, 20).rotateX(-0.24).translate(0, 0.9, 0.5), '#eaf6ff'))
  parts.push(boxAt([0.22, 0.015, 0.02], [0, 0.78, 0.535], '#eaf6ff', [-0.24, 0, 0]))
  // The seat on its battery box, and the tail swept up to a light bar.
  parts.push(lump([0.3, 0.3, 0.62], [0, 0.56, -0.36], white))
  parts.push(lump([0.27, 0.08, 0.66], [0, 0.76, -0.34], DARK))
  parts.push(lump([0.22, 0.14, 0.34], [0, 0.66, -0.72], paint, 0.35))
  parts.push(boxAt([0.2, 0.025, 0.02], [0, 0.71, -0.895], TAIL))
  // A single swingarm, and the rack with its insulated bag.
  parts.push(tube([0.11, 0.36, -0.2], [0.11, radius, -0.62], 0.028, DARK))
  parts.push(boxAt([0.26, 0.02, 0.3], [0, 0.82, -0.78], '#3a3d42'))
  parts.push(boxAt([0.36, 0.34, 0.34], [0, 1.0, -0.78], DARK))
  parts.push(boxAt([0.37, 0.07, 0.35], [0, 1.0, -0.78], paint))
  const column = join([
    tube([0, 0.9, 0.38], [0, 1.03, 0.34], 0.035, DARK),
    tube([-0.3, 1.03, 0.33], [0.3, 1.03, 0.33], 0.016, DARK),
    ...[-1, 1].flatMap((side) => [
      tube([side * 0.2, 1.03, 0.33], [side * 0.31, 1.03, 0.33], 0.022, '#3a3d42'),
      tube([side * 0.07, 0.86, 0.46], [side * 0.07, radius, 0.66], 0.018, DARK),
    ]),
    boxAt([0.2, 0.09, 0.03], [0, 1.08, 0.37], DARK, [-0.5, 0, 0]),
    mudguard(front, radius + 0.025, white, 0.6, -0.3),
  ])
  return {
    body: join(parts),
    column: { geometry: column, pivot: [0, 0.44] },
    // The back wheel is nearly all hub: that's the motor.
    wheels: [
      { geometry: join([wheelShape(radius, 0.1, paint), tint(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.11, 16).rotateZ(Math.PI / 2), '#3a3d42')]), at: rear, steers: false },
      { geometry: wheelShape(radius, 0.09, STEEL), at: front, steers: true },
    ],
    crank: null,
    glass: null,
    lock: 0.5,
  }
}

/**
 * The Vega 150, its front to +z: a commuter motorbike. Bigger wheels, the engine in the open
 * under a long tank in the paint, a flat bench seat, a chrome exhaust down the right, a round
 * headlamp in a small cowl on long forks, wide bars with mirrors, twin shocks at the back.
 */
function createMotorbike(paint: string): BuiltVehicle {
  const radius = 0.31
  const rear: [number, number, number] = [0, radius, -0.7]
  const front: [number, number, number] = [0, radius, 0.74]
  const chrome = '#c4c8cc'
  const parts: THREE.BufferGeometry[] = []
  // The frame's spine and cradle, the engine in it, its cylinder leaning forward.
  parts.push(tube([0, 0.9, 0.42], [0, 0.78, -0.3], 0.03, DARK), tube([0, 0.86, 0.4], [0, 0.3, 0.22], 0.026, DARK), tube([0, 0.3, 0.22], [0, 0.34, -0.3], 0.026, DARK), tube([0, 0.34, -0.3], [0, 0.78, -0.3], 0.026, DARK))
  parts.push(lump([0.3, 0.26, 0.42], [0, 0.4, -0.02], '#4a4d51'))
  parts.push(lump([0.2, 0.3, 0.2], [0, 0.6, 0.08], '#6d7074', -0.3))
  for (let fin = 0; fin < 4; fin++) parts.push(boxAt([0.24, 0.012, 0.24], [0, 0.52 + fin * 0.05, 0.06 + fin * 0.015], '#8f9499', [-0.3, 0, 0]))
  // The tank, long and humped, with knee dents in a second colour; the seat; side panels; the tail.
  parts.push(lump([0.36, 0.28, 0.6], [0, 0.9, 0.12], paint))
  for (const side of [-1, 1]) parts.push(lump([0.03, 0.14, 0.3], [side * 0.17, 0.86, 0.04], WHITE))
  parts.push(lump([0.3, 0.1, 0.8], [0, 0.87, -0.5], SEAT))
  for (const side of [-1, 1]) parts.push(lump([0.04, 0.2, 0.3], [side * 0.15, 0.66, -0.34], paint))
  parts.push(lump([0.26, 0.14, 0.34], [0, 0.84, -0.9], paint, 0.25))
  parts.push(boxAt([0.16, 0.06, 0.03], [0, 0.82, -1.07], TAIL))
  parts.push(tube([-0.13, 0.86, -0.82], [-0.13, 0.94, -1.06], 0.012, STEEL), tube([0.13, 0.86, -0.82], [0.13, 0.94, -1.06], 0.012, STEEL), tube([-0.13, 0.94, -1.06], [0.13, 0.94, -1.06], 0.012, STEEL))
  // Swingarm, twin shocks, the back mudguard, the chain's guard, and the exhaust down the right.
  for (const side of [-1, 1]) {
    parts.push(tube([side * 0.1, 0.36, -0.28], [side * 0.1, radius, -0.7], 0.022, DARK))
    parts.push(tube([side * 0.13, 0.74, -0.56], [side * 0.12, radius + 0.04, -0.7], 0.022, chrome))
    parts.push(boxAt([0.05, 0.03, 0.07], [side * 0.19, 0.36, -0.18], DARK))
  }
  parts.push(mudguard(rear, radius + 0.04, paint, 0.55, -0.1))
  parts.push(boxAt([0.03, 0.08, 0.42], [0.12, 0.42, -0.48], DARK))
  parts.push(tube([-0.1, 0.5, 0.14], [-0.17, 0.3, 0.02], 0.03, chrome), tube([-0.17, 0.3, 0.02], [-0.19, 0.36, -0.92], 0.05, chrome))
  const column = join([
    ...[-1, 1].flatMap((side) => [
      tube([side * 0.1, 1.0, 0.4], [side * 0.09, radius, 0.74], 0.024, chrome),
      tube([side * 0.26, 1.08, 0.34], [side * 0.37, 1.08, 0.32], 0.022, '#3a3d42'),
      tube([side * 0.2, 1.08, 0.36], [side * 0.3, 1.26, 0.34], 0.007, DARK),
      lump([0.1, 0.07, 0.02], [side * 0.31, 1.28, 0.34], DARK),
    ]),
    boxAt([0.26, 0.04, 0.06], [0, 1.0, 0.4], DARK),
    tube([-0.36, 1.08, 0.34], [0.36, 1.08, 0.34], 0.015, chrome),
    // The headlamp, round, in a small cowl of the paint, with the clocks behind it.
    lump([0.2, 0.2, 0.14], [0, 0.94, 0.56], paint),
    lump([0.16, 0.16, 0.06], [0, 0.94, 0.63], LAMP),
    lump([0.14, 0.07, 0.06], [0, 1.05, 0.46], DARK, -0.6),
    mudguard(front, radius + 0.035, paint, 0.5, -0.32),
  ])
  return {
    body: join(parts),
    column: { geometry: column, pivot: [0, 0.46] },
    wheels: [
      { geometry: wheelShape(radius, 0.11, STEEL, 5), at: rear, steers: false },
      { geometry: wheelShape(radius, 0.09, STEEL, 5), at: front, steers: true },
    ],
    crank: null,
    glass: null,
    lock: 0.45,
  }
}

/**
 * The Bhaara E-Cargo, its front to +z: an electric cargo three-wheeler. One wheel under a short
 * cab with a big open screen and open sides (the driver's seen at the bars), and behind it a tall
 * load box on two wheels, in white with a band of the vehicle's paint.
 */
function createCargoTrike(paint: string): BuiltVehicle {
  const radius = 0.24
  const parts: THREE.BufferGeometry[] = []
  parts.push(boxAt([1.2, 0.1, 2.9], [0, 0.34, -0.15], DARK))
  // The cab: a nose over the front wheel, the roof on four posts, a bench inside. No glass: the driver's seen.
  parts.push(lump([0.9, 0.5, 0.7], [0, 0.62, 1.05], paint))
  parts.push(boxAt([1.16, 0.5, 0.5], [0, 0.6, 0.72], paint))
  parts.push(boxAt([1.2, 0.07, 1.05], [0, 1.72, 0.45], WHITE))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.06, 0.92, 0.06], [side * 0.56, 1.28, 0.9], WHITE, [-0.2, 0, 0]))
    parts.push(boxAt([0.06, 0.86, 0.06], [side * 0.56, 1.29, -0.02], WHITE))
    parts.push(boxAt([0.05, 0.36, 0.86], [side * 0.58, 0.72, 0.42], paint))
    parts.push(lump([0.1, 0.1, 0.05], [side * 0.36, 0.72, 1.36], LAMP))
  }
  parts.push(boxAt([1.1, 0.05, 0.05], [0, 1.66, 0.96], WHITE))
  parts.push(boxAt([0.9, 0.1, 0.4], [0, 0.7, 0.1], SEAT))
  parts.push(boxAt([0.9, 0.5, 0.08], [0, 1.0, -0.1], SEAT))
  parts.push(boxAt([1.24, 0.12, 0.08], [0, 0.42, 1.36], DARK))
  // The load box: tall and square, its doors at the back, a band of paint round it.
  parts.push(boxAt([1.36, 1.3, 1.62], [0, 1.08, -0.92], WHITE))
  parts.push(boxAt([1.38, 0.2, 1.64], [0, 0.72, -0.92], paint))
  parts.push(boxAt([1.38, 0.04, 1.64], [0, 1.72, -0.92], '#cfcdc6'))
  parts.push(boxAt([0.02, 1.2, 0.02], [0, 1.1, -1.735], '#9a9892'))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.05, 0.16, 0.03], [side * 0.12, 1.05, -1.74], '#6d7074'))
    parts.push(boxAt([0.16, 0.08, 0.03], [side * 0.52, 0.5, -1.74], TAIL))
    parts.push(boxAt([0.14, 0.08, 0.66], [side * 0.69, 0.56, -1.0], DARK))
  }
  // Scooter-style bars on a column, as these have, turning the one front wheel.
  const column = join([
    tube([0, 0.5, 1.02], [0, 1.12, 0.66], 0.03, DARK),
    tube([-0.3, 1.13, 0.64], [0.3, 1.13, 0.64], 0.016, DARK),
    ...[-1, 1].map((side) => tube([side * 0.2, 1.13, 0.64], [side * 0.31, 1.13, 0.64], 0.022, '#3a3d42')),
    lump([0.2, 0.1, 0.1], [0, 1.15, 0.68], DARK),
  ])
  return {
    body: join(parts),
    column: { geometry: column, pivot: [0, 0.86] },
    wheels: [
      { geometry: wheelShape(radius, 0.12, STEEL), at: [0, radius, 1.08], steers: true },
      { geometry: wheelShape(radius, 0.13, STEEL), at: [-0.62, radius, -1.0], steers: false },
      { geometry: wheelShape(radius, 0.13, STEEL), at: [0.62, radius, -1.0], steers: false },
    ],
    crank: null,
    // The cab's big screen.
    glass: pane([1.06, 0.86, 0.02], [0, 1.28, 0.9], [-0.2, 0, 0]),
    lock: 0.55,
  }
}

/** A pane of glass: a thin sheet, its colour left to the glass material. */
const pane = (size: [number, number, number], at: [number, number, number], turn: [number, number, number] = [0, 0, 0]) => boxAt(size, at, '#ffffff', turn)

/** A steering wheel on its column, at the driver's hands: a ring tilted back, a hub and a spoke. */
const steeringWheel = (x: number, y: number, z: number) => [
  tint(new THREE.TorusGeometry(0.17, 0.016, 6, 16).rotateX(-0.45).translate(x, y, z), DARK),
  tube([x, y, z], [x, y - 0.16, z + 0.3], 0.022, DARK),
  boxAt([0.3, 0.025, 0.03], [x, y, z], DARK, [-0.45, 0, 0]),
]

/**
 * The Oota Hatch, its front to +z: a small catering hatchback. A short bonnet, a tall cabin with
 * open window frames (the driver's seen at the wheel, on the right as in India), a hatch at the back,
 * and an insulated food carrier on the roof.
 */
function createCar(paint: string): BuiltVehicle {
  const radius = 0.28
  const half = 0.8
  const parts: THREE.BufferGeometry[] = []
  // The shell below the windows, the bonnet and nose, bumpers and lamps.
  parts.push(boxAt([half * 2, 0.5, 3.3], [0, 0.6, -0.05], paint))
  parts.push(lump([half * 2 - 0.06, 0.42, 0.8], [0, 0.66, 1.5], paint))
  parts.push(boxAt([half * 2 - 0.1, 0.12, 0.95], [0, 0.88, 1.1], paint, [0.1, 0, 0]))
  parts.push(boxAt([half * 2 + 0.04, 0.16, 0.12], [0, 0.42, 1.82], DARK), boxAt([half * 2 + 0.04, 0.16, 0.12], [0, 0.42, -1.72], DARK))
  parts.push(boxAt([half * 2 - 0.3, 0.14, 0.05], [0, 0.62, 1.88], DARK))
  for (const side of [-1, 1]) {
    parts.push(lump([0.3, 0.16, 0.1], [side * 0.56, 0.74, 1.8], LAMP))
    parts.push(boxAt([0.12, 0.3, 0.05], [side * 0.7, 0.92, -1.72], TAIL))
    // The pillars: screen, middle and back, and the sill and roof rail between them. No glass.
    parts.push(boxAt([0.07, 0.66, 0.07], [side * (half - 0.07), 1.15, 0.5], paint, [-0.42, 0, 0]))
    parts.push(boxAt([0.07, 0.56, 0.09], [side * (half - 0.05), 1.14, -0.35], paint))
    parts.push(boxAt([0.07, 0.6, 0.1], [side * (half - 0.05), 1.14, -1.5], paint, [0.25, 0, 0]))
    parts.push(boxAt([0.07, 0.05, 1.95], [side * (half - 0.06), 1.42, -0.55], paint))
    parts.push(lump([0.1, 0.07, 0.14], [side * (half + 0.06), 0.98, 0.52], paint))
  }
  parts.push(boxAt([half * 2 - 0.12, 0.06, 1.95], [0, 1.45, -0.55], paint))
  parts.push(boxAt([half * 2 - 0.1, 0.34, 0.08], [0, 0.98, -1.68], paint))
  parts.push(boxAt([0.44, 0.11, 0.02], [0, 0.62, -1.79], WHITE))
  // Inside: the dash, the wheel on the right, two seats and a bench.
  parts.push(boxAt([half * 2 - 0.2, 0.2, 0.3], [0, 0.92, 0.55], DARK))
  parts.push(...steeringWheel(-0.36, 1.02, 0.38))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.46, 0.1, 0.46], [side * 0.36, 0.56, -0.1], SEAT))
    parts.push(boxAt([0.44, 0.6, 0.1], [side * 0.36, 0.9, -0.34], SEAT, [0.15, 0, 0]))
  }
  parts.push(boxAt([1.3, 0.5, 0.1], [0, 0.86, -1.1], SEAT))
  // The food carrier on the roof.
  parts.push(boxAt([0.9, 0.04, 0.8], [0, 1.5, -0.5], STEEL))
  parts.push(boxAt([0.7, 0.3, 0.6], [0, 1.67, -0.5], '#f2b82a'))
  parts.push(boxAt([0.71, 0.06, 0.61], [0, 1.72, -0.5], DARK))
  const wheel = () => wheelShape(radius, 0.18, STEEL)
  return {
    body: join(parts),
    column: null,
    wheels: [
      { geometry: wheel(), at: [-0.72, radius, 1.12], steers: true },
      { geometry: wheel(), at: [0.72, radius, 1.12], steers: true },
      { geometry: wheel(), at: [-0.72, radius, -1.12], steers: false },
      { geometry: wheel(), at: [0.72, radius, -1.12], steers: false },
    ],
    crank: null,
    // The screen, the side windows and the back window, in the frames.
    glass: join([
      pane([1.42, 0.64, 0.02], [0, 1.15, 0.5], [-0.42, 0, 0]),
      pane([1.4, 0.56, 0.02], [0, 1.15, -1.52], [0.25, 0, 0]),
      ...[-1, 1].flatMap((side) => [pane([0.02, 0.5, 0.78], [side * 0.76, 1.16, 0.06]), pane([0.02, 0.5, 1.05], [side * 0.76, 1.16, -0.92])]),
    ]),
    lock: 0.5,
  }
}

/**
 * The Saagane Loadstar, its front to +z: a cab-over cargo van. A flat-fronted cab with open
 * window frames high over the front wheels (the driver's seen at the wheel, on the right), and a
 * long, tall load body in white behind it, with a band of the paint and two doors at the back.
 */
function createVan(paint: string): BuiltVehicle {
  const radius = 0.32
  const half = 0.88
  const parts: THREE.BufferGeometry[] = []
  parts.push(boxAt([half * 2 - 0.1, 0.14, 4.3], [0, 0.48, 0], DARK))
  // The cab: its flat front and doors below the windows, pillars and roof above. No glass.
  parts.push(boxAt([half * 2, 0.62, 0.1], [0, 0.82, 2.13], paint))
  parts.push(boxAt([half * 2 - 0.2, 0.16, 0.06], [0, 0.72, 2.2], DARK))
  parts.push(boxAt([half * 2 + 0.04, 0.2, 0.14], [0, 0.46, 2.16], DARK))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.08, 0.62, 1.2], [side * (half - 0.04), 0.82, 1.55], paint))
    parts.push(boxAt([0.08, 0.78, 0.08], [side * (half - 0.04), 1.5, 2.1], paint, [-0.12, 0, 0]))
    parts.push(boxAt([0.08, 0.74, 0.1], [side * (half - 0.04), 1.5, 1.0], paint))
    parts.push(lump([0.3, 0.2, 0.08], [side * 0.6, 0.86, 2.19], LAMP))
    parts.push(lump([0.1, 0.24, 0.16], [side * (half + 0.1), 1.4, 2.0], DARK))
  }
  parts.push(boxAt([half * 2, 0.08, 1.3], [0, 1.9, 1.5], paint))
  parts.push(boxAt([half * 2 - 0.2, 0.22, 0.34], [0, 1.12, 1.9], DARK))
  parts.push(...steeringWheel(-0.42, 1.26, 1.72))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.5, 0.12, 0.5], [side * 0.42, 0.86, 1.25], SEAT))
    parts.push(boxAt([0.48, 0.62, 0.1], [side * 0.42, 1.2, 1.0], SEAT))
  }
  // The load body: long and tall, a band of paint along it, two doors and their bars at the back.
  parts.push(boxAt([half * 2, 1.6, 3.05], [0, 1.34, -0.6], WHITE))
  parts.push(boxAt([half * 2 + 0.02, 0.22, 3.07], [0, 0.9, -0.6], paint))
  parts.push(boxAt([half * 2 + 0.02, 0.05, 3.07], [0, 2.13, -0.6], '#cfcdc6'))
  parts.push(boxAt([0.02, 1.5, 0.02], [0, 1.36, -2.135], '#9a9892'))
  for (const side of [-1, 1]) {
    parts.push(boxAt([0.04, 1.3, 0.03], [side * 0.14, 1.36, -2.14], '#6d7074'))
    parts.push(boxAt([0.14, 0.28, 0.03], [side * (half - 0.1), 0.72, -2.14], TAIL))
    parts.push(boxAt([0.16, 0.1, 0.84], [side * (half - 0.06), 0.72, -1.3], DARK))
  }
  parts.push(boxAt([half * 2 + 0.04, 0.16, 0.12], [0, 0.44, -2.14], DARK))
  parts.push(boxAt([0.46, 0.11, 0.02], [0, 0.62, -2.21], WHITE))
  const wheel = () => wheelShape(radius, 0.2, STEEL)
  return {
    body: join(parts),
    column: null,
    wheels: [
      { geometry: wheel(), at: [-0.78, radius, 1.5], steers: true },
      { geometry: wheel(), at: [0.78, radius, 1.5], steers: true },
      { geometry: wheel(), at: [-0.78, radius, -1.3], steers: false },
      { geometry: wheel(), at: [0.78, radius, -1.3], steers: false },
    ],
    crank: null,
    // The cab's screen and door windows.
    glass: join([pane([1.62, 0.78, 0.02], [0, 1.5, 2.1], [-0.12, 0, 0]), ...[-1, 1].map((side) => pane([0.02, 0.72, 1.02], [side * 0.85, 1.5, 1.55]))]),
    lock: 0.5,
  }
}

export type BuiltKind = 'scooter' | 'bicycle' | 'ev' | 'bike' | 'trike' | 'car' | 'van'

const BUILDERS: Record<BuiltKind, (paint: string) => BuiltVehicle> = {
  scooter: createScooter,
  bicycle: createBicycle,
  ev: createElectricScooter,
  bike: createMotorbike,
  trike: createCargoTrike,
  car: createCar,
  van: createVan,
}

export function createBuiltVehicle(kind: BuiltKind, paint: string): BuiltVehicle {
  const model = kind === 'scooter' ? undefined : fleetModels[kind]
  if (!model) return BUILDERS[kind](paint)
  // A model, keeping from the built one what the model doesn't have: the bicycle's cranks that go
  // round under the rider's feet, and its crate with the logo.
  const built = BUILDERS[kind](paint)
  const modelled = fromModel(model, paint, built.lock, kind === 'bicycle' ? [boxAt([0.34, 0.26, 0.36], [0, 0.88, -0.62], '#f2b82a'), boxAt([0.2, 0.02, 0.42], [0, 0.74, -0.6], STEEL)] : [])
  modelled.crank = built.crank
  modelled.logoBox = modelled.logoBox ?? built.logoBox
  // The three-wheeler's cab has open sides: its driver is seen in it.
  modelled.openCab = kind === 'trike'
  built.body.dispose()
  built.column?.geometry.dispose()
  built.wheels.forEach(({ geometry }) => geometry.dispose())
  built.glass?.dispose()
  return modelled
}

/** A built vehicle as one still shape, wheels and all: standing at a delivery, or ridden up to it. The scooter gets its yellow box. */
export function createBuiltStill(kind: BuiltKind, paint: string): THREE.BufferGeometry {
  const built = createBuiltVehicle(kind, paint)
  const parts = [
    built.body,
    ...(built.column ? [built.column.geometry] : []),
    ...built.wheels.map(({ geometry, at }) => geometry.translate(...at)),
    ...(built.crank ? [built.crank.geometry.translate(...built.crank.at)] : []),
    // Standing or ridden by someone else, its glass is just dark.
    ...(built.glass ? [tint(built.glass, '#22303a')] : []),
    ...(kind === 'scooter' ? [boxAt([0.5, 0.4, 0.45], [0, 1.01, -0.725], '#f2b82a')] : []),
  ]
  return join(parts)
}
