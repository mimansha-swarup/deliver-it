import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { box, colored, merge } from '../world/simpleShapes'
import { getLight, type SignalLight, type SignalPost, type TrafficSignals } from './trafficSignals'
import type { TrafficWorld } from './trafficLogic'

const POLE_COLOR = '#23262a'
const HOUSING_COLOR = '#14161a'

const POLE_HEIGHT = 5.4
/** The arm reaches out over the road, in metres, from the pole towards the lane. */
const ARM_LENGTH = 1.7
const HIGH_LIGHTS = 4.9
/** A second set low on the pole, which a rider stopped at the line can see. */
const LOW_LIGHTS = 2.5
const LAMP_SPACING = 0.27
const LAMP_RADIUS = 0.1
const LAMP_FORWARD = 0.13

/** One of the three lamps in a set, from the top down. */
const LAMPS: { light: SignalLight; on: string; off: string }[] = [
  { light: 'red', on: '#ff2415', off: '#2d0d0b' },
  { light: 'yellow', on: '#ffb30f', off: '#2e230a' },
  { light: 'green', on: '#16ff6a', off: '#0a2a16' },
]
/** Lamps per pole: three up high and three low down. */
const LAMPS_PER_POST = LAMPS.length * 2

const STOP_LINE_THICKNESS = 0.5
/** Above the road. The material also needs a depth nudge, as the road has one too. */
const STOP_LINE_HEIGHT = 0.08

function createPoleGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.07, 0.09, POLE_HEIGHT, 8).toNonIndexed()
  pole.translate(0, POLE_HEIGHT / 2, 0)

  const housing = (x: number, y: number) => [
    box([0.3, 0.86, 0.2], [x, y, 0], HOUSING_COLOR),
    box([0.42, 0.98, 0.03], [x, y, -0.1], HOUSING_COLOR),
  ]

  return merge([
    colored(pole, POLE_COLOR),
    box([ARM_LENGTH, 0.07, 0.07], [ARM_LENGTH / 2, HIGH_LIGHTS + 0.5, 0], POLE_COLOR),
    box([0.05, 0.14, 0.05], [ARM_LENGTH, HIGH_LIGHTS + 0.45, 0], POLE_COLOR),
    ...housing(ARM_LENGTH, HIGH_LIGHTS),
    ...housing(0.2, LOW_LIGHTS),
  ])
}

const place = new THREE.Object3D()

function writePoleMatrices(mesh: THREE.InstancedMesh, posts: SignalPost[]) {
  posts.forEach(({ x, z, rotation }, index) => {
    place.position.set(x, 0, z)
    place.rotation.set(0, rotation, 0)
    place.scale.setScalar(1)
    place.updateMatrix()
    mesh.setMatrixAt(index, place.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function writeLampMatrices(mesh: THREE.InstancedMesh, posts: SignalPost[]) {
  const post = new THREE.Object3D()
  const lamp = new THREE.Object3D()
  post.add(lamp)

  posts.forEach(({ x, z, rotation }, postIndex) => {
    post.position.set(x, 0, z)
    post.rotation.set(0, rotation, 0)

    LAMPS.forEach((_, lampIndex) => {
      const offset = (1 - lampIndex) * LAMP_SPACING
      ;[
        [ARM_LENGTH, HIGH_LIGHTS],
        [0.2, LOW_LIGHTS],
      ].forEach(([sideways, height], set) => {
        lamp.position.set(sideways, height + offset, LAMP_FORWARD)
        post.updateMatrixWorld(true)
        const index = postIndex * LAMPS_PER_POST + set * LAMPS.length + lampIndex
        mesh.setMatrixAt(index, lamp.matrixWorld)
      })
    })
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

function writeStopLineMatrices(mesh: THREE.InstancedMesh, posts: SignalPost[]) {
  posts.forEach(({ stopX, stopZ, stopWidth, rotation }, index) => {
    place.position.set(stopX, STOP_LINE_HEIGHT, stopZ)
    place.rotation.set(0, rotation, 0)
    place.scale.set(stopWidth, 1, STOP_LINE_THICKNESS)
    place.updateMatrix()
    mesh.setMatrixAt(index, place.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
}

const lampColor = new THREE.Color()

/** Repaints a pole's lamps. Lights change every few seconds, so most frames skip this. */
function writeLampColors(mesh: THREE.InstancedMesh, postIndex: number, showing: SignalLight) {
  for (let set = 0; set < 2; set++) {
    LAMPS.forEach(({ light, on, off }, lampIndex) => {
      lampColor.set(light === showing ? on : off)
      mesh.setColorAt(postIndex * LAMPS_PER_POST + set * LAMPS.length + lampIndex, lampColor)
    })
  }
}

function updateLamps(
  mesh: THREE.InstancedMesh,
  { junctions, posts }: TrafficSignals,
  clock: number,
  shown: (SignalLight | null)[],
) {
  let changed = false

  posts.forEach(({ junction, group }, index) => {
    const showing = getLight(junctions[junction], group, clock)
    if (shown[index] === showing) return
    shown[index] = showing
    writeLampColors(mesh, index, showing)
    changed = true
  })

  if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** Poles, lamps and stop lines. What they show comes from the same clock traffic obeys. */
export function TrafficLights({ world }: { world: TrafficWorld }) {
  const { signals } = world
  const { posts } = signals
  const poleGeometry = useMemo(() => createPoleGeometry(), [])

  const poles = useRef<THREE.InstancedMesh>(null)
  const lamps = useRef<THREE.InstancedMesh>(null)
  const stopLines = useRef<THREE.InstancedMesh>(null)
  const shown = useRef<(SignalLight | null)[]>(posts.map(() => null))

  useEffect(() => () => poleGeometry.dispose(), [poleGeometry])

  useLayoutEffect(() => {
    if (poles.current) writePoleMatrices(poles.current, posts)
    if (lamps.current) writeLampMatrices(lamps.current, posts)
    if (stopLines.current) writeStopLineMatrices(stopLines.current, posts)
  }, [posts])

  useFrame(() => {
    if (lamps.current) updateLamps(lamps.current, signals, world.signalClock, shown.current)
  })

  if (posts.length === 0) return null

  return (
    <>
      <instancedMesh
        ref={poles}
        args={[poleGeometry, undefined, posts.length]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors roughness={0.6} metalness={0.3} />
      </instancedMesh>

      {/* Basic materials ignore the sun, which is what makes a lamp look lit. */}
      <instancedMesh ref={lamps} args={[undefined, undefined, posts.length * LAMPS_PER_POST]} frustumCulled={false}>
        <sphereGeometry args={[LAMP_RADIUS, 8, 5]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Like the road's own markings, this is drawn in front of the road by the depth test. */}
      <instancedMesh ref={stopLines} args={[undefined, undefined, posts.length]} frustumCulled={false} receiveShadow>
        <boxGeometry args={[1, 0.01, 1]} />
        <meshStandardMaterial
          color="#e6e4dc"
          roughness={0.8}
          polygonOffset
          polygonOffsetFactor={-8}
          polygonOffsetUnits={-8}
        />
      </instancedMesh>
    </>
  )
}
