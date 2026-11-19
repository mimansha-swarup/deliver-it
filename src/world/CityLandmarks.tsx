import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import type { BusStop, Landmarks } from './landmarkPlacement'
import { PropInstances } from './RoadsideProps'
import { box, colored, merge } from './simpleShapes'
import { createPosterAtlas, POSTER_ASPECT, POSTER_COLUMNS, POSTER_COUNT, POSTER_ROWS } from './posters'
import { PLAY_AREA } from './worldUtils'

/*
 * Draws the landmarks planned in landmarkPlacement.ts: Agara Lake's water, the metro viaduct on
 * its pillars, bus shelters and the BDA Complex's board. The water is lit like everything else;
 * at a low angle it picks up the colour of the hazy horizon, as still water does.
 */

const WATER = '#33503f'
const WATER_HEIGHT = 0.06
const CONCRETE = '#b3aea4'
const CONCRETE_DARK = '#8f8a81'
const DECK = { bottom: 12, thickness: 1.6, width: 8.6, parapet: 0.9 }

function createLakeGeometry(rows: Landmarks['lake']): THREE.BufferGeometry {
  const positions: number[] = []
  for (const [row, from, to] of rows) {
    const z0 = PLAY_AREA.minZ + row
    const z1 = z0 + 1
    const x0 = PLAY_AREA.minX + from
    const x1 = PLAY_AREA.minX + to + 1
    positions.push(x0, WATER_HEIGHT, z0, x0, WATER_HEIGHT, z1, x1, WATER_HEIGHT, z1, x0, WATER_HEIGHT, z0, x1, WATER_HEIGHT, z1, x1, WATER_HEIGHT, z0)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  geometry.computeBoundingSphere()
  return geometry
}

const skyUniform = { value: new THREE.Color() }
/** The deck lamps' heads, shared, lit at dusk (see CityLandmarks' frame). */
const lampMaterial = new THREE.MeshStandardMaterial({ color: '#d8d2c2', emissive: '#ffe2a8', emissiveIntensity: 0, roughness: 0.6 })

function createWaterMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.12, metalness: 0.05 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSky = skyUniform
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vWater;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uSky;\nvarying vec2 vWater;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `float facing = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
        // Fine ripples break the sky's reflection into streaks; broad ones darken patches.
        float ripple = sin(vWater.x * 1.3 + sin(vWater.y * 0.4) * 3.0) * sin(vWater.y * 2.1 + vWater.x * 0.35);
        float broad = sin(vWater.x * 0.045 + 1.7) * sin(vWater.y * 0.06);
        float reflect = pow(1.0 - facing, 3.0) * (0.55 + 0.25 * ripple) * (0.85 + 0.15 * broad);
        outgoingLight = mix(outgoingLight * (0.9 + 0.1 * broad), uSky * 0.8, clamp(reflect, 0.0, 0.8));
        #include <opaque_fragment>`,
      )
  }
  return material
}

/**
 * A metro pillar with its cap, along +z (the road), the cap across it: grime at the foot, a darker
 * plinth, the bearing pads the girders sit on, and a drainpipe from the deck down one face, bending
 * out at the bottom into the median.
 */
function createPillar() {
  const column = DECK.bottom - 1.4
  const pipe = (height: number, at: [number, number, number]) => {
    const geometry = new THREE.CylinderGeometry(0.11, 0.11, height, 6).toNonIndexed()
    geometry.translate(...at)
    return colored(geometry, '#2f3133')
  }
  return merge([
    box([1.8, column, 1.8], [0, column / 2, 0], CONCRETE),
    box([1.84, 0.9, 1.84], [0, 0.45, 0], '#8e877d'),
    box([1.83, 2.2, 1.83], [0, 1.1, 0], '#a49d92'),
    box([7, 1.4, 2.4], [0, DECK.bottom - 0.7, 0], CONCRETE_DARK),
    ...[-2.6, 2.6].map((x) => box([1.0, 0.25, 1.4], [x, DECK.bottom + 0.12, 0], '#5d5f61')),
    // The drainpipe: down the face, a clamp every few metres, and out at the foot.
    pipe(DECK.bottom - 0.6, [0.62, (DECK.bottom - 0.6) / 2 + 0.3, 0.98]),
    ...[2.5, 5.5, 8.5].map((y) => box([0.3, 0.08, 0.12], [0.62, y, 0.93], '#3b3d3f')),
    box([0.22, 0.22, 0.7], [0.62, 0.3, 1.25], '#2f3133'),
  ])
}

