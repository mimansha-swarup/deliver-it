import { useEffect, useMemo } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { liveSky } from '../game/livePlayer'
import { CHAIN_IDS, CHAINS, type Chain, type LandmarkSign } from './landmarks'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('world upkeep (streaming, culling, signs)')

/** Each chain's sign is one row of this picture, in pixels. */
const ROW_WIDTH = 1024
const ROW_HEIGHT = 176
/** The sign's bottom edge, above the ground floor's awnings, and how far it stands off the wall, in metres. */
const SIGN_BOTTOM = 3.3
const DEPTH = 0.22
/** How bright the lettering glows after dark. */
const NIGHT_GLOW = 0.95

const FONTS: Record<Chain['style'], (size: number) => string> = {
  bold: (size) => `800 ${size}px 'Baloo Tamma 2', system-ui, sans-serif`,
  caps: (size) => `700 ${size}px system-ui, 'Helvetica Neue', sans-serif`,
  serif: (size) => `600 ${size}px Georgia, 'Times New Roman', serif`,
}

/** Draws one chain's sign: its name large in its own style, the tagline under it, and a stripe of its accent colour. */
function drawSign(context: CanvasRenderingContext2D, chain: Chain, top: number) {
  const { name, tagline, background, lettering, accent, style } = chain
  context.fillStyle = background
  context.fillRect(0, top, ROW_WIDTH, ROW_HEIGHT)
  context.fillStyle = accent
  context.fillRect(0, top + ROW_HEIGHT - 14, ROW_WIDTH, 14)

  context.fillStyle = lettering
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const text = style === 'caps' ? name.toUpperCase().split('').join(' ') : name
  context.font = FONTS[style](style === 'caps' ? 78 : 92)
  context.fillText(text, ROW_WIDTH / 2, top + ROW_HEIGHT * 0.42, ROW_WIDTH - 80)
  context.globalAlpha = 0.85
  context.font = `600 30px system-ui, sans-serif`
  context.fillText(tagline, ROW_WIDTH / 2, top + ROW_HEIGHT * 0.78, ROW_WIDTH - 120)
  context.globalAlpha = 1
}

function paintSigns(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  CHAIN_IDS.forEach((id, row) => drawSign(context, CHAINS[id], row * ROW_HEIGHT))
}

function createSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = ROW_WIDTH
  canvas.height = ROW_HEIGHT * CHAIN_IDS.length
  paintSigns(canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  // Painted again once the web font has arrived, as the first painting may have used a fallback.
  document.fonts?.load(FONTS.bold(92)).then(() => {
    paintSigns(canvas)
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** Places a shape on the wall: turned to face out, then moved to the sign's spot, standing a little off the wall. */
function placeOnWall(geometry: THREE.BufferGeometry, sign: LandmarkSign, outward: number) {
  const matrix = new THREE.Matrix4()
    .makeTranslation(
      sign.x + Math.sin(sign.rotation) * outward,
      SIGN_BOTTOM + sign.height / 2,
      sign.z + Math.cos(sign.rotation) * outward,
    )
    .multiply(new THREE.Matrix4().makeRotationY(sign.rotation))
  return geometry.applyMatrix4(matrix)
}

/** The fronts, each showing its chain's row of the picture, and the boxes behind them. */
function createSignGeometries(signs: LandmarkSign[]) {
  const fronts: THREE.BufferGeometry[] = []
  const boxes: THREE.BufferGeometry[] = []
  for (const sign of signs) {
    const row = CHAIN_IDS.indexOf(sign.chain)
    const front = new THREE.PlaneGeometry(sign.width, sign.height)
    // Squeezes the plane's 0 to 1 picture into its chain's row. Row 0 is at the top of the canvas.
    const uv = front.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, 1 - (row + 1 - uv.getY(i)) / CHAIN_IDS.length)
    }
    fronts.push(placeOnWall(front, sign, DEPTH + 0.005))
    boxes.push(placeOnWall(new THREE.BoxGeometry(sign.width + 0.08, sign.height + 0.08, DEPTH), sign, DEPTH / 2))
  }
  return {
    fronts: fronts.length > 0 ? mergeGeometries(fronts) : null,
    boxes: boxes.length > 0 ? mergeGeometries(boxes) : null,
  }
}

/** A little light by day, as backlit signs have, and bright at night. */
function updateGlow(front: THREE.MeshStandardMaterial) {
  front.emissiveIntensity = 0.12 + liveSky.look.night * NIGHT_GLOW
}

/**
 * The big signs of HSR's well-known shops and food places, each above the
 * ground floor of its building, at its real spot. They light up after dark,
 * like the real ones. Few enough to draw as two meshes in all.
 */
export function LandmarkSigns({ signs }: { signs: LandmarkSign[] }) {
  const geometries = useMemo(() => createSignGeometries(signs), [signs])
  const materials = useMemo(() => {
    const texture = createSignTexture()
    return {
      front: new THREE.MeshStandardMaterial({
        map: texture,
        emissive: '#ffffff',
        emissiveMap: texture,
        emissiveIntensity: 0,
        roughness: 0.55,
      }),
      box: new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.7, metalness: 0.3 }),
    }
  }, [])

  useEffect(
    () => () => {
      geometries.fronts?.dispose()
      geometries.boxes?.dispose()
      materials.front.map?.dispose()
      materials.front.dispose()
      materials.box.dispose()
    },
    [geometries, materials],
  )

  useFrame(() => updateGlow(materials.front))

  return (
    <>
      {geometries.boxes && <mesh geometry={geometries.boxes} material={materials.box} />}
      {geometries.fronts && <mesh geometry={geometries.fronts} material={materials.front} />}
    </>
  )
}
