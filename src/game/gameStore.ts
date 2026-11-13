import { create } from 'zustand'
import { STATIONS } from '../audio/stations'
import { applyUpgrades } from '../vehicle/tuning'
import {
  HELMETS,
  MAX_UPGRADE_LEVEL,
  PAINTS,
  UPGRADES,
  type Colour,
  type UpgradeKind,
  type UpgradeLevels,
} from './garage'
import { persist } from 'zustand/middleware'
import { calculateReward } from '../missions/missionLogic'
import type { MissionPlanner } from '../missions/missionPlanner'
import type { Mission, MissionPhase, Reward } from './gameTypes'
import type { WeatherName } from '../sky/skyLogic'
import { livePlayer } from './livePlayer'
import {
  advanceCareer,
  advanceDaily,
  CHAPTER_ONE,
  createDailyShift,
  finishShift,
  NEW_CAREER,
  todayKey,
  type CareerEvent,
  type CareerProgress,
  type DailyShift,
  type Streak,
} from './career'
import { TOTAL_KB, type LoadProgress } from './preload'
import { levelFromXp, UNLOCK_LEVELS, unlocksBetween } from './progression'
import type { Quality } from './qualitySettings'

type Telemetry = {
  speedKmh: number
  distance: number
  seconds: number
  inZone: boolean
  drifting: boolean
  boosting: boolean
  crashed: boolean
  /** Stopped by the dark store, where the Garage opens. */
  atStore: boolean
}

type GameState = Telemetry & {
  /** False while the title screen is showing. */
  started: boolean
  /** How the download before the title screen's Start button is going. */
  loading: LoadProgress
  phase: MissionPhase
  /** Goes up with each new delivery, which restarts the mission clock. */
  missionNumber: number
  mission: Mission | null
  planner: MissionPlanner | null
  credits: number
  xp: number
  quality: Quality
  lastReward: Reward | null
  /** Set when the last delivery took the rider up a level: the new level and what it unlocked. */
  lastLevelUp: { level: number; unlocks: string[] } | null
  /** What the order in the customer's hands will pay, once they've taken it. */
  pendingReward: Reward | null
  /** Crashes on the current delivery. */
  crashes: number
  /** The time of day in the game, as shown on the phone. */
  skyTime: string
  weather: WeatherName
  /** Whether it's dark, which turns the phone's sun into a moon. */
  night: boolean
  /** The radio station on the phone, by its id. */
  stationId: string
  musicOn: boolean
  hornsOn: boolean
  /** The Garage: upgrade levels, the paint and helmet in use, and the colours owned. */
  upgrades: UpgradeLevels
  paintId: string
  helmetId: string
  ownedPaints: string[]
  ownedHelmets: string[]
  /** The career chapter, today's shift, the streak of shifts finished, and Ravi's messages, newest first. */
  career: CareerProgress
  daily: DailyShift | null
  streak: Streak
  messages: Message[]

  startGame: () => void
  setLoading: (loading: LoadProgress) => void
  setQuality: (quality: Quality) => void
  /** Hands over the planner once the map has loaded, and plans the first delivery. */
  startMissions: (planner: MissionPlanner, fromX: number, fromZ: number) => void
  /** Moves the mission on when the scooter reaches the current stop. */
  arriveAtStop: (seconds: number) => void
  /** Moves on once the parcel has changed hands. */
  finishHandoff: () => void
  nextMission: () => void
  setTelemetry: (telemetry: Telemetry) => void
  setSky: (skyTime: string, weather: WeatherName, night: boolean) => void
  recordCrash: () => void
  /** Moves the radio one station along, forwards (1) or back (-1). */
  changeStation: (direction: 1 | -1) => void
  setMusicOn: (on: boolean) => void
  setHornsOn: (on: boolean) => void
  /** Buys the next level of an upgrade, if there is one and it's affordable. */
  buyUpgrade: (kind: UpgradeKind) => void
  /** Buys a colour if it isn't owned and is affordable, then uses it. */
  choosePaint: (id: string) => void
  chooseHelmet: (id: string) => void
  /** Counts riding towards today's goals. Called now and then, not every frame. */
  recordRide: (metres: number) => void
  /** Counts a drift boost towards today's goals. */
  recordBoost: () => void
}

export type Message = { id: number; text: string }

/** How many of Ravi's messages are kept. */
const MESSAGES_KEPT = 15

let nextMessageId = Date.now()

/** Puts Ravi's new lines on top of the list, newest first, and keeps the list short. */
function addMessages(messages: Message[], lines: string[]): Message[] {
  if (lines.length === 0) return messages
  const added = lines.map((text) => ({ id: nextMessageId++, text })).reverse()
  return [...added, ...messages].slice(0, MESSAGES_KEPT)
}

