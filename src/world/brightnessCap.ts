import * as THREE from 'three'

/**
 * The brightest any surface may be, in linear light. The tone mapping already
 * shows everything above about 16 as white, so this changes nothing you can see.
 */
export const MAX_RADIANCE = 64

/**
 * GLSL that turns a colour that isn't a real number (NaN or infinity) into
 * black, then caps it at MAX_RADIANCE. It tests the number's bits rather than
 * calling isnan(): Apple's GPUs compile shaders with "fast math", which may
 * assume NaN never happens and quietly drop an isnan() check. A float whose
 * exponent bits are all ones is NaN or infinity, and that's plain integer maths.
 */
export function safeColorGlsl(variable: string): string {
  return /* glsl */ `
    {
      uvec3 bits = floatBitsToUint( ${variable} ) & 0x7f800000u;
      if ( any( equal( bits, uvec3( 0x7f800000u ) ) ) ) ${variable} = vec3( 0.0 );
      ${variable} = clamp( ${variable}, 0.0, ${MAX_RADIANCE.toFixed(1)} );
    }
  `
}

/**
 * Caps every material's brightness, and turns any broken value into black.
 *
 * Why: lights that fall off with distance get without limit brighter the
 * closer a surface is. At night the headlight sits right at the scooter's nose,
 * and when braking dips the nose, part of the scooter can come within a hair
 * of it. That pixel then overflows the effects' picture (half floats top out
 * at 65,504) to infinity, and bloom's blur turns one infinite pixel into NaN
 * across the whole screen: a black frame. Capping here, where every built-in
 * material writes its colour, stops that whatever the light or surface.
 * `cleanPicture.ts` does the same to the whole picture, for anything else.
 *
 * Like the haze, it changes the shader code every material is built from, so
 * App imports it before anything is drawn.
 */
THREE.ShaderChunk.opaque_fragment = /* glsl */ `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif

#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif

${safeColorGlsl('outgoingLight')}

gl_FragColor = vec4( outgoingLight, diffuseColor.a );
`
