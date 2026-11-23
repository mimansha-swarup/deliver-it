import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { livePlayer } from '../game/livePlayer'
import { getModel, TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { createPerson } from '../traffic/person'
import { People } from '../traffic/Traffic'
import type { Pedestrian } from '../traffic/trafficLogic'
import { box, merge } from './simpleShapes'
import { SOCIETY_GATE, type SocietyPlan } from './society'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/*
 * The gated society's gate (society.ts): a striped boom barrier, a sentry box with a tin roof, a
 * small table with the visitors' register, a name board on the wall, and the guard in his blue
 * uniform. One merged mesh under the street's own light, drawn only within sight of it.
 */

const SEEN_FROM = 170
/** The boom stands this far out from the compound's own gate, on the street side, so it's seen in front of it. */
const BOOM_OUT = 0.45
const UNIFORM = ['#3b5ba5']
const SIGN_FONT = "'Baloo Tamma 2', 'Arial Black', system-ui, sans-serif"

function createBoard(name: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 320
  const context = canvas.getContext('2d')
  if (context) {
    // Black granite with gilt letters, a little dusty.
    context.fillStyle = '#1d1f22'
    context.fillRect(0, 0, 1024, 320)
    context.strokeStyle = '#b08d3c'
    context.lineWidth = 6
    context.strokeRect(14, 14, 996, 292)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#d9b860'
    context.font = `800 108px ${SIGN_FONT}`
    context.fillText(name, 512, 118, 940)
    context.fillStyle = '#c9c4b4'
    context.font = `600 40px ${SIGN_FONT}`
    context.fillText('ಸಂಪಿಗೆ ರೆಸಿಡೆನ್ಸಿ · Visitors: OTP and register at security', 512, 236, 940)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** The gate's furniture, in the gate's own space: x along the gate towards the guard, z out to the street. */
function createGate(): THREE.BufferGeometry {
  const half = SOCIETY_GATE.width / 2
  const parts: THREE.BufferGeometry[] = []
  // The boom: a post at the far end with a counterweight, and a red and white arm across to the wicket.
  parts.push(box([0.22, 1.15, 0.22], [-half - 0.05, 0.575, BOOM_OUT], '#5d6166'), box([0.34, 0.3, 0.3], [-half - 0.42, 1.0, BOOM_OUT], '#3a3d42'))
  const reach = SOCIETY_GATE.width - SOCIETY_GATE.wicket + 0.1
  const stripes = 8
  for (let stripe = 0; stripe < stripes; stripe++) {
    parts.push(box([reach / stripes, 0.1, 0.07], [-half + (stripe + 0.5) * (reach / stripes), 1.0, BOOM_OUT], stripe % 2 ? '#e9e4d8' : '#b3261e'))
  }
  parts.push(box([0.07, 0.9, 0.07], [half - SOCIETY_GATE.wicket + 0.05, 0.45, BOOM_OUT], '#5d6166'))
  parts.push(box([0.36, 0.3, 0.03], [-0.4, 0.72, BOOM_OUT + 0.05], '#e9e4d8'), box([0.3, 0.07, 0.01], [-0.4, 0.76, BOOM_OUT + 0.07], '#b3261e'))
  // The sentry box, inside the wall: plastered, a window to the street, a rusting tin roof.
  const boxX = half + 0.9
  parts.push(box([1.15, 2.1, 1.15], [boxX, 1.05, -0.85], '#d8cfb6'), box([1.45, 0.07, 1.5], [boxX, 2.16, -0.8], '#8a5a3c'))
  parts.push(box([0.7, 0.6, 0.03], [boxX, 1.45, -0.26], '#31454f'), box([0.8, 0.06, 0.12], [boxX, 1.12, -0.24], '#8f8a7c'))
  parts.push(box([1.17, 0.3, 1.17], [boxX, 0.15, -0.85], '#b8ae96'))
  // The register's table and a plastic chair, on the street side by the wicket.
  const tableX = half + 1.5
  parts.push(box([0.8, 0.04, 0.5], [tableX, 0.74, 0.75], '#7a5a3a'))
  for (const [x, z] of [[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]]) parts.push(box([0.04, 0.72, 0.04], [tableX + x, 0.36, 0.75 + z], '#5b4630'))
  parts.push(box([0.42, 0.03, 0.3], [tableX - 0.05, 0.775, 0.75], '#f1ede2'), box([0.42, 0.012, 0.02], [tableX - 0.05, 0.792, 0.75], '#27408b'), box([0.02, 0.015, 0.14], [tableX + 0.26, 0.77, 0.7], '#1c2a6b'))
  parts.push(box([0.42, 0.04, 0.42], [tableX + 0.1, 0.44, 1.45], '#a83a2a'), box([0.42, 0.42, 0.04], [tableX + 0.1, 0.66, 1.66], '#a83a2a'))
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) parts.push(box([0.035, 0.44, 0.035], [tableX + 0.1 + x, 0.22, 1.45 + z], '#8a2f22'))
  const geometry = merge(parts)
  geometry.computeVertexNormals()
  return geometry
}

/** The guard turns to whoever comes up, shifts his weight, and isn't drawn from far off. */
function standGuard(person: Pedestrian, post: number, near: boolean, time: number) {
  const close = Math.hypot(livePlayer.x - person.x, livePlayer.z - person.z) < 14
  const wanted = close ? Math.atan2(livePlayer.x - person.x, livePlayer.z - person.z) : post
  person.heading += Math.atan2(Math.sin(wanted - person.heading), Math.cos(wanted - person.heading)) * 0.06
  person.stride = Math.PI / 2
  person.walking = 0.1 + Math.sin(time * 0.9) * 0.07
  person.lift = near ? 0 : -50
}

export function SocietyGate({ society }: { society: SocietyPlan }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const body = useMemo(() => getModel(scene, 'man'), [scene])
  const geometry = useMemo(() => createGate(), [])
  const board = useMemo(() => createBoard(society.name), [society.name])
  useEffect(() => () => { geometry.dispose(); board.dispose() }, [geometry, board])
  const guard = useMemo(() => [createPerson(society.guard.x, society.guard.z, society.guard.heading, 0.4, 0.8)], [society])
  const group = useRef<THREE.Group>(null)
  // The gate's own space, turned so its x runs along the gate towards the guard and its z out to the street.
  const turn = Math.atan2(society.outX, society.outZ)
  const flip = society.alongX * Math.cos(turn) - society.alongZ * Math.sin(turn) < 0 ? -1 : 1
  useFrame(({ clock }) => {
    const near = Math.hypot(society.gate.x - livePlayer.x, society.gate.z - livePlayer.z) < SEEN_FROM
    if (group.current) group.current.visible = near
    standGuard(guard[0], society.guard.heading, near, clock.elapsedTime)
  })
  const half = SOCIETY_GATE.width / 2
  return (
    <>
      <group ref={group} position={[society.gate.x, 0, society.gate.z]} rotation={[0, turn, 0]} scale={[flip, 1, 1]}>
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.85} side={flip < 0 ? THREE.BackSide : THREE.FrontSide} />
        </mesh>
        {/* The name board, on the sentry box over its window, above the compound wall. */}
        <mesh position={[half + 0.9, 1.93, -0.262]} scale={[flip, 1, 1]}>
          <planeGeometry args={[1.12, 0.35]} />
          <meshStandardMaterial map={board} roughness={0.5} />
        </mesh>
      </group>
      <People items={guard} body={body} palette={UNIFORM} />
    </>
  )
}
