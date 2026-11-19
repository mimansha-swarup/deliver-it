/**
 * Where things are at Agara, for the code that isn't the world: sounds near the temples and the
 * junction, the title card, the Namma spots and the photo prompt. The world fills this in as it's
 * built (World.tsx); until then there's nothing, and nothing sounds or shows.
 */
type Spot = { x: number; z: number }

export const agaraPlaces = {
  /** The Anjaneya temple's door, the statue, and the Jagannath temple. */
  temple: null as Spot | null,
  statue: null as Spot | null,
  jagannath: null as Spot | null,
  /** Where Outer Ring Road meets the flyover's ramp: the Agara junction. */
  junction: null as Spot | null,
  /** The lake's middle, and how far out its water reaches. */
  lake: null as (Spot & { reach: number }) | null,
  /** Whether a flyover deck or the viaduct is overhead at a point. */
  isUnderDeck: (() => false) as (x: number, z: number) => boolean,
}

/** The game's days run Monday first, so day 6 is the first Saturday: Hanuman's day. */
export const isSaturday = (day: number) => (((day - 1) % 7) + 7) % 7 === 5
/** A festival day at the Jagannath temple: every ninth day, from day 4 (so the first week has one). */
export const isFestivalDay = (day: number) => day >= 4 && (day - 4) % 9 === 0
