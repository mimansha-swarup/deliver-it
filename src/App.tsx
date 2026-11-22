import { isDebug } from './dev/spawn'
import type { Quality } from './game/qualitySettings'
// First, so these change three's shader code before any material is built: the golden haze,
// and a cap on brightness that stops black frames (see brightnessCap.ts).
import { markLoad } from './dev/loadTimeline'
import './world/haze'
import './world/quietThree'
import './world/brightnessCap'
// Anonymous gameplay statistics (analytics.ts): off without a key, on localhost, on deploy previews and with ?debug or ?fresh.
import { pageOpen } from './analytics'
// A game controller presses the game's own keys (game/gamepad.ts).
import './game/gamepad'
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGameStore } from './game/gameStore'
import { useLaunch } from './game/launch'
import { preloadGame } from './game/preload'
import { DirectionArrow } from './ui/DirectionArrow'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Hud } from './ui/Hud'
import { LoadingScreen } from './ui/LoadingScreen'
import { PlayerHorn } from './ui/PlayerHorn'
import { RadioPlayer } from './ui/Radio'
import { Phone } from './ui/Phone'
import { TitleScreen } from './ui/TitleScreen'
import { useResolution } from './game/resolution'
import { StaticMatrices } from './world/StaticMatrices'
import { AdaptiveResolution } from './world/AdaptiveResolution'
import { DevStats } from './dev/DevStats'
import { FpsOverlay } from './dev/FpsOverlay'
import { Discovery } from './ui/Discovery'
import { PostEffects } from './world/PostEffects'
import { ViewDistance } from './world/ViewDistance'
import { World } from './world/World'
import { worldPlanner } from './world/planAhead'
import { DutyUi } from './ui/DutyUi'
import { Objective } from './ui/Objective'
import { Prompts } from './ui/Prompts'
import { ParkHint } from './ui/ParkHint'
import { Subtitle } from './ui/Subtitle'
import { RoomCard } from './ui/RoomUi'
import { RoomFade } from './ui/RoomFade'
import { CrashFade } from './ui/CrashFade'
import { GuardCard } from './ui/GuardCard'
import { BreakdownCard } from './ui/BreakdownCard'
import { PoliceCard } from './ui/PoliceCard'
import { Tutorial } from './ui/Tutorial'
import { Minimap } from './ui/Minimap'
import { FullMap } from './ui/FullMap'
import { PhotoModeUi } from './ui/PhotoMode'
import { HelpOverlay } from './ui/HelpOverlay'
import { PauseClock, PauseMenu } from './ui/PauseMenu'
import { setMapOpen, usePause } from './ui/uiState'
import { ChatBubbles } from './ui/ChatBubbles'
import { Attribution } from './ui/Credits'

pageOpen()

/** The sky and haze before the sky's own colours take over, a frame after start. */
const SKY_COLOR = '#e3dbc4'

/** OpenStreetMap's credit stays on screen; while riding, only that (Credits.tsx). */
// Debug: the picture quality, for scripts, now that its switch is in the phone (`__deliverItQuality('high')`, with ?debug).
if (isDebug()) {
  ;(window as unknown as { __deliverItQuality?: (quality: Quality) => void }).__deliverItQuality = (quality) => useGameStore.getState().setQuality(quality)
  // The game's store, for scripts to set up a moment (an order offer, an order on the way).
  ;(window as unknown as { __deliverItStore?: typeof useGameStore }).__deliverItStore = useGameStore
}

function AttributionLine() {
  const started = useGameStore((state) => state.started)
  return <Attribution riding={started} />
}

function GameUi() {
  const started = useGameStore((state) => state.started)
  const requested = useLaunch((state) => state.requested)
  // The loading screen stays a moment after the ride starts, fading out over it.
  const [curtainGone, setCurtainGone] = useState(false)

  return (
    <>
      {!requested && <TitleScreen />}
      {started && <RidingUi />}
      {requested && !curtainGone && <LoadingScreen onGone={() => { markLoad('loading screen gone'); useLaunch.setState({ covered: false }); setCurtainGone(true) }} />}
    </>
  )
}

function RidingUi() {
  // Photo mode hides all of it but the sounds and its own overlay.
  const photoMode = useGameStore((state) => state.photoMode)
  // The pause menu has the screen to itself too.
  const paused = usePause((state) => state.open)
  return (
    <>
      <div className="riding-ui" hidden={photoMode || paused}>
      <Hud />
      <DutyUi />
      <Objective />
      <Prompts />
      <ParkHint />
      <Subtitle />
      <RoomCard />
      <GuardCard />
      <BreakdownCard />
      <PoliceCard />
      <Tutorial />
      <ChatBubbles />
      <PlayerHorn />
      <RadioPlayer />
      <DirectionArrow />
      <Suspense fallback={null}>
        <Minimap onOpen={() => setMapOpen(true)} />
      </Suspense>
      <FullMap />
      <Phone />
      </div>
      <PhotoModeUi />
      <Discovery />
      <RoomFade />
      <CrashFade />
      <FpsOverlay />
      <HelpOverlay />
      <PauseMenu />
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
  // The city is planned ahead, on the title screen, as soon as the map is in (World.tsx's `planAhead`).
  useEffect(() => {
    if (mapReady) worldPlanner.ahead()
  }, [mapReady])

  return (
    <>
      <ErrorBoundary>
        {/* No antialiasing here: everything is drawn through PostEffects, which antialiases its own picture. */}
        <Canvas shadows="percentage" dpr={pixelRatio} camera={{ fov: 60, near: 0.5, far: 1500 }} gl={{ antialias: false }}>
          <color attach="background" args={[SKY_COLOR]} />
          <fog attach="fog" args={[SKY_COLOR, 520, 1300]} />
          <ViewDistance />
          <AdaptiveResolution />
          <StaticMatrices />
          <DevStats />
          <PauseClock />
          <PostEffects />
          {buildWorld && (
            <Suspense fallback={null}>
              <World />
            </Suspense>
          )}
        </Canvas>

        <GameUi />
      </ErrorBoundary>

      <AttributionLine />
    </>
  )
}

export default App

// The brand's files are made from the game itself (dev/brandExport.ts), only with `?brand` in the address.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('brand')) {
  void import('./dev/brandExport').then(({ brandExport }) => {
    ;(window as unknown as { __brand?: typeof brandExport }).__brand = brandExport
  })
}
