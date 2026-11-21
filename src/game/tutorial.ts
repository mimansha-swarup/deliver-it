import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { saveKey } from './saveKeys'

/*
 * The tutorial's progress: whether it's been done (the "tutorialDone" flag, saved), and the step
 * it's on now (not saved: a reload mid-tutorial starts it again from the top).
 */

/**
 * The first five minutes (VISION.md): open on an order, ride it, a doorstep scene, a tip, then
 * "you're free to explore". Four steps and no more: take the order that's waiting, ride (learnt on
 * the way), pick up at the dark store, deliver. Everything else (the map, GaadiGo, going offline)
 * is told afterwards in passing, by Ravi and by the phone's own notifications, not as steps to sit through.
 */
export const TUTORIAL_STEPS = ['accept', 'ride', 'pickup', 'deliver'] as const
export type TutorialStep = (typeof TUTORIAL_STEPS)[number]

type TutorialState = {
  done: boolean
  /** Asked for again from the menu's Settings: it plays on the next ride, progress or not. Saved. */
  replay: boolean
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
      replay: false,
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
    { name: saveKey('swalpa-fast-tutorial'), partialize: (state) => ({ done: state.done, replay: state.replay }) },
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
/** Riding with friends in a room: the tutorial waits for a ride alone (it isn't marked done). */
export const tutorialHold = { on: false }

export function shouldStartTutorial(hasProgress: boolean): boolean {
  if (forcedTutorial()) return true
  if (tutorialHold.on) return false
  const { done, replay } = useTutorial.getState()
  if (replay) {
    useTutorial.setState({ replay: false })
    return true
  }
  if (done) return false
  if (hasProgress) {
    useTutorial.setState({ done: true })
    return false
  }
  return true
}

/** The first order as it was planned (ui/Tutorial.tsx): how far it is in all, and what's at the door. For timing the first five minutes. */
export const firstOrder = { metres: 0, scene: '' }
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
  ;(window as unknown as { __deliverItFirstOrder?: typeof firstOrder }).__deliverItFirstOrder = firstOrder
}
