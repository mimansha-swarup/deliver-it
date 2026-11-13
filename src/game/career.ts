import type { Reward } from './gameTypes'
import { UNLOCK_LEVELS } from './progression'

/**
 * The career and the daily shift. Everything here is plain data and small pure
 * functions; the store calls them when something happens and saves the result.
 *
 * Ravi is a made-up dispatcher at the made-up dark store. He talks the way a lot
 * of Bengaluru does: English, with Kannada mixed in.
 */
export const DISPATCHER = 'Ravi · dispatch'

/** Something the rider did that goals can count. */
export type CareerEvent =
  | { type: 'delivery'; reward: Reward; tier: string; night: boolean; rain: boolean }
  | { type: 'ride'; metres: number }
  | { type: 'boost' }

type Goal = {
  text: string
  target: number
  /** How much an event moves this goal on. 0 means it doesn't count. */
  count: (event: CareerEvent) => number
  /** What Ravi says when it's done. */
  done: string
}

const delivered = (event: CareerEvent, test: (reward: Reward, event: CareerEvent & { type: 'delivery' }) => boolean) =>
  event.type === 'delivery' && test(event.reward, event) ? 1 : 0

export const CHAPTER_ONE = {
  title: 'First week in HSR',
  intro:
    "Namaskara! Ravi here, from dispatch. Welcome to HSR, maga. Your first order is waiting at the dark store. Bega banni!",
  rewardCredits: 300,
  rewardPaint: 'dark-store-green',
  goals: [
    {
      text: 'Finish your first delivery',
      target: 1,
      count: (event) => delivered(event, () => true),
      done: 'Olle kelsa! First one done. Now try 3 deliveries on time. Swalpa fast, but jopana!',
    },
    {
      text: 'Deliver 3 orders on time',
      target: 3,
      count: (event) => delivered(event, (reward) => reward.onTime),
      done: 'Three on time? Sakkath! Next, one whole delivery with no crashes. Nice and smooth.',
    },
    {
      text: 'Finish a delivery with no crashes',
      target: 1,
      count: (event) => delivered(event, (reward) => reward.crashes === 0),
      done: 'Clean ride, chennagide! Now take an Across town order. HSR is bigger than it looks, maga.',
    },
    {
      text: 'Finish an Across town or Long haul order',
      target: 1,
      count: (event) => delivered(event, (_, { tier }) => tier !== 'Local'),
      done: 'Across town, done! Last one this week: deliver after dark, or in the rain. Raincoat ide tane?',
    },
    {
      text: 'Deliver after dark or in the rain',
      target: 1,
      count: (event) => delivered(event, (_, { night, rain }) => night || rain),
      done: "Week one complete! Neevu namma star rider. Here's 300 credits and the Dark store green paint. Chapter 2 is coming soon. Swalpa adjust maadi!",
    },
  ] satisfies Goal[],
}

/** The career so far. Saved with the rest of the progress. */
export type CareerProgress = {
  started: boolean
  /** Which goal is active, or the number of goals once the chapter is finished. */
  goal: number
  progress: number
}

export const NEW_CAREER: CareerProgress = { started: false, goal: 0, progress: 0 }

export function isChapterDone(career: CareerProgress): boolean {
  return career.goal >= CHAPTER_ONE.goals.length
}

/** Moves the career on. Returns the new progress, and Ravi's lines for any goals finished. */
export function advanceCareer(career: CareerProgress, event: CareerEvent) {
  const goal = CHAPTER_ONE.goals[career.goal]
  if (!career.started || !goal) return { career, messages: [] as string[], chapterDone: false }

  const progress = career.progress + goal.count(event)
  if (progress < goal.target) return { career: { ...career, progress }, messages: [], chapterDone: false }

  const next = { ...career, goal: career.goal + 1, progress: 0 }
  return { career: next, messages: [goal.done], chapterDone: isChapterDone(next) }
}

// ---- The daily shift ----

export type DailyKind =
  | 'deliveries'
  | 'onTime'
  | 'clean'
  | 'rushOnTime'
  | 'longHaul'
  | 'night'
  | 'distance'
  | 'boosts'

