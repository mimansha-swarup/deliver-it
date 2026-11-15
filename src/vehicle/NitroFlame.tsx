import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ScooterState } from './ScooterController'

/** Where the flame comes out, on the scooter's body, in metres: low on the right, behind the rear wheel. */
const EXHAUST: [number, number, number] = [-0.17, 0.3, -0.78]
/** The flame's full length and width at its base, in metres. */
const LENGTH = 0.95
const RADIUS = 0.14
/**
 * The glow round the exhaust: a wide blue haze and a small white-hot centre. It's
 * what reads from the camera behind, where the flame points almost straight at it.
 */
const GLOW_SIZE = 1.15
const HOT_SIZE = 0.42
/** How fast it grows when the nitro lights and shrinks when it stops, per second. */
const GROW = 14
const SHRINK = 8

/**
 * A cone lying along the scooter, its base at the exhaust and its tip pointing
 * backwards (−Z). Cones point up (+Y) when made, so it's moved up by half its
 * height, to put the base at the origin, then tipped over.
 */
function createFlameCone(radius: number, length: number): THREE.ConeGeometry {
  const cone = new THREE.ConeGeometry(radius, length, 12, 1, true)
  cone.translate(0, length / 2, 0)
  cone.rotateX(-Math.PI / 2)
  return cone
}

/** Glowing, additive and unlit, so it shines the same by day or night and never darkens what's behind. */
function createFlameMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
}

/** A soft round spot, bright in the middle, for the glow. */
function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const glow = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.25, 'rgba(255,255,255,0.6)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(canvas)
}

/**
 * The nitro's exhaust flame: a white-hot core in a blue flame, with an orange
 * edge, and a glow at the pipe that faces the camera. It flickers in length and
 * width, and grows and fades with the burn, so it never pops in or out.
 */
export function NitroFlame({ scooter }: { scooter: RefObject<ScooterState> }) {
  const group = useRef<THREE.Group>(null)
  const core = useRef<THREE.Mesh>(null)
  const outer = useRef<THREE.Mesh>(null)
  const glow = useRef<THREE.Sprite>(null)
  const hot = useRef<THREE.Sprite>(null)
  const size = useRef(0)

  const parts = useMemo(
    () => ({
      core: createFlameCone(RADIUS * 0.55, LENGTH * 0.55),
      flame: createFlameCone(RADIUS, LENGTH),
      edge: createFlameCone(RADIUS * 1.35, LENGTH * 0.8),
      coreMaterial: createFlameMaterial('#f2fbff', 1),
      flameMaterial: createFlameMaterial('#3d8bff', 0.75),
      edgeMaterial: createFlameMaterial('#ff7a2e', 0.35),
      glowMaterial: new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: '#5aa8ff',
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      hotMaterial: new THREE.SpriteMaterial({
        map: createGlowTexture(),
        color: '#ffffff',
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      parts.glowMaterial.map?.dispose()
      parts.hotMaterial.map?.dispose()
      Object.values(parts).forEach((part) => part.dispose())
    },
    [parts],
  )

  useFrame(({ clock }, delta) => {
    if (!group.current || !core.current || !outer.current || !glow.current || !hot.current) return
    const burning = scooter.current.nitroOn
    const target = burning ? 1 : 0
    const rate = burning ? GROW : SHRINK
    size.current += (target - size.current) * (1 - Math.exp(-rate * Math.min(delta, 0.1)))

    const visible = size.current > 0.01
    group.current.visible = visible
    if (!visible) return

    // Two quick wobbles that don't line up, so the flicker never looks like a loop.
    const time = clock.elapsedTime
    const flicker = 0.8 + 0.12 * Math.sin(time * 53) + 0.08 * Math.sin(time * 87 + 1.3)
    group.current.scale.set(size.current, size.current, size.current * flicker)
    core.current.scale.set(1, 1, 0.9 + 0.2 * Math.sin(time * 71))
    outer.current.scale.set(1 + 0.1 * Math.sin(time * 41), 1, 1)
    // The group's own scale shrinks the glow as the flame does.
    glow.current.scale.setScalar(GLOW_SIZE * (0.85 + 0.15 * Math.sin(time * 37)))
    hot.current.scale.setScalar(HOT_SIZE * (0.9 + 0.1 * Math.sin(time * 67)))
  })

  return (
    <group ref={group} position={EXHAUST} visible={false}>
      <mesh ref={core} geometry={parts.core} material={parts.coreMaterial} renderOrder={3} />
      <mesh geometry={parts.flame} material={parts.flameMaterial} renderOrder={2} />
      <mesh ref={outer} geometry={parts.edge} material={parts.edgeMaterial} renderOrder={1} />
      <sprite ref={glow} position={[0, 0, -0.15]} material={parts.glowMaterial} renderOrder={4} />
      <sprite ref={hot} position={[0, 0, -0.05]} material={parts.hotMaterial} renderOrder={5} />
    </group>
  )
}
