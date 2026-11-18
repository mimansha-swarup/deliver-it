import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import type { Landmarks } from './landmarkPlacement'
import { PropInstances } from './RoadsideProps'
import { box, merge } from './simpleShapes'
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

/** A metro pillar with its cap, along +z (the road), the cap across it. */
function createPillar() {
  return merge([box([1.8, DECK.bottom - 1.4, 1.8], [0, (DECK.bottom - 1.4) / 2, 0], CONCRETE), box([7, 1.4, 2.4], [0, DECK.bottom - 0.7, 0], CONCRETE_DARK)])
}

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
  }
  return parts.length ? merge(parts) : null
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

export function CityLandmarks({ landmarks }: { landmarks: Landmarks }) {
  const lake = useMemo(() => (landmarks.lake.length ? createLakeGeometry(landmarks.lake) : null), [landmarks])
  const water = useMemo(() => createWaterMaterial(), [])
  const deck = useMemo(() => createDeck(landmarks.spans), [landmarks])
  const pillar = useMemo(() => createPillar(), [])
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
  })
  return (
    <>
      {lake && <mesh geometry={lake} material={water} receiveShadow />}
      {deck && <mesh geometry={deck} material={deckMaterial} castShadow receiveShadow />}
      <PropInstances props={landmarks.pillars} geometry={pillar} sizeRange={0} vertexColors to={600} />
      <PropInstances props={landmarks.shelters} geometry={shelter} sizeRange={0} vertexColors />
      <PropInstances props={landmarks.bigShelters} geometry={bigShelter} sizeRange={0} vertexColors />
      {landmarks.boards.map((board, i) => (
        <Board key={i} board={board} />
      ))}
    </>
  )
}
