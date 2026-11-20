import { useEffect, type RefObject } from 'react'
import { useGameStore } from '../game/gameStore'
import { liveView } from '../game/livePlayer'
import { clearSpots } from '../game/interact'
import { liveRoom, useRoom } from '../game/rooms'
import type { TrafficWorld } from '../traffic/trafficLogic'
import { usePause } from '../ui/uiState'
import { ROAD_HEIGHT } from '../world/surface'
import type { ScooterState } from './ScooterController'
import { liveVehicle } from './vehicleCatalog'

/*
 * Unstuck, from the pause menu: wherever the rider has got wedged (between two walls, behind a
 * gate, up a kerb the vehicle won't come down), they and their vehicle are put back on the nearest
 * road at ground level, upright, standing still and facing along it. On foot, they're back on the
 * vehicle; in a room, they're let out first. Nothing is lost: an order on stays on.
 */

/** How far along a lane from its start the vehicle is put at the least, in metres, to keep off junctions. */
const FROM_END = 3

export function Unstuck({ scooter, traffic }: { scooter: RefObject<ScooterState>; traffic: TrafficWorld }) {
  useEffect(
    () =>
      usePause.subscribe((state, previous) => {
        if (state.unstuck === previous.unstuck) return
        const vehicle = scooter.current
        // In a room (which is under the street, out of sight): out of it at once, by the door they came in at.
        const inRoom = liveRoom.kind !== null
        if (inRoom) {
          clearSpots('room:')
          liveRoom.kind = null
          liveRoom.blocks = []
          liveRoom.frozen = false
          useRoom.setState({ kind: null, label: '', fading: false })
        }
        // The nearest road to where the rider is: themselves on foot, the door of a room they were in, or the vehicle.
        const afoot = vehicle.rider.phase !== 'on'
        const fromX = inRoom ? liveRoom.exit.x : afoot ? vehicle.rider.x : vehicle.x
        const fromZ = inRoom ? liveRoom.exit.z : afoot ? vehicle.rider.z : vehicle.z

        // The nearest spot on any street's lane that's on the ground (not up on a flyover) and open.
        let best: { x: number; z: number; heading: number; distance: number } | null = null
        for (const lane of traffic.roadLanes) {
          if (lane.deck || lane.closed || lane.inJunction || lane.length < FROM_END * 2) continue
          const along = Math.max(FROM_END, Math.min(lane.length - FROM_END, (fromX - lane.startX) * lane.forwardX + (fromZ - lane.startZ) * lane.forwardZ))
          const x = lane.startX + lane.forwardX * along
          const z = lane.startZ + lane.forwardZ * along
          const distance = Math.hypot(x - fromX, z - fromZ)
          if (!best || distance < best.distance) best = { x, z, heading: Math.atan2(lane.forwardX, lane.forwardZ), distance }
        }
        if (!best) return

        vehicle.x = best.x
        vehicle.z = best.z
        vehicle.heading = best.heading
        vehicle.speed = 0
        vehicle.velocityX = 0
        vehicle.velocityZ = 0
        vehicle.lean = 0
        vehicle.pitch = 0
        vehicle.crashLeft = 0
        vehicle.frontWheel.height = ROAD_HEIGHT
        vehicle.rearWheel.height = ROAD_HEIGHT
        vehicle.frontWheel.fall = 0
        vehicle.rearWheel.fall = 0
        // The rider is on it, wherever they were: seated (`off` is how far off the seat they're drawn),
        // not left standing where they'd got stuck.
        const rider = vehicle.rider
        rider.phase = 'on'
        rider.off = 0
        rider.time = 0
        rider.pace = 0
        rider.x = best.x
        rider.z = best.z
        rider.heading = best.heading
        rider.ground = ROAD_HEIGHT
        rider.walkX = 0
        rider.walkZ = 0
        rider.velocityX = 0
        rider.velocityY = 0
        rider.velocityZ = 0
        rider.lean = 0
        rider.tip = 0
        rider.roll = 0
        liveVehicle.cockpit = false
        liveView.snapBehind = true
        useGameStore.getState().raviSays('Back on the road, maga. Happens to everyone in these lanes.')
      }),
    [scooter, traffic],
  )
  return null
}
