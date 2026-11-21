import * as THREE from 'three'

export const TRAFFIC_MODELS_URL = '/models/traffic.glb'
/**
 * More people for the pavements, in a file of their own so adding one never rebakes the vehicles
 * (scripts/prepare_traffic_models.mjs): a man in a striped shirt, a man in a plain one, an
 * office-goer and a woman in a saree. Also in it: the bike rider the player's own rider is made
 * from (`biker`), two riders in suits for the traffic's bikes (`rider-m`, `rider-f`), and the bull
 * that stands in the road (`bull`).
 */
export const PEOPLE_MODELS_URL = '/models/people.glb'
export const EXTRA_PEOPLE = ['uncle', 'guy', 'office', 'saree'] as const

/** The rider's own vehicles (the scooter, and what GaadiGo rents and sells), each cut into the pieces that move (vehicle/vehicleBodies.ts). */
export const FLEET_MODELS_URL = '/models/fleet.glb'
/** GaadiGo's motorbike and cargo three-wheeler, made with Tripo AI (art/tripo), cut up the same way. */
export const TRIPO_MODELS_URL = '/models/tripo.glb'

/** Kept apart from the rest, because its licence is different. See `models/CREDITS.txt`. */
export const SPORT_BIKE_MODEL_URL = '/models/sportbike.glb'

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
