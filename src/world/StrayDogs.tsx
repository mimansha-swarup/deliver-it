import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { timedFrame } from '../dev/frameTimes'
import { lifeCounts } from '../dev/lifeCounts'
import { useGameStore } from '../game/gameStore'
import { liveHorn, livePlayer } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { TrafficWorld } from '../traffic/trafficLogic'
import { groundLift } from './groundLift'
import { createDog } from './dogShape'
import { PAVEMENT_HEIGHT } from './surface'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('pedestrians')

/*
 * Stray dogs on the move (the ones asleep on the footpaths are story props: StoryProps.tsx). A
 * handful near the rider trot along the footpaths, stop to sniff about, and trot on; the horn
 * close by sends one off at a run. They keep to the footpath and are not solid: nobody can run a
 * dog over. One instanced shape, the sleeping dog's own, so one draw call for all of them.
 *
 * Within `ANIMATE` metres a dog is moved every frame and bobs as it trots; further off it's moved
 * ten times a second and doesn't bob. Low has two, the other qualities five.
 */

const COATS = ['#b98a5a', '#8a6a48', '#d8cdb8', '#4a4038', '#c9a878']
const ANIMATE = 60
const RING = { from: 45, to: 110, gone: 130 }
const PACE = { trot: 1.9, run: 4.6 }
/** The horn within this many metres startles a dog, for this many seconds. */
const HORN = { reach: 22, seconds: 3.5 }

type Dog = { lane: number; along: number; x: number; z: number; heading: number; pause: number; trotFor: number; startled: number; phase: number; owed: number }

const place = new THREE.Object3D()
const colour = new THREE.Color()

