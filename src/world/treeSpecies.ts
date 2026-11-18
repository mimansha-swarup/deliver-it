import { surfaceAllows } from './surfaceMap'
import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import { PALM, TREE_SHAPE } from './foliage'
import { isClearOfRoads, nearestRoadPiece, scramble, type Prop, type RoadIndex } from './props'
import type { WorshipSite } from './worship'

/*
 * HSR's trees, by species (ART_DIRECTION.md: realistic colours, foliage simplified to clusters).
 * Each has a canopy shape (foliage.ts), a size range, a colour when green and, if it flowers, its
 * flower colour (CANOPY_HEX in props.ts), and how far it leans. Avenues are planted a species at
 * a time, by road (props.ts); the rest are placed by where they grow: coconut palms, ashokas and
 * neems inside house compounds, a peepal or banyan by each temple, and a big tree on some
 * junction corners. Every tree also gets its own size, turn, lean and shade.
 */

/** Size ranges are modest: the drawing adds its own ±25% from `variation` (sizeRange in RoadsideProps.tsx). */
export type Species = {
  shape: number
  /** Its size against an ordinary tree: [smallest, largest]. */
  size: [number, number]
  /** Its leaves' colour (CANOPY_HEX index), or left out for any of the greens. */
  green?: number
  /** Its flowers' colour (CANOPY_HEX index), and the share of trees in flower, 0 to 1. */
  bloom?: number
  bloomShare?: number
  /** How far it leans from upright, in radians: [least, most]. */
  lean: [number, number]
}

/** Flower colours, as CANOPY_HEX in props.ts lists them. */
const BLOOM = { gulmohar: 8, yellow: 9, pink: 10, jacaranda: 11, copperPod: 12 }
/** Particular greens from CANOPY_HEX: neem's is dark, peepal's light. */
const GREEN = { dark: 6, light: 5, deep: 2 }

export const SPECIES = {
  rainTree: { shape: TREE_SHAPE.umbrella, size: [1.05, 1.25], lean: [0, 0.04] },
  gulmohar: { shape: TREE_SHAPE.umbrella, size: [0.9, 1.05], bloom: BLOOM.gulmohar, bloomShare: 0.75, lean: [0, 0.06] },
  jacaranda: { shape: TREE_SHAPE.tall, size: [1.0, 1.2], bloom: BLOOM.jacaranda, bloomShare: 0.7, lean: [0, 0.05] },
  tabebuiaPink: { shape: TREE_SHAPE.round, size: [0.95, 1.15], bloom: BLOOM.pink, bloomShare: 0.75, lean: [0, 0.05] },
  tabebuiaYellow: { shape: TREE_SHAPE.round, size: [0.9, 1.1], bloom: BLOOM.yellow, bloomShare: 0.75, lean: [0, 0.05] },
  copperPod: { shape: TREE_SHAPE.wide, size: [0.95, 1.1], bloom: BLOOM.copperPod, bloomShare: 0.6, lean: [0, 0.05] },
  neem: { shape: TREE_SHAPE.round, size: [0.85, 1.1], green: GREEN.dark, lean: [0.02, 0.08] },
  ashoka: { shape: TREE_SHAPE.column, size: [0.9, 1.15], green: GREEN.deep, lean: [0, 0.02] },
  coconut: { shape: PALM, size: [0.85, 1.15], lean: [0.05, 0.18] },
  banyan: { shape: TREE_SHAPE.dome, size: [1.2, 1.4], green: GREEN.deep, lean: [0, 0.02] },
  peepal: { shape: TREE_SHAPE.dome, size: [1.05, 1.2], green: GREEN.light, lean: [0, 0.03] },
} satisfies Record<string, Species>

export type SpeciesName = keyof typeof SPECIES

/** Avenue plantings, chosen by road (props.ts): mostly shade trees, many in flower. */
export const AVENUE_SPECIES: SpeciesName[] = ['rainTree', 'rainTree', 'neem', 'gulmohar', 'gulmohar', 'jacaranda', 'tabebuiaPink', 'tabebuiaYellow', 'copperPod', 'neem']
/** Park trees: a mix, any of these. */
export const PARK_SPECIES: SpeciesName[] = ['rainTree', 'neem', 'peepal', 'tabebuiaPink', 'gulmohar', 'copperPod', 'coconut', 'neem']
/** Inside a house's compound wall. */
const COMPOUND_SPECIES: SpeciesName[] = ['coconut', 'coconut', 'ashoka', 'neem']

/** Greens to pick from for a species with no green of its own (the first 8 of CANOPY_HEX). */
const GREENS = 8

/**
 * A tree of `species` at a spot, its size, lean, flowering and shade chosen from `seed`, so the
 * same tree comes out the same on every visit.
 */
