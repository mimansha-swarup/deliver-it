import { useEffect, useMemo, useRef } from 'react'
import { splitIntoSquares } from './splitGeometry'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { isDebug } from '../dev/spawn'
import { livePlayer, liveSky, liveView } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { ROAD_TEXTURES } from './assetUrls'
import { patchAsphalt } from './groundShaders'
import { useCompressedTextures } from './ktx2'
import { prepareSurfaceTextures } from './surfaceMaterial'
import { CONCRETE_PHOTO, createPlasterMaterial, preparePlasterPhoto } from './plaster'
import { addWeathering } from './weathering'
import { isInsideBounds } from './worldUtils'
import { PropInstances } from './RoadsideProps'
import { StiltParking } from './StiltParking'
import { box, colored, merge } from './simpleShapes'
import { createPosterAtlas, POSTER_COLUMNS, POSTER_ROWS } from './posters'
import { createBusGeometry } from '../traffic/bus'
import { BUS_STAND, heightOnFlyover, onAnotherDeck, RIDE_UNDER, pointOnPath, STAIR_RUN, STATION, type BusStand, type Flyover, type Flyovers, type Metro, type MetroStation } from './transitPlacement'

/*
 * Draws the metro planned in transitPlacement.ts: the tracks and overhead line on the viaduct's deck, the
 * stations with their stairs and escalators and name boards, the vendors' carts below, and the
 * trains running up and down the line, stopping at each station. All under the shared light; the
 * styling is the line's own yellow with a purple trim, as the city's metro is, without its name or logo.
 */

/** The deck's top (landmarkPlacement's viaduct: 12 m up, 1.6 m thick). */
const DECK_TOP = 13.6
/** The two tracks, either side of the line's middle. */
const TRACK = 1.9
const GAUGE = 1.435
const STEEL = '#5b5f63'
const CONCRETE = '#b3aea4'
const CONCRETE_DARK = '#8f8a81'
const PURPLE = '#6b3fa0'
const YELLOW = '#f2c12e'
const GLASS = '#3d4d58'
/** Overhead line masts along the deck, every this many path points (pillars, about 32 m apart). */
const MAST_EVERY = 2

/** Puts a shape made along +z at (x, y, z), turned to face `dirX, dirZ`. */
function along(geometry: THREE.BufferGeometry, x: number, y: number, z: number, dirX: number, dirZ: number) {
  return geometry.rotateY(Math.atan2(dirX, dirZ)).translate(x, y, z)
}

/** The tracks on the deck: concrete plinths, rails, and the overhead line's masts and wires. */
function createTrackGeometry(metro: Metro) {
  const parts: THREE.BufferGeometry[] = []
  const { points } = metro.path
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 0.5) continue
    const dirX = (bx - ax) / length
    const dirZ = (bz - az) / length
    const midX = (ax + bx) / 2
    const midZ = (az + bz) / 2
    for (const side of [-1, 1]) {
      parts.push(along(box([2.6, 0.25, length + 0.2], [side * TRACK, 0.125, 0], '#8c8780'), midX, DECK_TOP, midZ, dirX, dirZ))
      for (const rail of [-1, 1]) parts.push(along(box([0.08, 0.16, length + 0.2], [side * TRACK + (rail * GAUGE) / 2, 0.33, 0], STEEL), midX, DECK_TOP, midZ, dirX, dirZ))
      // The overhead wire, over each track.
      parts.push(along(box([0.03, 0.03, length + 0.2], [side * TRACK, 5.4, 0], '#2a2c2e'), midX, DECK_TOP, midZ, dirX, dirZ))
    }
    if (i % MAST_EVERY === 0) {
      // A mast at each edge of the deck, its arm reaching over the track.
      for (const side of [-1, 1]) {
        parts.push(along(box([0.22, 6.2, 0.22], [side * 4.0, 3.1, -length / 2], STEEL), midX, DECK_TOP, midZ, dirX, dirZ))
        parts.push(along(box([2.6, 0.12, 0.12], [side * 2.8, 5.6, -length / 2], STEEL), midX, DECK_TOP, midZ, dirX, dirZ))
      }
    }
  }
  return parts.length ? merge(parts) : null
}

