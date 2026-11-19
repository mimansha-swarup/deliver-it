import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { chargerSpot, type FuelStation } from './fuelStationData'
import { box, merge } from './simpleShapes'

/*
 * An EV charger at each petrol bunk (fuelStationData.ts' `chargerSpot`): a white pedestal with a
 * green band and a dark screen, a cable looped on its side, on a kerbed plinth with a bollard.
 * Scuffed and sun-faded like the pumps. All of them are one merged mesh under the street's own light.
 */

function createCharger(): THREE.BufferGeometry[] {
  return [
    box([0.9, 0.1, 0.7], [0, 0.05, 0], '#8f8b82'),
    box([0.42, 1.45, 0.3], [0, 0.82, 0], '#dcd9d0'),
    box([0.43, 0.22, 0.31], [0, 1.2, 0], '#2f9e6b'),
    box([0.3, 0.2, 0.02], [0, 0.92, 0.16], '#1c2a2e'),
    box([0.2, 0.05, 0.02], [0, 1.2, 0.16], '#f1ede2'),
    box([0.06, 0.5, 0.08], [0.25, 0.75, 0.05], '#1c1d20'),
    box([0.1, 0.16, 0.12], [0.25, 1.04, 0.05], '#2b2d30'),
    box([0.14, 0.7, 0.14], [-0.6, 0.35, 0.3], '#d9a520'),
    box([0.15, 0.1, 0.15], [-0.6, 0.55, 0.3], '#1c1d20'),
  ]
}

export function EvChargers({ stations }: { stations: FuelStation[] }) {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const station of stations) {
      const { x, z, rotation } = chargerSpot(station)
      for (const part of createCharger()) {
        part.rotateY(rotation)
        part.translate(x, 0, z)
        parts.push(part)
      }
    }
    if (parts.length === 0) return null
    const merged = merge(parts)
    merged.computeVertexNormals()
    return merged
  }, [stations])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.8} />
    </mesh>
  )
}
