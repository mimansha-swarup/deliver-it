import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { liveSky } from '../game/livePlayer'
import { patchConcrete } from './groundShaders'
import {
  CANOPY,
  forecourtEnds,
  OFFICE,
  officeOf,
  yardEnd,
  FUEL_BRAND_IDS,
  FUEL_BRANDS,
  ISLAND,
  islandSpots,
  pillarSpots,
  PILLAR_RADIUS,
  PYLON,
  pylonSpot,
  TYRE_LOT,
  type FuelBrand,
  type FuelStation,
  type TyreShop,
} from './fuelStationData'

/** The picture: each brand's canopy band as a row at the top, and its price sign below, side by side. */
const BAND = { width: 1024, height: 128 }
const PANEL = { width: 256, height: 416 }
const ATLAS = { width: BAND.width, height: BAND.height * FUEL_BRAND_IDS.length + PANEL.height }
/** Just above the pavement, so the forecourt never flickers against it. */
const PAD_HEIGHT = 0.045
const CANOPY_WHITE = '#f1f1ef'
/** Kerbs round the pump islands, painted in turn, and the bollards at their ends. */
const KERB_YELLOW = '#d9b23a'
const KERB_BLACK = '#26262a'
const ISLAND_TOP = '#b9b4aa'
/** Paint on the forecourt: the lanes past the pumps and the arrows in and out, faded. */
const LINE_YELLOW = '#cfae4a'
const LINE_WHITE = '#d8d6cf'
/** The office's plaster, weathered. */
const OFFICE_PLASTER = '#d8c9a6'
const NIGHT_GLOW = 1.1

function drawBand(context: CanvasRenderingContext2D, brand: FuelBrand, top: number) {
  context.fillStyle = brand.primary
  context.fillRect(0, top, BAND.width, BAND.height)
  context.fillStyle = brand.secondary
  context.fillRect(0, top + BAND.height - 18, BAND.width, 18)
  context.fillStyle = brand.lettering
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `800 72px 'Baloo Tamma 2', system-ui, sans-serif`
  context.fillText(brand.name, BAND.width / 2, top + BAND.height * 0.45, BAND.width - 120)
}

/** The tall sign: the name at the top, then today's prices on a panel in the second colour. */
function drawPanel(context: CanvasRenderingContext2D, brand: FuelBrand, left: number, top: number) {
  context.fillStyle = brand.primary
  context.fillRect(left, top, PANEL.width, PANEL.height)
  context.fillStyle = brand.lettering
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `800 40px 'Baloo Tamma 2', system-ui, sans-serif`
  const [first, ...rest] = brand.name.split(' ')
  context.fillText(first, left + PANEL.width / 2, top + 52, PANEL.width - 24)
  context.font = `700 30px 'Baloo Tamma 2', system-ui, sans-serif`
  context.fillText(rest.join(' '), left + PANEL.width / 2, top + 96, PANEL.width - 24)

  context.fillStyle = brand.secondary
  context.fillRect(left + 16, top + 140, PANEL.width - 32, PANEL.height - 160)
  const priceColour = brand.secondary.toLowerCase() > '#c' ? '#123' : '#ffffff'
  const prices = [
    ['PETROL', '102.9'],
    ['DIESEL', '88.9'],
    ['POWER', '110.5'],
  ]
  prices.forEach(([fuel, price], row) => {
    const y = top + 180 + row * 76
    context.fillStyle = priceColour
    context.textAlign = 'left'
    context.font = `700 24px system-ui, sans-serif`
    context.fillText(fuel, left + 30, y)
    context.fillStyle = '#ff5a3c'
    context.fillRect(left + 132, y - 22, 98, 44)
    context.fillStyle = '#ffe9a8'
    context.textAlign = 'center'
    context.font = `700 26px ui-monospace, Menlo, monospace`
    context.fillText(price, left + 181, y + 1)
  })
}

function paintAtlas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  FUEL_BRAND_IDS.forEach((id, index) => {
    drawBand(context, FUEL_BRANDS[id], index * BAND.height)
    drawPanel(context, FUEL_BRANDS[id], index * PANEL.width, BAND.height * FUEL_BRAND_IDS.length)
  })
}

function createAtlasTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS.width
  canvas.height = ATLAS.height
  paintAtlas(canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  document.fonts?.load(`800 72px 'Baloo Tamma 2'`).then(() => {
    paintAtlas(canvas)
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** Points a plane's picture at one rectangle of the atlas, given in pixels from its top left. */
function mapToRect(plane: THREE.BufferGeometry, left: number, top: number, width: number, height: number) {
  const uv = plane.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (left + uv.getX(i) * width) / ATLAS.width, 1 - (top + (1 - uv.getY(i)) * height) / ATLAS.height)
  }
  return plane
}

/** Gives every corner of a shape one colour, so many shapes can share one material. */
function painted(geometry: THREE.BufferGeometry, colour: string) {
  const color = new THREE.Color(colour)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** A box on the forecourt, `along` and `out` from the canopy's middle, standing on `bottom`. */
function box(width: number, height: number, depth: number, along: number, bottom: number, out: number) {
  return new THREE.BoxGeometry(width, height, depth).translate(along, bottom + height / 2, out)
}

/**
 * -1 where the drawing frame runs along the road the other way from the station's own (as
 * `spotOf` and the placement use it), so anything not the same at both ends is mirrored to match.
 */
function alongSign(station: FuelStation) {
  return -station.alongZ * station.outX + station.alongX * station.outZ < 0 ? -1 : 1
}

/**
 * The station's own frame: x along the road, y up, z away from it. Three.js
 * needs it right-handed, or every face would turn inside out, so it runs along
 * the road whichever way makes that so.
 */
function stationMatrix(station: FuelStation) {
  let { alongX, alongZ } = station
  if (alongSign(station) < 0) {
    alongX = -alongX
    alongZ = -alongZ
  }
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(alongX, 0, alongZ),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(station.outX, 0, station.outZ),
  ).setPosition(station.x, 0, station.z)
}

/** A flat strip of paint on the forecourt, `along` and `out` from the canopy's middle. */
function stripe(width: number, depth: number, along: number, out: number) {
  return new THREE.PlaneGeometry(width, depth).toNonIndexed().rotateX(-Math.PI / 2).translate(along, PAD_HEIGHT + 0.01, out)
}

/** A painted arrow 2.4 m long on the forecourt, pointing along (`way` 1) or back along the road. */
function arrow(along: number, out: number, way: number) {
  const shaft = new THREE.PlaneGeometry(1.5, 0.22).rotateX(-Math.PI / 2).translate(-0.45 * way, 0, 0)
  const head = new THREE.BufferGeometry()
  head.setAttribute('position', new THREE.Float32BufferAttribute([0.3 * way, 0, -0.45, 0.3 * way, 0, 0.45, 1.2 * way, 0, 0], 3))
  head.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
  head.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5], 2))
  if (way < 0) head.setIndex([0, 2, 1])
  else head.setIndex([0, 1, 2])
  const merged = mergeGeometries([shaft.toNonIndexed(), head.toNonIndexed()])
  return merged.translate(along, PAD_HEIGHT + 0.01, out)
}

/**
 * The forecourt's concrete, from `start` to `end` along the road and `front` to `back` away from
 * it: uv in metres along its slabs, and `aStain`, how oily, highest in the lanes by the islands.
 */
function createPad(station: FuelStation, start: number, end: number, front: number, back: number) {
  const width = end - start
  const deep = back - front
  const pad = new THREE.PlaneGeometry(width, deep, Math.max(1, Math.round(width)), Math.max(1, Math.round(deep))).rotateX(-Math.PI / 2)
  pad.translate((start + end) / 2, PAD_HEIGHT, (front + back) / 2)
  const position = pad.getAttribute('position') as THREE.BufferAttribute
  const uv = pad.getAttribute('uv') as THREE.BufferAttribute
  const stain = new Float32Array(position.count)
  const islands = islandSpots(station)
  for (let i = 0; i < position.count; i++) {
    const along = position.getX(i)
    const out = position.getZ(i)
    uv.setXY(i, along, out)
    const toIsland = Math.min(...islands.map((at) => Math.max(0, Math.abs(along - at) - ISLAND.length / 2)))
    const inLane = Math.abs(Math.abs(out) - (ISLAND.width / 2 + 1.3))
    stain[i] = Math.max(0.15, 1 - toIsland / 3 - Math.max(0, inLane - 0.6) / 1.5)
  }
  pad.setAttribute('aStain', new THREE.BufferAttribute(stain, 1))
  return pad
}

