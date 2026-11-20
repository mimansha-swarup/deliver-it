import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useGameStore } from './gameStore'
import { saveKey } from './saveKeys'

/*
 * Why the rider rides: their younger sister Kavya has got into college, and the fees come in
 * instalments. Money is sent home from the Wallet into her college fund, one goal at a time, and
 * the family group chat ("Namma Mane", our home) follows it: Amma, Appa and Kavya, now and then,
 * never nagging. There's no deadline and nothing is lost by taking long: it's a reason, not a clock.
 * Now and then home also asks for something small with a day on it (`ASKS`): a card on the screen,
 * a few seconds to answer, and no hard feelings either way.
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

/**
 * Small things home needs now and then, apart from Kavya's fund: who asks, for what, how much, and
 * what's said after. They come up on the screen where an order offer does, with a little time to
 * answer (`ASK`), because a gas cylinder or an exam form won't wait for ever. But nobody is
 * let down: sent, there are thanks; not sent, they managed, and say so kindly. It never costs the
 * rider anything to say later, and it's never asked of a wallet that can't spare it.
 */
export type FamilyAsk = { from: string; what: string; amount: number; asks: string; thanks: string; managed: string }
const ASKS: FamilyAsk[] = [
  { from: 'Amma', what: 'The gas cylinder', amount: 350, asks: 'Kanna, the gas cylinder got over this morning. The delivery boy is coming at 4. ₹350, if you can.', thanks: 'Cylinder came. Hot dosa is on the tava again. Thank you, kanna.', managed: 'It is okay, kanna. Neighbour aunty lent her spare cylinder. You keep it for your petrol.' },
  { from: 'Kavya', what: 'Lab record and xerox', amount: 120, asks: 'Lab record submission is TOMORROW and the xerox shop wants ₹120 for the whole manual. Help?? 🙏', thanks: 'Submitted first in the class!! The xerox uncle gave me a free pen. You are the best.', managed: 'It’s fine, I copied it by hand from Deepa’s. My fingers have fallen off. No tension 😂' },
  { from: 'Appa', what: 'The electricity bill', amount: 480, asks: 'Electricity bill has come, ₹480. Last date is tomorrow. If it is not a trouble.', thanks: 'Bill paid at the BESCOM counter. No queue today, for once. Thank you.', managed: 'I paid it from the provision money. We will adjust. You do not worry about this one.' },
  { from: 'Amma', what: 'Ajji’s medicine', amount: 260, asks: 'Ajji’s BP tablets finish today. The medical shop boy says ₹260 for the month.', thanks: 'Tablets bought. Ajji says God bless you, and that you should eat more ghee.', managed: 'The medical shop uncle gave it on credit till month end. He asked after you.' },
  { from: 'Kavya', what: 'The exam fee', amount: 600, asks: 'Exam fee portal closes at 5 pm today!! ₹600. I will pay you back when I am a rich engineer.', thanks: 'Fee PAID. Hall ticket downloaded. Now I only have to actually study 😬', managed: 'Appa paid it from his side, don’t worry. He made me promise to top the paper though.' },
  { from: 'Appa', what: 'A mobile recharge for Amma', amount: 199, asks: 'Your mother’s phone recharge is over and she cannot call you. ₹199 plan. Do it when you stop somewhere.', thanks: 'Recharge has come. She has already called three relatives. Thank you.', managed: 'I recharged it at the corner shop. Call her when you finish for the day.' },
  { from: 'Amma', what: 'The festival shopping', amount: 400, asks: 'Festival is on Friday, kanna. Flowers, coconut and new clothes for Kavya: ₹400 will do.', thanks: 'Bought everything. The house smells of jasmine. Wish you were here to eat the payasa.', managed: 'We kept it simple this year. Simple is also nice. Next time you come home for it.' },
]

/**
 * How long an ask stays up, in seconds; one comes after every so many deliveries, a little while
 * after the last is done; and only when the wallet would still have `spare` after it.
 */
