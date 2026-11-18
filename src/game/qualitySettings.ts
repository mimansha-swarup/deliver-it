export type Quality = 'low' | 'medium' | 'high'

/** How much surface texture to draw: none, colour only, or colour with bumps. */
export type SurfaceDetail = 'plain' | 'color' | 'bumps'

/** How much of the city kit to draw: planters, then cornices and doors, then whole walls. */
export type KitDetail = 0 | 1 | 2

type QualityPreset = {
  label: string
  /**
   * Rendering resolution, as [lowest, highest] pixels per screen point. The
   * game starts at the screen's own, within this range, and AdaptiveResolution
   * goes lower if frames come in late.
   */
  pixelRatio: [number, number]
  /** Sun shadow detail in pixels, or 0 for no shadows. */
  shadowSize: number
  /** How far the sun's shadows reach from the rider, in metres. Smaller is sharper for the same detail. */
  shadowRange: number
  /** How soft shadow edges are, in shadow pixels. Each step costs a little more per pixel on screen. */
  shadowSoftness: number
  /**
   * Ambient occlusion: darkening in corners and under things. Always worked out
   * at half size: full size cost about 20 ms a frame on High. 'fast' takes fewer
   * samples than 'balanced'.
   */
  ambientOcclusion: 'off' | 'fast' | 'balanced'
  /** A soft glow around the brightest lights. */
  bloom: boolean
  /** Sun shafts through leaves and between buildings when the sun is low. The sun's haze glow is on every quality. */
  sunShafts: boolean
  /**
   * Smoothing jagged edges, as an effect on the finished picture. FXAA is
   * cheapest, SMAA sharper. Multisampling looked best but cost about 12 ms a
   * frame on High, as ambient occlusion then works on four times the samples.
   */
  antialiasing: 'fxaa' | 'smaa'
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
  /** Vehicles further than this are drawn with their far versions, under 1,000 triangles (Traffic.tsx), in metres. */
  vehicleDetailDistance: number
  pedestrians: number
  /** How many of the nearest vehicles get a real headlight at night, which lights what it hits. */
  carLights: number
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    label: 'Low',
    // Up to 1, so a sharp (Retina) screen isn't drawn at under 40% of its pixels across, and down to
    // 0.75 where the computer can't keep up: AdaptiveResolution starts at 1 and steps down if needed.
    pixelRatio: [0.75, 1],
    shadowSize: 1024,
    shadowRange: 35,
    shadowSoftness: 1,
    ambientOcclusion: 'off',
    bloom: false,
    sunShafts: false,
    antialiasing: 'fxaa',
    windows: false,
    surfaces: 'plain',
    kitDetail: 0,
    treeShadows: false,
    drawDistance: 220,
    propDistance: 110,
    skyClouds: false,
    rainDrops: 300,
    leafyTrees: false,
    grassTufts: 0,
    vehicles: 10,
    vehicleDetailDistance: 16,
    pedestrians: 6,
    carLights: 0,
  },
  medium: {
    label: 'Medium',
    pixelRatio: [1, 1.25],
    shadowSize: 2048,
    shadowRange: 70,
    shadowSoftness: 2,
    ambientOcclusion: 'fast',
    bloom: true,
    sunShafts: true,
    antialiasing: 'smaa',
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
    vehicles: 28,
    vehicleDetailDistance: 20,
    pedestrians: 22,
    carLights: 2,
  },
  high: {
    label: 'High',
    // Not 2 on a sharp screen: that's four times the pixels of 1, and costs
    // more than shadows, for a difference that's hard to see while riding.
    pixelRatio: [1, 1.5],
    shadowSize: 2048,
    shadowRange: 90,
    shadowSoftness: 3,
    ambientOcclusion: 'balanced',
    bloom: true,
    sunShafts: true,
    antialiasing: 'smaa',
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
    vehicles: 40,
    vehicleDetailDistance: 24,
    pedestrians: 36,
    carLights: 4,
  },
}

export const QUALITY_LEVELS: Quality[] = ['low', 'medium', 'high']
