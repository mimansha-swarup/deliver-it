import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { setHushed, unlockAudio } from '../audio/audioEngine'
import { playPing } from '../audio/uiSounds'
import { pauseClock, resumeClock } from '../game/clock'
import { useFamily } from '../game/family'
import { useGameStore } from '../game/gameStore'
import { useLaunch } from '../game/launch'
import { FeedbackPanel } from './Feedback'
import { Logo } from './Logo'
import { ControlsPanel, MenuFooter, MenuList, SettingsPanel, type MenuItem } from './Menu'
import { useT } from './menuText'
import { usePause, useUi } from './uiState'

/*
 * The pause menu: Esc while riding or walking, when nothing else is open for Esc to close (the
 * phone, the map, the help, photo mode). The game stops behind it (its clock is held, as in photo
 * mode, and its sounds hushed), its keys don't reach the game, and timers that count in real time
 * (an order offer, home asking) get the time back on resuming.
 *
 * Resume, Settings, Controls, Unstuck (back on the nearest road: vehicle/Unstuck.tsx), and Save
 * and quit to menu. Progress is saved as it happens, so quitting only has to go back to the title.
 */

type View = 'menu' | 'settings' | 'controls' | 'feedback'

/** Whether something else is up that Esc belongs to. Read as the key goes down, before those things close. */
function escIsTaken(): boolean {
  const game = useGameStore.getState()
  return game.photoMode || useUi.getState().mapOpen || document.querySelector('.phone-raised, .help-overlay, .score-card-view, [data-listening="true"]') !== null
}

export function PauseMenu() {
  const t = useT()
  const open = usePause((state) => state.open)
  const [view, setView] = useState<View>('menu')

  // Esc opens it. Listened for before everything else, so what else is open is seen as it was.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || event.repeat || usePause.getState().open) return
      const game = useGameStore.getState()
      if (!game.started || escIsTaken()) return
      event.stopImmediatePropagation()
      unlockAudio()
      playPing('menuSelect')
      setView('menu')
      usePause.setState({ open: true })
    }
    window.addEventListener('keydown', handleKey, { capture: true })
    return () => window.removeEventListener('keydown', handleKey, { capture: true })
  }, [])

  // While it's open the game hears no keys: only the menu does. A key being chosen in Controls is let through.
  useEffect(() => {
    if (!open) return
    setHushed(true)
    // The game listens on the window; the menu on the document, which hears a key first. So a key
    // stopped here is the menu's alone.
    const block = (event: KeyboardEvent) => {
      if (document.querySelector('[data-listening="true"]')) return
      event.stopPropagation()
      if (event.code === 'Escape' && !event.repeat && !document.querySelector('.pause-screen .menu-panel')) {
        event.preventDefault()
        playPing('menuBack')
        usePause.setState({ open: false })
      }
    }
    document.addEventListener('keydown', block)
    return () => {
      document.removeEventListener('keydown', block)
      setHushed(false)
    }
  }, [open])

  if (!open) return null
  const resume = () => usePause.setState({ open: false })
  const items: MenuItem[] = [
    { id: 'resume', label: t('resume'), primary: true, onSelect: resume },
    { id: 'settings', label: t('settings'), onSelect: () => setView('settings') },
    { id: 'controls', label: t('controls'), onSelect: () => setView('controls') },
    { id: 'feedback', label: t('feedback'), detail: 'What you liked, and what broke', onSelect: () => setView('feedback') },
    { id: 'unstuck', label: t('unstuck'), detail: t('unstuckDetail'), onSelect: () => usePause.setState((state) => ({ open: false, unstuck: state.unstuck + 1 })) },
    // Back to the title: the page is loaded again, which is the one sure way to put the whole city down.
    { id: 'quit', label: t('quit'), detail: t('quitDetail'), onSelect: () => window.location.reload() },
  ]

  return (
    <div className="pause-screen menu-skin" role="dialog" aria-label={t('paused')} data-view={view}>
      {view === 'menu' && (
        <div className="pause-main">
          <div className="pause-logo" aria-hidden="true">
            <Logo />
          </div>
          <h1>{t('paused')}</h1>
          <p>Esc: {t('resume').toLowerCase()}</p>
          <MenuList items={items} label={t('paused')} />
        </div>
      )}
      {view === 'settings' && <SettingsPanel inGame onBack={() => setView('menu')} onTutorial={resume} />}
      {view === 'controls' && <ControlsPanel onBack={() => setView('menu')} />}
      {view === 'feedback' && <FeedbackPanel onBack={() => setView('menu')} />}
      <MenuFooter />
    </div>
  )
}

/**
 * In the Canvas: holds the game's clock while the pause menu is open, so every frame's time step is
 * zero and nothing moves, and gives real-time countdowns their time back afterwards.
 */
export function PauseClock() {
  const open = usePause((state) => state.open)
  const started = useLaunch((state) => state.requested)
  const clock = useThree((state) => state.clock)
  useEffect(() => {
    if (!open || !started) return
    const pausedAt = performance.now()
    const elapsed = pauseClock(clock)
    return () => {
      resumeClock(clock, elapsed)
      const away = performance.now() - pausedAt
      useGameStore.getState().extendOffer(away)
      const ask = useFamily.getState().ask
      if (ask) useFamily.setState({ ask: { ...ask, expiresAt: ask.expiresAt + away } })
    }
  }, [open, started, clock])
  return null
}
