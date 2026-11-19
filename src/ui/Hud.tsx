import { useEffect, useState } from 'react'
import { VEHICLES } from '../vehicle/vehicleCatalog'
import { useGameStore } from '../game/gameStore'
import type { Reward } from '../game/gameTypes'
import { averageRating } from '../missions/orderStory'
import { SCOOTER } from '../vehicle/vehicleConfig'
import { energyOf, fuelLevel, serviceState, UPKEEP, useUpkeep } from '../game/upkeep'

/** How long the bump warning stays up, in milliseconds. */
const KNOCK_NOTICE_TIME = 1600

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** Says so plainly. With an order on board, says it's safe too, as it always survives. */
function CrashNotice() {
  const crashed = useGameStore((state) => state.crashed)
  const carrying = useGameStore((state) => state.phase === 'toCustomer')
  if (!crashed) return null

  return (
    <p className="hud-crash" role="status">
      Crash! {carrying && <span>Package is safe</span>}
    </p>
  )
}

/** A fragile order on board, and a hard landing: the customer will notice. */
function KnockNotice() {
  const knocks = useGameStore((state) => state.knocks)
  const story = useGameStore((state) => state.mission?.story)
  const [shownFor, setShownFor] = useState(0)

  useEffect(() => {
    if (knocks === 0) return
    const timer = window.setTimeout(() => setShownFor(knocks), KNOCK_NOTICE_TIME)
    return () => window.clearTimeout(timer)
  }, [knocks])

  if (knocks === 0 || shownFor === knocks || story?.care !== 'fragile') return null
  return (
    <p className="hud-knock" role="status">
      Bump! <span>Go gently with the {story.item.replace(/^(A|An|Two) /, '').toLowerCase()}</span>
    </p>
  )
}

/** Stars out of five, filled and empty. */
export function Stars({ stars }: { stars: number }) {
  return (
    <span className="stars" aria-label={`${stars} out of 5 stars`}>
      {'★'.repeat(stars)}
      <span className="stars-empty">{'★'.repeat(5 - stars)}</span>
    </span>
  )
}

/** The customer's rating and what they said, and why any stars were lost. */
function CustomerRating({ reward }: { reward: Reward }) {
  const streak = useGameStore((state) => state.fiveStarStreak)
  return (
    <div className="hud-rating">
      <Stars stars={reward.stars} />
      <blockquote>
        “{reward.reaction}” <cite>{reward.customer}</cite>
      </blockquote>
      {reward.starsLost.length > 0 && <p className="hud-stars-lost">{reward.starsLost.join(' · ')}</p>}
      {reward.stars === 5 && streak > 1 && <p className="hud-streak">{streak} five-star deliveries in a row</p>}
    </div>
  )
}

/** The rider's average over recent deliveries. */
function RiderRating() {
  const ratings = useGameStore((state) => state.ratings)
  const average = averageRating(ratings)
  if (average === null) return null
  return (
    <p className="hud-rider-rating">
      Your rating <strong>★ {average.toFixed(1)}</strong> <span>last {ratings.length}</span>
    </p>
  )
}

/** Says what's happening while the rider is held still. */
function HandoffNotice() {
  const phase = useGameStore((state) => state.phase)
  if (phase !== 'collecting' && phase !== 'handingOver') return null

  return (
    <p className="hud-handoff" role="status">
      {phase === 'collecting' ? 'Collecting the order' : 'Handing over the order'}
    </p>
  )
}

/** The nitro tank. It's dim until there's enough to start a burst. */
function NitroGauge({ nitro, burning }: { nitro: number; burning: boolean }) {
  const ready = nitro >= SCOOTER.nitroMinToStart
  return (
    <div className="hud-nitro-gauge" data-ready={ready} data-burning={burning} title="Nitro: hold Shift">
      <span className="hud-nitro-key">Shift</span>
      <span className="hud-nitro-bar">
        <span style={{ width: `${Math.round(nitro * 100)}%` }} />
      </span>
    </div>
  )
}

/** The tank or the battery, for anything that has one: how full, and a word when it's filling or low. */
function FuelGauge() {
  const spec = VEHICLES[useGameStore((state) => state.vehicleId)] ?? VEHICLES.scooter
  const level = useUpkeep((state) => fuelLevel(state.fuel, spec.id))
  const filling = useUpkeep((state) => state.filling?.id === spec.id)
  const service = useUpkeep((state) => serviceState(state.sinceService[spec.id] ?? 0))
  const energy = energyOf(spec)
  if (energy === 'none') return service === 'ok' ? null : <p className="hud-fuel-note" data-state={service}>Service {service}</p>
  const percent = Math.round(level * 100)
  return (
    <div className="hud-fuel" data-low={level < UPKEEP.lowAt} data-filling={filling} title={energy === 'charge' ? 'Battery: charge at a bunk\'s EV charger, or overnight at home' : 'Fuel: fill up at any petrol bunk'}>
      <span className="hud-fuel-label">{energy === 'charge' ? 'Battery' : spec.drive.startsWith('Diesel') ? 'Diesel' : 'Petrol'}</span>
      <span className="hud-fuel-bar">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="hud-fuel-value">{filling ? (energy === 'charge' ? 'Charging' : 'Filling') : level <= 0 ? 'Empty' : `${percent}%`}</span>
      {service !== 'ok' && <span className="hud-fuel-note" data-state={service}>Service {service}</span>}
    </div>
  )
}

