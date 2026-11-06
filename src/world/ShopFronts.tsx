import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { ChunkedMesh } from './ChunkedMesh'
import { chunkKey } from './chunks'
import { ALL_SIGNS, type ShopFront } from './shopFrontPlacement'

const COLORS = ['#c8553d', '#2a7f8e', '#d9a441', '#6b8f3a', '#8c4a7d', '#3d5fa8'].map(
  (color) => new THREE.Color(color),
)

const AWNING_HEIGHT = 2.9

/** A sloped sheet one metre wide, stretched to fit each shop. Its back edge is at the wall. */
function createAwningGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 0.08, 1.5)
  geometry.translate(0, 0, 0.75)
  geometry.rotateX(0.3)
  geometry.translate(0, AWNING_HEIGHT, 0)
  return geometry
}

/** The texture holds rows of signs and then rows of shutters, each in two colourings. */
const ATLAS_ROWS = 16
const ATLAS_SIZE = 1024
const SHUTTER_ROW = 12
const SHUTTER_ROWS = 4

const SIGN_COLORS = [
  ['#c9302c', '#fff6dc'],
  ['#1f5a9e', '#ffffff'],
  ['#f2c230', '#1c1c1c'],
  ['#1e7a4d', '#fdf8e6'],
]
const SHUTTER_COLORS = ['#8d9196', '#4f7f83']

const SHUTTER_HEIGHT = 2.6
const SIGN_BOTTOM = 3.05
const SIGN_TOP = 3.85
const WALL_GAP = 0.07
/** The sign's back and edges are one plain dark patch of the texture. */
const SIGN_DEPTH = 0.12
const SIGN_GLOW = 0.85

type Corner = { x: number; y: number; z: number; u: number; v: number }
type QuadChunk = { positions: number[]; uvs: number[]; normals: number[] }