type DailyGoalType = {
  target: number
  text: (target: number) => string
  minLevel: number
  count: (event: CareerEvent) => number
}

export const DAILY_GOALS: Record<DailyKind, DailyGoalType> = {
  deliveries: { target: 5, minLevel: 1, text: (n) => `Finish ${n} deliveries`, count: (e) => delivered(e, () => true) },
  onTime: { target: 3, minLevel: 1, text: (n) => `Deliver ${n} orders on time`, count: (e) => delivered(e, (r) => r.onTime) },
  clean: { target: 3, minLevel: 1, text: (n) => `${n} deliveries with no crashes`, count: (e) => delivered(e, (r) => r.crashes === 0) },
  rushOnTime: {
    target: 2,
    minLevel: UNLOCK_LEVELS.rush,
    text: (n) => `Beat the timer on ${n} rush orders`,
    count: (e) => delivered(e, (r) => r.kind === 'rush' && r.onTime),
  },
  longHaul: {
    target: 1,
    minLevel: UNLOCK_LEVELS.longHaul,
    text: () => 'Finish a Long haul order',
    count: (e) => delivered(e, (_, { tier }) => tier === 'Long haul'),
  },
  night: { target: 1, minLevel: 1, text: () => 'Deliver after dark', count: (e) => delivered(e, (_, { night }) => night) },
  distance: {
    target: 5000,
    minLevel: 1,
    text: (n) => `Ride ${n / 1000} km`,
    count: (e) => (e.type === 'ride' ? e.metres : 0),
  },
  boosts: { target: 3, minLevel: 1, text: (n) => `Earn ${n} drift boosts`, count: (e) => (e.type === 'boost' ? 1 : 0) },
}

export type DailyGoal = { kind: DailyKind; progress: number }

export type DailyShift = {
  /** The calendar day, as YYYY-MM-DD in the player's own time zone. */
  date: string
  goals: DailyGoal[]
  done: boolean
}

export type Streak = { days: number; lastDate: string }

export const DAILY_BONUS = { credits: 150, perStreakDay: 25, maxStreakBonus: 100, xp: 50 }
const GOALS_PER_DAY = 3

/** Today's date in the player's own time zone, so the shift changes at their midnight. */
export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return todayKey(new Date(year, month - 1, day - 1))
}

/** A small repeatable random number generator, so a date always gives the same goals. */
function seeded(text: string) {
  let seed = 2166136261
  for (const character of text) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507)
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909)
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296
  }
}

/** Three goals for the day, picked from those the rider's level allows. */
export function createDailyShift(date: string, level: number): DailyShift {
  const random = seeded(date)
  const pool = (Object.keys(DAILY_GOALS) as DailyKind[]).filter((kind) => DAILY_GOALS[kind].minLevel <= level)
  const goals: DailyGoal[] = []
  while (goals.length < GOALS_PER_DAY && pool.length > 0) {
    const [kind] = pool.splice(Math.floor(random() * pool.length), 1)
    goals.push({ kind, progress: 0 })
  }
  return { date, goals, done: false }
}

/** Moves today's goals on. `finished` is true on the event that completes the last one. */
export function advanceDaily(shift: DailyShift, event: CareerEvent) {
  if (shift.done) return { shift, finished: false }
  const goals = shift.goals.map((goal) => {
    const { target, count } = DAILY_GOALS[goal.kind]
    return { ...goal, progress: Math.min(target, goal.progress + count(event)) }
  })
  const done = goals.every((goal) => goal.progress >= DAILY_GOALS[goal.kind].target)
  return { shift: { ...shift, goals, done }, finished: done }
}

/** The streak after finishing today's shift, and the bonus it pays. */
export function finishShift(streak: Streak, date: string) {
  const days = streak.lastDate === dayBefore(date) ? streak.days + 1 : 1
  const credits = DAILY_BONUS.credits + Math.min((days - 1) * DAILY_BONUS.perStreakDay, DAILY_BONUS.maxStreakBonus)
  return { streak: { days, lastDate: date }, credits, xp: DAILY_BONUS.xp }
}
