import { addPost, isNearBuilding, removePost, type CollisionWorld } from './collision'
import { PALM, TREE_SHAPE_COUNT, treeExtent } from './foliage'
import type { Prop, RoadsideProps } from './props'
import type { SurfaceMap } from './surfaceMap'

/*
 * Nothing comes up through a flyover or the metro viaduct. The surface map's overhead layer
 * (surfaceMap.ts) holds each deck's underside height; once every tree and lamp post is placed,
 * each one near a deck is checked against it:
 * - standing under a deck: a tree becomes a shrub, a lamp post goes;
 * - beside one, reaching over it: a tree is made smaller until its leaves stay 1 m clear, or moved a
 *   few metres away where there's room, or taken out; a lamp post whose head would reach it goes.
 */

/** Leaves and lamps keep this far from a deck's underside and its edge, in metres. */
const CLEARANCE = 1
/** A tree is made no smaller than this share of its size to fit; smaller, it's moved or taken out. */
const SMALLEST = 0.6
/** How the drawing sizes trees (RoadsideProps' `sizeRange`, 0.5): from 0.75 to 1.25 by `variation`. */
const TREE_SIZE_RANGE = 0.5
const PALM_SIZE_RANGE = 0.3
/** A lamp post's top and how far its arm reaches out, in metres (RoadsideProps' lamp). */
const LAMP = { top: 6.8, reach: 1.8 }
/** Trunks and lamp posts are solid (props.ts' radii). */
const TREE_TRUNK_RADIUS = 0.25
/** Where a tree may move to: this far, in these directions. */
const MOVES = [2, 3.5, 5]
const DIRECTIONS = 8

export type OverheadReport = { treesChecked: number; shrunk: number; moved: number; toShrubs: number; removed: number; lampsRemoved: number }

const kindOf = (tree: Prop) => tree.kind ?? Math.floor(tree.variation * 997) % TREE_SHAPE_COUNT

function drawnScale(tree: Prop): number {
  const range = tree.kind === PALM ? PALM_SIZE_RANGE : TREE_SIZE_RANGE
  return (1 - range / 2 + tree.variation * range) * (tree.size ?? 1)
}

/** Whether a tree of this size at (x, z) keeps clear of everything overhead. */
function fits(surface: SurfaceMap, x: number, z: number, top: number, reach: number, lean: number): boolean {
  if (surface.isOverhead(x, z)) return false
  const sideways = top * Math.sin(Math.abs(lean))
  const underside = surface.lowestUndersideNear(x, z, reach + sideways + CLEARANCE)
  return top + CLEARANCE <= underside
}

export function clearOverheads(surface: SurfaceMap, props: RoadsideProps, collisions: CollisionWorld): OverheadReport {
  const report: OverheadReport = { treesChecked: 0, shrunk: 0, moved: 0, toShrubs: 0, removed: 0, lampsRemoved: 0 }

  const keptTrees: Prop[] = []
  for (const tree of props.trees) {
    const extent = treeExtent(kindOf(tree))
    const scale = drawnScale(tree)
    const lean = tree.lean ?? 0
    // Quick: nothing overhead anywhere near it, as for nearly every tree.
    if (surface.lowestUndersideNear(tree.x, tree.z, extent.reach * scale + extent.top * scale * Math.sin(Math.abs(lean)) + CLEARANCE) === Infinity) {
      keptTrees.push(tree)
      continue
    }
    report.treesChecked++
    if (fits(surface, tree.x, tree.z, extent.top * scale, extent.reach * scale, lean)) {
      keptTrees.push(tree)
      continue
    }

    // Under the deck itself: a shrub instead, if the ground takes one.
    if (surface.isOverhead(tree.x, tree.z)) {
      removePost(collisions, tree.x, tree.z)
      if (surface.allows(tree.x, tree.z, 'bush')) {
        props.bushes.push({ x: tree.x, z: tree.z, rotation: tree.rotation, variation: tree.variation })
        report.toShrubs++
      } else report.removed++
      continue
    }

    // Beside it: smaller, just enough for the leaves to stay clear, down to SMALLEST.
    let shrunk = false
    for (let share = 0.9; share >= SMALLEST - 1e-6; share -= 0.1) {
      if (fits(surface, tree.x, tree.z, extent.top * scale * share, extent.reach * scale * share, lean)) {
        tree.size = (tree.size ?? 1) * share
        shrunk = true
        break
      }
    }
    if (shrunk) {
      keptTrees.push(tree)
      report.shrunk++
      continue
    }

    // Or a few metres away, upright, where the ground takes a tree and nothing solid is in the way.
    let moved = false
    for (const distance of MOVES) {
      for (let i = 0; i < DIRECTIONS && !moved; i++) {
        const angle = (i / DIRECTIONS) * Math.PI * 2
        const x = tree.x + Math.cos(angle) * distance
        const z = tree.z + Math.sin(angle) * distance
        if (!surface.allows(x, z, 'tree') || !fits(surface, x, z, extent.top * scale, extent.reach * scale, 0)) continue
        removePost(collisions, tree.x, tree.z)
        if (isNearBuilding(collisions, x, z, 0.6)) {
          addPost(collisions, tree.x, tree.z, TREE_TRUNK_RADIUS)
          continue
        }
        addPost(collisions, x, z, TREE_TRUNK_RADIUS)
        tree.x = x
        tree.z = z
        tree.lean = 0
        moved = true
      }
      if (moved) break
    }
    if (moved) {
      keptTrees.push(tree)
      report.moved++
      continue
    }
    removePost(collisions, tree.x, tree.z)
    report.removed++
  }
  props.trees.splice(0, props.trees.length, ...keptTrees)

  // Lamp posts: one whose head would reach a deck, or that stands under one, goes, with its cables.
  const removedLamps = new Set<Prop>()
  for (const lamp of props.lamps) {
    if (surface.isOverhead(lamp.x, lamp.z) || surface.lowestUndersideNear(lamp.x, lamp.z, LAMP.reach + CLEARANCE) < LAMP.top + CLEARANCE) {
      removedLamps.add(lamp)
      removePost(collisions, lamp.x, lamp.z)
    }
  }
  if (removedLamps.size > 0) {
    props.lamps.splice(0, props.lamps.length, ...props.lamps.filter((lamp) => !removedLamps.has(lamp)))
    props.postPairs.splice(0, props.postPairs.length, ...props.postPairs.filter(({ from, to }) => !removedLamps.has(from) && !removedLamps.has(to)))
  }
  report.lampsRemoved = removedLamps.size
  return report
}

