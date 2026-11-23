import { useCallback, useEffect, useMemo } from 'react'
import { useCompressedTextures } from './ktx2'
import { ROAD_TEXTURES } from './assetUrls'
import { useTexture } from '@react-three/drei'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { ROAD_HEIGHT } from './surface'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { StreamedChunks } from './StreamedChunks'
import { patchAsphalt, patchPavers, type AsphaltUniforms } from './groundShaders'
import { createDecalAtlas, createPaverTextures } from './groundTextures'
import { DECAL_COLUMNS, DECAL_ROWS, STREET } from './streetEdgeConfig'
import { CONCRETE_PHOTO, createPlasterMaterial, preparePlasterPhoto } from './plaster'
import type { StreetEdges as Edges } from './streetEdgeGeometry'
import { prepareSurfaceTextures } from './surfaceMaterial'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/** Small things are only drawn this close, in metres. */
const KERB_DISTANCE = 260
const DETAIL_DISTANCE = 160
/**
 * On Low, nearer: with the new ground on every street, each map square has
 * seven layers where the old ground had two, so the small ones are cut short.
 */
const LOW_KERB_DISTANCE = 140
const LOW_DETAIL_DISTANCE = 70
/** The asphalt photo repeats every this many metres, for its fine grain only. */
const ASPHALT_TILE = 6


/** Wet asphalt darkens and shines as the rain comes. */
function updateWetness(uniforms: AsphaltUniforms) {
  uniforms.uWet.value = liveSky.rain
}

/**
 * Wear on the kerbs' paint: chipped away in patches to the grey concrete
 * under it, most on the top and the road-facing edge where tyres scuff, and a
 * band of road grime along the bottom. Worked out from the world position, so
 * no two blocks wear alike. Added after the concrete photo's shading.
 */
function addKerbWear(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `attribute float aStripe;
      varying float vStripe;
      void main() {
        vStripe = aStripe;`,
    )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying float vStripe;
        float kerbHash(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        float kerbNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(kerbHash(i), kerbHash(i + vec2(1.0, 0.0)), f.x), mix(kerbHash(i + vec2(0.0, 1.0)), kerbHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 at = vPlasterPosition;
          // A painted kerb: blocks of black and yellow, each worn its own amount, with a dark joint between.
          if (vStripe >= 0.0) {
            float block = floor(vStripe / ${STREET.kerbBlock.toFixed(2)});
            vec3 paint = mod(block, 2.0) < 0.5 ? vec3(${KERB_BLACK}) : vec3(${KERB_YELLOW});
            paint *= 0.8 + 0.2 * kerbHash(vec2(block, 7.0));
            float joint = 1.0 - smoothstep(0.0, 0.015, min(fract(vStripe / ${STREET.kerbBlock.toFixed(2)}), 1.0 - fract(vStripe / ${STREET.kerbBlock.toFixed(2)})) * ${STREET.kerbBlock.toFixed(2)});
            diffuseColor.rgb *= paint * (1.0 - joint * 0.45);
          }
          float chips = kerbNoise(at.xz * 5.0 + at.y * 9.0) * 0.65 + kerbNoise(at.xz * 17.0 + at.y * 23.0) * 0.35;
          float scuffed = vPlasterNormal.y > 0.5 ? 1.0 : 0.65;
          float worn = smoothstep(0.5, 0.72, chips) * scuffed;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.49, 0.46), worn * ${KERB_WEAR.toFixed(2)});
          float grime = 1.0 - smoothstep(${ROAD_HEIGHT.toFixed(3)}, ${(ROAD_HEIGHT + 0.07).toFixed(3)}, at.y);
          diffuseColor.rgb *= 1.0 - grime * 0.35;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'plaster-kerb-wear'
  return material
}

/** The kerb paint, in linear colour for the shader: black, and the yellow of 27th Main's kerbs. */
const linear = (hex: string) => new THREE.Color(hex).toArray().map((value) => value.toFixed(4)).join(', ')
const KERB_BLACK = linear('#1f2023')
const KERB_YELLOW = linear('#e3b021')

/** How much of a worn patch's paint is gone, at most. */
const KERB_WEAR = 0.7

/** How glossy oil is where it's densest: wet-looking, catching the sun, against the dry road's 0.85. */
const OIL_ROUGHNESS = 0.28

/**
 * Oil stains look a little wet: where the decal picture is one of the stains
 * (by which cell of the atlas it's in) the surface turns smoother as the stain
 * gets denser, so it catches the sun and sky. No extra texture or pass.
 */
