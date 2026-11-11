import { useEffect } from 'react'
import { honkPlayerHorn } from '../audio/horns'

const HORN_KEY = 'KeyH'

/** Press H to honk. It draws nothing; the touch layout has its own Horn button. */
export function PlayerHorn() {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === HORN_KEY && !event.repeat) honkPlayerHorn()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return null
}
