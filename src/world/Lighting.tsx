/** How far the sun's shadows reach from the centre of the world, in metres. */
const SHADOW_RANGE = 320

export function Lighting() {
  return (
    <>
      {/* Soft fill light: blue from the sky above, warm bounce from the ground. */}
      <hemisphereLight args={['#dcecff', '#a39a84', 1.1]} />

      {/* The sun. */}
      <directionalLight
        castShadow
        color="#fff1dc"
        intensity={2.6}
        position={[180, 260, 120]}
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-camera-left={-SHADOW_RANGE}
        shadow-camera-right={SHADOW_RANGE}
        shadow-camera-top={SHADOW_RANGE}
        shadow-camera-bottom={-SHADOW_RANGE}
        shadow-camera-near={10}
        shadow-camera-far={800}
      />
    </>
  )
}
