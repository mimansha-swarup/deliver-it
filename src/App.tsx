import { Suspense } from 'react'
import { MapControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { World } from './world/World'

function App() {
  return (
    <>
      <Canvas orthographic camera={{ position: [0, 500, 0], zoom: 1.6, far: 1000 }}>
        <color attach="background" args={['#14171c']} />
        <Suspense fallback={null}>
          <World />
        </Suspense>
        <MapControls enableRotate={false} />
      </Canvas>

      <a
        className="attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </>
  )
}

export default App
