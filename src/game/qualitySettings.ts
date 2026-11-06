export type Quality = 'low' | 'medium' | 'high'

type QualityPreset = {
  label: string
  /** Rendering resolution, as [lowest, highest] pixels per screen point. */
  pixelRatio: [number, number]
  /** Sun shadow detail in pixels, or 0 for no shadows. */
  shadowSize: number
  windows: boolean
  treeShadows: boolean
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatio: [0.75, 0.75],
    shadowSize: 0,
    windows: false,
    treeShadows: false,
  },
  medium: {
    label: 'Medium',
    pixelRatio: [1, 1.25],
    shadowSize: 2048,
    windows: true,
    treeShadows: false,
  },
  high: {
    label: 'High',
    pixelRatio: [1, 2],
    shadowSize: 4096,
    windows: true,
    treeShadows: true,
  },
}

export const QUALITY_LEVELS: Quality[] = ['low', 'medium', 'high']
