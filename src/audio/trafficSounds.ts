import type { Vehicle, VehicleKind } from '../traffic/trafficLogic'
import { playThud } from './ambience'
import { getAudio } from './audioEngine'
import { createEngineVoice, type EngineKind, type EngineVoice } from './engines'
import type { Listener } from './horns'

/** Only this many vehicles are heard at once, the nearest, within this far, in metres. */
const VOICES = 3
const HEARING = 45
/** Closer than this, an engine is at full volume, in metres. */
const NEAR = 5
/** How often the nearest vehicles are picked again, in seconds. */
const REPICK_EVERY = 0.4

const ENGINE_FOR: Record<VehicleKind, EngineKind> = {
  sedan: 'car',
  hatchback: 'car',
  suv: 'suv',
  mpv: 'car',
  auto: 'auto',
  bike: 'bike',
}

/** Where a sound is, for the ears: how loud for its distance, and how far left or right. */
export function placeSound(x: number, z: number, listener: Listener, near = NEAR) {
  const offsetX = x - listener.x
  const offsetZ = z - listener.z
  const distance = Math.hypot(offsetX, offsetZ)
  const volume = Math.min(1, near / Math.max(distance, 0.001))
  // To the listener's right is (-cos, sin) of their heading.
  const pan = distance > 0.5
    ? ((-offsetX * Math.cos(listener.heading) + offsetZ * Math.sin(listener.heading)) / distance) * 0.8
    : 0
  return { distance, volume, pan }
}

const voices: (EngineVoice | null)[] = []
const heard: (Vehicle | null)[] = []
let sinceRepick = 0

/**
 * The engines of the few nearest moving vehicles. Each voice is kept and handed
 * to whichever vehicle is near, rather than one per vehicle, so a jam of thirty
 * cars costs three voices, not thirty.
 */
export function updateTrafficSounds(vehicles: Vehicle[], listener: Listener, dt: number) {
  const audio = getAudio()
  if (!audio) return

  sinceRepick += dt
  if (sinceRepick >= REPICK_EVERY) {
    sinceRepick = 0
    heard.length = 0
    for (let slot = 0; slot < VOICES; slot++) {
      let best: Vehicle | null = null
      let bestDistance = HEARING
      for (const vehicle of vehicles) {
        if (vehicle.lane === -1 || vehicle.body || vehicle.fallen || heard.includes(vehicle)) continue
        const distance = Math.hypot(vehicle.x - listener.x, vehicle.z - listener.z)
        if (distance < bestDistance) {
          best = vehicle
          bestDistance = distance
        }
      }
      heard.push(best)
    }
  }

  for (let slot = 0; slot < VOICES; slot++) {
    const vehicle = heard[slot] ?? null
    const voice = (voices[slot] ??= createEngineVoice(audio.context, audio.sfx, 'car'))
    if (!vehicle) {
      voice.update(0, 0, 0)
      continue
    }
    voice.setKind(ENGINE_FOR[vehicle.kind])
    const { volume, pan } = placeSound(vehicle.x, vehicle.z, listener)
    const share = vehicle.cruiseSpeed > 0 ? vehicle.speed / vehicle.cruiseSpeed : 0
    // Pulling away works the engine; cruising, it's lighter on the throttle.
    const throttle = share < 0.9 && vehicle.speed > 0.3 ? 0.8 : 0.3
    voice.update(0.15 + share * 0.6, throttle, volume, pan)
  }
}

/** A thud where something was hit, quieter and to one side with distance. */
export function playImpact(x: number, z: number, strength: number, listener: Listener) {
  const audio = getAudio()
  if (!audio) return
  const { distance, volume, pan } = placeSound(x, z, listener, 8)
  if (distance > 60) return
  playThud(audio.context, audio.sfx, strength * volume, pan)
}
