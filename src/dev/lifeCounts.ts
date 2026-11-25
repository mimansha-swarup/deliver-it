/*
 * How much street life is out just now, for the benchmark's report (scripts/traffic_bench.mjs reads
 * `__deliverItCounts()` with ?debug) and for anyone asking from the console. Each part of the
 * street writes its own number as it picks who to draw; nothing reads these in play.
 */
export const lifeCounts = {
  /** People standing at shops, stalls, carts and bus stops, and pacing the shop fronts, drawn now. */
  shopPeople: 0,
  shopWalkers: 0,
  /** People who can be talked to: on the map, and drawn now. */
  talkers: 0,
  talkersDrawn: 0,
  /** Stray dogs trotting about now. */
  dogs: 0,
  /** People at bus stops waiting just now, walking to a bus's door just now, and how many have got on one since the game began. */
  atStops: 0,
  boarding: 0,
  boarded: 0,
}
