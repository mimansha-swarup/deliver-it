import { useEffect, useMemo, useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { FLEET_MODELS_URL, getModel, paintModel, PEOPLE_MODELS_URL, TRIPO_MODELS_URL } from '../traffic/modelFiles'
import { createRiderModel, createSeatedRiderGeometry, type RiderLook } from '../vehicle/riderModel'
import { createBuiltFar, createBuiltStill, setFleetModels } from '../vehicle/vehicleBodies'
import { VEHICLES, type VehicleId } from '../vehicle/vehicleCatalog'
import { livePlayer } from '../game/livePlayer'
import { addWall, removeFootprint, type CollisionWorld, type Footprint } from '../world/collision'
import { useRoomStore, type Rider } from './room'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('rider and vehicle')

/*
 * The other riders in the room (net/room.ts), each drawn where their last news put them and eased
 * towards it, so ten updates a second look like riding and not like jumping. Each is the vehicle
 * they're on, as one still shape, with a rider seated on it in a jacket of their own colour in the
 * room, and their name over them. On foot, their vehicle stands where they left it and
 * they stand beside wherever they've walked to. They're solid: riding into one is a bump (`SolidFriends`).
 */

/** Everyone's helmet is the same off-white; it's the jacket that says who they are. */
const HELMET = '#ecebe6'
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

/** Beyond this, in metres, a vehicle that has a far version is drawn with it. */
const FAR_FROM = 45

type Shapes = (vehicle: VehicleId, colour: string) => { vehicle: THREE.BufferGeometry; far: THREE.BufferGeometry | null; rider: THREE.BufferGeometry }

function RemoteRider({ id, shapes, material }: { id: string; shapes: Shapes; material: THREE.Material }) {
  const name = useRoomStore((state) => state.riders[id]?.name ?? '')
  const colour = useRoomStore((state) => state.riders[id]?.colour ?? '#ffffff')
  const vehicleId = useRoomStore((state) => state.riders[id]?.vehicle ?? 'scooter')
  const onFoot = useRoomStore((state) => state.riders[id]?.onFoot ?? false)
  const cab = VEHICLES[vehicleId]?.size.cab ?? false
  const { vehicle, far, rider } = useMemo(() => shapes(vehicleId, colour), [shapes, vehicleId, colour])
  const near = useRef<THREE.Mesh>(null)
  const distant = useRef<THREE.Mesh>(null)
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

  useFrame(({ camera }, delta) => {
    const news: Rider | undefined = useRoomStore.getState().riders[id]
    if (!news || !ride.current || !walker.current) return
    if (near.current && distant.current) {
      const away = camera.position.distanceTo(ride.current.position) > FAR_FROM
      near.current.visible = !away
      distant.current.visible = away
    }
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
        <mesh ref={near} geometry={vehicle} material={material} castShadow />
        {far && <mesh ref={distant} geometry={far} material={material} visible={false} />}
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

/** How often each friend's solid shape is moved to where they are, in seconds, and how near is "already touching". */
const SOLID_EVERY = 0.1
const TOUCHING = 0.9

/**
 * Friends are solid: each one's vehicle (and themselves, on foot) is a shape in this rider's own
 * collision world, moved to where their news puts them ten times a second, so riding into a
 * friend is hitting something, as hitting a parked car is. Each browser does this for itself, so
 * both riders feel a bump: the one who rode in, and the one who was ridden into.
 *
 * Not while the two are already on top of each other (both just arrived at the same spot, or one
 * was put there): a shape appearing round a rider would trap them, so it waits until they part.
 */
function SolidFriends({ collisions }: { collisions: CollisionWorld }) {
  const shapes = useRef(new Map<string, Footprint[]>())
  const since = useRef(0)
  useEffect(() => {
    const kept = shapes.current
    return () => {
      for (const list of kept.values()) for (const shape of list) removeFootprint(collisions, shape)
      kept.clear()
    }
  }, [collisions])

  useFrame((_, delta) => {
    since.current += delta
    if (since.current < SOLID_EVERY) return
    since.current = 0
    const { riders } = useRoomStore.getState()
    for (const [id, list] of shapes.current) {
      for (const shape of list) removeFootprint(collisions, shape)
      if (!riders[id]) shapes.current.delete(id)
    }
    for (const rider of Object.values(riders)) {
      const list: Footprint[] = []
      const { size } = VEHICLES[rider.vehicle] ?? VEHICLES.scooter
      // Their vehicle: where they are, or where they left it.
      const [x, z, heading] = rider.onFoot ? [rider.vehicleX, rider.vehicleZ, rider.vehicleHeading] : [rider.x, rider.z, rider.heading]
      const half = size.length / 2
      const apart = Math.hypot(x - livePlayer.x, z - livePlayer.z)
      if (apart > half + TOUCHING) {
        const dirX = Math.sin(heading)
        const dirZ = Math.cos(heading)
        const wall = addWall(collisions, [x - dirX * half, z - dirZ * half], [x + dirX * half, z + dirZ * half], Math.max(0.5, size.width * 0.8))
        if (wall) list.push(wall)
      }
      // Themselves, on foot: a small square.
      if (rider.onFoot && Math.hypot(rider.x - livePlayer.x, rider.z - livePlayer.z) > TOUCHING) {
        const post = addWall(collisions, [rider.x - 0.3, rider.z], [rider.x + 0.3, rider.z], 0.6)
        if (post) list.push(post)
      }
      shapes.current.set(rider.id, list)
    }
  })
  return null
}

/** In the Canvas: everyone else in the room. Nothing is built or drawn outside a room. */
export function RemoteRiders({ collisions }: { collisions: CollisionWorld }) {
  const ids = useRoomStore((state) => Object.keys(state.riders).sort().join(','))
  const { scene: people } = useGLTF(PEOPLE_MODELS_URL)
  const { scene: fleet } = useGLTF(FLEET_MODELS_URL)
  const { scene: tripo } = useGLTF(TRIPO_MODELS_URL)
  const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), [])
  useEffect(() => () => material.dispose(), [material])

  // Each vehicle and its seated rider are built once per helmet colour, and kept while the room lasts.
  const cache = useRef(new Map<string, ReturnType<Shapes>>())
  const shapes = useMemo(() => {
    setFleetModels(fleet)
    setFleetModels(tripo)
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
          HELMET,
        )
        // Their jacket is their colour in the room: who is who, from any distance.
        const rider = paintModel(seated, colour)
        seated.dispose()
        rider.translate(seat.side, 0, 0)
        built = { vehicle: createBuiltStill(spec.body, spec.paint ?? '#17181b'), far: createBuiltFar(spec.body, spec.paint ?? '#17181b'), rider }
        cache.current.set(key, built)
      }
      return built
    }
  }, [people, fleet, tripo])
  useEffect(() => {
    const kept = cache.current
    return () => {
      for (const { vehicle, far, rider } of kept.values()) {
        vehicle.dispose()
        far?.dispose()
        rider.dispose()
      }
      kept.clear()
    }
  }, [])

  if (!ids) return null
  return (
    <>
      <SolidFriends collisions={collisions} />
      {ids.split(',').map((id) => (
        <RemoteRider key={id} id={id} shapes={shapes} material={material} />
      ))}
    </>
  )
}
