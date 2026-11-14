import { create } from 'zustand'

/**
 * The parts of the world, in the order World draws them, each with the name the
 * loading screen shows while it's being built.
 */
export const WORLD_PARTS = {
  sky: 'Sky',
  lighting: 'Sunlight',
  ground: 'Ground',
  parks: 'Parks',
  grass: 'Grass',
  roads: 'Roads',
  kerbs: 'Kerbs',
  restrictedWall: 'The military wall',
  sites: 'Building sites',
  markings: 'Road markings',
  buildings: 'Buildings',
  houses: 'Balconies and gates',
  stilts: 'Stilt parking',
  cityKit: 'Street details',
  darkStore: 'The dark store',
  props: 'Trees and lamps',
  streetLife: 'Street life',
  cables: 'Cables',
  shops: 'Shops',
  boundary: 'The edge of the map',
  player: 'Your scooter and the traffic',
} as const

export type WorldPart = keyof typeof WORLD_PARTS

export const WORLD_PART_COUNT = Object.keys(WORLD_PARTS).length

type Launch = {
  /** Play was pressed, so the loading screen is up. */
  requested: boolean
  /**
   * The loading screen has been painted. Building the world keeps the page busy
   * for seconds at a time, so it waits for this, or the title would freeze
   * instead of the loading screen showing.
   */
  curtainDrawn: boolean
  /** Everything has been placed: roads, houses, trees, traffic lanes. */
  planned: boolean
  /** The parts that are on screen, newest last. */
  built: WorldPart[]
}

/** How far along getting from the title screen to riding is. Nothing here is saved. */
export const useLaunch = create<Launch>(() => ({ requested: false, curtainDrawn: false, planned: false, built: [] }))

export function markPartBuilt(part: WorldPart) {
  const { built } = useLaunch.getState()
  if (!built.includes(part)) useLaunch.setState({ built: [...built, part] })
}
