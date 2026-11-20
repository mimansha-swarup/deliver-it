import { isKey } from '../game/keyBindings'
import { useEffect } from 'react'
import { setMusicOn, setSfxOn } from '../audio/audioEngine'
import { playStation, stopStation } from '../audio/radio'
import { useStation } from '../audio/useStation'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { roadReport } from '../audio/rj'
import { watchVoiceCues } from '../audio/voiceCues'
import { cityEvents } from '../game/cityEvents'


/**
 * Keeps the sound in step with the settings. It draws nothing. Every station is
 * composed in code (audio/stations.ts) and plays from here. R moves to the next station.
 */
export function RadioPlayer() {
  const station = useStation()
  const musicOn = useGameStore((state) => state.musicOn)
  const hornsOn = useGameStore((state) => state.hornsOn)
  const changeStation = useGameStore((state) => state.changeStation)

  // What the RJ's traffic update can talk about: the time, the rain, and what's on the roads (game/cityEvents.ts).
  useEffect(() => {
    roadReport.get = () => ({ hours: liveSky.hours, rain: liveSky.rain, night: liveSky.look.night > 0.6, events: cityEvents.active.map(({ kind, road }) => ({ kind, road })) })
  }, [])

  // Ravi's and the customers' spoken cues (audio/voiceCues.ts).
  useEffect(() => watchVoiceCues(), [])

  useEffect(() => setMusicOn(musicOn), [musicOn])
  useEffect(() => setSfxOn(hornsOn), [hornsOn])

  useEffect(() => {
    if (musicOn) playStation(station)
    else stopStation()
    return stopStation
  }, [station, musicOn])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isKey('radio', event.code) && !event.repeat) changeStation(1)
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
