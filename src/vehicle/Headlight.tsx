import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import type { ScooterState } from './ScooterController'

const BEAM_LENGTH = 26
/** Half the beam's angle, in radians. */
const BEAM_SPREAD = 0.5
const RINGS = 7
const SPOKES = 8
const BEAM_HEIGHT = 0.13
const BEAM_BRIGHTNESS = 0.3
const BEAM_COLOR = new THREE.Color('#fff0cf')

/**
 * A curved grid over the road. Each point's brightness fades out towards the far
 * edge and both sides, so the beam has no hard outline.
 */
function createBeamGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []

  const add = (ring: number, spoke: number) => {
    const along = ring / RINGS
    const across = (spoke / SPOKES) * 2 - 1
    const angle = across * BEAM_SPREAD
    const distance = 1 + along * BEAM_LENGTH

    positions.push(Math.sin(angle) * distance, BEAM_HEIGHT, Math.cos(angle) * distance)
    const brightness = BEAM_BRIGHTNESS * (1 - along) ** 1.5 * (1 - across * across)
    colors.push(BEAM_COLOR.r * brightness, BEAM_COLOR.g * brightness, BEAM_COLOR.b * brightness)
  }

  for (let ring = 0; ring < RINGS; ring++) {
    for (let spoke = 0; spoke < SPOKES; spoke++) {
      add(ring, spoke)
      add(ring + 1, spoke)
      add(ring, spoke + 1)
      add(ring, spoke + 1)
      add(ring + 1, spoke)
      add(ring + 1, spoke + 1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

/**
 * A fake headlight: a shape painted on the road, which adds light to whatever is
 * under it. A real light would have to be worked out on every surface, for little gain.
 */
export function Headlight({ scooter }: { scooter: RefObject<ScooterState> }) {
  const geometry = useMemo(() => createBeamGeometry(), [])
  const mesh = useRef<THREE.Mesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    if (!mesh.current || !material.current) return

    const { x, z, heading } = scooter.current
    mesh.current.position.set(x, 0, z)
    mesh.current.rotation.y = heading
    mesh.current.visible = liveSky.look.night > 0.01
    material.current.opacity = liveSky.look.night
  })

  return (
    <mesh ref={mesh} geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial
        ref={material}
        vertexColors
        transparent
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        fog={false}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
      />
    </mesh>
  )
}
