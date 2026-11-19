/**
 * Landmarks marked on the minimap and the full map: a dot and a name each. The world fills this in as
 * it's built (World.tsx), before the maps are first drawn.
 */
export type MapMarker = { x: number; z: number; text: string; color: string }

export const mapMarkers: { list: MapMarker[] } = { list: [] }
