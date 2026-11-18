import { useEffect, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { CANCEL_PENALTY, dayPeriod, formatHour, OFFER_SECONDS, type ShiftGoal, type ShiftSummary } from '../game/duty'
import { liveSky } from '../game/livePlayer'
import { MISSION_RULES } from '../game/missionConfig'
import { CARE_HINTS } from '../missions/orderStory'

/*
 * Being on or off duty, on screen: a badge saying which, an order offer to accept or decline, the
 * question when going offline with an order on, the shift's summary, and sleeping at home. Keys:
 * O goes online or offline, Y accepts an offer, X declines it, Z sleeps at home.
 */

const KEYS = { duty: 'KeyO', accept: 'KeyY', decline: 'KeyX', sleep: 'KeyZ' }

/** How long the screen stays dark when sleeping, in milliseconds. */
const SLEEP_FADE_MS = 1800

/** Whether keys typed now are meant for a text field rather than the game. */
function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
}

function DutyKeys() {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || isTyping(event)) return
      const game = useGameStore.getState()
      if (event.code === KEYS.duty) game.toggleDuty()
      else if (event.code === KEYS.accept && game.offer) game.acceptOffer()
      else if (event.code === KEYS.decline && game.offer) game.declineOffer()
      else if (event.code === KEYS.sleep && game.atHome && game.duty === 'off') game.endDay()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])
  return null
}

/** The goal and how far along it is, in a few words. */
export function GoalLine({ goal }: { goal: ShiftGoal }) {
  const progress = goal.kind === 'earn' ? `${Math.min(goal.progress, goal.target)}/${goal.target}` : `${goal.progress}/${goal.target}`
  return (
    <span className="duty-goal" data-state={goal.state}>
      {goal.state === 'met' ? '✓ ' : goal.state === 'missed' ? '✗ ' : ''}
      {goal.text}
      {goal.state === 'open' && <span className="duty-goal-progress"> · {progress}</span>}
    </span>
  )
}

/** Off duty or online, at a glance, with the key to change it. */
function DutyBadge() {
  const duty = useGameStore((state) => state.duty)
  const goal = useGameStore((state) => state.shift?.goal ?? null)
  const finishing = useGameStore((state) => state.offlineAfterOrder)
  const skyTime = useGameStore((state) => state.skyTime)
  // The period's name follows the clock, which the store only sees as text: re-read it when that changes.
  const period = dayPeriod(liveSky.hours)
  void skyTime

  if (duty === 'off') {
    return (
      <p className="duty-badge" data-duty="off" role="status">
        <strong>Off duty</strong> <span>Ride anywhere · <kbd>O</kbd> to go online</span>
      </p>
    )
  }
  return (
    <p className="duty-badge" data-duty="online" role="status">
      <strong>Online</strong> <span>{period.label}{period.payShare > 0 && ` · +${Math.round(period.payShare * 100)}% pay`}</span>
      {finishing ? <span className="duty-goal">Going offline after this order</span> : goal && <GoalLine goal={goal} />}
    </p>
  )
}

/** A new order: where, what, roughly what it pays, and a bar running down to the answer. */
function OfferCard() {
  const offer = useGameStore((state) => state.offer)
  const accept = useGameStore((state) => state.acceptOffer)
  const decline = useGameStore((state) => state.declineOffer)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!offer) return
    const timer = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(timer)
  }, [offer])

  if (!offer) return null
  const { mission } = offer
  const left = Math.max(0, (offer.expiresAt - now) / 1000)
  const period = dayPeriod(liveSky.hours)
  const base = MISSION_RULES.baseCredits * mission.dropCount + mission.tier.extraCredits
  const pay = base + Math.round(base * period.payShare)
  const kind = mission.kind === 'rush' ? 'Rush' : mission.kind === 'double' ? 'Double drop' : null

  return (
    <section className="hud-card duty-offer" role="alertdialog" aria-label="New order">
      <p className="duty-offer-top">
        <strong>New order</strong>
        {kind && <span className="duty-offer-kind">{kind}</span>}
        <span className="duty-offer-pay">{pay}+ credits</span>
      </p>
      <p>{mission.story.item} for {mission.story.customer}</p>
      <p className="hud-detail">
        {mission.pickup.name} → {mission.customer.name} · {mission.tier.label}
      </p>
      {mission.story.care !== 'none' && <p className="duty-offer-care">{CARE_HINTS[mission.story.care]}</p>}
      <span className="duty-offer-timer" aria-hidden="true">
        <span style={{ width: `${(left / OFFER_SECONDS) * 100}%` }} />
      </span>
      <p className="duty-offer-buttons">
        <button type="button" className="duty-accept" onClick={(event) => { accept(); event.currentTarget.blur() }}>
          Accept <kbd>Y</kbd>
        </button>
        <button type="button" className="duty-decline" onClick={(event) => { decline(); event.currentTarget.blur() }}>
          Decline <kbd>X</kbd>
        </button>
      </p>
    </section>
  )
}

