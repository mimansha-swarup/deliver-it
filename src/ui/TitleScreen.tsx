import { Fragment } from 'react'
import { useGameStore } from '../game/gameStore'
import { unlockAudio } from '../audio/horns'
import { enterLandscapeFullscreen } from '../game/fullscreen'
import { isTouchDevice } from '../game/touchDevice'
import { QualityPicker } from './QualityPicker'

const KEYBOARD_CONTROLS = [
  ['W A S D or arrows', 'Ride'],
  ['S or down', 'Brake'],
  ['Hold Space and steer', 'Drift, then let go to boost'],
  ['P', 'Bring up your phone'],
  ['H', 'Honk'],
]

const TOUCH_CONTROLS = [
  ['Left thumb', 'Steer'],
  ['Right thumb', 'Gas and brake'],
  ['Hold Drift and steer', 'Drift, then let go to boost'],
  ['Tap the phone', 'Bring it up'],
  ['Horn', 'Honk'],
]

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
          {(isTouchDevice ? TOUCH_CONTROLS : KEYBOARD_CONTROLS).map(([control, action]) => (
            <Fragment key={control}>
              <dt>{control}</dt>
              <dd>{action}</dd>
            </Fragment>
          ))}
        </dl>

        <QualityPicker className="quality-title" />

        {credits + xp > 0 && (
          <p className="title-progress">
            Welcome back: {credits} credits, {xp} XP
          </p>
        )}

        {ready ? (
          <button
            type="button"
            autoFocus
            onClick={() => {
              // Sound is only allowed after a tap or click, and this is one.
              unlockAudio()
              if (isTouchDevice) void enterLandscapeFullscreen()
              startGame()
            }}
          >
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