function Speedometer() {
  const speedKmh = useGameStore((state) => state.speedKmh)
  const drifting = useGameStore((state) => state.drifting)
  const boosting = useGameStore((state) => state.boosting)
  const nitro = useGameStore((state) => state.nitro)
  const nitroOn = useGameStore((state) => state.nitroOn)
  const atBunk = useGameStore((state) => state.atBunk)
  // The vehicle in use: its name, how it's driven, and the speed as a share of its own top speed.
  const spec = VEHICLES[useGameStore((state) => state.vehicleId)] ?? VEHICLES.scooter
  const share = Math.min(1, speedKmh / spec.topSpeed)

  return (
    <section className="hud-card hud-speed" data-vehicle={spec.id}>
      {atBunk && spec.feel.nitro && (
        <p className="hud-refill" role="status">
          {nitro >= 1 ? 'Nitro full' : `Filling nitro · ${atBunk}`}
        </p>
      )}
      {nitroOn && <p className="hud-nitro">Nitro</p>}
      {boosting && !nitroOn && <p className="hud-boost">Boost</p>}
      {drifting && !boosting && !nitroOn && <p className="hud-drift">Drift</p>}
      <span className="hud-speed-value">{speedKmh}</span> km/h
      <span className="hud-speed-scale" aria-hidden="true">
        <span className="hud-speed-scale-fill" style={{ width: `${share * 100}%` }} />
      </span>
      <p className="hud-speed-vehicle">{spec.name} · {spec.drive} · top {spec.topSpeed}</p>
      <FuelGauge />
      {spec.feel.nitro && <NitroGauge nitro={nitro} burning={nitroOn} />}
    </section>
  )
}

/** Says what the new level opens up. */
function LevelUp() {
  const levelUp = useGameStore((state) => state.lastLevelUp)
  if (!levelUp) return null

  return (
    <div className="hud-level-up" role="status">
      <strong>Level up! You're level {levelUp.level}</strong>
      {levelUp.unlocks.length > 0 && (
        <ul>
          {levelUp.unlocks.map((unlock) => (
            <li key={unlock}>{unlock}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DeliveryComplete() {
  const reward = useGameStore((state) => state.lastReward)
  const nextMission = useGameStore((state) => state.nextMission)
  const goingOffline = useGameStore((state) => state.offlineAfterOrder)

  if (!reward) return null
  const title = reward.kind === 'double' ? 'Both orders delivered' : 'Order delivered'

  return (
    <section className="hud-card hud-results">
      <h1>{title}</h1>
      <p className="hud-detail">Delivered in {formatTime(Math.floor(reward.seconds))}</p>
      <CustomerRating reward={reward} />
      <LevelUp />
      <dl>
        <dt>{reward.kind === 'double' ? 'Delivery reward × 2' : 'Delivery reward'}</dt>
        <dd>+{reward.baseCredits} credits</dd>
        {reward.distanceCredits > 0 && (
          <>
            <dt>Distance bonus</dt>
            <dd>+{reward.distanceCredits} credits</dd>
          </>
        )}
        <dt>{reward.kind === 'rush' ? 'Rush bonus' : 'On-time bonus'}</dt>
        <dd>{reward.onTime ? `+${reward.onTimeCredits} credits` : 'Missed'}</dd>
        {reward.peakCredits > 0 && (
          <>
            <dt>{reward.peakLabel}</dt>
            <dd>+{reward.peakCredits} credits</dd>
          </>
        )}
        {reward.nightCredits > 0 && (
          <>
            <dt>Night shift</dt>
            <dd>+{reward.nightCredits} credits</dd>
          </>
        )}
        <dt>Clean ride</dt>
        <dd>
          {reward.crashes === 0
            ? `+${reward.cleanRideCredits} credits`
            : `${reward.crashes} crash${reward.crashes > 1 ? 'es' : ''}`}
        </dd>
        <dt>Tip from {reward.customer}</dt>
        <dd>{reward.tipCredits > 0 ? `+${reward.tipCredits} credits` : 'No tip'}</dd>
        <dt>Experience</dt>
        <dd>+{reward.xp} XP</dd>
      </dl>
      <RiderRating />
      <button type="button" autoFocus onClick={nextMission}>
        {goingOffline ? 'Go offline' : 'Back to orders'}
      </button>
    </section>
  )
}

export function Hud() {
  return (
    <>
      <Speedometer />
      <CrashNotice />
      <KnockNotice />
      <HandoffNotice />
      <DeliveryComplete />
    </>
  )
}
