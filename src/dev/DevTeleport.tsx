import { useEffect, type RefObject } from 'react'
import type { ScooterState } from '../vehicle/ScooterController'
import { teleportSpots } from './teleportSpots'

/*
 * TEMPORARY, for looking around while building the city: press J to jump to
 * the next spot in `teleportSpots` (the Jagannath temples for now). Only in the
 * dev server, never in a build. Remove this file, teleportSpots.ts and their uses (World.tsx,
 * Player.tsx) when done.
 */


let next = 0

function jump(scooter: ScooterState) {
  if (teleportSpots.length === 0) return
  const spot = teleportSpots[next % teleportSpots.length]
  next++
  scooter.x = spot.x
  scooter.z = spot.z
  scooter.heading = spot.heading
  scooter.speed = 0
  scooter.velocityX = 0
  scooter.velocityZ = 0
  console.info(`[dev] teleported to ${spot.name}`)
}

export function DevTeleport({ scooter }: { scooter: RefObject<ScooterState> }) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyJ' && !event.repeat) jump(scooter.current)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [scooter])
  return null
}
