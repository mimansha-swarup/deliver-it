import { useEffect, useRef } from 'react'
import { honkPlayerHorn } from '../audio/horns'
import type { DriveInput } from '../vehicle/ScooterController'
import { touchInput } from '../vehicle/touchInput'

type Control = keyof DriveInput

const CONTROLS = Object.keys(touchInput) as Control[]

/** The control under a screen point, if any. */
function controlAt(x: number, y: number): Control | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-control]')
  return (element?.dataset.control as Control | undefined) ?? null
}

function Arrow({ turn }: { turn: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${turn}deg)` }}>
      <path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * On-screen buttons for phones, held in landscape: steering under the left
 * thumb, throttle, brake and drift under the right.
 *
 * Each finger is tracked by its pointer id, and the button under it is looked up
 * by position on every move. So a thumb can slide from Gas to Brake without
 * lifting, and two fingers on one button don't fight.
 */
export function TouchControls() {
  const pad = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Every finger that started on a button, and the button it's on now (or null).
    const fingers = new Map<number, Control | null>()

    const sync = () => {
      const held = new Set(fingers.values())
      for (const control of CONTROLS) touchInput[control] = held.has(control)
      // Lit directly on the DOM, so pressing doesn't re-render React.
      pad.current?.querySelectorAll<HTMLElement>('[data-control]').forEach((button) => {
        button.dataset.pressed = String(held.has(button.dataset.control as Control))
      })
    }

    const handleDown = (event: PointerEvent) => {
      const control = controlAt(event.clientX, event.clientY)
      if (!control) return
      event.preventDefault()
      fingers.set(event.pointerId, control)
      sync()
    }
    const handleMove = (event: PointerEvent) => {
      if (!fingers.has(event.pointerId)) return
      const control = controlAt(event.clientX, event.clientY)
      if (fingers.get(event.pointerId) === control) return
      fingers.set(event.pointerId, control)
      sync()
    }
    const handleUp = (event: PointerEvent) => {
      if (fingers.delete(event.pointerId)) sync()
    }
    // A call, a notification or switching apps can swallow the finger's lift.
    const releaseAll = () => {
      fingers.clear()
      sync()
    }

    window.addEventListener('pointerdown', handleDown, { passive: false })
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', releaseAll)
    return () => {
      window.removeEventListener('pointerdown', handleDown)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', releaseAll)
      releaseAll()
    }
  }, [])

  return (
    <div ref={pad} className="touch-controls" aria-hidden="true">
      <div className="touch-steer">
        <div className="touch-button" data-control="left">
          <Arrow turn={0} />
        </div>
        <div className="touch-button" data-control="right">
          <Arrow turn={180} />
        </div>
      </div>

      <div className="touch-pedals">
        <div
          className="touch-button touch-horn"
          onPointerDown={(event) => {
            event.preventDefault()
            honkPlayerHorn()
          }}
        >
          Horn
        </div>
        <div className="touch-button touch-drift" data-control="handbrake">
          Drift
        </div>
        <div className="touch-button touch-brake" data-control="backward">
          Brake
        </div>
        <div className="touch-button touch-gas" data-control="forward">
          Gas
        </div>
      </div>
    </div>
  )
}
