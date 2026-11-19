import { heightOnFlyover, type Flyover } from '../world/transitPlacement'
import { isInsideBounds } from '../world/worldUtils'
import type { Lane } from './lanes'

/*
 * Traffic over the flyovers. Each deck becomes a run of lanes along its path, in the traffic's
 * own lane list, so cars, buses, autos and bikes drive up a ramp, over and down the other side. A
 * deck's lanes know where they are along it (`deck`), so a vehicle on one is drawn at the deck's
 * height there. At a ramp's foot, short lanes join the deck to the ground lanes that run on in
 * its direction; where a deck ends up in the air (at an interchange), it runs on to the next deck.
 *
 * Nothing on the ground meets what's on a deck: a vehicle up there (higher than `UP_ON_DECK_TRAFFIC`)
 * sees only the others up there, and the rider only when they're up too (trafficLogic.ts).
 */

/** Where a deck lane is along its deck, in metres from the deck's start, at the lane's start and end. */
export type DeckSpan = { index: number; from: number; to: number }

/** Traffic higher than this, in metres, is up on a deck, and meets nothing below. */
export const UP_ON_DECK_TRAFFIC = 2.2

/** Deck lanes are about this long, in metres: a few path points each. */
const LANE_STEP = 8
/** A ramp's foot joins ground lanes ending or starting this near it, in metres. */
const JOIN_REACH = 22
/** Two decks join, end to start, this near each other, in metres. */
const DECK_JOIN_REACH = 16
/** And only heading this nearly the same way (the cosine of the angle between them). */
const SAME_WAY = 0.6
/** Up to this many ground lanes join each ramp's foot, the best aligned and nearest. */
const MAX_JOINS = 2
/** How busy the decks are, against the streets' weights (streetPresets.ts; main roads are 10). */
const DECK_WEIGHT = 8
const EDGE_MARGIN = 3

type Run = { first: number; last: number; deck: number; atStart: boolean; atEnd: boolean; forwardX: number; forwardZ: number }

function laneBetween(ax: number, az: number, bx: number, bz: number, deck?: DeckSpan): Lane | null {
  const length = Math.hypot(bx - ax, bz - az)
  if (length < 0.2) return null
  return {
    startX: ax,
    startZ: az,
    endX: bx,
    endZ: bz,
    length,
    forwardX: (bx - ax) / length,
    forwardZ: (bz - az) / length,
    next: [],
    startNode: -1,
    endNode: -1,
    weight: DECK_WEIGHT,
    buses: true,
    ...(deck ? { deck } : {}),
  }
}

/**
 * Adds the decks' lanes to `lanes` (the ground's, from createLanes), joined to them at the ramps'
 * feet. Returns how many lanes were added and joins made, for the load report.
 */
