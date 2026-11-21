import { markLoad } from '../dev/loadTimeline'
import { track } from '../analytics'
import { useEffect, useState } from 'react'
import { unlockAudio } from '../audio/audioEngine'
import { GAME_NAME_KANNADA, NOW_RIDING, TAGLINE } from '../game/brand'
import { averageRating } from '../game/fleet'
import { useGameStore } from '../game/gameStore'
import { useLaunch } from '../game/launch'
import { levelFromXp } from '../game/progression'
import { tutorialHold, useTutorial } from '../game/tutorial'
import { invitedTo, ROOM } from '../net/room'
import { FriendsPanel } from './RoomUi'
import { FeedbackPanel } from './Feedback'
import { Logo } from './Logo'
import { ControlsPanel, CreditsPanel, MenuFooter, MenuList, SettingsPanel, type MenuItem } from './Menu'
import { useT } from './menuText'
import { StoryOpening } from './StoryOpening'

/**
 * Pictures taken in the game itself, cross-fading behind the title, each drifting slowly so the
 * screen is never still. They're pictures and not the live city so that the title is up at once:
 * the city is built after a mode is chosen, behind the loading screen (see VISION.md's 8 seconds).
 */
const BACKDROPS = [
  { src: '/title/agara-hanuman-evening.jpg', caption: 'the Anjaneya statue and temple at Agara' },
  { src: '/title/tree-tunnel.jpg', caption: 'under the trees on 13th Cross' },
  { src: '/title/night-ride.jpg', caption: 'a night ride past the shops' },
]
/** How long each picture stays, in milliseconds. */
const BACKDROP_TIME = 8000

type View = 'menu' | 'story' | 'settings' | 'controls' | 'credits' | 'friends' | 'feedback'

function megabytes(kb: number): string {
  return (kb / 1024).toFixed(1)
}

/**
 * The main menu: the game's pictures behind, the logo with its Kannada name and tagline top left,
 * and the buttons under it. Continue (with the day, level, wallet and rating) for a rider with
 * progress, New game for a first-timer, who gets a short story and then the tutorial's first
 * order; Explore mode; Settings, Controls and Credits. (The daily challenge isn't a button here: it
 * isn't a mode of its own, only a goal inside the career, and lives in the Deliver It app on the phone.)
 *
 * The game downloads in the background from the moment the page opens, and a line shows how far
 * it's got. Choosing a mode brings up the loading screen, which builds the city.
 */
