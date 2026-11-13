import { useEffect, useRef } from 'react'
import type { DriveInput } from './ScooterController'

const KEY_BINDINGS: Record<string, keyof DriveInput> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
}

function noKeysPressed(): DriveInput {
  return { forward: false, backward: false, left: false, right: false, handbrake: false }
}

/**
 * Tracks which keys are held. The result lives in a ref, so key presses don't
 * re-render React. The game loop simply reads `current` every frame.
 */
export function useDriveInput() {
  const keys = useRef(noKeysPressed())

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      const control = KEY_BINDINGS[event.code]
      if (!control) return

      event.preventDefault() // Stops the arrow keys and Space scrolling the page.
      keys.current[control] = pressed
    }
    const handleKeyDown = (event: KeyboardEvent) => setKey(event, true)
    const handleKeyUp = (event: KeyboardEvent) => setKey(event, false)

    // If the window loses focus, the key-up never arrives and keys would stick.
    const releaseAll = () => {
      keys.current = noKeysPressed()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseAll)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAll)
    }
  }, [])

  return keys
}
