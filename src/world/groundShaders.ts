import * as THREE from 'three'

/*
 * Shader changes for the new ground (ART_DIRECTION.md). Each keeps three.js's
 * own lighting, shadows, fog and the shared grade, and only works out the
 * surface colour: the photo gives fine grain, and everything at a larger scale
 * (variation, tyre tracks, dust, damp) is worked out from world position, so
 * no repeat of the photo ever shows.
 */

/** The art direction's palette, in sRGB. */
export const GROUND_PALETTE = {
  asphalt: '#4e4f57',
  soilBase: '#a65a35',
  soilDry: '#c0794a',
  soilDamp: '#8a4a2c',
  /** Grass and weeds over the soil: sun-dried and green, mixed in broad patches. */
  grassDry: '#8c8650',
  grassGreen: '#5d7a3c',
}

/** Smooth value noise, and noise in layers, from world position in metres. */
const NOISE_GLSL = /* glsl */ `
  float groundHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float groundNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(groundHash(cell), groundHash(cell + vec2(1.0, 0.0)), f.x),
      mix(groundHash(cell + vec2(0.0, 1.0)), groundHash(cell + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float groundLayers(vec2 p) {
    float total = 0.0;
    float strength = 0.5;
    for (int i = 0; i < 4; i++) {
      total += groundNoise(p) * strength;
      p = p * 2.07 + 13.1;
      strength *= 0.5;
    }
    return total / 0.9375;
  }
  float groundLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // The photo's own detail, around 1: each texel against the picture's average, the
  // smallest mipmap. Colour then comes only from the palette.
  float photoDetail(sampler2D photo, vec2 uv, float amount) {
    float texel = groundLuma(texture2D(photo, uv).rgb);
    float average = groundLuma(textureLod(photo, uv, 16.0).rgb);
    return mix(1.0, texel / max(average, 0.02), amount);
  }
`

function linear(hex: string) {
  return new THREE.Color(hex)
}

// ---------------------------------------------------------------------------
// Asphalt

export type AsphaltUniforms = { uWet: { value: number } }

/**
 * The asphalt: the palette's blue-grey, with the photo's fine grain, broad
 * lighter and darker areas, darker polished tyre tracks in each lane, a darker
 * gutter strip by the kerb and dust blown in at the edges. Wet, it darkens and
 * shines. Needs the geometry's uv in metres, and `aAcross`, `aHalf`: how far
 * across the road a point is, and the road's half width, and `aKerb`: whether a
 * kerb runs on the left and right there.
 */
export function patchAsphalt(material: THREE.MeshStandardMaterial): AsphaltUniforms {
  const uniforms = {
    uWet: { value: 0 },
    uAsphalt: { value: linear(GROUND_PALETTE.asphalt) },
    uDust: { value: linear(GROUND_PALETTE.soilDry) },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute float aAcross;
        attribute float aHalf;
        attribute vec2 aKerb;
        varying vec2 vGround;
        varying float vAcross;
        varying float vHalf;
        varying vec2 vKerb;
        void main() {
          vGround = uv;
          vAcross = aAcross;
          vHalf = aHalf;
          vKerb = aKerb;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uWet;
        uniform vec3 uAsphalt;
        uniform vec3 uDust;
        varying vec2 vGround;
        varying float vAcross;
        varying float vHalf;
        varying vec2 vKerb;
        ${NOISE_GLSL}
        void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `float grain = photoDetail(map, vMapUv, 0.6);
        vec2 ground = vGround;
        float broad = groundLayers(ground * 0.03);
        float middle = groundLayers(ground * 0.22 + 7.0);
        vec3 asphalt = uAsphalt * (0.88 + 0.24 * broad) * (0.95 + 0.1 * middle);

        // Junction discs carry a huge half width: no edges, lanes or tracks there.
        float isStreet = step(vHalf, 50.0);
        float edge = vHalf - abs(vAcross);
        float lanes = max(1.0, floor(vHalf * 2.0 / 3.2 + 0.5));
        float laneWidth = vHalf * 2.0 / lanes;
        float inLane = mod(vAcross + vHalf, laneWidth) - laneWidth * 0.5;
        float track = (1.0 - smoothstep(0.12, 0.42, abs(abs(inLane) - 0.85))) * smoothstep(0.7, 1.6, edge) * isStreet;
        asphalt *= 1.0 - 0.09 * track * (0.6 + 0.4 * middle);

        // Only beside a kerb: where a side street opens, the road's edge isn't one.
        float kerbed = (vAcross > 0.0 ? vKerb.x : vKerb.y) * isStreet;
        float gutter = (1.0 - smoothstep(0.26, 0.42, edge)) * kerbed;
        asphalt = mix(asphalt, asphalt * 0.72, gutter);
        // Silt settled in the gutter in patches, as the rain leaves it.
        float silt = gutter * smoothstep(0.45, 0.75, groundLayers(ground * 1.1 + 3.0));
        asphalt = mix(asphalt, uDust * 0.5, silt * 0.55);
        float dust = (1.0 - smoothstep(0.35, 1.5, edge)) * (0.5 + 0.5 * groundLayers(ground * 0.7)) * kerbed;
        asphalt = mix(asphalt, uDust * 0.55, dust * 0.34 * (1.0 - gutter * 0.4));

        diffuseColor.rgb = asphalt * grain * (1.0 - uWet * 0.38);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor *= (1.0 - 0.15 * track) * (1.0 - 0.5 * uWet);`,
      )
  }
  return uniforms
}