/** A station: concourse over the road, platforms at the deck, the roof, columns, stairs and escalators. */
function createStationGeometry(station: MetroStation) {
  const parts: THREE.BufferGeometry[] = []
  const { x, z, dirX, dirZ, halfWidth } = station
  const width = halfWidth * 2
  const half = STATION.length / 2
  const add = (geometry: THREE.BufferGeometry) => parts.push(along(geometry, x, 0, z, dirX, dirZ))
  // The concourse: a slab over the road, glazed sides with a purple band, and its columns.
  add(box([width, 0.9, STATION.length], [0, STATION.concourse, 0], CONCRETE))
  for (const side of [-1, 1]) {
    add(box([0.2, 2.6, STATION.length - 2], [side * (halfWidth - 0.1), STATION.concourse + 1.75, 0], GLASS))
    add(box([0.24, 0.6, STATION.length], [side * (halfWidth - 0.1), STATION.concourse + 3.35, 0], PURPLE))
    add(box([0.26, 0.3, STATION.length], [side * (halfWidth - 0.1), STATION.concourse + 0.6, 0], YELLOW))
  }
  add(box([width, 0.4, STATION.length], [0, STATION.concourse + 3.85, 0], CONCRETE_DARK))
  for (let a = -half + 4; a <= half - 4; a += 12) {
    for (const side of [-1, 1]) add(box([1.0, STATION.concourse, 1.0], [side * (halfWidth - 1), STATION.concourse / 2, a], CONCRETE))
  }
  // The platforms, either side of the tracks at the deck, with a yellow edge line.
  for (const side of [-1, 1]) {
    add(box([4.2, DECK_TOP + 1 - STATION.concourse - 4.2, STATION.length], [side * 6.4, (STATION.concourse + 4.2 + DECK_TOP + 1) / 2, 0], CONCRETE_DARK))
    add(box([0.3, 0.02, STATION.length], [side * 4.5, DECK_TOP + 1.01, 0], YELLOW))
    // Glazed walls along the platforms' outer edges.
    add(box([0.15, 2.4, STATION.length - 2], [side * 8.45, DECK_TOP + 2.2, 0], GLASS))
  }
  // The roof, a shallow gable over both platforms, on columns, with a purple fascia.
  for (const side of [-1, 1]) {
    const roof = box([9.6, 0.35, STATION.length + 4], [side * 4.6, 0, 0], '#d9d6cf')
    roof.rotateZ(side * -0.08)
    roof.translate(0, STATION.roof, 0)
    add(roof)
    add(box([0.3, 1.0, STATION.length + 4], [side * 9.3, STATION.roof - 0.8, 0], PURPLE))
    for (let a = -half + 6; a <= half - 6; a += 12) add(box([0.5, STATION.roof - DECK_TOP - 1, 0.5], [side * 8.6, (STATION.roof + DECK_TOP + 1) / 2, a], '#c9c5bd'))
  }
  // Stairs and escalators down to each entrance, under a purple canopy.
  for (const entrance of station.entrances) {
    const flight: THREE.BufferGeometry[] = []
    const steps = 22
    for (let i = 0; i < steps; i++) {
      const rise = (STATION.concourse * (i + 1)) / steps
      flight.push(box([1.8, rise, STAIR_RUN / steps + 0.02], [-0.95, rise / 2, (STAIR_RUN * (i + 0.5)) / steps], '#a8a39a'))
    }
    // The escalator beside the stairs: a sloped trough with glass sides.
    const slope = Math.atan2(STATION.concourse, STAIR_RUN)
    const runLength = Math.hypot(STATION.concourse, STAIR_RUN)
    const escalator = box([1.2, 0.5, runLength], [0, 0, 0], '#3a3d42')
    escalator.rotateX(-slope).translate(1.1, STATION.concourse / 2, STAIR_RUN / 2)
    flight.push(escalator)
    for (const edge of [-1.9, 0.45, 1.75]) {
      const rail = box([0.06, 1.0, runLength], [0, 0, 0], edge === 0.45 ? '#7f8a90' : GLASS)
      rail.rotateX(-slope).translate(edge, STATION.concourse / 2 + 0.75, STAIR_RUN / 2)
      flight.push(rail)
    }
    const canopy = box([4.2, 0.15, runLength + 1], [0, 0, 0], PURPLE)
    canopy.rotateX(-slope).translate(0, STATION.concourse / 2 + 3, STAIR_RUN / 2)
    flight.push(canopy)
    // A landing at the top, and a short bridge across to the concourse.
    flight.push(box([4.2, 0.5, 3], [0, STATION.concourse, STAIR_RUN + 1.5], CONCRETE))
    const climb = Math.atan2(entrance.climbX, entrance.climbZ)
    for (const part of flight) parts.push(part.rotateY(climb).translate(entrance.x, 0, entrance.z))
    const topX = entrance.x + entrance.climbX * (STAIR_RUN + 1.5)
    const topZ = entrance.z + entrance.climbZ * (STAIR_RUN + 1.5)
    const acrossX = dirZ * entrance.side
    const acrossZ = -dirX * entrance.side
    const out = (topX - x) * acrossX + (topZ - z) * acrossZ
    const gap = out - halfWidth
    if (gap > 0.5) {
      const bridge = box([gap + 1, 0.5, 3.6], [0, STATION.concourse, 0], CONCRETE)
      bridge.rotateY(Math.atan2(acrossX, acrossZ) + Math.PI / 2).translate(topX - acrossX * (gap / 2), 0, topZ - acrossZ * (gap / 2))
      parts.push(bridge)
    }
  }
  return merge(parts)
}

