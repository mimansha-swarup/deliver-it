import { addPost, isNearBuilding, type CollisionWorld } from './collision'
import type { Gate } from './houseKit'
import type { LineFeature } from './mapData'
import { createRandom, nearestRoadPiece, PointGrid, type Prop, type RoadIndex, type RoadsideProps } from './props'
import type { ShopFront } from './shopFrontPlacement'
import { streetPresetOf } from './streetPresets'
import { surfaceAllows, type Placement } from './surfaceMap'
import { PAVEMENT_WIDTH } from './surface'
import { isInsideBounds } from './worldUtils'

/*
 * The small things that tell a street's story (ART_DIRECTION.md: real clutter): stray dogs
 * asleep on the footpath, now and then a cow, plastic chairs and flower pots outside shops,
 * garbage piled on a corner, a cycle against a compound wall, the morning's newspapers at a
 * gate, a transformer on a pole and coils of spare cable hung on the lamp posts. All seeded, so
 * a street is the same on every visit, all checked on the surface map (surfaceMap.ts) and kept
 * clear of what's already there, and all drawn as instanced shapes (StoryProps.tsx).
 */

export type StoryKind = 'dog' | 'cow' | 'chairs' | 'pots' | 'garbage' | 'cycle' | 'newspapers' | 'transformer' | 'cable'
export const STORY_KINDS: StoryKind[] = ['dog', 'cow', 'chairs', 'pots', 'garbage', 'cycle', 'newspapers', 'transformer', 'cable']
export type StoryProps = Record<StoryKind, Prop[]> & {
  /** The plants in the pots, as small leafy bushes standing on the pots' soil (drawn with the hedges). */
  potPlants: Prop[]
}

/** Where each pot of a cluster stands in its frame (StoryProps.tsx draws them), its soil's height, and its plant: one or two leafy clumps. */
export const POT_SPOTS: { at: [number, number]; top: number; plants: { rise: number; size: number }[] }[] = [
  // A tall plant in the big pot: two clumps, one above the other.
  { at: [0, 0], top: 0.43, plants: [{ rise: 0.38, size: 0.34 }, { rise: 0.78, size: 0.27 }] },
  { at: [0.48, 0.12], top: 0.32, plants: [{ rise: 0.26, size: 0.3 }] },
  { at: [0.22, 0.38], top: 0.22, plants: [{ rise: 0.17, size: 0.2 }] },
]

/** The plants for a cluster of pots at (x, z) turned by `rotation`, turned with it (as PropInstances turns it about y). */
export function addPotPlants(story: StoryProps, x: number, z: number, rotation: number, random: () => number) {
  for (const { at: [px, pz], plants } of POT_SPOTS) {
    const plantX = x + px * Math.cos(rotation) + pz * Math.sin(rotation)
    const plantZ = z - px * Math.sin(rotation) + pz * Math.cos(rotation)
    for (const { rise, size } of plants) story.potPlants.push({ x: plantX, z: plantZ, rise, size, rotation: random() * Math.PI * 2, variation: random() })
  }
}

/** The salon's pot by its door (shopFrontKit.ts): across the front as a share of its width, out from it, and its plant. */
const SALON_POT = { across: 0.4, out: 0.3, plants: [{ rise: 0.3, size: 0.3 }, { rise: 0.62, size: 0.24 }] }

/** Shares and spacings. */
const STORY = {
  /** A dog (or two) every this many metres of road, on this share of chances. */
  dogEvery: 60,
  dogChance: 0.4,
  /** A cow every this many metres of residential or main road, on this share of chances. */
  cowEvery: 450,
  cowChance: 0.35,
  /** Shares of shop fronts with plastic chairs out front, and with pots by the door. */
  chairs: 0.14,
  pots: 0.16,
  /** On shop streets more fronts have pots (27th Main's shopkeepers keep a palm or two by the door), sometimes at both ends. */
  shopStreetPots: 0.45,
  bothEnds: 0.35,
  /** A garbage pile every this many metres of road, on this share. */
  garbageEvery: 140,
  garbageChance: 0.45,
  /** Shares of house gates with a cycle against the wall, and with the newspapers at the gate. */
  cycle: 0.1,
  newspapers: 0.3,
  /** Shares of lamp posts with a transformer beside them, and with a coil of cable. */
  transformer: 0.05,
  cable: 0.22,
}

/** Out across the footpath from the road's edge, as a share of the footpath's width: near the wall, where things are left. */
const BY_THE_WALL = 0.78