// ---------------------------------------------------------------------------
// Footpath pavers

/**
 * The pavers: their picture, with broad variation and grime laid over it so
 * the repeat never shows, and dust from the soil drifted onto the far side.
 * Needs the geometry's uv in metres, and `aEdge`: 0 by the kerb, 1 at the far side.
 */
export function patchPavers(material: THREE.MeshStandardMaterial) {
  const uniforms = { uDust: { value: linear(GROUND_PALETTE.soilDry) } }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `attribute float aEdge;
      varying vec2 vGround;
      varying float vEdge;
      void main() {
        vGround = uv;
        vEdge = aEdge;`,
    )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uDust;
        varying vec2 vGround;
        varying float vEdge;
        ${NOISE_GLSL}
        void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float broad = groundLayers(vGround * 0.08);
        float grime = smoothstep(0.55, 0.8, groundLayers(vGround * 0.45 + 3.0));
        diffuseColor.rgb *= (0.9 + 0.16 * broad) * (1.0 - 0.16 * grime);
        float drift = smoothstep(0.55, 1.0, vEdge) * (0.55 + 0.45 * groundLayers(vGround * 1.3));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDust * 0.75, drift * 0.45);`,
      )
  }
}

// ---------------------------------------------------------------------------
// Soil

export type SoilUniforms = { uNewSoilArea: { value: THREE.Vector4 }; uCover: { value: THREE.Texture | null }; uCoverArea: { value: THREE.Vector4 } }

/**
 * Bengaluru's red earth: base, dry and damp from the palette, mixed by broad
 * noise, with the photo's grain at a little under half strength, so it reads as
 * dusty earth rather than gravel. While it's being tried, only inside
 * `uNewSoilArea` (min x, min z, max x, max z, fading out over 30 m); outside,
 * the old tinted photo.
 */
export function patchSoil(material: THREE.MeshStandardMaterial): SoilUniforms {
  const uniforms = {
    uNewSoilArea: { value: new THREE.Vector4(0, 0, 0, 0) },
    uCover: { value: null as THREE.Texture | null },
    uCoverArea: { value: new THREE.Vector4(0, 0, 1, 1) },
    uGrassDry: { value: linear(GROUND_PALETTE.grassDry) },
    uGrassGreen: { value: linear(GROUND_PALETTE.grassGreen) },
    uSoilBase: { value: linear(GROUND_PALETTE.soilBase) },
    uSoilDry: { value: linear(GROUND_PALETTE.soilDry) },
    uSoilDamp: { value: linear(GROUND_PALETTE.soilDamp) },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vSoil;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSoil = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec4 uNewSoilArea;
        uniform sampler2D uCover;
        uniform vec4 uCoverArea;
        uniform vec3 uGrassDry;
        uniform vec3 uGrassGreen;
        uniform vec3 uSoilBase;
        uniform vec3 uSoilDry;
        uniform vec3 uSoilDamp;
        varying vec2 vSoil;
        ${NOISE_GLSL}
        void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 oldTexel = texture2D(map, vMapUv);
        vec3 oldSoil = diffuseColor.rgb * oldTexel.rgb;
        float detail = photoDetail(map, vMapUv, 0.4);
        float broad = groundLayers(vSoil * 0.012);
        float middle = groundLayers(vSoil * 0.07 + 3.1);
        float fine = groundLayers(vSoil * 0.6 + 9.0);
        vec3 soil = mix(uSoilBase, uSoilDry, smoothstep(0.3, 0.75, broad * 0.6 + middle * 0.4));
        soil = mix(soil, uSoilDamp, smoothstep(0.6, 0.85, middle) * 0.55);
        soil *= (0.94 + 0.12 * fine) * detail;
        // Grass, weeds and low plants over the soil, in patches, as much as the cover map says.
        // Outside the map, fields: about half covered.
        vec2 coverUv = (vSoil - uCoverArea.xy) / uCoverArea.zw;
        float inMap = step(0.0, coverUv.x) * step(coverUv.x, 1.0) * step(0.0, coverUv.y) * step(coverUv.y, 1.0);
        float cover = mix(0.55, texture2D(uCover, coverUv).r, inMap);
        float clumps = groundLayers(vSoil * 0.35 + 21.0);
        float patches = smoothstep(0.42, 0.62, cover * 0.9 + (clumps - 0.5) * 0.7 + (middle - 0.5) * 0.3);
        vec3 grass = mix(uGrassDry, uGrassGreen, smoothstep(0.3, 0.75, broad * 0.5 + groundLayers(vSoil * 0.09 + 5.0) * 0.5));
        // Tufts and weeds: darker clumps in the grass, the odd paler dry blade.
        grass *= (0.82 + 0.3 * groundLayers(vSoil * 1.7 + 2.0)) * mix(1.0, detail, 0.6);
        soil = mix(soil, grass, patches);
        vec2 outside2 = max(uNewSoilArea.xy - vSoil, vSoil - uNewSoilArea.zw);
        float inArea = 1.0 - smoothstep(0.0, 30.0, max(outside2.x, outside2.y));
        diffuseColor.rgb = mix(oldSoil, soil, inArea);`,
      )
  }
  return uniforms
}
