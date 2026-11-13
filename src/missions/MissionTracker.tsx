import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { livePlayer } from '../game/livePlayer'
import { GARAGE_MAX_SPEED, GARAGE_RANGE } from '../game/garage'
import { MISSION_RULES } from '../game/missionConfig'
import type { MissionPlanner } from './missionPlanner'
import { getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { getCurrentStop, hasArrived } from './missionLogic'
import { clearLiveRoute, updateLiveRoute } from './routeTracking'

/** How often the HUD gets new numbers. Far less often than the game runs. */
const TELEMETRY_INTERVAL = 0.1

/** How often riding is added to today's distance goal, in seconds. */
const RIDE_REPORT_INTERVAL = 2

/** Longest a single frame may count for, so a hidden tab doesn't run the clock. */
const MAX_FRAME_TIME = 0.1

/** Whether the rider has stopped by the dark store, where the Garage opens. */
function isAtStore(planner: MissionPlanner | null, x: number, z: number, speed: number): boolean {
  if (!planner) return false
  const { graph, store } = planner
  const kerb = Math.hypot(graph.xs[store.node] - x, graph.zs[store.node] - z)
  return kerb <= GARAGE_RANGE && speed <= GARAGE_MAX_SPEED
}

/** Watches the scooter every frame and moves the mission on. Draws nothing. */
export function MissionTracker({ scooter }: { scooter: RefObject<ScooterState> }) {
  const elapsed = useRef(0)
  const sinceTelemetry = useRef(0)
  const currentMission = useRef(1)
  const countedCrashes = useRef(0)
  const ridden = useRef(0)
  const sinceRideReport = useRef(0)
  const wasBoosting = useRef(false)

  useFrame((_, delta) => {
    const game = useGameStore.getState()
    const state = scooter.current

    if (game.missionNumber !== currentMission.current) {
      currentMission.current = game.missionNumber
      elapsed.current = 0
    }

    if (state.crashCount !== countedCrashes.current) {
      countedCrashes.current = state.crashCount
      game.recordCrash()
    }

    livePlayer.x = state.x
    livePlayer.z = state.z
    livePlayer.heading = state.heading

    const travelSpeed = getTravelSpeed(state)
    const stop = getCurrentStop(game.mission, game.phase)
    const frameTime = Math.min(delta, MAX_FRAME_TIME)

    // The clock starts when the rider sets off, not when the page loads.
    const hasSetOff = elapsed.current > 0 || travelSpeed > 0
    if (stop && hasSetOff) elapsed.current += frameTime

    const distance = stop ? Math.hypot(stop.x - state.x, stop.z - state.z) : 0
    if (stop && hasArrived(distance, travelSpeed)) {
      game.arriveAtStop(elapsed.current)
    }

    let routeLength = 0
    if (stop && game.planner) {
      const field = game.planner.getRouteField(stop.node)
      const { collisions, graph } = game.planner
      routeLength = updateLiveRoute(collisions, graph, field, state.x, state.z, stop.x, stop.z)
    } else {
      clearLiveRoute()
    }

    // Riding and drift boosts count towards today's shift.
    if (game.started) {
      ridden.current += travelSpeed * frameTime
      sinceRideReport.current += frameTime
      if (sinceRideReport.current >= RIDE_REPORT_INTERVAL && ridden.current > 0) {
        game.recordRide(ridden.current)
        ridden.current = 0
        sinceRideReport.current = 0
      }
      const boosting = state.boostLeft > 0
      if (boosting && !wasBoosting.current) game.recordBoost()
      wasBoosting.current = boosting
    }

    sinceTelemetry.current += frameTime
    if (sinceTelemetry.current >= TELEMETRY_INTERVAL) {
      sinceTelemetry.current = 0
      game.setTelemetry({
        speedKmh: Math.round(travelSpeed * 3.6),
        distance: Math.round(routeLength),
        seconds: Math.floor(elapsed.current),
        inZone: stop !== null && distance <= MISSION_RULES.zoneRadius,
        drifting: state.drifting,
        boosting: state.boostLeft > 0,
        crashed: state.crashLeft > 0,
        atStore: isAtStore(game.planner, state.x, state.z, travelSpeed),
      })
    }
  })

  return null
}
