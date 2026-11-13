import * as THREE from 'three'

/**
 * Plaster grain for shapes that have colours but no texture coordinates, such
 * as the house kit's balconies and compound walls.
 *
 * A texture needs a place on the image for every corner (a UV). These shapes
 * don't have them, so the shader makes them from the world position instead:
 * a wall facing east or west is painted with the photo laid on Z and Y, one
 * facing north or south with X and Y, and a top with X and Z. Where a face
 * leans, the three are blended by how much it faces each way. This is
 * "triplanar" mapping.
 *
 * Only the photo's light and shade is used, scaled so its average is 1, so each
 * piece keeps its own paint colour and just gains grain and patches.
 */
/** The house walls' own plaster photo, so kit, walls and houses match. */
export const PLASTER_PHOTO = '/textures/wall-color.jpg'
/** Bare concrete, for kerbs. */
export const CONCRETE_PHOTO = '/textures/concrete-color.jpg'

export type PlasterOptions = {
  /** How wide one repeat of the photo is, in metres. */
  tile: number
  /** 0 is flat paint, 1 is the photo's own light and shade, and more exaggerates it, for soft photos. */
  strength: number
}

/** The photo's average brightness, so the grain can be centred on 1. */
function averageBrightness(image: CanvasImageSource): number {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return 0.5
  context.drawImage(image, 0, 0, 32, 32)
  const { data } = context.getImageData(0, 0, 32, 32)
  let total = 0
  for (let i = 0; i < data.length; i += 4) total += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
  return Math.max(0.05, total / (data.length / 4))
}

export function createPlasterMaterial(
  photo: THREE.Texture,
  { tile, strength }: PlasterOptions,
  settings: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, ...settings })
  const uniforms = {
    uPlaster: { value: photo },
    uPlasterTile: { value: tile },
    uPlasterStrength: { value: strength },
    uPlasterMean: { value: averageBrightness(photo.image as CanvasImageSource) },
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vPlasterPosition;
        varying vec3 vPlasterNormal;
        void main() {`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 plasterWorld = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          plasterWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        vPlasterPosition = plasterWorld.xyz;
        vPlasterNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform sampler2D uPlaster;
        uniform float uPlasterTile;
        uniform float uPlasterStrength;
        uniform float uPlasterMean;
        varying vec3 vPlasterPosition;
        varying vec3 vPlasterNormal;
        float plasterShade(vec2 at) {
          return dot(texture2D(uPlaster, at / uPlasterTile).rgb, vec3(0.299, 0.587, 0.114));
        }
        void main() {`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // How much this face looks along each axis, sharpened so most faces use one photo.
        vec3 plasterWeights = pow(abs(normalize(vPlasterNormal)), vec3(4.0));
        plasterWeights /= plasterWeights.x + plasterWeights.y + plasterWeights.z;
        float plaster =
          plasterShade(vPlasterPosition.zy) * plasterWeights.x +
          plasterShade(vPlasterPosition.xz) * plasterWeights.y +
          plasterShade(vPlasterPosition.xy) * plasterWeights.z;
        // Kept within reason, so a dark speck in the photo, boosted, can't turn a wall black.
        diffuseColor.rgb *= clamp(mix(1.0, plaster / uPlasterMean, uPlasterStrength), 0.6, 1.35);`,
      )
  }
  // Every material made here compiles to the same shader, so three.js can share it.
  material.customProgramCacheKey = () => 'plaster'
  return material
}

/** Sets a photo up to repeat across a wall. */
export function preparePlasterPhoto(photo: THREE.Texture) {
  photo.wrapS = THREE.RepeatWrapping
  photo.wrapT = THREE.RepeatWrapping
  photo.anisotropy = 8
}
