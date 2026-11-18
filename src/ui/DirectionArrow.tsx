import { useEffect, useRef } from 'react'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveRoute } from '../game/livePlayer'
import { moodOf } from '../missions/customerChat'
import { currentTarget } from './mapDrawing'

/** How quickly the arrow swings to a new direction. Higher is tighter. */
const TURN_RESPONSE = 9

/** The shortest signed turn between two angles, between -PI and PI. */
function angleBetween(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/** The customer's mood: a word and a bar, green to red, while their order is on its way. */
function MoodMeter({ className }: { className: string }) {
  const frustration = useGameStore((state) => state.frustration)
  const fumingLeft = useGameStore((state) => state.fumingLeft)
  const customer = useGameStore((state) => state.mission?.story.customer)
  const riding = useGameStore((state) => state.phase === 'toPickup' || state.phase === 'toCustomer')
  if (!customer || !riding) return null
  const mood = moodOf(frustration)
  return (
    <div className={className} data-mood={mood.toLowerCase()} title={`${customer} is ${mood.toLowerCase()}`}>
      <span className="mood-label">
        {customer} · <strong>{mood}</strong>
        {fumingLeft > 0 && <span className="mood-cancels"> · cancels in {fumingLeft}s</span>}
      </span>
      <span className="mood-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(frustration * 100)}%` }} />
      </span>
    </div>
  )
}

function formatTime(seconds: number): string {
  const whole = Math.abs(Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The order's time left, then how late, in red. */
function OrderTimer() {
  const onTime = useGameStore((state) => state.mission?.onTimeSeconds ?? null)
  const seconds = useGameStore((state) => state.seconds)
  const riding = useGameStore((state) => state.phase === 'toPickup' || state.phase === 'toCustomer')
  const graceLeft = useGameStore((state) => state.graceLeft)
  if (onTime === null || !riding) return null
  if (graceLeft > 0) {
    return (
      <span className="route-timer" data-grace="true" title="The order's clock starts after a short grace">
        {formatTime(onTime)} <small>starts in {graceLeft}</small>
      </span>
    )
  }
  const left = onTime - seconds
  return (
    <span className="route-timer" data-late={left < 0} data-hurry={left >= 0 && left <= 20}>
      {left < 0 ? `+${formatTime(-left)}` : formatTime(left)}
    </span>
  )
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`
}

/**
 * Top centre, and nothing else there: the order's timer with the customer's mood beside it, a large
 * arrow where up means straight ahead (to the stop, or the rider's waypoint), and the distance by road.
 */
export function DirectionArrow() {
  const hasTarget = useGameStore((state) => {
    const riding = state.phase === 'toPickup' || state.phase === 'toCustomer'
    return (state.mission !== null && riding) || (state.mission === null && state.waypoint !== null)
  })
  const distance = useGameStore((state) => state.distance)
  const arrow = useRef<HTMLDivElement>(null)
  const path = useRef<SVGPathElement>(null)

  useEffect(() => {
    let frame = 0
    let previousTime = performance.now()
    let shownAngle = 0

    const update = (time: number) => {
      const delta = Math.max(0, (time - previousTime) / 1000)
      previousTime = time

      const bearing = Math.atan2(liveRoute.aimX - livePlayer.x, liveRoute.aimZ - livePlayer.z)
      // Heading grows when turning left, but CSS rotation grows clockwise.
      const target = livePlayer.heading - bearing
      shownAngle += angleBetween(shownAngle, target) * (1 - Math.exp(-TURN_RESPONSE * delta))

      if (arrow.current) arrow.current.style.transform = `rotate(${shownAngle}rad)`
      const colour = currentTarget()?.color
      if (path.current && colour && path.current.getAttribute('fill') !== colour) path.current.setAttribute('fill', colour)
      frame = requestAnimationFrame(update)
    }

    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!hasTarget) return null

  return (
    <div className="route-bar">
      <div className="route-side route-left">
        <OrderTimer />
        <MoodMeter className="route-mood" />
      </div>
      <div className="direction-arrow" ref={arrow}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path
            ref={path}
            d="M50 6 L90 54 L65 54 L65 94 L35 94 L35 54 L10 54 Z"
            fill="#3ddc97"
            stroke="#0f1115"
            strokeWidth="6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="route-side route-right">
        {distance > 0 && <span className="route-distance">{formatDistance(distance)}</span>}
      </div>
    </div>
  )
}
