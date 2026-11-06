import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { ScooterState } from '../vehicle/ScooterController'
import { stepTraffic, type TrafficWorld } from './trafficLogic'

const CAR_COLORS = ['#e8e8e8', '#b9bcc2', '#30343b', '#8c2f2f', '#2f4f7f', '#d8d2c4']
const AUTO_COLORS = ['#3f8f4a', '#4a9a52']
const CLOTHES_COLORS = ['#c04a4a', '#3f6fa8', '#e0b13c', '#2f8f7a', '#7a4f9a', '#e8e4d8', '#30343b', '#d07a3a']

const GLASS = '#20262c'
const TYRE = '#17181a'
const WHITE = '#ffffff'
const AUTO_ROOF = '#1f1f1f'
const SKIN_COLORS = ['#8a5a3c', '#a06c47', '#6e4630', '#b58055']
const TROUSERS = '#ffffff'

/** Longest a single frame may count for, so a hidden tab doesn't move everything at once. */
const MAX_STEP = 0.05

/** A box of one flat colour. White parts take on each copy's own colour. */
function box(
  size: [number, number, number],
  position: [number, number, number],
  color: string,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed()
  geometry.translate(...position)
  geometry.deleteAttribute('uv')

  const { r, g, b } = new THREE.Color(color)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([r, g, b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts)
  if (!merged) throw new Error('Could not merge traffic geometry')
  parts.forEach((part) => part.dispose())
  return merged
}

function wheels(positions: [number, number][], width: number): THREE.BufferGeometry[] {
  return positions.map(([x, z]) => box([width, 0.56, 0.56], [x, 0.28, z], TYRE))
}

function createCarGeometry(): THREE.BufferGeometry {
  return merge([
    box([1.7, 0.55, 4], [0, 0.6, 0], WHITE),
    box([1.5, 0.5, 2], [0, 1.1, -0.2], GLASS),
    box([1.5, 0.08, 1.9], [0, 1.38, -0.2], WHITE),
    ...wheels([[-0.8, 1.3], [0.8, 1.3], [-0.8, -1.3], [0.8, -1.3]], 0.2),
  ])
}

function createAutoGeometry(): THREE.BufferGeometry {
  return merge([
    box([1.3, 0.75, 2.3], [0, 0.72, 0], WHITE),
    box([1.25, 0.55, 1.1], [0, 1.35, -0.2], GLASS),
    box([1.35, 0.12, 2.3], [0, 1.68, 0], AUTO_ROOF),
    ...wheels([[0, 1], [-0.6, -0.8], [0.6, -0.8]], 0.16),
  ])
}

function createBodyGeometry(): THREE.BufferGeometry {
  return merge([
    box([0.38, 0.8, 0.22], [0, 1.1, 0], WHITE),
    box([0.15, 0.72, 0.18], [-0.1, 0.36, 0], TROUSERS),
    box([0.15, 0.72, 0.18], [0.1, 0.36, 0], TROUSERS),
  ])
}

/** Heads are their own shape. One shape can only take one colour per copy. */
function createHeadGeometry(): THREE.BufferGeometry {
  return box([0.22, 0.24, 0.22], [0, 1.66, 0], WHITE)
}

type Moving = { x: number; z: number; heading: number; lift: number; tint: number }

const transform = new THREE.Object3D()

/** Copies of one shape, repositioned every frame from a list of moving things. */
function MovingInstances({
  items,
  geometry,
  palette,
  castShadow,
}: {
  items: Moving[]
  geometry: THREE.BufferGeometry
  palette: string[]
  castShadow: boolean
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return

    const color = new THREE.Color()
    items.forEach((item, index) => {
      instances.setColorAt(index, color.set(palette[Math.floor(item.tint * palette.length * 0.999)]))
    })
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  }, [items, palette])

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

    items.forEach((item, index) => {
      transform.position.set(item.x, item.lift, item.z)
      transform.rotation.y = item.heading
      transform.updateMatrix()
      instances.setMatrixAt(index, transform.matrix)
    })
    instances.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      key={items.length}
      ref={mesh}
      args={[geometry, undefined, items.length]}
      frustumCulled={false}
      castShadow={castShadow}
    >
      <meshStandardMaterial vertexColors roughness={0.6} />
    </instancedMesh>
  )
}

/** Vehicles and people around the rider. Only those nearby exist at all. */
export function Traffic({
  scooter,
  world,
}: {
  scooter: RefObject<ScooterState>
  world: TrafficWorld
}) {
  const { vehicles, pedestrians, shadowSize } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  const car = useMemo(() => createCarGeometry(), [])
  const auto = useMemo(() => createAutoGeometry(), [])
  const body = useMemo(() => createBodyGeometry(), [])
  const head = useMemo(() => createHeadGeometry(), [])

  useEffect(
    () => () => {
      car.dispose()
      auto.dispose()
      body.dispose()
      head.dispose()
    },
    [car, auto, body, head],
  )

  const inPlay = useMemo(() => world.vehicles.slice(0, vehicles), [world, vehicles])
  const cars = useMemo(() => inPlay.filter(({ isAuto }) => !isAuto), [inPlay])
  const autos = useMemo(() => inPlay.filter(({ isAuto }) => isAuto), [inPlay])
  const people = useMemo(() => world.pedestrians.slice(0, pedestrians), [world, pedestrians])

  useFrame((_, delta) => {
    stepTraffic(world, scooter.current, vehicles, pedestrians, Math.min(delta, MAX_STEP))
  })

  const castShadow = shadowSize > 0
  return (
    <>
      <MovingInstances items={cars} geometry={car} palette={CAR_COLORS} castShadow={castShadow} />
      <MovingInstances items={autos} geometry={auto} palette={AUTO_COLORS} castShadow={castShadow} />
      <MovingInstances items={people} geometry={body} palette={CLOTHES_COLORS} castShadow={false} />
      <MovingInstances items={people} geometry={head} palette={SKIN_COLORS} castShadow={false} />
    </>
  )
}

