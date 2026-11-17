import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { groundLift } from './groundLift'
import type { Hoarding } from './infillPlots'
import { colored } from './simpleShapes'

/*
 * Hoardings beside the main roads (infillPlots.ts): a big printed sheet in a
 * steel frame on two posts, facing the road, sun-faded and streaked. Every ad
 * is made up (no real brand, ART_DIRECTION.md). All of them are two shapes: the
 * steel, vertex-coloured, and the sheets, drawn from one picture of the ads.
 */

const HEIGHT = 3
/** The sheet's bottom edge, in metres up. */
const RAISED = 3.2
const POST = 0.12

type Ad = { background: string; ink: string; band: string; kannada: string; english: string; line: string }

/** Made-up ads, in Kannada and English, as Bengaluru's hoardings run. */
const ADS: Ad[] = [
  { background: '#7a1d3a', ink: '#ffe7a8', band: '#d9a43a', kannada: 'ಸಪ್ತಗಿರಿ ಸಿಲ್ಕ್ಸ್', english: 'Sapthagiri Silks', line: 'Wedding collection now open' },
  { background: '#1f5c8a', ink: '#ffffff', band: '#f2b705', kannada: 'ಕಾವೇರಿ ಹೋಮ್ಸ್', english: 'Kaveri Homes', line: '2 & 3 BHK  ·  Ready to move' },
  { background: '#f2f0e8', ink: '#1d3a7a', band: '#2a8a4a', kannada: 'ನಂದಿ ಹಾಲು', english: 'Nandi Fresh Milk', line: 'Every morning, every home' },
  { background: '#c8381e', ink: '#ffffff', band: '#1a1a1a', kannada: 'ರಾಯಲ್ ಕೂಲರ್ಸ್', english: 'Royal Coolers', line: 'Beat the summer  ·  EMI available' },
  { background: '#2a6b3a', ink: '#f5f0dc', band: '#e8b62e', kannada: 'ವಿನಾಯಕ ಸ್ಕೂಲ್', english: 'Vinayaka Public School', line: 'Admissions open 2026–27' },
  { background: '#1c1c22', ink: '#f6b32b', band: '#e8462a', kannada: 'ಸ್ಟಾರ್ ಮೊಬೈಲ್ಸ್', english: 'Star Mobiles', line: 'Exchange offers  ·  All brands' },
  { background: '#e8d9b8', ink: '#5a2a14', band: '#a8352c', kannada: 'ಅನ್ನಪೂರ್ಣ ಮಸಾಲ', english: 'Annapoorna Masala', line: 'Taste of every kitchen' },
  { background: '#3a2a6b', ink: '#ffffff', band: '#e86a1c', kannada: 'ಮೈಸೂರು ಪೇಂಟ್ಸ್', english: 'Mysore Paints', line: 'Colours that last' },
]
const COLUMNS = 2
const ROWS = 4
const CELL = { width: 1024, height: 340 }

