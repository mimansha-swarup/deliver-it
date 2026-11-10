import { useGameStore } from '../game/gameStore'
import { QualityPicker } from './QualityPicker'

export function TitleScreen() {
  const ready = useGameStore((state) => state.mission !== null)
  const credits = useGameStore((state) => state.credits)
  const xp = useGameStore((state) => state.xp)
  const startGame = useGameStore((state) => state.startGame)

  return (
    <main className="title-screen">
      <div className="title-card">
        <h1>Deliver It</h1>
        <p className="title-subtitle">Ride. Collect. Deliver. Around HSR Layout, Bengaluru.</p>

        <dl className="title-controls">
          <dt>W A S D or arrows</dt>
          <dd>Ride</dd>
          <dt>S or down</dt>
          <dd>Brake</dd>
          <dt>Hold Space and steer</dt>
          <dd>Drift, then let go to boost</dd>
          <dt>P</dt>
          <dd>Bring up your phone</dd>
        </dl>

        <QualityPicker className="quality-title" />

        {credits + xp > 0 && (
          <p className="title-progress">
            Welcome back: {credits} credits, {xp} XP
          </p>
        )}

        {ready ? (
          <button type="button" autoFocus onClick={startGame}>
            Start riding
          </button>
        ) : (
          <p className="title-loading" role="status">
            Loading the neighbourhood…
          </p>
        )}

        <p className="title-note">Independent prototype. Not an official product.</p>
      </div>
    </main>
  )
}
