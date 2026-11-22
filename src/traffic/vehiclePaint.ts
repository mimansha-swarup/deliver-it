import type * as THREE from 'three'

export const CAR_COLORS = ['#e8e8e8', '#b9bcc2', '#30343b', '#8c2f2f', '#2f4f7f', '#d8d2c4', '#f4f4f2']
/** Parked bikes: the greys, blacks and deep reds and blues most two-wheelers come in. */
export const PARKED_COLORS = ['#c8c9cc', '#2f3136', '#8c2f2f', '#2f4f7f', '#e6e4dc', '#3d6b4f']

/**
 * Window glass. Every vehicle's glass is the same near-black blue in its shape (the bake's `GLASS`,
 * bus.ts's): the shader knows it by that (darker than anything but a tyre, and bluer than one), and
 * makes it smooth and mirror-like, so windows carry the sky and the street by day and go dark at
 * night, in place of the flat matt black they were. No extra shape, texture or draw call.
 */
export function addWindowGlass(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  float windowGlass = 0.0;
  #ifdef USE_COLOR
    windowGlass = (1.0 - smoothstep(0.06, 0.11, max(vColor.r, max(vColor.g, vColor.b)))) * smoothstep(1.12, 1.35, vColor.b / max(vColor.r, 0.0005));
    // What the glass shows of its surroundings: a cool grey, so it reflects about a third of the sky.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.31, 0.36), windowGlass);
  #endif`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, 1.0, windowGlass);
  // Not a perfect mirror: the models' glass isn't perfectly flat, and a sharp reflection showed every facet.
  roughnessFactor = mix(roughnessFactor, 0.2, windowGlass);`,
    )
}

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
