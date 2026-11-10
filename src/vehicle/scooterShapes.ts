import * as THREE from 'three'

type Ring = THREE.Vector3[]

const RING_POINTS = 18

/** A rounded square at `power` 4, and an ellipse at 2. */
function roundedRing(power: number, place: (across: number, up: number) => THREE.Vector3): Ring {
  return Array.from({ length: RING_POINTS }, (_, index) => {
    const angle = (index / RING_POINTS) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return place(
      Math.sign(cos) * Math.abs(cos) ** (2 / power),
      Math.sign(sin) * Math.abs(sin) ** (2 / power),
    )
  })
}

/** A slice across the scooter, seen from the front. */
function sliceAtZ(z: number, centreY: number, halfWidth: number, halfHeight: number, power = 3): Ring {
  return roundedRing(power, (across, up) =>
    new THREE.Vector3(across * halfWidth, centreY + up * halfHeight, z),
  )
}

/** A slice through something upright, seen from above. */
function sliceAtY(y: number, centreZ: number, halfWidth: number, halfDepth: number, power = 3): Ring {
  return roundedRing(power, (across, up) =>
    new THREE.Vector3(across * halfWidth, y, centreZ - up * halfDepth),
  )
}

/** Joins slices into one smooth skin, like hoops inside a paper lantern. */
function loft(rings: Ring[]): THREE.BufferGeometry {
  const positions = rings.flat().flatMap(({ x, y, z }) => [x, y, z])
  const indices: number[] = []

  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let point = 0; point < RING_POINTS; point++) {
      const next = (point + 1) % RING_POINTS
      const a = ring * RING_POINTS + point
      const b = ring * RING_POINTS + next
      const c = (ring + 1) * RING_POINTS + next
      const d = (ring + 1) * RING_POINTS + point
      indices.push(a, b, c, a, c, d)
    }
  }

  const middleOf = (ring: Ring) =>
    ring.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(RING_POINTS)
  const first = middleOf(rings[0])
  const last = middleOf(rings[rings.length - 1])
  const firstIndex = positions.length / 3
  positions.push(first.x, first.y, first.z, last.x, last.y, last.z)
  const lastRing = (rings.length - 1) * RING_POINTS

  for (let point = 0; point < RING_POINTS; point++) {
    const next = (point + 1) % RING_POINTS
    indices.push(firstIndex, next, point)
    indices.push(firstIndex + 1, lastRing + point, lastRing + next)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export function createRearBody(): THREE.BufferGeometry {
  return loft([
    sliceAtZ(-1, 0.68, 0.05, 0.03),
    sliceAtZ(-0.93, 0.62, 0.12, 0.12),
    sliceAtZ(-0.72, 0.58, 0.18, 0.2),
    sliceAtZ(-0.42, 0.53, 0.2, 0.24),
    sliceAtZ(-0.16, 0.5, 0.17, 0.22),
    sliceAtZ(-0.04, 0.46, 0.12, 0.16),
  ])
}

export function createSeat(): THREE.BufferGeometry {
  return loft([
    sliceAtZ(-0.9, 0.8, 0.08, 0.025, 2.5),
    sliceAtZ(-0.84, 0.81, 0.13, 0.055, 2.5),
    sliceAtZ(-0.55, 0.82, 0.16, 0.07, 2.5),
    sliceAtZ(-0.28, 0.8, 0.165, 0.065, 2.5),
    sliceAtZ(-0.08, 0.78, 0.13, 0.05, 2.5),
    sliceAtZ(-0.02, 0.77, 0.06, 0.02, 2.5),
  ])
}

export function createFloorboard(): THREE.BufferGeometry {
  return loft([
    sliceAtZ(-0.12, 0.3, 0.13, 0.05, 4),
    sliceAtZ(-0.04, 0.3, 0.18, 0.06, 4),
    sliceAtZ(0.28, 0.3, 0.19, 0.06, 4),
    sliceAtZ(0.42, 0.32, 0.17, 0.08, 4),
  ])
}

/** The curved panel in front of the rider's legs, leaning back towards them. */
export function createLegShield(): THREE.BufferGeometry {
  return loft([
    sliceAtY(0.26, 0.44, 0.12, 0.05),
    sliceAtY(0.34, 0.46, 0.19, 0.07),
    sliceAtY(0.56, 0.47, 0.21, 0.09),
    sliceAtY(0.8, 0.46, 0.18, 0.09),
    sliceAtY(0.98, 0.45, 0.13, 0.08),
    sliceAtY(1.04, 0.45, 0.07, 0.04),
  ])
}

/** The rounded cover around the handlebars and headlight. Part of the steering. */
export function createCowl(): THREE.BufferGeometry {
  return loft([
    sliceAtZ(-0.13, 1.04, 0.05, 0.03, 2.4),
    sliceAtZ(-0.07, 1.05, 0.13, 0.07, 2.4),
    sliceAtZ(0.02, 1.06, 0.15, 0.09, 2.4),
    sliceAtZ(0.1, 1.05, 0.11, 0.08, 2.4),
    sliceAtZ(0.14, 1.05, 0.05, 0.04, 2.4),
  ])
}

/** The front mudguard, curving over the wheel. Part of the steering. */
export function createMudguard(radius: number, wheelZ: number): THREE.BufferGeometry {
  const rings: Ring[] = []
  const arc = radius + 0.05

  for (let step = 0; step <= 8; step++) {
    const angle = -0.5 + (step / 8) * 2.2
    const centre = new THREE.Vector3(0, radius + Math.cos(angle) * arc, wheelZ + Math.sin(angle) * arc)
    const outward = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle))
    rings.push(
      roundedRing(3, (across, up) =>
        new THREE.Vector3(across * 0.085, 0, 0).add(centre).addScaledVector(outward, up * 0.022),
      ),
    )
  }

  return loft(rings.reverse())
}

export function createExhaust(): THREE.BufferGeometry {
  const geometry = new THREE.CapsuleGeometry(0.04, 0.34, 4, 10)
  geometry.rotateX(Math.PI / 2 - 0.1)
  geometry.translate(0.15, 0.3, -0.7)
  return geometry
}

/** A rounded delivery box. */
export function createDeliveryBox(): THREE.BufferGeometry {
  const width = 0.21
  const depth = 0.21
  return (() => {
    const rings = [0.86, 0.885, 1.0, 1.16, 1.27, 1.3].map((y, index) => {
      const inset = index === 0 || index === 5 ? 0.93 : 1
      return roundedRing(7, (across, up) =>
        new THREE.Vector3(across * width * inset, y, -0.76 - up * depth * inset),
      )
    })
    return loft(rings)
  })()
}
