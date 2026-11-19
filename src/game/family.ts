import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useGameStore } from './gameStore'
import { saveKey } from './saveKeys'

/*
 * Why the rider rides: their younger sister Kavya has got into college, and the fees come in
 * instalments. Money is sent home from the Wallet into her college fund, one goal at a time, and
 * the family group chat ("Namma Mane", our home) follows it: Amma, Appa and Kavya, now and then,
 * never nagging. There's no deadline and nothing is lost by taking long: it's a reason, not a clock.
 *
 * Everyone here is made up. Kept on this device, apart from the main save.
 */

export const FAMILY_THREAD = 'Namma Mane'

/** The goals, in order: how much the fund must reach, what it's for, and what's said when it's reached. */
export const FUND_GOALS: { at: number; what: string; reached: [string, string][] }[] = [
  {
    at: 1500,
    what: 'Books, a lab coat and the bus pass',
    reached: [
      ['Kavya', 'I got ALL the books!! Even the fat physics one. And a lab coat with my name on it. Thank you thank you 🙏'],
      ['Amma', 'She has been wearing the lab coat in the house since morning. Next is the first semester fee, kanna. Slowly, no hurry.'],
    ],
  },
  {
    at: 4500,
    what: 'The first semester’s fee',
    reached: [
      ['Appa', 'Fee paid at the college office today. Receipt is in the steel almirah. Proud of you.'],
      ['Kavya', 'I am officially a student!! First internal test next week. I will top it, wait and see.'],
    ],
  },
  {
    at: 8500,
    what: 'The hostel and mess deposit',
    reached: [
      ['Kavya', 'Hostel room allotted! Third floor, a window with a neem tree outside. My roommate is from Hubballi.'],
      ['Amma', 'The house is too quiet now. But she is eating well there, I asked the warden. You also eat on time!'],
    ],
  },
  {
    at: 14000,
    what: 'The second semester’s fee, and a laptop for her project',
    reached: [
      ['Kavya', 'THE LAPTOP CAME. I cried a little, don’t tell Appa. First program I ran prints your name.'],
      ['Appa', 'Second semester is paid. Your sister stood second in class. Whatever you send from now, keep for yourself. Come home for Ugadi.'],
    ],
  },
]

/** Said when the story starts. */
const INTRO: [string, string][] = [
  ['Kavya', 'I GOT THE SEAT!!! B.Sc Computer Science. The fee list is very long though 😬'],
  ['Amma', 'Don’t worry about fees, kanna. We will manage little by little. You ride carefully and eat properly.'],
  ['Appa', 'First is books and the bus pass: ₹1,500. Send what you can from your Wallet when you can. No hurry.'],
]

/** One of these on a new day, in turn; the ones about weather and time are picked by the caller. */
const DAILY: [string, string][] = [
  ['Amma', 'Had breakfast? Don’t ride on an empty stomach. There is a darshini on every corner there, I know.'],
  ['Kavya', 'Seniors asked what my sibling does. I said "runs half of HSR Layout". Don’t make me a liar.'],
  ['Appa', 'Check the tyre air and the brakes once a week. A serviced vehicle saves money.'],
  ['Amma', 'Sunday I made holige. Kept some for you. Come when you get leave.'],
  ['Kavya', 'Lab today! We made a circuit that blinks an LED. It took three hours. Engineering is a scam 😂'],
  ['Appa', 'Petrol has gone up again here. Fill before the weekend.'],
  ['Amma', 'Wear the helmet strap properly, not just on the head for show. I saw the news.'],
  ['Kavya', 'Can you believe canteen chai is ₹12 here. TWELVE. Send help (and chai money).'],
  ['Amma', 'Neighbour aunty asked about you. I said you are doing very well in Bengaluru. You are, no?'],
  ['Appa', 'Whatever you save, save. But don’t skip your own meals for it. That is an order.'],
]

type FamilyLine = { id: number; from: string; text: string }