export function StrayDogs({ traffic }: { traffic: TrafficWorld }) {
  const count = useGameStore((state) => (QUALITY_PRESETS[state.quality].kitDetail === 0 ? 2 : 5))
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => createDog(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  /** The dogs: kept between frames, and made again if the quality changes how many there are. */
  const pack = useRef<Dog[]>([])
  const heard = useRef(0)
  const retry = useRef(0)

  useLayoutEffect(() => {
    if (!mesh.current) return
    // None is out yet: each copy is shrunk to nothing until its dog turns up.
    place.position.set(0, -50, 0)
    place.scale.setScalar(0)
    place.updateMatrix()
    for (let index = 0; index < count; index++) {
      mesh.current.setMatrixAt(index, place.matrix)
      mesh.current.setColorAt(index, colour.set(COATS[index % COATS.length]))
    }
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [count])

  useFrame((_, delta) => {
    if (!mesh.current) return
    if (pack.current.length !== count) pack.current = Array.from({ length: count }, (_, index) => ({ lane: -1, along: 0, x: 1e6, z: 1e6, heading: 0, pause: 0, trotFor: 4, startled: 0, phase: index * 1.7, owed: index * 0.02 }))
    const dogs = pack.current
    const step = Math.min(delta, 0.1)
    const lanes = traffic.walkLanes
    const honked = liveHorn.at !== heard.current
    heard.current = liveHorn.at
    retry.current -= step
    let out = 0
    let changed = false
    for (let index = 0; index < dogs.length; index++) {
      const dog = dogs[index]
      const away = Math.hypot(dog.x - livePlayer.x, dog.z - livePlayer.z)
      if (dog.lane === -1 || away > RING.gone) {
        // Off somewhere: it turns up again on a footpath a little way off, one try now and then.
        if (dog.lane !== -1) changed = true
        dog.lane = -1
        dog.x = 1e6
        if (retry.current > 0 || lanes.length === 0) continue
        retry.current = 0.5
        // Footpaths picked from the whole map, until one is in the ring round the rider: a couple of hundred looks is a few microseconds.
        let lane = -1
        for (let attempt = 0; attempt < 200 && lane === -1; attempt++) {
          const pick = Math.floor(Math.random() * lanes.length)
          const { startX, startZ, length } = lanes[pick]
          const distance = Math.hypot(startX - livePlayer.x, startZ - livePlayer.z)
          if (distance >= RING.from && distance <= RING.to && length >= 6) lane = pick
        }
        if (lane === -1) continue
        dog.lane = lane
        dog.along = Math.random() * lanes[lane].length
        dog.x = lanes[lane].startX + lanes[lane].forwardX * dog.along
        dog.z = lanes[lane].startZ + lanes[lane].forwardZ * dog.along
        dog.heading = Math.atan2(lanes[lane].forwardX, lanes[lane].forwardZ)
        dog.pause = 0
        dog.trotFor = 3 + Math.random() * 6
        continue
      }
      out++
      if (honked && away < HORN.reach) dog.startled = HORN.seconds
      // Far off, ten times a second.
      const near = away < ANIMATE
      dog.owed += step
      if (!near && dog.owed < 0.1) continue
      const dt = dog.owed
      dog.owed = 0
      changed = true
      dog.startled = Math.max(0, dog.startled - dt)
      let pace = 0
      if (dog.startled > 0) pace = PACE.run
      else if (dog.pause > 0) dog.pause -= dt
      else {
        pace = PACE.trot
        dog.trotFor -= dt
        if (dog.trotFor <= 0) {
          dog.pause = 1.5 + Math.random() * 5
          dog.trotFor = 3 + Math.random() * 7
        }
      }
      dog.along += pace * dt
      let lane = lanes[dog.lane]
      if (dog.along >= lane.length) {
        if (lane.next.length === 0) {
          dog.lane = -1
          continue
        }
        dog.lane = lane.next[Math.floor(Math.random() * lane.next.length)]
        dog.along = 0
        lane = lanes[dog.lane]
      }
      // A little further from the kerb than people walk, towards the walls.
      const toX = lane.startX + lane.forwardX * dog.along + lane.forwardZ * 0.45
      const toZ = lane.startZ + lane.forwardZ * dog.along - lane.forwardX * 0.45
      const ease = 1 - Math.exp(-dt * 6)
      const moveX = (toX - dog.x) * ease
      const moveZ = (toZ - dog.z) * ease
      dog.x += moveX
      dog.z += moveZ
      if (Math.hypot(moveX, moveZ) > 0.004) {
        const wanted = Math.atan2(moveX, moveZ)
        dog.heading += Math.atan2(Math.sin(wanted - dog.heading), Math.cos(wanted - dog.heading)) * Math.min(1, dt * 7)
      }
      dog.phase += pace * dt * 5.5
      // The trot: a small bob and rock, only where it can be seen. Standing, the head goes down to sniff.
      const bob = near && pace > 0 ? Math.abs(Math.sin(dog.phase)) * 0.035 : 0
      const rock = near ? (pace > 0 ? Math.sin(dog.phase) * 0.05 : 0.16) : 0
      place.position.set(dog.x, Math.max(PAVEMENT_HEIGHT, groundLift.at(dog.x, dog.z)) + bob, dog.z)
      place.rotation.set(rock, dog.heading, 0, 'YXZ')
      place.scale.setScalar(1)
      place.updateMatrix()
      mesh.current.setMatrixAt(index, place.matrix)
    }
    if (changed) {
      for (let index = 0; index < dogs.length; index++) {
        if (dogs[index].lane !== -1) continue
        place.position.set(0, -50, 0)
        place.scale.setScalar(0)
        place.updateMatrix()
        mesh.current.setMatrixAt(index, place.matrix)
      }
      mesh.current.instanceMatrix.needsUpdate = true
    }
    lifeCounts.dogs = out
  })

  return (
    <instancedMesh key={count} ref={mesh} args={[geometry, undefined, count]} frustumCulled={false}>
      <meshStandardMaterial vertexColors roughness={0.9} />
    </instancedMesh>
  )
}
