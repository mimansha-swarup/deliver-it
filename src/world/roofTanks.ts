import { FLOOR_HEIGHT, getFloors, hashString } from './buildingData'
import type { BuildingFeature } from './mapData'
import type { Prop } from './props'
import { isInsideOutline, isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/** Share of buildings with water tanks, out of 100. */
const TANK_CHANCE = 75
/** Every point this far around a tank's middle must be on the roof, in metres. */
const TANK_SPACE = 0.9
const SECOND_TANK_GAP = 1.8

function fitsOnRoof(outline: GroundPoint[], x: number, z: number): boolean {
  return (
    isInsideOutline(outline, x + TANK_SPACE, z) &&
    isInsideOutline(outline, x - TANK_SPACE, z) &&
    isInsideOutline(outline, x, z + TANK_SPACE) &&
    isInsideOutline(outline, x, z - TANK_SPACE)
  )
}

/** Puts black plastic tanks on most roofs. Offices don't get them, and houses and shops get theirs from the house kit. */
export function generateRoofTanks(buildings: BuildingFeature[]): Prop[] {
  const tanks: Prop[] = []

  for (const building of buildings) {
    const ring = building.geometry.coordinates[0]
    // Houses and shops get theirs from the house kit, on top of the staircase room.
    if (!isRingInPlayArea(ring) || building.kind === 'office' || building.kind === 'house' || building.kind === 'shop' || building.kind === 'apartment') continue

    const hash = hashString(building.id)
    if (hash % 100 >= TANK_CHANCE) continue

    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    const centreX = outline.reduce((sum, [x]) => sum + x, 0) / outline.length
    const centreZ = outline.reduce((sum, [, z]) => sum + z, 0) / outline.length

    // Set a little off the middle, so that they don't all line up.
    const angle = ((hash >>> 7) % 628) / 100
    const x = centreX + Math.cos(angle) * 1.5
    const z = centreZ + Math.sin(angle) * 1.5
    if (!fitsOnRoof(outline, x, z)) continue

    const y = getFloors(building) * FLOOR_HEIGHT
    const variation = ((hash >>> 16) % 1000) / 1000
    tanks.push({ x, y, z, rotation: angle, variation })

    const secondX = x + Math.cos(angle + 1.6) * SECOND_TANK_GAP
    const secondZ = z + Math.sin(angle + 1.6) * SECOND_TANK_GAP
    if (hash % 3 === 0 && fitsOnRoof(outline, secondX, secondZ)) {
      tanks.push({ x: secondX, y, z: secondZ, rotation: angle, variation })
    }
  }

  return tanks
}