export function plantTree(species: Species, spot: { x: number; z: number }, seed: number, sizeScale = 1): Prop {
  const mix = (salt: number) => (scramble(seed * 31 + salt) % 10000) / 10000
  const blooms = species.bloom !== undefined && mix(1) < (species.bloomShare ?? 0)
  const tint = blooms ? species.bloom : species.green ?? Math.floor(mix(2) * GREENS)
  const [small, large] = species.size
  const [least, most] = species.lean
  return {
    x: spot.x,
    z: spot.z,
    rotation: mix(3) * Math.PI * 2,
    // Size comes from `size`; `variation` only shades it (see PropInstances in RoadsideProps.tsx).
    variation: mix(4),
    tint,
    kind: species.shape,
    size: (small + (large - small) * mix(5)) * sizeScale,
    lean: least + (most - least) * mix(6),
  }
}

/** How far a compound tree stands inside the wall, and to one side of the gate, in metres. */
const COMPOUND_IN = 1.8
const COMPOUND_ASIDE = 2.6
/** Shares of gates with a tree behind them, and of junctions with a big tree on a corner. */
const COMPOUND_SHARE = 0.35
const JUNCTION_SHARE = 0.2
/** A temple's tree stands this far out to the side of its front corner, in metres. */
const TEMPLE_TREE_OUT = 5

/**
 * Trees placed by where they grow, made solid as they're placed so nothing is put through them:
 * behind compound gates, beside temples, and on junction corners.
 */
export function plantContextTrees({
  gates,
  temples,
  junctions,
  roads,
  collisions,
}: {
  gates: { x: number; z: number }[]
  temples: WorshipSite[]
  junctions: { x: number; z: number; reach: number }[]
  roads: RoadIndex
  collisions: CollisionWorld
}): Prop[] {
  const trees: Prop[] = []
  const tryPlant = (species: Species, x: number, z: number, seed: number, room: number) => {
    if (!surfaceAllows(x, z, 'tree') || isNearBuilding(collisions, x, z, room) || !isClearOfRoads(roads, x, z, 1.5)) return false
    trees.push(plantTree(species, { x, z }, seed))
    addPost(collisions, x, z, 0.3)
    return true
  }

  // Behind a compound gate: inward is away from the road the gate opens onto.
  gates.forEach((gate, index) => {
    const seed = scramble(Math.round(gate.x * 13) ^ Math.round(gate.z * 7))
    if ((seed % 1000) / 1000 > COMPOUND_SHARE) return
    const near = nearestRoadPiece(roads, gate.x, gate.z, 15)
    if (!near) return
    const { start, end } = near.piece
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const along: [number, number] = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
    // The road's nearest point, and from there to the gate is outward from the road.
    const t = Math.max(0, Math.min(length, (gate.x - start[0]) * along[0] + (gate.z - start[1]) * along[1]))
    const awayX = gate.x - (start[0] + along[0] * t)
    const awayZ = gate.z - (start[1] + along[1] * t)
    const away = Math.hypot(awayX, awayZ) || 1
    const side = (seed >>> 10) % 2 === 0 ? 1 : -1
    const x = gate.x + (awayX / away) * COMPOUND_IN + along[0] * COMPOUND_ASIDE * side
    const z = gate.z + (awayZ / away) * COMPOUND_IN + along[1] * COMPOUND_ASIDE * side
    const species = SPECIES[COMPOUND_SPECIES[(seed >>> 14) % COMPOUND_SPECIES.length]]
    tryPlant(species, x, z, index * 7 + 1, 0.8)
  })

  // A peepal or banyan beside each temple: out to one side of its front, where there's room.
  temples.forEach((temple, index) => {
    if ((temple.faith !== 'hindu' && temple.faith !== 'kalinga') || temple.outline.length === 0) return
    const xs = temple.outline.map((p) => p[0])
    const zs = temple.outline.map((p) => p[1])
    const middleX = (Math.min(...xs) + Math.max(...xs)) / 2
    const middleZ = (Math.min(...zs) + Math.max(...zs)) / 2
    const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2
    const [frontX, frontZ] = temple.front
    const species = SPECIES[index % 2 === 0 ? 'peepal' : 'banyan']
    for (const side of [1, -1]) {
      const x = middleX + frontX * reach * 0.6 + -frontZ * (reach + TEMPLE_TREE_OUT) * side
      const z = middleZ + frontZ * reach * 0.6 + frontX * (reach + TEMPLE_TREE_OUT) * side
      if (tryPlant(species, x, z, index * 11 + 3, 2.5)) break
    }
  })

  // A big rain tree or banyan on a corner of some junctions.
  junctions.forEach((junction, index) => {
    const seed = scramble(Math.round(junction.x * 3) ^ Math.round(junction.z * 5))
    if ((seed % 1000) / 1000 > JUNCTION_SHARE) return
    const turn = ((seed >>> 10) % 4) * (Math.PI / 2) + Math.PI / 4
    const out = junction.reach + 4
    const species = SPECIES[(seed >>> 13) % 3 === 0 ? 'banyan' : 'rainTree']
    tryPlant(species, junction.x + Math.cos(turn) * out, junction.z + Math.sin(turn) * out, index * 5 + 2, 2.5)
  })

  return trees
}