/** Draws every sign and shutter once into one image, in code, so nothing is downloaded. */
function createAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE

  const context = canvas.getContext('2d')
  if (!context) return canvas

  const rowHeight = ATLAS_SIZE / ATLAS_ROWS
  const columnWidth = ATLAS_SIZE / 2

  ALL_SIGNS.forEach((word, row) => {
    for (let column = 0; column < 2; column++) {
      const [background, text] = SIGN_COLORS[(row * 2 + column * 3) % SIGN_COLORS.length]
      const left = column * columnWidth
      const top = row * rowHeight

      context.fillStyle = background
      context.fillRect(left, top, columnWidth, rowHeight)
      context.fillStyle = text
      context.fillRect(left + 8, top + 5, columnWidth - 16, 2)
      context.fillRect(left + 8, top + rowHeight - 7, columnWidth - 16, 2)
      context.font = `bold ${rowHeight * 0.58}px Arial, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(word, left + columnWidth / 2, top + rowHeight / 2 + 2, columnWidth - 40)
    }
  })

  // Rolling shutters: ribs of light and shade, with a dark bar along the bottom.
  const shutterTop = SHUTTER_ROW * rowHeight
  const shutterHeight = SHUTTER_ROWS * rowHeight
  SHUTTER_COLORS.forEach((color, column) => {
    const left = column * columnWidth
    context.fillStyle = color
    context.fillRect(left, shutterTop, columnWidth, shutterHeight)
    for (let y = 0; y < shutterHeight; y += 10) {
      context.fillStyle = 'rgb(0 0 0 / 34%)'
      context.fillRect(left, shutterTop + y + 7, columnWidth, 3)
      context.fillStyle = 'rgb(255 255 255 / 16%)'
      context.fillRect(left, shutterTop + y, columnWidth, 2)
    }
    context.fillStyle = '#2a2b2e'
    context.fillRect(left, shutterTop + shutterHeight - 16, columnWidth, 16)
  })

  return canvas
}

/** The same image with everything but the signs blacked out, so only signs glow at night. */
function createGlowAtlas(atlas: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE

  const context = canvas.getContext('2d')
  if (context) {
    context.drawImage(atlas, 0, 0)
    context.fillStyle = '#000000'
    const signsEnd = (ALL_SIGNS.length * ATLAS_SIZE) / ATLAS_ROWS
    context.fillRect(0, signsEnd, ATLAS_SIZE, ATLAS_SIZE - signsEnd)
  }
  return canvas
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function pushQuad(chunk: QuadChunk, normal: THREE.Vector3, corners: Corner[]) {
  const [a, b, c, d] = corners
  for (const { x, y, z, u, v } of [a, b, c, a, c, d]) {
    chunk.positions.push(x, y, z)
    chunk.uvs.push(u, v)
    chunk.normals.push(normal.x, normal.y, normal.z)
  }
}

/**
 * Every shutter and sign as flat quads, joined into one geometry per map square.
 * "Right" is the viewer's right when facing the wall, so that words read forwards.
 */
function createStorefrontGeometries(shopFronts: ShopFront[]): THREE.BufferGeometry[] {
  const chunks = new Map<number, QuadChunk>()

  for (const { x, z, rotation, width, sign, variation } of shopFronts) {
    const key = chunkKey(x, z)
    const chunk = chunks.get(key) ?? { positions: [], uvs: [], normals: [] }
    chunks.set(key, chunk)

    const out = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation))
    const rightX = Math.cos(rotation) * (width / 2)
    const rightZ = -Math.sin(rotation) * (width / 2)
    const column = variation < 0.5 ? 0 : 1

    const rectangle = (
      gap: number,
      bottom: number,
      top: number,
      row: number,
      rows: number,
      flip = 1,
    ): Corner[] => {
      const centreX = x + out.x * gap
      const centreZ = z + out.z * gap
      const left = column / 2
      const right = left + 0.5
      const upper = 1 - row / ATLAS_ROWS
      const lower = 1 - (row + rows) / ATLAS_ROWS
      return [
        { x: centreX - rightX * flip, y: bottom, z: centreZ - rightZ * flip, u: left, v: lower },
        { x: centreX + rightX * flip, y: bottom, z: centreZ + rightZ * flip, u: right, v: lower },
        { x: centreX + rightX * flip, y: top, z: centreZ + rightZ * flip, u: right, v: upper },
        { x: centreX - rightX * flip, y: top, z: centreZ - rightZ * flip, u: left, v: upper },
      ]
    }

    pushQuad(chunk, out, rectangle(WALL_GAP, 0, SHUTTER_HEIGHT, SHUTTER_ROW, SHUTTER_ROWS))

    const row = Math.max(0, ALL_SIGNS.indexOf(sign))
    pushQuad(chunk, out, rectangle(SIGN_DEPTH + WALL_GAP, SIGN_BOTTOM, SIGN_TOP, row, 1))

    // On a low roof the board stands clear, so its back needs drawing too.
    const back = new THREE.Vector3(-out.x, 0, -out.z)
    pushQuad(chunk, back, rectangle(WALL_GAP, SIGN_BOTTOM, SIGN_TOP, SHUTTER_ROW + 3, 1, -1))
  }

  return [...chunks.values()].map(({ positions, uvs, normals }) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.computeBoundingSphere()
    return geometry
  })
}

function updateSignGlow(material: THREE.MeshStandardMaterial) {
  material.emissiveIntensity = liveSky.look.night * SIGN_GLOW
}

/** Coloured awnings. They're above head height, so the scooter rides under them. */
export function ShopFronts({ shopFronts }: { shopFronts: ShopFront[] }) {
  const geometry = useMemo(() => createAwningGeometry(), [])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const storefronts = useMemo(() => createStorefrontGeometries(shopFronts), [shopFronts])

  const storefrontMaterial = useMemo(() => {
    const atlas = createAtlas()
    return new THREE.MeshStandardMaterial({
      map: toTexture(atlas),
      emissive: '#ffffff',
      emissiveMap: toTexture(createGlowAtlas(atlas)),
      emissiveIntensity: 0,
      roughness: 0.7,
    })
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame(() => updateSignGlow(storefrontMaterial))

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return

    const transform = new THREE.Object3D()
    shopFronts.forEach(({ x, z, rotation, width, variation }, index) => {
      transform.position.set(x, 0, z)
      transform.rotation.y = rotation
      transform.scale.set(width, 1, 1)
      transform.updateMatrix()
      instances.setMatrixAt(index, transform.matrix)
      instances.setColorAt(index, COLORS[Math.floor(variation * COLORS.length * 0.999)])
    })

    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    instances.computeBoundingSphere()
  }, [shopFronts])

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, undefined, shopFronts.length]} receiveShadow>
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <ChunkedMesh geometries={storefronts} material={storefrontMaterial} />
    </>
  )
}
