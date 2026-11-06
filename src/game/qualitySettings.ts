export type Quality = 'low' | 'medium' | 'high'

type QualityPreset = {
  label: string
  /** Rendering resolution, as [lowest, highest] pixels per screen point. */
  pixelRatio: [number, number]
  /** Sun shadow detail in pixels, or 0 for no shadows. */
  shadowSize: number
  windows: boolean
  treeShadows: boolean
  /** How far you can see. Map squares further away aren't drawn, in metres. */
  drawDistance: number
  /** Trees and lamps further from the rider than this aren't drawn, in metres. */
  propDistance: number
  vehicles: number
  pedestrians: number
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatio: [0.75, 0.75],
    shadowSize: 0,
    windows: false,
    treeShadows: false,
    drawDistance: 280,
    propDistance: 140,
    vehicles: 6,
    pedestrians: 10,
  },
  medium: {
    label: 'Medium',
    pixelRatio: [1, 1.25],
    shadowSize: 2048,
    windows: true,
    treeShadows: false,
    drawDistance: 400,
    propDistance: 200,
    vehicles: 12,
    pedestrians: 22,
  },
  high: {
    label: 'High',
    pixelRatio: [1, 2],
    shadowSize: 4096,
    windows: true,
    treeShadows: true,
    drawDistance: 520,
    propDistance: 260,
    vehicles: 18,
    pedestrians: 36,
  },
}

export const QUALITY_LEVELS: Quality[] = ['low', 'medium', 'high']
