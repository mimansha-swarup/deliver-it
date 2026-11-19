/*
 * Rush hour on Outer Ring Road: about 9 in the morning and 6 in the evening, an hour and a half
 * either side. The road jams by the Agara junction (trafficLogic.ts), its horns thicken
 * (placeSounds.ts), and deliveries pay a surge while it lasts.
 */

/** How much of a rush hour it is, 0 to 1: peaks at 9:00 and 18:00, an hour and a half either side. */
export const rushHour = (hours: number) => Math.max(0, 1 - Math.min(Math.abs(hours - 9), Math.abs(hours - 18)) / 1.5)

/** The surge at the height of the rush, as a share of a delivery's base and distance pay. */
const SURGE_AT_PEAK = 0.3
/** The rush counts as on above this. */
export const RUSH_ON = 0.25

/** The surge on a delivery handed over now, as a share of its base and distance pay (0 outside the rush). */
export const surgeShare = (hours: number) => {
  const rush = rushHour(hours)
  return rush > RUSH_ON ? Math.round(SURGE_AT_PEAK * rush * 100) / 100 : 0
}

/** A signal jumped under the traffic police's eye costs this much. */
export const SIGNAL_FINE = 120
