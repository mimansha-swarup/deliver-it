import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import type { ScooterState } from './ScooterController'
import { SCOOTER } from './vehicleConfig'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('rain and particles')

/** Droplets in the pool. A splash takes `PER_SPLASH`, and the oldest are reused. */
const DROPLETS = 160
const PER_SPLASH = 40
/** How long a droplet flies, in seconds. */
const LIFE = 0.75
const GRAVITY = 9.81
/** Where an unused droplet waits, out of sight. */
const PARKED = -100

type Pool = {
  geometry: THREE.BufferGeometry
  material: THREE.PointsMaterial
  velocity: Float32Array
  age: Float32Array
  /** The next droplet to reuse, and the splash count last seen. */
  next: number
  seen: number
}

/** A soft round drop. Points are square unless their picture says otherwise. */
function createDropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')
  if (context) {
    const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16)
    glow.addColorStop(0, 'rgba(255,255,255,1)')
    glow.addColorStop(0.55, 'rgba(255,255,255,0.8)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = glow
    context.fillRect(0, 0, 32, 32)
  }
  return new THREE.CanvasTexture(canvas)
}

function createPool(): Pool {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(DROPLETS * 3)
  for (let i = 0; i < DROPLETS; i++) positions[i * 3 + 1] = PARKED
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: '#dbe6ee',
    map: createDropTexture(),
    alphaTest: 0.02,
    size: 0.08,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  })
  return { geometry, material, velocity: new Float32Array(DROPLETS * 3), age: new Float32Array(DROPLETS).fill(LIFE), next: 0, seen: 0 }
}

/** Flings a splash of droplets from the tyres: out to both sides and up, carried on a little with the scooter. */
function throwSplash(pool: Pool, state: ScooterState) {
  const positions = pool.geometry.getAttribute('position').array as Float32Array
  const strength = Math.min(1, state.splashSpeed / 14)
  const forwardX = Math.sin(state.heading)
  const forwardZ = Math.cos(state.heading)
  for (let n = 0; n < PER_SPLASH; n++) {
    const i = pool.next
    pool.next = (pool.next + 1) % DROPLETS
    // Mostly from the front tyre, which meets the water first.
    const axle = Math.random() < 0.65 ? SCOOTER.frontAxle : SCOOTER.rearAxle
    const side = Math.random() < 0.5 ? -1 : 1
    positions[i * 3] = state.x + forwardX * axle
    positions[i * 3 + 1] = state.frontWheel.height + 0.05
    positions[i * 3 + 2] = state.z + forwardZ * axle
    const out = (1 + Math.random() * 2.5) * (0.5 + strength)
    const up = (1 + Math.random() * 2) * (0.4 + strength)
    const carry = 0.25 + Math.random() * 0.3
    pool.velocity[i * 3] = forwardZ * side * out + state.velocityX * carry
    pool.velocity[i * 3 + 1] = up
    pool.velocity[i * 3 + 2] = -forwardX * side * out + state.velocityZ * carry
    pool.age[i] = 0
  }
}

/** Throws a splash for each new one the scooter has made since last time. */
function splashIfNew(pool: Pool, state: ScooterState) {
  if (state.splashCount === pool.seen) return
  pool.seen = state.splashCount
  throwSplash(pool, state)
}

/** Moves the droplets in flight under gravity, and parks those whose time is up. True if any are still flying. */
function stepDroplets(pool: Pool, dt: number): boolean {
  const position = pool.geometry.getAttribute('position') as THREE.BufferAttribute
  const positions = position.array as Float32Array
  let flying = false
  for (let i = 0; i < DROPLETS; i++) {
    if (pool.age[i] >= LIFE) continue
    flying = true
    pool.age[i] += dt
    pool.velocity[i * 3 + 1] -= GRAVITY * dt
    positions[i * 3] += pool.velocity[i * 3] * dt
    positions[i * 3 + 1] += pool.velocity[i * 3 + 1] * dt
    positions[i * 3 + 2] += pool.velocity[i * 3 + 2] * dt
    if (pool.age[i] >= LIFE) positions[i * 3 + 1] = PARKED
  }
  if (flying) position.needsUpdate = true
  // Duller at night, when there's less light to catch.
  pool.material.opacity = 0.85 - liveSky.look.night * 0.4
  return flying
}

/**
 * Water thrown up when a tyre goes through a puddle. The droplets are points in
 * one pool, reused oldest first, so nothing is made or freed while riding, and
 * the whole pool is hidden when none are flying.
 */
export function Splashes({ scooter }: { scooter: RefObject<ScooterState> }) {
  const points = useRef<THREE.Points>(null)
  const pool = useMemo(() => createPool(), [])

  useEffect(
    () => () => {
      pool.geometry.dispose()
      pool.material.map?.dispose()
      pool.material.dispose()
    },
    [pool],
  )

  useFrame((_, delta) => {
    splashIfNew(pool, scooter.current)
    const flying = stepDroplets(pool, Math.min(delta, 0.05))
    if (points.current) points.current.visible = flying
  })

  return <points ref={points} geometry={pool.geometry} material={pool.material} frustumCulled={false} visible={false} />
}
