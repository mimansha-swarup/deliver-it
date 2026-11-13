/**
 * The rider's level, worked out from XP, and what each level unlocks.
 *
 * Reaching level L takes 50 × (L − 1) × L XP in all, so each level needs 100 XP
 * more than the one before: 100 for level 2, 300 for 3, 600 for 4, 1,000 for 5.
 * A delivery gives about 25–70 XP. The level is never saved: it's always worked
 * out from the saved XP, so old saves get the right level straight away.
 */
export const MAX_LEVEL = 20

/** Total XP needed to reach a level. */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level
}

export function levelFromXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++
  return level
}

/** How far through the current level the rider is, for a progress bar. */
export function levelProgress(xp: number) {
  const level = levelFromXp(xp)
  if (level === MAX_LEVEL) return { level, into: 0, needed: 0, share: 1 }
  const start = xpForLevel(level)
  const needed = xpForLevel(level + 1) - start
  return { level, into: xp - start, needed, share: (xp - start) / needed }
}

/** The level each new kind of work opens at. */
export const UNLOCK_LEVELS = {
  longHaul: 2,
  rush: 3,
  nightPay: 4,
  doubleDrop: 5,
}

/** What reaching each level opens up, in the words the level-up card uses. */
const UNLOCK_TEXT: Record<number, string> = {
  [UNLOCK_LEVELS.longHaul]: 'Long haul orders',
  [UNLOCK_LEVELS.rush]: 'Rush orders: a tighter timer, a bigger bonus',
  [UNLOCK_LEVELS.nightPay]: 'Night shift: +25% pay after dark',
  [UNLOCK_LEVELS.doubleDrop]: 'Double drops: two customers, two base pays',
}

/** Everything unlocked by going from one level up to another. */
export function unlocksBetween(fromLevel: number, toLevel: number): string[] {
  const unlocks: string[] = []
  for (let level = fromLevel + 1; level <= toLevel; level++) {
    if (UNLOCK_TEXT[level]) unlocks.push(UNLOCK_TEXT[level])
  }
  return unlocks
}
