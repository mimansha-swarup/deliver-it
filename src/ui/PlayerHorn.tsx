import { isKey } from '../game/keyBindings'
import { useEffect } from 'react'
import { honkPlayerHorn } from '../audio/horns'


/** Press H to honk. It draws nothing; the touch layout has its own Horn button. */
export function PlayerHorn() {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isKey('horn', event.code) && !event.repeat) honkPlayerHorn()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return null
}
