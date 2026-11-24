/*
 * How much of the traffic, and how many of the people, are out at each hour: thick from nine to
 * eleven in the morning and from six to nine in the evening, steady through the day, thin late at
 * night. A share of what the quality setting allows (qualitySettings.ts), never more than it.
 */

type Curve = [hour: number, share: number][]

const TRAFFIC: Curve = [[0, 0.18], [4.5, 0.15], [6, 0.35], [8, 0.82], [9, 1], [11, 1], [12, 0.72], [13.5, 0.78], [16, 0.72], [17.5, 0.92], [18, 1], [21, 1], [22, 0.6], [23.5, 0.28], [24, 0.18]]
const PEOPLE: Curve = [[0, 0.08], [5, 0.1], [7, 0.6], [9, 0.9], [11, 0.8], [13, 0.7], [17, 0.9], [19, 1], [21, 0.8], [22.5, 0.35], [24, 0.08]]

function at(curve: Curve, hours: number): number {
  const hour = ((hours % 24) + 24) % 24
  for (let i = 1; i < curve.length; i++) {
    const [h1, s1] = curve[i]
    if (hour > h1) continue
    const [h0, s0] = curve[i - 1]
    return s0 + ((s1 - s0) * (hour - h0)) / (h1 - h0 || 1)
  }
  return curve[curve.length - 1][1]
}

/** The share of the vehicles out at `hours` (0 to 24). */
export const trafficShare = (hours: number) => at(TRAFFIC, hours)
/** The share of the people out on the footpaths at `hours`. */
export const peopleShare = (hours: number) => at(PEOPLE, hours)
