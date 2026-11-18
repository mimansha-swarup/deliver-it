import { create } from 'zustand'

/** What's open on screen, outside the game's own state: the full map. Not saved. */
export const useUi = create<{ mapOpen: boolean }>(() => ({ mapOpen: false }))

export function setMapOpen(mapOpen: boolean) {
  useUi.setState({ mapOpen })
}
