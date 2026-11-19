import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { LakeLife as LakeLifePlan } from './lakePlacement'
import { ShopPeople } from './ShopPeople'

/*
 * Agara Lake's life (lakePlacement.ts): the morning's joggers, walkers and dog walkers on the path, a
 * few walkers at dusk, and birds wheeling over the water by day. The path and benches are part of
 * the ground and the parks' benches.
 */

/** Mornings and dusk, in hours. */
const MORNING: [number, number] = [5.5, 9.5]
const EVENING: [number, number] = [16.5, 19]
/** Birds are drawn with the rider this near the lake's middle, past its shore, in metres. */
const BIRDS_WITHIN = 500
const BIRDS = { high: 36, low: 14 }

/** Whether the clock is between two hours, checked as it runs. */
function useHours([from, to]: [number, number]): boolean {
  const [within, setWithin] = useState(false)
  useFrame(() => {
    const now = liveSky.hours >= from && liveSky.hours < to
    if (now !== within) setWithin(now)
  })
  return within
}

/** A bird far off: two wings from a short body, their tips up, which flap by squashing them. */
function createBirdGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  // Wings out along x, the head to +z.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.18, -0.55, 0.16, -0.05, 0, 0, -0.12,
    0, 0, 0.18, 0, 0, -0.12, 0.55, 0.16, -0.05,
    -0.04, 0, 0.2, 0.04, 0, 0.2, 0, 0, -0.28,
  ], 3))
  geometry.computeVertexNormals()
  return geometry
}

/** The walking path: packed red earth, a little darker than the soil, between two lines of edging stone. */
const PATH = { half: 1.3, edge: 0.14, height: 0.045, earth: '#9c5f3e', stone: '#b9b2a4' }

/** The path's runs as one flat ribbon each, with a stone edging either side. */
function createPathGeometry(runs: [number, number][][]): THREE.BufferGeometry | null {
  const positions: number[] = []
  const colors: number[] = []
  const earth = new THREE.Color(PATH.earth)
  const stone = new THREE.Color(PATH.stone)
  const strip = (run: [number, number][], from: number, to: number, color: THREE.Color, lift: number) => {
    for (let i = 1; i < run.length; i++) {
      const side = (k: number) => {
        const [ax, az] = run[Math.max(0, k - 1)]
        const [bx, bz] = run[Math.min(run.length - 1, k + 1)]
        const length = Math.hypot(bx - ax, bz - az) || 1
        return [(bz - az) / length, -(bx - ax) / length]
      }
      const [sx0, sz0] = side(i - 1)
      const [sx1, sz1] = side(i)
      const [ax, az] = run[i - 1]
      const [bx, bz] = run[i]
      const y = PATH.height + lift
      const a0 = [ax + sx0 * from, y, az + sz0 * from]
      const a1 = [ax + sx0 * to, y, az + sz0 * to]
      const b0 = [bx + sx1 * from, y, bz + sz1 * from]
      const b1 = [bx + sx1 * to, y, bz + sz1 * to]
      // Wound to face up.
      positions.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
      for (let k = 0; k < 6; k++) colors.push(color.r, color.g, color.b)
    }
  }
  for (const run of runs) {
    strip(run, -PATH.half, PATH.half, earth, 0)
    strip(run, -PATH.half - PATH.edge, -PATH.half, stone, 0.03)
    strip(run, PATH.half, PATH.half + PATH.edge, stone, 0.03)
  }
  if (positions.length === 0) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

const pathMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })

const birdMaterial = new THREE.MeshBasicMaterial({ color: '#2f2c2a', side: THREE.DoubleSide })
const transform = new THREE.Object3D()

function Birds({ at }: { at: NonNullable<LakeLifePlan['birds']> }) {
  const low = useGameStore((state) => QUALITY_PRESETS[state.quality].kitDetail === 0)
  const count = low ? BIRDS.low : BIRDS.high
  const geometry = useMemo(() => createBirdGeometry(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  // Three loose flocks, each circling its own spot over the water.
  const birds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const flock = i % 3
        const turn = (flock / 3) * Math.PI * 2 + 0.6
        return {
          x: at.x + Math.cos(turn) * at.reach * 0.35,
          z: at.z + Math.sin(turn) * at.reach * 0.35,
          radius: 22 + ((i * 7) % 5) * 6,
          height: 14 + ((i * 5) % 7) * 2.2,
          speed: (0.16 + ((i * 3) % 4) * 0.03) * (flock % 2 === 0 ? 1 : -1),
          phase: i * 1.7,
        }
      }),
    [at, count],
  )

  useFrame(({ clock }) => {
    const instances = mesh.current
    if (!instances) return
    // By day only, and only from near the lake.
    const near = Math.hypot(livePlayer.x - at.x, livePlayer.z - at.z) < at.reach + BIRDS_WITHIN
    instances.visible = near && liveSky.look.night < 0.4
    if (!instances.visible) return
    const time = clock.elapsedTime
    birds.forEach((bird, i) => {
      const angle = bird.phase + time * bird.speed
      transform.position.set(bird.x + Math.cos(angle) * bird.radius, bird.height + Math.sin(time * 0.3 + bird.phase) * 1.5, bird.z + Math.sin(angle) * bird.radius)
      // Heading round its circle, banked a little into the turn; the wings beat by their height.
      transform.rotation.set(0, -angle + (bird.speed > 0 ? 0 : Math.PI), bird.speed > 0 ? -0.25 : 0.25)
      transform.scale.set(1.5, 1.5 * Math.sin(time * 7 + bird.phase * 3), 1.5)
      transform.updateMatrix()
      instances.setMatrixAt(i, transform.matrix)
    })
    instances.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, birdMaterial, count]} frustumCulled={false} />
}

export function LakeLife({ lake }: { lake: LakeLifePlan }) {
  const morning = useHours(MORNING)
  const evening = useHours(EVENING)
  const path = useMemo(() => createPathGeometry(lake.path), [lake])
  useEffect(() => () => path?.dispose(), [path])
  return (
    <>
      {path && <mesh geometry={path} material={pathMaterial} receiveShadow />}
      {morning && <ShopPeople people={lake.morning} />}
      {evening && <ShopPeople people={lake.evening} />}
      {lake.birds && <Birds at={lake.birds} />}
    </>
  )
}
