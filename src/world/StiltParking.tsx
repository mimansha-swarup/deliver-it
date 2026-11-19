import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { getStreetReflection } from '../traffic/carModel'
import { TRAFFIC_MODELS_URL } from '../traffic/modelFiles'
import { CAR_COLORS, PARKED_COLORS, tintPaintOnly } from '../traffic/vehiclePaint'
import { createParkedCarGeometry, createParkedScooterGeometry } from '../traffic/vehicleShapes'
import { STEERING_Z } from '../vehicle/Rider'
import type { StiltVehicle } from './houseKit'
import { cameraDistance, isDetailed, lodCamera } from '../traffic/vehicleLod'

/** Parked vehicles further than this aren't drawn, in metres. Under a building, they're hard to see from further. */
const DRAW_DISTANCE = 75
/** Nearer than this they're the detailed models; further, the far versions of a few hundred triangles. */
const DETAIL_DISTANCE = 35
/** They never move, so which ones are near is only worked out every so many frames. */
const REFRESH_FRAMES = 6
/** Every this many frames, the whole list is searched for the ones within reach plus NEARBY_SLACK metres; between, only those are looked at. */
const NEARBY_FRAMES = 60
const NEARBY_SLACK = 30
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
  from,
  to,
}: {
  items: StiltVehicle[]
  geometry: THREE.BufferGeometry
  palette: string[]
  reflection: THREE.Texture
  /** Drawn only between these distances from the rider, in metres. */
  from: number
  to: number
}) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const frame = useRef(0)
  /** The ones near enough to be drawn soon, listed afresh every NEARBY_FRAMES: the kerbside lists hold thousands. */
  const nearby = useRef<StiltVehicle[]>([])

  useFrame(({ camera }) => {
    const instances = mesh.current
    if (!instances || frame.current++ % REFRESH_FRAMES !== 0) return
    lodCamera.x = camera.position.x
    lodCamera.z = camera.position.z
    if ((frame.current - 1) % NEARBY_FRAMES === 0) {
      const limit = to + NEARBY_SLACK
      const { x, z } = camera.position
      nearby.current = items.filter((item) => Math.abs(item.x - x) < limit && Math.abs(item.z - z) < limit)
    }
    let drawn = 0
    for (const item of nearby.current) {
      // Detailed or far by the camera's distance, with hysteresis (vehicleLod.ts): the cutoff is
      // `to` for the detailed copies and `from` for the far ones.
      if (from > 0 ? isDetailed(item, from) || cameraDistance(item.x, item.z) > to : !isDetailed(item, to)) continue
      transform.position.set(item.x, FLOOR_TOP, item.z)
      transform.rotation.set(0, item.rotation, 0)
      transform.updateMatrix()
      instances.setMatrixAt(drawn, transform.matrix)
      instances.setColorAt(drawn, color.set(palette[Math.floor(item.variation * palette.length * 0.999)]))
      drawn++
    }
    instances.count = drawn
    // Only the slots in use go to the GPU: the kerbside lists hold thousands, of which a few dozen are drawn.
    instances.instanceMatrix.clearUpdateRanges()
    instances.instanceMatrix.addUpdateRange(0, drawn * 16)
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) {
      instances.instanceColor.clearUpdateRanges()
      instances.instanceColor.addUpdateRange(0, drawn * 3)
      instances.instanceColor.needsUpdate = true
    }
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

/**
 * Bikes and cars parked under blocks of flats on stilts, and, with a longer `drawDistance` and a
 * few car models, along the kerb (streetParking.ts).
 */
export function StiltParking({
  vehicles,
  drawDistance = DRAW_DISTANCE,
  carModels = [CAR_MODEL],
}: {
  vehicles: StiltVehicle[]
  drawDistance?: number
  carModels?: readonly string[]
}) {
  const { scene } = useGLTF(TRAFFIC_MODELS_URL)
  const gl = useThree((state) => state.gl)
  const reflection = getStreetReflection(gl)

  const shapes = useMemo(
    () => ({
      bike: createParkedScooterGeometry(scene, STEERING_Z),
      bikeFar: createParkedScooterGeometry(scene, STEERING_Z, true),
      cars: carModels.map((model) => createParkedCarGeometry(scene, model)),
      carsFar: carModels.map((model) => createParkedCarGeometry(scene, model, true)),
    }),
    [scene, carModels],
  )
  useEffect(
    () => () => {
      for (const shape of [shapes.bike, shapes.bikeFar, ...shapes.cars, ...shapes.carsFar]) shape.dispose()
    },
    [shapes],
  )

  const bikes = useMemo(() => vehicles.filter(({ car }) => !car), [vehicles])
  const carsByModel = useMemo(() => carModels.map((_, model) => vehicles.filter((item) => item.car && (item.model ?? 0) === model)), [vehicles, carModels])

  return (
    <>
      <Parked items={bikes} geometry={shapes.bike} palette={PARKED_COLORS} reflection={reflection} from={0} to={DETAIL_DISTANCE} />
      <Parked items={bikes} geometry={shapes.bikeFar} palette={PARKED_COLORS} reflection={reflection} from={DETAIL_DISTANCE} to={drawDistance} />
      {carsByModel.map((cars, model) => (
        <Fragment key={model}>
          <Parked items={cars} geometry={shapes.cars[model]} palette={CAR_COLORS} reflection={reflection} from={0} to={DETAIL_DISTANCE} />
          <Parked items={cars} geometry={shapes.carsFar[model]} palette={CAR_COLORS} reflection={reflection} from={DETAIL_DISTANCE} to={drawDistance} />
        </Fragment>
      ))}
    </>
  )
}
