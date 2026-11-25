import { box, merge } from './simpleShapes'

/** A stray dog, standing, nose along +z. White, so its coat comes from the copy's tint. */
export function createDog() {
  const coat = '#ffffff'
  return merge([
    box([0.26, 0.24, 0.62], [0, 0.42, 0], coat),
    box([0.2, 0.2, 0.24], [0, 0.6, 0.38], coat),
    box([0.12, 0.1, 0.14], [0, 0.56, 0.54], '#8f857a'),
    box([0.05, 0.1, 0.05], [0.07, 0.74, 0.34], coat),
    box([0.05, 0.1, 0.05], [-0.07, 0.74, 0.34], coat),
    ...[[-0.09, 0.22], [0.09, 0.22], [-0.09, -0.22], [0.09, -0.22]].map(([x, z]) => box([0.07, 0.32, 0.07], [x, 0.16, z], coat)),
    box([0.05, 0.05, 0.28], [0, 0.56, -0.38], coat),
  ])
}