/**
 * The deck's underside: a dark soffit, two light box girders with bottom flanges, cross beams every
 * 6 m and at the ends, and a drainpipe along one girder. Light against dark, so it reads from the
 * street, not as one flat surface.
 */
function girders(length: number) {
  const depth = 1.4
  const parts = [
    box([DECK.width - 0.2, 0.06, length + 0.6], [0, DECK.bottom - 0.03, 0], '#57534c'),
    ...[-2.4, 2.4].flatMap((x) => [
      box([1.3, depth, length + 0.6], [x, DECK.bottom - depth / 2, 0], '#bab5ab'),
      box([1.8, 0.2, length + 0.6], [x, DECK.bottom - depth - 0.1, 0], '#cbc6bc'),
    ]),
  ]
  for (let at = -length / 2 + 0.4; at <= length / 2 - 0.4; at += Math.max(3, (length - 0.8) / Math.max(1, Math.round(length / 6)))) {
    parts.push(box([3.5, depth - 0.3, 0.3], [0, DECK.bottom - (depth - 0.3) / 2, at], '#a39e94'))
  }
  const pipe = new THREE.CylinderGeometry(0.12, 0.12, length + 0.6, 6).toNonIndexed().rotateX(Math.PI / 2)
  parts.push(colored(pipe.translate(3.4, DECK.bottom - 0.5, 0), '#2f3133'))
  return parts
}

/** Lamps on the deck's parapets, every this many metres, staggered side to side. */
const DECK_LAMP_EVERY = 18

/** The viaduct's deck between pillars, with a parapet each side. */
function createDeck(spans: Landmarks['spans']) {
  const parts: THREE.BufferGeometry[] = []
  for (const { from, to } of spans) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1])
    const place = (geometry: THREE.BufferGeometry) => {
      geometry.rotateY(angle)
      geometry.translate((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2)
      parts.push(geometry)
    }
    place(box([DECK.width, DECK.thickness, length + 1], [0, DECK.bottom + DECK.thickness / 2, 0], CONCRETE))
    for (const side of [-1, 1]) place(box([0.3, DECK.parapet, length + 1], [(side * (DECK.width - 0.3)) / 2, DECK.bottom + DECK.thickness + DECK.parapet / 2, 0], CONCRETE_DARK))
    for (const girder of girders(length)) place(girder)
    // A rain stain under each parapet, where the water runs over.
    for (const side of [-1, 1]) place(box([0.02, 0.9, length + 1], [(side * DECK.width) / 2 + side * 0.011, DECK.bottom + 0.7, 0], '#8a857c'))
    // Lamp posts on the parapets, their arms over the tracks.
    for (let at = -length / 2 + DECK_LAMP_EVERY / 2; at < length / 2; at += DECK_LAMP_EVERY) {
      const side = Math.round((at + length) / DECK_LAMP_EVERY) % 2 === 0 ? 1 : -1
      const x = (side * (DECK.width - 0.3)) / 2
      const top = DECK.bottom + DECK.thickness + DECK.parapet
      place(box([0.12, 6.5, 0.12], [x, top + 3.25, at], '#5b5f63'))
      place(box([1.6, 0.1, 0.1], [x - side * 0.8, top + 6.45, at], '#5b5f63'))
    }
  }
  return parts.length ? merge(parts) : null
}

/** The lamps' heads on the deck (see createDeck), as one shape that glows after dark. */
function createDeckLampHeads(spans: Landmarks['spans']) {
  const parts: THREE.BufferGeometry[] = []
  for (const { from, to } of spans) {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1])
    for (let at = -length / 2 + DECK_LAMP_EVERY / 2; at < length / 2; at += DECK_LAMP_EVERY) {
      const side = Math.round((at + length) / DECK_LAMP_EVERY) % 2 === 0 ? 1 : -1
      const x = (side * (DECK.width - 0.3)) / 2 - side * 1.5
      const head = box([0.5, 0.14, 0.26], [x, DECK.bottom + DECK.thickness + DECK.parapet + 6.36, at], '#fff1cc')
      parts.push(head.rotateY(angle).translate((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2))
    }
    // Lights under the deck, on both girders, lighting the median below: seen from the street.
    for (let at = -length / 2 + 6; at < length / 2 - 3; at += 10) {
      for (const x of [-2.4, 2.4]) {
        const fixture = box([0.6, 0.08, 0.25], [x, DECK.bottom - 1.34, at], '#fff1cc')
        parts.push(fixture.rotateY(angle).translate((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2))
      }
    }
  }
  return parts.length ? merge(parts) : null
}