/** A new calendar day brings a new shift, with a message from Ravi. */
function refreshDaily(state: GameState): Partial<GameState> {
  const today = todayKey()
  if (state.daily?.date === today) return {}
  return {
    daily: createDailyShift(today, levelFromXp(state.xp)),
    messages: addMessages(state.messages, ["Today's shift is on your phone, maga. Three goals. All the best!"]),
  }
}

/**
 * Counts something the rider did towards the career and today's shift, and
 * pays out whatever that finishes: a chapter's credits and paint, or the
 * shift's bonus, which grows with the streak.
 */
function applyEvent(state: GameState, event: CareerEvent): Partial<GameState> {
  const fresh = refreshDaily(state)
  let messages = fresh.messages ?? state.messages
  let credits = state.credits
  let xp = state.xp
  let ownedPaints = state.ownedPaints
  let streak = state.streak

  const careerStep = advanceCareer(state.career, event)
  messages = addMessages(messages, careerStep.messages)
  if (careerStep.chapterDone) {
    credits += CHAPTER_ONE.rewardCredits
    if (!ownedPaints.includes(CHAPTER_ONE.rewardPaint)) ownedPaints = [...ownedPaints, CHAPTER_ONE.rewardPaint]
  }

  let daily = fresh.daily ?? state.daily
  if (daily) {
    const dailyStep = advanceDaily(daily, event)
    daily = dailyStep.shift
    if (dailyStep.finished) {
      const shift = finishShift(streak, daily.date)
      streak = shift.streak
      credits += shift.credits
      xp += shift.xp
      const days = streak.days > 1 ? ` ${streak.days} days in a row, sakkath!` : ''
      messages = addMessages(messages, [`Shift done! +${shift.credits} credits sent.${days} Nale sigona!`])
    }
  }

  return { career: careerStep.career, daily, streak, messages, credits, xp, ownedPaints }
}

/**
 * Using a colour you own is free. One you don't is bought first, if you can
 * afford it. Otherwise nothing changes.
 */
