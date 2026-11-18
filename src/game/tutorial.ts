import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/*
 * The tutorial's progress: whether it's been done (the "tutorialDone" flag, saved), and the step
 * it's on now (not saved: a reload mid-tutorial starts it again from the top).
 */

export const TUTORIAL_STEPS = ['ride', 'brake', 'online', 'accept', 'pickup', 'map', 'deliver', 'extras', 'offline'] as const
export type TutorialStep = (typeof TUTORIAL_STEPS)[number]

type TutorialState = {
  done: boolean
  /** The step showing now, or null when the tutorial isn't running. */
  step: TutorialStep | null
  start: () => void
  /** Moves on a step, or finishes after the last. */
  next: () => void
  /** Ends it, done, from any step. */
  finish: () => void
}

export const useTutorial = create<TutorialState>()(
  persist(
    (set, get) => ({
      done: false,
      step: null,
      start: () => set({ step: TUTORIAL_STEPS[0] }),
      next: () => {
        const { step } = get()
        if (!step) return
        const index = TUTORIAL_STEPS.indexOf(step)
        if (index >= TUTORIAL_STEPS.length - 1) set({ step: null, done: true })
        else set({ step: TUTORIAL_STEPS[index + 1] })
      },
      finish: () => set({ step: null, done: true }),
    }),
    { name: 'deliver-it-tutorial', partialize: (state) => ({ done: state.done }) },
  ),
)

/** `?tutorial=1` in the address starts the tutorial whatever the save says, at home. */
export function forcedTutorial(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('tutorial') === '1'
}

/**
 * Whether to start the tutorial when riding begins: forced, or never done by a new player. A save
 * from before the tutorial existed (with progress in it) is a returning player, who skips it.
 */
export function shouldStartTutorial(hasProgress: boolean): boolean {
  if (forcedTutorial()) return true
  const { done } = useTutorial.getState()
  if (done) return false
  if (hasProgress) {
    useTutorial.setState({ done: true })
    return false
  }
  return true
}
