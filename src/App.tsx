import { Suspense } from 'react'
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { World } from './world/World'

const SKY_COLOR = '#cfe3f2'

function App() {
  return (
    <>
      <Canvas shadows camera={{ position: [260, 190, 320], fov: 45, near: 1, far: 1500 }}>
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, 500, 1300]} />
        <Suspense fallback={null}>
          <World />
        </Suspense>
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} minDistance={30} maxDistance={900} />
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
