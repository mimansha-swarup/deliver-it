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
import { FRUSTRATION } from '../missions/customerChat'
import { RATINGS_KEPT } from '../missions/orderStory'
import type { MissionPlanner } from '../missions/missionPlanner'
import type { Mission, MissionPhase, Reward } from './gameTypes'
import type { WeatherName } from '../sky/skyLogic'
import { livePlayer, liveSky } from './livePlayer'
import {
  acceptanceRate,
  ANSWERS_KEPT,
  bestMomentOf,
  CANCEL_PENALTY,
  createShiftGoal,
  dayPeriod,
  goalStep,
  isPastDeadline,
  LOW_ACCEPTANCE,
  newShift,
  OFFER_SECONDS,
  summarize,
  WAKE_HOUR,
  type DutyState,
  type ShiftStats,
  type ShiftSummary,
} from './duty'
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
  /** The nitro tank, from 0 to 1, and whether it's burning. */
  nitro: number
  nitroOn: boolean
  crashed: boolean
  /** Stopped by the dark store, where the Garage opens. */
  atStore: boolean
  /** Stopped at home, where the rider can sleep. */
  atHome: boolean
  /** How frustrated the current customer is, 0 to 1 (customerChat.ts). */
  frustration: number
  /** Seconds left before an accepted order's clock starts. */
  graceLeft: number
  /** While the customer is fuming, seconds until they cancel; 0 otherwise. */
  fumingLeft: number
}

/** An order offered to the rider, waiting for an answer until `expiresAt` (performance.now()). */
export type Offer = { mission: Mission; expiresAt: number }

type GameState = Telemetry & {
  /** False while the title screen is showing. */
  started: boolean
  /** The petrol bunk the rider has stopped at, which fills the nitro, by name. */
  atBunk: string | null
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
  /** On Low, draw at a fixed 0.75× of the screen's pixels: blurrier, but cheaper still. */
  lowScale: boolean
  lastReward: Reward | null
  /** Set when the last delivery took the rider up a level: the new level and what it unlocked. */
  lastLevelUp: { level: number; unlocks: string[] } | null
  /** What the order in the customer's hands will pay, once they've taken it. */
  pendingReward: Reward | null
  /** Crashes on the current delivery. */
  crashes: number
  /** Hard landings with the current customer's order on board. Fragile items mind them. */
  knocks: number
  /** The rider's recent star ratings, newest last, and how many 5-star deliveries in a row. */
  ratings: number[]
  fiveStarStreak: number
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
  /** The career chapter, today's daily challenges, the streak of shifts finished, and Ravi's messages, newest first. */
  career: CareerProgress
  daily: DailyShift | null
  streak: Streak
  messages: Message[]
  /** Off duty (free roam, the default after loading) or online, taking orders. */
  duty: DutyState
  offer: Offer | null
  /** The shift while online; its summary once offline, until dismissed. */
  shift: ShiftStats | null
  shiftSummary: ShiftSummary | null
  /** Going offline was asked for with an order on: the rider is choosing to finish or cancel it. */
  askingOffline: boolean
  /** Finishing the current order, then going offline. */
  offlineAfterOrder: boolean
  /** The rider's last answers to offers, true for accepted, newest last. */
  answers: boolean[]
  /** Which day it is, from 1. Sleeping starts the next. */
  day: number
  /** Where the rider lives: the gate of a house near the start. */
  home: { x: number; z: number } | null
  /** A point the rider picked on the full map, with its nearest road point, to be routed to. Cleared on arrival or by an order. */
  waypoint: { x: number; z: number; node: number } | null
  /** Chat on the HUD while online: customers and Ravi, newest last. Not saved. */
  chat: ChatLine[]
  /** Recent deliveries, newest first, for the Deliver It app. Saved. */
  history: DeliveryRecord[]
  /** Money in and out, newest first, for the Wallet app. Saved. */
  ledger: LedgerEntry[]
  /** Places to save on the map: chai stalls (with their street). Not saved; set once the world is planned. */
  places: { chai: { x: number; z: number; name: string }[] }
  /** Photo mode: the game paused, a free camera, no HUD (PhotoMode.tsx). */
  photoMode: boolean
  /** How roughly the current order has been carried (customerChat.ts): judged at the door, not felt as mood. */
  rough: number

  startGame: () => void
  setLoading: (loading: LoadProgress) => void
  setQuality: (quality: Quality) => void
  setLowScale: (lowScale: boolean) => void
  /** Hands over the planner once the map has loaded, and plans the first delivery. */
  startMissions: (planner: MissionPlanner, fromX: number, fromZ: number) => void
  /** Moves the mission on when the scooter reaches the current stop. */
  arriveAtStop: (seconds: number) => void
  /** Moves on once the parcel has changed hands. */
  finishHandoff: () => void
  nextMission: () => void
  setTelemetry: (telemetry: Telemetry) => void
  setAtBunk: (atBunk: string | null) => void
  setSky: (skyTime: string, weather: WeatherName, night: boolean) => void
  recordCrash: () => void
  /** Counts a hard landing while an order is on board. */
  recordKnock: () => void
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
  /** O, or the phone: online from off duty; from online, offline (asking first if an order is on). */
  toggleDuty: () => void
  goOnline: () => void
  /** With `cancel`, an order on is cancelled (with a penalty); without, the rider finishes it first. */
  goOffline: (choice?: 'finish' | 'cancel') => void
  /** Closes the finish-or-cancel question without going offline. */
  stayOnline: () => void
  /** A new order offer, made by the dispatcher while online and free. */
  makeOffer: () => void
  acceptOffer: () => void
  /** Declined by the rider, or `missed` when the offer ran out. Both count against acceptance. */
  declineOffer: (missed?: boolean) => void
  dismissSummary: () => void
  /** Sleeps: off duty only. Moves the clock to the morning, starts the next day and saves. */
  endDay: () => void
  setHome: (home: { x: number; z: number }) => void
  postChat: (from: ChatLine['from'], name: string, text: string, urgent?: boolean) => void
  setPlaces: (places: GameState['places']) => void
  setPhotoMode: (on: boolean) => void
  /** Moves an offer's deadline on, as photo mode does for the time it was paused. */
  extendOffer: (ms: number) => void
  setWaypoint: (waypoint: { x: number; z: number; node: number } | null) => void
  /** The customer has had enough and cancels: no pay, and it counts as a 1★ rating. */
  customerCancels: () => void
}