export function placeStoryProps({
  roads,
  index,
  collisions,
  props,
  shopFronts,
  gates,
}: {
  roads: LineFeature[]
  index: RoadIndex
  collisions: CollisionWorld
  props: RoadsideProps
  shopFronts: ShopFront[]
  gates: Gate[]
}): { story: StoryProps; refused: number } {
  const random = createRandom(20261118)
  const story: StoryProps = { dog: [], cow: [], chairs: [], pots: [], garbage: [], cycle: [], newspapers: [], transformer: [], cable: [], potPlants: [] }
  const taken = new PointGrid(4)
  for (const { x, z } of [...props.trees, ...props.lamps, ...props.parkedScooters]) taken.add(x, z)
  let refused = 0

  /** Whether a thing of this size fits here: the ground allows it, it's off the road and out of walls and other things. */
  const fits = (x: number, z: number, radius: number, what: Placement) => {
    const ok = isInsideBounds(x, z, 4) && surfaceAllows(x, z, what) && !isNearBuilding(collisions, x, z, radius) && !taken.hasWithin(x, z, radius + 0.6)
    if (!ok) refused++
    return ok
  }
  const put = (kind: StoryKind, prop: Prop, solid = 0) => {
    story[kind].push(prop)
    taken.add(prop.x, prop.z)
    if (solid > 0) addPost(collisions, prop.x, prop.z, solid)
  }

  // ---- Along the roads: dogs, cows, garbage ----
  let dogDue = random() * STORY.dogEvery
  let cowDue = random() * STORY.cowEvery
  let garbageDue = random() * STORY.garbageEvery
  for (const piece of index.pieces) {
    const preset = streetPresetOf(roads[piece.road])
    if (!preset) continue
    const length = Math.hypot(piece.end[0] - piece.start[0], piece.end[1] - piece.start[1])
    if (length < 1) continue
    const alongX = (piece.end[0] - piece.start[0]) / length
    const alongZ = (piece.end[1] - piece.start[1]) / length
    const footpath = preset.footpath || PAVEMENT_WIDTH
    const at = (along: number, out: number, side: number) => ({
      x: piece.start[0] + alongX * along + alongZ * out * side,
      z: piece.start[1] + alongZ * along - alongX * out * side,
    })
    const facing = (side: number) => Math.atan2(alongX, alongZ) + (side > 0 ? 0 : Math.PI)

    for (let along = 0; along < length; along += 1) {
      dogDue -= 1
      cowDue -= 1
      garbageDue -= 1
      const side = random() < 0.5 ? 1 : -1
      if (dogDue <= 0) {
        dogDue = STORY.dogEvery * (0.6 + random() * 0.8)
        if (random() < STORY.dogChance) {
          const count = random() < 0.3 ? 2 : 1
          for (let dog = 0; dog < count; dog++) {
            const spot = at(along + dog * 1.4, piece.width / 2 + footpath * (BY_THE_WALL - 0.15 * dog), side)
            if (fits(spot.x, spot.z, 0.5, 'pedestrian')) put('dog', { ...spot, rotation: facing(side) + Math.PI / 2 + (random() - 0.5) * 1.2, variation: random() })
          }
        }
      }
      if (cowDue <= 0 && (preset.name === 'residential' || preset.name === 'main')) {
        cowDue = STORY.cowEvery * (0.6 + random() * 0.8)
        if (random() < STORY.cowChance) {
          // At the kerb, grazing on whatever's there, half on the footpath.
          const spot = at(along, piece.width / 2 + Math.min(footpath, 2) * 0.5 + 0.2, side)
          if (fits(spot.x, spot.z, 0.9, 'pedestrian')) put('cow', { ...spot, rotation: facing(side) + Math.PI / 2 + (random() - 0.5) * 0.5, variation: random() }, 0.8)
        }
      }
      if (garbageDue <= 0) {
        garbageDue = STORY.garbageEvery * (0.6 + random() * 0.8)
        if (random() < STORY.garbageChance) {
          // Just past the footpath where there's open ground, or at its back by a wall.
          const behind = at(along, piece.width / 2 + footpath + 1.2, side)
          const spot = surfaceAllows(behind.x, behind.z, 'prop') && !isNearBuilding(collisions, behind.x, behind.z, 0.9) ? behind : at(along, piece.width / 2 + footpath * BY_THE_WALL, side)
          if (fits(spot.x, spot.z, 0.7, 'prop')) put('garbage', { ...spot, rotation: random() * Math.PI * 2, variation: random(), size: 0.8 + random() * 0.5 })
        }
      }
    }
  }

  // ---- Outside shops: plastic chairs and flower pots ----
  for (const front of shopFronts) {
    const outX = Math.sin(front.rotation)
    const outZ = Math.cos(front.rotation)
    if (front.type === 'salon') {
      // The salon's pot by the door (shopFrontKit.ts): its plant.
      const side = front.variation < 0.5 ? 1 : -1
      const across = side * front.width * SALON_POT.across
      const x = front.x + Math.cos(front.rotation) * across + outX * SALON_POT.out
      const z = front.z - Math.sin(front.rotation) * across + outZ * SALON_POT.out
      for (const { rise, size } of SALON_POT.plants) story.potPlants.push({ x, z, rise, size, rotation: random() * Math.PI * 2, variation: random() })
    }
    const near = nearestRoadPiece(index, front.x, front.z, 12)
    const onShopStreet = near ? streetPresetOf(roads[near.piece.road])?.name === 'shop' : false
    const potShare = onShopStreet ? STORY.shopStreetPots : STORY.pots
    const roll = random()
    if (roll < STORY.chairs) {
      const across = (random() - 0.5) * front.width * 0.6
      const x = front.x + outX * 1.3 + outZ * across
      const z = front.z + outZ * 1.3 - outX * across
      if (fits(x, z, 0.5, 'prop')) put('chairs', { x, z, rotation: front.rotation + (random() - 0.5) * 0.8, variation: random() })
    } else if (roll < STORY.chairs + potShare) {
      // At an end of the front, by the wall: beside the shutter, under the board rather than in front of it.
      const first = random() < 0.5 ? 1 : -1
      const ends = random() < STORY.bothEnds ? [first, -first] : [first]
      for (const end of ends) {
        const across = (front.width / 2 - 0.45) * end
        const x = front.x + outX * 0.55 + outZ * across
        const z = front.z + outZ * 0.55 - outX * across
        // Mirrored at the other end, so the palm stands at the outside.
        const rotation = front.rotation + (end > 0 ? Math.PI : 0)
        if (!fits(x, z, 0.4, 'prop')) continue
        put('pots', { x, z, rotation, variation: random() })
        addPotPlants(story, x, z, rotation, random)
      }
    }
  }

  // ---- At house gates: a cycle against the wall, the newspapers ----
  for (const gate of gates) {
    if (!gate.house) continue
    const near = nearestRoadPiece(index, gate.x, gate.z, 15)
    if (!near) continue
    const { start, end } = near.piece
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const alongX = (end[0] - start[0]) / length
    const alongZ = (end[1] - start[1]) / length
    // Towards the road from the gate.
    const t = (gate.x - start[0]) * alongX + (gate.z - start[1]) * alongZ
    let toRoadX = start[0] + alongX * t - gate.x
    let toRoadZ = start[1] + alongZ * t - gate.z
    const away = Math.hypot(toRoadX, toRoadZ) || 1
    toRoadX /= away
    toRoadZ /= away
    const roll = random()
    if (roll < STORY.cycle) {
      // Leaning on the wall beside the gate, on the street side.
      const side = random() < 0.5 ? 1 : -1
      const x = gate.x + toRoadX * 0.35 + alongX * (gate.width / 2 + 1.2) * side
      const z = gate.z + toRoadZ * 0.35 + alongZ * (gate.width / 2 + 1.2) * side
      // Drawn lengthways along its own x, so turning its +z to the wall and leaning tips it onto the wall.
      if (fits(x, z, 0.2, 'footpathBike')) put('cycle', { x, z, rotation: Math.atan2(-toRoadX, -toRoadZ), variation: random(), lean: 0.22 })
    } else if (roll < STORY.cycle + STORY.newspapers) {
      const x = gate.x + toRoadX * 0.45 + alongX * (random() - 0.5)
      const z = gate.z + toRoadZ * 0.45 + alongZ * (random() - 0.5)
      if (fits(x, z, 0.05, 'pedestrian')) put('newspapers', { x, z, rotation: random() * Math.PI * 2, variation: random() })
    }
  }

  // ---- On the lamp posts: a transformer beside some, spare cable coiled on others ----
  for (const lamp of props.lamps) {
    const roll = random()
    if (roll < STORY.transformer) {
      // Its own two poles a step along the footpath from the lamp, the lamp's way round.
      const alongX = Math.cos(lamp.rotation)
      const alongZ = -Math.sin(lamp.rotation)
      const x = lamp.x + alongX * 1.6
      const z = lamp.z + alongZ * 1.6
      if (surfaceAllows(x, z, 'pole') && !isNearBuilding(collisions, x, z, 0.6) && !taken.hasWithin(x, z, 1.2)) put('transformer', { x, z, rotation: lamp.rotation, variation: random() }, 0.35)
      else refused++
    } else if (roll < STORY.transformer + STORY.cable) {
      story.cable.push({ x: lamp.x, z: lamp.z, rotation: random() * Math.PI * 2, variation: random() })
    }
  }

  return { story, refused }
}
