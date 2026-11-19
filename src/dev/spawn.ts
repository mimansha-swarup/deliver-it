import type { LineFeature } from '../world/mapData'
import { getRoadWidth } from '../world/roadData'
import { clipToPlayArea } from '../world/roadGeometry'
import { lonLatToWorld, type GroundPoint } from '../world/worldUtils'

/*
 * Debug start: `?spawn=<street>` starts the rider on that street, in the left
 * lane, facing along it. Only in the dev server (and `vite preview`, which
 * builds for production, with `?debug`), so players never see it.
 *
 * The street is a slug of its name: "27th Main Road" is `27th-main-road`, and
 * the end can be left off, so `27th-main` works too. If several roads match,
 * the one with the longest stretch in the play area wins, and the rider starts
 * at that stretch's middle.
 */

export type Spawn = { name: string; x: number; z: number; heading: number }

/** Debug tools are on in the dev server, or anywhere with `?debug` in the address. */
export function isDebug(): boolean {
  if (import.meta.env.DEV) return true
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')
}

/**
 * Whether the address itself asks for debug (`?debug` or `?debug=1`), dev server or not: for what's
 * drawn over the game (the FPS overlay), which shouldn't be on screen just because it's the dev server.
 */
export function debugAsked(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')
}

export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Review streets, one for each street preset (streetPresets.ts):
 * `?spawn=shop-street`, `?spawn=residential-street` and `?spawn=main-road`.
 * 27th Main Road, the reference shop street, is `?spawn=27th-main` as before.
 */
export const REVIEW_STREETS: Record<string, string> = {
  'shop-street': '24th-main-road',
  'residential-street': '13th-cross-road',
  'main-road': 'sarjapur-road',
}

/**
 * The time of day asked for in the address with ?debug, as hours from 0 to 24 (`?hour=17.5` is
 * 17:30), or null. Read with ?spawn, so a review spot can be seen at golden hour straight away.
 */
export function requestedHour(): number | null {
  if (!isDebug() || typeof location === 'undefined') return null
  const value = new URLSearchParams(location.search).get('hour')
  if (value === null || value.trim() === '') return null
  const hours = Number(value)
  return Number.isFinite(hours) && hours >= 0 && hours < 24 ? hours : null
}

/** The weather asked for in the address with ?debug (`?weather=clear`, `cloudy` or `rain`), or null. */
export function requestedWeather(): 'clear' | 'cloudy' | 'rain' | null {
  if (!isDebug() || typeof location === 'undefined') return null
  const value = new URLSearchParams(location.search).get('weather')
  return value === 'clear' || value === 'cloudy' || value === 'rain' ? value : null
}

/** The street asked for in the address, or null. */
export function requestedSpawn(): string | null {
  if (!isDebug() || typeof location === 'undefined') return null
  const slug = new URLSearchParams(location.search).get('spawn')
  if (!slug) return null
  return REVIEW_STREETS[slugOf(slug)] ?? slugOf(slug)
}

/** Where to start on the street `slug`, or null if no road matches. */
export function findSpawn(roads: LineFeature[], slug: string): Spawn | null {
  const exact = roads.filter((road) => slugOf(road.properties.name ?? '') === slug)
  const matches = exact.length > 0 ? exact : roads.filter((road) => slugOf(road.properties.name ?? '').startsWith(`${slug}-`))
  let best: { road: LineFeature; start: GroundPoint; end: GroundPoint; length: number } | null = null
  for (const road of matches) {
    const points = road.geometry.coordinates.map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    for (let i = 0; i < points.length - 1; i++) {
      const clipped = clipToPlayArea(points[i], points[i + 1])
      if (!clipped) continue
      const [start, end] = clipped
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (!best || length > best.length) best = { road, start, end, length }
    }
  }
  if (!best || best.length === 0) {
    const names = [...new Set(roads.map((road) => road.properties.name).filter(Boolean))].slice(0, 12).map((name) => slugOf(name as string))
    console.warn(`[spawn] no street matches "${slug}". Some that do exist: ${names.join(', ')}`)
    return null
  }
  const { road, start, end, length } = best
  const forwardX = (end[0] - start[0]) / length
  const forwardZ = (end[1] - start[1]) / length
  // In the left lane, as traffic keeps left: a quarter of the road's width to the left of the middle.
  const left = getRoadWidth(road) / 4
  const spawn = {
    name: road.properties.name ?? slug,
    x: (start[0] + end[0]) / 2 + forwardZ * left,
    z: (start[1] + end[1]) / 2 - forwardX * left,
    heading: Math.atan2(forwardX, forwardZ),
  }
  console.info(`[spawn] starting on ${spawn.name}`, spawn)
  return spawn
}

/** Puts the rider at a spawn, standing still. */
export function placeAt(scooter: { x: number; z: number; heading: number; speed: number; velocityX: number; velocityZ: number }, spawn: Spawn) {
  scooter.x = spawn.x
  scooter.z = spawn.z
  scooter.heading = spawn.heading
  scooter.speed = 0
  scooter.velocityX = 0
  scooter.velocityZ = 0
}

/**
 * Debug: `?streets=reference` dresses only 27th Main Road, the reference
 * street, and leaves the rest of the map on the plain ground, as it was before
 * the street presets were rolled out. For comparing what the rollout costs.
 */
export function referenceStreetsOnly(): string[] | undefined {
  if (!isDebug() || typeof location === 'undefined') return undefined
  return new URLSearchParams(location.search).get('streets') === 'reference' ? ['27th Main Road'] : undefined
}
