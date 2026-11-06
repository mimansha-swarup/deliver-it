import { useGameStore } from '../game/gameStore'
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../game/qualitySettings'

/** Three buttons for choosing graphics quality. It applies at once, even mid-ride. */
export function QualityPicker({ className }: { className: string }) {
  const quality = useGameStore((state) => state.quality)
  const setQuality = useGameStore((state) => state.setQuality)

  return (
    <div className={`quality-picker ${className}`} role="group" aria-label="Graphics quality">
      <span>Quality</span>
      {QUALITY_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={quality === level}
          onClick={(event) => {
            setQuality(level)
            // Gives the keyboard back to the game, so Space doesn't press this button.
            event.currentTarget.blur()
          }}
        >
          {QUALITY_PRESETS[level].label}
        </button>
      ))}
    </div>
  )
}
