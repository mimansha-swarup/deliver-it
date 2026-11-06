import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { DirectionArrow } from './ui/DirectionArrow'
import { Hud } from './ui/Hud'
import { Minimap } from './ui/Minimap'
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

      <Hud />
      <DirectionArrow />
      <Suspense fallback={null}>
        <Minimap />
      </Suspense>

      <p className="controls-hint">W A S D or arrow keys to ride · Hold Space while turning to drift</p>

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