export function TitleScreen() {
  const t = useT()
  const loading = useGameStore((state) => state.loading)
  const credits = useGameStore((state) => state.credits)
  const xp = useGameStore((state) => state.xp)
  const day = useGameStore((state) => state.day)
  const delivered = useGameStore((state) => state.history.length)
  const tutorialDone = useTutorial((state) => state.done)
  const [shown, setShown] = useState(0)
  // An invite link opens straight on the room's panel.
  const invited = invitedTo()
  const [view, setView] = useState<View>(invited ? 'friends' : 'menu')

  // While the story's cards are read, the city is built behind them (the title's pictures cover it):
  // its shapes made, its shaders compiled, its pictures sent to the graphics card. Left until the
  // last card, all of that landed in the moment after it, as one long frame and a loading screen.
  useEffect(() => {
    if (view !== 'story') return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => useLaunch.setState({ curtainDrawn: true })))
    return () => cancelAnimationFrame(id)
  }, [view])

  const launch = (explore: boolean) => {
    // Explore: the city to roam, with no orders and any vehicle to drive (game/borrow.ts). Otherwise the career.
    useGameStore.getState().setExplore(explore)
    if (explore) track('explore_start')
    else if (firstTime) track('new_game')
    // Sound is only allowed after a click or key press, and this is one.
    unlockAudio()
    markLoad('play pressed')
    useLaunch.setState({ requested: true })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setShown((index) => (index + 1) % BACKDROPS.length), BACKDROP_TIME)
    return () => window.clearInterval(timer)
  }, [])

  const failed = loading.stage === 'error'
  const downloaded = loading.stage === 'downloaded'
  const percent = Math.floor((loading.loadedKb / loading.totalKb) * 100)

  const hasProgress = credits + xp > 0 || delivered > 0 || day > 1
  // A first-timer hears how the day starts before riding; anyone who has played goes straight in.
  const firstTime = !hasProgress && !tutorialDone

  const play = () => (firstTime ? setView('story') : launch(false))
  const items: MenuItem[] = failed
    ? [{ id: 'retry', label: 'Download failed. Try again', primary: true, onSelect: () => window.location.reload() }]
    : [
        hasProgress
          ? { id: 'continue', label: t('continue'), detail: `Day ${day} · Level ${levelFromXp(xp)} · ₹${credits.toLocaleString('en-IN')} · ★ ${averageRating().toFixed(1)}`, primary: true, onSelect: play }
          : { id: 'new', label: t('newGame'), detail: t('firstTime'), primary: true, onSelect: play },
        { id: 'explore', label: t('explore'), detail: t('exploreDetail'), onSelect: () => launch(true) },
        { id: 'friends', label: invited ? `Join room ${invited}` : 'Play with friends', detail: invited ? 'A friend sent you this room' : `A room for up to ${ROOM.most}: roam, deliver or race together`, onSelect: () => setView('friends') },
        { id: 'settings', label: t('settings'), onSelect: () => setView('settings') },
        { id: 'controls', label: t('controls'), onSelect: () => setView('controls') },
        { id: 'credits', label: t('credits'), onSelect: () => setView('credits') },
      ]

  const back = () => setView('menu')

  return (
    <main className="title-screen menu-skin" data-view={view}>
      <div className="title-backdrop" aria-hidden="true">
        {BACKDROPS.map(({ src }, index) => (
          <img key={src} src={src} alt="" data-shown={index === shown} data-drift={index % 2 === 0 ? 'in' : 'across'} loading={index === 0 ? 'eager' : 'lazy'} />
        ))}
      </div>

      {/* One column down the left: the brand at the top, the menu (or the story) at the bottom. */}
      <div className="title-column">
      <header className="title-brand">
        <h1 className="title-logo">
          <Logo />
        </h1>
        <p className="title-kannada" lang="kn">
          {GAME_NAME_KANNADA}
        </p>
        <p className="title-lede">{TAGLINE}</p>
        <p className="title-where">{NOW_RIDING}</p>
      </header>

      {view === 'story' ? (
        <StoryOpening onDone={() => launch(false)} />
      ) : (
        <nav className="title-main" aria-label="Main menu" hidden={view !== 'menu'}>
          {/* The list is taken off the page while a panel is open, so the arrow keys are the panel's alone. */}
          {view === 'menu' && <MenuList items={items} label="Main menu" />}
          {!failed && (
            <div className="title-download" role="status">
              <span className="title-download-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${downloaded ? 1 : loading.loadedKb / loading.totalKb})` }} />
              </span>
              {downloaded ? 'City downloaded' : `Downloading the city in the background: ${percent}%, ${megabytes(loading.loadedKb)} of ${megabytes(loading.totalKb)} MB`}
            </div>
          )}
          <p className="title-facts">{failed ? `The download stopped: ${loading.error}. Check your connection.` : t('free')}</p>
        </nav>
      )}
      </div>

      {view === 'settings' && <SettingsPanel onBack={back} />}
      {view === 'controls' && <ControlsPanel onBack={back} />}
      {view === 'credits' && <CreditsPanel onBack={back} />}
      {view === 'feedback' && <FeedbackPanel onBack={back} />}
      {view === 'friends' && (
        <FriendsPanel
          onBack={back}
          onRide={() => {
            // With friends there's no story and no tutorial: straight into the city, in the career so orders work.
            tutorialHold.on = true
            launch(false)
          }}
        />
      )}

      <p className="title-caption">
        <span aria-hidden="true" />
        In the game: {BACKDROPS[shown].caption}
      </p>
      <MenuFooter onFeedback={() => setView('feedback')} />
    </main>
  )
}
