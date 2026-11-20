import { useEffect, type RefObject } from 'react'
import { useGameStore } from '../game/gameStore'
import { liveView } from '../game/livePlayer'
import { leaveRoom, liveRoom } from '../game/rooms'
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
        if (liveRoom.kind) leaveRoom()
        const afoot = vehicle.rider.phase !== 'on'
        const fromX = afoot && !liveRoom.kind ? vehicle.rider.x : vehicle.x
        const fromZ = afoot && !liveRoom.kind ? vehicle.rider.z : vehicle.z

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
        vehicle.rider.phase = 'on'
        vehicle.rider.time = 0
        vehicle.rider.pace = 0
        liveVehicle.cockpit = false
        liveView.snapBehind = true
        useGameStore.getState().raviSays('Back on the road, maga. Happens to everyone in these lanes.')
      }),
    [scooter, traffic],
  )
  return null
}
