import { PLAY_AREA_SIZE } from './worldUtils'

const WALL_HEIGHT = 1.5
const WALL_THICKNESS = 0.4
const WALL_COLOR = '#b8b3a6'

/** A low wall around the play area, so the edge of the world looks like one. */
export function Boundary() {
  const distance = PLAY_AREA_SIZE / 2 + WALL_THICKNESS
  const length = PLAY_AREA_SIZE + WALL_THICKNESS * 3

  const sides: { position: [number, number, number]; size: [number, number, number] }[] = [
    { position: [0, WALL_HEIGHT / 2, -distance], size: [length, WALL_HEIGHT, WALL_THICKNESS] },
    { position: [0, WALL_HEIGHT / 2, distance], size: [length, WALL_HEIGHT, WALL_THICKNESS] },
    { position: [-distance, WALL_HEIGHT / 2, 0], size: [WALL_THICKNESS, WALL_HEIGHT, length] },
    { position: [distance, WALL_HEIGHT / 2, 0], size: [WALL_THICKNESS, WALL_HEIGHT, length] },
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
