import * as THREE from 'three'
import { ShaderPass } from 'postprocessing'
import { safeColorGlsl } from './brightnessCap'

/**
 * A pass that cleans the picture before bloom and the other effects read it:
 * anything that isn't a real number becomes black, and brightness is capped.
 *
 * Bloom and smoothing mix many pixels into each one, and anything mixed with
 * NaN is NaN, so one broken pixel can black out the whole frame. Materials are
 * capped where they're made (brightnessCap.ts), but custom shaders and the
 * ambient occlusion pass can still slip one through. This catches it whatever
 * made it, for the price of copying the picture once.
 */
export function createCleanPicturePass(): ShaderPass {
  const material = new THREE.ShaderMaterial({
    name: 'CleanPicture',
    uniforms: { inputBuffer: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4( position.xy, 1.0, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D( inputBuffer, vUv );
        vec3 color = texel.rgb;
        ${safeColorGlsl('color')}
        gl_FragColor = vec4( color, texel.a );
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const pass = new ShaderPass(material, 'inputBuffer')
  pass.name = 'CleanPicture'
  return pass
}