function chooseColour<T>(
  credits: number,
  list: Colour[],
  owned: string[],
  id: string,
  result: (owned: string[], credits: number) => T,
): T | Record<string, never> {
  const colour = list.find((item) => item.id === id)
  if (!colour) return {}
  if (owned.includes(id)) return result(owned, credits)
  if (colour.careerOnly || credits < colour.price) return {}
  return result([...owned, id], credits - colour.price)
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
      loading: { loadedKb: 0, totalKb: TOTAL_KB, stage: 'downloading' },
      phase: 'toPickup',
      missionNumber: 1,
      mission: null,
      planner: null,
      credits: 0,
      xp: 0,
      quality: 'high',
      lastReward: null,
      lastLevelUp: null,
      pendingReward: null,
      skyTime: '',
      weather: 'clear',
      night: false,
      stationId: STATIONS[0].id,
      musicOn: true,
      hornsOn: true,
      atStore: false,
      upgrades: { engine: 0, tyres: 0, brakes: 0 },
      paintId: PAINTS[0].id,
      helmetId: HELMETS[0].id,
      ownedPaints: [PAINTS[0].id],
      ownedHelmets: [HELMETS[0].id],
      career: NEW_CAREER,
      daily: null,
      streak: { days: 0, lastDate: '' },
      messages: [],

      // Starting the career and today's shift happens the first time the rider sets off.
      startGame: () =>
        set((state) => {
          const changes: Partial<GameState> = { started: true, ...refreshDaily(state) }
          if (!state.career.started) {
            changes.career = { ...state.career, started: true }
            changes.messages = addMessages(changes.messages ?? state.messages, [CHAPTER_ONE.intro])
          }
          return changes
        }),

      setQuality: (quality) => set({ quality }),
      setLoading: (loading) => set({ loading }),

      startMissions: (planner, fromX, fromZ) => {
        if (get().mission) return
        set({ planner, mission: planner.planMission(fromX, fromZ, levelFromXp(get().xp)) })
      },

      arriveAtStop: (seconds) =>
        set((state) => {
          if (state.phase === 'toPickup') return { phase: 'collecting' }
          if (state.phase !== 'toCustomer' || !state.mission) return state

          // On a double drop, the first customer is just a stop on the way. The pay comes at the last.
          if (state.mission.nextDrops.length > 0) return { phase: 'handingOver' }

          // The clock stops on arrival, so the handover can't cost the rider a bonus.
          const nightPay = state.night && levelFromXp(state.xp) >= UNLOCK_LEVELS.nightPay
          return {
            phase: 'handingOver',
            pendingReward: calculateReward(seconds, state.mission, state.crashes, nightPay),
          }
        }),

      finishHandoff: () =>
        set((state) => {
          if (state.phase === 'collecting') return { phase: 'toCustomer' }

          // A double drop moves on to its next customer.
          const [next, ...rest] = state.mission?.nextDrops ?? []
          if (state.phase === 'handingOver' && state.mission && next) {
            return {
              phase: 'toCustomer',
              mission: { ...state.mission, customer: next.customer, waiting: next.waiting, nextDrops: rest },
            }
          }

          const reward = state.pendingReward
          if (state.phase !== 'handingOver' || !reward) return state

          const paid = {
            ...state,
            credits:
              state.credits +
              reward.baseCredits +
              reward.distanceCredits +
              reward.onTimeCredits +
              reward.cleanRideCredits +
              reward.nightCredits,
            xp: state.xp + reward.xp,
          }
          // The delivery also counts towards the career and today's shift, which may pay more.
          const event: CareerEvent = {
            type: 'delivery',
            reward,
            tier: state.mission?.tier.label ?? '',
            night: state.night,
            rain: state.weather === 'rain',
          }
          const progress = applyEvent(paid, event)
          const after = { ...paid, ...progress }
          const levelBefore = levelFromXp(state.xp)
          const levelAfter = levelFromXp(after.xp)
          return {
            ...progress,
            phase: 'delivered',
            lastReward: reward,
            lastLevelUp:
              levelAfter > levelBefore
                ? { level: levelAfter, unlocks: unlocksBetween(levelBefore, levelAfter) }
                : null,
            pendingReward: null,
            credits: after.credits,
            xp: after.xp,
          }
        }),

  nextMission: () =>
    set((state) => ({
      phase: 'toPickup',
      missionNumber: state.missionNumber + 1,
      lastReward: null,
      lastLevelUp: null,
      seconds: 0,
      crashes: 0,
      // The next delivery starts wherever the rider is.
      mission: state.planner?.planMission(livePlayer.x, livePlayer.z, levelFromXp(state.xp)) ?? state.mission,
    })),

  setTelemetry: (telemetry) => set(telemetry),
  setSky: (skyTime, weather, night) => set({ skyTime, weather, night }),
  recordCrash: () => set((state) => ({ crashes: state.crashes + 1 })),
  changeStation: (direction) =>
    set((state) => {
      const index = STATIONS.findIndex(({ id }) => id === state.stationId)
      const next = (index + direction + STATIONS.length) % STATIONS.length
      // Changing station is a way to turn the music back on.
      return { stationId: STATIONS[next].id, musicOn: true }
    }),
  setMusicOn: (musicOn) => set({ musicOn }),
  setHornsOn: (hornsOn) => set({ hornsOn }),
  buyUpgrade: (kind) =>
    set((state) => {
      const level = state.upgrades[kind]
      const price = UPGRADES[kind].prices[level]
      if (level >= MAX_UPGRADE_LEVEL || price === undefined || state.credits < price) return state
      return { credits: state.credits - price, upgrades: { ...state.upgrades, [kind]: level + 1 } }
    }),
  choosePaint: (id) =>
    set((state) => chooseColour(state.credits, PAINTS, state.ownedPaints, id, (owned, credits) => ({
      ownedPaints: owned,
      paintId: id,
      credits,
    }))),
  recordRide: (metres) => set((state) => applyEvent(state, { type: 'ride', metres })),
  recordBoost: () => set((state) => applyEvent(state, { type: 'boost' })),
  chooseHelmet: (id) =>
    set((state) => chooseColour(state.credits, HELMETS, state.ownedHelmets, id, (owned, credits) => ({
      ownedHelmets: owned,
      helmetId: id,
      credits,
    }))),
    }),
    {
      // Kept from the project's earlier name, so existing saves still load.
      name: 'slikk-it-progress',
      version: 1,
      // Only progress and settings are saved. Everything else starts fresh on each visit.
      partialize: (state) => ({
        credits: state.credits,
        xp: state.xp,
        quality: state.quality,
        stationId: state.stationId,
        musicOn: state.musicOn,
        hornsOn: state.hornsOn,
        upgrades: state.upgrades,
        paintId: state.paintId,
        helmetId: state.helmetId,
        ownedPaints: state.ownedPaints,
        ownedHelmets: state.ownedHelmets,
        career: state.career,
        daily: state.daily,
        streak: state.streak,
        messages: state.messages,
      }),
    },
  ),
)

// The scooter's handling follows the upgrades: now, after a saved game loads, and after every purchase.
applyUpgrades(useGameStore.getState().upgrades)
useGameStore.subscribe((state, previous) => {
  if (state.upgrades !== previous.upgrades) applyUpgrades(state.upgrades)
})