/** Going offline with an order on: finish it first, or cancel it and take the penalty. */
function OfflineQuestion() {
  const asking = useGameStore((state) => state.askingOffline)
  const goOffline = useGameStore((state) => state.goOffline)
  const stayOnline = useGameStore((state) => state.stayOnline)
  const customer = useGameStore((state) => state.mission?.story.customer)
  if (!asking) return null

  return (
    <section className="hud-card hud-results duty-question" role="alertdialog" aria-label="Go offline?">
      <h1>Go offline?</h1>
      <p className="hud-detail">{customer ? `${customer}'s order is still on.` : 'An order is still on.'}</p>
      <p className="duty-question-buttons">
        <button type="button" autoFocus onClick={() => goOffline('finish')}>Finish this order, then go offline</button>
        <button type="button" className="duty-cancel" onClick={() => goOffline('cancel')}>
          Cancel the order <span>−{CANCEL_PENALTY.credits} credits · counts as {CANCEL_PENALTY.stars}★</span>
        </button>
        <button type="button" className="duty-plain" onClick={stayOnline}>Stay online</button>
      </p>
    </section>
  )
}

function formatDuration(realSeconds: number, gameHours: number): string {
  const minutes = Math.round(realSeconds / 60)
  const hours = Math.floor(gameHours)
  const gameMinutes = Math.round((gameHours - hours) * 60)
  return `${minutes} min · ${hours} h ${gameMinutes} m on the clock`
}

/** What the shift came to, shown on going offline. */
function ShiftSummaryCard({ summary }: { summary: ShiftSummary }) {
  const dismiss = useGameStore((state) => state.dismissSummary)
  return (
    <section className="hud-card hud-results duty-summary" role="dialog" aria-label="Shift summary">
      <h1>Shift summary</h1>
      <dl>
        <dt>Deliveries</dt>
        <dd>{summary.deliveries}{summary.cancelled > 0 && ` · ${summary.cancelled} cancelled`}</dd>
        <dt>Earnings</dt>
        <dd>{summary.earnings} credits</dd>
        <dt>Tips</dt>
        <dd>{summary.tips} credits</dd>
        <dt>Average rating</dt>
        <dd>{summary.averageRating === null ? '—' : `★ ${summary.averageRating.toFixed(1)}`}</dd>
        <dt>Distance</dt>
        <dd>{(summary.distance / 1000).toFixed(1)} km</dd>
        <dt>Time online</dt>
        <dd>{formatDuration(summary.realSeconds, summary.gameHours)}</dd>
        {summary.goal && (
          <>
            <dt>Shift goal</dt>
            <dd>{summary.goal.state === 'met' ? `Met · +${summary.goal.bonus}` : 'Not met'}</dd>
          </>
        )}
      </dl>
      {summary.best && <p className="duty-best">Best moment: {summary.best.text}</p>}
      <button type="button" autoFocus onClick={dismiss}>
        Done
      </button>
    </section>
  )
}

/** At home: sleep until the morning, which ends the day and saves. */
function HomePrompt() {
  const atHome = useGameStore((state) => state.atHome)
  const duty = useGameStore((state) => state.duty)
  if (!atHome) return null
  return (
    <p className="duty-home" role="status">
      <strong>Home</strong>{' '}
      {duty === 'off' ? <span><kbd>Z</kbd> to sleep until {formatHour(7)}</span> : <span>Go offline to sleep</span>}
    </p>
  )
}

/** Sleeping: the screen goes dark for a moment, and says which day it is. */
function SleepFade() {
  const day = useGameStore((state) => state.day)
  const [shownDay, setShownDay] = useState(day)
  useEffect(() => {
    if (day === shownDay) return
    const timer = window.setTimeout(() => setShownDay(day), SLEEP_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [day, shownDay])
  if (day === shownDay) return null
  return (
    <div className="duty-sleep" role="status">
      <p>Day {day}</p>
      <p className="hud-detail">Good morning · progress saved</p>
    </div>
  )
}

export function DutyUi() {
  const summary = useGameStore((state) => state.shiftSummary)
  return (
    <>
      <DutyKeys />
      <DutyBadge />
      <OfferCard />
      <OfflineQuestion />
      <HomePrompt />
      {summary && <ShiftSummaryCard summary={summary} />}
      <SleepFade />
    </>
  )
}