type Family = {
  /** What's in Kavya's college fund so far. */
  saved: number
  introduced: boolean
  /** The family's messages, newest last. */
  lines: FamilyLine[]
  /** Which daily message comes next, and the last game day one was sent. */
  nextDaily: number
  lastDay: number
  /** Sends money home from the wallet. The reason it can't, or null. */
  send: (amount: number) => string | null
  /** The story begins: the first messages. */
  begin: () => void
  /** A new day: a message from home, now and then. */
  newDay: (day: number) => void
}

const LINES_KEPT = 30
let nextId = Date.now()

/** The goal being saved for now, or null once the last is reached. */
export function currentGoal(saved: number) {
  return FUND_GOALS.find(({ at }) => saved < at) ?? null
}

export const useFamily = create<Family>()(
  persist(
    (set, get) => {
      /** Posts lines to the group: kept here, and shown on the phone like any message. */
      const post = (lines: [string, string][], gapMs = 2600) => {
        lines.forEach(([from, text], index) => {
          window.setTimeout(() => {
            set((state) => ({ lines: [...state.lines, { id: nextId++, from, text }].slice(-LINES_KEPT) }))
            useGameStore.getState().postChat('customer', FAMILY_THREAD, `${from}: ${text}`, false, true)
          }, index * gapMs)
        })
      }
      return {
        saved: 0,
        introduced: false,
        lines: [],
        nextDaily: 0,
        lastDay: 0,

        begin: () => {
          if (get().introduced) return
          set({ introduced: true })
          post(INTRO, 3500)
        },

        send: (amount) => {
          const sum = Math.floor(amount)
          if (sum <= 0) return 'Nothing to send.'
          const goalBefore = currentGoal(get().saved)
          if (!goalBefore) return 'Every fee is paid. Keep this for yourself: Appa said so.'
          if (!useGameStore.getState().spend('Sent home · Kavya’s college fund', sum)) return 'Not enough in the wallet.'
          const saved = get().saved + sum
          set({ saved })
          // Each goal passed gets its thanks, and the next is named.
          const passed = FUND_GOALS.filter(({ at }) => at > saved - sum && at <= saved)
          if (passed.length === 0) {
            if (sum >= 300) post([['Amma', `₹${sum} came. Thank you, kanna. ₹${Math.max(0, goalBefore.at - saved)} more for ${goalBefore.what.toLowerCase()}.`]])
            return null
          }
          for (const goal of passed) post(goal.reached, 3200)
          const next = currentGoal(saved)
          window.setTimeout(() => {
            useGameStore.getState().raviSays(next ? `Heard about Kavya, maga. Olle kelsa! Next for her fund: ${next.what.toLowerCase()}, ₹${next.at}.` : 'Every fee paid! Your sister is lucky, maga. Sakkath kelsa.')
          }, passed.length * 6400 + 800)
          return null
        },

        newDay: (day) => {
          const state = get()
          if (!state.introduced || day <= state.lastDay) return
          // Every other day, so the group isn't noise.
          if (day % 2 === 0) {
            const line = DAILY[state.nextDaily % DAILY.length]
            set({ nextDaily: state.nextDaily + 1, lastDay: day })
            window.setTimeout(() => post([line]), 4000)
          } else set({ lastDay: day })
        },
      }
    },
    {
      name: saveKey('deliver-it-family'),
      version: 1,
      partialize: (state) => ({ saved: state.saved, introduced: state.introduced, lines: state.lines, nextDaily: state.nextDaily, lastDay: state.lastDay }),
    },
  ),
)

// The story starts a little after the first delivery (not in the tutorial's first minutes), and home writes on new days.
useGameStore.subscribe((state, previous) => {
  if (state.history.length > 0 && previous.history.length === 0 && !useFamily.getState().introduced) window.setTimeout(() => useFamily.getState().begin(), 9000)
  if (state.day !== previous.day) useFamily.getState().newDay(state.day)
})
// A save that already has deliveries behind it starts the story on the next one.
useGameStore.subscribe((state, previous) => {
  if (state.history !== previous.history && state.history.length > 1 && !useFamily.getState().introduced) window.setTimeout(() => useFamily.getState().begin(), 9000)
})

// Debug: the family, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItFamily?: typeof useFamily }).__deliverItFamily = useFamily
}
