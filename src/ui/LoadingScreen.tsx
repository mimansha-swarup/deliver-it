import { GAME_NAME_KANNADA, TAGLINE } from '../game/brand'
import { Logo } from './Logo'
import { markLoad } from '../dev/loadTimeline'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useGameStore } from '../game/gameStore'
import { useLaunch, WORLD_PART_COUNT, WORLD_PARTS } from '../game/launch'

/** The longest the ride waits for the squares round the rider, once every part is on screen, in milliseconds. */
const NEAR_WAIT_MS = 4000

/**
 * The pictures behind: the title screen's own three, in the same order and each filling the screen,
 * so going from the menu to here the picture stays and only the buttons change. `x` and `y` pick
 * which part of the shot shows on a narrow window, and `pan` which way it drifts.
 */
const SCENES = [
  { layout: 'agara', panels: [{ src: '/title/agara-hanuman-evening.jpg', x: 48, y: 40, pan: 'in' }] },
  { layout: 'trees', panels: [{ src: '/title/tree-tunnel.jpg', x: 55, y: 55, pan: 'left' }] },
  { layout: 'night', panels: [{ src: '/title/night-ride.jpg', x: 55, y: 55, pan: 'right' }] },
] as const

/** Each scene stays this long, in seconds. Kept in step with the CSS. */
const SCENE_SECONDS = 9

const TIPS = [
  'Hold Space while you turn to drift. Let go to get a boost.',
  'P brings up your phone: orders, messages from home, the map and your wallet.',
  'Stuck somewhere? Esc pauses, and Unstuck puts you back on the nearest road.',
  'Slow down for speed breakers. The parcel feels every one of them.',
  'F gets you off the scooter. Flats and the dark store are walked into.',
  "The streets, buildings and parks are HSR Layout's own, mapped by OpenStreetMap volunteers.",
]
/** Each tip stays this long, in seconds. Kept in step with the CSS. */
const TIP_SECONDS = 7

/** How long Play waits for the pictures before showing the screen anyway, in milliseconds. */
const PICTURE_WAIT = 1500

function megabytes(kb: number): string {
  return (kb / 1024).toFixed(1)
}

function Bar({ share, busy = false }: { share: number; busy?: boolean }) {
  return (
    <span className="loading-bar" data-busy={busy} aria-hidden="true">
      <span style={{ transform: `scaleX(${share})` }} />
    </span>
  )
}

/**
 * Between the menu and riding: the title's pictures filling the screen and drifting, the logo
 * where the title has it, tips underneath and a spinner. It shows the download, if it hasn't finished, and
 * the city being built, side by side, and starts the ride once both are done.
 *
 * Building the city keeps the page busy for seconds at a time, and nothing
 * written in JavaScript can move then. Everything that moves here is a CSS
 * animation of position or opacity, which the browser runs on its own, so the
 * pictures keep drifting and the spinner keeps turning.
 */
