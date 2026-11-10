import * as THREE from 'three'

export const TRAFFIC_MODELS_URL = '/models/traffic.glb'
/** Kept apart from the rest, because its licence is different. See `models/CREDITS.txt`. */
export const YAMAHA_MODEL_URL = '/models/yamaha.glb'

/** The paint on delivery bikes. Their box is white in the model itself. */
export const DELIVERY_BIKE_COLOR = '#17181b'

/** Pulls one named model out of a loaded file. */
export function getModel(scene: THREE.Group, name: string): THREE.BufferGeometry {
  const model = scene.getObjectByName(name)
  let geometry: THREE.BufferGeometry | undefined
  model?.traverse((child) => {
    if (child instanceof THREE.Mesh) geometry = child.geometry
  })
  if (!geometry) throw new Error(`No model called ${name}`)
  return geometry
}

/** A copy of a model with its paint changed, for a one-off that needs no shader. */
export function paintModel(model: THREE.BufferGeometry, paintColor: string): THREE.BufferGeometry {
  const geometry = model.clone()
  const color = geometry.getAttribute('color')
  const paint = geometry.getAttribute('_paint')
  const { r, g, b } = new THREE.Color(paintColor)

  for (let corner = 0; corner < color.count; corner++) {
    if (paint.getX(corner) > 0.5) color.setXYZ(corner, r, g, b)
  }
  return geometry
}