function addOilSheen(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      {
        vec2 decalCell = floor(vec2(vMapUv.x * ${DECAL_COLUMNS.toFixed(1)}, (1.0 - vMapUv.y) * ${DECAL_ROWS.toFixed(1)}));
        // The stains: the big one, the two small ones, and the trail of drips.
        bool isOil = (decalCell.y < 0.5 && abs(decalCell.x - 1.0) > 0.5) || (decalCell.y > 0.5 && abs(decalCell.x - 2.0) < 0.5);
        if (isOil) roughnessFactor = mix(roughnessFactor, ${OIL_ROUGHNESS.toFixed(2)}, smoothstep(0.15, 0.6, diffuseColor.a));
      }`,
    )
  }
  material.customProgramCacheKey = () => 'oil-sheen'
  return material
}

/**
 * The new ground along the roads that have it (streetEdgeConfig.ts): asphalt,
 * kerbs and rounded corners, raised paver footpaths with edge stones, dust on
 * the soil, tree pits and marks on the road. Everything here comes from
 * buildStreetEdges, one geometry per map square per kind.
 */
const prepareAsphalt = (maps: THREE.Texture[]) => prepareSurfaceTextures(maps, ASPHALT_TILE)

export function StreetEdges({ edges }: { edges: Edges }) {
  const { surfaces, kitDetail } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const low = kitDetail === 0
  const kerbDistance = low ? LOW_KERB_DISTANCE : KERB_DISTANCE
  const detailDistance = low ? LOW_DETAIL_DISTANCE : DETAIL_DISTANCE
  const roadMaps = useCompressedTextures(ROAD_TEXTURES, prepareAsphalt)
  const concrete = useTexture(CONCRETE_PHOTO, preparePlasterPhoto)
  const pavers = useMemo(() => createPaverTextures(), [])
  const atlas = useMemo(() => createDecalAtlas(), [])
  useEffect(() => () => [pavers.map, pavers.normalMap, atlas].forEach((texture) => texture.dispose()), [pavers, atlas])

  const bumps = surfaces === 'bumps'
  const { asphalt, asphaltUniforms } = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      map: roadMaps[0],
      normalMap: bumps ? roadMaps[1] : null,
      roughness: 0.92,
      // In front of the old roads where they overlap at junctions.
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    })
    return { asphalt: material, asphaltUniforms: patchAsphalt(material) }
  }, [roadMaps, bumps])

  const footpath = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      map: pavers.map,
      normalMap: surfaces === 'plain' ? null : pavers.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.95,
    })
    patchPavers(material)
    return material
  }, [pavers, surfaces])

  const kerb = useMemo(() => addKerbWear(createPlasterMaterial(concrete, { tile: 1.5, strength: 1.8 }, { roughness: 0.9 })), [concrete])
  const stone = useMemo(() => createPlasterMaterial(concrete, { tile: 1.2, strength: 1.4 }, { roughness: 0.95 }), [concrete])
  const pit = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    [],
  )
  const dust = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [],
  )
  const decal = useMemo(() => addOilSheen(
    new THREE.MeshStandardMaterial({
      map: atlas,
      transparent: true,
      depthWrite: false,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  ), [atlas])

  useFrame(() => updateWetness(asphaltUniforms))

  // Built a map square at a time, near the rider first (StreamedChunks.tsx).
  const build = useCallback((key: number) => {
    const shapes = edges.buildSquare(key)
    return [shapes.asphalt, shapes.footpaths, shapes.kerbs, shapes.edgeStones, shapes.dust, shapes.pits, shapes.decals]
  }, [edges])
  const layers = useMemo(
    () => [
      { material: asphalt },
      { material: footpath },
      { material: kerb, maxDistance: kerbDistance },
      { material: stone, maxDistance: kerbDistance },
      { material: dust, maxDistance: detailDistance },
      { material: pit, maxDistance: detailDistance },
      { material: decal, maxDistance: detailDistance },
    ],
    [asphalt, footpath, kerb, stone, dust, pit, decal, kerbDistance, detailDistance],
  )
  // ChunkedMesh freed the materials; streamed squares leave that to their owner.
  useEffect(() => () => [asphalt, footpath, kerb, stone, dust, pit, decal].forEach((material) => material.dispose()), [asphalt, footpath, kerb, stone, dust, pit, decal])

  return <StreamedChunks keys={edges.squareKeys} build={build} layers={layers} />
}