/** `at`: when it was posted (performance.now()). `urgent`: late, about to cancel, or cancelled. */
/** A finished delivery, for the history. `day` is the game's day counter. */
export type DeliveryRecord = { id: number; day: number; customer: string; item: string; stars: number; earned: number; tip: number }

/** Money in (positive) or out (negative). `kind` sorts it for the wallet's totals. */
export type LedgerEntry = { id: number; day: number; label: string; amount: number; kind: 'earning' | 'tip' | 'bonus' | 'expense' }

/** How many deliveries and ledger lines are kept. */
const HISTORY_KEPT = 12
const LEDGER_KEPT = 40

function addLedger(ledger: LedgerEntry[], day: number, entries: Omit<LedgerEntry, 'id' | 'day'>[]): LedgerEntry[] {
  const added = entries.filter(({ amount }) => amount !== 0).map((entry) => ({ ...entry, id: nextMessageId++, day }))
  return [...added.reverse(), ...ledger].slice(0, LEDGER_KEPT)
}

export type ChatLine = { id: number; from: 'customer' | 'dispatch'; name: string; text: string; at: number; urgent?: boolean }

/** How many chat lines are kept; the HUD shows the last few. */
const CHAT_KEPT = 12

/** `tag`: a message that's replaced, not added to, when sent again, such as the shift's welcome and goal. */
export type Message = { id: number; text: string; tag?: string }

/** How many of Ravi's messages are kept. */
const MESSAGES_KEPT = 15

let nextMessageId = Date.now()

/**
 * Ravi's lines that stand for something current, such as this shift's welcome and goal: each
 * replaces the earlier one with its tag, so going online again doesn't stack them up.
 */
/** How tagged lines began before they had tags, so saves from then are tidied up too. */
const UNTAGGED_STARTS: Record<string, string> = { online: "You're online", goal: 'Shift goal', acceptance: 'Your acceptance is' }

function replaceTagged(messages: Message[], lines: { tag: string; text: string }[]): Message[] {
  const tags = new Set(lines.map(({ tag }) => tag))
  const isOld = (message: Message) =>
    message.tag ? tags.has(message.tag) : [...tags].some((tag) => UNTAGGED_STARTS[tag] && message.text.startsWith(UNTAGGED_STARTS[tag]))
  const kept = messages.filter((message) => !isOld(message))
  const added = lines.map(({ tag, text }) => ({ id: nextMessageId++, text, tag })).reverse()
  return [...added, ...kept].slice(0, MESSAGES_KEPT)
}

