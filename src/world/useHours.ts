import { useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { liveSky } from '../game/livePlayer'

/** Whether the game's clock is between two hours, checked as it runs: for life that's out at set times. */
export function useHours([from, to]: [number, number]): boolean {
  const [within, setWithin] = useState(false)
  useFrame(() => {
    const now = liveSky.hours >= from && liveSky.hours < to
    if (now !== within) setWithin(now)
  })
  return within
}
