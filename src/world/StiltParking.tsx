import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { livePlayer } from '../game/livePlayer'
import { getStreetReflection } from '../traffic/carModel'
import { TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { CAR_COLORS, PARKED_COLORS, tintPaintOnly } from '../traffic/vehiclePaint'
import { createParkedCarGeometry, createParkedScooterGeometry } from '../traffic/vehicleShapes'
import { STEERING_Z } from '../vehicle/Rider'
import type { StiltVehicle } from './houseKit'

/** Parked vehicles further than this aren't drawn, in metres. Under a building, they're hard to see from further. */
const DRAW_DISTANCE = 75
/** They never move, so which ones are near is only worked out every so many frames. */
const REFRESH_FRAMES = 20
const CAR_MODEL = 'hatchback'
/** The top of the concrete slab under the stilts, which the vehicles stand on. */
const FLOOR_TOP = 0.06

const transform = new THREE.Object3D()
const color = new THREE.Color()

/**
 * Copies of one parked shape, drawing only those near the rider. Only the
 * nearest few dozen are ever sent to the GPU, as the models are detailed.
 */
function Parked({
  items,
  geometry,
  palette,
  reflection,
}: {
  items: StiltVehicle[]
  geometry: THREE.BufferGeometry
  palette: string[]
  reflection: THREE.Texture
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const frame = useRef(0)

  useFrame(() => {
    const instances = mesh.current
    if (!instances || frame.current++ % REFRESH_FRAMES !== 0) return
    let drawn = 0
    for (const item of items) {
      if (Math.hypot(item.x - livePlayer.x, item.z - livePlayer.z) > DRAW_DISTANCE) continue
      transform.position.set(item.x, FLOOR_TOP, item.z)
      transform.rotation.set(0, item.rotation, 0)
      transform.updateMatrix()
      instances.setMatrixAt(drawn, transform.matrix)
      instances.setColorAt(drawn, color.set(palette[Math.floor(item.variation * palette.length * 0.999)]))
      drawn++
    }
    instances.count = drawn
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  if (items.length === 0) return null
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, items.length]} frustumCulled={false} receiveShadow>
      <meshStandardMaterial
        vertexColors
        envMap={reflection}
        envMapIntensity={0.5}
        roughness={0.35}
        metalness={0.3}
        onBeforeCompile={tintPaintOnly}
      />
    </instancedMesh>
  )
}

/** Bikes and cars parked under blocks of flats on stilts. */
export function StiltParking({ vehicles }: { vehicles: StiltVehicle[] }) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const gl = useThree((state) => state.gl)
  const reflection = getStreetReflection(gl)

  const shapes = useMemo(
    () => ({
      bike: createParkedScooterGeometry(scene, STEERING_Z),
      car: createParkedCarGeometry(scene, CAR_MODEL),
    }),
    [scene],
  )
  useEffect(
    () => () => {
      shapes.bike.dispose()
      shapes.car.dispose()
    },
    [shapes],
  )

  const bikes = useMemo(() => vehicles.filter(({ car }) => !car), [vehicles])
  const cars = useMemo(() => vehicles.filter(({ car }) => car), [vehicles])

  return (
    <>
      <Parked items={bikes} geometry={shapes.bike} palette={PARKED_COLORS} reflection={reflection} />
      <Parked items={cars} geometry={shapes.car} palette={CAR_COLORS} reflection={reflection} />
    </>
  )
}
