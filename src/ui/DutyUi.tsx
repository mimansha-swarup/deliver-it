import { keyFor } from '../game/keyBindings'
import { carries, cheapestFor, rentFor } from '../game/fleet'
import { ORDER_TYPE_NAMES } from '../vehicle/vehicleCatalog'
import { isKey } from '../game/keyBindings'
import { useEffect, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { CANCEL_PENALTY, dayPeriod, OFFER_SECONDS, type ShiftGoal, type ShiftSummary } from '../game/duty'
import { liveSky } from '../game/livePlayer'
import { MISSION_RULES } from '../game/missionConfig'
import { playPing } from '../audio/uiSounds'
import { CARGO } from '../missions/cargo'

/*
 * Being on or off duty, on screen: a badge saying which, an order offer to accept or decline, the
 * question when going offline with an order on, the shift's summary, and sleeping at home. Keys:
 * O goes online or offline, Y accepts an offer, X declines it, Z sleeps at home.
 */


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
      if (isKey('online', event.code)) game.toggleDuty()
      else if (isKey('accept', event.code) && game.offer) game.acceptOffer()
      else if (isKey('decline', event.code) && game.offer) game.declineOffer()
      else if (isKey('sleep', event.code) && game.atHome && game.duty === 'off') game.endDay()
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
        <strong>Off duty</strong>
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

/** Seconds left on an offer when a second ping reminds the rider. */
const OFFER_REMINDER_AT = 5
/** The countdown ring's size, in SVG units. */
const RING_RADIUS = 18
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`
}

/**
 * A new order, bottom centre above the rider: what, for whom, how far, roughly what it pays, and a
 * ring running down to the answer. It pings and pulses as it arrives, and pings again near the end.
 */
function OfferCard() {
  const offer = useGameStore((state) => state.offer)
  const accept = useGameStore((state) => state.acceptOffer)
  const decline = useGameStore((state) => state.declineOffer)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!offer) return
    playPing('offer')
    let reminded = false
    const timer = window.setInterval(() => {
      const time = performance.now()
      setNow(time)
      if (!reminded && offer.expiresAt - time <= OFFER_REMINDER_AT * 1000) {
        reminded = true
        playPing('reminder')
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [offer])

  if (!offer) return null
  const { mission } = offer
  const left = Math.max(0, Math.min(OFFER_SECONDS, (offer.expiresAt - now) / 1000))
  const period = dayPeriod(liveSky.hours)
  const base = Math.round(MISSION_RULES.baseCredits * mission.dropCount * CARGO[mission.story.cargo].payShare) + mission.tier.extraCredits
  const pay = base + Math.round(base * period.payShare)
  const kind = mission.kind === 'rush' ? 'Rush' : mission.kind === 'double' ? 'Double' : null
  // An order only some vehicles carry: the rider's must, or one is rented for it (GaadiGo, game/fleet.ts).
  const needs = mission.story.needs
  const fits = !needs || carries(needs)
  const rental = needs && !fits ? cheapestFor(needs) : null

  return (
    <section className="duty-offer" role="alertdialog" aria-label="New order" data-hurry={left <= OFFER_REMINDER_AT}>
      <svg className="duty-offer-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={RING_RADIUS} className="duty-offer-ring-track" />
        <circle
          cx="22"
          cy="22"
          r={RING_RADIUS}
          className="duty-offer-ring-left"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - left / OFFER_SECONDS)}
        />
        <text x="22" y="22">{Math.ceil(left)}</text>
      </svg>
      <div className="duty-offer-body">
        <p className="duty-offer-top">
          <strong>{mission.story.item}</strong>
          {kind && <span className="duty-offer-kind">{kind}</span>}
          {CARGO[mission.story.cargo].label ? (
            <span className="duty-offer-care" data-cargo={mission.story.cargo}>{CARGO[mission.story.cargo].label}</span>
          ) : (
            mission.story.care !== 'none' && <span className="duty-offer-care">{mission.story.care === 'fragile' ? 'Fragile' : 'Event'}</span>
          )}
        </p>
        {needs && !fits && (
          <p className="hud-detail">
            Needs: {ORDER_TYPE_NAMES[needs].toLowerCase()}.{' '}
            {rental ? (
              <button
                type="button"
                className="duty-accept"
                onClick={(event) => {
                  const refused = rentFor(needs)
                  if (refused) useGameStore.getState().raviSays(`GaadiGo: ${refused}`)
                  else accept()
                  event.currentTarget.blur()
                }}
              >
                Rent the {rental.name} for this order · ₹{rental.rentHour}
              </button>
            ) : (
              'Nothing you can rent carries it yet.'
            )}
          </p>
        )}
        <p className="hud-detail">
          for {mission.story.customer} · {formatDistance(mission.routeLength)} · <span className="duty-offer-pay">{pay}+ credits</span>
        </p>
      </div>
      <div className="duty-offer-buttons">
        <button type="button" className="duty-accept" onClick={(event) => { accept(); event.currentTarget.blur() }}>
          <kbd>{keyFor('accept')}</kbd> Accept
        </button>
        <button type="button" className="duty-decline" onClick={(event) => { decline(); event.currentTarget.blur() }}>
          <kbd>{keyFor('decline')}</kbd>
        </button>
      </div>
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

/** Time online, in real time: game-clock durations would only confuse. */
function formatDuration(realSeconds: number): string {
  const minutes = Math.round(realSeconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
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
        <dd>{formatDuration(summary.realSeconds)}</dd>
        {summary.goal && (
          <>
            <dt>Shift goal</dt>
            <dd>{summary.goal.state === 'met' ? `Met · +${summary.goal.bonus}` : 'Not met'}</dd>
          </>
        )}
        <dt>Best moment</dt>
        <dd className="duty-best">{summary.bestMoment}</dd>
      </dl>
      <button type="button" autoFocus onClick={dismiss}>
        Done
      </button>
    </section>
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
      {summary && <ShiftSummaryCard summary={summary} />}
      <SleepFade />
    </>
  )
}
