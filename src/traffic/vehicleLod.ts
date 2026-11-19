/*
 * Which vehicles get their detailed models: decided per vehicle, from the camera (not the rider,
 * whom the camera follows 4 m behind and sometimes much further, in a set shot), with hysteresis.
 * A vehicle goes detailed nearer than its cutoff less LOD_MARGIN, and back to its far version only
 * further than the cutoff plus LOD_MARGIN, so one hovering round the cutoff (queued at a junction)
 * doesn't flicker between the two. Every part of a vehicle (body, rider, wheels) asks the same
 * question with the same cutoff, and the answer doesn't change if asked twice in a frame.
 */

/** Half the band round a cutoff in which a vehicle keeps whichever model it had, in metres. */
export const LOD_MARGIN = 4

/** Where the camera is, set once a frame (Traffic.tsx). */
export const lodCamera = { x: 0, z: 0 }

export type HasLod = { x: number; z: number; detailed?: boolean }

/** Whether this vehicle is drawn with its detailed model, with its cutoff in metres. */
export function isDetailed(item: HasLod, cutoff: number): boolean {
  const distance = Math.hypot(item.x - lodCamera.x, item.z - lodCamera.z)
  const was = item.detailed ?? distance < cutoff
  const now = was ? distance < cutoff + LOD_MARGIN : distance < cutoff - LOD_MARGIN
  item.detailed = now
  return now
}

/** Distance from the camera, for things with no level of detail (number plates, lights). */
export function cameraDistance(x: number, z: number): number {
  return Math.hypot(x - lodCamera.x, z - lodCamera.z)
}
