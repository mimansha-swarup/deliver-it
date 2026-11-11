import { useGameStore } from '../game/gameStore'
import { STATIONS, type Station } from './stations'

/** The radio station that's on, from the saved settings. */
export function useStation(): Station {
  const stationId = useGameStore((state) => state.stationId)
  return STATIONS.find(({ id }) => id === stationId) ?? STATIONS[0]
}
