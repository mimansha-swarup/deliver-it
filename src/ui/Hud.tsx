import { useGameStore } from '../game/gameStore'
import { getCurrentStop } from '../missions/missionLogic'

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function MissionPanel() {
  const phase = useGameStore((state) => state.phase)
  const mission = useGameStore((state) => state.mission)
  const distance = useGameStore((state) => state.distance)
  const seconds = useGameStore((state) => state.seconds)
  const inZone = useGameStore((state) => state.inZone)

  const stop = getCurrentStop(mission, phase)
  if (!stop || !mission) return null

  const timeLeft = mission.onTimeSeconds - seconds

  return (
    <section className="hud-card hud-mission">
      <p className="hud-label" style={{ color: stop.color }}>
        {stop.objective} · {mission.tier.label}
      </p>
      <p className="hud-title">{stop.name}</p>
      <p className="hud-detail">{inZone ? stop.arrivalHint : `${distance} m by road`}</p>
      <p className="hud-detail">
        {timeLeft >= 0 ? `${formatTime(timeLeft)} for on-time bonus` : 'On-time bonus missed'}
      </p>
    </section>
  )
}

function Wallet() {
  const credits = useGameStore((state) => state.credits)
  const xp = useGameStore((state) => state.xp)

  return (
    <section className="hud-card hud-wallet">
      <p>
        <span className="hud-value">{credits}</span> credits
      </p>
      <p>
        <span className="hud-value">{xp}</span> XP
      </p>
    </section>
  )
}

function SkyClock() {
  const clock = useGameStore((state) => state.clock)
  return <section className="hud-card hud-clock">{clock}</section>
}

function Speedometer() {
  const speedKmh = useGameStore((state) => state.speedKmh)
  const drifting = useGameStore((state) => state.drifting)
  const boosting = useGameStore((state) => state.boosting)

  return (
    <section className="hud-card hud-speed">
      {boosting && <p className="hud-boost">Boost</p>}
      {drifting && !boosting && <p className="hud-drift">Drift</p>}
      <span className="hud-speed-value">{speedKmh}</span> km/h
    </section>
  )
}

function DeliveryComplete() {
  const reward = useGameStore((state) => state.lastReward)
  const nextMission = useGameStore((state) => state.nextMission)

  if (!reward) return null

  return (
    <section className="hud-card hud-results">
      <h1>Order delivered</h1>
      <p className="hud-detail">Delivered in {formatTime(Math.floor(reward.seconds))}</p>
      <dl>
        <dt>Delivery reward</dt>
        <dd>+{reward.baseCredits} credits</dd>
        {reward.distanceCredits > 0 && (
          <>
            <dt>Distance bonus</dt>
            <dd>+{reward.distanceCredits} credits</dd>
          </>
        )}
        <dt>On-time bonus</dt>
        <dd>{reward.onTime ? `+${reward.onTimeCredits} credits` : 'Missed'}</dd>
        <dt>Experience</dt>
        <dd>+{reward.xp} XP</dd>
      </dl>
      <button type="button" autoFocus onClick={nextMission}>
        Next delivery
      </button>
    </section>
  )
}

export function Hud() {
  return (
    <>
      <MissionPanel />
      <Wallet />
      <SkyClock />
      <Speedometer />
      <DeliveryComplete />
    </>
  )
}
