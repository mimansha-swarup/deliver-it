import { IDLE_POSE } from '../traffic/gait'
import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { Prop } from './props'
import type { ShopLife } from './shopPeoplePlacement'
import { Surface, type SurfaceMap } from './surfaceMap'
import type { GroundPoint } from './worldUtils'

/*
 * Agara Lake's shore: a walking path all the way round, a dozen metres back from the water, with
 * benches facing the water; joggers, walkers and people out with their dogs in the morning (and a
 * few walkers at dusk); and birds wheeling over the water by day.
 */

/** The path runs this far back from the water, and is this wide, in metres. */
const PATH_BACK = 12
const PATH_WIDTH = 2.6
/** Points round the lake the path is measured at. */
const AROUND = 160
/** A bench every this many points or so, on the path's outer side. */
const BENCH_EVERY = 5
const BENCH_RADIUS = 0.8

export type LakeLife = {
  /** The path's middle line, in runs: it breaks where the shore has no room for it. */
  path: GroundPoint[][]
  benches: Prop[]
  /** Out in the morning: joggers and walkers on the path, people stopped with their dogs. */
  morning: ShopLife
  /** Out at dusk: a few walkers. */
  evening: ShopLife
  /** The dogs with the morning's dog walkers. */
  dogs: Prop[]
  /** Where the birds wheel: the water's middle and how far out it reaches, or null with no lake. */
  birds: { x: number; z: number; reach: number } | null
  report: Record<string, number>
}

