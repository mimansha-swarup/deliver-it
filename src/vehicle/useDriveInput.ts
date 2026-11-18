import { useEffect, useRef } from 'react'
import type { DriveInput } from './ScooterController'
import { isKey } from '../game/keyBindings'

/** The riding controls, each by its action in the key bindings (keyBindings.ts), so they can be changed. */
const CONTROLS: (keyof DriveInput)[] = ['forward', 'backward', 'left', 'right', 'handbrake', 'nitro']

function noKeysPressed(): DriveInput {
  return { forward: false, backward: false, left: false, right: false, handbrake: false, nitro: false }
}

/**
 * Tracks which keys are held. The result lives in a ref, so key presses don't
 * re-render React. The game loop simply reads `current` every frame.
 */
export function useDriveInput() {
  const keys = useRef(noKeysPressed())

  useEffect(() => {
    const setKey = (event: KeyboardEvent, pressed: boolean) => {
      const control = CONTROLS.find((name) => isKey(name, event.code))
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
