/**
 * Covers the game while a phone is held upright. It's always in the page, and
 * CSS shows it only for a finger-driven screen in portrait, so turning the phone
 * hides it at once with no JavaScript.
 */
export function RotatePrompt() {
  return (
    <div className="rotate-prompt" role="alert">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect x="22" y="8" width="20" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M14 40a20 20 0 0 0 18 16m0 0-5-4m5 4-4 5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>Turn your phone sideways to ride</p>
    </div>
  )
}
