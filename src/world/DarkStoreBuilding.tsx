import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import {
  DELIVERY_BIKE_COLOR,
  getModel,
  paintModel,
  TRAFFIC_MODELS_URL,
} from '../traffic/modelFiles'
import type { DarkStore } from './darkStore'

const FRONT_HEIGHT = 3.4
const FRONT_DEPTH = 0.3
/** The front stands this far off the wall, in front of any wall pieces. */
const WALL_GAP = 0.3
const OPENING_HEIGHT = 2.5
const SIGN_HEIGHT = 0.8
const SIGN_DEPTH = 0.16
const STRIPE_WIDTH = 0.5
const YARD_DEPTH = 3.5
/** Road markings use -3, and the yard needs to sit on top of them. */
const YARD_DEPTH_NUDGE = -4
const NIGHT_LIGHT = '#fff3d2'

/** The shop's name in white on black, to match the bikes. */
function createSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 128

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#0f1012'
    context.fillRect(0, 0, 1024, 128)
    context.fillStyle = '#ffffff'
    context.textBaseline = 'middle'
    context.font = 'bold 74px Arial, sans-serif'
    context.fillText('DELIVER IT', 40, 68)
    context.fillStyle = '#c9cbd0'
    context.font = 'bold 34px Arial, sans-serif'
    context.textAlign = 'right'
    context.fillText('DARK STORE · RIDERS ONLY', 984, 68)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Shelves of parcels, drawn in code, seen through the open front. */
function createShelvesTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512

  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#ece7da'
    context.fillRect(0, 0, 1024, 512)

    const browns = ['#b98a55', '#a97946', '#c79a66', '#d9d4c7']
    for (let row = 0; row < 4; row++) {
      const shelfY = 120 + row * 124

      for (let x = 12; x < 1000; ) {
        const pick = (x * 7 + row * 13) % 11
        const width = 46 + (pick % 4) * 16
        const height = 44 + (pick % 3) * 18
        context.fillStyle = browns[pick % browns.length]
        context.fillRect(x, shelfY - height, width, height)
        context.fillStyle = 'rgb(255 255 255 / 45%)'
        context.fillRect(x + width / 2 - 3, shelfY - height, 6, height)
        x += width + 8 + (pick % 3) * 10
      }

      context.fillStyle = '#2c2f34'
      context.fillRect(0, shelfY, 1024, 9)
    }
    for (let x = 0; x <= 1024; x += 256) {
      context.fillStyle = '#2c2f34'
      context.fillRect(x - 4, 0, 9, 512)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Black and white stripes marking the riders' bay. */
function createYardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 64

  const context = canvas.getContext('2d')
  if (context) {
    for (let x = -64; x < 512; x += 64) {
      context.fillStyle = '#16171a'
      context.fillRect(0, 0, 0, 0)
      context.beginPath()
      context.moveTo(x, 64)
      context.lineTo(x + 32, 64)
      context.lineTo(x + 96, 0)
      context.lineTo(x + 64, 0)
      context.closePath()
      context.fillStyle = '#e8e6df'
      context.fill()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function ParkedBike({
  x,
  z,
  rotation,
  scene,
}: {
  x: number
  z: number
  rotation: number
  scene: THREE.Group
}) {
  const parts = useMemo(() => {
    const { wheelPositions } = scene.getObjectByName('delivery')?.userData as {
      wheelPositions: [number, number, number][]
    }
    return {
      body: paintModel(getModel(scene, 'delivery'), DELIVERY_BIKE_COLOR),
      front: paintModel(getModel(scene, 'delivery-front'), DELIVERY_BIKE_COLOR),
      wheel: getModel(scene, 'delivery-wheel'),
      wheelPositions,
    }
  }, [scene])

  useEffect(
    () => () => {
      parts.body.dispose()
      parts.front.dispose()
    },
    [parts],
  )

  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <mesh geometry={parts.body} castShadow>
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh geometry={parts.front} castShadow>
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.3} />
      </mesh>
      {parts.wheelPositions.map((position) => (
        <mesh key={position[2]} geometry={parts.wheel} position={position}>
          <meshStandardMaterial vertexColors roughness={0.55} />
        </mesh>
      ))}
    </group>
  )
}

/** The front of the dark store, added to a real building on the map. */
export function DarkStoreBuilding({ store }: { store: DarkStore }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const textures = useMemo(
    () => ({
      sign: createSignTexture(),
      shelves: createShelvesTexture(),
      yard: createYardTexture(),
    }),
    [],
  )

  useEffect(
    () => () => Object.values(textures).forEach((texture) => texture.dispose()),
    [textures],
  )

  const { width } = store
  const openingWidth = width - 1.2
  const frontZ = WALL_GAP + FRONT_DEPTH / 2
  const faceZ = WALL_GAP + FRONT_DEPTH + 0.01

  return (
    <>
      <group position={[store.x, 0, store.z]} rotation={[0, store.rotation, 0]}>
        {/* The frame around the opening, as a wall above and a post each side. */}
        <mesh position={[0, (FRONT_HEIGHT + OPENING_HEIGHT) / 2, frontZ]} castShadow>
          <boxGeometry args={[width, FRONT_HEIGHT - OPENING_HEIGHT, FRONT_DEPTH]} />
          <meshStandardMaterial color="#1a1b1f" roughness={0.6} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[(side * (width - 0.6)) / 2 + side * 0.15, OPENING_HEIGHT / 2, frontZ]}>
            <boxGeometry args={[0.3, OPENING_HEIGHT, FRONT_DEPTH]} />
            <meshStandardMaterial color="#1a1b1f" roughness={0.6} />
          </mesh>
        ))}

        {/* Basic materials stay bright, so the shelves and sign read as lit at night too. */}
        <mesh position={[0, OPENING_HEIGHT / 2, WALL_GAP + 0.02]}>
          <planeGeometry args={[openingWidth, OPENING_HEIGHT]} />
          <meshBasicMaterial map={textures.shelves} />
        </mesh>

        <mesh position={[0, FRONT_HEIGHT - SIGN_HEIGHT / 2 - 0.04, faceZ + SIGN_DEPTH / 2]}>
          <boxGeometry args={[width - 0.3, SIGN_HEIGHT, SIGN_DEPTH]} />
          <meshBasicMaterial attach="material-0" color="#0f1012" />
          <meshBasicMaterial attach="material-1" color="#0f1012" />
          <meshBasicMaterial attach="material-2" color="#0f1012" />
          <meshBasicMaterial attach="material-3" color="#0f1012" />
          <meshBasicMaterial attach="material-4" map={textures.sign} toneMapped={false} />
          <meshBasicMaterial attach="material-5" color="#0f1012" />
        </mesh>

        {/* The riders' bay, painted on the ground. */}
        <mesh position={[0, 0.09, faceZ + YARD_DEPTH]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width, STRIPE_WIDTH]} />
          <meshBasicMaterial
            map={textures.yard}
            polygonOffset
            polygonOffsetFactor={YARD_DEPTH_NUDGE}
            polygonOffsetUnits={YARD_DEPTH_NUDGE}
          />
        </mesh>

        <pointLight position={[0, 2.6, faceZ + 1.2]} color={NIGHT_LIGHT} intensity={8} distance={9} />
      </group>

      {store.bikes.map(({ x, z, rotation }) => (
        <ParkedBike key={x} x={x} z={z} rotation={rotation} scene={scene} />
      ))}
    </>
  )
}
