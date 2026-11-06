import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGameStore } from './game/gameStore'
import { QUALITY_PRESETS } from './game/qualitySettings'
import { DirectionArrow } from './ui/DirectionArrow'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { Minimap } from './ui/Minimap'
import { QualityPicker } from './ui/QualityPicker'
import { TitleScreen } from './ui/TitleScreen'
import { ViewDistance } from './world/ViewDistance'
import { World } from './world/World'

const SKY_COLOR = '#cfe3f2'

function GameUi() {
  const started = useGameStore((state) => state.started)

  if (!started) return <TitleScreen />

  return (
    <>
      <Hud />
      <QualityPicker className="quality-hud" />
      <DirectionArrow />
      <Suspense fallback={null}>
        <Minimap />
      </Suspense>

      <p className="controls-hint">W A S D or arrow keys to ride · Hold Space while turning to drift · N skips time · M changes weather</p>
    </>
  )
}

function App() {
  const { pixelRatio } = useGameStore((state) => QUALITY_PRESETS[state.quality])

  return (
    <>
      <ErrorBoundary>
        <Canvas shadows dpr={pixelRatio} camera={{ fov: 60, near: 0.5, far: 1500 }}>
          <color attach="background" args={[SKY_COLOR]} />
          <fog attach="fog" args={[SKY_COLOR, 520, 1300]} />
          <ViewDistance />
          <Suspense fallback={null}>
            <World />
          </Suspense>
        </Canvas>

        <GameUi />
      </ErrorBoundary>

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
