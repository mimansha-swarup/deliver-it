import { useTexture } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { ChunkedMesh } from './ChunkedMesh'
import { createSiteShapes, SHADE_NET_COLOR, type ConstructionSite, type SiteShapes } from './sitePlacement'
import { CONCRETE_PHOTO, createPlasterMaterial, preparePlasterPhoto } from './plaster'

/** Sites are small details, so they're drawn within this distance, in metres. */
const SITE_DISTANCE = 450

/** Built once and kept, as React may start the world over while it loads (Lesson 191). */
const built = new WeakMap<ConstructionSite[], SiteShapes>()

/** Buildings going up on open plots: concrete frames, scaffolding, shade net and building materials. */
export function ConstructionSites({ sites }: { sites: ConstructionSite[] }) {
  const shapes = useMemo(() => {
    let found = built.get(sites)
    if (!found) {
      found = createSiteShapes(sites)
      built.set(sites, found)
    }
    return found
  }, [sites])
  const photo = useTexture(CONCRETE_PHOTO, preparePlasterPhoto)
  // Fresh concrete is blotchy, so the grain is strong.
  const material = useMemo(() => createPlasterMaterial(photo, { tile: 2, strength: 2 }, { roughness: 0.95 }), [photo])
  const netMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: SHADE_NET_COLOR,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 1,
      }),
    [],
  )

  return (
    <>
      <ChunkedMesh geometries={shapes.solid} material={material} castShadow maxDistance={SITE_DISTANCE} />
      <ChunkedMesh geometries={shapes.nets} material={netMaterial} maxDistance={SITE_DISTANCE} />
    </>
  )
}
