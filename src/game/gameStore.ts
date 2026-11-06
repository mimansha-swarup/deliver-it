import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { calculateReward } from '../missions/missionLogic'
import type { MissionPlanner } from '../missions/missionPlanner'
import type { Mission, MissionPhase, Reward } from './gameTypes'
import { livePlayer } from './livePlayer'
import type { Quality } from './qualitySettings'

type Telemetry = {
  speedKmh: number
  distance: number
  seconds: number
  inZone: boolean
  drifting: boolean
  boosting: boolean
  crashed: boolean
}

type GameState = Telemetry & {
  /** False while the title screen is showing. */
  started: boolean
  phase: MissionPhase
  /** Goes up with each new delivery, which restarts the mission clock. */
  missionNumber: number
  mission: Mission | null
  planner: MissionPlanner | null
  credits: number
  xp: number
  quality: Quality
  lastReward: Reward | null
  /** Crashes on the current delivery. */
  crashes: number
  /** The time and the weather, as shown on screen. */
  clock: string

  startGame: () => void
  setQuality: (quality: Quality) => void
  /** Hands over the planner once the map has loaded, and plans the first delivery. */
  startMissions: (planner: MissionPlanner, fromX: number, fromZ: number) => void
  /** Moves the mission on when the scooter reaches the current stop. */
  arriveAtStop: (seconds: number) => void
  nextMission: () => void
  setTelemetry: (telemetry: Telemetry) => void
  setClock: (clock: string) => void
  recordCrash: () => void
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      speedKmh: 0,
      distance: 0,
      seconds: 0,
      inZone: false,
      drifting: false,
      boosting: false,
      crashed: false,
      crashes: 0,

      started: false,
      phase: 'toPickup',
      missionNumber: 1,
      mission: null,
      planner: null,
      credits: 0,
      xp: 0,
      quality: 'high',
      lastReward: null,
      clock: '',

      startGame: () => set({ started: true }),

      setQuality: (quality) => set({ quality }),

      startMissions: (planner, fromX, fromZ) => {
        if (get().mission) return
        set({ planner, mission: planner.planMission(fromX, fromZ) })
      },

      arriveAtStop: (seconds) =>
        set((state) => {
          if (state.phase === 'toPickup') return { phase: 'toCustomer' }
          if (state.phase !== 'toCustomer' || !state.mission) return state

          const { onTimeSeconds, tier } = state.mission
          const reward = calculateReward(seconds, onTimeSeconds, tier, state.crashes)
          return {
            phase: 'delivered',
            lastReward: reward,
            credits:
              state.credits +
              reward.baseCredits +
              reward.distanceCredits +
              reward.onTimeCredits +
              reward.cleanRideCredits,
            xp: state.xp + reward.xp,
          }
    }),

  nextMission: () =>
    set((state) => ({
      phase: 'toPickup',
      missionNumber: state.missionNumber + 1,
      lastReward: null,
      seconds: 0,
      crashes: 0,
      // The next delivery starts wherever the rider is.
      mission: state.planner?.planMission(livePlayer.x, livePlayer.z) ?? state.mission,
    })),

  setTelemetry: (telemetry) => set(telemetry),
  setClock: (clock) => set({ clock }),
  recordCrash: () => set((state) => ({ crashes: state.crashes + 1 })),
    }),
    {
      // Kept from the project's earlier name, so existing saves still load.
      name: 'slikk-it-progress',
      version: 1,
      // Only progress and settings are saved. Everything else starts fresh on each visit.
      partialize: ({ credits, xp, quality }) => ({ credits, xp, quality }),
    },
  ),
)
