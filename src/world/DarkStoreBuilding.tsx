import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  DELIVERY_BIKE_COLOR,
  getModel,
  paintModel,
  TRAFFIC_MODELS_URL,
} from '../traffic/modelFiles'
import { livePlayer } from '../game/livePlayer'
import type { DarkStore } from './darkStore'
import { groundLift } from './groundLift'

const FRONT_HEIGHT = 3.4
const FRONT_DEPTH = 0.3
/** The front stands this far off the wall, in front of any wall pieces. */
const WALL_GAP = 0.3
const OPENING_HEIGHT = 2.5
const SIGN_HEIGHT = 0.8
const SIGN_DEPTH = 0.16
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
    <group position={[x, groundLift.at(x, z), z]} rotation={[0, rotation, 0]}>
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

type StoreTextures = { sign: THREE.CanvasTexture; shelves: THREE.CanvasTexture }

/** The light over the riders' bay, from the store's front wall, in metres: up and out. */
const LIGHT_UP = 2.6
const LIGHT_OUT = WALL_GAP + FRONT_DEPTH + 1.2

/**
 * Every dark store's front. Their pictures are shared. Only one light is used,
 * moved to whichever store is nearest the rider: each light in a scene adds
 * work to every lit surface, and only the nearest store's is close enough to see.
 */
export function DarkStores({ stores }: { stores: DarkStore[] }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const textures = useMemo(
    () => ({
      sign: createSignTexture(),
      shelves: createShelvesTexture(),
    }),
    [],
  )
  useEffect(
    () => () => Object.values(textures).forEach((texture) => texture.dispose()),
    [textures],
  )

  const light = useRef<THREE.PointLight>(null)
  useFrame(() => {
    if (!light.current) return
    let nearest = stores[0]
    let nearestDistance = Infinity
    for (const store of stores) {
      const distance = Math.hypot(store.x - livePlayer.x, store.z - livePlayer.z)
      if (distance < nearestDistance) {
        nearest = store
        nearestDistance = distance
      }
    }
    light.current.position.set(
      nearest.x + Math.sin(nearest.rotation) * LIGHT_OUT,
      LIGHT_UP,
      nearest.z + Math.cos(nearest.rotation) * LIGHT_OUT,
    )
  })

  return (
    <>
      {stores.map((store) => (
        <DarkStoreBuilding key={store.node} store={store} textures={textures} scene={scene} />
      ))}
      <pointLight ref={light} color={NIGHT_LIGHT} intensity={8} distance={9} />
    </>
  )
}

/** The front of a dark store, added to a real building on the map. */
function DarkStoreBuilding({ store, textures, scene }: { store: DarkStore; textures: StoreTextures; scene: THREE.Group }) {
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


      </group>

      {store.bikes.map(({ x, z, rotation }) => (
        <ParkedBike key={x} x={x} z={z} rotation={rotation} scene={scene} />
      ))}
    </>
  )
}
