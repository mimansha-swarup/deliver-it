import { useFrame } from '@react-three/fiber'

const ORBIT_RADIUS = 300
const ORBIT_HEIGHT = 170
/** Radians per second. One full circle takes a little under two minutes. */
const ORBIT_SPEED = 0.055

/** A slow aerial circle around the neighbourhood, behind the title screen. */
export function TitleCamera() {
  useFrame(({ camera, clock }) => {
    const angle = clock.elapsedTime * ORBIT_SPEED
    camera.position.set(Math.sin(angle) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.cos(angle) * ORBIT_RADIUS)
    camera.lookAt(0, 0, 0)
  })

  return null
}
