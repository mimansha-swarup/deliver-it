import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { colored, merge } from './simpleShapes'
import { courtSize, pitchPoint, type Pitch } from './pitches'

/*
 * Draws the sports pitches (pitches.ts): courts and their lines as flat painted shapes just above
 * the ground, and the hoops, nets, goals and stumps. All vertex coloured, one mesh for the lot
 * (there are under twenty pitches), under the shared light like everything else.
 */

/** Just above the ground, and the lines just above the court. */
const COURT_HEIGHT = 0.03
const LINE_HEIGHT = 0.035
const LINE = 0.06

const CLAY = '#b58d63'
const RED_OXIDE = '#8a5546'
const COURT_GREEN = '#4d7558'
const COURT_EARTH = '#a8714c'
const PAINT = '#dcd8cc'
const STEEL = '#6d7074'
const NET = '#2a2c2e'

/** A flat rectangle on the pitch, `along` and `across` from its middle, turned with it. */
function flat(pitch: Pitch, along: number, across: number, length: number, width: number, height: number, color: string) {
  const geometry = new THREE.PlaneGeometry(length, width).toNonIndexed()
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(along, height, across)
  return placed(pitch, colored(geometry, color))
}

/** An upright box on the pitch. */
function post(pitch: Pitch, along: number, across: number, size: [number, number, number], bottom: number, color: string) {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed()
  geometry.translate(along, bottom + size[1] / 2, across)
  return placed(pitch, colored(geometry, color))
}

/** Moves a shape drawn in the pitch's own frame (x along, z across) onto it. */
function placed(pitch: Pitch, geometry: THREE.BufferGeometry) {
  const [x, z] = pitchPoint(pitch, 0, 0)
  // Turning about y by -angle takes +x to (cos, sin) in x and z, as pitchPoint does.
  return geometry.rotateY(-pitch.angle).translate(x, 0, z)
}

/** A court's outline in lines, and its middle line across. */
function courtLines(pitch: Pitch, length: number, width: number) {
  return [
    flat(pitch, 0, -width / 2, length, LINE, LINE_HEIGHT, PAINT),
    flat(pitch, 0, width / 2, length, LINE, LINE_HEIGHT, PAINT),
    flat(pitch, -length / 2, 0, LINE, width, LINE_HEIGHT, PAINT),
    flat(pitch, length / 2, 0, LINE, width, LINE_HEIGHT, PAINT),
    flat(pitch, 0, 0, LINE, width, LINE_HEIGHT, PAINT),
  ]
}

function pitchParts(pitch: Pitch): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  if (pitch.sport === 'cricket') {
    // The rolled clay strip, 20 m between the stumps, with creases and stumps at each end.
    parts.push(flat(pitch, 0, 0, 22, 3, COURT_HEIGHT, CLAY))
    for (const end of [-1, 1]) {
      parts.push(flat(pitch, end * 10.06, 0, LINE, 2.64, LINE_HEIGHT, PAINT))
      parts.push(flat(pitch, end * 8.84, 0, LINE, 3, LINE_HEIGHT, PAINT))
      for (const across of [-0.11, 0, 0.11]) parts.push(post(pitch, end * 10.06, across, [0.035, 0.71, 0.035], 0, '#d9cfb5'))
    }
  } else if (pitch.sport === 'basketball') {
    const [length, width] = courtSize(pitch, 'basketball')
    parts.push(flat(pitch, 0, 0, length + 1.5, width + 1.5, COURT_HEIGHT, RED_OXIDE))
    parts.push(...courtLines(pitch, length, width))
    for (const end of [-1, 1]) {
      // The key, and the hoop: a pole past the end line, its arm, the board and a ring.
      parts.push(flat(pitch, end * (length / 2 - 2.9), -2.45, 5.8, LINE, LINE_HEIGHT, PAINT))
      parts.push(flat(pitch, end * (length / 2 - 2.9), 2.45, 5.8, LINE, LINE_HEIGHT, PAINT))
      parts.push(flat(pitch, end * (length / 2 - 5.8), 0, LINE, 4.9, LINE_HEIGHT, PAINT))
      parts.push(post(pitch, end * (length / 2 + 0.6), 0, [0.16, 3.2, 0.16], 0, STEEL))
      parts.push(post(pitch, end * (length / 2 + 0.1), 0, [1.0, 0.08, 0.08], 3.0, STEEL))
      parts.push(post(pitch, end * (length / 2 - 0.4), 0, [0.05, 1.05, 1.8], 2.9, '#e8e6e0'))
      const ring = new THREE.TorusGeometry(0.23, 0.02, 4, 12).toNonIndexed().rotateX(Math.PI / 2)
      ring.translate(end * (length / 2 - 0.68), 3.05, 0)
      parts.push(placed(pitch, colored(ring, '#c4482b')))
    }
  } else if (pitch.sport === 'net' || pitch.sport === 'kabaddi') {
    const kind = pitch.sport === 'net' ? 'net' : 'kabaddi'
    const [length, width] = courtSize(pitch, kind)
    parts.push(flat(pitch, 0, 0, length + 3, width + 2, COURT_HEIGHT, kind === 'net' ? COURT_GREEN : COURT_EARTH))
    parts.push(...courtLines(pitch, length, width))
    if (kind === 'net') {
      for (const side of [-1, 1]) parts.push(post(pitch, 0, side * (width / 2 + 0.5), [0.08, 1.1, 0.08], 0, STEEL))
      const net = new THREE.PlaneGeometry(width + 1, 0.8).toNonIndexed().rotateY(Math.PI / 2)
      net.translate(0, 0.65, 0)
      parts.push(placed(pitch, colored(net, NET)))
      parts.push(post(pitch, 0, 0, [0.03, 0.05, width + 1], 1.05, '#e8e6e0'))
    }
  } else if (pitch.sport === 'football') {
    for (const end of [-1, 1]) {
      const at = end * (pitch.halfLength - 2)
      for (const side of [-1, 1]) parts.push(post(pitch, at, side * 1.8, [0.1, 2.1, 0.1], 0, '#e8e6e0'))
      parts.push(post(pitch, at, 0, [0.1, 0.1, 3.7], 2.05, '#e8e6e0'))
    }
  }
  return parts
}

export function SportsPitches({ pitches }: { pitches: Pitch[] }) {
  const geometry = useMemo(() => {
    const parts = pitches.flatMap(pitchParts)
    return parts.length > 0 ? merge(parts) : null
  }, [pitches])
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    [],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  if (!geometry) return null
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}
