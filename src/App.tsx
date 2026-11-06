import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { World } from './world/World'

const SKY_COLOR = '#cfe3f2'

function App() {
  return (
    <>
      <Canvas shadows camera={{ fov: 60, near: 0.5, far: 1500 }}>
        <color attach="background" args={[SKY_COLOR]} />
        <fog attach="fog" args={[SKY_COLOR, 500, 1300]} />
        <Suspense fallback={null}>
          <World />
        </Suspense>
      </Canvas>

      <p className="controls-hint">W A S D or arrow keys to ride · Space for handbrake</p>

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
