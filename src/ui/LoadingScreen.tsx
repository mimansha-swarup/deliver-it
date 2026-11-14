import { useEffect, useRef, type CSSProperties } from 'react'
import { useGameStore } from '../game/gameStore'
import { useLaunch, WORLD_PART_COUNT, WORLD_PARTS } from '../game/launch'

/**
 * The pictures, laid out as panels. Each scene is a few crops of the game's own
 * screenshots, and the scenes take turns. `x` and `y` pick which part of the
 * shot the panel shows, and `pan` which way it drifts.
 */
const SCENES = [
  {
    layout: 'feature',
    panels: [
      { src: '/title/jacaranda-street.jpg', x: 50, y: 60, pan: 'left' },
      { src: '/title/riding-out.jpg', x: 72, y: 20, pan: 'up' },
      { src: '/title/night-rain.jpg', x: 72, y: 55, pan: 'right' },
    ],
  },
  {
    layout: 'banner',
    panels: [
      { src: '/title/riding-out.jpg', x: 50, y: 55, pan: 'in' },
      { src: '/title/night-rain.jpg', x: 45, y: 50, pan: 'right' },
      { src: '/title/jacaranda-street.jpg', x: 95, y: 15, pan: 'left' },
    ],
  },
  {
    layout: 'full',
    panels: [{ src: '/title/night-rain.jpg', x: 55, y: 50, pan: 'in' }],
  },
] as const

/** Each scene stays this long, in seconds. Kept in step with the CSS. */
const SCENE_SECONDS = 9

const TIPS = [
  'Hold Space while you turn to drift. Let go to get a boost.',
  'Press P for your phone: the route, the next stop and what you have earned.',
  'Every delivery pays its base reward, however the ride goes.',
  'R changes the radio station, and H sounds the horn.',
  'N skips ahead in time, and M changes the weather.',
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
 * Between Play and riding: the game's screenshots in panels, drifting, with tips
 * underneath and a spinner. It shows the download, if it hasn't finished, and
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
  const missionReady = useGameStore((state) => state.mission !== null)
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

  const allBuilt = built.length >= WORLD_PART_COUNT && missionReady

  // Everything is on screen. A few frames more let the first pictures be drawn
  // (which is when the GPU prepares each material), then the ride starts.
  useEffect(() => {
    if (!allBuilt || started) return
    let frames = 0
    let id = requestAnimationFrame(function wait() {
      frames++
      if (frames < 4) id = requestAnimationFrame(wait)
      else startGame()
    })
    return () => cancelAnimationFrame(id)
  }, [allBuilt, started, startGame])

  // The fade is a CSS transition. If it doesn't run, as with reduced motion, this ends it anyway.
  useEffect(() => {
    if (!started) return
    const timer = window.setTimeout(onGone, 1400)
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
      className="loading-screen"
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

      <p className="loading-wordmark">Deliver It</p>

      <footer className="loading-footer">
        <ul className="loading-tips">
          {TIPS.map((tip, index) => (
            <li key={tip} style={{ animationDelay: `${index * TIP_SECONDS}s` }}>
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
