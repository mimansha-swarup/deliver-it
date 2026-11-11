import * as THREE from 'three'

/**
 * Where the rider's hips sit, from the scooter's middle. A thrown rider turns
 * around this point, and `SEAT_BACK` in ScooterController matches its z.
 */
export const HIP = new THREE.Vector3(0, 0.93, -0.36)
