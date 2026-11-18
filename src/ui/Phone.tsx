import { useKeyName } from '../game/keyBindings'
import { isKey } from '../game/keyBindings'
import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../game/gameStore'
import { WEATHERS } from '../sky/skyLogic'
import { DISPATCHER } from '../game/career'
import { liveSky } from '../game/livePlayer'
import { STATIONS } from '../audio/stations'
import { playPing } from '../audio/uiSounds'
import { useStation } from '../audio/useStation'
import { VideoScreen } from './Radio'
import { useUi } from './uiState'
import { AppGlyph, PhoneApp, WeatherIcon } from './phoneApps'
import { APPS, RAVI_THREAD, type AppId, type PhoneNav } from './phoneAppList'

/*
 * The rider's phone, as a phone: a lock screen with the time, weather and notifications when it
 * comes up; a home screen of app icons on a wallpaper, with unread badges; a status bar with the
 * time, signal and battery; banners for new messages while it's in use; back (Esc) from an app to
 * home and from home to put it away. Away, it hides below the screen but for its tab, and peeks up
 * for new messages. The apps are in phoneApps.tsx.
 */


/** How long a message peeks the phone up (or shows as a banner on it), in milliseconds. */
const PEEK_MS = { normal: 3000, urgent: 6000, music: 2500 }

type Peek = { id: number; from: string; thread: string | null; text: string; kind: 'normal' | 'urgent' | 'music' }

/** The battery: full at 7 am, about 4% an hour after, charged again by sleeping. */
function batteryAt(hours: number): number {
  const since = (hours - 7 + 24) % 24
  return Math.max(8, Math.round(100 - since * 4))
}

function StatusBar({ unread = 0 }: { unread?: number }) {
  const skyTime = useGameStore((state) => state.skyTime)
  const weather = useGameStore((state) => state.weather)
  const night = useGameStore((state) => state.night)
  const battery = batteryAt(liveSky.hours)
  return (
    <header className="phone-status">
      <span className="phone-time">
        {skyTime}
        {unread > 0 && <span className="phone-tab-count" aria-label={`${unread} unread`}>{unread}</span>}
      </span>
      <span className="phone-camera" aria-hidden="true" />
      <span className="phone-status-right">
        <WeatherIcon weather={weather} night={night} />
        <span className="phone-signal" aria-label="Signal: 4 bars">
          <i /> <i /> <i /> <i />
        </span>
        <span className="phone-net">4G</span>
        <span className="phone-battery" aria-label={`Battery ${battery}%`} data-low={battery < 20}>
          <span style={{ width: `${battery}%` }} />
        </span>
        <span className="phone-battery-text">{battery}%</span>
      </span>
    </header>
  )
}

/**
 * New messages: away, they peek the phone up; in use, they show as a banner at its top (unless
 * that chat is open). A new station shows what's playing. Each also counts as unread in its thread.
 */
function useNotifications(onMessage: (note: Peek) => void): Peek | null {
  const [peek, setPeek] = useState<Peek | null>(null)
  useEffect(() => {
    const show = (next: Peek) => {
      onMessage(next)
      setPeek(next)
      playPing(next.kind === 'urgent' ? 'urgent' : next.kind === 'music' ? 'nowPlaying' : 'message')
    }
    return useGameStore.subscribe((state, previous) => {
      // Online, the chat carries the customer and Ravi; off duty, Ravi's messages come on their own.
      if (state.chat !== previous.chat && state.chat.length > 0) {
        const line = state.chat[state.chat.length - 1]
        if (!previous.chat.some((old) => old.id === line.id)) {
          const thread = line.from === 'dispatch' ? RAVI_THREAD : line.name
          show({ id: line.id, from: line.from === 'dispatch' ? DISPATCHER : line.name, thread, text: line.text, kind: line.urgent ? 'urgent' : 'normal' })
        }
      }
      const newest = state.messages[0]
      if (state.duty === 'off' && newest && newest.id !== previous.messages[0]?.id) {
        show({ id: newest.id, from: DISPATCHER, thread: RAVI_THREAD, text: newest.text, kind: 'normal' })
      }
      if (state.stationId !== previous.stationId && state.musicOn) {
        const station = STATIONS.find(({ id }) => id === state.stationId)
        if (station) show({ id: Date.now(), from: 'Now playing', thread: null, text: station.name, kind: 'music' })
      }
    })
  }, [onMessage])

  useEffect(() => {
    if (!peek) return
    const timer = window.setTimeout(() => setPeek(null), PEEK_MS[peek.kind])
    return () => window.clearTimeout(timer)
  }, [peek])
  return peek
}

