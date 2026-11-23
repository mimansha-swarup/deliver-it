import { useEffect, useRef, type RefObject } from 'react'
import { timedFrame } from '../dev/frameTimes'
import { useGameStore } from '../game/gameStore'
import { liveSky, livePlayer } from '../game/livePlayer'
import { getTravelSpeed, type ScooterState } from '../vehicle/ScooterController'
import { tuning } from '../vehicle/tuning'
import { useDriveInput } from '../vehicle/useDriveInput'
import { createAmbience, playCrash, playFootstep, playSplash, playThud, type Footing } from './ambience'
import { FOOT } from '../vehicle/ScooterController'
import { liveRoom } from '../game/rooms'
import { Surface, worldSurface } from '../world/surfaceMap'
import { getAudio } from './audioEngine'
import { createEngineVoice, type EngineVoice } from './engines'
import { createPlaceSounds } from './placeSounds'
import { createAreaSounds } from './areaSounds'
import { liveVehicle } from '../vehicle/vehicleCatalog'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('audio updates')

/** The engine, the street and the weather are mixed this often, in seconds (see the frame loop). */
const MIX_EVERY = 1 / 30

/** How quickly revs follow the throttle, per second. Revving up is quicker than dropping. */
const REV_UP = 4
const REV_DOWN = 2.5
/** Holding the throttle while stopped, the engine revs this high, from 0 to 1. */
const STANDING_REV = 0.55

/** One tick of a bicycle's chain or freewheel: a few milliseconds of a bright, hollow note. */
function chainTick(context: AudioContext, output: AudioNode, volume: number, pitch: number) {
  const start = context.currentTime + 0.005
  const tone = context.createOscillator()
  tone.type = 'square'
  tone.frequency.value = pitch * (0.92 + Math.random() * 0.16)
  const level = context.createGain()
  level.gain.setValueAtTime(volume, start)
  level.gain.exponentialRampToValueAtTime(0.0001, start + 0.018)
  tone.connect(level).connect(output)
  tone.start(start)
  tone.stop(start + 0.03)
}

/**
 * Sounds that follow the rider: the scooter's engine, tyre skid, crash thuds,
 * and the neighbourhood around them. They start once sound is allowed, after
 * Start riding is pressed. Draws nothing.
 */
/** Slower than this, in m/s, a step makes no sound: shuffling round on the spot. */
const FOOTSTEP_FROM = 0.7

