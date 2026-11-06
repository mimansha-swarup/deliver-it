import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide, type BufferAttribute, type Mesh } from 'three'
import type { ScooterState } from './ScooterController'
import { SCOOTER } from './vehicleConfig'

const MAX_SEGMENTS = 500
const VERTICES_PER_SEGMENT = 6
const MARK_WIDTH = 0.16
const MARK_HEIGHT = 0.085
const REAR_WHEEL_OFFSET = 0.62

/** New marks are laid once the wheel has moved this far, in metres. */
const SEGMENT_LENGTH = 0.5

/**
 * Black streaks left by the rear wheel. The segments live in a ring buffer: one
 * fixed block of memory where the newest segment overwrites the oldest, so the
 * marks can go on forever without ever using more memory.
 */
export function SkidMarks({ scooter }: { scooter: RefObject<ScooterState> }) {
  const mesh = useRef<Mesh>(null)
  const nextSegment = useRef(0)
  const lastPoint = useRef<{ x: number; z: number } | null>(null)
  const positions = useMemo(() => new Float32Array(MAX_SEGMENTS * VERTICES_PER_SEGMENT * 3), [])

  useFrame(() => {
    const state = scooter.current
    if (!mesh.current) return

    const sliding = Math.abs(state.slip) > SCOOTER.slipThreshold && state.speed > 2
    if (!sliding) {
      lastPoint.current = null
      return
    }

    const x = state.x - Math.sin(state.heading) * REAR_WHEEL_OFFSET
    const z = state.z - Math.cos(state.heading) * REAR_WHEEL_OFFSET
    const last = lastPoint.current
    if (!last) {
      lastPoint.current = { x, z }
      return
    }

    const length = Math.hypot(x - last.x, z - last.z)
    if (length < SEGMENT_LENGTH) return

    // Four corners of a thin strip from the last point to this one.
    const sideX = ((z - last.z) / length) * (MARK_WIDTH / 2)
    const sideZ = (-(x - last.x) / length) * (MARK_WIDTH / 2)
    const a = [last.x + sideX, MARK_HEIGHT, last.z + sideZ]
    const b = [last.x - sideX, MARK_HEIGHT, last.z - sideZ]
    const c = [x - sideX, MARK_HEIGHT, z - sideZ]
    const d = [x + sideX, MARK_HEIGHT, z + sideZ]

    const attribute = mesh.current.geometry.attributes.position as BufferAttribute
    const start = nextSegment.current * VERTICES_PER_SEGMENT
    ;[a, b, c, a, c, d].forEach(([vx, vy, vz], i) => attribute.setXYZ(start + i, vx, vy, vz))
    attribute.needsUpdate = true

    nextSegment.current = (nextSegment.current + 1) % MAX_SEGMENTS
    lastPoint.current = { x, z }
  })

  return (
    <mesh ref={mesh} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <meshBasicMaterial color="#17181b" transparent opacity={0.55} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}
