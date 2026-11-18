import { addPost, addWall, type CollisionWorld } from './collision'
import type { MapData } from './mapData'
import { createRandom } from './props'
import { isRingInPlayArea, lonLatToWorld, type GroundPoint } from './worldUtils'

/*
 * The map's sports pitches (leisure=pitch), which were drawn as plain lawn and read as empty
 * fields: a cricket maidan worn to the red earth with a rolled clay strip, creases and stumps;
 * basketball courts in red oxide with their lines and hoops; tennis, badminton and volleyball
 * courts in green with a net; football goals. Each sits in the pitch's outline, turned along its
 * longest side, and a few kids are out playing on some. Drawn by SportsPitches.tsx.
 */

export type PitchSport = 'cricket' | 'basketball' | 'net' | 'football' | 'kabaddi' | 'ground'

export type Pitch = {
  sport: PitchSport
  /** The middle of the pitch's box, its direction along the long side (radians), and its half extents. */
  x: number
  z: number
  angle: number
  halfLength: number
  halfWidth: number
  outline: GroundPoint[]
}

/** Where someone stands on a pitch, facing `heading`, and whether they're a kid (the teen body). */
export type Player = { x: number; z: number; heading: number }

const SPORTS: Record<string, PitchSport> = {
  cricket: 'cricket',
  cricket_nets: 'cricket',
  basketball: 'basketball',
  tennis: 'net',
  badminton: 'net',
  volleyball: 'net',
  'badminton;volleyball': 'net',
  soccer: 'football',
  football: 'football',
  kabadi: 'kabaddi',
  kabaddi: 'kabaddi',
}

/** A court's real size, length by width, in metres: shrunk to fit a smaller outline. */
export const COURT: Record<'basketball' | 'net' | 'kabaddi', [number, number]> = { basketball: [28, 15], net: [23.8, 11], kabaddi: [13, 10] }

/** Turns a point `along` and `across` a pitch into world x and z. */
export function pitchPoint(pitch: Pitch, along: number, across: number): [number, number] {
  const cos = Math.cos(pitch.angle)
  const sin = Math.sin(pitch.angle)
  return [pitch.x + cos * along - sin * across, pitch.z + sin * along + cos * across]
}

/** A court's size on this pitch: its real size, or as much as fits with a metre to spare. */
export function courtSize(pitch: Pitch, kind: keyof typeof COURT): [number, number] {
  const [length, width] = COURT[kind]
  const scale = Math.min(1, (pitch.halfLength * 2 - 2) / length, (pitch.halfWidth * 2 - 2) / width)
  return [length * Math.max(scale, 0.5), width * Math.max(scale, 0.5)]
}

function boxOf(outline: GroundPoint[]): { x: number; z: number; angle: number; halfLength: number; halfWidth: number } {
  let angle = 0
  let longest = 0
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    const length = Math.hypot(bx - ax, bz - az)
    if (length > longest) {
      longest = length
      angle = Math.atan2(bz - az, bx - ax)
    }
  }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const alongs = outline.map(([x, z]) => x * cos + z * sin)
  const acrosses = outline.map(([x, z]) => -x * sin + z * cos)
  const [minAlong, maxAlong] = [Math.min(...alongs), Math.max(...alongs)]
  const [minAcross, maxAcross] = [Math.min(...acrosses), Math.max(...acrosses)]
  const along = (minAlong + maxAlong) / 2
  const across = (minAcross + maxAcross) / 2
  return {
    x: cos * along - sin * across,
    z: sin * along + cos * across,
    angle,
    halfLength: (maxAlong - minAlong) / 2,
    halfWidth: (maxAcross - minAcross) / 2,
  }
}

export function findPitches(data: MapData): Pitch[] {
  const pitches: Pitch[] = []
  for (const park of data.parks) {
    const properties = park.properties as { leisure?: string; sport?: string }
    if (properties.leisure !== 'pitch') continue
    const ring = park.geometry.coordinates[0]
    if (!isRingInPlayArea(ring)) continue
    const outline = ring.slice(0, -1).map((position): GroundPoint => {
      const [x, , z] = lonLatToWorld(position)
      return [x, z]
    })
    const box = boxOf(outline)
    if (box.halfLength < 4 || box.halfWidth < 3) continue
    pitches.push({ sport: SPORTS[properties.sport ?? ''] ?? 'ground', outline, ...box })
  }
  return pitches
}

/** Whether a park on the map is a sports pitch, which gets no trees (parkPlanting.ts). */
export function isPitch(park: MapData['parks'][number]): boolean {
  return (park.properties as { leisure?: string }).leisure === 'pitch'
}

/**
 * Makes the hoops, goals and nets solid, and puts kids out playing: a game of cricket on the
 * maidans (batter, bowler, keeper and a few fielders), a few shooting hoops.
 */
export function planPitches(pitches: Pitch[], collisions: CollisionWorld): Player[] {
  const random = createRandom(20261119)
  const players: Player[] = []
  const stand = (pitch: Pitch, along: number, across: number, facing: number) => {
    const [x, z] = pitchPoint(pitch, along, across)
    players.push({ x, z, heading: Math.atan2(Math.cos(pitch.angle + facing), Math.sin(pitch.angle + facing)) })
  }
  for (const pitch of pitches) {
    if (pitch.sport === 'basketball') {
      const [length] = courtSize(pitch, 'basketball')
      for (const end of [-1, 1]) addPost(collisions, ...pitchPoint(pitch, end * (length / 2 + 0.6), 0), 0.25)
      for (let i = 0; i < 3; i++) stand(pitch, length / 2 - 4 - random() * 3, (random() - 0.5) * 6, 0)
    } else if (pitch.sport === 'net') {
      const [, width] = courtSize(pitch, 'net')
      addWall(collisions, pitchPoint(pitch, 0, -width / 2 - 0.5), pitchPoint(pitch, 0, width / 2 + 0.5), 0.1)
    } else if (pitch.sport === 'football') {
      for (const end of [-1, 1]) for (const side of [-1, 1]) addPost(collisions, ...pitchPoint(pitch, end * (pitch.halfLength - 2), side * 1.8), 0.1)
    } else if (pitch.sport === 'cricket') {
      for (const end of [-1, 1]) addPost(collisions, ...pitchPoint(pitch, end * 10, 0), 0.15)
      // The batter at one end, the keeper behind, the bowler at the other, fielders scattered.
      stand(pitch, -9.4, 0.4, 0)
      stand(pitch, -11.5, 0, 0)
      stand(pitch, 11.5, -0.6, Math.PI)
      const reach = Math.min(pitch.halfLength, pitch.halfWidth) * 0.75
      for (let i = 0; i < 4; i++) {
        const turn = random() * Math.PI * 2
        const out = 8 + random() * Math.max(2, reach - 8)
        stand(pitch, Math.cos(turn) * out, Math.sin(turn) * out * (pitch.halfWidth / Math.max(pitch.halfLength, 1)), Math.PI + turn)
      }
    }
  }
  return players
}
