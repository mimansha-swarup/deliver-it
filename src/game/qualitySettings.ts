export type Quality = 'low' | 'medium' | 'high'

/** How much surface texture to draw: none, colour only, or colour with bumps. */
export type SurfaceDetail = 'plain' | 'color' | 'bumps'

/** How much of the city kit to draw: planters, then cornices and doors, then whole walls. */
export type KitDetail = 0 | 1 | 2

type QualityPreset = {
  label: string
  /** Rendering resolution, as [lowest, highest] pixels per screen point. */
  pixelRatio: [number, number]
  /** Sun shadow detail in pixels, or 0 for no shadows. */
  shadowSize: number
  windows: boolean
  surfaces: SurfaceDetail
  kitDetail: KitDetail
  treeShadows: boolean
  /** How far you can see. Map squares further away aren't drawn, in metres. */
  drawDistance: number
  /** Trees and lamps further from the rider than this aren't drawn, in metres. */
  propDistance: number
  /** Whether the sky draws clouds. They're the costliest part of it. */
  skyClouds: boolean
  rainDrops: number
  /** Whether trees use photographed leaves, or the simple solid shapes. */
  leafyTrees: boolean
  /** Tufts of grass around the rider. */
  grassTufts: number
  vehicles: number
  pedestrians: number
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatio: [0.75, 0.75],
    shadowSize: 0,
    windows: false,
    surfaces: 'plain',
    kitDetail: 0,
    treeShadows: false,
    drawDistance: 280,
    propDistance: 140,
    skyClouds: false,
    rainDrops: 300,
    leafyTrees: false,
    grassTufts: 0,
    vehicles: 6,
    pedestrians: 10,
  },
  medium: {
    label: 'Medium',
    pixelRatio: [1, 1.25],
    shadowSize: 2048,
    windows: true,
    surfaces: 'color',
    kitDetail: 1,
    treeShadows: false,
    drawDistance: 400,
    propDistance: 200,
    skyClouds: true,
    rainDrops: 700,
    leafyTrees: true,
    grassTufts: 1400,
    vehicles: 12,
    pedestrians: 22,
  },
  high: {
    label: 'High',
    pixelRatio: [1, 2],
    shadowSize: 4096,
    windows: true,
    surfaces: 'bumps',
    kitDetail: 2,
    treeShadows: true,
    drawDistance: 520,
    propDistance: 260,
    skyClouds: true,
    rainDrops: 1400,
    leafyTrees: true,
    grassTufts: 3200,
    vehicles: 18,
    pedestrians: 36,
  },
}

export const QUALITY_LEVELS: Quality[] = ['low', 'medium', 'high']