/** The tyre shop's board: PUNCTURE in English and Kannada, hand-painted, red on yellow. */
function createTyreBoardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 160
  const paint = () => {
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#e8c33a'
    context.fillRect(0, 0, 512, 160)
    context.fillStyle = '#b8322a'
    context.fillRect(0, 0, 512, 14)
    context.fillRect(0, 146, 512, 14)
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 54px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText('ಪಂಕ್ಚರ್ ಶಾಪ್', 256, 58, 480)
    context.fillStyle = '#1f2a5a'
    context.font = `800 40px 'Baloo Tamma 2', system-ui, sans-serif`
    context.fillText('PUNCTURE · TYRES', 256, 118, 480)
  }
  paint()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  document.fonts?.load(`800 54px 'Baloo Tamma 2'`).then(() => {
    paint()
    texture.needsUpdate = true
  }, () => {})
  return texture
}

/** A tyre, lying flat or standing, `along` and `out` in the shop's frame. */
function tyre(along: number, bottom: number, out: number, standing = false) {
  const geometry = new THREE.TorusGeometry(0.3, 0.11, 5, 12)
  if (!standing) geometry.rotateX(Math.PI / 2)
  return painted(geometry.translate(along, bottom + (standing ? 0.41 : 0.11), out), '#1b1b1d')
}

/** The tyre shop: a tin shed on poles open to the road, tyres stacked out front, a compressor and the board. */
function createTyreShop(shop: TyreShop, solids: THREE.BufferGeometry[], boards: THREE.BufferGeometry[]) {
  const matrix = stationMatrix(shop.station)
  const parts: THREE.BufferGeometry[] = []
  const back = shop.out + TYRE_LOT.depth / 2 - 1.8
  const front = back - 3.2
  const flip = alongSign(shop.station)
  const a = shop.along * flip
  // Poles, a tin roof sloping back, tin sheets at the back and one side.
  for (const along of [-2.2, 2.2]) {
    parts.push(painted(box(0.08, 2.7, 0.08, a + along, 0, front), '#5c5f63'))
    parts.push(painted(box(0.08, 2.4, 0.08, a + along, 0, back), '#5c5f63'))
  }
  const roof = new THREE.BoxGeometry(4.8, 0.04, 3.7).rotateX(-0.1).translate(a, 2.6, (front + back) / 2)
  parts.push(painted(roof, '#7a6e64'))
  parts.push(painted(box(4.4, 2.3, 0.04, a, 0, back), '#6c7277'))
  parts.push(painted(box(0.04, 2.3, 3.2, a - 2.2, 0, (front + back) / 2), '#8a7b6c'))
  // Inside: a bench with tools, a compressor, a tub of water for finding the leak.
  parts.push(painted(box(1.6, 0.75, 0.6, a - 1.1, 0, back - 0.45), '#6b4a32'))
  parts.push(painted(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 10).rotateZ(Math.PI / 2).translate(a + 1.2, 0.5, back - 0.6), '#b33b2c'))
  parts.push(painted(box(0.7, 0.3, 0.5, a + 1.2, 0, back - 0.6), '#3d3f42'))
  parts.push(painted(new THREE.CylinderGeometry(0.35, 0.3, 0.35, 10).translate(a + 0.2, 0.18, front + 0.8), '#3a6b8f'))
  // Tyres: stacks out front, and a few standing against the poles.
  for (const [along, count] of [[-1.6, 4], [-0.9, 3], [1.6, 5]] as const) for (let i = 0; i < count; i++) parts.push(tyre(a + along, i * 0.22, front - 0.6))
  for (const along of [-2.6, 2.6]) parts.push(tyre(a + along, 0, front + 0.2, true))
  // The board on two posts at the road end of the lot.
  const boardOut = shop.out - TYRE_LOT.depth / 2 + 0.3
  for (const along of [-1.1, 1.1]) parts.push(painted(box(0.07, 2.4, 0.07, a + along - 2.6 * flip, 0, boardOut), '#4a4d51'))
  for (const geometry of parts) solids.push(geometry.applyMatrix4(matrix))
  const board = mapToTyreBoard(new THREE.PlaneGeometry(2.6, 0.82))
  boards.push(board.rotateY(Math.PI).translate(a - 2.6 * flip, 1.95, boardOut - 0.04).applyMatrix4(matrix))
  boards.push(mapToTyreBoard(new THREE.PlaneGeometry(2.6, 0.82)).translate(a - 2.6 * flip, 1.95, boardOut + 0.04).applyMatrix4(matrix))
}