function drawAds(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CELL.width * COLUMNS
  canvas.height = CELL.height * ROWS
  const context = canvas.getContext('2d')
  if (context) {
    ADS.forEach((ad, i) => {
      const x = (i % COLUMNS) * CELL.width
      const y = Math.floor(i / COLUMNS) * CELL.height
      context.fillStyle = ad.background
      context.fillRect(x, y, CELL.width, CELL.height)
      context.fillStyle = ad.band
      context.fillRect(x, y + CELL.height * 0.78, CELL.width, CELL.height * 0.22)
      context.fillStyle = ad.ink
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = `700 ${CELL.height * 0.2}px 'Baloo Tamma 2', system-ui, sans-serif`
      context.fillText(ad.kannada, x + CELL.width / 2, y + CELL.height * 0.22, CELL.width * 0.9)
      context.font = `800 ${CELL.height * 0.2}px 'Baloo Tamma 2', system-ui, sans-serif`
      context.fillText(ad.english, x + CELL.width / 2, y + CELL.height * 0.5, CELL.width * 0.9)
      context.fillStyle = ad.background === '#f2f0e8' || ad.background === '#e8d9b8' ? '#ffffff' : '#1a1a1a'
      context.font = `600 ${CELL.height * 0.1}px 'Baloo Tamma 2', system-ui, sans-serif`
      context.fillText(ad.line, x + CELL.width / 2, y + CELL.height * 0.89, CELL.width * 0.9)
      // Faded by the sun at the top, streaked by the rain down the sheet.
      const fade = context.createLinearGradient(0, y, 0, y + CELL.height)
      fade.addColorStop(0, 'rgb(255 250 235 / 18%)')
      fade.addColorStop(0.6, 'rgb(255 250 235 / 0%)')
      fade.addColorStop(1, 'rgb(40 30 20 / 18%)')
      context.fillStyle = fade
      context.fillRect(x, y, CELL.width, CELL.height)
      for (let k = 0; k < 14; k++) {
        context.fillStyle = 'rgb(40 30 20 / 7%)'
        context.fillRect(x + ((k * 73 + i * 37) % CELL.width), y, 3 + (k % 3) * 2, CELL.height * (0.3 + ((k * 13) % 7) / 10))
      }
    })
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Every hoarding's steel (posts and frame) and its sheet, each merged into one shape. */
function buildHoardings(hoardings: Hoarding[]): { steel: THREE.BufferGeometry | null; sheets: THREE.BufferGeometry | null } {
  const steel: THREE.BufferGeometry[] = []
  const sheets: THREE.BufferGeometry[] = []
  for (const { x, z, rotation, width, poster } of hoardings) {
    const base = groundLift.at(x, z)
    const place = (geometry: THREE.BufferGeometry, across: number, up: number, out: number) => {
      geometry.translate(across, base + up, out)
      geometry.rotateY(rotation)
      geometry.translate(x, 0, z)
      return geometry
    }
    for (const end of [-1, 1]) {
      steel.push(colored(place(new THREE.BoxGeometry(POST, RAISED + HEIGHT, POST).toNonIndexed(), end * width * 0.3, (RAISED + HEIGHT) / 2, -0.12), '#5a5d61'))
    }
    steel.push(colored(place(new THREE.BoxGeometry(width + 0.16, HEIGHT + 0.16, 0.1).toNonIndexed(), 0, RAISED + HEIGHT / 2, -0.06), '#3a3c40'))
    const sheet = place(new THREE.PlaneGeometry(width, HEIGHT), 0, RAISED + HEIGHT / 2, 0)
    // Its ad, out of the picture's grid.
    const column = poster % COLUMNS
    const row = Math.floor(poster / COLUMNS) % ROWS
    const uv = sheet.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (column + uv.getX(i)) / COLUMNS, 1 - (row + 1 - uv.getY(i)) / ROWS)
    }
    sheets.push(sheet)
  }
  const merge = (parts: THREE.BufferGeometry[]) => {
    if (parts.length === 0) return null
    const merged = mergeGeometries(parts)
    parts.forEach((part) => part.dispose())
    merged?.computeBoundingSphere()
    return merged
  }
  return { steel: merge(steel), sheets: merge(sheets) }
}

export function Hoardings({ hoardings }: { hoardings: Hoarding[] }) {
  const { steel, sheets } = useMemo(() => buildHoardings(hoardings), [hoardings])
  const texture = useMemo(() => drawAds(), [])
  useEffect(
    () => () => {
      steel?.dispose()
      sheets?.dispose()
      texture.dispose()
    },
    [steel, sheets, texture],
  )
  return (
    <>
      {steel && (
        <mesh geometry={steel} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.6} metalness={0.3} />
        </mesh>
      )}
      {sheets && (
        <mesh geometry={sheets} castShadow receiveShadow>
          <meshStandardMaterial map={texture} roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  )
}
