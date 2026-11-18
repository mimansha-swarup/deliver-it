import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { GARAGE_MAX_SPEED, GARAGE_RANGE } from '../game/garage'
import { MISSION_RULES } from '../game/missionConfig'
import type { MissionPlanner } from './missionPlanner'
import { getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { getCurrentStop, hasArrived } from './missionLogic'
import { clearLiveRoute, updateLiveRoute } from './routeTracking'
import { acceptanceRate, dayPeriod, LOW_ACCEPTANCE, LOW_ACCEPTANCE_SLOWDOWN } from '../game/duty'

/** How often the HUD gets new numbers. Far less often than the game runs. */
const TELEMETRY_INTERVAL = 0.1

/** How often riding is added to today's distance goal, in seconds. */
const RIDE_REPORT_INTERVAL = 2

/** Longest a single frame may count for, so a hidden tab doesn't run the clock. */
const MAX_FRAME_TIME = 0.1

/** Home is a gate: stopped this close to it counts as at home, in metres, below this speed. */
const HOME_RANGE = 8
const HOME_MAX_SPEED = 1.5

/** Seconds until the next offer, from the time of day's range, slower when acceptance is low. */
function nextOfferGap(answers: boolean[]): number {
  const [shortest, longest] = dayPeriod(liveSky.hours).offerGap
  const rate = acceptanceRate(answers)
  const slower = rate !== null && rate < LOW_ACCEPTANCE ? LOW_ACCEPTANCE_SLOWDOWN : 1
  return (shortest + Math.random() * (longest - shortest)) * slower
}

/** Whether the rider has stopped by any dark store, where the Garage opens. */
function isAtStore(planner: MissionPlanner | null, x: number, z: number, speed: number): boolean {
  if (!planner || speed > GARAGE_MAX_SPEED) return false
  const { graph, stores } = planner
  return stores.some(({ node }) => Math.hypot(graph.xs[node] - x, graph.zs[node] - z) <= GARAGE_RANGE)
}

/** Watches the scooter every frame and moves the mission on. Draws nothing. */
export function MissionTracker({ scooter }: { scooter: RefObject<ScooterState> }) {
  const elapsed = useRef(0)
  const sinceTelemetry = useRef(0)
  const currentMission = useRef(1)
  const countedCrashes = useRef(0)
  const countedKnocks = useRef(0)
  const ridden = useRef(0)
  const sinceRideReport = useRef(0)
  const wasBoosting = useRef(false)
  /** Seconds until the dispatcher offers the next order, while online and free. */
  const offerIn = useRef(4)

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

    // Hard landings count only with an order on board.
    if (state.bumpCount !== countedKnocks.current) {
      countedKnocks.current = state.bumpCount
      if (game.phase === 'toCustomer') game.recordKnock()
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

    // The dispatcher: while online with nothing on, an offer every so often; an unanswered one runs out.
    if (game.duty === 'online') {
      if (game.offer && performance.now() > game.offer.expiresAt) game.declineOffer(true)
      if (!game.mission && !game.offer && !game.offlineAfterOrder) {
        offerIn.current -= frameTime
        if (offerIn.current <= 0) {
          game.makeOffer()
          offerIn.current = nextOfferGap(game.answers)
        }
      } else if (game.mission) {
        // The first offer after a delivery comes a little sooner.
        offerIn.current = Math.min(offerIn.current, 5)
      }
    } else {
      offerIn.current = 3
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
        // Steps of 2%, so the gauge doesn't re-render the HUD for every tiny change.
        nitro: Math.round(state.nitro * 50) / 50,
        nitroOn: state.nitroOn,
        crashed: state.crashLeft > 0,
        atStore: isAtStore(game.planner, state.x, state.z, travelSpeed),
        atHome: game.home !== null && Math.hypot(game.home.x - state.x, game.home.z - state.z) <= HOME_RANGE && travelSpeed <= HOME_MAX_SPEED,
      })
    }
  })

  return null
}