/** The board's own picture fills its plane; vertex colours white, so the shared material shows it as it is. */
function mapToTyreBoard(plane: THREE.BufferGeometry) {
  return painted(plane, '#ffffff')
}

function createStationGeometries(stations: FuelStation[]) {
  const pads: THREE.BufferGeometry[] = []
  const paint: THREE.BufferGeometry[] = []
  const solids: THREE.BufferGeometry[] = []
  const faces: THREE.BufferGeometry[] = []
  const lights: THREE.BufferGeometry[] = []
  const { height, thickness } = CANOPY

  for (const station of stations) {
    const matrix = stationMatrix(station)
    const { length, depth } = station
    const brand = FUEL_BRANDS[station.brand]
    const index = FUEL_BRAND_IDS.indexOf(station.brand)
    const local: THREE.BufferGeometry[] = []
    const localFaces: THREE.BufferGeometry[] = []

    // The forecourt: concrete slabs from just behind the kerb to past the back of the canopy, and
    // along to the yard's end and past the sign. Oil stains are thickest in the lanes by the pumps.
    const padFront = -station.front + 0.25
    const padBack = depth / 2 + 2
    const flip = alongSign(station)
    const [padStart, padEnd] = forecourtEnds(station).map((end) => end * flip).sort((p, q) => p - q)
    pads.push(createPad(station, padStart - (flip < 0 ? 1 : 0), padEnd + (flip > 0 ? 1 : 0), padFront, padBack).applyMatrix4(matrix))

    // Paint: a yellow lane round each island, and white arrows in and out by the road.
    for (const along of islandSpots(station)) {
      const halfLength = ISLAND.length / 2 + 1.2
      const halfWidth = ISLAND.width / 2 + 2.3
      for (const out of [-halfWidth, halfWidth]) paint.push(painted(stripe(halfLength * 2, 0.12, along, out), LINE_YELLOW))
      for (const end of [-halfLength, halfLength]) paint.push(painted(stripe(0.12, halfWidth * 2, along + end, 0), LINE_YELLOW))
    }
    const arrowOut = Math.min(padFront + 2.2, -depth / 2 - 1)
    paint.push(painted(arrow(length / 2 + 0.5, arrowOut, -1), LINE_WHITE))
    paint.push(painted(arrow(-length / 2 - 0.5, arrowOut, -1), LINE_WHITE))

    // The canopy and its pillars.
    local.push(painted(box(length, thickness, depth, 0, height - thickness, 0), CANOPY_WHITE))
    for (const [along, out] of pillarSpots(station)) {
      local.push(painted(box(PILLAR_RADIUS * 2, height - thickness, PILLAR_RADIUS * 2, along, 0, out), CANOPY_WHITE))
      local.push(painted(box(PILLAR_RADIUS * 2 + 0.02, 0.9, PILLAR_RADIUS * 2 + 0.02, along, 0, out), brand.primary))
    }

    // The pump islands: a raised concrete top in a kerb painted yellow and black, a pump at either
    // end and a bollard past each end, as a car's bumper finds them.
    for (const along of islandSpots(station)) {
      local.push(painted(box(ISLAND.length - 0.16, 0.2, ISLAND.width - 0.16, along, 0, 0), ISLAND_TOP))
      const segments = 6
      for (let i = 0; i < segments; i++) {
        const piece = ISLAND.length / segments
        const at = along - ISLAND.length / 2 + piece * (i + 0.5)
        const colour = i % 2 === 0 ? KERB_YELLOW : KERB_BLACK
        for (const side of [-1, 1]) local.push(painted(box(piece, 0.24, 0.1, at, 0, side * (ISLAND.width / 2 - 0.05)), colour))
      }
      for (const end of [-1, 1]) {
        local.push(painted(box(0.1, 0.24, ISLAND.width, along + end * (ISLAND.length / 2 - 0.05), 0, 0), KERB_YELLOW))
        local.push(painted(box(0.16, 0.9, 0.16, along + end * (ISLAND.length / 2 + 0.35), 0, 0), KERB_YELLOW))
        local.push(painted(box(0.17, 0.12, 0.17, along + end * (ISLAND.length / 2 + 0.35), 0.55, 0), KERB_BLACK))
        const at = along + end * (ISLAND.length / 2 - 0.55)
        local.push(painted(box(0.62, 1.45, 0.5, at, 0.24, 0), brand.primary))
        local.push(painted(box(0.64, 0.32, 0.52, at, 1.69, 0), brand.secondary))
        local.push(painted(box(0.4, 0.3, 0.52, at, 0.97, 0), '#20242a'))
        // The nozzle's hose, hanging in a loop down the pump's side.
        local.push(painted(box(0.05, 0.8, 0.05, at + end * 0.33, 0.55, 0.12), '#151515'))
      }
    }

    // The yard: the office with the company's colours along its top, and the air and water stand.
    const office = officeOf(station)
    if (office) {
      const { out } = office
      const along = office.along * flip
      local.push(painted(box(OFFICE.length, OFFICE.height, OFFICE.depth, along, 0, out), OFFICE_PLASTER))
      local.push(painted(box(OFFICE.length + 0.3, 0.15, OFFICE.depth + 0.3, along, OFFICE.height, out), '#9d978c'))
      local.push(painted(box(OFFICE.length + 0.02, 0.5, OFFICE.depth + 0.02, along, OFFICE.height - 0.6, out), brand.primary))
      local.push(painted(box(0.95, 2.1, 0.06, along + 1.2 * flip, 0, out - OFFICE.depth / 2 - 0.02), '#4a3c30'))
      local.push(painted(box(1.6, 1.0, 0.06, along - 1, 1.0, out - OFFICE.depth / 2 - 0.02), '#2c3238'))
      local.push(painted(box(1.75, 0.08, 0.1, along - 1, 0.95, out - OFFICE.depth / 2 - 0.05), '#8a8478'))
      // Grime up the base of the walls.
      local.push(painted(box(OFFICE.length + 0.02, 0.35, OFFICE.depth + 0.02, along, 0, out), '#a39578'))
      // The tank's black water tank on the roof.
      local.push(painted(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 10).translate(along + 1.4, OFFICE.height + 0.6, out + 0.5), '#1e1f22'))
      // Air and water: a short post in the brand's second colour, by the yard's road end.
      const airAlong = (yardEnd(station) - station.yardSide * 1.5) * flip
      const airOut = Math.min(-station.front + 4.2, out - OFFICE.depth / 2 - 1.5)
      local.push(painted(box(0.35, 1.3, 0.3, airAlong, 0, airOut), brand.secondary))
      local.push(painted(box(0.4, 0.3, 0.34, airAlong, 1.3, airOut), brand.primary))
      local.push(painted(box(0.6, 0.6, 0.6, airAlong - station.yardSide * flip * 0.8, 0, airOut + 0.2), '#3a5f8a'))
      local.push(painted(box(0.6, 0.6, 0.6, airAlong - station.yardSide * flip * 1.5, 0, airOut + 0.1), '#7a3a2a'))
    }

    // The band round the canopy's edge, with the name on it, on all four sides.
    const band = () => mapToRect(new THREE.PlaneGeometry(1, 1), 0, index * BAND.height, BAND.width, BAND.height)
    const bandY = height - thickness / 2
    // A few centimetres proud of the canopy, so the two never flicker, even from far off.
    const proud = 0.04
    localFaces.push(band().scale(length, thickness, 1).rotateY(Math.PI).translate(0, bandY, -depth / 2 - proud))
    localFaces.push(band().scale(length, thickness, 1).translate(0, bandY, depth / 2 + proud))
    localFaces.push(band().scale(depth, thickness, 1).rotateY(Math.PI / 2).translate(length / 2 + proud, bandY, 0))
    localFaces.push(band().scale(depth, thickness, 1).rotateY(-Math.PI / 2).translate(-length / 2 - proud, bandY, 0))

    // The tall price sign by the road, readable from both ways along it.
    const [pylonAlong, signOut] = pylonSpot(station)
    const signAlong = pylonAlong * flip
    local.push(painted(box(0.25, PYLON.height - PYLON.panel, 0.25, signAlong, 0, signOut), '#8a8d93'))
    local.push(painted(box(0.3, PYLON.panel + 0.1, PYLON.width + 0.1, signAlong, PYLON.height - PYLON.panel - 0.05, signOut), '#2b2d31'))
    const panel = () =>
      mapToRect(new THREE.PlaneGeometry(PYLON.width, PYLON.panel), index * PANEL.width, BAND.height * FUEL_BRAND_IDS.length, PANEL.width, PANEL.height)
    const panelY = PYLON.height - PYLON.panel / 2
    localFaces.push(panel().rotateY(Math.PI / 2).translate(signAlong + 0.19, panelY, signOut))
    localFaces.push(panel().rotateY(-Math.PI / 2).translate(signAlong - 0.19, panelY, signOut))

    // Lights along the canopy's underside, facing down.
    const glow = new THREE.PlaneGeometry(length - 1.5, depth - 1.5).rotateX(Math.PI / 2).translate(0, height - thickness - 0.01, 0)
    lights.push(glow.applyMatrix4(matrix))

    for (const geometry of local) solids.push(geometry.applyMatrix4(matrix))
    for (const geometry of localFaces) faces.push(geometry.applyMatrix4(matrix))
  }

  const merge = (list: THREE.BufferGeometry[]) => (list.length > 0 ? mergeGeometries(list) : null)
  return { solids: merge(solids), faces: merge(faces), lights: merge(lights), pads: merge(pads), paint: merge(paint) }
}

