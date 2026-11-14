import { Fragment, useEffect, useState } from 'react'
import { unlockAudio } from '../audio/audioEngine'
import { useGameStore } from '../game/gameStore'
import { useLaunch } from '../game/launch'
import { levelFromXp } from '../game/progression'
import { QualityPicker } from './QualityPicker'

const KEYBOARD_CONTROLS = [
  ['W A S D or arrows', 'Ride'],
  ['S or down', 'Brake'],
  ['Hold Space and steer', 'Drift, then let go to boost'],
  ['P', 'Bring up your phone'],
  ['H', 'Honk'],
  ['R', 'Change radio station'],
]

/** Screenshots from the game itself, shown one after another behind the title. */
const SCREENSHOTS = [
  { src: '/title/night-rain.jpg', caption: 'After dark, in the rain' },
  { src: '/title/jacaranda-street.jpg', caption: 'Jacaranda season' },
  { src: '/title/riding-out.jpg', caption: 'Out on a delivery' },
]
/** How long each screenshot stays, in milliseconds. */
const SCREENSHOT_TIME = 7000

function megabytes(kb: number): string {
  return (kb / 1024).toFixed(1)
}

/** The wordmark's underline: a stretch of road, dashed down the middle, curving up at the end. */
function RoadUnderline() {
  return (
    <svg className="title-road" viewBox="0 0 400 34" aria-hidden="true" preserveAspectRatio="none">
      <path d="M6 24 C 120 30, 260 30, 394 8" className="title-road-surface" />
      <path d="M6 24 C 120 30, 260 30, 394 8" className="title-road-lines" />
    </svg>
  )
}

/**
 * The title screen: screenshots from the game behind, the name, and a Play
 * button that works straight away. The game downloads in the background from
 * the moment the page opens, and the line under the button shows how far it's
 * got. Play brings up the loading screen, which builds the city.
 */
export function TitleScreen() {
  const loading = useGameStore((state) => state.loading)
  const credits = useGameStore((state) => state.credits)
  const xp = useGameStore((state) => state.xp)
  const [shown, setShown] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)

  const play = () => {
    // Sound is only allowed after a click or key press, and this is one.
    unlockAudio()
    useLaunch.setState({ requested: true })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setShown((index) => (index + 1) % SCREENSHOTS.length), SCREENSHOT_TIME)
    return () => window.clearInterval(timer)
  }, [])

  const failed = loading.stage === 'error'

  // Enter plays from anywhere on the page.
  useEffect(() => {
    if (failed) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.repeat && !helpOpen) play()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  const downloaded = loading.stage === 'downloaded'
  const percent = Math.floor((loading.loadedKb / loading.totalKb) * 100)

  return (
    <main className="title-screen">
      <div className="title-backdrop" aria-hidden="true">
        {SCREENSHOTS.map(({ src }, index) => (
          <img key={src} src={src} alt="" data-shown={index === shown} loading={index === 0 ? 'eager' : 'lazy'} />
        ))}
      </div>
      <p className="title-caption">
        <span aria-hidden="true" />
        In-game screenshot: {SCREENSHOTS[shown].caption.toLowerCase()}
      </p>

      <header className="title-top">
        {credits + xp > 0 && (
          <p className="title-welcome">
            Welcome back. Level {levelFromXp(xp)}, {credits} credits
          </p>
        )}
        <QualityPicker className="title-quality" />
      </header>

      <section className="title-main">
        <h1 className="title-wordmark">
          Deliver It
          <RoadUnderline />
        </h1>
        <p className="title-kannada" lang="kn">
          ಡೆಲಿವರ್ ಇಟ್
        </p>
        <p className="title-lede">Ride orders through HSR Layout, Bengaluru.</p>

        <div className="title-actions">
          {failed ? (
            <button type="button" className="title-start" onClick={() => window.location.reload()}>
              Download failed. Try again
            </button>
          ) : (
            <button type="button" className="title-start" data-ready="true" onClick={play}>
              <span className="title-start-label">Play</span>
              <kbd>Enter</kbd>
            </button>
          )}
          <button
            type="button"
            className="title-help-button"
            aria-expanded={helpOpen}
            onClick={() => setHelpOpen((open) => !open)}
          >
            How to ride
          </button>
        </div>

        {!failed && (
          <div className="title-download" role="status">
            <span className="title-download-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${downloaded ? 1 : loading.loadedKb / loading.totalKb})` }} />
            </span>
            {downloaded
              ? 'City downloaded'
              : `Downloading the city in the background: ${percent}%, ${megabytes(loading.loadedKb)} of ${megabytes(loading.totalKb)} MB`}
          </div>
        )}
        <p className="title-facts">
          {failed ? `The download stopped: ${loading.error}. Check your connection.` : 'Free, and it runs in your browser.'}
        </p>
      </section>

      {helpOpen && (
        <section className="title-help" aria-label="How to ride">
          <dl>
            {KEYBOARD_CONTROLS.map(([control, action]) => (
              <Fragment key={control}>
                <dt>{control}</dt>
                <dd>{action}</dd>
              </Fragment>
            ))}
          </dl>
          <button type="button" onClick={() => setHelpOpen(false)}>
            Close
          </button>
        </section>
      )}

      <p className="title-note">Independent prototype. Not an official product.</p>
    </main>
  )
}
