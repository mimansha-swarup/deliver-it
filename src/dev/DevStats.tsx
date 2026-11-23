import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { isDebug } from './spawn'

/*
 * Debug only (`?debug`, or the dev server): puts the renderer, scene and camera
 * on `window.__deliverIt`, so performance can be measured from the browser
 * console: draw calls and triangles from `gl.info`, and frame cost by timing
 * `gl.render`. A vsync-capped frame rate alone can't show a change in cost.
 */
export function DevStats() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  // The whole of react-three-fiber's state, for the frame timing's look at its callbacks (dev/FpsOverlay.tsx).
  const get = useThree((state) => state.get)
  useEffect(() => {
    if (!isDebug()) return
    const target = window as unknown as { __deliverIt?: unknown }
    target.__deliverIt = { gl, scene, camera, get }
    return () => {
      delete target.__deliverIt
    }
  }, [gl, scene, camera, get])
  return null
}