/** The station's name board: the line's yellow, the name in Kannada over English, and a round metro mark. */
function createNameTexture(station: MetroStation): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 192
  const paint = () => {
    const context = canvas.getContext('2d')!
    context.fillStyle = PURPLE
    context.fillRect(0, 0, 1024, 192)
    context.fillStyle = YELLOW
    context.fillRect(0, 168, 1024, 24)
    // A round mark with an M: the city's metro, not its logo.
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(96, 86, 62, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = PURPLE
    context.font = `800 84px 'Baloo Tamma 2', system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('M', 96, 92)
    context.fillStyle = '#ffffff'
    context.textAlign = 'left'
    context.font = `700 62px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(station.nameKannada || station.name, 190, 58, 800)
    context.font = `800 58px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(station.name, 190, 128, 800)
  }
  paint()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  document.fonts?.load(`700 62px 'Baloo Tamma 2'`, station.nameKannada + station.name).then(() => {
    paint()
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** The name boards on each long side of the concourse, and over each stair. */
function StationBoards({ station }: { station: MetroStation }) {
  const texture = useMemo(() => createNameTexture(station), [station])
  useEffect(() => () => texture.dispose(), [texture])
  const turn = Math.atan2(station.dirX, station.dirZ)
  return (
    <group position={[station.x, 0, station.z]} rotation-y={turn}>
      {[-1, 1].flatMap((side) =>
        [-STATION.length / 4, STATION.length / 4].map((a) => (
          <mesh key={`${side} ${a}`} position={[side * (station.halfWidth + 0.06), STATION.concourse + 2.2, a]} rotation-y={(side * Math.PI) / 2}>
            <planeGeometry args={[12, 2.25]} />
            <meshStandardMaterial map={texture} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

/** A vendor's cart: a wooden barrow of fruit under a striped umbrella, along +x. */
function createCartGeometry() {
  const fruit = ['#e2502b', '#f2b705', '#7cae3a', '#d9473c']
  const umbrella = new THREE.ConeGeometry(1.3, 0.5, 8, 1, true).toNonIndexed()
  umbrella.translate(0, 2.25, 0)
  return merge([
    box([1.8, 0.12, 0.9], [0, 0.85, 0], '#7a5230'),
    box([1.8, 0.2, 0.06], [0, 0.98, 0.42], '#6a4528'),
    box([1.8, 0.2, 0.06], [0, 0.98, -0.42], '#6a4528'),
    ...[-0.75, 0.75].map((x) => box([0.06, 0.85, 0.06], [x, 0.42, 0], '#3a2c20')),
    ...fruit.map((color, i) => box([0.38, 0.16, 0.7], [-0.6 + i * 0.4, 1.0, 0], color)),
    box([0.05, 1.4, 0.05], [0.7, 1.55, 0], '#4a4d51'),
    colored(umbrella, '#d8462f'),
  ])
}

// ---- Trains ----

/** A car of the train, along +z: a steel body with dark windows, the line's yellow band and the purple trim, a nose at each end. */
function createCarGeometry() {
  const length = 20.6
  return merge([
    box([2.86, 3.3, length], [0, 2.15, 0], '#c8ccd0'),
    box([2.9, 1.0, length - 3], [0, 2.75, 0], '#2a3239'),
    box([2.92, 0.32, length], [0, 1.25, 0], YELLOW),
    box([2.92, 0.12, length], [0, 1.0, 0], PURPLE),
    box([2.4, 0.35, length - 4], [0, 3.95, 0], '#9aa0a6'),
    box([2.5, 0.6, length - 2], [0, 0.4, 0], '#3d4044'),
    // The ends: dark windscreens and a yellow lower face.
    ...[-1, 1].flatMap((end) => [box([2.4, 1.0, 0.08], [0, 2.85, end * (length / 2 + 0.02)], '#1d2328'), box([2.6, 0.8, 0.1], [0, 1.4, end * (length / 2 + 0.03)], YELLOW)]),
  ])
}

const CARS = 3
const CAR_SPACING = 21.2
/** Top speed and braking, in m/s and m/s², how long it waits at a station, and between trains, in seconds. */
const TRAIN = { speed: 16, braking: 0.9, dwell: 16, gapMin: 35, gapMax: 80 }

type Train = { direction: 1 | -1; s: number; speed: number; waiting: number; dwell: number; served: Set<number> }

function newTrain(direction: 1 | -1, length: number, delay: number): Train {
  return { direction, s: direction > 0 ? -CARS * CAR_SPACING : length + CARS * CAR_SPACING, speed: TRAIN.speed, waiting: delay, dwell: 0, served: new Set() }
}

/** Moves a train one step: running between stations, slowing to stop at each, waiting, then on; off the line's end, it waits a while and comes back the other way. */
function stepTrain(train: Train, stops: number[], length: number, delta: number, random: () => number) {
  if (train.waiting > 0) {
    train.waiting -= delta
    return
  }
  if (train.dwell > 0) {
    train.dwell -= delta
    return
  }
  // The next station ahead, where the train's middle stops.
  const ahead = stops
    .map((stop, i) => ({ stop, i }))
    .filter(({ stop, i }) => !train.served.has(i) && (stop - train.s) * train.direction > -1)
    .sort((a, b) => (a.stop - b.stop) * train.direction)[0]
  const head = train.s
  let target = TRAIN.speed
  if (ahead) {
    const distance = (ahead.stop - head) * train.direction
    target = Math.min(TRAIN.speed, Math.sqrt(Math.max(0, 2 * TRAIN.braking * distance)) + 0.4)
    if (distance < 0.6) {
      train.served.add(ahead.i)
      train.dwell = TRAIN.dwell
      train.speed = 0
      return
    }
  }
  train.speed = train.speed < target ? Math.min(target, train.speed + 0.8 * delta) : target
  train.s += train.direction * train.speed * delta
  const gone = train.direction > 0 ? train.s > length + CARS * CAR_SPACING : train.s < -CARS * CAR_SPACING
  if (gone) Object.assign(train, newTrain(train.direction === 1 ? -1 : 1, length, TRAIN.gapMin + random() * (TRAIN.gapMax - TRAIN.gapMin)))
}

const carTransform = new THREE.Object3D()

/** How the concrete photo is laid on the flyovers, the metro's viaduct and the bus stand: metres a repeat, and how strongly. */
const TRANSIT_CONCRETE = { tile: 4, strength: 1.6 }
/** And how weathered they are: rain streaks and grime, a little more than a house's walls. */
const TRANSIT_WEATHER = 0.6

/**
 * Cast concrete for everything here that's built from coloured boxes (flyover decks, pillars and
 * barriers, the viaduct, stations, the bus stand): the kerbs' concrete photo laid on by position
 * (plaster.ts), and the houses' grime and streaks (weathering.ts). They had only their flat colour,
 * and a flyover was the largest plain surface in the city. Low keeps flat paint, as everywhere.
 */
function useConcrete(settings: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const photo = useTexture(CONCRETE_PHOTO, preparePlasterPhoto)
  const material = useMemo(() => {
    const made = surfaces === 'plain' ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, ...settings }) : createPlasterMaterial(photo, TRANSIT_CONCRETE, { roughness: 0.9, ...settings })
    addWeathering(made, { weather: TRANSIT_WEATHER })
    return made
    // The settings are the same object's worth each time: only the photo and the quality change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, surfaces])
  useEffect(() => () => material.dispose(), [material])
  return material
}

function MetroTrains({ metro }: { metro: Metro }) {
  const geometry = useMemo(() => createCarGeometry(), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }), [])
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const trains = useRef<Train[]>([newTrain(1, metro.path.length, 4), newTrain(-1, metro.path.length, 30)])
  const stops = useMemo(() => metro.stations.map((station) => station.along), [metro])
  // Debug: the trains, to move from the console or a script (`__deliverItTrains`, with ?debug).
  useEffect(() => {
    if (isDebug()) (window as unknown as { __deliverItTrains?: Train[] }).__deliverItTrains = trains.current
  }, [])

  useFrame((_, rawDelta) => {
    const instances = mesh.current
    if (!instances) return
    const delta = Math.min(rawDelta, 0.1)
    let count = 0
    for (const train of trains.current) {
      stepTrain(train, stops, metro.path.length, delta, Math.random)
      if (train.waiting > 0) continue
      for (let car = 0; car < CARS; car++) {
        // The train's middle is at `s`; cars either side of it.
        const s = train.s + (car - (CARS - 1) / 2) * CAR_SPACING * train.direction
        if (s < 0 || s > metro.path.length) continue
        const { x, z, dirX, dirZ } = pointOnPath(metro.path, s)
        const side = -train.direction * TRACK
        carTransform.position.set(x + dirZ * side, DECK_TOP + 0.45, z - dirX * side)
        carTransform.rotation.set(0, Math.atan2(dirX, dirZ), 0)
        carTransform.updateMatrix()
        instances.setMatrixAt(count++, carTransform.matrix)
      }
    }
    instances.count = count
    instances.instanceMatrix.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[geometry, material, 2 * CARS]} frustumCulled={false} castShadow receiveShadow />
}

// ---- Flyovers ----

/** The deck's underside, in shade: darker than the girders, which catch the light bounced off the road. */
const SOFFIT = '#5d5952'
const GIRDER = '#b4afa5'
const GIRDER_FLANGE = '#c4bfb5'

/** A drainpipe along the underside, `length` long, `x` across and `y` below the deck. */
function pipeAlong(length: number, x: number, y: number) {
  const pipe = new THREE.CylinderGeometry(0.13, 0.13, length, 6).toNonIndexed().rotateX(Math.PI / 2)
  return colored(pipe.translate(x, y, 0), '#2f3133')
}

/** A flyover's deck in sloped pieces: a concrete body, the asphalt on top, crash barriers each side. */
function createDeckGeometry(deck: Flyover) {
  const parts: THREE.BufferGeometry[] = []
  const { points } = deck.path
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const ay = deck.heights[i - 1]
    const by = deck.heights[i]
    const flat = Math.hypot(bx - ax, bz - az)
    // Only within 300 m of the map: the Electronic City road runs on for kilometres.
    if (flat < 0.3 || (!isInsideBounds(ax, az, -300) && !isInsideBounds(bx, bz, -300))) continue
    const length = Math.hypot(flat, by - ay) + 0.4
    const pitch = Math.atan2(by - ay, flat)
    const yaw = Math.atan2(bx - ax, bz - az)
    const place = (geometry: THREE.BufferGeometry) => parts.push(geometry.rotateX(-pitch).rotateY(yaw).translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2))
    place(box([deck.width, 0.5, length], [0, -0.3, 0], CONCRETE))
    // Underneath, where it can be ridden under: a darker soffit, girders along it, a cross beam at
    // each joint and a drainpipe along the outer girder, so it doesn't read as one flat slab.
    if (Math.min(ay, by) >= RIDE_UNDER - 0.5) {
      place(box([deck.width - 0.2, 0.06, length], [0, -0.53, 0], SOFFIT))
      const girders = Math.max(2, Math.round(deck.width / 3.2))
      for (let g = 0; g < girders; g++) {
        const x = ((g + 0.5) / girders - 0.5) * (deck.width - 1.4)
        place(box([0.45, 1.1, length], [x, -1.05, 0], GIRDER))
        place(box([0.9, 0.18, length], [x, -1.6, 0], GIRDER_FLANGE))
      }
      place(box([deck.width - 1.2, 0.9, 0.35], [0, -0.95, length / 2 - 0.2], GIRDER))
      place(pipeAlong(length, (deck.width / 2 - 0.9) * (i % 2 === 0 ? 1 : 1), -1.25))
    } else {
      place(box([deck.width, 0.7, length], [0, -0.85, 0], CONCRETE))
    }
    // Where it's too low to ride under, the ramp is a solid embankment between retaining walls.
    const fill = (ay + by) / 2 - 0.9
    if (Math.min(ay, by) < RIDE_UNDER && fill > 0.05) {
      parts.push(box([deck.width - 0.1, fill, Math.max(0.5, flat)], [0, fill / 2, 0], CONCRETE_DARK).rotateY(yaw).translate((ax + bx) / 2, 0, (az + bz) / 2))
    }
  }
  return parts
}

/** A pillar under a flyover: a column and a cap across the deck. */
function createFlyoverPillar({ x, z, rotation, height, width }: Flyovers['pillars'][number]) {
  return [
    box([1.6, height - 1.2, 1.6], [0, (height - 1.2) / 2, 0], CONCRETE),
    box([Math.min(width * 0.8, 9), 1.0, 2.2], [0, height - 1.7, 0], CONCRETE_DARK),
  ].map((part) => part.rotateY(rotation).translate(x, 0, z))
}

/** Posters pasted on some pillars, from the posters' picture (posters.ts), on two faces. */
function createPillarPosters(pillars: Flyovers['pillars']) {
  const parts: THREE.BufferGeometry[] = []
  for (const pillar of pillars) {
    if (pillar.poster < 0) continue
    const column = pillar.poster % POSTER_COLUMNS
    const row = Math.floor(pillar.poster / POSTER_COLUMNS) % POSTER_ROWS
    for (const side of [-1, 1]) {
      const plane = new THREE.PlaneGeometry(1.2, 1.7).toNonIndexed()
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (column + uv.getX(i)) / POSTER_COLUMNS, 1 - (row + 1 - uv.getY(i)) / POSTER_ROWS)
      plane.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2).translate(side * 0.81, 2.1, 0).rotateY(pillar.rotation).translate(pillar.x, 0, pillar.z)
      parts.push(plane)
    }
  }
  return parts.length ? merge(parts) : null
}

/** A tea stall under the flyover, its counter to +z: a tin-roofed kiosk, kettle on the stove, glasses, two stools. */
function createTeaStallGeometry() {
  const roof = box([2.6, 0.06, 2.2], [0, 2.35, 0.2], '#8a7f74')
  roof.rotateX(0.08)
  return merge([
    box([2.2, 1.0, 1.4], [0, 0.5, 0], '#2f6f8f'),
    box([2.3, 0.08, 1.5], [0, 1.04, 0.05], '#c9b38a'),
    ...[-1.05, 1.05].map((x) => box([0.07, 2.3, 0.07], [x, 1.15, 0.65], '#4a4d51')),
    ...[-1.05, 1.05].map((x) => box([0.07, 2.3, 0.07], [x, 1.15, -0.65], '#4a4d51')),
    roof,
    box([0.32, 0.3, 0.32], [-0.6, 1.25, 0.2], '#b8b4ac'),
    box([0.08, 0.12, 0.08], [0.1, 1.14, 0.45], '#d8d0b8'),
    box([0.08, 0.12, 0.08], [0.25, 1.14, 0.45], '#d8d0b8'),
    box([1.6, 0.35, 0.05], [0, 2.1, 0.78], '#e2a12a'),
    ...[-0.6, 0.6].map((x) => box([0.35, 0.45, 0.35], [x, 0.22, 1.4], '#c62f2f')),
  ])
}

/** Simple vehicles for the traffic overhead, along +z, white so each takes its copy's colour: a car and a bus. */
const OVERHEAD_KINDS = [
  { body: [1.75, 0.8, 4.2], cabin: [1.6, 0.6, 2.2], share: 0.7, colors: ['#e8e6e0', '#9aa0a6', '#2d5fa8', '#c62828', '#3a3c40', '#d6c9a8'] },
  { body: [1.45, 0.9, 2.7], cabin: [1.35, 0.6, 1.6], share: 0.2, colors: ['#e6c22e', '#3d8a45'] },
  { body: [2.5, 2.6, 11], cabin: [2.4, 0.2, 10], share: 0.1, colors: ['#2f7a4a', '#2d5fa8', '#c8a23a'] },
] as const

function createOverheadGeometry(kind: (typeof OVERHEAD_KINDS)[number]) {
  const [w, h, l] = kind.body
  const [cw, ch, cl] = kind.cabin
  return merge([box([w, h, l], [0, 0.35 + h / 2, 0], '#ffffff'), box([cw, ch, cl], [0, 0.35 + h + ch / 2, -l * 0.05], '#3a4148'), box([w + 0.02, 0.3, l * 0.9], [0, 0.35 + h * 0.75, 0], '#2b3238')])
}

type Overhead = { deck: number; s: number; speed: number; direction: 1 | -1; lane: number; kind: number }

const overheadTransform = new THREE.Object3D()

/**
 * Beyond the traffic's own reach (trafficLogic.ts removes vehicles 220 m from the rider), the decks'
 * traffic is these simple stand-ins; nearer, it's real traffic on the decks' lanes.
 */
const STAND_IN_FROM = 210

/** Traffic on the flyovers far off: each deck a stream of vehicles each way (one way on one-way decks), seen only where it's up off the ground. */
function FlyoverTraffic({ decks }: { decks: Flyover[] }) {
  const geometries = useMemo(() => OVERHEAD_KINDS.map(createOverheadGeometry), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.15 }), [])
  useEffect(() => () => {
    geometries.forEach((geometry) => geometry.dispose())
    material.dispose()
  }, [geometries, material])
  const vehicles = useMemo(() => {
    const list: Overhead[] = []
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    decks.forEach((deck, index) => {
      const count = Math.min(24, Math.round(deck.path.length / 40))
      for (let i = 0; i < count; i++) {
        const direction: 1 | -1 = deck.oneWay || i % 2 === 0 ? 1 : -1
        const roll = random()
        const kind = roll < OVERHEAD_KINDS[0].share ? 0 : roll < OVERHEAD_KINDS[0].share + OVERHEAD_KINDS[1].share ? 1 : 2
        const lanes = Math.max(1, Math.floor(deck.width / 3.5 / (deck.oneWay ? 1 : 2)))
        list.push({ deck: index, s: random() * deck.path.length, speed: 10 + random() * 6, direction, lane: Math.floor(random() * lanes), kind })
      }
    })
    return list
  }, [decks])
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  /** Where each vehicle is along its deck now; they start where `vehicles` says. */
  const positions = useRef<number[]>([])
  useEffect(() => {
    positions.current = vehicles.map((vehicle) => vehicle.s)
  }, [vehicles])

  useEffect(() => {
    meshes.current.forEach((mesh, kind) => {
      if (!mesh) return
      const colors = OVERHEAD_KINDS[kind].colors
      for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [vehicles])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1)
    const counts = OVERHEAD_KINDS.map(() => 0)
    vehicles.forEach((vehicle, index) => {
      const deck = decks[vehicle.deck]
      const s = ((positions.current[index] ?? vehicle.s) + vehicle.direction * vehicle.speed * delta + deck.path.length) % deck.path.length
      positions.current[index] = s
      const height = heightOnFlyover(deck, s)
      if (height < 1.5) return
      const mesh = meshes.current[vehicle.kind]
      const { x, z, dirX, dirZ } = pointOnPath(deck.path, s)
      // Near the rider, the real traffic drives the decks (deckLanes.ts): these stand-ins are only for further off.
      if (Math.hypot(x - livePlayer.x, z - livePlayer.z) < STAND_IN_FROM) return
      if (!mesh) return
      // Lanes from the deck's middle out: on a two-way deck, each way on its own (left) side.
      const half = deck.width / 2 - 1.8
      const offset = deck.oneWay ? -half + 1.75 + vehicle.lane * 3.5 : (1.75 + vehicle.lane * 3.5) * -vehicle.direction
      overheadTransform.position.set(x + dirZ * Math.max(-half, Math.min(half, offset)), height, z - dirX * Math.max(-half, Math.min(half, offset)))
      overheadTransform.rotation.set(0, Math.atan2(dirX, dirZ) + (vehicle.direction < 0 ? Math.PI : 0), 0)
      overheadTransform.updateMatrix()
      mesh.setMatrixAt(counts[vehicle.kind]++, overheadTransform.matrix)
    })
    meshes.current.forEach((mesh, kind) => {
      if (!mesh) return
      mesh.count = counts[kind]
      mesh.instanceMatrix.needsUpdate = true
    })
  })

  return (
    <>
      {geometries.map((geometry, kind) => (
        <instancedMesh
          key={kind}
          ref={(mesh) => {
            meshes.current[kind] = mesh
          }}
          args={[geometry, material, Math.max(1, vehicles.filter((vehicle) => vehicle.kind === kind).length)]}
          frustumCulled={false}
          castShadow
        />
      ))}
    </>
  )
}

/** A row of striped crash barriers across the foot of a ramp. */
function createRampBarrier({ x, z, rotation, width }: Flyovers['barriers'][number]) {
  const parts: THREE.BufferGeometry[] = []
  const blocks = Math.max(2, Math.round(width / 1.2))
  for (let i = 0; i < blocks; i++) {
    const across = (i + 0.5) * (width / blocks) - width / 2
    parts.push(box([width / blocks - 0.08, 0.85, 0.6], [across, 0.42, 0], i % 2 === 0 ? YELLOW : '#26262a'))
  }
  return parts.map((part) => part.rotateY(rotation).translate(x, 0, z))
}

/**
 * A deck's top as one continuous ribbon, every point of its path at that point's height, so the
 * surface has no steps: the road's asphalt (uv in metres, and the asphalt shader's `aAcross`,
 * `aHalf` and `aKerb`), lane markings over it, and a concrete crash barrier along each edge, all
 * following the same heights the scooter rides on.
 */
function createDeckSurfaces(decks: Flyover[]) {
  const asphalt = { position: [] as number[], normal: [] as number[], uv: [] as number[], across: [] as number[], half: [] as number[], kerb: [] as number[], index: [] as number[] }
  const solids: THREE.BufferGeometry[] = []
  for (const deck of decks) {
    const { points, at } = deck.path
    if (points.length < 2) continue
    const half = deck.width / 2 - BARRIER.width
    // Directions at each point: the average of the segments either side, so the ribbon bends smoothly.
    const sides = points.map((_, i) => {
      const [ax, az] = points[Math.max(0, i - 1)]
      const [bx, bz] = points[Math.min(points.length - 1, i + 1)]
      const length = Math.hypot(bx - ax, bz - az) || 1
      return [(bz - az) / length, -(bx - ax) / length]
    })
    const inMap = (i: number) => isInsideBounds(points[i][0], points[i][1], -300)
    const first = asphalt.position.length / 3
    let count = 0
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i]
      const [sx, sz] = sides[i]
      const y = deck.heights[i] + 0.04
      for (const side of [-1, 1]) {
        asphalt.position.push(x + sx * half * side, y, z + sz * half * side)
        asphalt.normal.push(0, 1, 0)
        asphalt.uv.push(half * side, at[i])
        asphalt.across.push(half * side)
        asphalt.half.push(half)
        asphalt.kerb.push(1, 1)
      }
      if (i > 0 && (inMap(i) || inMap(i - 1))) {
        const a = first + (i - 1) * 2
        const b = first + i * 2
        // Wound to face up (seen from above).
        asphalt.index.push(a, b, a + 1, a + 1, b, b + 1)
      }
      count++
    }
    void count

    // Markings: dashed lane lines (one per 3.5 m lane, a solid centre line on two-way decks) and edge lines.
    const lanes = Math.max(1, Math.round((half * 2) / 3.5))
    const lines: { offset: number; dashed: boolean }[] = [
      { offset: -half + 0.25, dashed: false },
      { offset: half - 0.25, dashed: false },
    ]
    for (let lane = 1; lane < lanes; lane++) {
      const offset = -half + (lane * half * 2) / lanes
      lines.push({ offset, dashed: !(!deck.oneWay && lane * 2 === lanes) })
    }
    for (let i = 1; i < points.length; i++) {
      if (!inMap(i) && !inMap(i - 1)) continue
      for (const { offset, dashed } of lines) {
        // Dashes 3 m on, 5 m off, by distance along the deck.
        const from = at[i - 1]
        const to = at[i]
        const pieces: [number, number][] = []
        if (!dashed) pieces.push([from, to])
        else for (let d = Math.floor(from / 8) * 8; d < to; d += 8) pieces.push([Math.max(from, d), Math.min(to, d + 3)])
        for (const [p0, p1] of pieces) {
          if (p1 - p0 < 0.05) continue
          const quad = (p: number) => {
            const t = (p - from) / (to - from || 1)
            const x = points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t
            const z = points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t
            const y = deck.heights[i - 1] + (deck.heights[i] - deck.heights[i - 1]) * t + 0.06
            const sx = sides[i - 1][0] + (sides[i][0] - sides[i - 1][0]) * t
            const sz = sides[i - 1][1] + (sides[i][1] - sides[i - 1][1]) * t
            return [x + sx * offset, y, z + sz * offset, sx, sz] as const
          }
          const [ax, ay, az, asx, asz] = quad(p0)
          const [bx, by, bz, bsx, bsz] = quad(p1)
          const w = 0.07
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.Float32BufferAttribute([
            ax - asx * w, ay, az - asz * w, bx + bsx * w, by, bz + bsz * w, ax + asx * w, ay, az + asz * w,
            ax - asx * w, ay, az - asz * w, bx - bsx * w, by, bz - bsz * w, bx + bsx * w, by, bz + bsz * w,
          ], 3))
          g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
          solids.push(colored(g, offset === -half + 0.25 || offset === half - 0.25 ? '#d8d3c4' : dashed ? '#d8d3c4' : '#d9b23a'))
        }
      }
    }

    // The crash barriers: a continuous low wall along each edge, following the heights.
    for (const side of [-1, 1]) {
      const pos: number[] = []
      for (let i = 1; i < points.length; i++) {
        if (!inMap(i) && !inMap(i - 1)) continue
        // No barrier where this edge lies on another deck's roadway: there the two flyovers join (transitPlacement.ts).
        {
          const o = side * (deck.width / 2 - BARRIER.width / 2)
          const mx = (points[i - 1][0] + points[i][0]) / 2 + ((sides[i - 1][0] + sides[i][0]) / 2) * o
          const mz = (points[i - 1][1] + points[i][1]) / 2 + ((sides[i - 1][1] + sides[i][1]) / 2) * o
          if (onAnotherDeck(decks, deck, mx, mz, (deck.heights[i - 1] + deck.heights[i]) / 2)) continue
        }
        const corner = (k: number, out: number, up: number) => {
          const [x, z] = points[k]
          const [sx, sz] = sides[k]
          const o = side * (deck.width / 2 - out)
          return [x + sx * o, deck.heights[k] + up, z + sz * o]
        }
        // Inner face, top and outer face, each a quad between points i - 1 and i. The outer face
        // comes down over the edge of the deck's slab, so it stands a little proud of it (`PROUD`):
        // flush with the slab's own side, the two fought for the same place and the wall flickered
        // in a band along every flyover.
        const faces: [number, number, number, number][] = [
          [BARRIER.width, 0, BARRIER.width, BARRIER.height],
          [BARRIER.width, BARRIER.height, -PROUD, BARRIER.height],
          [-PROUD, BARRIER.height, -PROUD, -0.5],
        ]
        for (const [o0, u0, o1, u1] of faces) {
          const a0 = corner(i - 1, o0, u0)
          const a1 = corner(i - 1, o1, u1)
          const b0 = corner(i, o0, u0)
          const b1 = corner(i, o1, u1)
          // Faces outwards from the barrier on the right; mirrored, the other way round on the left.
          if (side > 0) pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
          else pos.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0)
        }
      }
      if (pos.length === 0) continue
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.computeVertexNormals()
      solids.push(colored(g, CONCRETE_DARK))
    }
  }
  // Street lights along the decks where they're up off the ground: a post on alternate barriers
  // every DECK_LIGHT_EVERY metres, with an arm over the road and a head that glows after dark.
  const heads: THREE.BufferGeometry[] = []
  for (const deck of decks) {
    const { points, at } = deck.path
    let next = DECK_LIGHT_EVERY / 2
    let lamp = 0
    for (let i = 1; i < points.length - 1; i++) {
      if (at[i] < next) continue
      next = at[i] + DECK_LIGHT_EVERY
      if (deck.heights[i] < RIDE_UNDER || !isInsideBounds(points[i][0], points[i][1], 4)) continue
      const [x, z] = points[i]
      const [bx, bz] = points[i + 1]
      const length = Math.hypot(bx - x, bz - z) || 1
      const dirX = (bx - x) / length
      const dirZ = (bz - z) / length
      const side = lamp++ % 2 === 0 ? 1 : -1
      const turn = Math.atan2(dirX, dirZ)
      const base = deck.heights[i] + BARRIER.height
      const out = side * (deck.width / 2 - BARRIER.width / 2)
      const place = (geometry: THREE.BufferGeometry) => geometry.rotateY(turn).translate(x, 0, z)
      solids.push(place(box([0.12, DECK_LIGHT_HEIGHT, 0.12], [out, base + DECK_LIGHT_HEIGHT / 2, 0], '#6d7074')))
      solids.push(place(box([1.5, 0.08, 0.08], [out - side * 0.75, base + DECK_LIGHT_HEIGHT, 0], '#6d7074')))
      heads.push(place(box([0.55, 0.12, 0.26], [out - side * 1.4, base + DECK_LIGHT_HEIGHT - 0.08, 0], '#fff1cc')))
    }
  }

  const surface = new THREE.BufferGeometry()
  surface.setAttribute('position', new THREE.Float32BufferAttribute(asphalt.position, 3))
  surface.setAttribute('normal', new THREE.Float32BufferAttribute(asphalt.normal, 3))
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(asphalt.uv, 2))
  surface.setAttribute('aAcross', new THREE.Float32BufferAttribute(asphalt.across, 1))
  surface.setAttribute('aHalf', new THREE.Float32BufferAttribute(asphalt.half, 1))
  surface.setAttribute('aKerb', new THREE.Float32BufferAttribute(asphalt.kerb, 2))
  surface.setIndex(asphalt.index)
  surface.computeBoundingSphere()
  return { surface, details: solids.length ? merge(solids) : null, lights: heads.length ? merge(heads) : null, lightCount: heads.length }
}

/** A street light on the decks every this many metres, on posts this tall above the barrier. */
const DECK_LIGHT_EVERY = 32
const DECK_LIGHT_HEIGHT = 6.2
/** The decks' lamp heads, lit at dusk with the street lamps: one material, brightened by the frame loop. */
const deckLightMaterial = new THREE.MeshStandardMaterial({ color: '#d8d2c2', emissive: '#ffe2a8', emissiveIntensity: 0, roughness: 0.6 })

/** The crash barriers along a deck's edges: how thick and high, in metres. */
const BARRIER = { width: 0.35, height: 0.95 }
/** How far a barrier's outer face stands out past the deck's edge, in metres. */
const PROUD = 0.03

/** Metres per repeat of the road photo: the same as the streets' (StreetEdges.tsx), as they share it. */
const DECK_ASPHALT_TILE = 6
const prepareDeckAsphalt = (maps: THREE.Texture[]) => prepareSurfaceTextures(maps, DECK_ASPHALT_TILE)

function FlyoverScenery({ flyovers }: { flyovers: Flyovers }) {
  const { surfaces } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const roadMaps = useCompressedTextures(ROAD_TEXTURES, prepareDeckAsphalt)
  const deckTop = useMemo(() => createDeckSurfaces(flyovers.decks), [flyovers])
  const asphalt = useMemo(() => {
    // As the streets' asphalt (StreetEdges.tsx): the photo's grain under the palette's colour, tyre
    // tracks, a gutter by each barrier.
    const material = new THREE.MeshStandardMaterial({
      map: roadMaps[0],
      normalMap: surfaces === 'bumps' ? roadMaps[1] : null,
      roughness: 0.92,
    })
    patchAsphalt(material)
    return material
  }, [roadMaps, surfaces])
  useEffect(() => () => {
    deckTop.surface.dispose()
    deckTop.details?.dispose()
    deckTop.lights?.dispose()
  }, [deckTop])
  useEffect(() => () => asphalt.dispose(), [asphalt])
  // The decks' lamps come on at dusk.
  useFrame(() => {
    deckLightMaterial.emissiveIntensity = liveSky.look.night * 2.4
  })
  const structure = useMemo(() => {
    const parts = [...flyovers.decks.flatMap(createDeckGeometry), ...flyovers.pillars.flatMap(createFlyoverPillar), ...flyovers.barriers.flatMap(createRampBarrier)]
    return parts.length ? merge(parts) : null
  }, [flyovers])
  const structureSquares = useMemo(() => (structure ? splitIntoSquares(structure.clone()) : null), [structure])
  const detailSquares = useMemo(() => (deckTop.details ? splitIntoSquares(deckTop.details.clone()) : null), [deckTop])
  const posters = useMemo(() => createPillarPosters(flyovers.pillars), [flyovers])
  const atlas = useMemo(() => createPosterAtlas(), [])
  const stall = useMemo(() => createTeaStallGeometry(), [])
  const material = useConcrete()
  useEffect(() => () => {
    for (const thing of [structure, posters, atlas, stall]) thing?.dispose()
  }, [structure, posters, atlas, stall])
  return (
    <>
      {/* In map squares, so only what's near and in view is drawn (and shadowed): whole, the flyovers were a quarter of a million triangles from anywhere on the map. */}
      {structureSquares && <Squares geometries={structureSquares} material={material} />}
      <mesh geometry={deckTop.surface} material={asphalt} receiveShadow />
      {detailSquares && <Squares geometries={detailSquares} material={material} />}
      {deckTop.lights && <mesh geometry={deckTop.lights} material={deckLightMaterial} />}
      {posters && (
        <mesh geometry={posters}>
          <meshStandardMaterial map={atlas} roughness={0.85} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      <PropInstances props={flyovers.stalls} geometry={stall} sizeRange={0} vertexColors to={160} />
      <StiltParking vehicles={flyovers.bikes} drawDistance={90} />
      <FlyoverTraffic decks={flyovers.decks} />
    </>
  )
}

// ---- The bus stand ----

const BUS_GREEN = '#1f6b3f'
const STAND_BUS_COLORS = ['#3f7a4a', '#2f5a8f', '#b98a2c'].map((hex) => new THREE.Color(hex))

/** The stand's island, its canopy on posts, benches and a kerb painted yellow and black, along +z. */
function createStandGeometry(scale: number) {
  const island = { length: BUS_STAND.island.length * scale, width: BUS_STAND.island.width }
  const half = island.length / 2
  const parts: THREE.BufferGeometry[] = [box([island.width, 0.25, island.length], [0, 0.125, 0], '#a7a39b')]
  for (let a = -half; a < half; a += 1) {
    for (const side of [-1, 1]) parts.push(box([0.12, 0.27, 1], [side * (island.width / 2 - 0.06), 0.135, a + 0.5], Math.round(a) % 2 === 0 ? YELLOW : '#26262a'))
  }
  for (let a = -half + 2; a <= half - 2; a += 6) parts.push(box([0.16, 3.4, 0.16], [0, 1.95, a], '#6d7378'))
  const roof = box([6.2, 0.15, island.length + 2], [0, 3.7, 0], '#d7dbe0')
  parts.push(roof)
  for (const side of [-1, 1]) parts.push(box([0.08, 0.45, island.length + 2], [side * 3.1, 3.5, 0], BUS_GREEN))
  for (let a = -half + 3; a <= half - 3; a += 6) for (const side of [-1, 1]) parts.push(box([0.45, 0.45, 2.2], [side * 0.7, 0.47, a + 3], '#5a6a73'))
  return merge(parts)
}

/** The stand's boards: its name, Kannada over English, and each bay's number with its routes. */
function createStandBoardTexture(stand: BusStand): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const paint = () => {
    const context = canvas.getContext('2d')!
    context.fillStyle = BUS_GREEN
    context.fillRect(0, 0, 1024, 192)
    context.fillStyle = YELLOW
    context.fillRect(0, 176, 1024, 16)
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `700 64px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(stand.nameKannada, 512, 60, 980)
    context.font = `800 60px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(stand.name, 512, 130, 980)
    stand.bays.forEach((bay, i) => {
      const left = i * 256
      context.fillStyle = '#f4f1e8'
      context.fillRect(left + 8, 200, 240, 304)
      context.fillStyle = BUS_GREEN
      context.font = `800 120px system-ui, sans-serif`
      context.fillText(String(bay.number), left + 128, 280)
      context.font = `800 40px system-ui, sans-serif`
      bay.routes.forEach((route, k) => context.fillText(route, left + 128, 380 + k * 46, 220))
    })
  }
  paint()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  document.fonts?.load(`700 64px 'Baloo Tamma 2'`, stand.nameKannada).then(() => {
    paint()
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** A plane showing part of the stand's board picture: `[left, top, width, height]` as shares of it. */
function boardPart(width: number, height: number, [u, v, w, h]: [number, number, number, number]) {
  const plane = new THREE.PlaneGeometry(width, height).toNonIndexed()
  const uv = plane.getAttribute('uv') as THREE.BufferAttribute
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u + uv.getX(k) * w, 1 - v - (1 - uv.getY(k)) * h)
  return plane
}

function BusStandScenery({ stand }: { stand: BusStand }) {
  const structure = useMemo(() => createStandGeometry(stand.scale), [stand])
  const texture = useMemo(() => createStandBoardTexture(stand), [stand])
  const bus = useMemo(() => createBusGeometry(), [])
  const boards = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const half = (BUS_STAND.island.length * stand.scale) / 2
    // The bays' boards, hanging from the canopy's edge on both sides, two bays a side.
    stand.bays.forEach((_, i) => {
      const side = i < 2 ? 1 : -1
      const a = (i % 2 === 0 ? -1 : 1) * half * 0.5
      parts.push(boardPart(1.2, 1.5, [i * 0.25, 200 / 512, 0.25, 304 / 512]).rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2).translate(side * 3.16, 2.75, a))
    })
    // The name board on the canopy's ends.
    for (const end of [-1, 1]) parts.push(boardPart(6, 1.1, [0, 0, 1, 192 / 512]).rotateY(end > 0 ? 0 : Math.PI).translate(0, 4.4, end * (half + 1.05)))
    return merge(parts)
  }, [stand])
  const material = useConcrete({ roughness: 0.85 })
  useEffect(() => () => {
    for (const thing of [structure, texture, bus, boards]) thing.dispose()
  }, [structure, texture, bus, boards])
  const turn = Math.atan2(stand.dirX, stand.dirZ)
  return (
    <>
      <group position={[stand.x, 0, stand.z]} rotation-y={turn}>
        <mesh geometry={structure} material={material} castShadow receiveShadow />
        <mesh geometry={boards}>
          <meshStandardMaterial map={texture} roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <PropInstances props={stand.buses} geometry={bus} colors={STAND_BUS_COLORS} sizeRange={0} vertexColors to={250} />
    </>
  )
}

/**
 * A big structure cut into map squares (splitGeometry.ts), each drawn only within the draw
 * distance and casting a shadow only within the sun's shadow range; three.js leaves out the ones
 * behind the camera. Looked at again every half second or so.
 */
function Squares({ geometries, material }: { geometries: THREE.BufferGeometry[]; material: THREE.Material }) {
  const group = useRef<THREE.Group>(null)
  const frames = useRef(0)
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries])
  useFrame(() => {
    if (!group.current || frames.current++ % 20 !== 0) return
    const { shadowRange } = QUALITY_PRESETS[useGameStore.getState().quality]
    for (const mesh of group.current.children as THREE.Mesh[]) {
      const sphere = mesh.geometry.boundingSphere
      if (!sphere) continue
      const distance = Math.hypot(sphere.center.x - livePlayer.x, sphere.center.z - livePlayer.z) - sphere.radius
      mesh.visible = distance < liveView.drawDistance
      mesh.castShadow = distance < shadowRange
    }
  })
  return (
    <group ref={group}>
      {geometries.map((geometry) => (
        <mesh key={geometry.uuid} geometry={geometry} material={material} castShadow receiveShadow />
      ))}
    </group>
  )
}

export function Transit({ metro, flyovers, busStand }: { metro: Metro; flyovers: Flyovers; busStand: BusStand | null }) {
  const track = useMemo(() => createTrackGeometry(metro), [metro])
  const stations = useMemo(() => (metro.stations.length ? merge(metro.stations.map(createStationGeometry)) : null), [metro])
  const trackSquares = useMemo(() => (track ? splitIntoSquares(track.clone()) : null), [track])
  const stationSquares = useMemo(() => (stations ? splitIntoSquares(stations.clone()) : null), [stations])
  const cart = useMemo(() => createCartGeometry(), [])
  const material = useConcrete({ roughness: 0.85, side: THREE.DoubleSide })
  useEffect(() => () => {
    for (const thing of [track, stations, cart]) thing?.dispose()
  }, [track, stations, cart])
  return (
    <>
      <FlyoverScenery flyovers={flyovers} />
      {busStand && <BusStandScenery stand={busStand} />}
      {trackSquares && <Squares geometries={trackSquares} material={material} />}
      {stationSquares && <Squares geometries={stationSquares} material={material} />}
      {metro.stations.map((station) => (
        <StationBoards key={station.name} station={station} />
      ))}
      <PropInstances props={metro.carts} geometry={cart} sizeRange={0.1} vertexColors to={150} />
      <StiltParking vehicles={metro.autos} carModels={['auto']} drawDistance={120} />
      <StiltParking vehicles={metro.bikes} drawDistance={90} />
      {metro.path.length > 0 && <MetroTrains metro={metro} />}
    </>
  )
}