/** Puts Ravi's new lines on top of the list, newest first, and keeps the list short. */
function addMessages(messages: Message[], lines: string[]): Message[] {
  if (lines.length === 0) return messages
  const added = lines.map((text) => ({ id: nextMessageId++, text })).reverse()
  return [...added, ...messages].slice(0, MESSAGES_KEPT)
}

/**
 * A new calendar day brings new daily challenges: three small goals, shown quietly in the
 * Deliver It app. Ravi doesn't announce them: the shift goal, set on going online, is the one he talks about.
 */
function refreshDaily(state: GameState): Partial<GameState> {
  const today = todayKey()
  if (state.daily?.date === today) return {}
  return { daily: createDailyShift(today, levelFromXp(state.xp)) }
}

/**
 * Counts something the rider did towards the career and today's daily challenges, and
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
      messages = addMessages(messages, [`Daily challenges done! +${shift.credits} credits sent.${days} Nale sigona!`])
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

/** Whether an accepted order is under way: picked up or not, not yet delivered. */
function hasOrderOn(state: GameState): boolean {
  return state.mission !== null && state.phase !== 'delivered'
}

/** Marks a goal against the clock missed once its time has gone. */
function checkDeadline(shift: ShiftStats): ShiftStats {
  if (shift.goal?.state !== 'open' || !isPastDeadline(shift, liveSky.totalHours)) return shift
  return { ...shift, goal: { ...shift.goal, state: 'missed' } }
}

