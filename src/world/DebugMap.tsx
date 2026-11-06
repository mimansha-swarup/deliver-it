import { useMemo } from 'react'
import type { MapData } from './mapData'
import { lonLatToWorld, PLAY_AREA_SIZE, type LonLat } from './worldUtils'

const DEBUG_COLORS = {
  road: '#2f3136',
  footway: '#55705f',
  place: '#1677c9',
  playArea: '#ffe14d',
}

/**
 * Packs polylines into one flat array of [x, y, z] numbers. LineSegments reads
 * the array two points at a time, so each pair of neighbouring points is stored.
 */
function toSegmentPositions(lines: LonLat[][], height: number): Float32Array {
  const positions: number[] = []

  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      positions.push(...lonLatToWorld(line[i], height), ...lonLatToWorld(line[i + 1], height))
    }
  }

  return new Float32Array(positions)
}

function LineLayer({ lines, color, height }: { lines: LonLat[][]; color: string; height: number }) {
  const positions = useMemo(() => toSegmentPositions(lines, height), [lines, height])

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} />
    </lineSegments>
  )
}

function PointLayer({ points, color, height }: { points: LonLat[]; color: string; height: number }) {
  const positions = useMemo(
    () => new Float32Array(points.flatMap((point) => lonLatToWorld(point, height))),
    [points, height],
  )

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={color} size={5} sizeAttenuation={false} />
    </points>
  )
}

function PlayAreaOutline({ height }: { height: number }) {
  const corners = useMemo(() => {
    const half = PLAY_AREA_SIZE / 2
    return new Float32Array([
      -half, height, -half,
      half, height, -half,
      half, height, half,
      -half, height, half,
    ])
  }, [height])

  return (
    <lineLoop>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[corners, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={DEBUG_COLORS.playArea} />
    </lineLoop>
  )
}

/** Temporary guide lines for roads, places and the play area boundary. */
export function DebugMap({ data }: { data: MapData }) {
  const roads = useMemo(() => data.roads.map((r) => r.geometry.coordinates), [data])
  const footways = useMemo(() => data.footways.map((f) => f.geometry.coordinates), [data])
  const places = useMemo(() => data.places.map((p) => p.geometry.coordinates), [data])

  return (
    <>
      <LineLayer lines={footways} color={DEBUG_COLORS.footway} height={0.2} />
      <LineLayer lines={roads} color={DEBUG_COLORS.road} height={0.3} />
      <PointLayer points={places} color={DEBUG_COLORS.place} height={1} />
      <PlayAreaOutline height={0.4} />
    </>
  )
}
