import { Effect, EffectAttribute } from 'postprocessing'
import * as THREE from 'three'

/*
 * The golden haze lit by the sun (ART_DIRECTION.md: a low warm sun and a light golden haze).
 * Looking towards the sun, the air between you and what you see glows with its light, more the
 * further away that is: so the far end of a street glows gold against the low sun, trees and
 * buildings stand dark against it, and looking away from the sun nothing changes.
 *
 * One pass over the picture, reading the depth that's already there, before the tone mapping, so
 * the same tone mapping and grade go over it as over everything else. It's cheap enough for Low.
 * (The sun shafts through leaves on Medium and High are `GodRays`, in PostEffects.tsx.)
 */

const fragment = /* glsl */ `
uniform vec3 sunView;
uniform vec3 sunColor;
uniform float strength;
uniform float reach;
uniform mat4 inverseProjection;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // Where this pixel is, seen from the camera: back from the screen and the depth.
  vec4 view = inverseProjection * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  vec3 viewPosition = view.xyz / view.w;
  float distance = length(viewPosition);
  vec3 ray = viewPosition / max(distance, 0.0001);
  float facing = max(dot(ray, sunView), 0.0);
  // A wide warm glow and a tighter bright one round the sun: forward scattering in hazy air.
  float glow = 0.6 * pow(facing, 5.0) + 0.4 * pow(facing, 40.0);
  float air = 1.0 - exp(-distance / reach);
  outputColor = vec4(inputColor.rgb + sunColor * (glow * air * strength), inputColor.a);
}
`

/** How far, in metres, the air takes to glow about two-thirds as much as it can. */
const REACH = 260

export class SunHazeEffect extends Effect {
  constructor() {
    super('SunHazeEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['sunView', new THREE.Uniform(new THREE.Vector3(0, 0, -1))],
        ['sunColor', new THREE.Uniform(new THREE.Color())],
        ['strength', new THREE.Uniform(0)],
        ['reach', new THREE.Uniform(REACH)],
        ['inverseProjection', new THREE.Uniform(new THREE.Matrix4())],
      ]),
    })
  }

  private readonly rotation = new THREE.Matrix3()

  /** Points it at the sun (a world direction), for this frame's camera. */
  aim(camera: THREE.Camera, sunDirection: THREE.Vector3Tuple, color: THREE.Vector3Tuple, strength: number) {
    this.rotation.setFromMatrix4(camera.matrixWorldInverse)
    ;(this.uniforms.get('sunView')!.value as THREE.Vector3).set(...sunDirection).applyMatrix3(this.rotation).normalize()
    ;(this.uniforms.get('sunColor')!.value as THREE.Color).setRGB(...color, THREE.SRGBColorSpace)
    this.uniforms.get('strength')!.value = strength
    ;(this.uniforms.get('inverseProjection')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
  }
}
