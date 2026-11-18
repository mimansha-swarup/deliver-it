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
import { DISPATCHER } from '../game/career'
import { setMapOpen } from './uiState'
import { RAVI_THREAD, type AppId, type PhoneNav } from './phoneAppList'

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
          {care !== 'none' && <p className="phone-care-hint">{CARE_HINTS[care]}</p>}
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
        {duty === 'off' ? 'Ride anywhere. Go online for orders.' : offer ? 'Y to accept · X to decline' : `${period.label}: ${period.payShare > 0 ? `+${Math.round(period.payShare * 100)}% pay` : 'normal pay'}`}
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
        {duty === 'off' ? 'Go online · O' : 'Go offline · O'}
      </button>
      {raised && (
        <>
          <p className="phone-order-line">
            Acceptance {rate === null ? '—' : `${Math.round(rate * 100)}%`}
            {duty === 'off' && ' · Sleep at home (Z) to end the day'}
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
      <button type="button" onClick={(event) => { nav.go('home'); event.currentTarget.blur() }} aria-label="Back to the home screen">
        ‹
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
  const customers = [...new Set(chat.filter((line) => line.from === 'customer').map((line) => line.name))].reverse()
  const threads = [RAVI_THREAD, ...customers]

  if (nav.thread) {
    const lines =
      nav.thread === RAVI_THREAD
        ? [...messages].slice(0, 15).reverse().map((message) => ({ id: message.id, text: message.text, urgent: false, mine: false }))
        : chat.filter((line) => line.from === 'customer' && line.name === nav.thread).map((line) => ({ id: line.id, text: line.text, urgent: !!line.urgent, mine: false }))
    return (
      <div className="app">
        <header className="app-bar">
          <button type="button" onClick={(event) => { nav.go('messages'); event.currentTarget.blur() }} aria-label="Back to the threads">
            ‹
          </button>
          <h2>{nav.thread === RAVI_THREAD ? DISPATCHER : nav.thread}</h2>
        </header>
        <ol className="app-body phone-chat-thread app-thread">
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
            thread === RAVI_THREAD ? messages[0]?.text : [...chat].reverse().find((line) => line.from === 'customer' && line.name === thread)?.text
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
          Open the full map · Tab
        </button>
        <section className="app-card">
          <p className="app-card-title">Saved places {hasOrder && <small>· routes are off during an order</small>}</p>
          <ul className="app-list">
            {places.map((place, index) => (
              <li key={`${place.kind}-${index}`}>
                <button type="button" disabled={hasOrder} onClick={() => goTo(place.x, place.z)}>
                  <span>
                    {place.name}
                    <small>{place.kind === 'home' ? 'Sleep here (Z)' : place.kind === 'store' ? 'Pickups and the Garage' : 'Chai break'}</small>
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

function MusicApp({ nav }: { nav: PhoneNav }) {
  return (
    <div className="app">
      <AppBar title="Radio" nav={nav} />
      <div className="app-body">
        <section className="phone-sheet phone-music">
          <RadioControls />
        </section>
        <p className="app-line app-muted">R changes station while riding.</p>
      </div>
    </div>
  )
}

/** Wallet: the balance, and today's money in and out. */
function WalletApp({ nav }: { nav: PhoneNav }) {
  const credits = useGameStore((state) => state.credits)
  const ledger = useGameStore((state) => state.ledger)
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

/** Garage: anywhere to look; buying only stopped at the dark store. */
function GarageApp({ nav }: { nav: PhoneNav }) {
  const atStore = useGameStore((state) => state.atStore)
  return (
    <div className="app">
      <AppBar title="Garage" nav={nav} />
      <div className="app-body">
        {!atStore && <p className="app-note">Looking only: stop at the dark store to buy.</p>}
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
    case 'settings':
      return <SettingsApp nav={nav} />
  }
}

/** The keys, as a list (Entry 151 makes them changeable). */
function ControlsList() {
  return (
    <p className="phone-keys">W A S D ride · Space drift · Shift nitro · O online · Y / X answer an offer · Tab map · P phone · H horn · R radio · Z sleep at home · N skip time · M weather</p>
  )
}

/** More settings: the tutorial (Entry 150). */
function SettingsExtras() {
  return null
}
