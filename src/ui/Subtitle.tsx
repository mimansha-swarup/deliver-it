import { useSubtitle } from '../audio/subtitle'

/**
 * What a spoken Kannada line means, in English, at the bottom centre while it's heard: who is
 * speaking, then the words (audio/subtitle.ts). Above the prompts and the order offer, never over them.
 */
export function Subtitle() {
  const line = useSubtitle((state) => state.line)
  if (!line) return null
  return (
    <p className="voice-subtitle" role="status" aria-live="polite" key={line.id}>
      <strong>{line.speaker}</strong>
      <span>{line.text}</span>
    </p>
  )
}