function LockScreen({ notifications, onUnlock, onOpen }: { notifications: Peek[]; onUnlock: () => void; onOpen: (thread: string | null) => void }) {
  const skyTime = useGameStore((state) => state.skyTime)
  const weather = useGameStore((state) => state.weather)
  const night = useGameStore((state) => state.night)
  const day = useGameStore((state) => state.day)
  return (
    <div className="phone-lock phone-wallpaper" onClick={onUnlock} role="button" tabIndex={-1} aria-label="Unlock: click or Enter">
      <p className="phone-lock-time">{skyTime}</p>
      <p className="phone-lock-date">
        Day {day} · <WeatherIcon weather={weather} night={night} /> {WEATHERS[weather].label}
      </p>
      <ul className="phone-lock-notes">
        {notifications.slice(0, 4).map((note) => (
          <li key={note.id}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onOpen(note.thread)
                event.currentTarget.blur()
              }}
            >
              <strong>{note.from}</strong>
              <span>{note.text}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="phone-lock-hint">Click or press Enter to unlock</p>
    </div>
  )
}

function HomeScreen({ nav, badges }: { nav: PhoneNav; badges: Partial<Record<AppId, number>> }) {
  return (
    <div className="phone-home phone-wallpaper">
      <ul className="phone-icons">
        {APPS.map(({ id, name, color, glyph }) => (
          <li key={id}>
            <button type="button" onClick={(event) => { nav.go(id); event.currentTarget.blur() }}>
              <span className="phone-icon" style={{ background: color }}>
                <AppGlyph path={glyph} />
                {(badges[id] ?? 0) > 0 && <span className="phone-badge">{badges[id]}</span>}
              </span>
              <span className="phone-icon-name">{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Screen = 'lock' | 'home' | AppId

export function Phone() {
  const [raised, setRaised] = useState(false)
  const [screen, setScreen] = useState<Screen>('lock')
  const [thread, setThread] = useState<string | null>(null)
  /** Unread counts per thread. */
  const [unread, setUnread] = useState<Record<string, number>>({})
  /** Notifications since the phone was last unlocked, for the lock screen. */
  const [notes, setNotes] = useState<Peek[]>([])
  const offer = useGameStore((state) => state.offer !== null)
  const atStore = useGameStore((state) => state.atStore)
  const mapOpen = useUi((state) => state.mapOpen)
  /** Whether the phone is up because a handover raised it, rather than the rider. */
  const autoRaised = useRef(false)
  /** Which chat is open on screen right now, so its messages don't count as unread. */
  const reading = useRef<string | null>(null)
  useEffect(() => {
    reading.current = raised && screen === 'messages' ? thread : null
  }, [raised, screen, thread])

  // Each message as it arrives: unread in its thread (unless that chat is open), and on the lock screen.
  const [countMessage] = useState(() => (note: Peek) => {
    if (note.thread === null) return
    const from = note.thread
    setNotes((list) => [note, ...list].slice(0, 6))
    if (reading.current === from) return
    setUnread((counts) => ({ ...counts, [from]: (counts[from] ?? 0) + 1 }))
  })
  const notification = useNotifications(countMessage)

  const open = (next: Screen) => {
    setRaised(true)
    setScreen(next)
    if (next === 'lock' || next === 'home') setThread(null)
  }
  const close = () => {
    autoRaised.current = false
    setRaised(false)
  }
  const nav: PhoneNav = {
    go: (app) => {
      setThread(null)
      setScreen(app)
    },
    openThread: (name) => {
      setScreen('messages')
      setThread(name)
      setUnread((counts) => ({ ...counts, [name]: 0 }))
    },
    close,
    thread,
    unread: (name) => unread[name] ?? 0,
  }

  // The phone comes up by itself while a parcel changes hands, on the order, and goes down after.
  useEffect(
    () =>
      useGameStore.subscribe((state, previous) => {
        if (state.phase === previous.phase) return
        const handingOff = (phase: string) => phase === 'collecting' || phase === 'handingOver'
        if (handingOff(state.phase)) {
          autoRaised.current = true
          setRaised(true)
          setScreen('deliver')
        } else if (handingOff(previous.phase) && autoRaised.current) {
          autoRaised.current = false
          setRaised(false)
        }
      }),
    [],
  )

  // P brings it up on the lock screen (or puts it away). Enter unlocks. Esc goes back: app, home, away.
  const state = useRef({ raised, screen, thread, mapOpen })
  useEffect(() => {
    state.current = { raised, screen, thread, mapOpen }
  }, [raised, screen, thread, mapOpen])
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      const now = state.current
      if (isKey('phone', event.code)) {
        autoRaised.current = false
        if (now.raised) setRaised(false)
        else {
          setRaised(true)
          setScreen('lock')
          setThread(null)
        }
      } else if (event.code === 'Enter' && now.raised && now.screen === 'lock') {
        setScreen('home')
        setNotes([])
      } else if (event.code === 'Escape' && now.raised && !now.mapOpen) {
        if (now.screen === 'messages' && now.thread) setThread(null)
        else if (now.screen !== 'home' && now.screen !== 'lock') setScreen('home')
        else setRaised(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const totalUnread = Object.values(unread).reduce((sum, count) => sum + count, 0)
  const phoneKey = useKeyName('phone')
  const badges: Partial<Record<AppId, number>> = { messages: totalUnread, deliver: offer ? 1 : 0, garage: atStore ? 1 : 0 }
  const station = useStation()
  const videoCard = station.kind === 'video'
  // A banner across the top: on the half-open phone always; open, unless it's on the lock screen
  // (which lists them) or that chat is the one showing.
  const banner =
    notification && (!raised || (screen !== 'lock' && !(screen === 'messages' && thread === notification.thread))) ? notification : null
  const openNote = (note: Peek) => {
    open('home')
    if (note.thread) nav.openThread(note.thread)
    else nav.go('music')
  }

  return (
    <>
      <aside
        className={raised ? 'phone phone-raised' : 'phone phone-away'}
        aria-label={raised ? 'Rider phone' : `Rider phone: click or press ${phoneKey} to open`}
        data-alert={!raised && notification?.kind === 'urgent' ? 'true' : undefined}
        onClickCapture={(event) => {
          // Half open, a click anywhere raises it to the lock screen; a banner opens its chat.
          if (raised) return
          event.stopPropagation()
          event.preventDefault()
          if (banner && (event.target as HTMLElement).closest('.phone-banner')) openNote(banner)
          else open('lock')
        }}
      >
        <div className="phone-screen">
          <StatusBar unread={raised ? 0 : totalUnread} />
          {banner && (
            <button type="button" className="phone-banner" data-kind={banner.kind} onClick={() => openNote(banner)}>
              <strong>{banner.from}</strong>
              <span>{banner.text}</span>
            </button>
          )}
          <div className="phone-lower">
            {!raised || screen === 'lock' ? (
              <LockScreen
                notifications={notes}
                onUnlock={() => {
                  setScreen('home')
                  setNotes([])
                }}
                onOpen={(name) => {
                  setNotes([])
                  if (name) nav.openThread(name)
                  else nav.go('music')
                }}
              />
            ) : screen === 'home' ? (
              <HomeScreen nav={nav} badges={badges} />
            ) : (
              <PhoneApp app={screen} nav={nav} />
            )}
          </div>
          <button
            type="button"
            className="phone-home-bar"
            aria-label="Home"
            onClick={(event) => {
              if (screen === 'home') close()
              else open('home')
              event.currentTarget.blur()
            }}
          />
        </div>
      </aside>
      {videoCard && (
        <aside className={raised ? 'music-card music-card-raised' : 'music-card'} aria-label="Music video">
          <VideoScreen station={station} className="music-card-player" />
        </aside>
      )}
    </>
  )
}