/** The view of a landmark from a deck is kept over this long a stretch of it, either side of the nearest point, in metres. */
const VIEW_STRETCH = 90
/** Trees in the view may stand this far above the deck there, in metres: about the barrier's top. */
const VIEW_HEADROOM = 1

/**
 * Keeps the view of a landmark (Agara's statue) from a flyover: trees standing in the wedge between
 * the landmark and the nearest stretch of the deck, tall enough to hide it from a rider up there, are
 * made smaller, down to SMALLEST, or taken out. Returns how many of each.
 */
export function keepViewClear(
  props: RoadsideProps,
  collisions: CollisionWorld,
  landmark: { x: number; z: number },
  deck: { points: [number, number][]; heights: number[]; at: number[] },
): { lowered: number; removed: number } {
  const report = { lowered: 0, removed: 0 }
  let nearest = 0
  let nearestDistance = Infinity
  deck.points.forEach(([x, z], i) => {
    const distance = Math.hypot(x - landmark.x, z - landmark.z)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = i
    }
  })
  let first = nearest
  let last = nearest
  while (first > 0 && deck.at[nearest] - deck.at[first] < VIEW_STRETCH) first--
  while (last < deck.points.length - 1 && deck.at[last] - deck.at[nearest] < VIEW_STRETCH) last++
  const [ax, az] = deck.points[first]
  const [bx, bz] = deck.points[last]
  const deckHeight = Math.min(deck.heights[first], deck.heights[nearest], deck.heights[last])
  // Inside the triangle landmark, a, b: on the same side of each edge.
  const side = (px: number, pz: number, qx: number, qz: number, x: number, z: number) => (qx - px) * (z - pz) - (qz - pz) * (x - px)
  const inWedge = (x: number, z: number) => {
    const d1 = side(landmark.x, landmark.z, ax, az, x, z)
    const d2 = side(ax, az, bx, bz, x, z)
    const d3 = side(bx, bz, landmark.x, landmark.z, x, z)
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
  }
  const kept: Prop[] = []
  for (const tree of props.trees) {
    if (!inWedge(tree.x, tree.z)) {
      kept.push(tree)
      continue
    }
    const top = treeExtent(kindOf(tree)).top * drawnScale(tree)
    const allowed = deckHeight + VIEW_HEADROOM
    if (top <= allowed) kept.push(tree)
    else if (allowed / top >= SMALLEST) {
      tree.size = ((tree.size ?? 1) * allowed) / top
      kept.push(tree)
      report.lowered++
    } else {
      removePost(collisions, tree.x, tree.z)
      report.removed++
    }
  }
  props.trees.splice(0, props.trees.length, ...kept)
  return report
}
