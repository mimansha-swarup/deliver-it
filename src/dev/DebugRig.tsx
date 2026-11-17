import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'

/*
 * TEMP-DEBUG (remove when done): console tools for screenshots and timing.
 * window.__rig.shot = { from: [x, y, z], at: [x, y, z] } holds the camera there;
 * null hands it back. window.__rig.cost() returns the last frames' cost in ms,
 * timed with gl.finish(), so the GPU's share is counted, not just the CPU's.
 */

type Rig = {
  shot: { from: [number, number, number]; at: [number, number, number] } | null
  /** A camera that rides along: offsets in the scooter's frame, [right, up, forward]. */
  chase: { from: [number, number, number]; at: [number, number, number] } | null
  samples: number[]
  start: number
  timing: boolean
}

const rig: Rig = { shot: null, chase: null, samples: [], start: 0, timing: false }

export function DebugRig() {
  const { gl, scene } = useThree()
  useEffect(() => {
    Object.assign(window, {
      __rig: Object.assign(rig, {
        gl,
        scene,
        cost: () => {
          const sorted = [...rig.samples].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)] ?? 0
          const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0
          return { frames: sorted.length, medianMs: +median.toFixed(2), p90Ms: +p90.toFixed(2), calls: gl.info.render.calls, triangles: gl.info.render.triangles }
        },
      }),
    })
  }, [gl, scene])
  useFrame(({ gl: renderer }) => {
    rig.start = performance.now()
    // Count the whole frame's draws, every pass, not just the last.
    renderer.info.autoReset = false
    renderer.info.reset()
  }, -100)
  useFrame(({ camera }) => {
    const scooter = (window as unknown as { __scooter?: { x: number; z: number; heading: number } }).__scooter
    if (rig.chase && scooter) {
      const fx = Math.sin(scooter.heading)
      const fz = Math.cos(scooter.heading)
      // Right of forward, with +Z forward and +Y up, is (-fz, fx) here... matched to the screen by trying.
      const rx = -fz
      const rz = fx
      const place = ([right, up, forward]: [number, number, number]): [number, number, number] => [
        scooter.x + rx * right + fx * forward,
        up,
        scooter.z + rz * right + fz * forward,
      ]
      camera.position.set(...place(rig.chase.from))
      camera.lookAt(...place(rig.chase.at))
      return
    }
    if (!rig.shot) return
    camera.position.set(...rig.shot.from)
    camera.lookAt(...rig.shot.at)
  }, 0.5)
  useFrame(({ gl: renderer }) => {
    if (!rig.timing) return
    renderer.getContext().finish()
    rig.samples.push(performance.now() - rig.start)
    if (rig.samples.length > 600) rig.samples.shift()
  }, 100)
  return null
}
