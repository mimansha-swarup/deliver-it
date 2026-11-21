import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { FLEET_MODELS_URL, getModel, paintModel, PEOPLE_MODELS_URL } from '../traffic/modelFiles'
import { createRiderModel, createSeatedRiderGeometry, type RiderLook } from '../vehicle/riderModel'
import { createBuiltStill, setFleetModels } from '../vehicle/vehicleBodies'
import { VEHICLES, type VehicleId } from '../vehicle/vehicleCatalog'
import { useRoomStore, type Rider } from './room'

/*
 * The other riders in the room (net/room.ts), each drawn where their last news put them and eased
 * towards it, so ten updates a second look like riding and not like jumping. Each is the vehicle
 * they're on, as one still shape, with a rider seated on it in the yellow jacket and a helmet in
 * their own colour, and their name over them. On foot, their vehicle stands where they left it and
 * they stand beside wherever they've walked to. They're not solid: riders pass through each other.
 */

const LOOK: RiderLook = { jacket: '#f2b82a', glove: '#1c1d20', trousers: '#2b3a55', shoe: '#17171a', ownGear: true }
/** How quickly a rider closes on where their news says they are, per second, and how far off is a jump (a teleport), not a ride. */
const EASE = 9
const JUMP = 40

function nameTag(name: string, colour: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context) {
    context.font = "800 54px 'Baloo Tamma 2', system-ui, sans-serif"
    const wide = Math.min(360, context.measureText(name).width + 48)
    context.fillStyle = 'rgb(14 17 22 / 82%)'
    context.beginPath()
    context.roundRect((384 - wide) / 2, 10, wide, 76, 38)
    context.fill()
    context.fillStyle = colour
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(name, 192, 52, 330)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
  sprite.scale.set(1.6, 0.4, 1)
  return sprite
}

function RemoteRider({ id, shapes, material }: { id: string; shapes: (vehicle: VehicleId, colour: string) => { vehicle: THREE.BufferGeometry; rider: THREE.BufferGeometry }; material: THREE.Material }) {
  const name = useRoomStore((state) => state.riders[id]?.name ?? '')
  const colour = useRoomStore((state) => state.riders[id]?.colour ?? '#ffffff')
  const vehicleId = useRoomStore((state) => state.riders[id]?.vehicle ?? 'scooter')
  const onFoot = useRoomStore((state) => state.riders[id]?.onFoot ?? false)
  const cab = VEHICLES[vehicleId]?.size.cab ?? false
  const { vehicle, rider } = useMemo(() => shapes(vehicleId, colour), [shapes, vehicleId, colour])
  const tag = useMemo(() => nameTag(name, colour), [name, colour])
  useEffect(
    () => () => {
      tag.material.map?.dispose()
      tag.material.dispose()
    },
    [tag],
  )
  const ride = useRef<THREE.Group>(null)
  const walker = useRef<THREE.Group>(null)
  const placed = useRef(false)

  useFrame((_, delta) => {
    const news: Rider | undefined = useRoomStore.getState().riders[id]
    if (!news || !ride.current || !walker.current) return
    const pull = 1 - Math.exp(-EASE * Math.min(delta, 0.1))
    const ease = (group: THREE.Group, x: number, y: number, z: number, heading: number) => {
      const far = Math.hypot(group.position.x - x, group.position.z - z) > JUMP
      if (!placed.current || far) group.position.set(x, y, z)
      else group.position.set(group.position.x + (x - group.position.x) * pull, group.position.y + (y - group.position.y) * pull, group.position.z + (z - group.position.z) * pull)
      const turn = Math.atan2(Math.sin(heading - group.rotation.y), Math.cos(heading - group.rotation.y))
      group.rotation.y = !placed.current || far ? heading : group.rotation.y + turn * pull
    }
    // Riding, the vehicle is where they are. On foot it stands where it was left, and they've walked on.
    if (news.onFoot) {
      ease(ride.current, news.vehicleX, 0.05, news.vehicleZ, news.vehicleHeading)
      ease(walker.current, news.x, Math.max(0, news.height), news.z, news.heading)
    } else {
      ease(ride.current, news.x, Math.max(0, news.height), news.z, news.heading)
      walker.current.position.copy(ride.current.position)
    }
    placed.current = true
  })

  return (
    <>
      <group ref={ride}>
        <mesh geometry={vehicle} material={material} castShadow />
        {/* In a cab they're inside it, unseen; on two wheels they're on it. */}
        {!onFoot && !cab && <mesh geometry={rider} material={material} castShadow />}
        {!onFoot && <primitive object={tag} position={[0, cab ? 2.6 : 2.05, 0]} />}
      </group>
      <group ref={walker} visible={onFoot}>
        <mesh geometry={shapes('scooter', colour).rider} material={material} position={[0, -0.42, 0.3]} />
        {onFoot && <primitive object={tag} position={[0, 2.0, 0]} />}
      </group>
    </>
  )
}

/** In the Canvas: everyone else in the room. Nothing is built or drawn outside a room. */
export function RemoteRiders() {
  const ids = useRoomStore((state) => Object.keys(state.riders).sort().join(','))
  const { scene: people } = useGLTF(PEOPLE_MODELS_URL)
  const { scene: fleet } = useGLTF(FLEET_MODELS_URL)
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), [])
  useEffect(() => () => material.dispose(), [material])

  // Each vehicle and its seated rider are built once per helmet colour, and kept while the room lasts.
  const cache = useRef(new Map<string, { vehicle: THREE.BufferGeometry; rider: THREE.BufferGeometry }>())
  const shapes = useMemo(() => {
    setFleetModels(fleet)
    const person = createRiderModel(getModel(people, 'biker'), LOOK)
    return (vehicleId: VehicleId, colour: string) => {
      const key = `${vehicleId} ${colour}`
      let built = cache.current.get(key)
      if (!built) {
        const spec = VEHICLES[vehicleId] ?? VEHICLES.scooter
        const { seat } = spec
        const seated = createSeatedRiderGeometry(
          person,
          LOOK,
          { hip: new THREE.Vector3(...seat.hip), lean: seat.lean, hands: new THREE.Vector3(seat.grip[0], seat.grip[1], seat.column + seat.grip[2]), feet: new THREE.Vector3(...seat.foot) },
          colour,
        )
        const rider = paintModel(seated, LOOK.jacket)
        seated.dispose()
        rider.translate(seat.side, 0, 0)
        built = { vehicle: createBuiltStill(spec.body, spec.paint ?? '#17181b'), rider }
        cache.current.set(key, built)
      }
      return built
    }
  }, [people, fleet])
  useEffect(() => {
    const kept = cache.current
    return () => {
      for (const { vehicle, rider } of kept.values()) {
        vehicle.dispose()
        rider.dispose()
      }
      kept.clear()
    }
  }, [])

  if (!ids) return null
  return (
    <>
      {ids.split(',').map((id) => (
        <RemoteRider key={id} id={id} shapes={shapes} material={material} />
      ))}
    </>
  )
}
