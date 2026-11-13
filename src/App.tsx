import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGameStore } from './game/gameStore'
import { preloadGame } from './game/preload'
import { QUALITY_PRESETS } from './game/qualitySettings'
import { DirectionArrow } from './ui/DirectionArrow'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { MessageToast } from './ui/MessageToast'
import { PlayerHorn } from './ui/PlayerHorn'
import { RadioPlayer } from './ui/Radio'
import { Phone } from './ui/Phone'
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
      <MessageToast />
      <PlayerHorn />
      <RadioPlayer />
      <QualityPicker className="quality-hud" />
      <DirectionArrow />
      <Phone />

      <p className="controls-hint">W A S D or arrow keys to ride · Hold Space while turning to drift · H honk · R radio · P phone · N skips time · M changes weather</p>
    </>
  )
}

function App() {
  const { pixelRatio } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const stage = useGameStore((state) => state.loading.stage)
  const worldFilesReady = stage === 'building' || stage === 'ready'

  useEffect(() => {
    void preloadGame(useGameStore.getState().setLoading)
  }, [])

  return (
    <>
      <ErrorBoundary>
        <Canvas shadows dpr={pixelRatio} camera={{ fov: 60, near: 0.5, far: 1500 }}>
          <color attach="background" args={[SKY_COLOR]} />
          <fog attach="fog" args={[SKY_COLOR, 520, 1300]} />
          <ViewDistance />
          {/* The world is built once its files are downloaded, so it never downloads them twice. */}
          {worldFilesReady && (
            <Suspense fallback={null}>
              <World />
            </Suspense>
          )}
        </Canvas>

        <GameUi />
      </ErrorBoundary>

      <p className="attribution">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
        {' · '}
        <a href={`${import.meta.env.BASE_URL}models/CREDITS.txt`} target="_blank" rel="noreferrer">
          3D model credits
        </a>
      </p>
    </>
  )
}

export default App
