/*
 * What kind of place the rider is in, for the sounds that belong to places (audio/areaSounds.ts):
 * how near a signal junction, a run of shops, a temple, water, a vendor's cart, and what kind of
 * street it is. The world fills the lists in as it's planned (World.tsx); until then, nothing sounds.
 */

type Spot = { x: number; z: number }

/** A grid of spots, so "what's near here" looks at a few squares rather than thousands of spots. */
class SpotGrid {
  private cells = new Map<number, Spot[]>()
  private readonly size: number
  constructor(size: number, spots: Spot[] = []) {
    this.size = size
    for (const spot of spots) this.add(spot)
  }
  private key(cx: number, cz: number) {
    return cx * 100003 + cz
  }
  add(spot: Spot) {
    const key = this.key(Math.floor(spot.x / this.size), Math.floor(spot.z / this.size))
    const cell = this.cells.get(key)
    if (cell) cell.push(spot)
    else this.cells.set(key, [spot])
  }
  /** The nearest spot within `reach`, as its distance, and how many are within it. */
  near(x: number, z: number, reach: number): { distance: number; count: number } {
    const span = Math.ceil(reach / this.size)
    const cx = Math.floor(x / this.size)
    const cz = Math.floor(z / this.size)
    let distance = Infinity
    let count = 0
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        for (const spot of this.cells.get(this.key(cx + dx, cz + dz)) ?? []) {
          const away = Math.hypot(spot.x - x, spot.z - z)
          if (away > reach) continue
          count++
          if (away < distance) distance = away
        }
      }
    }
    return { distance, count }
  }
}

export type StreetKind = 'main' | 'shop' | 'residential' | null

const places = {
  signals: new SpotGrid(80),
  shops: new SpotGrid(60),
  temples: new SpotGrid(120),
  vendors: new SpotGrid(60),
  water: [] as (Spot & { reach: number })[],
  streetAt: (() => null) as (x: number, z: number) => StreetKind,
}

export function setAreas(found: { signals: Spot[]; shops: Spot[]; temples: Spot[]; vendors: Spot[]; water: (Spot & { reach: number })[]; streetAt: (x: number, z: number) => StreetKind }) {
  places.signals = new SpotGrid(80, found.signals)
  places.shops = new SpotGrid(60, found.shops)
  places.temples = new SpotGrid(120, found.temples)
  places.vendors = new SpotGrid(60, found.vendors)
  places.water = found.water
  places.streetAt = found.streetAt
}

/** Each from 0 (nowhere near) to 1 (right there). `street`: the kind of street underfoot, or null off any. */
export type Area = { junction: number; shops: number; temple: number; water: number; vendor: number; street: StreetKind }

const REACH = { junction: 95, shops: 55, temple: 130, vendor: 42, waterBeyond: 90 }
/** This many shop fronts within reach is a proper shop street. */
const SHOPS_FULL = 9

export function areaAt(x: number, z: number): Area {
  const nearness = (grid: SpotGrid, reach: number) => {
    const { distance } = grid.near(x, z, reach)
    return distance === Infinity ? 0 : 1 - distance / reach
  }
  let water = 0
  for (const lake of places.water) water = Math.max(water, 1 - Math.max(0, Math.hypot(lake.x - x, lake.z - z) - lake.reach) / REACH.waterBeyond)
  return {
    junction: nearness(places.signals, REACH.junction),
    shops: Math.min(1, places.shops.near(x, z, REACH.shops).count / SHOPS_FULL),
    temple: nearness(places.temples, REACH.temple),
    water: Math.max(0, water),
    vendor: nearness(places.vendors, REACH.vendor),
    street: places.streetAt(x, z),
  }
}