function updateGlow(faces: THREE.MeshStandardMaterial, lights: THREE.MeshStandardMaterial) {
  const night = liveSky.look.night
  faces.emissiveIntensity = 0.15 + night * NIGHT_GLOW
  lights.emissiveIntensity = 0.3 + night * 1.6
}

/**
 * HSR's petrol bunks: a white canopy with the company's band round it, two pump
 * islands, a tall price sign by the road and a concrete forecourt. The canopy's
 * underside lights up after dark. Three meshes for all of them.
 */
export function FuelStations({ stations, tyreShops = [] }: { stations: FuelStation[]; tyreShops?: TyreShop[] }) {
  const geometries = useMemo(() => createStationGeometries(stations), [stations])
  const tyres = useMemo(() => {
    const solids: THREE.BufferGeometry[] = []
    const boards: THREE.BufferGeometry[] = []
    for (const shop of tyreShops) createTyreShop(shop, solids, boards)
    return { solids: solids.length > 0 ? mergeGeometries(solids) : null, boards: boards.length > 0 ? mergeGeometries(boards) : null }
  }, [tyreShops])
  const boardMaterial = useMemo(() => new THREE.MeshStandardMaterial({ map: createTyreBoardTexture(), roughness: 0.8, side: THREE.DoubleSide }), [])
  useEffect(
    () => () => {
      tyres.solids?.dispose()
      tyres.boards?.dispose()
    },
    [tyres],
  )
  useEffect(
    () => () => {
      boardMaterial.map?.dispose()
      boardMaterial.dispose()
    },
    [boardMaterial],
  )
  const materials = useMemo(() => {
    const texture = createAtlasTexture()
    return {
      solids: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
      faces: new THREE.MeshStandardMaterial({ map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0, roughness: 0.5 }),
      lights: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.3 }),
      pads: (() => {
        const concrete = new THREE.MeshStandardMaterial({ roughness: 0.92 })
        patchConcrete(concrete)
        return concrete
      })(),
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    }
  }, [])

  useEffect(
    () => () => {
      Object.values(geometries).forEach((geometry) => geometry?.dispose())
      materials.faces.map?.dispose()
      Object.values(materials).forEach((material) => material.dispose())
    },
    [geometries, materials],
  )

  useFrame(() => updateGlow(materials.faces, materials.lights))

  return (
    <>
      {geometries.solids && <mesh geometry={geometries.solids} material={materials.solids} castShadow receiveShadow />}
      {geometries.faces && <mesh geometry={geometries.faces} material={materials.faces} />}
      {geometries.lights && <mesh geometry={geometries.lights} material={materials.lights} />}
      {geometries.pads && <mesh geometry={geometries.pads} material={materials.pads} receiveShadow />}
      {geometries.paint && <mesh geometry={geometries.paint} material={materials.paint} receiveShadow />}
      {tyres.solids && <mesh geometry={tyres.solids} material={materials.solids} castShadow receiveShadow />}
      {tyres.boards && <mesh geometry={tyres.boards} material={boardMaterial} />}
    </>
  )
}