/** Each pillar's number, as painted on it: "P-" and its place along the line, white on dark blue, in one picture. */
const PLATE = { width: 128, height: 64, columns: 8 }
function createPillarNumbers(pillars: Landmarks['pillars']) {
  const rows = Math.max(1, Math.ceil(pillars.length / PLATE.columns))
  const canvas = document.createElement('canvas')
  canvas.width = PLATE.width * PLATE.columns
  canvas.height = PLATE.height * rows
  const context = canvas.getContext('2d')!
  // Numbered in order along the line: the pillars are in the order they were placed along Hosur Road.
  pillars.forEach((_, i) => {
    const left = (i % PLATE.columns) * PLATE.width
    const top = Math.floor(i / PLATE.columns) * PLATE.height
    context.fillStyle = '#1f3a6b'
    context.fillRect(left + 4, top + 4, PLATE.width - 8, PLATE.height - 8)
    context.fillStyle = '#f2efe6'
    context.font = `800 34px system-ui, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(`P-${101 + i}`, left + PLATE.width / 2, top + PLATE.height / 2 + 1)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const planes = pillars.flatMap((pillar, i) => {
    const column = i % PLATE.columns
    const row = Math.floor(i / PLATE.columns)
    // On both faces across the road, about 3.5 m up.
    return [1, -1].map((face) => {
      const plane = new THREE.PlaneGeometry(0.8, 0.4).toNonIndexed()
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (column + uv.getX(k)) / PLATE.columns, 1 - (row + 1 - uv.getY(k)) / rows)
      return plane.rotateY(face > 0 ? 0 : Math.PI).translate(0, 3.6, face * 0.925).rotateY(pillar.rotation).translate(pillar.x, 0, pillar.z)
    })
  })
  return { texture, geometry: merge(planes) }
}

/** Posters pasted on the pillars' sides, from the posters' picture (posters.ts): on two in three pillars. */
function createPillarPosters(pillars: Landmarks['pillars']) {
  const planes: THREE.BufferGeometry[] = []
  pillars.forEach((pillar, i) => {
    if (i % 3 === 2) return
    for (const face of [1, -1]) {
      const index = (i * 2 + (face > 0 ? 0 : 1)) % POSTER_COUNT
      const column = index % POSTER_COLUMNS
      const row = Math.floor(index / POSTER_COLUMNS)
      const plane = new THREE.PlaneGeometry(1.25, 1.25 / POSTER_ASPECT).toNonIndexed()
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (column + uv.getX(k)) / POSTER_COLUMNS, 1 - (row + 1 - uv.getY(k)) / POSTER_ROWS)
      planes.push(plane.rotateY(face > 0 ? Math.PI / 2 : -Math.PI / 2).translate(face * 0.925, 1.75, 0).rotateY(pillar.rotation).translate(pillar.x, 0, pillar.z))
    }
  })
  return planes.length ? merge(planes) : null
}

/** A bus shelter `length` long along x, its open front to +z: posts, a sloping roof, a back panel, a bench and an ad panel. */
function createShelter(length: number) {
  const half = length / 2 - 0.15
  const posts = [-half, ...(length > 8 ? [0] : []), half].flatMap((x) => [box([0.1, 2.7, 0.1], [x, 1.35, -0.75], '#6d7378'), box([0.1, 2.85, 0.1], [x, 1.42, 0.65], '#6d7378')])
  const roof = box([length, 0.08, 1.9], [0, 2.85, -0.05], '#d7dbe0')
  roof.rotateX(-0.05)
  return merge([
    ...posts,
    roof,
    box([length, 0.32, 0.06], [0, 3.0, 0.9], '#1f4f8f'),
    box([length - 0.3, 1.5, 0.04], [0, 1.25, -0.8], '#9fb1bb'),
    box([length * 0.7, 0.06, 0.42], [0, 0.46, -0.48], '#5a6a73'),
    box([0.06, 0.44, 0.06], [-length * 0.3, 0.22, -0.48], '#4d5459'),
    box([0.06, 0.44, 0.06], [length * 0.3, 0.22, -0.48], '#4d5459'),
    box([1.2, 1.7, 0.08], [half - 0.7, 1.15, -0.72], '#e8c547'),
  ])
}

function createBoardTexture(lines: string[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 320
  const context = canvas.getContext('2d')!
  context.fillStyle = '#1d4a2a'
  context.fillRect(0, 0, 1024, 320)
  context.strokeStyle = '#f0e6c8'
  context.lineWidth = 10
  context.strokeRect(14, 14, 996, 292)
  context.fillStyle = '#f7f2e2'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const sizes = [70, 96, 48]
  lines.forEach((line, i) => {
    context.font = `800 ${sizes[i] ?? 48}px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText(line, 512, 70 + i * 95, 960)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function Board({ board }: { board: Landmarks['boards'][number] }) {
  const texture = useMemo(() => createBoardTexture(board.lines), [board])
  useEffect(() => () => texture.dispose(), [texture])
  return (
    <group position={[board.x, 0, board.z]} rotation-y={board.rotation}>
      {[-3.6, 3.6].map((x) => (
        <mesh key={x} position={[x, 2.6, -0.05]} castShadow>
          <boxGeometry args={[0.2, 5.2, 0.2]} />
          <meshStandardMaterial color="#5e5a54" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 4, 0.06]} castShadow>
        <planeGeometry args={[8, 2.5]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
    </group>
  )
}

// ---- Bus stop boards ----

/** Boards share pictures: each picture holds this many, two across, each 1024 by 102 pixels. */
const BOARD_SLOT = { width: 1024, height: 102, columns: 2, rows: 20 }
const BOARDS_PER_ATLAS = BOARD_SLOT.columns * BOARD_SLOT.rows

/** A stop's board in its slot: the city buses' green, the name in Kannada and English, and the routes in white boxes. */
function drawStopBoard(context: CanvasRenderingContext2D, stop: BusStop, left: number, top: number) {
  const { width, height } = BOARD_SLOT
  context.fillStyle = '#1f6b3f'
  context.fillRect(left, top, width, height)
  context.fillStyle = '#f2c12e'
  context.fillRect(left, top + height - 8, width, 8)
  context.fillStyle = '#ffffff'
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  const name = stop.nameKannada ? `${stop.nameKannada} · ${stop.name}` : stop.name
  context.font = `700 40px 'Baloo Tamma 2', system-ui, sans-serif`
  context.fillText(name, left + 16, top + 30, width - 32)
  // Route numbers, in boxes, as many as fit.
  context.font = `800 30px system-ui, sans-serif`
  let x = left + 16
  for (const route of stop.routes.length ? stop.routes : ['Bus stop']) {
    const w = context.measureText(route).width + 20
    if (x + w > left + width - 16) break
    context.fillStyle = '#ffffff'
    context.fillRect(x, top + 52, w, 38)
    context.fillStyle = '#1f6b3f'
    context.fillText(route, x + 10, top + 72)
    x += w + 10
  }
}

function createStopBoardAtlas(stops: BusStop[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = BOARD_SLOT.width * BOARD_SLOT.columns
  canvas.height = BOARD_SLOT.height * BOARD_SLOT.rows
  const paint = () => {
    const context = canvas.getContext('2d')!
    stops.forEach((stop, i) => drawStopBoard(context, stop, (i % BOARD_SLOT.columns) * BOARD_SLOT.width, Math.floor(i / BOARD_SLOT.columns) * BOARD_SLOT.height))
  }
  paint()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  document.fonts?.load(`700 40px 'Baloo Tamma 2'`, stops.map((stop) => stop.nameKannada).join('')).then(() => {
    paint()
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** The boards, one plane each on the front of its shelter's roof, its picture from the atlas. */
function createStopBoardGeometry(stops: BusStop[]): THREE.BufferGeometry {
  const planes = stops.map((stop, i) => {
    const length = (stop.big ? 12 : 6) - 0.4
    const plane = new THREE.PlaneGeometry(length, 0.62).toNonIndexed()
    const column = i % BOARD_SLOT.columns
    const row = Math.floor(i / BOARD_SLOT.columns)
    const uv = plane.getAttribute('uv') as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (column + uv.getX(k)) / BOARD_SLOT.columns, 1 - (row + 1 - uv.getY(k)) / BOARD_SLOT.rows)
    return plane.translate(0, 3.15, 0.95).rotateY(stop.rotation).translate(stop.x, 0, stop.z)
  })
  return merge(planes)
}

function StopBoards({ stops }: { stops: BusStop[] }) {
  const atlases = useMemo(() => {
    const groups: BusStop[][] = []
    for (let i = 0; i < stops.length; i += BOARDS_PER_ATLAS) groups.push(stops.slice(i, i + BOARDS_PER_ATLAS))
    return groups.map((group) => ({ texture: createStopBoardAtlas(group), geometry: createStopBoardGeometry(group) }))
  }, [stops])
  useEffect(() => () => atlases.forEach(({ texture, geometry }) => {
    texture.dispose()
    geometry.dispose()
  }), [atlases])
  return (
    <>
      {atlases.map(({ texture, geometry }, i) => (
        <mesh key={i} geometry={geometry}>
          <meshStandardMaterial map={texture} roughness={0.75} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </>
  )
}

export function CityLandmarks({ landmarks }: { landmarks: Landmarks }) {
  const lake = useMemo(() => (landmarks.lake.length ? createLakeGeometry(landmarks.lake) : null), [landmarks])
  const water = useMemo(() => createWaterMaterial(), [])
  const deck = useMemo(() => createDeck(landmarks.spans), [landmarks])
  const pillar = useMemo(() => createPillar(), [])
  const lampHeads = useMemo(() => createDeckLampHeads(landmarks.spans), [landmarks])
  const numbers = useMemo(() => (landmarks.pillars.length ? createPillarNumbers(landmarks.pillars) : null), [landmarks])
  const posters = useMemo(() => createPillarPosters(landmarks.pillars), [landmarks])
  const posterAtlas = useMemo(() => createPosterAtlas(), [])
  useEffect(
    () => () => {
      for (const thing of [lampHeads, numbers?.geometry, numbers?.texture, posters, posterAtlas]) thing?.dispose()
    },
    [lampHeads, numbers, posters, posterAtlas],
  )
  const shelter = useMemo(() => createShelter(6), [])
  const bigShelter = useMemo(() => createShelter(12), [])
  const deckMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), [])
  useEffect(
    () => () => {
      for (const thing of [lake, water, deck, pillar, shelter, bigShelter, deckMaterial]) thing?.dispose()
    },
    [lake, water, deck, pillar, shelter, bigShelter, deckMaterial],
  )
  useFrame(() => {
    skyUniform.value.setRGB(...liveSky.look.horizon, THREE.SRGBColorSpace)
    // The deck's lamps come on at dusk.
    lampMaterial.emissiveIntensity = liveSky.look.night * 2.2
  })
  return (
    <>
      {lake && <mesh geometry={lake} material={water} receiveShadow />}
      {deck && <mesh geometry={deck} material={deckMaterial} castShadow receiveShadow />}
      <PropInstances props={landmarks.pillars} geometry={pillar} sizeRange={0} vertexColors to={600} />
      {lampHeads && <mesh geometry={lampHeads} material={lampMaterial} />}
      {numbers && (
        <mesh geometry={numbers.geometry}>
          <meshStandardMaterial map={numbers.texture} roughness={0.8} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      {posters && (
        <mesh geometry={posters}>
          <meshStandardMaterial map={posterAtlas} roughness={0.85} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      )}
      <PropInstances props={landmarks.shelters} geometry={shelter} sizeRange={0} vertexColors />
      <PropInstances props={landmarks.bigShelters} geometry={bigShelter} sizeRange={0} vertexColors />
      {landmarks.stops.length > 0 && <StopBoards stops={landmarks.stops} />}
      {landmarks.boards.map((board, i) => (
        <Board key={i} board={board} />
      ))}
    </>
  )
}
