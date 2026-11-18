import { LookupTexture } from 'postprocessing'

/**
 * The game's one colour grade, applied to the finished picture after tone
 * mapping, in display colours (0 to 1). See ART_DIRECTION.md: warm and slightly
 * muted, with nothing brand new. Change these, not individual materials, to
 * shift the look of everything at once.
 */
export const GRADE = {
  /** Multiplies red, green and blue: above 1 on red and below on blue warms everything. */
  warmth: [1.04, 1, 0.9] as const,
  /** 1 keeps colours as they are; lower greys them towards their brightness. */
  saturation: 0.88,
  /** An S-curve: deeper darks and brighter lights. AgX alone is a little flat. */
  contrast: 0.42,
  /**
   * Added to the midtones (most at middle grey, none in black or white): a touch of green, so
   * leaves and grass read alive under the warm light, without greening the sky or the shadows.
   */
  midtoneTint: [-0.008, 0.022, -0.006] as const,
  /** Lifts black to a faded warm brown, like old film or sun-bleached paint. 0 keeps true black. */
  fadedBlack: 0.025,
  fadedBlackTint: [1, 0.86, 0.72] as const,
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Grades one display colour. The LUT below is this, worked out ahead for a grid of colours. */
export function gradeColor(red: number, green: number, blue: number): [number, number, number] {
  let rgb = [red * GRADE.warmth[0], green * GRADE.warmth[1], blue * GRADE.warmth[2]]
  const brightness = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  rgb = rgb.map((channel) => brightness + (channel - brightness) * GRADE.saturation)
  const middle = Math.min(1, Math.max(0, brightness))
  const midtones = 4 * middle * (1 - middle)
  rgb = rgb.map((channel, index) => channel + GRADE.midtoneTint[index] * midtones)
  rgb = rgb.map((channel) => {
    const value = clamp01(channel)
    const curve = value * value * (3 - 2 * value)
    return value + (curve - value) * GRADE.contrast
  })
  rgb = rgb.map((channel, index) => channel * (1 - GRADE.fadedBlack) + GRADE.fadedBlack * GRADE.fadedBlackTint[index])
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])]
}

/** How many steps along each side of the LUT's cube. 32 is plenty for a smooth grade. */
const LUT_SIZE = 32

/**
 * The grade as a 3D lookup table: a cube of colours where each spot holds what
 * that colour becomes. The GPU blends between the nearest spots, so a grade of
 * any complexity costs one texture read per pixel.
 */
export function createGradeLut(): LookupTexture {
  const lut = LookupTexture.createNeutral(LUT_SIZE)
  const data = lut.image.data as Float32Array
  for (let index = 0; index < data.length; index += 4) {
    const [red, green, blue] = gradeColor(data[index], data[index + 1], data[index + 2])
    data[index] = red
    data[index + 1] = green
    data[index + 2] = blue
  }
  lut.needsUpdate = true
  return lut
}
