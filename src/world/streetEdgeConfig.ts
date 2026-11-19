import type { LineFeature } from './mapData'
import { ROAD_HEIGHT } from './surface'
import { streetPresetOf } from './streetPresets'

/**
 * Roads drawn with the new ground (ART_DIRECTION.md): raised kerbs with
 * rounded corners, footpaths level with the kerb top, pavers, dust and decals.
 * Every road with a street preset has it (streetPresets.ts); service roads and
 * tracks keep the plain ground.
 */
export function usesNewGround(road: LineFeature): boolean {
  return streetPresetOf(road) !== null
}

/** Sizes and heights, in metres. Heights are above the soil (y = 0); the road is at ROAD_HEIGHT. */
export const STREET = {
  /** The kerb stands this far above the road, with its top edge bevelled on the road side. */
  kerbRise: 0.15,
  kerbWidth: 0.2,
  kerbBevel: 0.04,
  /** Painted kerbs alternate black and yellow in blocks this long. */
  kerbBlock: 1,
  /** In front of a gate the kerb is lowered to this, so vehicles can cross. */
  droppedRise: 0.04,
  /** The footpath runs out from the road edge this far, and the edge stone along its far side is this wide. */
  footpath: 3,
  edgeStone: 0.12,
  /** The edge stone stands this far above the footpath. */
  edgeStoneRise: 0.012,
  /** Junction corners are rounded with this radius, measured at the road edge. */
  // Wide enough to turn into a residential street without riding the kerb.
  cornerRadius: 5,
  /** The dusty strip on the soil beside the footpath. */
  dustWidth: 0.9,
  /** A square tree pit, this wide, with an edge-stone frame. */
  treePit: 1.1,
  pitFrame: 0.08,
}

/** The top of the kerb, and of the footpath, which is level with it. */
export const KERB_TOP = ROAD_HEIGHT + STREET.kerbRise
export const FOOTPATH_TOP = KERB_TOP

/** The asphalt's marks share one picture, this many across and down (createDecalAtlas in groundTextures.ts). */
export const DECAL_COLUMNS = 4
export const DECAL_ROWS = 2
