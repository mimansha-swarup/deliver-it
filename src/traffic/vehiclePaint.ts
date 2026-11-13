import type * as THREE from 'three'

export const CAR_COLORS = ['#e8e8e8', '#b9bcc2', '#30343b', '#8c2f2f', '#2f4f7f', '#d8d2c4', '#f4f4f2']
/** Parked bikes: the greys, blacks and deep reds and blues most two-wheelers come in. */
export const PARKED_COLORS = ['#c8c9cc', '#2f3136', '#8c2f2f', '#2f4f7f', '#e6e4dc', '#3d6b4f']

/** Only the paint takes a vehicle's colour, so glass, tyres and lights keep their own. */
export function tintPaintOnly(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = `
    attribute float _paint;
    ${shader.vertexShader}
  `.replace(
    '#include <color_vertex>',
    `vColor = vec4(1.0);
    // Each copy's own colour only exists once one has been set, so the shader checks before using it.
    #ifdef USE_INSTANCING_COLOR
      vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, _paint);
    #else
      vColor.rgb = color.rgb;
    #endif`,
  )
}
