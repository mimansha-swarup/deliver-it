import * as THREE from 'three'

/**
 * How much haze builds up across the view before its far edge, from 0 to 1.
 * At 0.42, something halfway to the draw distance is about 21% haze: thick
 * enough that the skyline past the map's edge (Skyline.tsx) reads as far-off city.
 */
export const HAZE_STRENGTH = 0.42
/** Where the far edge starts closing in, as a share of the way from the haze's start to the draw distance. */
export const HAZE_WALL = 0.5

/**
 * Replaces three's fog with a golden haze. Three's own fog goes evenly from
 * nothing at `near` to solid at `far`. This one builds slowly over the whole
 * view, which reads as air, then closes in over the last stretch, so it's still
 * solid where drawing stops and far map squares appear and vanish unseen.
 *
 * It changes the shader code every material is built from, so it must run
 * before anything is drawn: App imports it first.
 */
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float hazeDepth = clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 );
    float haze = hazeDepth * ${HAZE_STRENGTH.toFixed(3)};
    float fogFactor = haze + ( 1.0 - haze ) * smoothstep( ${HAZE_WALL.toFixed(3)}, 1.0, hazeDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`
