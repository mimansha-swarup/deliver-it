import * as THREE from 'three'
import { createRandom } from '../world/props'

/*
 * Karnataka number plates, drawn in code: one picture of 32 plates, 4 across
 * and 8 down. Private vehicles have black on white; the last two rows are
 * commercial plates, black on yellow, for autos. The registration codes are
 * the RTOs round HSR Layout. The letters and numbers are made up, so no plate
 * belongs to a real vehicle.
 */

const COLUMNS = 4
const ROWS = 8
const CELL_WIDTH = 256
const CELL_HEIGHT = 64
/** Rows of commercial (yellow) plates, at the bottom of the picture. */
const COMMERCIAL_ROWS = 2

const RTO_CODES = ['01', '03', '05', '51', '53', '02', '04']
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'

function plateText(random: () => number): string {
  const rto = RTO_CODES[Math.floor(random() * RTO_CODES.length)]
  const letter = () => LETTERS[Math.floor(random() * LETTERS.length)]
  const number = String(1 + Math.floor(random() * 9998)).padStart(4, '0')
  return `KA ${rto} ${letter()}${letter()} ${number}`
}

export function createPlateAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CELL_WIDTH * COLUMNS
  canvas.height = CELL_HEIGHT * ROWS
  const context = canvas.getContext('2d')
  if (context) {
    const random = createRandom(9031)
    for (let row = 0; row < ROWS; row++) {
      const commercial = row >= ROWS - COMMERCIAL_ROWS
      for (let column = 0; column < COLUMNS; column++) {
        const x = column * CELL_WIDTH
        const y = row * CELL_HEIGHT
        context.fillStyle = commercial ? '#f2c72c' : '#f3f3ee'
        context.fillRect(x + 2, y + 2, CELL_WIDTH - 4, CELL_HEIGHT - 4)
        context.strokeStyle = '#1a1a1a'
        context.lineWidth = 3
        context.strokeRect(x + 5, y + 5, CELL_WIDTH - 10, CELL_HEIGHT - 10)
        context.fillStyle = '#141414'
        context.font = `700 34px 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(plateText(random), x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2 + 2, CELL_WIDTH - 24)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Which plate in the picture a vehicle carries, as (column, row), from a number unique to it. */
export function plateCell(seed: number, commercial: boolean): [number, number] {
  const privateRows = ROWS - COMMERCIAL_ROWS
  const pick = Math.abs(Math.floor(seed * 7919)) % ((commercial ? COMMERCIAL_ROWS : privateRows) * COLUMNS)
  const row = Math.floor(pick / COLUMNS) + (commercial ? privateRows : 0)
  return [pick % COLUMNS, row]
}

export type PlateFit = {
  /** Plate size, in metres. */
  width: number
  height: number
  /** How high the plate's middle is. */
  at: number
  front: boolean
  back: boolean
}

/**
 * Plates for a vehicle model: each is a small quad standing just proud of the
 * bodywork at its height, found by looking for the model's furthest corners
 * near the middle at that height. Front faces +Z, the way vehicles drive.
 */
export function createPlateGeometry(model: THREE.BufferGeometry, fit: PlateFit): THREE.BufferGeometry {
  const position = model.getAttribute('position')
  let front = -Infinity
  let back = Infinity
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    if (Math.abs(x) > 0.3 || Math.abs(y - fit.at) > fit.height) continue
    const z = position.getZ(i)
    front = Math.max(front, z)
    back = Math.min(back, z)
  }
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const quad = (z: number, facing: 1 | -1) => {
    const w = fit.width / 2
    const h = fit.height / 2
    // Seen from in front of the plate, x runs left to right as the text does.
    const corners = [
      [-w * facing, -h, 0, 0],
      [w * facing, -h, 1, 0],
      [w * facing, h, 1, 1],
      [-w * facing, -h, 0, 0],
      [w * facing, h, 1, 1],
      [-w * facing, h, 0, 1],
    ]
    for (const [x, y, u, v] of corners) {
      positions.push(x, fit.at + y, z)
      normals.push(0, 0, facing)
      uvs.push(u, v)
    }
  }
  if (fit.front && Number.isFinite(front)) quad(front + 0.01, 1)
  if (fit.back && Number.isFinite(back)) quad(back - 0.01, -1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

/** Picks each copy's plate from the picture: `aPlate` is its (column, row). */
export function showPlateCell(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'attribute vec2 aPlate;\nvoid main() {')
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vMapUv = vec2((aPlate.x + uv.x) / ${COLUMNS.toFixed(1)}, 1.0 - (aPlate.y + 1.0 - uv.y) / ${ROWS.toFixed(1)});`,
    )
}