export function PlayerSounds({ scooter }: { scooter: RefObject<ScooterState> }) {
  /** How many steps the rider has taken on foot, to hear each new one. */
  const stepsTaken = useRef(0)
  const input = useDriveInput()
  const engine = useRef<EngineVoice | null>(null)
  const ambience = useRef<ReturnType<typeof createAmbience> | null>(null)
  const places = useRef<ReturnType<typeof createPlaceSounds> | null>(null)
  const area = useRef<ReturnType<typeof createAreaSounds> | null>(null)
  const engineOf = useRef<string | null>(null)
  const untilTick = useRef(0)
  const revs = useRef(0)
  const crashes = useRef(0)
  const bumps = useRef(0)
  const bagBounces = useRef(0)
  const sinceMix = useRef(MIX_EVERY)
  const splashes = useRef(0)

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
    // The vehicle's own engine (vehicleCatalog.ts): a new voice when the vehicle changes.
    const vehicle = liveVehicle.spec
    if (engineOf.current !== vehicle.engine) {
      engine.current?.dispose()
      engine.current = null
      engineOf.current = vehicle.engine
    }
    engine.current ??= createEngineVoice(audio.context, audio.sfx, vehicle.engine)
    ambience.current ??= createAmbience(audio.context, audio.sfx)
    places.current ??= createPlaceSounds(audio.context, audio.sfx)
    area.current ??= createAreaSounds(audio.context, audio.sfx)

    const state = scooter.current
    const speed = getTravelSpeed(state)
    // The throttle as the engine has it: the drive follows the key at the vehicle's own rate (ScooterController), so the sound opens up as the pull does.
    const throttle = input.current.forward ? Math.max(0.35, state.drive ?? 1) : 0
    const riding = state.crashLeft === 0

    // The mix is set 30 times a second, not every frame: each setting is a handful of scheduled
    // changes to the audio graph, and on a 120 Hz screen four times as many as the ear can tell apart
    // were being made. What happens at a moment (a thud, a splash, a step) is still caught every frame.
    sinceMix.current += dt
    const mix = sinceMix.current >= MIX_EVERY
    const mixDt = sinceMix.current
    if (mix) sinceMix.current = 0
    if (mix) {
      // Revs follow speed, and the throttle adds a bit more. Standing still on the
      // throttle revs the engine, as it does for real while waiting at a light.
      const wanted = riding ? Math.max(Math.min(speed / tuning.maxSpeed, 1) * 0.85 + throttle * 0.15, throttle * STANDING_REV) : 0
      const rate = wanted > revs.current ? REV_UP : REV_DOWN
      revs.current += (wanted - revs.current) * (1 - Math.exp(-rate * mixDt))
      // A crash stalls the engine until the rider is back on.
      // An electric motor is a quiet whine, and a bicycle makes no engine sound at all.
      engine.current.update(revs.current, riding ? throttle : 0, riding ? vehicle.engineVolume : 0)

      ambience.current.update(
        // A fallen scooter sliding on its side scrapes too, for as long as it's moving.
        { night: liveSky.look.night, rain: liveSky.rain, slide: riding ? Math.abs(state.slip) : 0, rolling: riding && vehicle.id !== 'bicycle' ? Math.min(1, speed / 16) : riding ? Math.min(1, speed / 16) * 0.4 : 0, wet: Math.max(liveSky.rain, state.puddle), scrape: Math.max(state.scrape, riding || state.pickedUp ? 0 : Math.min(1, speed / 7)) },
        mixDt,
      )
    }

    // A bicycle's own sound: the chain ticking over as it's pedalled, the freewheel's quicker, lighter
    // tick when it's coasting.
    if (vehicle.id === 'bicycle' && riding && speed > 0.6) {
      untilTick.current -= dt
      if (untilTick.current <= 0) {
        const pedalling = throttle > 0
        untilTick.current = pedalling ? 1 / Math.max(2, speed * 1.6) : 1 / Math.max(6, speed * 4.5)
        chainTick(audio.context, audio.sfx, pedalling ? 0.05 : 0.028, pedalling ? 1500 : 3200)
      }
    }

    // Temple bells, the junction's horns, rain on and under the flyover (placeSounds.ts).
    if (mix) {
      places.current.update(
        { x: state.x, z: state.z, height: Math.min(state.frontWheel.height, state.rearWheel.height), rain: liveSky.rain, night: liveSky.look.night, hours: liveSky.hours },
        mixDt,
      )
    }

    // The sounds of where the rider is: the street's traffic, a signal's horns, a shop's radio, a vendor, a temple, the lake, rain on what's around (areaSounds.ts).
    if (mix) area.current.update({ x: livePlayer.x, z: livePlayer.z, night: liveSky.look.night, rain: liveSky.rain, hours: liveSky.hours, speed, indoors: livePlayer.indoors }, mixDt)

    // Footsteps on foot: one as each foot comes down (twice a stride), on what's under it.
    const rider = state.rider
    const steps = Math.floor(rider.stride / Math.PI)
    if (rider.phase === 'afoot' && steps !== stepsTaken.current && rider.pace > FOOTSTEP_FROM) {
      const under = liveRoom.kind ? null : (worldSurface.map?.at(rider.x, rider.z) ?? Surface.Road)
      const footing: Footing =
        under === null ? 'tile' : under === Surface.Road || under === Surface.Median ? 'road' : under === Surface.Footpath || under === Surface.Paved || under === Surface.Building ? 'paving' : 'earth'
      playFootstep(audio.context, audio.sfx, footing, Math.min(1, Math.max(0, (rider.pace - FOOT.walk) / (FOOT.run - FOOT.walk))))
    }
    stepsTaken.current = steps

    if (state.crashCount !== crashes.current) {
      crashes.current = state.crashCount
      playCrash(audio.context, audio.sfx, Math.max(0.4, state.impact))
    }
    // The box knocked off in a crash: a hollow knock each time it hits the road.
    if (state.bag.bounces !== bagBounces.current) {
      bagBounces.current = state.bag.bounces
      playThud(audio.context, audio.sfx, 0.1 + state.bag.lastBounce * 0.35)
    }
    // Landing off a breaker or a kerb: a softer thud than a crash.
    if (state.bumpCount !== bumps.current) {
      bumps.current = state.bumpCount
      playThud(audio.context, audio.sfx, 0.08 + state.bump * 0.3)
    }
    if (state.splashCount !== splashes.current) {
      splashes.current = state.splashCount
      playSplash(audio.context, audio.sfx, Math.min(1, state.splashSpeed / tuning.maxSpeed))
    }
  })

  return null
}