export function planLakeLife({ middle, surface, collisions }: { middle: GroundPoint | null; surface: SurfaceMap; collisions: CollisionWorld }): LakeLife {
  const life: LakeLife = { path: [], benches: [], morning: { standing: [], walkers: [] }, evening: { standing: [], walkers: [] }, dogs: [], birds: null, report: {} }
  if (!middle) return life
  const [cx, cz] = middle

  // The shore, looking out from the middle: the furthest water each way.
  const shore: number[] = []
  for (let i = 0; i < AROUND; i++) {
    const angle = (i / AROUND) * Math.PI * 2
    let furthest = 0
    for (let r = 2; r < 900; r += 2) if (surface.at(cx + Math.cos(angle) * r, cz + Math.sin(angle) * r) === Surface.Water) furthest = r
    shore.push(furthest)
  }
  // Smoothed, so the path doesn't jink with every cell of the shore.
  const smooth = shore.map((_, i) => {
    let sum = 0
    for (let k = -3; k <= 3; k++) sum += shore[(i + k + AROUND) % AROUND]
    return sum / 7
  })
  const points: (GroundPoint | null)[] = smooth.map((radius, i) => {
    if (radius < 10) return null
    const angle = (i / AROUND) * Math.PI * 2
    const x = cx + Math.cos(angle) * (radius + PATH_BACK)
    const z = cz + Math.sin(angle) * (radius + PATH_BACK)
    return surface.at(x, z) === Surface.Park && !isNearBuilding(collisions, x, z, 1.5) ? [x, z] : null
  })

  // The path's runs, and its ground: paved, so no grass or trees are put on it.
  let run: GroundPoint[] = []
  const close = () => {
    if (run.length > 1) life.path.push(run)
    run = []
  }
  for (let i = 0; i <= AROUND; i++) {
    const point = points[i % AROUND]
    if (!point) {
      close()
      continue
    }
    const previous = run[run.length - 1]
    if (previous) {
      const [ax, az] = previous
      const [bx, bz] = point
      const length = Math.hypot(bx - ax, bz - az) || 1
      const sx = ((bz - az) / length) * (PATH_WIDTH / 2)
      const sz = (-(bx - ax) / length) * (PATH_WIDTH / 2)
      const ex = ((bx - ax) / length) * 0.6
      const ez = ((bz - az) / length) * 0.6
      surface.fillPolygon([[ax - ex + sx, az - ez + sz], [bx + ex + sx, bz + ez + sz], [bx + ex - sx, bz + ez - sz], [ax - ex - sx, az - ez - sz]], Surface.Paved, [Surface.Park])
    }
    run.push(point)
  }
  close()

  // Benches on the outer side of the path, facing the water.
  points.forEach((point, i) => {
    if (!point || i % BENCH_EVERY !== 2) return
    const angle = (i / AROUND) * Math.PI * 2
    const x = point[0] + Math.cos(angle) * (PATH_WIDTH / 2 + 1.1)
    const z = point[1] + Math.sin(angle) * (PATH_WIDTH / 2 + 1.1)
    if (surface.at(x, z) !== Surface.Park || isNearBuilding(collisions, x, z, BENCH_RADIUS + 0.3)) return
    // A bench's seat faces +z at no turn: turned to look back at the middle of the lake.
    life.benches.push({ x, z, rotation: Math.atan2(cx - x, cz - z), variation: 0.5 })
    addPost(collisions, x, z, BENCH_RADIUS)
  })

  // People on the path: each to and fro along a stretch of it.
  const stretches: [GroundPoint, GroundPoint][] = []
  for (const piece of life.path) for (let i = 0; i + 2 < piece.length; i += 2) stretches.push([piece[i], piece[i + 2]])
  const pick = (k: number) => stretches[(k * 37 + 11) % stretches.length]
  if (stretches.length > 0) {
    for (let k = 0; k < 14; k++) {
      const [from, to] = pick(k)
      life.morning.walkers.push({ from, to, body: (k % 2) as 0 | 1, tint: (k * 0.31) % 1, skin: 0.7 + ((k * 0.13) % 0.33), speed: 2.5 + (k % 3) * 0.25, start: (k * 0.37) % 1, pause: 0 })
    }
    for (let k = 0; k < 10; k++) {
      const [from, to] = pick(k + 40)
      life.morning.walkers.push({ from, to, body: (k % 2) as 0 | 1, tint: (k * 0.43) % 1, skin: 0.7 + ((k * 0.17) % 0.33), speed: 1.15 + (k % 3) * 0.1, start: (k * 0.61) % 1, pause: 3 })
    }
    for (let k = 0; k < 8; k++) {
      const [from, to] = pick(k + 80)
      life.evening.walkers.push({ from, to, body: (k % 2) as 0 | 1, tint: (k * 0.53) % 1, skin: 0.7 + ((k * 0.19) % 0.33), speed: 1.1 + (k % 3) * 0.1, start: (k * 0.29) % 1, pause: 4 })
    }
    // Out with the dog: stopped at the path's edge, the dog beside them.
    for (let k = 0; k < 6; k++) {
      const [[x, z], [nx, nz]] = pick(k + 120)
      const heading = Math.atan2(nx - x, nz - z)
      const px = x + Math.cos(heading) * 1.0
      const pz = z - Math.sin(heading) * 1.0
      life.morning.standing.push({ x: px, z: pz, heading, body: (k % 2) as 0 | 1, tint: (k * 0.47) % 1, skin: 0.72 + ((k * 0.11) % 0.3), idle: k % 2 === 0 ? IDLE_POSE.phone : IDLE_POSE.weight, phase: k * 2.3 })
      life.dogs.push({ x: px + Math.sin(heading) * 0.9, z: pz + Math.cos(heading) * 0.9, rotation: heading + 0.4, variation: (k * 0.29) % 1 })
    }
  }

  const reach = Math.max(...smooth)
  life.birds = { x: cx, z: cz, reach }
  life.report = { pathMetres: Math.round(life.path.reduce((sum, piece) => sum + piece.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - piece[i][0], p[1] - piece[i][1]), 0), 0)), benches: life.benches.length, joggersAndWalkers: life.morning.walkers.length, dogWalkers: life.dogs.length, eveningWalkers: life.evening.walkers.length }
  return life
}
