import { create } from 'zustand'

/*
 * Traffic police at the major junctions: the widest signal junctions on the map, and the Agara
 * junction. A policeman stands at the lights of each (World.tsx places them). Two things there
 * cost money (traffic/JunctionWatch.tsx): riding over the stop line on red, and being waved down
 * for a helmet check without a helmet on. With one on, the check is a nod and a wave.
 */

export type PolicePost = { x: number; z: number; rotation: number; junction: number; name: string }

export const policePosts: { list: PolicePost[] } = { list: [] }

export const POLICE = {
  /** How many junctions besides Agara's have a policeman, and how far apart they must be, in metres. */
  junctions: 5,
  spacing: 320,
  /** A helmet check happens within this far of the policeman, in metres, below this speed (m/s): slow enough to be waved down. */
  checkRange: 20,
  checkSpeed: 9,
  /** The chance of a check on coming up to a policeman with a helmet on; without one, it's certain. No two checks within this long (seconds). */
  checkChance: 0.35,
  checkGap: 150,
  helmetFine: 100,
}

/** The card on screen while the policeman has the rider's attention. */
export const usePolice = create<{ card: { title: string; line: string; fine: number; where: string } | null }>(() => ({ card: null }))

/** Shows a card for a few seconds. */
export function showPoliceCard(card: { title: string; line: string; fine: number; where: string }, ms = 4200) {
  usePolice.setState({ card })
  window.setTimeout(() => {
    if (usePolice.getState().card === card) usePolice.setState({ card: null })
  }, ms)
}
