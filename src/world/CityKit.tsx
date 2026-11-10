import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky, liveView } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import type { KitPlacement } from './cityKitPlacement'

const KIT_URL = '/models/city-kit.glb'

/** The map is cut into squares this wide, and each piece gets one instanced mesh per square. */
const REGION_SIZE = 320
const WINDOW_NAME = 'Window'
/** Pale, as glass mostly shows the sky. Nothing here truly reflects, so this stands in for it. */
const GLASS_COLOR = '#8fb0c6'
const GLASS_ROUGHNESS = 0.25
const LIT_WINDOW = '#ffd9a0'
const WINDOW_GLOW = 0.9
const NIGHT_GLASS_DIMMING = 0.85

type Batch = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  placements: KitPlacement[]
}

type WindowMaterials = { dark: THREE.MeshStandardMaterial; lit: THREE.MeshStandardMaterial }

function createWindowMaterials(): WindowMaterials {
  const dark = new THREE.MeshStandardMaterial({ color: GLASS_COLOR, roughness: GLASS_ROUGHNESS })
  const lit = dark.clone()
  lit.emissive.set(LIT_WINDOW)
  lit.emissiveIntensity = 0
  return { dark, lit }
}

/** Sorts placements so that each run of them can be drawn in one call. */
function createBatches(
  scene: THREE.Group,
  placements: KitPlacement[],
  windows: WindowMaterials,
): Batch[] {
  const parts = new Map<string, THREE.Mesh[]>()
  scene.updateMatrixWorld()
  for (const object of scene.children) {
    const meshes: THREE.Mesh[] = []
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child)
    })
    parts.set(object.name, meshes)
  }

  const batches = new Map<string, Batch>()

  for (const placement of placements) {
    const region = `${Math.floor(placement.x / REGION_SIZE)},${Math.floor(placement.z / REGION_SIZE)}`

    ;(parts.get(placement.piece) ?? []).forEach((part, index) => {
      const source = part.material as THREE.MeshStandardMaterial
      const isWindow = source.name === WINDOW_NAME
      const showsLit = isWindow && placement.lit
      const key = `${placement.piece}/${index}/${region}/${showsLit}`

      const batch = batches.get(key)
      if (batch) {
        batch.placements.push(placement)
        return
      }

      batches.set(key, {
        geometry: part.geometry,
        material: isWindow ? (showsLit ? windows.lit : windows.dark) : source,
        placements: [placement],
      })
    })
  }

  return [...batches.values()]
}

function createInstances({ geometry, material, placements }: Batch): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  placements.forEach((placement, index) => {
    position.set(placement.x, placement.y, placement.z)
    rotation.setFromAxisAngle(up, placement.rotation)
    scale.set(placement.scaleX, placement.scaleY, placement.scaleZ)
    mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
  })

  mesh.instanceMatrix.needsUpdate = true
  mesh.receiveShadow = true
  mesh.computeBoundingSphere()
  return mesh
}

/** Glass that looks like sky by day would look lit at night, so it darkens as the sun goes. */
function updateWindows({ dark, lit }: WindowMaterials) {
  const dayShare = 1 - liveSky.look.night * NIGHT_GLASS_DIMMING
  dark.color.set(GLASS_COLOR).multiplyScalar(dayShare)
  lit.emissiveIntensity = liveSky.look.night * WINDOW_GLOW
}

/** Hides a region once its nearest edge is past the draw distance. */
function updateVisibility(mesh: THREE.InstancedMesh) {
  const sphere = mesh.boundingSphere
  if (!sphere) return

  const distance = Math.hypot(sphere.center.x - livePlayer.x, sphere.center.z - livePlayer.z)
  mesh.visible = distance - sphere.radius < liveView.drawDistance
}

/**
 * Doors, cornices, planters and whole walls from the city kit. One geometry is
 * sent to the GPU once and drawn many times, which is what instancing is for.
 */
export function CityKit({ placements }: { placements: KitPlacement[] }) {
  const { scene } = useGLTF(KIT_URL)
  const kitDetail = useGameStore((state) => QUALITY_PRESETS[state.quality].kitDetail)

  const windows = useMemo(() => createWindowMaterials(), [])
  useEffect(
    () => () => {
      windows.dark.dispose()
      windows.lit.dispose()
    },
    [windows],
  )

  const meshes = useMemo(() => {
    const shown = placements.filter((placement) => placement.detail <= kitDetail)
    return createBatches(scene, shown, windows).map(createInstances)
  }, [scene, placements, kitDetail, windows])

  // The geometry and materials belong to the loaded file, so only the instance data is freed.
  useEffect(() => () => meshes.forEach((mesh) => mesh.dispose()), [meshes])

  useFrame(() => {
    updateWindows(windows)
    meshes.forEach(updateVisibility)
  })

  return (
    <>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </>
  )
}

useGLTF.preload(KIT_URL)
