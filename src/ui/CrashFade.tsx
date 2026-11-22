import { useEffect, useRef } from 'react'
import { liveCrash } from '../game/slowMotion'

/**
 * After a crash that threw the rider, the screen dips to dark and comes back on them getting up
 * beside the scooter (ScooterController's `lying` phase). The darkness is a number the game loop
 * keeps; this writes it straight to the element each frame, so React never re-renders for it.
 */
export function CrashFade() {
  const cover = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let shown = 0
    let id = requestAnimationFrame(function tick() {
      const dark = liveCrash.dark
      if (cover.current && dark !== shown) {
        shown = dark
        // Eased, so it neither starts nor ends abruptly.
        cover.current.style.opacity = String(dark * dark * (3 - 2 * dark))
      }
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [])
  return <div ref={cover} className="crash-fade" aria-hidden="true" />
}
