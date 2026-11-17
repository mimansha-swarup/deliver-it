// First, so these change three's shader code before any material is built: the golden haze,
// and a cap on brightness that stops black frames (see brightnessCap.ts).
import './world/haze'
import './world/brightnessCap'
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGameStore } from './game/gameStore'
import { useLaunch } from './game/launch'
import { preloadGame } from './game/preload'
import { DirectionArrow } from './ui/DirectionArrow'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { LoadingScreen } from './ui/LoadingScreen'
import { MessageToast } from './ui/MessageToast'
import { PlayerHorn } from './ui/PlayerHorn'
import { RadioPlayer } from './ui/Radio'
import { Phone } from './ui/Phone'
import { QualityPicker } from './ui/QualityPicker'
import { TitleScreen } from './ui/TitleScreen'
import { useResolution } from './game/resolution'
import { AdaptiveResolution } from './world/AdaptiveResolution'
import { PostEffects } from './world/PostEffects'
import { DebugRig } from './dev/DebugRig' // TEMP-DEBUG
import { ViewDistance } from './world/ViewDistance'
import { World } from './world/World'

/** The sky and haze before the sky's own colours take over, a frame after start. */
const SKY_COLOR = '#e3dbc4'

function GameUi() {
  const started = useGameStore((state) => state.started)
  const requested = useLaunch((state) => state.requested)
  // The loading screen stays a moment after the ride starts, fading out over it.
  const [curtainGone, setCurtainGone] = useState(false)

  return (
    <>
      {!requested && <TitleScreen />}
      {started && <RidingUi />}
      {requested && !curtainGone && <LoadingScreen onGone={() => setCurtainGone(true)} />}
    </>
  )
}

function RidingUi() {
  return (
    <>
      <Hud />
      <MessageToast />
      <PlayerHorn />
      <RadioPlayer />
      <QualityPicker className="quality-hud" />
      <DirectionArrow />
      <Phone />

      <p className="controls-hint">W A S D or arrow keys to ride · Hold Space while turning to drift · Shift nitro · H honk · R radio · P phone · N skips time · M changes weather</p>
    </>
  )
}

function App() {
  const pixelRatio = useResolution((state) => state.pixelRatio)
  const mapReady = useGameStore((state) => state.loading.mapReady)
  // The world is built after Play, behind the loading screen, once the map is in.
  // Models and textures may still be downloading: each part waits for its own.
  const buildWorld = useLaunch((state) => state.curtainDrawn) && mapReady

  useEffect(() => {
    void preloadGame(useGameStore.getState().setLoading)
  }, [])

  return (
    <>
      <ErrorBoundary>
        {/* No antialiasing here: everything is drawn through PostEffects, which antialiases its own picture. */}
        <Canvas shadows dpr={pixelRatio} camera={{ fov: 60, near: 0.5, far: 1500 }} gl={{ antialias: false }}>
          <color attach="background" args={[SKY_COLOR]} />
          <fog attach="fog" args={[SKY_COLOR, 520, 1300]} />
          <ViewDistance />
          <AdaptiveResolution />
          <PostEffects />
          {import.meta.env.DEV && <DebugRig />} {/* TEMP-DEBUG */}
          {buildWorld && (
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
        <a href={`${import.meta.env.BASE_URL}data/CREDITS.txt`} target="_blank" rel="noreferrer">
          Overture Maps, Google Open Buildings, Microsoft
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
