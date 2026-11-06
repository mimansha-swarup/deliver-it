import { PLAY_AREA, PLAY_AREA_DEPTH, PLAY_AREA_WIDTH } from './worldUtils'

const WALL_HEIGHT = 1.5
const WALL_THICKNESS = 0.4
const WALL_COLOR = '#b8b3a6'

/** A low wall around the play area, so the edge of the world looks like one. */
export function Boundary() {
  const { minX, maxX, minZ, maxZ } = PLAY_AREA
  const centreX = (minX + maxX) / 2
  const centreZ = (minZ + maxZ) / 2
  const y = WALL_HEIGHT / 2
  const width = PLAY_AREA_WIDTH + WALL_THICKNESS * 3
  const depth = PLAY_AREA_DEPTH + WALL_THICKNESS * 3

  const sides: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [centreX, y, minZ - WALL_THICKNESS], size: [width, WALL_HEIGHT, WALL_THICKNESS] },
    { position: [centreX, y, maxZ + WALL_THICKNESS], size: [width, WALL_HEIGHT, WALL_THICKNESS] },
    { position: [minX - WALL_THICKNESS, y, centreZ], size: [WALL_THICKNESS, WALL_HEIGHT, depth] },
    { position: [maxX + WALL_THICKNESS, y, centreZ], size: [WALL_THICKNESS, WALL_HEIGHT, depth] },
  ]

  return (
    <>
      {sides.map(({ position, size }) => (
        <mesh key={position.join()} position={position} castShadow receiveShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </>
  )
}
