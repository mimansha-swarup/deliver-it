import { useEffect, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { tuning } from '../vehicle/tuning'
import { useDriveInput } from '../vehicle/useDriveInput'
import { createAmbience, playThud } from './ambience'
import { getAudio } from './audioEngine'
import { createEngineVoice, type EngineVoice } from './engines'

/** How quickly revs follow the throttle, per second. Revving up is quicker than dropping. */
const REV_UP = 4
const REV_DOWN = 2.5
/** Holding the throttle while stopped, the engine revs this high, from 0 to 1. */
const STANDING_REV = 0.55

/**
 * Sounds that follow the rider: the scooter's engine, tyre skid, crash thuds,
 * and the neighbourhood around them. They start once sound is allowed, after
 * Start riding is pressed. Draws nothing.
 */
export function PlayerSounds({ scooter }: { scooter: RefObject<ScooterState> }) {
  const input = useDriveInput()
  const engine = useRef<EngineVoice | null>(null)
  const ambience = useRef<ReturnType<typeof createAmbience> | null>(null)
  const revs = useRef(0)
  const crashes = useRef(0)

  useEffect(
    () => () => {
      engine.current?.dispose()
      engine.current = null
    },
    [],
  )

  useFrame((_, delta) => {
    const audio = getAudio()
    if (!audio || !useGameStore.getState().started) return
    const dt = Math.min(delta, 0.1)
    engine.current ??= createEngineVoice(audio.context, audio.sfx, 'scooter')
    ambience.current ??= createAmbience(audio.context, audio.sfx)

    const state = scooter.current
    const speed = getTravelSpeed(state)
    const throttle = input.current.forward ? 1 : 0
    const riding = state.crashLeft === 0

    // Revs follow speed, and the throttle adds a bit more. Standing still on the
    // throttle revs the engine, as it does for real while waiting at a light.
    const wanted = riding ? Math.max(Math.min(speed / tuning.maxSpeed, 1) * 0.85 + throttle * 0.15, throttle * STANDING_REV) : 0
    const rate = wanted > revs.current ? REV_UP : REV_DOWN
    revs.current += (wanted - revs.current) * (1 - Math.exp(-rate * dt))
    // A crash stalls the engine until the rider is back on.
    engine.current.update(revs.current, riding ? throttle : 0, riding ? 1 : 0)

    ambience.current.update(
      { night: liveSky.look.night, rain: liveSky.rain, slide: riding ? Math.abs(state.slip) : 0 },
      dt,
    )

    if (state.crashCount !== crashes.current) {
      crashes.current = state.crashCount
      playThud(audio.context, audio.sfx, Math.max(0.5, state.impact))
    }
  })

  return null
}