export function LoadingScreen({ onGone }: { onGone: () => void }) {
  const loading = useGameStore((state) => state.loading)
  const started = useGameStore((state) => state.started)
  // Orders come once online; what's needed now is the planner that will make them.
  const missionReady = useGameStore((state) => state.planner !== null)
  const startGame = useGameStore((state) => state.startGame)
  const planned = useLaunch((state) => state.planned)
  const built = useLaunch((state) => state.built)
  const root = useRef<HTMLElement>(null)

  // Once the pictures are ready and painted, the city may start building.
  useEffect(() => {
    let live = true
    const images = [...(root.current?.querySelectorAll('img') ?? [])]
    const pictures = Promise.all(images.map((image) => image.decode().catch(() => {})))
    const enough = new Promise((resolve) => window.setTimeout(resolve, PICTURE_WAIT))
    void Promise.race([pictures, enough]).then(() => {
      // Two frames on, the screen has certainly been drawn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (live) useLaunch.setState({ curtainDrawn: true })
        }),
      )
    })
    return () => {
      live = false
    }
  }, [])

  // The squares right round the rider too, but never for longer than NEAR_WAIT_MS.
  const nearWaiting = useLaunch((state) => state.nearWaiting.length > 0)
  const partsBuilt = built.length >= WORLD_PART_COUNT && missionReady
  const [nearGivenUp, setNearGivenUp] = useState(false)
  useEffect(() => {
    if (!partsBuilt) return
    const timer = window.setTimeout(() => setNearGivenUp(true), NEAR_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [partsBuilt])
  const warmed = useLaunch((state) => state.warmed)
  const allBuilt = partsBuilt && (!nearWaiting || nearGivenUp) && warmed

  // Everything is on screen. A few frames more let the first pictures be drawn
  // (which is when the GPU prepares each material), then the ride starts.
  useEffect(() => {
    if (!allBuilt || started) return
    let frames = 0
    let id = requestAnimationFrame(function wait() {
      frames++
      if (frames < 4) id = requestAnimationFrame(wait)
      else {
        markLoad('ride starts')
        startGame()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [allBuilt, started, startGame])

  // The fade is a CSS transition. If it doesn't run, as with reduced motion, this ends it anyway.
  useEffect(() => {
    if (!started) return
    const timer = window.setTimeout(onGone, 900)
    return () => window.clearTimeout(timer)
  }, [started, onGone])

  const failed = loading.stage === 'error'
  const downloaded = loading.stage === 'downloaded'
  const downloadShare = downloaded ? 1 : loading.loadedKb / loading.totalKb
  const latest = built.at(-1)

  let buildLabel: string
  let buildShare: number
  if (!loading.mapReady) {
    buildLabel = 'Waiting for the map'
    buildShare = 0
  } else if (!planned) {
    buildLabel = 'Laying out the streets'
    buildShare = 0.04
  } else if (!allBuilt) {
    buildLabel = latest ? `Built: ${WORLD_PARTS[latest].toLowerCase()}` : 'Putting up the city'
    buildShare = 0.1 + 0.9 * (built.length / WORLD_PART_COUNT)
  } else {
    buildLabel = 'Ready'
    buildShare = 1
  }

  return (
    <main
      ref={root}
      className="loading-screen menu-skin"
      data-leaving={started}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && started) onGone()
      }}
      aria-busy={!started}
    >
      <div className="loading-art" aria-hidden="true">
        {SCENES.map(({ layout, panels }, index) => (
          <div
            key={layout}
            className="loading-scene"
            data-layout={layout}
            style={{ animationDelay: `${index * SCENE_SECONDS}s` } as CSSProperties}
          >
            {panels.map(({ src, x, y, pan }, panel) => (
              <div key={panel} className="loading-panel">
                <img src={src} alt="" data-pan={pan} style={{ objectPosition: `${x}% ${y}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* The brand, where the title screen has it, so it doesn't move between the two. */}
      <header className="title-brand loading-brand">
        <p className="title-logo">
          <Logo />
        </p>
        <p className="title-kannada" lang="kn">
          {GAME_NAME_KANNADA}
        </p>
        <p className="title-lede">{TAGLINE}</p>
      </header>

      <footer className="loading-footer">
        <ul className="loading-tips">
          {TIPS.map((tip, index) => (
            <li key={tip} style={{ animationDelay: `${index * TIP_SECONDS}s` }}>
              <span className="loading-tip-label">Tip</span>
              {tip}
            </li>
          ))}
        </ul>

        <section className="loading-status" role="status" aria-live="polite">
          {failed ? (
            <>
              <p className="loading-line">The download stopped: {loading.error}</p>
              <button type="button" className="loading-retry" onClick={() => window.location.reload()}>
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="loading-line">
                <span className="loading-label">
                  {downloaded
                    ? 'City downloaded'
                    : `Downloading the city ${Math.floor(downloadShare * 100)}%, ${megabytes(loading.loadedKb)} of ${megabytes(loading.totalKb)} MB`}
                </span>
                <Bar share={downloadShare} />
              </div>
              <div className="loading-line">
                <span className="loading-label">{buildLabel}</span>
                <Bar share={buildShare} busy={loading.mapReady && !planned} />
              </div>
              <p className="loading-spinner-row">
                <span className="loading-spinner" aria-hidden="true" />
                {allBuilt ? 'Starting' : 'Loading'}
              </p>
            </>
          )}
        </section>
      </footer>
    </main>
  )
}