export function addDeckLanes(lanes: Lane[], decks: Flyover[]): { lanes: number; joins: number } {
  const groundCount = lanes.length
  const runs: Run[] = []

  decks.forEach((deck, index) => {
    const { points, at } = deck.path
    if (points.length < 2) return
    const half = deck.width / 2
    // One way: the left lane, keeping a bike's width from the barrier. Two way: each its own half.
    const directions: (1 | -1)[] = deck.oneWay ? [1] : [1, -1]
    const offset = deck.oneWay ? Math.max(0, Math.min(1.75, half - 1.9)) : half / 2
    // The path's points every LANE_STEP metres or so, both ends kept.
    const stride = Math.max(1, Math.round(LANE_STEP / Math.max(0.5, at[1] - at[0])))
    const picks: number[] = []
    for (let i = 0; i < points.length - 1; i += stride) picks.push(i)
    picks.push(points.length - 1)

    for (const direction of directions) {
      const order = direction === 1 ? picks : [...picks].reverse()
      let run: Run | null = null
      const close = () => {
        if (run && run.last >= run.first) runs.push(run)
        run = null
      }
      for (let k = 1; k < order.length; k++) {
        const a = order[k - 1]
        const b = order[k]
        const [ax, az] = points[a]
        const [bx, bz] = points[b]
        const length = Math.hypot(bx - ax, bz - az) || 1
        const fx = (bx - ax) / length
        const fz = (bz - az) / length
        // A quarter turn to the left of travel is (fz, -fx), as in lanes.ts.
        const sx = ax + fz * offset
        const sz = az - fx * offset
        const ex = bx + fz * offset
        const ez = bz - fx * offset
        if (!isInsideBounds(sx, sz, EDGE_MARGIN) || !isInsideBounds(ex, ez, EDGE_MARGIN)) {
          close()
          continue
        }
        const lane = laneBetween(sx, sz, ex, ez, { index, from: at[a], to: at[b] })
        if (!lane) continue
        const id = lanes.length
        lanes.push(lane)
        if (run) lanes[(run as Run).last].next = [id]
        const startsAtEnd = k === 1
        if (!run) run = { first: id, last: id, deck: index, atStart: startsAtEnd, atEnd: false, forwardX: fx, forwardZ: fz }
        else (run as Run).last = id
        if (k === order.length - 1) (run as Run).atEnd = true
      }
      close()
    }
  })

  // Low ends (the ramp's foot, on the ground) join ground lanes; high ends join another deck.
  let joins = 0
  const isLow = (run: Run, end: 'start' | 'end') => {
    const deck = decks[run.deck]
    const span = (end === 'start' ? lanes[run.first] : lanes[run.last]).deck as DeckSpan
    const s = end === 'start' ? span.from : span.to
    return heightOnFlyover(deck, s) < 0.6 && (deck.startsLow || deck.endsLow)
  }
  const aligned = (a: Lane, fx: number, fz: number) => a.forwardX * fx + a.forwardZ * fz

  for (const run of runs) {
    const first = lanes[run.first]
    const last = lanes[run.last]

    if (run.atStart && isLow(run, 'start')) {
      // Ground lanes ending near the foot, heading up the ramp: each may turn onto it.
      const near = []
      for (let i = 0; i < groundCount; i++) {
        const lane = lanes[i]
        const d = Math.hypot(lane.endX - first.startX, lane.endZ - first.startZ)
        if (d < JOIN_REACH && aligned(lane, first.forwardX, first.forwardZ) > SAME_WAY) near.push({ i, d })
      }
      near.sort((p, q) => p.d - q.d)
      for (const { i } of near.slice(0, MAX_JOINS)) {
        const lane = lanes[i]
        const link = laneBetween(lane.endX, lane.endZ, first.startX, first.startZ)
        const target = link ? lanes.length : run.first
        if (link) {
          link.next = [run.first]
          lanes.push(link)
        }
        lane.next = [...lane.next, target]
        joins++
      }
    }
    if (run.atEnd && isLow(run, 'end')) {
      const near = []
      for (let i = 0; i < groundCount; i++) {
        const lane = lanes[i]
        const d = Math.hypot(lane.startX - last.endX, lane.startZ - last.endZ)
        if (d < JOIN_REACH && aligned(lane, last.forwardX, last.forwardZ) > SAME_WAY) near.push({ i, d })
      }
      near.sort((p, q) => p.d - q.d)
      for (const { i } of near.slice(0, MAX_JOINS)) {
        const lane = lanes[i]
        const link = laneBetween(last.endX, last.endZ, lane.startX, lane.startZ)
        if (link) {
          link.next = [i]
          last.next.push(lanes.length)
          lanes.push(link)
        } else last.next.push(i)
        joins++
      }
    }
  }
  // Deck to deck, up in the air: the end of one run to the start of another that carries on.
  for (const run of runs) {
    if (!run.atEnd || isLow(run, 'end')) continue
    const last = lanes[run.last]
    const endHeight = heightOnFlyover(decks[run.deck], (last.deck as DeckSpan).to)
    for (const other of runs) {
      if (other === run || !other.atStart) continue
      const first = lanes[other.first]
      const startHeight = heightOnFlyover(decks[other.deck], (first.deck as DeckSpan).from)
      if (Math.abs(startHeight - endHeight) > 1.5) continue
      if (Math.hypot(first.startX - last.endX, first.startZ - last.endZ) > DECK_JOIN_REACH) continue
      if (aligned(first, last.forwardX, last.forwardZ) < SAME_WAY) continue
      // A short link in the air, at the decks' height (its span is the next deck's start).
      const span = first.deck as DeckSpan
      const link = laneBetween(last.endX, last.endZ, first.startX, first.startZ, { index: span.index, from: span.from, to: span.from })
      if (link) {
        link.next = [other.first]
        last.next.push(lanes.length)
        lanes.push(link)
      } else last.next.push(other.first)
      joins++
    }
  }
  return { lanes: lanes.length - groundCount, joins }
}

/** The height of the road under a mover on `lane`, `along` metres in: the deck's, or 0 on the ground. */
export function deckHeightOn(lane: Lane, along: number, decks: Flyover[]): number {
  const span = lane.deck
  if (!span) return 0
  const t = lane.length > 0 ? Math.max(0, Math.min(1, along / lane.length)) : 0
  return heightOnFlyover(decks[span.index], span.from + (span.to - span.from) * t)
}
