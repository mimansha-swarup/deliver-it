import { Suspense, useEffect, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import type { Mission, MissionPhase, OrderKind } from '../game/gameTypes'
import { levelFromXp, levelProgress, UNLOCK_LEVELS } from '../game/progression'
import { MISSION_RULES } from '../game/missionConfig'
import { getCurrentStop } from '../missions/missionLogic'
import { WEATHERS, type WeatherName } from '../sky/skyLogic'
import { CareerSheet, TodaySheet } from './CareerSheets'
import { Garage } from './Garage'
import { PhoneMap } from './PhoneMap'
import { useStation } from '../audio/useStation'
import { RadioControls, VideoScreen } from './Radio'

const PHONE_KEY = 'KeyP'
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
function WeatherIcon({ weather, night }: { weather: WeatherName; night: boolean }) {
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

function StatusBar() {
  const skyTime = useGameStore((state) => state.skyTime)
  const weather = useGameStore((state) => state.weather)
  const night = useGameStore((state) => state.night)

  return (
    <header className="phone-status">
      <span className="phone-time">{skyTime}</span>
      <span className="phone-camera" aria-hidden="true" />
      <span className="phone-weather">
        <WeatherIcon weather={weather} night={night} />
        {WEATHERS[weather].label}
      </span>
    </header>
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

  return (
    <>
      <dl className="phone-pay">
        <dt>This order</dt>
        <dd>{guaranteed} credits</dd>
        <dt>{mission.kind === 'rush' ? 'Rush bonus' : 'On-time bonus'}</dt>
        <dd>+{onTimeBonus}</dd>
        <dt>Clean ride bonus</dt>
        <dd>{crashes === 0 ? `+${rules.cleanRideCredits}` : 'Missed'}</dd>
        {nightUnlocked && (
          <>
            <dt>Night shift</dt>
            <dd>{night ? `+${Math.round(rules.nightPayShare * 100)}%` : 'After dark'}</dd>
          </>
        )}
      </dl>
      <p className="phone-wallet">
        <span>{credits} credits</span>
      </p>
      <LevelBar />
    </>
  )
}

type PhoneTab = 'order' | 'career' | 'today'

const PHONE_TABS: { id: PhoneTab; label: string }[] = [
  { id: 'order', label: 'Order' },
  { id: 'career', label: 'Career' },
  { id: 'today', label: 'Today' },
]

/** The raised phone's three screens. A dot shows when today's shift isn't finished. */
function PhoneTabs({ tab, setTab }: { tab: PhoneTab; setTab: (tab: PhoneTab) => void }) {
  const dailyOpen = useGameStore((state) => state.daily !== null && !state.daily.done)
  return (
    <div className="phone-tabs" role="tablist">
      {PHONE_TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={(event) => {
            setTab(id)
            event.currentTarget.blur()
          }}
        >
          {label}
          {id === 'today' && dailyOpen && <span className="phone-tab-dot" aria-label="Goals left today" />}
        </button>
      ))}
    </div>
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

function OrderSheet({ raised, onOpenGarage }: { raised: boolean; onOpenGarage: () => void }) {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const missionNumber = useGameStore((state) => state.missionNumber)
  const distance = useGameStore((state) => state.distance)
  const inZone = useGameStore((state) => state.inZone)

  const stop = getCurrentStop(mission, phase)

  if (!mission || !stop) {
    return (
      <section className="phone-sheet">
        <p className="phone-objective">{SHEET_MESSAGES[phase] ?? 'Finding an order'}</p>
        {raised && <GarageButton onOpen={onOpenGarage} />}
      </section>
    )
  }

  return (
    <section className="phone-sheet">
      <p className="phone-sheet-top">
        <span className="phone-objective" style={{ color: stop.color }}>
          {phase === 'toPickup' ? 'Pick up' : 'Drop off'}
          {phase !== 'toPickup' &&
            mission.dropCount > 1 &&
            ` ${mission.dropCount - mission.nextDrops.length}/${mission.dropCount}`}
          {mission.kind === 'rush' && <span className="phone-rush">Rush</span>}
        </span>
        <Timer />
      </p>
      <p className="phone-stop">{stop.name}</p>
      <p className="phone-distance">{inZone ? stop.arrivalHint : `${distance} m by road`}</p>

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

/**
 * The rider's phone, which holds the map, the order, the time and the weather.
 * Press P to bring it up. The game keeps running, so looking at it has a cost.
 */
export function Phone() {
  const [raised, setRaised] = useState(false)
  const [garageWanted, setGarageWanted] = useState(false)
  const [tab, setTab] = useState<PhoneTab>('order')
  const atStore = useGameStore((state) => state.atStore)
  // The Garage shows only on the raised phone at the dark store, so riding off or putting the phone away closes it.
  const garageOpen = garageWanted && raised && atStore

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== PHONE_KEY || event.repeat) return
      setRaised((value) => !value)
      setGarageWanted(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const station = useStation()
  // The video has its own card just above the phone, so the map is never covered.
  const videoCard = station.kind === 'video'
  const videoAbove = videoCard
  const classes = ['phone', raised && 'phone-raised', videoAbove && 'phone-video-above'].filter(Boolean)

  return (
    <>
      <aside className={classes.join(' ')} aria-label="Rider phone">
        <div className="phone-screen">
          <Suspense fallback={null}>
            <PhoneMap raised={raised} />
          </Suspense>
          <StatusBar />
          <div className="phone-lower">
            {raised && !garageOpen && <PhoneTabs tab={tab} setTab={setTab} />}
            {garageOpen ? (
              <Garage onClose={() => setGarageWanted(false)} />
            ) : raised && tab === 'career' ? (
              <CareerSheet />
            ) : raised && tab === 'today' ? (
              <TodaySheet />
            ) : (
              <OrderSheet raised={raised} onOpenGarage={() => setGarageWanted(true)} />
            )}
          </div>
          {raised && <RadioControls />}
          <button
            type="button"
            className="phone-toggle"
            aria-expanded={raised}
            onClick={(event) => {
              setRaised((value) => !value)
              setGarageWanted(false)
              // Gives the keyboard back to the game, so Space doesn't press this button.
              event.currentTarget.blur()
            }}
          >
            {raised ? 'Put away · P' : 'Open · P'}
          </button>
        </div>
      </aside>
      {videoCard && (
        <aside className={raised ? 'music-card music-card-raised' : 'music-card'} aria-label="Music video">
          <VideoScreen station={station} className="music-card-player" />
        </aside>
      )}
    </>
  )
}
