import * as THREE from 'three'

/*
 * No maker's badge on any vehicle. The traffic's cars were made from models of real cars, and
 * though their textures (and so the printed logos) were dropped when they were baked, the badges
 * themselves are sculpted into the grilles and boot lids, and survived as shapes: an emblem in
 * the middle of the grille, another on the tailgate.
 *
 * Each is taken off as the model is loaded: the small patch of the nose or tail it sits on
 * (`BADGES`, measured from each model) is pressed flat, given one flat direction to face, and
 * painted as what's round it: grille black at the front, the car's own paint on the tailgate.
 * A plain panel is left where the emblem was. Nothing is added, and it costs nothing per frame.
 */

/** A patch: at the front or the rear, this far either side of the middle, between these heights, no deeper than this from that end (metres). `as`: what it becomes. `plate`: a plain panel goes over it too. */
type Patch = { end: 'front' | 'rear'; half: number; low: number; high: number; deep: number; as: 'grille' | 'paint'; plate?: boolean }

const BADGES: Record<string, Patch[]> = {
  sedan: [
    { end: 'front', half: 0.11, low: 0.6, high: 0.76, deep: 0.14, as: 'grille', plate: true },
    { end: 'rear', half: 0.13, low: 0.9, high: 1.14, deep: 0.2, as: 'paint' },
  ],
  hatchback: [{ end: 'front', half: 0.13, low: 0.66, high: 0.84, deep: 0.16, as: 'grille' }],
  suv: [
    { end: 'front', half: 0.15, low: 0.82, high: 1.04, deep: 0.18, as: 'grille' },
    { end: 'rear', half: 0.16, low: 0.96, high: 1.15, deep: 0.26, as: 'paint' },
  ],
  mpv: [
    { end: 'front', half: 0.14, low: 0.6, high: 0.9, deep: 0.14, as: 'grille', plate: true },
    { end: 'rear', half: 0.15, low: 0.98, high: 1.22, deep: 0.16, as: 'paint' },
  ],
}

/** The near model and its far stand-in share a name's start: `sedan`, `sedan-far`. */
const kindOf = (name: string) => name.replace(/-far$/, '')

const GRILLE: [number, number, number] = [0.028, 0.028, 0.031]
const done = new WeakSet<THREE.BufferGeometry>()

/** Takes the maker's badges off a loaded vehicle model, in place, once. Models with none are left alone. */
export function removeBadges(geometry: THREE.BufferGeometry, name: string) {
  const patches = BADGES[kindOf(name)]
  if (!patches || done.has(geometry)) return
  done.add(geometry)
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const paint = geometry.getAttribute('_paint')
  if (!position || !color || !paint) return
  let back = Infinity
  let front = -Infinity
  for (let i = 0; i < position.count; i++) {
    back = Math.min(back, position.getZ(i))
    front = Math.max(front, position.getZ(i))
  }
  const plates: { half: number; low: number; high: number; z: number; facing: number }[] = []
  for (const patch of patches) {
    const inPatch: number[] = []
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i)
      if (Math.abs(position.getX(i)) > patch.half || y < patch.low || y > patch.high) continue
      const depth = patch.end === 'front' ? front - position.getZ(i) : position.getZ(i) - back
      if (depth > patch.deep) continue
      // On a grille, the paint round it (the bonnet's lip, the bumper) is left as it is.
      if (patch.as === 'grille' && paint.getX(i) > 0.5) continue
      inPatch.push(i)
    }
    if (inPatch.length < 3) continue
    // Pressed flat at the patch's middle depth: the emblem stood proud of it, or was sunk into it.
    const depths = inPatch.map((i) => position.getZ(i)).sort((a, b) => a - b)
    const flat = depths[Math.floor(depths.length / 2)]
    // On a grille the emblem's outline still showed, dark on dark, against the bars round it: a plain
    // blanking panel goes over the patch, just proud of everything that was in it.
    // Only where it's needed (`plate`), and set just proud of the flattened patch, in the grille, not out in front of it.
    if (patch.plate) {
      const proud = flat + (patch.end === 'front' ? 0.02 : -0.02)
      plates.push({ half: patch.half * 0.92, low: patch.low + 0.01, high: patch.high - 0.01, z: proud, facing: patch.end === 'front' ? 1 : -1 })
    }
    for (const i of inPatch) {
      position.setZ(i, flat)
      if (normal) normal.setXYZ(i, 0, 0, patch.end === 'front' ? 1 : -1)
      if (patch.as === 'paint') {
        color.setXYZ(i, 1, 1, 1)
        paint.setX(i, 1)
      } else color.setXYZ(i, ...GRILLE)
    }
  }
  position.needsUpdate = true
  color.needsUpdate = true
  paint.needsUpdate = true
  if (normal) normal.needsUpdate = true
  if (plates.length > 0) addPlates(geometry, plates)
}

/** Adds flat rectangles to a shape: four corners and two triangles each, with every attribute the shape has (the ones not set here are zero). */
function addPlates(geometry: THREE.BufferGeometry, plates: { half: number; low: number; high: number; z: number; facing: number }[]) {
  const before = geometry.getAttribute('position').count
  const indexed = geometry.index !== null
  const perPlate = indexed ? 4 : 6
  for (const name of Object.keys(geometry.attributes)) {
    const old = geometry.getAttribute(name) as THREE.BufferAttribute
    const array = new (old.array.constructor as Float32ArrayConstructor)((before + plates.length * perPlate) * old.itemSize)
    array.set(old.array as Float32Array)
    geometry.setAttribute(name, new THREE.BufferAttribute(array, old.itemSize, old.normalized))
  }
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const corners = indexed ? [0, 1, 2, 3] : [0, 1, 2, 0, 2, 3]
  const index = indexed ? Array.from(geometry.index!.array) : null
  plates.forEach(({ half, low, high, z, facing }, plate) => {
    // Anticlockwise as seen from the way it faces.
    const square = [[-half * facing, low], [half * facing, low], [half * facing, high], [-half * facing, high]]
    corners.forEach((corner, n) => {
      const at = before + plate * perPlate + n
      position.setXYZ(at, square[corner][0], square[corner][1], z)
      if (normal) normal.setXYZ(at, 0, 0, facing)
      color.setXYZ(at, ...GRILLE)
    })
    if (index) {
      const first = before + plate * perPlate
      index.push(first, first + 1, first + 2, first, first + 2, first + 3)
    }
  })
  if (index) geometry.setIndex(index)
}
