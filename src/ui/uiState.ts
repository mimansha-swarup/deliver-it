import { create } from 'zustand'
import type { AppId } from './phoneAppList'

/** What's open on screen, outside the game's own state: the full map, and the app showing on the raised phone. Not saved. */
export const useUi = create<{ mapOpen: boolean; phoneApp: AppId | null }>(() => ({ mapOpen: false, phoneApp: null }))

export function setMapOpen(mapOpen: boolean) {
  useUi.setState({ mapOpen })
}

/**
 * The step of the moment, when something more exact than the order's phase is going on (on foot at a
 * doorstep, at the dark store's counter): the objective line shows it instead of its own line.
 */
export const useSteps = create<{ step: string | null }>(() => ({ step: null }))

export function setStep(step: string | null) {
  if (useSteps.getState().step !== step) useSteps.setState({ step })
}
