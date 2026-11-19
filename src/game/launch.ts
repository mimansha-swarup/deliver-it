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
  streetEdges: 'Street edges',
  restrictedWall: 'The military wall',
  sites: 'Building sites',
  markings: 'Road markings',
  roadFeatures: 'Speed breakers and potholes',
  buildings: 'Buildings',
  houses: 'Balconies and gates',
  stilts: 'Stilt parking',
  hoardings: 'Hoardings',
  cityKit: 'Street details',
  darkStore: 'The dark store',
  props: 'Trees and lamps',
  streetLife: 'Street life',
  story: 'Dogs, chairs and clutter',
  cityLandmarks: 'The lake, the metro and bus shelters',
  cables: 'Cables',
  shops: 'Shops',
  landmarks: 'Shop signs',
  shopPeople: 'Shopkeepers and customers',
  fuel: 'Petrol bunks',
  pitches: 'Sports pitches',
  transit: 'The metro, flyovers and bus stands',
  temples: 'Temples, mosques and churches',
  fences: 'Walls, fences and railings',
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
  /**
   * Streamed parts still building the map squares right around the rider. The ride waits for
   * them behind the loading screen, so riding doesn't start with a run of long frames.
   */
  nearWaiting: string[]
  /**
   * Everything built has been drawn once, behind the loading screen, with nothing culled: every
   * shader (shadow ones too), geometry and texture is on the GPU before riding (Prewarm in World.tsx).
   */
  warmed: boolean
}

/** How far along getting from the title screen to riding is. Nothing here is saved. */
export const useLaunch = create<Launch>(() => ({ requested: false, curtainDrawn: false, planned: false, built: [], nearWaiting: [], warmed: false }))

/** A streamed part says whether it's still building squares around the rider (see `nearWaiting`). */
export function setNearWaiting(id: string, waiting: boolean) {
  const { nearWaiting } = useLaunch.getState()
  if (waiting === nearWaiting.includes(id)) return
  useLaunch.setState({ nearWaiting: waiting ? [...nearWaiting, id] : nearWaiting.filter((other) => other !== id) })
}

/**
 * Milliseconds a frame may spend on squares right around the rider: plenty behind the loading
 * screen, where nobody sees a slow frame, and a share of one frame once riding.
 */
export const NEAR_BUDGET = { loading: 60, riding: 8 }

export function markPartBuilt(part: WorldPart) {
  const { built } = useLaunch.getState()
  if (!built.includes(part)) useLaunch.setState({ built: [...built, part] })
}