export const ASK = { seconds: 30, every: 3, after: 14000, spare: 150 }

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
  /** What home is asking for just now, and until when (performance.now()); null when nothing is. */
  ask: (FamilyAsk & { expiresAt: number }) | null
  /** Which ask comes next, deliveries done since the last one, and how many times the rider has helped. */
  nextAsk: number
  sinceAsk: number
  helped: number
  /** Puts the next ask up, if now is a fair moment for it. */
  raiseAsk: () => void
  /** Answers it: sends the money, says later, or (`missed`) lets it run out. */
  answerAsk: (answer: 'send' | 'later' | 'missed') => void
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
        ask: null,
        nextAsk: 0,
        sinceAsk: 0,
        helped: 0,

        raiseAsk: () => {
          const state = get()
          const game = useGameStore.getState()
          if (!state.introduced || state.ask || !game.started || game.photoMode) return
          const next = ASKS[state.nextAsk % ASKS.length]
          // Never asked of a wallet that can't spare it, or of a rider who owes Ravi: it waits for a better day.
          if (game.credits < next.amount + ASK.spare || game.dues > 0) return
          set({ ask: { ...next, expiresAt: performance.now() + ASK.seconds * 1000 }, sinceAsk: 0 })
          post([[next.from, next.asks]], 0)
        },

        answerAsk: (answer) => {
          const ask = get().ask
          if (!ask) return
          if (answer === 'send') {
            if (!useGameStore.getState().spend(`Sent home · ${ask.what.toLowerCase()}`, ask.amount)) return
            set((state) => ({ ask: null, nextAsk: state.nextAsk + 1, helped: state.helped + 1 }))
            post([[ask.from, ask.thanks]], 0)
            return
          }
          // Later, or the time ran out: they managed. The same thing isn't asked again; the next is something else.
          set((state) => ({ ask: null, nextAsk: state.nextAsk + 1 }))
          window.setTimeout(() => post([[ask.from, ask.managed]], 0), answer === 'later' ? 1500 : 6000)
        },

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
      name: saveKey('swalpa-fast-family'),
      version: 1,
      partialize: (state) => ({ saved: state.saved, introduced: state.introduced, lines: state.lines, nextDaily: state.nextDaily, lastDay: state.lastDay, nextAsk: state.nextAsk, sinceAsk: state.sinceAsk, helped: state.helped }),
    },
  ),
)

// The story starts a little after the first delivery (not in the tutorial's first minutes), and home writes on new days.
useGameStore.subscribe((state, previous) => {
  if (state.history.length > 0 && previous.history.length === 0 && !useFamily.getState().introduced) window.setTimeout(() => useFamily.getState().begin(), 9000)
  if (state.day !== previous.day) useFamily.getState().newDay(state.day)
})
// Home asks for something small after every few deliveries, a little after the result card: not
// over an order offer or a result, for which it waits and tries again.
useGameStore.subscribe((state, previous) => {
  if (state.history.length <= previous.history.length) return
  const family = useFamily.getState()
  if (!family.introduced) return
  const since = family.sinceAsk + 1
  useFamily.setState({ sinceAsk: since })
  if (since < ASK.every) return
  const attempt = (tries: number) => {
    const game = useGameStore.getState()
    if (useFamily.getState().ask) return
    if ((game.offer || game.lastReward || game.shiftSummary || game.phase === 'handingOver') && tries > 0) window.setTimeout(() => attempt(tries - 1), 5000)
    else useFamily.getState().raiseAsk()
  }
  window.setTimeout(() => attempt(6), ASK.after)
})
// An order offer comes first: an ask that's up when one arrives is put by, and comes back after the next delivery.
useGameStore.subscribe((state, previous) => {
  if (state.offer && !previous.offer && useFamily.getState().ask) useFamily.setState({ ask: null, sinceAsk: ASK.every - 1 })
})
// A save that already has deliveries behind it starts the story on the next one.
useGameStore.subscribe((state, previous) => {
  if (state.history !== previous.history && state.history.length > 1 && !useFamily.getState().introduced) window.setTimeout(() => useFamily.getState().begin(), 9000)
})

// Debug: the family, for scripts (with ?debug).
if (typeof location !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(location.search).has('debug'))) {
  ;(window as unknown as { __deliverItFamily?: typeof useFamily }).__deliverItFamily = useFamily
}
