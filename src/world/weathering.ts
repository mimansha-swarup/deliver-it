import * as THREE from 'three'

/*
 * Weathering for walls, worked out in the shader from where each point is, so
 * it costs no textures (ART_DIRECTION.md: nothing looks brand new):
 *
 * - a band of grime at the foot of every wall, splashed red-brown by the soil,
 *   and darkening where the wall meets the ground, as ambient occlusion would;
 * - paint faded in broad patches, and darker damp stains;
 * - streaks run down from the window sills (building walls only).
 *
 * How weathered a building is, from 0 to 1, comes from `aWeather` where the
 * geometry has it, so neighbours differ.
 */

/** Tunable amounts. */
export const WEATHERING = {
  /** The grime band at the foot of a wall: how high it reaches, in metres, and how dark it gets. */
  grimeHeight: 0.75,
  grimeStrength: 0.55,
  /** Splashed soil, multiplied into the grime band: the red earth's brown. */
  grimeTint: [0.66, 0.52, 0.42] as const,
  /** Darkening right where the wall meets the ground, over this height, in metres. */
  contactHeight: 0.35,
  contactStrength: 0.45,
  /** Faded patches: how much of the paint's colour they lose, at most. */
  fade: 0.45,
  /** Damp stains: how much darker, at most. */
  damp: 0.2,
  /** Streaks under the sills: how much darker, at most, and the share of windows that have them. */
  streaks: 0.28,
  streakShare: 0.55,
}

const NOISE = /* glsl */ `
  float weatherHash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float weatherNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(weatherHash(cell), weatherHash(cell + vec2(1.0, 0.0)), f.x),
      mix(weatherHash(cell + vec2(0.0, 1.0)), weatherHash(cell + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float weatherLayers(vec2 p) {
    return weatherNoise(p) * 0.55 + weatherNoise(p * 2.13 + 7.1) * 0.3 + weatherNoise(p * 4.41 + 3.7) * 0.15;
  }
`

const f = (value: number) => value.toFixed(4)

/**
 * The colour changes, in GLSL, applied to `diffuseColor` after the vertex
 * colour. `weather` is a float, `world` the point's world position, `isWall` 1
 * on walls and 0 on roofs and other flat tops.
 */
function weatheringGlsl(streaks: [number, number] | null): string {
  const W = WEATHERING
  return /* glsl */ `
    {
      vec3 paint = diffuseColor.rgb;
      // A wall's two directions: up, and along it (whichever of x and z it runs along more).
      vec2 onWall = vec2(abs(vWeatherNormal.x) > abs(vWeatherNormal.z) ? vWeatherWorld.z : vWeatherWorld.x, vWeatherWorld.y);

      // Faded patches, broad and soft, paler and greyer than the paint.
      float patches = smoothstep(0.42, 0.78, weatherLayers(onWall * 0.28 + weather * 31.0));
      float grey = dot(paint, vec3(0.2126, 0.7152, 0.0722));
      vec3 faded = mix(paint, vec3(grey) * 1.06 + 0.03, 0.75);
      paint = mix(paint, faded, patches * ${f(W.fade)} * (0.35 + 0.65 * weather) * isWall);

      // Damp stains: darker blotches, more of them low down and under the roofline.
      float dampNoise = weatherLayers(onWall * 0.9 + 11.0 + weather * 5.0);
      float damp = smoothstep(0.62, 0.82, dampNoise) * (0.4 + 0.6 * weather);
      paint *= 1.0 - damp * ${f(W.damp)} * isWall;

      ${
        streaks
          ? `// Streaks run down from the sills: thin dark lines below about half the windows.
      float bay = floor(vWeatherFacade.x);
      float storey = floor(vWeatherFacade.y);
      vec2 cell = fract(vWeatherFacade);
      float hasStreak = step(1.0 - ${f(W.streakShare)} * (0.5 + weather), weatherHash(vec2(bay, storey) + weather * 13.0));
      float underWindow = step(${f(streaks?.[0] ?? 0)}, cell.x) * step(cell.x, ${f(streaks?.[1] ?? 0)}) * step(cell.y, 0.25);
      float lines = smoothstep(0.45, 0.85, weatherNoise(vec2(vWeatherFacade.x * 24.0, storey * 3.1 + bay)));
      float run = smoothstep(0.0, 0.25, cell.y) * (0.6 + 0.4 * weatherNoise(vec2(vWeatherFacade.x * 9.0, vWeatherFacade.y * 6.0)));
      paint *= 1.0 - hasStreak * underWindow * lines * run * ${f(W.streaks)} * isWall;`
          : ''
      }

      // Grime at the foot of the wall: a ragged band of splashed red earth, darkest at the ground.
      float height = vWeatherWorld.y;
      float edge = ${f(W.grimeHeight)} * (0.7 + 0.6 * weatherNoise(vec2(onWall.x * 1.7, weather * 9.0)));
      float grime = (1.0 - smoothstep(0.0, edge, height)) * (0.55 + 0.45 * weather);
      paint = mix(paint, paint * vec3(${W.grimeTint.map(f).join(', ')}), grime * ${f(W.grimeStrength)} * isWall);
      float contact = 1.0 - smoothstep(0.0, ${f(W.contactHeight)}, height);
      paint *= 1.0 - contact * ${f(W.contactStrength)} * isWall;

      diffuseColor.rgb = paint;
    }
  `
}

type Options = {
  /**
   * Streaks under the windows, across this share of each window bay (from, to).
   * Needs `uv` in window bays and floors, as the building walls have, with the
   * sill a quarter of the way up each floor.
   */
  streaks?: [number, number] | null
  /** How weathered, where the geometry has no `aWeather`. */
  weather?: number
}

/**
 * Adds weathering to a material, keeping anything it already does in
 * onBeforeCompile. Works with or without a map, so on Low too.
 */
export function addWeathering(material: THREE.MeshStandardMaterial, { streaks = null, weather }: Options = {}) {
  const previous = material.onBeforeCompile
  const usesAttribute = weather === undefined
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `${usesAttribute ? 'attribute float aWeather;' : ''}
        varying float vWeather;
        varying vec3 vWeatherWorld;
        varying vec3 vWeatherNormal;
        ${streaks ? 'varying vec2 vWeatherFacade;' : ''}
        void main() {
          vWeather = ${usesAttribute ? 'aWeather' : f(weather)};
          ${streaks ? 'vWeatherFacade = uv;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 weatherWorld = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          weatherWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        vWeatherWorld = weatherWorld.xyz;
        vWeatherNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying float vWeather;
        varying vec3 vWeatherWorld;
        varying vec3 vWeatherNormal;
        ${streaks ? 'varying vec2 vWeatherFacade;' : ''}
        ${NOISE}
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float weather = vWeather;
        float isWall = 1.0 - step(0.5, abs(vWeatherNormal.y));
        ${weatheringGlsl(streaks)}`,
      )
  }
  const previousKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `${previousKey()}|weathering:${streaks?.join(',')}:${weather ?? 'attribute'}`
}
