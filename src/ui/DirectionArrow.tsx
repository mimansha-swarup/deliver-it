import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { getCurrentStop } from '../missions/missionLogic'

/** How quickly the arrow swings to a new direction. Higher is tighter. */
const TURN_RESPONSE = 9

/** The shortest signed turn between two angles, between -PI and PI. */
function angleBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** A large arrow where up means straight ahead, showing which way the route goes next. */
export function DirectionArrow() {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const arrow = useRef<HTMLDivElement>(null)
  const stop = getCurrentStop(mission, phase)

  useEffect(() => {
    let frame = 0
    let previousTime = performance.now()
    let shownAngle = 0

    const update = (time: number) => {
      const delta = (time - previousTime) / 1000
      previousTime = time

      const bearing = Math.atan2(liveRoute.aimX - livePlayer.x, liveRoute.aimZ - livePlayer.z)
      // Heading grows when turning left, but CSS rotation grows clockwise.
      const target = livePlayer.heading - bearing
      shownAngle += angleBetween(shownAngle, target) * (1 - Math.exp(-TURN_RESPONSE * delta))

      if (arrow.current) arrow.current.style.transform = `rotate(${shownAngle}rad)`
      frame = requestAnimationFrame(update)
    }

    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!stop) return null

  return (
    <div className="direction-arrow" ref={arrow}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path
          d="M50 6 L90 54 L65 54 L65 94 L35 94 L35 54 L10 54 Z"
          fill={stop.color}
          stroke="#0f1115"
          strokeWidth="6"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
