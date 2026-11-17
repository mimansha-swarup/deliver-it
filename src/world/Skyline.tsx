import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { createRandom } from './props'
import { PLAY_AREA } from './worldUtils'

/*
 * The city carrying on past the edge of the map (ART_DIRECTION.md: the same
 * light and haze over everything). Outside the boundary wall stands a line of
 * trees, then two rows of building silhouettes, in the plaster colours of HSR,
 * with black water tanks on their roofs. Seen through the haze, the map's edge
 * reads as more city, not as a wall with nothing behind it.
 *
 * They're plain boxes with a pattern of windows drawn by their shader from
 * where each face is, so every building is one instance of one box: the whole
 * ring is three draw calls. Nobody can ride out to look at them up close.
 */

/** How far out from the wall the trees and the two rows of buildings stand, in metres. */
const TREE_OUT: [number, number] = [6, 16]
const ROWS: { out: [number, number]; height: [number, number]; width: [number, number] }[] = [
  { out: [22, 34], height: [7, 16], width: [9, 16] },
  { out: [42, 70], height: [12, 34], width: [12, 26] },
]
const PLASTER = ['#d8c9a8', '#e3b9a5', '#cfd6c2', '#e8d8a0', '#c9a383', '#d9d4c8', '#b9c6c9', '#e6c3c9'].map((hex) => new THREE.Color(hex))
const CANOPY = ['#4f7a3a', '#5e8a3f', '#3f6d3b', '#6c9347'].map((hex) => new THREE.Color(hex))
const TANK = new THREE.Color('#1c1d1f')

type Item = { x: number; z: number; width: number; depth: number; height: number; rotation: number; color: THREE.Color }

/** Walks round the outside of the play area, calling `place` every `step` metres with a point and the way out. */
function aroundTheEdge(step: number, place: (x: number, z: number, outX: number, outZ: number, alongX: number, alongZ: number) => void) {
  const { minX, maxX, minZ, maxZ } = PLAY_AREA
  const sides: [number, number, number, number, number, number][] = [
    [minX, minZ, maxX, minZ, 0, -1],
    [maxX, minZ, maxX, maxZ, 1, 0],
    [maxX, maxZ, minX, maxZ, 0, 1],
    [minX, maxZ, minX, minZ, -1, 0],
  ]
  for (const [x0, z0, x1, z1, outX, outZ] of sides) {
    const length = Math.hypot(x1 - x0, z1 - z0)
    const alongX = (x1 - x0) / length
    const alongZ = (z1 - z0) / length
    for (let s = 0; s < length; s += step) place(x0 + alongX * s, z0 + alongZ * s, outX, outZ, alongX, alongZ)
  }
}

function planSkyline() {
  const random = createRandom(90210)
  const buildings: Item[] = []
  const tanks: Item[] = []
  const trees: Item[] = []
  for (const row of ROWS) {
    aroundTheEdge(row.width[0], (x, z, outX, outZ, alongX, alongZ) => {
      if (random() < 0.12) return
      const out = row.out[0] + random() * (row.out[1] - row.out[0])
      const width = row.width[0] + random() * (row.width[1] - row.width[0])
      const depth = 10 + random() * 14
      const height = row.height[0] + random() * (row.height[1] - row.height[0])
      const bx = x + outX * (out + depth / 2) + alongX * random() * 4
      const bz = z + outZ * (out + depth / 2) + alongZ * random() * 4
      const rotation = Math.atan2(outX, outZ) + (random() - 0.5) * 0.1
      buildings.push({ x: bx, z: bz, width, depth, height, rotation, color: PLASTER[Math.floor(random() * PLASTER.length)] })
      // A water tank or two on the roof.
      for (let t = 0; t < 1 + Math.floor(random() * 2); t++) {
        tanks.push({ x: bx + (random() - 0.5) * width * 0.6, z: bz + (random() - 0.5) * depth * 0.6, width: 1.2, depth: 1.2, height: height + 1.1, rotation: 0, color: TANK })
      }
    })
  }
  aroundTheEdge(7, (x, z, outX, outZ, alongX, alongZ) => {
    if (random() < 0.3) return
    const out = TREE_OUT[0] + random() * (TREE_OUT[1] - TREE_OUT[0])
    const size = 4 + random() * 4
    trees.push({ x: x + outX * out + alongX * random() * 5, z: z + outZ * out + alongZ * random() * 5, width: size, depth: size, height: 5 + random() * 5, rotation: 0, color: CANOPY[Math.floor(random() * CANOPY.length)] })
  })
  return { buildings, tanks, trees }
}

/** Windows on the walls: a grid of darker panes, from where each fragment is, with no texture. */
function addWindows(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vSkylineWorld;\nvarying vec3 vSkylineNormal;\nvoid main() {')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vSkylineWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vSkylineNormal = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vSkylineWorld;\nvarying vec3 vSkylineNormal;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vSkylineNormal.y) < 0.5) {
          float along = abs(vSkylineNormal.x) > 0.5 ? vSkylineWorld.z : vSkylineWorld.x;
          float column = fract(along / 3.2);
          float floorLine = fract((vSkylineWorld.y - 0.9) / 3.0);
          float pane = step(0.3, column) * step(column, 0.75) * step(0.25, floorLine) * step(floorLine, 0.75);
          diffuseColor.rgb *= mix(1.0, 0.45, pane * step(1.5, vSkylineWorld.y));
          // Grime at the foot of the wall.
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 1.2, vSkylineWorld.y));
        }`,
      )
  }
  material.customProgramCacheKey = () => 'skyline-windows'
  return material
}

function Instances({ items, geometry, material, centred }: { items: Item[]; geometry: THREE.BufferGeometry; material: THREE.Material; centred: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return
    const transform = new THREE.Object3D()
    items.forEach((item, index) => {
      // Boxes stand on the ground; tree canopies are balls lifted up on their trunks.
      transform.position.set(item.x, centred ? item.height : item.height / 2, item.z)
      transform.rotation.set(0, item.rotation, 0)
      transform.scale.set(item.width, centred ? item.width * 0.8 : item.height, item.depth)
      transform.updateMatrix()
      instances.setMatrixAt(index, transform.matrix)
      instances.setColorAt(index, item.color)
    })
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
    instances.computeBoundingSphere()
  }, [items, centred])
  return <instancedMesh ref={mesh} args={[geometry, material, items.length]} receiveShadow={false} castShadow={false} />
}

export function Skyline() {
  const plan = useMemo(() => planSkyline(), [])
  const parts = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      ball: new THREE.IcosahedronGeometry(0.5, 1),
      walls: addWindows(new THREE.MeshStandardMaterial({ roughness: 0.95 })),
      plain: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    }),
    [],
  )
  useEffect(() => () => Object.values(parts).forEach((part) => part.dispose()), [parts])
  return (
    <>
      <Instances items={plan.buildings} geometry={parts.box} material={parts.walls} centred={false} />
      <Instances items={plan.tanks} geometry={parts.box} material={parts.plain} centred={false} />
      <Instances items={plan.trees} geometry={parts.ball} material={parts.plain} centred />
    </>
  )
}
