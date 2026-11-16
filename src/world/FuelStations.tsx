import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { liveSky } from '../game/livePlayer'
import {
  CANOPY,
  FUEL_BRAND_IDS,
  FUEL_BRANDS,
  ISLAND,
  islandSpots,
  pillarSpots,
  PILLAR_RADIUS,
  PYLON,
  pylonSpot,
  type FuelBrand,
  type FuelStation,
} from './fuelStationData'

/** The picture: each brand's canopy band as a row at the top, and its price sign below, side by side. */
const BAND = { width: 1024, height: 128 }
const PANEL = { width: 256, height: 416 }
const ATLAS = { width: BAND.width, height: BAND.height * FUEL_BRAND_IDS.length + PANEL.height }
/** Just above the pavement, so the forecourt never flickers against it. */
const PAD_HEIGHT = 0.045
const CONCRETE = '#a09c94'
const CANOPY_WHITE = '#f1f1ef'
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
 * The station's own frame: x along the road, y up, z away from it. Three.js
 * needs it right-handed, or every face would turn inside out, so it runs along
 * the road whichever way makes that so.
 */
function stationMatrix(station: FuelStation) {
  let { alongX, alongZ } = station
  if (-alongZ * station.outX + alongX * station.outZ < 0) {
    alongX = -alongX
    alongZ = -alongZ
  }
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(alongX, 0, alongZ),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(station.outX, 0, station.outZ),
  ).setPosition(station.x, 0, station.z)
}

function createStationGeometries(stations: FuelStation[]) {
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

    // The forecourt: from just behind the kerb to past the back of the canopy.
    const padFront = -station.front + 0.25
    const padBack = depth / 2 + 2
    const pad = new THREE.PlaneGeometry(length + 8, padBack - padFront).rotateX(-Math.PI / 2)
    local.push(painted(pad.translate(0, PAD_HEIGHT, (padFront + padBack) / 2), CONCRETE))

    // The canopy and its pillars.
    local.push(painted(box(length, thickness, depth, 0, height - thickness, 0), CANOPY_WHITE))
    for (const [along, out] of pillarSpots(station)) {
      local.push(painted(box(PILLAR_RADIUS * 2, height - thickness, PILLAR_RADIUS * 2, along, 0, out), CANOPY_WHITE))
      local.push(painted(box(PILLAR_RADIUS * 2 + 0.02, 0.9, PILLAR_RADIUS * 2 + 0.02, along, 0, out), brand.primary))
    }

    // Two pump islands, each with a pump at either end.
    for (const along of islandSpots(station)) {
      local.push(painted(box(ISLAND.length, 0.22, ISLAND.width, along, 0, 0), '#d8d4cb'))
      for (const end of [-1, 1]) {
        const at = along + end * (ISLAND.length / 2 - 0.55)
        local.push(painted(box(0.62, 1.45, 0.5, at, 0.22, 0), brand.primary))
        local.push(painted(box(0.64, 0.32, 0.52, at, 1.67, 0), brand.secondary))
        local.push(painted(box(0.4, 0.3, 0.52, at, 0.95, 0), '#20242a'))
      }
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
    const [signAlong, signOut] = pylonSpot(station)
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
  return { solids: merge(solids), faces: merge(faces), lights: merge(lights) }
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
export function FuelStations({ stations }: { stations: FuelStation[] }) {
  const geometries = useMemo(() => createStationGeometries(stations), [stations])
  const materials = useMemo(() => {
    const texture = createAtlasTexture()
    return {
      solids: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
      faces: new THREE.MeshStandardMaterial({ map: texture, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: 0, roughness: 0.5 }),
      lights: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 0.3 }),
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
    </>
  )
}
