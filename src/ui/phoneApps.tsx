import { useEffect, useRef, useState } from 'react'
import { NAMMA_SPOTS, useDiscovery } from '../game/discovery'
import { atHub, downPayment, FLEET_RULES, locked, rentPrice, useFleet, weeklyEmi } from '../game/fleet'
import { MARKET, ORDER_TYPE_NAMES, VEHICLES, type VehicleId } from '../vehicle/vehicleCatalog'
import { keyFor } from '../game/keyBindings'
import { useGameStore } from '../game/gameStore'
import type { Mission, MissionPhase, OrderKind } from '../game/gameTypes'
import { levelFromXp, levelProgress, UNLOCK_LEVELS } from '../game/progression'
import { DARK_STORE_NAME, MISSION_RULES } from '../game/missionConfig'
import { getCurrentStop } from '../missions/missionLogic'
import { averageRating, CARE_HINTS, TOP_TIP, type Care } from '../missions/orderStory'
import type { WeatherName } from '../sky/skyLogic'
import { acceptanceRate, dayPeriod } from '../game/duty'
import { livePlayer, liveSky } from '../game/livePlayer'
import { findNearestNode } from '../world/roadGraph'
import { GoalLine } from './DutyUi'
import { CareerSheet, TodaySheet } from './CareerSheets'
import { Garage } from './Garage'
import { RadioControls } from './Radio'
import { QualityPicker } from './QualityPicker'
import { FullCredits } from './Credits'
import { DISPATCHER } from '../game/career'
import { setMapOpen } from './uiState'
import { KeyList } from './HelpOverlay'
import { useTutorial } from '../game/tutorial'
import { RAVI_THREAD, type AppId, type PhoneNav } from './phoneAppList'
import { CARGO } from '../missions/cargo'
import { ACHIEVEMENTS, useAchievements } from '../game/achievements'
import { RJ_NAME, useOnAir } from '../audio/rj'
import { currentGoal, FAMILY_THREAD, FUND_GOALS, useFamily } from '../game/family'
import { energyOf, fillPrice, fuelLevel, serviceState, UPKEEP, useUpkeep } from '../game/upkeep'
import { DEBUG_SAVE } from '../game/saveKeys'
import { DebugPanel } from './DebugPanel'

/*
 * The phone's apps (Phone.tsx is the phone itself: lock screen, home screen, status bar).
 * Deliver It, Messages, Maps, Radio, Wallet, Garage, Camera and Settings.
 */

/** The last stretch of the on-time limit, when the timer turns red. */
const HURRY_SECONDS = 20

