import { useGameStore } from '../game/gameStore'

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** Says so plainly, as the package always survives. */
function CrashNotice() {
  const crashed = useGameStore((state) => state.crashed)
  if (!crashed) return null

  return (
    <p className="hud-crash" role="status">
      Crash! <span>Package is safe</span>
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

  if (!reward) return null
  const title = reward.kind === 'double' ? 'Both orders delivered' : 'Order delivered'

  return (
    <section className="hud-card hud-results">
      <h1>{title}</h1>
      <p className="hud-detail">Delivered in {formatTime(Math.floor(reward.seconds))}</p>
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
      <Speedometer />
      <CrashNotice />
      <HandoffNotice />
      <DeliveryComplete />
    </>
  )
}
