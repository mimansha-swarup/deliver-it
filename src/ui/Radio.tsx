import { useEffect, useRef, useState } from 'react'
import { setMusicOn, setSfxOn } from '../audio/audioEngine'
import { playStation, stopStation } from '../audio/radio'
import type { VideoStation } from '../audio/stations'
import { useStation } from '../audio/useStation'
import { useGameStore } from '../game/gameStore'

const NEXT_STATION_KEY = 'KeyR'

/**
 * Keeps the sound in step with the settings. It draws nothing. Code stations
 * play from here. The YouTube station plays from `VideoScreen`, as it needs to
 * be on screen. R moves to the next station.
 */
export function RadioPlayer() {
  const station = useStation()
  const musicOn = useGameStore((state) => state.musicOn)
  const hornsOn = useGameStore((state) => state.hornsOn)
  const changeStation = useGameStore((state) => state.changeStation)

  useEffect(() => setMusicOn(musicOn), [musicOn])
  useEffect(() => setSfxOn(hornsOn), [hornsOn])

  useEffect(() => {
    if (musicOn && station.kind === 'code') playStation(station)
    else stopStation()
    return stopStation
  }, [station, musicOn])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === NEXT_STATION_KEY && !event.repeat) changeStation(1)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [changeStation])

  return null
}

/** Gives the keyboard back to the game after a click, so Space doesn't press the button again. */
function blurAfter(action: () => void) {
  return (event: React.MouseEvent<HTMLButtonElement>) => {
    action()
    event.currentTarget.blur()
  }
}

/** The radio's buttons, shown on the raised phone. */
export function RadioControls() {
  const station = useStation()
  const musicOn = useGameStore((state) => state.musicOn)
  const hornsOn = useGameStore((state) => state.hornsOn)
  const changeStation = useGameStore((state) => state.changeStation)
  const setMusic = useGameStore((state) => state.setMusicOn)
  const setHorns = useGameStore((state) => state.setHornsOn)

  return (
    <section className="phone-radio" aria-label="Radio">
      <button type="button" aria-label="Previous station" onClick={blurAfter(() => changeStation(-1))}>
        ‹
      </button>
      <p className="phone-radio-station">
        <span>{musicOn ? station.name : 'Music off'}</span>
        <small>{musicOn ? station.tagline : 'Click ♪ to turn it on'}</small>
      </p>
      <button type="button" aria-label="Next station" onClick={blurAfter(() => changeStation(1))}>
        ›
      </button>
      <button
        type="button"
        aria-pressed={musicOn}
        aria-label={musicOn ? 'Turn music off' : 'Turn music on'}
        onClick={blurAfter(() => setMusic(!musicOn))}
      >
        ♪
      </button>
      <button
        type="button"
        aria-pressed={hornsOn}
        aria-label={hornsOn ? 'Turn sound effects off' : 'Turn sound effects on'}
        title="Sound effects: engines, horns, skids and the city"
        onClick={blurAfter(() => setHorns(!hornsOn))}
      >
        🔊
      </button>
    </section>
  )
}

/* The parts of YouTube's IFrame Player API used here. */
type YouTubePlayer = {
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
  /** Missing until the player is ready. */
  getPlaylistIndex?: () => number
  getCurrentTime?: () => number
}
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string
      height: string
      videoId: string
      playerVars: Record<string, string | number>
      events: { onReady: () => void }
    },
  ) => YouTubePlayer
}
type YouTubeWindow = Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void }

let youTubeApi: Promise<YouTubeApi> | null = null

/** Loads YouTube's player script once, the first time the station is picked. */
function loadYouTube(): Promise<YouTubeApi> {
  youTubeApi ??= new Promise((resolve, reject) => {
    const page = window as YouTubeWindow
    page.onYouTubeIframeAPIReady = () => (page.YT ? resolve(page.YT) : reject(new Error('No YouTube')))
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      youTubeApi = null
      reject(new Error('YouTube could not load'))
    }
    document.head.append(script)
  })
  return youTubeApi
}

/**
 * Where the playlist got to, so a player that's closed and opened again carries
 * on from the same song and second instead of starting over.
 */
const resumeAt = { videoId: '', seconds: 0 }

/** The playlist, turned so that `first` comes first and the rest follow in order. */
function startingFrom(videos: string[], first: string): string[] {
  const index = Math.max(0, videos.indexOf(first))
  return [...videos.slice(index), ...videos.slice(0, index)]
}

/**
 * YouTube's player. YouTube's rules say it must stay visible and at least
 * 200 × 200 pixels while it plays, so it's never hidden or shrunk to play sound
 * alone. It has its own card, just above the rider's phone.
 */
export function VideoScreen({ station, className }: { station: VideoStation; className: string }) {
  const holder = useRef<HTMLDivElement>(null)
  const player = useRef<YouTubePlayer | null>(null)
  const [failed, setFailed] = useState(false)
  const musicOn = useGameStore((state) => state.musicOn)
  const musicOnNow = useRef(musicOn)

  useEffect(() => {
    musicOnNow.current = musicOn
    if (!player.current) return
    if (musicOn) player.current.playVideo()
    else player.current.pauseVideo()
  }, [musicOn])

  useEffect(() => {
    let cancelled = false
    const order = startingFrom(station.videos, resumeAt.videoId)
    const [first, ...rest] = order
    const startSeconds = first === resumeAt.videoId ? Math.floor(resumeAt.seconds) : 0

    loadYouTube()
      .then((YT) => {
        if (cancelled || !holder.current) return
        // YouTube replaces the element it's given, so it gets one of its own inside ours.
        const target = document.createElement('div')
        holder.current.append(target)
        const created = new YT.Player(target, {
          width: '100%',
          height: '100%',
          videoId: first,
          playerVars: { playlist: rest.join(','), loop: 1, playsinline: 1, rel: 0, start: startSeconds },
          events: {
            onReady: () => {
              if (musicOnNow.current) created.playVideo()
            },
          },
        })
        player.current = created
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      const closing = player.current
      if (closing?.getPlaylistIndex && closing.getCurrentTime) {
        const index = closing.getPlaylistIndex()
        if (index >= 0) {
          resumeAt.videoId = order[index] ?? first
          resumeAt.seconds = closing.getCurrentTime()
        }
      }
      closing?.destroy()
      player.current = null
    }
  }, [station])

  return (
    <div className={className} ref={holder}>
      {failed && <p className="music-card-failed">Couldn't reach YouTube. Try another station.</p>}
    </div>
  )
}