/** Adds a delivery to the shift: the tally, the goal (and its bonus, once met), and the best moment. */
function tallyDelivery(shift: ShiftStats, reward: Reward, earned: number, onTimeSeconds: number) {
  let goal = checkDeadline(shift).goal
  let bonus = 0
  let goalMessage = ''
  if (goal?.state === 'open') {
    const progress = goal.progress + goalStep(goal, reward, earned)
    goal = { ...goal, progress }
    if (progress >= goal.target) {
      goal = { ...goal, state: 'met' }
      bonus = goal.bonus
      goalMessage = `Shift goal done: ${goal.text}! +${bonus} credits bonus. Sakkath!`
    }
  }
  const moment = bestMomentOf(reward, onTimeSeconds)
  return {
    bonus,
    goalMessage,
    shift: {
      ...shift,
      deliveries: shift.deliveries + 1,
      earnings: shift.earnings + earned + bonus,
      tips: shift.tips + reward.tipCredits,
      ratings: [...shift.ratings, reward.stars],
      goal,
      best: moment.score > 0 && moment.score > (shift.best?.score ?? 0) ? moment : shift.best,
    },
  }
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      atBunk: null,
      speedKmh: 0,
      distance: 0,
      seconds: 0,
      inZone: false,
      drifting: false,
      boosting: false,
      nitro: 0,
      nitroOn: false,
      crashed: false,
      crashes: 0,
      knocks: 0,
      ratings: [],
      fiveStarStreak: 0,

      started: false,
      loading: { loadedKb: 0, totalKb: TOTAL_KB, stage: 'downloading', mapReady: false },
      phase: 'toPickup',
      missionNumber: 1,
      mission: null,
      planner: null,
      credits: 0,
      xp: 0,
      quality: 'high',
      lowScale: false,
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
      atHome: false,
      duty: 'off',
      offer: null,
      shift: null,
      shiftSummary: null,
      askingOffline: false,
      offlineAfterOrder: false,
      answers: [],
      day: 1,
      home: null,
      chat: [],
      history: [],
      ledger: [],
      places: { chai: [] },
      photoMode: false,
      waypoint: null,
      rough: 0,
      frustration: 0,
      graceLeft: 0,
      fumingLeft: 0,

      // Starting the career and today's daily challenges happens the first time the rider sets off.
      startGame: () =>
        set((state) => {
          const changes: Partial<GameState> = { started: true, ...refreshDaily(state) }
          // Saves from before the daily challenges went quiet hold Ravi's old daily announcements: drop them.
          const quiet = state.messages.filter((message) => !message.text.startsWith("Today's shift is on your phone"))
          if (quiet.length !== state.messages.length) changes.messages = quiet
          if (!state.career.started) {
            changes.career = { ...state.career, started: true }
            changes.messages = addMessages(changes.messages ?? state.messages, [CHAPTER_ONE.intro])
          }
          return changes
        }),

      setQuality: (quality) => set({ quality }),
      setLowScale: (lowScale) => set({ lowScale }),
      setLoading: (loading) => set({ loading }),

      // Orders only come while online (see makeOffer); off duty, the rider just rides.
      startMissions: (planner) => set({ planner }),

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
            pendingReward: calculateReward(seconds, state.mission, {
              crashes: state.crashes,
              knocks: state.knocks,
              streak: state.fiveStarStreak,
              nightPay,
              period: dayPeriod(liveSky.hours),
              frustration: state.frustration,
              roughness: state.rough,
            }),
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
              mission: { ...state.mission, customer: next.customer, waiting: next.waiting, story: next.story, nextDrops: rest },
              // Each customer's order is its own: bumps with the first don't count against the next.
              knocks: 0,
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
              reward.nightCredits +
              reward.peakCredits +
              reward.tipCredits,
            xp: state.xp + reward.xp,
          }
          const earned = paid.credits - state.credits
          // The delivery also counts towards the career and today's daily challenges, which may pay more.
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
          // The shift's tally, its goal, and its best moment.
          const shiftStep = state.shift ? tallyDelivery(state.shift, reward, earned, state.mission?.onTimeSeconds ?? 0) : null
          if (shiftStep) {
            after.credits += shiftStep.bonus
            if (shiftStep.goalMessage) progress.messages = addMessages(progress.messages ?? state.messages, [shiftStep.goalMessage])
          }
          const customer = reward.customer
          const ledger = addLedger(state.ledger, state.day, [
            { label: `Delivery · ${customer}`, amount: earned - reward.tipCredits, kind: 'earning' },
            { label: `Tip · ${customer}`, amount: reward.tipCredits, kind: 'tip' },
            { label: 'Shift goal bonus', amount: shiftStep?.bonus ?? 0, kind: 'bonus' },
            { label: 'Daily challenges / career', amount: progress.credits !== undefined ? progress.credits - paid.credits : 0, kind: 'bonus' },
          ])
          const record: DeliveryRecord = { id: nextMessageId++, day: state.day, customer, item: state.mission?.story.item ?? '', stars: reward.stars, earned, tip: reward.tipCredits }
          return {
            ...progress,
            ledger,
            history: [record, ...state.history].slice(0, HISTORY_KEPT),
            shift: shiftStep?.shift ?? state.shift,
            phase: 'delivered',
            lastReward: reward,
            lastLevelUp:
              levelAfter > levelBefore
                ? { level: levelAfter, unlocks: unlocksBetween(levelBefore, levelAfter) }
                : null,
            pendingReward: null,
            ratings: [...state.ratings, reward.stars].slice(-RATINGS_KEPT),
            fiveStarStreak: reward.stars === 5 ? state.fiveStarStreak + 1 : 0,
            credits: after.credits,
            xp: after.xp,
          }
        }),

  // After a delivery: back to waiting for offers, or offline if the rider asked to finish first.
  nextMission: () => {
    set((state) => ({
      phase: 'toPickup',
      missionNumber: state.missionNumber + 1,
      lastReward: null,
      lastLevelUp: null,
      seconds: 0,
      crashes: 0,
      knocks: 0,
      mission: null,
      rough: 0,
      frustration: 0,
    }))
    if (get().offlineAfterOrder) get().goOffline()
  },

  toggleDuty: () => {
    const state = get()
    if (state.duty === 'off') state.goOnline()
    else if (hasOrderOn(state)) set({ askingOffline: true })
    else state.goOffline()
  },

  goOnline: () =>
    set((state) => {
      if (state.duty === 'online') return state
      const period = dayPeriod(liveSky.hours)
      const goal = createShiftGoal(liveSky.hours, levelFromXp(state.xp), Math.random)
      const rate = acceptanceRate(state.answers)
      // The welcome and the goal are this shift's: they replace the last shift's rather than pile up.
      const lines = [
        { tag: 'online', text: `You're online, maga. ${period.label} now. Orders coming!` },
        { tag: 'goal', text: `Shift goal (optional): ${goal.text}. Bonus ${goal.bonus} credits.` },
      ]
      if (rate !== null && rate < LOW_ACCEPTANCE) lines.push({ tag: 'acceptance', text: `Your acceptance is ${Math.round(rate * 100)}%. Take a few more, okay? Orders come slower when it's low.` })
      return {
        duty: 'online',
        shift: newShift(goal, liveSky.hours, liveSky.totalHours, performance.now()),
        shiftSummary: null,
        offlineAfterOrder: false,
        messages: replaceTagged(state.messages, lines),
      }
    }),

  goOffline: (choice) =>
    set((state) => {
      if (state.duty === 'off') return state
      if (hasOrderOn(state) && choice === 'finish') return { askingOffline: false, offlineAfterOrder: true }
      let { credits, ratings, shift } = state
      const changes: Partial<GameState> = {}
      if (hasOrderOn(state) && choice === 'cancel') {
        // Cancelling costs credits and counts as a low rating, as on a real delivery app.
        credits = Math.max(0, credits - CANCEL_PENALTY.credits)
        ratings = [...ratings, CANCEL_PENALTY.stars].slice(-RATINGS_KEPT)
        if (shift) shift = { ...shift, cancelled: shift.cancelled + 1, earnings: shift.earnings - CANCEL_PENALTY.credits }
        Object.assign(changes, { mission: null, phase: 'toPickup', pendingReward: null, seconds: 0, crashes: 0, knocks: 0, rough: 0, frustration: 0, missionNumber: state.missionNumber + 1, fiveStarStreak: 0 })
      } else if (hasOrderOn(state)) {
        return { askingOffline: true }
      }
      const finished = shift
        ? summarize({ ...shift, gameHours: liveSky.totalHours - shift.startedTotal, realSeconds: (performance.now() - shift.startedReal) / 1000 })
        : null
      return {
        ...changes,
        credits,
        ratings,
        ledger: choice === 'cancel' && hasOrderOn(state) ? addLedger(state.ledger, state.day, [{ label: 'Cancelled an order', amount: -CANCEL_PENALTY.credits, kind: 'expense' }]) : state.ledger,
        duty: 'off',
        offer: null,
        shift: null,
        shiftSummary: finished,
        askingOffline: false,
        offlineAfterOrder: false,
        lastReward: null,
        messages: addMessages(state.messages, [choice === 'cancel' ? `Order cancelled. −${CANCEL_PENALTY.credits} credits, and it hurts the rating. You're offline now.` : 'Offline. Good shift, maga! Rest well.']),
      }
    }),

  stayOnline: () => set({ askingOffline: false }),

  makeOffer: () =>
    set((state) => {
      if (state.duty !== 'online' || state.mission || state.offer || !state.planner || state.offlineAfterOrder) return state
      const mission = state.planner.planMission(livePlayer.x, livePlayer.z, levelFromXp(state.xp), dayPeriod(liveSky.hours))
      return { offer: { mission, expiresAt: performance.now() + OFFER_SECONDS * 1000 } }
    }),

  acceptOffer: () =>
    set((state) => {
      if (!state.offer || state.mission) return state
      return {
        offer: null,
        mission: state.offer.mission,
        phase: 'toPickup',
        missionNumber: state.missionNumber + 1,
        seconds: 0,
        crashes: 0,
        knocks: 0,
        rough: 0,
        frustration: 0,
        answers: [...state.answers, true].slice(-ANSWERS_KEPT),
      }
    }),

  declineOffer: (missed = false) =>
    set((state) => {
      if (!state.offer) return state
      const answers = [...state.answers, false].slice(-ANSWERS_KEPT)
      const rate = acceptanceRate(answers) ?? 1
      // Ravi says something the first time the rate drops below the line, not on every decline.
      const before = acceptanceRate(state.answers) ?? 1
      const warn = rate < LOW_ACCEPTANCE && before >= LOW_ACCEPTANCE
      const lines = [missed ? 'Missed that one. No problem, next one is coming.' : '', warn ? `Acceptance is down to ${Math.round(rate * 100)}%, maga. Orders will come a bit slower.` : ''].filter(Boolean)
      return { offer: null, answers, messages: addMessages(state.messages, lines) }
    }),

  dismissSummary: () => set({ shiftSummary: null }),

  endDay: () =>
    set((state) => {
      if (state.duty !== 'off') return state
      liveSky.setHoursTo = WAKE_HOUR
      return {
        day: state.day + 1,
        shiftSummary: null,
        messages: addMessages(state.messages, [`Good morning! Day ${state.day + 1}. Go online whenever you're ready.`]),
      }
    }),

  setHome: (home) => set({ home }),
  setWaypoint: (waypoint) => set({ waypoint }),
  setPlaces: (places) => set({ places }),
  setPhotoMode: (photoMode) => set({ photoMode }),
  extendOffer: (ms) => set((state) => (state.offer ? { offer: { ...state.offer, expiresAt: state.offer.expiresAt + ms } } : state)),
  customerCancels: () =>
    set((state) => {
      if (!hasOrderOn(state) || (state.phase !== 'toPickup' && state.phase !== 'toCustomer')) return state
      const customer = state.mission?.story.customer ?? 'The customer'
      return {
        credits: Math.max(0, state.credits - CANCEL_PENALTY.credits),
        ledger: addLedger(state.ledger, state.day, [{ label: `${customer} cancelled`, amount: -CANCEL_PENALTY.credits, kind: 'expense' }]),
        mission: null,
        phase: 'toPickup',
        pendingReward: null,
        seconds: 0,
        crashes: 0,
        knocks: 0,
        rough: 0,
        frustration: 0,
        missionNumber: state.missionNumber + 1,
        ratings: [...state.ratings, CANCEL_PENALTY.stars].slice(-RATINGS_KEPT),
        fiveStarStreak: 0,
        shift: state.shift ? { ...state.shift, cancelled: state.shift.cancelled + 1, earnings: state.shift.earnings - CANCEL_PENALTY.credits } : state.shift,
        messages: addMessages(state.messages, [`${customer} cancelled, maga: kept waiting too long. −${CANCEL_PENALTY.credits} credits, and it counts as ${CANCEL_PENALTY.stars}★. Next one, bega!`]),
      }
    }),
  postChat: (from, name, text, urgent = false) =>
    set((state) => (state.duty === 'online' ? { chat: [...state.chat, { id: nextMessageId++, from, name, text, at: performance.now(), urgent }].slice(-CHAT_KEPT) } : state)),

  setTelemetry: (telemetry) => set(telemetry),
  setAtBunk: (atBunk) => set({ atBunk }),
  setSky: (skyTime, weather, night) => set({ skyTime, weather, night }),
  // With the customer's order on board, rough riding frustrates them (customerChat.ts).
  recordCrash: () =>
    set((state) => ({ crashes: state.crashes + 1, rough: state.rough + (state.phase === 'toCustomer' ? FRUSTRATION.crash : 0) })),
  recordKnock: () =>
    set((state) => ({
      knocks: state.knocks + 1,
      rough: state.rough + (state.mission?.story.care === 'fragile' ? FRUSTRATION.fragileKnock : FRUSTRATION.knock),
    })),
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
      return {
        credits: state.credits - price,
        upgrades: { ...state.upgrades, [kind]: level + 1 },
        ledger: addLedger(state.ledger, state.day, [{ label: `${UPGRADES[kind].name} upgrade`, amount: -price, kind: 'expense' }]),
      }
    }),
  choosePaint: (id) =>
    set((state) => chooseColour(state.credits, PAINTS, state.ownedPaints, id, (owned, credits) => ({
      ownedPaints: owned,
      paintId: id,
      credits,
      ledger: credits < state.credits ? addLedger(state.ledger, state.day, [{ label: 'Paint', amount: credits - state.credits, kind: 'expense' }]) : state.ledger,
    }))),
  recordRide: (metres) =>
    set((state) => ({
      ...applyEvent(state, { type: 'ride', metres }),
      // While online, it counts towards the shift too, and a goal against the clock can run out.
      ...(state.shift ? { shift: checkDeadline({ ...state.shift, distance: state.shift.distance + metres }) } : {}),
    })),
  recordBoost: () => set((state) => applyEvent(state, { type: 'boost' })),
  chooseHelmet: (id) =>
    set((state) => chooseColour(state.credits, HELMETS, state.ownedHelmets, id, (owned, credits) => ({
      ownedHelmets: owned,
      helmetId: id,
      credits,
      ledger: credits < state.credits ? addLedger(state.ledger, state.day, [{ label: 'Helmet', amount: credits - state.credits, kind: 'expense' }]) : state.ledger,
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
        lowScale: state.lowScale,
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
        ratings: state.ratings,
        fiveStarStreak: state.fiveStarStreak,
        answers: state.answers,
        day: state.day,
        history: state.history,
        ledger: state.ledger,
      }),
    },
  ),
)

// The scooter's handling follows the upgrades: now, after a saved game loads, and after every purchase.
applyUpgrades(useGameStore.getState().upgrades)
useGameStore.subscribe((state, previous) => {
  if (state.upgrades !== previous.upgrades) applyUpgrades(state.upgrades)
})