/** What the order sheet says when there's nowhere to ride to. */
const SHEET_MESSAGES: Partial<Record<MissionPhase, string>> = {
  collecting: 'Collecting the order',
  handingOver: 'Handing over the order',
  delivered: 'Order delivered',
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** The weather as a small drawing, so it reads at a glance while riding. */
export function WeatherIcon({ weather, night }: { weather: WeatherName; night: boolean }) {
  const cloud = 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.6 4.2 4.2 0 0 1 17 18Z'

  return (
    <svg className="phone-weather-icon" viewBox="0 0 24 24" aria-hidden="true">
      {weather === 'clear' &&
        (night ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="#dfe6f5" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.6" fill="#ffc53d" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <rect
                key={angle}
                x="11.2"
                y="2"
                width="1.6"
                height="3.4"
                rx="0.8"
                fill="#ffc53d"
                transform={`rotate(${angle} 12 12)`}
              />
            ))}
          </>
        ))}
      {weather === 'cloudy' && <path d={cloud} fill="#c6ccd6" />}
      {weather === 'rain' && (
        <>
          <path d={cloud} transform="translate(0 -3)" fill="#9aa5b5" />
          {[8, 12, 16].map((x) => (
            <path
              key={x}
              d={`M${x} 17.5l-1.2 3.5`}
              stroke="#63b3ff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ))}
        </>
      )}
    </svg>
  )
}

function Timer() {
  const mission = useGameStore((state) => state.mission)
  const seconds = useGameStore((state) => state.seconds)
  if (!mission) return null

  const timeLeft = mission.onTimeSeconds - seconds
  if (timeLeft < 0) return <span className="phone-timer phone-timer-missed">Bonus missed</span>

  return (
    <span className={timeLeft <= HURRY_SECONDS ? 'phone-timer phone-timer-hurry' : 'phone-timer'}>
      {formatTime(timeLeft)}
    </span>
  )
}

function Route({ mission, phase }: { mission: Mission; phase: MissionPhase }) {
  const collected = phase !== 'toPickup'

  return (
    <ol className="phone-route">
      <li data-state={collected ? 'done' : 'current'}>
        <span className="phone-route-dot" style={{ background: mission.pickup.color }} />
        <span className="phone-route-role">Pick up</span>
        {mission.pickup.name}
      </li>
      <li data-state={collected ? 'current' : 'next'}>
        <span className="phone-route-dot" style={{ background: mission.customer.color }} />
        <span className="phone-route-role">Drop off</span>
        {mission.customer.name}
      </li>
      {mission.nextDrops.map(({ customer }) => (
        <li key={customer.node} data-state="next">
          <span className="phone-route-dot" style={{ background: customer.color }} />
          <span className="phone-route-role">Then</span>
          {customer.name}
        </li>
      ))}
    </ol>
  )
}

const CARE_LABELS: Record<Care, string> = { none: '', fragile: 'Fragile', event: 'Event' }

/** What's in the order and who it's for. Raised, it adds the customer's note and how to carry it. */
function OrderItem({ mission, raised }: { mission: Mission; raised: boolean }) {
  const knocks = useGameStore((state) => state.knocks)
  const phase = useGameStore((state) => state.phase)
  const { item, customer, care, note } = mission.story
  const onBoard = phase === 'toCustomer'

  return (
    <>
      <p className="phone-item">
        {item} for {customer}
        {care !== 'none' && <span className={`phone-care phone-care-${care}`}>{CARE_LABELS[care]}</span>}
        {care === 'fragile' && onBoard && knocks > 0 && (
          <span className="phone-knocks">
            {knocks} bump{knocks > 1 ? 's' : ''}
          </span>
        )}
      </p>
      {raised && (
        <>
          <p className="phone-note">“{note}”</p>
          {CARGO[mission.story.cargo].hint ? <p className="phone-care-hint">{CARGO[mission.story.cargo].hint}</p> : care !== 'none' && <p className="phone-care-hint">{CARE_HINTS[care]}</p>}
        </>
      )}
    </>
  )
}

const KIND_LABELS: Record<OrderKind, string> = { standard: '', rush: 'Rush', double: 'Double drop' }

/** Your level, and how far through it you are. */
function LevelBar() {
  const xp = useGameStore((state) => state.xp)
  const { level, into, needed, share } = levelProgress(xp)

  return (
    <div className="phone-level" title={needed ? `${into} of ${needed} XP to level ${level + 1}` : 'Top level'}>
      <span>Lv {level}</span>
      <span className="phone-level-bar">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span>{xp} XP</span>
    </div>
  )
}

/** What the order pays. The base is guaranteed, so bonuses are only ever shown as extras. */
function Earnings({ mission }: { mission: Mission }) {
  const credits = useGameStore((state) => state.credits)
  const xp = useGameStore((state) => state.xp)
  const crashes = useGameStore((state) => state.crashes)
  const night = useGameStore((state) => state.night)
  const rules = MISSION_RULES
  const guaranteed = rules.baseCredits * mission.dropCount + mission.tier.extraCredits
  const onTimeBonus = rules.onTimeCredits + (mission.kind === 'rush' ? rules.rushExtraCredits : 0)
  const nightUnlocked = levelFromXp(xp) >= UNLOCK_LEVELS.nightPay
  const ratings = useGameStore((state) => state.ratings)
  const rating = averageRating(ratings)

  return (
    <>
      <dl className="phone-pay">
        <dt>This order</dt>
        <dd>{guaranteed} credits</dd>
        <dt>{mission.kind === 'rush' ? 'Rush bonus' : 'On-time bonus'}</dt>
        <dd>+{onTimeBonus}</dd>
        <dt>Clean ride bonus</dt>
        <dd>{crashes === 0 ? `+${rules.cleanRideCredits}` : 'Missed'}</dd>
        <dt>Customer's tip</dt>
        <dd>Up to +{TOP_TIP} for 5★</dd>
        {nightUnlocked && (
          <>
            <dt>Night shift</dt>
            <dd>{night ? `+${Math.round(rules.nightPayShare * 100)}%` : 'After dark'}</dd>
          </>
        )}
      </dl>
      <p className="phone-wallet">
        <span>{credits} credits</span>
        {rating !== null && <span className="phone-rating">★ {rating.toFixed(1)}</span>}
      </p>
      <LevelBar />
    </>
  )
}

/** Opens the Garage, which only works while stopped at the dark store. */
function GarageButton({ onOpen }: { onOpen: () => void }) {
  const atStore = useGameStore((state) => state.atStore)
  return (
    <button
      type="button"
      className="phone-garage-button"
      disabled={!atStore}
      onClick={(event) => {
        onOpen()
        event.currentTarget.blur()
      }}
    >
      {atStore ? 'Open the Garage' : 'Garage · stop at the dark store'}
    </button>
  )
}

/** No order on: off duty (go online), or online and waiting for the next offer. */
function DutySheet({ raised, onOpenGarage }: { raised: boolean; onOpenGarage: () => void }) {
  const duty = useGameStore((state) => state.duty)
  const offer = useGameStore((state) => state.offer)
  const goal = useGameStore((state) => state.shift?.goal ?? null)
  const answers = useGameStore((state) => state.answers)
  const day = useGameStore((state) => state.day)
  const toggleDuty = useGameStore((state) => state.toggleDuty)
  const skyTime = useGameStore((state) => state.skyTime)
  const rate = acceptanceRate(answers)
  void skyTime
  const period = dayPeriod(liveSky.hours)

  return (
    <section className="phone-sheet">
      <p className="phone-sheet-top">
        <span className="phone-objective">
          {duty === 'off' ? 'Off duty' : offer ? 'New order offered' : 'Waiting for orders'}
        </span>
        <span className="phone-period">Day {day} · {period.label}</span>
      </p>
      <p className="phone-stop">
        {duty === 'off' ? 'Ride anywhere. Go online for orders.' : offer ? `${keyFor('accept')} to accept · ${keyFor('decline')} to decline` : `${period.label}: ${period.payShare > 0 ? `+${Math.round(period.payShare * 100)}% pay` : 'normal pay'}`}
      </p>
      {duty === 'online' && goal && (
        <p className="phone-goal">
          <GoalLine goal={goal} />
        </p>
      )}
      <button
        type="button"
        className={duty === 'off' ? 'phone-duty-button phone-duty-online' : 'phone-duty-button'}
        onClick={(event) => {
          toggleDuty()
          event.currentTarget.blur()
        }}
      >
        {duty === 'off' ? `Go online · ${keyFor('online')}` : `Go offline · ${keyFor('online')}`}
      </button>
      {raised && (
        <>
          <p className="phone-order-line">
            Acceptance {rate === null ? '—' : `${Math.round(rate * 100)}%`}
            {duty === 'off' && ` · Sleep at home (${keyFor('sleep')}) to end the day`}
          </p>
          <GarageButton onOpen={onOpenGarage} />
        </>
      )}
    </section>
  )
}

export function OrderSheet({ raised, onOpenGarage }: { raised: boolean; onOpenGarage: () => void }) {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const missionNumber = useGameStore((state) => state.missionNumber)
  const distance = useGameStore((state) => state.distance)
  const inZone = useGameStore((state) => state.inZone)

  // While a parcel changes hands, the sheet shows the order and the customer it's going to.
  const handingOff = phase === 'collecting' || phase === 'handingOver'
  const stop = getCurrentStop(mission, phase) ?? (handingOff && mission ? mission.customer : null)

  if (!mission || !stop) {
    if (phase === 'delivered') {
      return (
        <section className="phone-sheet">
          <p className="phone-objective">{SHEET_MESSAGES[phase]}</p>
          {raised && <GarageButton onOpen={onOpenGarage} />}
        </section>
      )
    }
    return <DutySheet raised={raised} onOpenGarage={onOpenGarage} />
  }

  return (
    <section className="phone-sheet">
      <p className="phone-sheet-top">
        <span className="phone-objective" style={{ color: stop.color }}>
          {handingOff ? SHEET_MESSAGES[phase] : phase === 'toPickup' ? 'Pick up' : 'Drop off'}
          {phase !== 'toPickup' &&
            mission.dropCount > 1 &&
            ` ${mission.dropCount - mission.nextDrops.length}/${mission.dropCount}`}
          {mission.kind === 'rush' && <span className="phone-rush">Rush</span>}
        </span>
        <Timer />
      </p>
      <p className="phone-stop">{stop.name}</p>
      <OrderItem mission={mission} raised={raised} />
      {!handingOff && <p className="phone-distance">{inZone ? stop.arrivalHint : `${distance} m by road`}</p>}

      {raised && (
        <>
          <p className="phone-order-line">
            Order #{missionNumber} · {mission.tier.label}
            {mission.kind !== 'standard' && ` · ${KIND_LABELS[mission.kind]}`}
          </p>
          <Route mission={mission} phase={phase} />
          <Earnings mission={mission} />
          <GarageButton onOpen={onOpenGarage} />
        </>
      )}
    </section>
  )
}


/* ---------------------------------------------------------------- the apps */

export function AppGlyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** An app's top bar: back to the home screen, and its name. */
function AppBar({ title, nav }: { title: string; nav: PhoneNav }) {
  return (
    <header className="app-bar">
      <button type="button" className="app-back" onClick={(event) => { nav.go('home'); event.currentTarget.blur() }} aria-label="Back to the home screen">
        ‹ Home
      </button>
      <h2>{title}</h2>
    </header>
  )
}

/** Deliver It: going online, the order on, the shift's goal and pay, the rating, daily challenges, history. */
function DeliverItApp({ nav }: { nav: PhoneNav }) {
  const ratings = useGameStore((state) => state.ratings)
  const shift = useGameStore((state) => state.shift)
  const history = useGameStore((state) => state.history)
  const rating = averageRating(ratings)
  return (
    <div className="app">
      <AppBar title="Deliver It" nav={nav} />
      <div className="app-body">
        <OrderSheet raised onOpenGarage={() => nav.go('garage')} />
        <section className="app-card">
          <p className="app-card-title">Your rating</p>
          <p className="app-big">{rating === null ? '—' : `★ ${rating.toFixed(1)}`} <small>last {ratings.length}</small></p>
          {shift && (
            <p className="app-line">
              This shift: {shift.deliveries} delivered · {shift.earnings} credits
            </p>
          )}
        </section>
        <TodaySheet />
        <CareerSheet />
        <section className="app-card">
          <p className="app-card-title">History</p>
          {history.length === 0 && <p className="app-line app-muted">No deliveries yet</p>}
          <ul className="app-list">
            {history.map((record) => (
              <li key={record.id}>
                <span>
                  {record.item} · {record.customer}
                  <small>Day {record.day}</small>
                </span>
                <span className="app-list-right">
                  {'★'.repeat(record.stars)} <small>+{record.earned}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** Messages: a thread per customer and one for Ravi, newest at the bottom, with unread counts. */
function MessagesApp({ nav }: { nav: PhoneNav }) {
  const chat = useGameStore((state) => state.chat)
  const messages = useGameStore((state) => state.messages)
  // A thread opens at its newest message, at the bottom, and stays there as new ones come.
  const thread = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight
  }, [nav.thread, chat, messages])
  const family = useFamily((state) => state.lines)
  const customers = [...new Set(chat.filter((line) => line.from === 'customer' && line.name !== FAMILY_THREAD).map((line) => line.name))].reverse()
  // Ravi, home (once the family has written), then whoever else has.
  const threads = [RAVI_THREAD, ...(family.length > 0 ? [FAMILY_THREAD] : []), ...customers]

  if (nav.thread) {
    const lines =
      nav.thread === RAVI_THREAD
        ? [...messages].slice(0, 15).reverse().map((message) => ({ id: message.id, text: message.text, urgent: false, mine: false }))
        : nav.thread === FAMILY_THREAD
          ? family.map((line) => ({ id: line.id, text: `${line.from}: ${line.text}`, urgent: false, mine: false }))
          : chat.filter((line) => line.from === 'customer' && line.name === nav.thread).map((line) => ({ id: line.id, text: line.text, urgent: !!line.urgent, mine: false }))
    return (
      <div className="app">
        <header className="app-bar app-bar-chat">
          <button type="button" className="app-back" onClick={(event) => { nav.go('messages'); event.currentTarget.blur() }} aria-label="Back to the threads">
            ‹ Messages
          </button>
          <h2>{nav.thread === RAVI_THREAD ? DISPATCHER : nav.thread}</h2>
        </header>
        <ol ref={thread} className="app-body phone-chat-thread app-thread">
          {lines.length === 0 && <li className="phone-chat-empty">No messages yet</li>}
          {lines.map((line) => (
            <li key={line.id} data-from={nav.thread === RAVI_THREAD ? 'dispatch' : 'customer'} data-urgent={line.urgent ? 'true' : undefined}>
              {line.text}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="app">
      <AppBar title="Messages" nav={nav} />
      <ul className="app-body app-list app-threads">
        {threads.map((thread) => {
          const last =
            thread === RAVI_THREAD
              ? messages[0]?.text
              : thread === FAMILY_THREAD
                ? `${family[family.length - 1]?.from}: ${family[family.length - 1]?.text}`
                : [...chat].reverse().find((line) => line.from === 'customer' && line.name === thread)?.text
          const unread = nav.unread(thread)
          return (
            <li key={thread}>
              <button type="button" onClick={(event) => { nav.openThread(thread); event.currentTarget.blur() }}>
                <span className="app-thread-avatar">{(thread === RAVI_THREAD ? 'R' : thread[0]).toUpperCase()}</span>
                <span className="app-thread-text">
                  <strong>{thread === RAVI_THREAD ? DISPATCHER : thread}</strong>
                  <small>{last ?? 'No messages yet'}</small>
                </span>
                {unread > 0 && <span className="phone-tab-count">{unread}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}


/** Maps: the full map, and places to go: home, the dark stores, chai stalls, nearest first. */
function MapsApp({ nav }: { nav: PhoneNav }) {
  const home = useGameStore((state) => state.home)
  const stores = useGameStore((state) => state.planner?.stores ?? [])
  const chai = useGameStore((state) => state.places.chai)
  const hasOrder = useGameStore((state) => state.mission !== null)
  const goTo = (x: number, z: number) => {
    const { planner, setWaypoint } = useGameStore.getState()
    if (!planner || hasOrder) return
    const node = findNearestNode(planner.graph, x, z)
    setWaypoint({ x: planner.graph.xs[node], z: planner.graph.zs[node], node })
    nav.close()
  }
  const byDistance = <T extends { x: number; z: number }>(list: T[]) =>
    [...list].sort((a, b) => Math.hypot(a.x - livePlayer.x, a.z - livePlayer.z) - Math.hypot(b.x - livePlayer.x, b.z - livePlayer.z))
  const far = (x: number, z: number) => {
    const metres = Math.hypot(x - livePlayer.x, z - livePlayer.z)
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 10) * 10} m`
  }
  const places = [
    ...(home ? [{ x: home.x, z: home.z, name: 'Home', kind: 'home' }] : []),
    ...byDistance(stores).slice(0, 3).map((store) => ({ x: store.x, z: store.z, name: DARK_STORE_NAME, kind: 'store' })),
    ...byDistance(chai).slice(0, 5).map((stall) => ({ ...stall, kind: 'chai' })),
  ]
  return (
    <div className="app">
      <AppBar title="Maps" nav={nav} />
      <div className="app-body">
        <button type="button" className="app-wide-button" onClick={(event) => { nav.close(); setMapOpen(true); event.currentTarget.blur() }}>
          Open the full map · {keyFor('map')}
        </button>
        <section className="app-card">
          <p className="app-card-title">Saved places {hasOrder && <small>· routes are off during an order</small>}</p>
          <ul className="app-list">
            {places.map((place, index) => (
              <li key={`${place.kind}-${index}`}>
                <button type="button" disabled={hasOrder} onClick={() => goTo(place.x, place.z)}>
                  <span>
                    {place.name}
                    <small>{place.kind === 'home' ? `Sleep here (${keyFor('sleep')})` : place.kind === 'store' ? 'Pickups and the Garage' : 'Chai break'}</small>
                  </span>
                  <span className="app-list-right">{far(place.x, place.z)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** What the RJ is saying now, as text: the same words the radio speaks. */
function OnAir() {
  const line = useOnAir((state) => state.line)
  if (!line) return null
  return (
    <section className="app-card">
      <p className="app-card-title">On air · {RJ_NAME} · {line.kind === 'ad' ? 'Advertisement' : 'Traffic update'}</p>
      <p className="app-line">{line.text}</p>
    </section>
  )
}

function MusicApp({ nav }: { nav: PhoneNav }) {
  return (
    <div className="app">
      <AppBar title="Radio" nav={nav} />
      <div className="app-body">
        <section className="phone-sheet phone-music">
          <RadioControls />
        </section>
        <OnAir />
        <p className="app-line app-muted">Three stations, all original music made in the game. {RJ_NAME} comes on every minute or two with traffic and ads.</p>
      </div>
    </div>
  )
}

/** Wallet: the balance, and today's money in and out. */
/** Kavya's college fund (game/family.ts): what's saved, what it's for now, and sending money home. */
function CollegeFund() {
  const saved = useFamily((state) => state.saved)
  const introduced = useFamily((state) => state.introduced)
  const credits = useGameStore((state) => state.credits)
  const [note, setNote] = useState('')
  if (!introduced) return null
  const goal = currentGoal(saved)
  const from = [...FUND_GOALS].reverse().find(({ at }) => at <= saved)?.at ?? 0
  const share = goal ? (saved - from) / (goal.at - from) : 1
  const send = (amount: number) => setNote(useFamily.getState().send(amount) ?? `₹${amount} sent home.`)
  // Round sums, and "all but a little": never the last rupees needed for petrol.
  const spare = Math.max(0, credits - 150)
  return (
    <section className="app-card fund-card">
      <p className="app-card-title">Kavya’s college fund</p>
      <p className="app-big">₹{saved.toLocaleString('en-IN')}</p>
      {goal ? (
        <>
          <p className="app-line">
            Now: {goal.what.toLowerCase()} · ₹{(goal.at - saved).toLocaleString('en-IN')} to go
          </p>
          <span className="fund-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          <p className="fund-buttons">
            {[100, 500].map((amount) => (
              <button key={amount} type="button" disabled={credits < amount} onClick={(event) => { send(amount); event.currentTarget.blur() }}>
                Send ₹{amount}
              </button>
            ))}
            <button type="button" disabled={spare < 50} onClick={(event) => { send(Math.min(spare, goal.at - saved)); event.currentTarget.blur() }}>
              Send ₹{Math.min(spare, goal.at - saved)}
            </button>
          </p>
        </>
      ) : (
        <p className="app-line">Every fee is paid. She’s in her second semester, and she stood second in class.</p>
      )}
      <p className="app-line app-muted">{note || 'Your sister’s fees, sent home from this wallet. No deadline: when you can.'}</p>
    </section>
  )
}

/** What the wallet will be asked for next: each EMI and its day, a service that's due, a tank that's low. */
function ComingUp() {
  const emis = useFleet((state) => state.emis)
  const rental = useFleet((state) => state.rental)
  const day = useGameStore((state) => state.day)
  const vehicleId = useGameStore((state) => state.vehicleId)
  const spec = VEHICLES[vehicleId] ?? VEHICLES.scooter
  const km = useUpkeep((state) => state.sinceService[vehicleId] ?? 0)
  const level = useUpkeep((state) => fuelLevel(state.fuel, vehicleId))
  const lines: { label: string; when: string; amount: number }[] = emis.map((emi) => ({
    label: `EMI · ${VEHICLES[emi.id].name} (${emi.weeksLeft} left)`,
    when: emi.nextDueDay <= day ? 'today' : emi.nextDueDay === day + 1 ? 'tomorrow' : `day ${emi.nextDueDay}`,
    amount: emi.weekly,
  }))
  if (serviceState(km) !== 'ok') lines.push({ label: `Service · ${spec.name}`, when: serviceState(km) === 'due' ? 'due' : 'overdue', amount: UPKEEP.serviceCost[vehicleId] })
  if (energyOf(spec) !== 'none' && level < 0.5) lines.push({ label: `${energyOf(spec) === 'charge' ? 'Charge' : 'Fuel'} · ${spec.name}`, when: `${Math.round(level * 100)}% left`, amount: fillPrice(spec, level) })
  if (rental && rental.hoursLeft <= 0) lines.push({ label: `Late fees · ${VEHICLES[rental.id].name}`, when: 'running', amount: Math.round(Math.max(1, Math.ceil(-rental.hoursLeft)) * VEHICLES[rental.id].rentHour * FLEET_RULES.lateRate) })
  return (
    <section className="app-card">
      <p className="app-card-title">Coming up</p>
      {lines.length === 0 && <p className="app-line app-muted">Nothing due: no EMIs, tank fine, service fine.</p>}
      <ul className="app-list">
        {lines.map(({ label, when, amount }) => (
          <li key={label}>
            <span>
              {label}
              <small>{when}</small>
            </span>
            <span className="app-list-right" data-negative="true">−{amount}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function WalletApp({ nav }: { nav: PhoneNav }) {
  const credits = useGameStore((state) => state.credits)
  const ledger = useGameStore((state) => state.ledger)
  const fresh = useGameStore((state) => state.fresh)
  const day = useGameStore((state) => state.day)
  const today = ledger.filter((entry) => entry.day === day)
  const sum = (kinds: string[]) => today.filter((entry) => kinds.includes(entry.kind)).reduce((total, entry) => total + entry.amount, 0)
  return (
    <div className="app">
      <AppBar title="Wallet" nav={nav} />
      <div className="app-body">
        <section className="app-card">
          <p className="app-card-title">Balance</p>
          <p className="app-big">{credits} credits</p>
          {fresh > 0 && <p className="app-line">Fresh from a meal: +15% tips on the next {fresh} {fresh === 1 ? 'delivery' : 'deliveries'}</p>}
        </section>
        <section className="app-card app-totals">
          <p className="app-card-title">Today · day {day}</p>
          <dl>
            <dt>Earnings</dt>
            <dd>+{sum(['earning', 'bonus'])}</dd>
            <dt>Tips</dt>
            <dd>+{sum(['tip'])}</dd>
            <dt>Expenses</dt>
            <dd>{sum(['expense'])}</dd>
          </dl>
        </section>
        <CollegeFund />
        <ComingUp />
        <section className="app-card">
          <p className="app-card-title">Recent</p>
          {ledger.length === 0 && <p className="app-line app-muted">Nothing yet</p>}
          <ul className="app-list">
            {ledger.slice(0, 15).map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.label}
                  <small>Day {entry.day}</small>
                </span>
                <span className="app-list-right" data-negative={entry.amount < 0}>
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** The vehicle in use: its tank, the kilometres since its last service, and the service itself, done at the dark store. */
function ServiceCard({ canService }: { canService: boolean }) {
  const vehicleId = useGameStore((state) => state.vehicleId)
  const spec = VEHICLES[vehicleId] ?? VEHICLES.scooter
  const km = useUpkeep((state) => state.sinceService[vehicleId] ?? 0)
  const level = useUpkeep((state) => fuelLevel(state.fuel, vehicleId))
  const [refused, setRefused] = useState('')
  const state = serviceState(km)
  const energy = energyOf(spec)
  return (
    <section className="app-card">
      <p className="app-card-title">Upkeep · {spec.name}</p>
      {energy !== 'none' && (
        <p className="app-line">
          {energy === 'charge' ? 'Battery' : 'Tank'}: {Math.round(level * 100)}% · about {Math.round(level * UPKEEP.rangeKm[vehicleId])} km left.{' '}
          <span className="app-muted">{energy === 'charge' ? 'Charge at a bunk’s EV charger, or overnight at home.' : 'Fill up at any petrol bunk.'}</span>
        </p>
      )}
      <p className="app-line" data-negative={state === 'overdue'}>
        Service: {km.toFixed(1)} km since the last. {state === 'ok' ? `Due at ${UPKEEP.serviceEveryKm} km.` : state === 'due' ? 'Due now.' : 'Overdue: it will break down.'}
      </p>
      <button
        type="button"
        className="app-wide-button"
        disabled={!canService || km < 1}
        onClick={(event) => {
          setRefused(useUpkeep.getState().service(vehicleId) ?? '')
          event.currentTarget.blur()
        }}
      >
        {canService ? `Service it · ₹${UPKEEP.serviceCost[vehicleId]}` : `Service at the dark store · ₹${UPKEEP.serviceCost[vehicleId]}`}
      </button>
      {refused && <p className="app-line app-muted">{refused}</p>}
    </section>
  )
}

/** Garage: anywhere to look; buying only stopped at the dark store. */
function GarageApp({ nav }: { nav: PhoneNav }) {
  const atStore = useGameStore((state) => state.atStore)
  return (
    <div className="app">
      <AppBar title="Garage" nav={nav} />
      <div className="app-body">
        {!atStore && <p className="app-note">Looking only: stop at the dark store to buy, or to service.</p>}
        <ServiceCard canService={atStore} />
        <Garage onClose={() => nav.go('home')} canBuy={atStore} />
      </div>
    </div>
  )
}

/** Camera: photo mode. */
function CameraApp({ nav }: { nav: PhoneNav }) {
  const setPhotoMode = useGameStore((state) => state.setPhotoMode)
  return (
    <div className="app">
      <AppBar title="Camera" nav={nav} />
      <div className="app-body">
        <section className="app-card">
          <p className="app-card-title">Photo mode</p>
          <p className="app-line">The game pauses, the HUD hides, and the camera is yours: fly about with W A S D, drag to look, scroll to zoom, Space to save a picture.</p>
          <button
            type="button"
            className="app-wide-button"
            onClick={(event) => {
              nav.close()
              setPhotoMode(true)
              event.currentTarget.blur()
            }}
          >
            Open the camera
          </button>
        </section>
      </div>
    </div>
  )
}

const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`

/**
 * GaadiGo (made up): the vehicle marketplace (game/fleet.ts). A catalogue of what each vehicle does and
 * costs; rent or buy one, delivered to where you are or picked up free at the hub; your rental, to end
 * it; your Garage, to take your own vehicles out; your EMIs.
 */
function GaadiGoApp({ nav }: { nav: PhoneNav }) {
  const fleet = useFleet()
  const vehicleId = useGameStore((state) => state.vehicleId)
  const credits = useGameStore((state) => state.credits)
  const [open, setOpen] = useState<VehicleId | null>(null)
  const [insured, setInsured] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const act = (result: string | null, done: string) => setNote(result ?? done)
  const hub = atHub()
  const how = hub ? 'hub' : 'deliver'
  const howText = hub ? 'Free pickup: you are at the hub' : `Delivered to you (${rupees(FLEET_RULES.deliveryFee)}, 1 to 3 min)`

  return (
    <div className="app">
      <AppBar title="GaadiGo" nav={nav} />
      <div className="app-body">
        <p className="app-line">Wallet {rupees(credits)} · riding the {VEHICLES[vehicleId].name}</p>
        {note && <p className="app-line"><strong>{note}</strong></p>}

        {fleet.rental && (
          <section className="app-card">
            <p className="app-card-title">Your rental: {VEHICLES[fleet.rental.id].name}</p>
            <p className="app-line">
              {fleet.rental.hoursLeft > 0 ? `${fleet.rental.hoursLeft.toFixed(1)} h left` : `${Math.ceil(-fleet.rental.hoursLeft)} h late: fees running`}
              {fleet.rental.insured ? ' · insured' : ` · ${fleet.rental.crashes} crash${fleet.rental.crashes === 1 ? '' : 'es'} (${rupees(FLEET_RULES.damagePerCrash)} each)`}
            </p>
            <button type="button" className="app-wide-button" onClick={() => act(fleet.endRental(), 'Rental ended. It has been collected.')}>
              End rental (park first)
            </button>
          </section>
        )}
        {fleet.delivery && (
          <section className="app-card">
            <p className="app-card-title">On its way: {VEHICLES[fleet.delivery.id].name}</p>
            <p className="app-line">It comes to where you ordered it. Pull up beside it and stop for the handover.</p>
          </section>
        )}

        <p className="app-card-title">Catalogue · {howText}</p>
        {MARKET.map((id) => {
          const spec = VEHICLES[id]
          const why = locked(spec)
          const owned = fleet.owned.includes(id)
          return (
            <section className="app-card" key={id}>
              <button type="button" className="app-wide-button" onClick={() => setOpen(open === id ? null : id)}>
                {spec.name} · {spec.kind}
              </button>
              <p className="app-line">{spec.blurb}</p>
              <p className="app-line">
                {spec.topSpeed} km/h · carries {spec.capacity} · {spec.costPerKm === 0 ? 'free to run' : `${rupees(spec.costPerKm)}/km`} · rent {rupees(spec.rentHour)}/h
              </p>
              {open === id && (
                <>
                  <p className="app-line">Handling: turns ×{spec.turn.toFixed(2)}, grip ×{spec.grip.toFixed(2)}, brakes ×{spec.brake.toFixed(2)}, pull ×{spec.pull.toFixed(2)} (against your scooter)</p>
                  <p className="app-line">Unlocks: {spec.unlocks.map((type) => ORDER_TYPE_NAMES[type]).join('; ')}</p>
                  <p className="app-line">Needs level {spec.minLevel}{spec.minRating > 0 ? ` and ${spec.minRating.toFixed(1)}★` : ''}{spec.cockpit ? " · driver's-seat view (V)" : ''}</p>
                  {why ? (
                    <p className="app-line"><strong>Locked: {why}</strong></p>
                  ) : owned ? (
                    <p className="app-line"><strong>Yours. Take it out from the Garage below.</strong></p>
                  ) : (
                    <>
                      <label className="app-line">
                        <input type="checkbox" checked={insured} onChange={(event) => setInsured(event.target.checked)} /> Rental insurance (+15%): no damage charges
                      </label>
                      <button type="button" className="app-wide-button" onClick={() => act(fleet.rent(id, 'hour', insured, how), hub ? 'Rented. Ride safe.' : 'Rented. It is on its way.')}>
                        Rent 1 hour · {rupees(rentPrice(spec, 'hour', insured))}
                      </button>
                      <button type="button" className="app-wide-button" onClick={() => act(fleet.rent(id, 'day', insured, how), hub ? 'Rented for the day.' : 'Rented for the day. It is on its way.')}>
                        Rent 1 day · {rupees(rentPrice(spec, 'day', insured))}
                      </button>
                      <button type="button" className="app-wide-button" onClick={() => act(fleet.buy(id, 'full', how), hub ? 'Bought. It is yours.' : 'Bought. It is on its way.')}>
                        Buy · {rupees(spec.price)}
                      </button>
                      <button type="button" className="app-wide-button" onClick={() => act(fleet.buy(id, 'emi', how), hub ? 'Bought on EMI.' : 'Bought on EMI. It is on its way.')}>
                        Buy on EMI · {rupees(downPayment(spec))} now, then {rupees(weeklyEmi(spec))} × {FLEET_RULES.emiWeeks} weeks
                      </button>
                    </>
                  )}
                </>
              )}
            </section>
          )
        })}

        <p className="app-card-title">Your Garage</p>
        {(['scooter', ...fleet.owned] as VehicleId[]).map((id) => (
          <section className="app-card" key={id}>
            <p className="app-line">{VEHICLES[id].name}{vehicleId === id ? ' · in use' : ''}</p>
            {vehicleId !== id && (
              <button type="button" className="app-wide-button" onClick={() => act(fleet.takeOut(id, how), hub ? 'Swapped at the hub.' : 'It is on its way.')}>
                Take it out · {hub ? 'free at the hub' : `delivered, ${rupees(FLEET_RULES.deliveryFee)}`}
              </button>
            )}
          </section>
        ))}

        {fleet.emis.length > 0 && <p className="app-card-title">Your EMIs (weekly, from the Wallet)</p>}
        {fleet.emis.map((emi) => (
          <section className="app-card" key={emi.id}>
            <p className="app-line">{VEHICLES[emi.id].name}: {rupees(emi.weekly)} a week, {emi.weeksLeft} to go, next on day {emi.nextDueDay}{emi.missed > 0 ? ' · MISSED: pay by then or it is taken back' : ''}</p>
          </section>
        ))}
      </div>
    </div>
  )
}

/** Namma spots: views worth finding round Agara, ticked off once seen (game/discovery.ts). */
function SpotsApp({ nav }: { nav: PhoneNav }) {
  const found = useDiscovery((state) => state.found)
  const count = NAMMA_SPOTS.filter(({ id }) => found[id]).length
  return (
    <div className="app">
      <AppBar title="Namma spots" nav={nav} />
      <div className="app-body">
        <section className="app-card">
          <p className="app-card-title">Our spots · {count} of {NAMMA_SPOTS.length}</p>
          <span className="fund-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((count / NAMMA_SPOTS.length) * 100)}%` }} />
          </span>
          <p className="app-line app-muted">{count === NAMMA_SPOTS.length ? 'Every one found. Namma ooru, namma spots!' : 'Places worth finding in HSR. Each shows its card the first time you get there.'}</p>
        </section>
        <ul className="spots-grid">
          {NAMMA_SPOTS.map(({ id, name, how, found: said }, index) => (
            <li key={id} data-found={found[id]}>
              <span className="spots-number" aria-hidden="true">{found[id] ? '✓' : index + 1}</span>
              <span className="spots-text">
                <strong>{found[id] ? name : name.replace(/[A-Za-z]/g, (letter, at: number) => (at === 0 ? letter : '·'))}</strong>
                <small>{found[id] ? said : how}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Awards: every achievement, the ones unlocked with their day, the rest with how to earn them. */
function AwardsApp({ nav }: { nav: PhoneNav }) {
  const unlocked = useAchievements((state) => state.unlocked)
  const deliveries = useAchievements((state) => state.deliveries)
  const count = ACHIEVEMENTS.filter(({ id }) => unlocked[id] !== undefined).length
  return (
    <div className="app">
      <AppBar title="Awards" nav={nav} />
      <div className="app-body">
        <section className="app-card">
          <p className="app-card-title">Achievements · {count} of {ACHIEVEMENTS.length}</p>
          <span className="fund-bar" aria-hidden="true">
            <span style={{ width: `${Math.round((count / ACHIEVEMENTS.length) * 100)}%` }} />
          </span>
          <p className="app-line app-muted">{deliveries} order{deliveries === 1 ? '' : 's'} delivered in all.</p>
        </section>
        <ul className="spots-grid">
          {ACHIEVEMENTS.map(({ id, name, how }) => (
            <li key={id} data-found={unlocked[id] !== undefined}>
              <span className="spots-number" aria-hidden="true">{unlocked[id] !== undefined ? '★' : '·'}</span>
              <span className="spots-text">
                <strong>{name}</strong>
                <small>{unlocked[id] !== undefined ? `Unlocked on day ${unlocked[id]}. ${how}` : how}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Settings: controls, picture, sound, language, the tutorial. */
function SettingsApp({ nav }: { nav: PhoneNav }) {
  const musicOn = useGameStore((state) => state.musicOn)
  const hornsOn = useGameStore((state) => state.hornsOn)
  const setMusic = useGameStore((state) => state.setMusicOn)
  const setHorns = useGameStore((state) => state.setHornsOn)
  return (
    <div className="app">
      <AppBar title="Settings" nav={nav} />
      <div className="app-body phone-settings">
        <section className="app-card">
          <p className="app-card-title">Controls</p>
          <ControlsList />
        </section>
        <section className="app-card">
          <p className="app-card-title">Picture</p>
          <QualityPicker className="phone-quality" />
        </section>
        <section className="app-card">
          <p className="app-card-title">Sound</p>
          <label className="phone-switch">
            <input type="checkbox" checked={musicOn} onChange={(event) => { setMusic(event.target.checked); event.currentTarget.blur() }} />
            Music
          </label>
          <label className="phone-switch">
            <input type="checkbox" checked={hornsOn} onChange={(event) => { setHorns(event.target.checked); event.currentTarget.blur() }} />
            Sound effects
          </label>
        </section>
        <section className="app-card">
          <p className="app-card-title">Language</p>
          <label className="phone-switch">
            <input type="radio" name="language" defaultChecked /> English (with Ravi's Kannada)
          </label>
          <label className="phone-switch app-muted">
            <input type="radio" name="language" disabled /> ಕನ್ನಡ Kannada · coming later
          </label>
        </section>
        <SettingsExtras />
        {DEBUG_SAVE && <DebugPanel />}
      </div>
    </div>
  )
}

/** Every app, by id. */
export function PhoneApp({ app, nav }: { app: AppId; nav: PhoneNav }) {
  switch (app) {
    case 'deliver':
      return <DeliverItApp nav={nav} />
    case 'messages':
      return <MessagesApp nav={nav} />
    case 'maps':
      return <MapsApp nav={nav} />
    case 'music':
      return <MusicApp nav={nav} />
    case 'wallet':
      return <WalletApp nav={nav} />
    case 'garage':
      return <GarageApp nav={nav} />
    case 'camera':
      return <CameraApp nav={nav} />
    case 'gaadigo':
      return <GaadiGoApp nav={nav} />
    case 'spots':
      return <SpotsApp nav={nav} />
    case 'awards':
      return <AwardsApp nav={nav} />
    case 'settings':
      return <SettingsApp nav={nav} />
  }
}

/** The keys, each changeable: click, then press the new key. */
function ControlsList() {
  return <KeyList editable />
}

/** The tutorial, to play again. */
function SettingsExtras() {
  const running = useTutorial((state) => state.step !== null)
  return (
    <>
      <section className="app-card">
        <p className="app-card-title">Tutorial</p>
        <button type="button" className="app-wide-button" disabled={running} onClick={(event) => { useTutorial.getState().start(); event.currentTarget.blur() }}>
          {running ? 'Tutorial running' : 'Replay the tutorial'}
        </button>
      </section>
      <section className="app-card app-credits">
        <p className="app-card-title">Map and model credits</p>
        <p>
          <FullCredits />
        </p>
      </section>
    </>
  )
}
