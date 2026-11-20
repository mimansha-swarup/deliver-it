import * as THREE from 'three'

/*
 * Seeing the rider past what stands in front of them. On foot, a tree trunk, a pole, a parked
 * scooter or someone standing about can come between the camera and the rider. Moving the camera
 * for each of those made it lurch; leaving them hid the rider. So the things themselves give way:
 * any part of one that lies in the line from the camera to the rider is drawn as a scatter of dots
 * that thins to nothing along that line, and whole further out, as if it had faded just there.
 *
 * It's done in the shader of the materials those things are drawn with (trees and street
 * furniture, people, traffic and parked vehicles), which is what `seeThrough` adds. Walls and
 * buildings aren't touched: for those the camera comes in, as it should (FollowCamera.tsx).
 * FollowCamera says each frame where the rider is and how wide the way through is (`liveSight`).
 */

/** The rider's chest as the camera sees it (x, y, z in the camera's own space), and how wide the cleared way is, in metres: 0 for none. */
export const liveSight = { value: new THREE.Vector4(0, 0, 0, 0) }

/**
 * How much of the way from the camera to the rider is cleared, as shares of it (not the last part,
 * or the rider would fade too), and where across the way things come back: whole from the full
 * width out, gone inside this share of it.
 */
const SIGHT = { from: 0.02, to: 0.84, gone: 0.5 }

type Hook = THREE.Material['onBeforeCompile']

/**
 * A material's `onBeforeCompile` that also lets the camera see the rider through what it draws.
 * `also` is the hook the material had already, which runs first.
 */
export function seeThrough(also?: Hook): Hook {
  const hook: Hook = (shader, renderer) => {
    also?.(shader, renderer)
    shader.uniforms.uSight = liveSight
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSightView;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vSightView = mvPosition.xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec4 uSight;\nvarying vec3 vSightView;\nvoid main() {')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  if (uSight.w > 0.0) {
    // How far along the line from the camera (0) to the rider (1) this bit of the thing is, and how far off it.
    float sightAlong = dot(vSightView, uSight.xyz) / dot(uSight.xyz, uSight.xyz);
    if (sightAlong > ${SIGHT.from.toFixed(2)} && sightAlong < ${SIGHT.to.toFixed(2)}) {
      float sightOff = length(vSightView - uSight.xyz * sightAlong);
      float sightKept = smoothstep(uSight.w * ${SIGHT.gone.toFixed(2)}, uSight.w, sightOff);
      // A different threshold at each pixel, in a pattern with no visible grain: more of them pass the nearer the edge.
      float sightDot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (sightKept < sightDot) discard;
    }
  }`,
      )
  }
  // Three keeps one compiled shader for all materials whose hook reads the same: this one must read differently for each hook it wraps.
  hook.toString = () => `seeThrough(${also ? also.toString() : ''})`
  return hook
}
