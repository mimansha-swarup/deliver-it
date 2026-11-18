import { useEffect, useMemo, useState } from 'react'
import { isDebug } from '../dev/spawn'
import type { N8AOPostPass } from 'n8ao'
import { useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, FXAA, GodRays, LUT, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { KernelSize, ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { createCleanPicturePass } from './cleanPicture'
import { createGradeLut } from './colorGrade'
import { AO, applyExposure, BLOOM, SUN, skipTransparencyPass } from './postSettings'
import { SunHazeEffect } from './sunHaze'

/** A disc where the sun is, for the sun shafts to shine from: buildings and leaves in front of it block them. Never drawn itself. */
function createSunDisc(): THREE.Mesh {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(SUN.discRadius, 24),
    new THREE.MeshBasicMaterial({ color: '#ffd9a0', fog: false, depthWrite: false, transparent: true }),
  )
  disc.frustumCulled = false
  disc.renderOrder = -1
  return disc
}

const sunWorld = new THREE.Vector3()

/** Puts the disc where the sun is in the sky, seen from the camera, as bright as the sunlight (0 hides it). */
function placeSunDisc(disc: THREE.Mesh, camera: THREE.Camera, sunlight: number) {
  const { look } = liveSky
  sunWorld.set(...look.sunDirection)
  disc.visible = sunlight > 0.05 && sunWorld.y > -0.02
  disc.position.copy(camera.position).addScaledVector(sunWorld, SUN.discDistance)
  disc.lookAt(camera.position)
  const material = disc.material as THREE.MeshBasicMaterial
  material.color.setRGB(...look.lightColor, THREE.SRGBColorSpace)
  material.opacity = sunlight
}

/**
 * Everything drawn goes through these, in order: ambient occlusion, a clean-up
 * of broken pixels (cleanPicture.ts), bloom, AgX tone mapping, then the colour grade. Every quality gets the tone mapping
 * and the grade, so the game looks the same on each (ART_DIRECTION.md's golden
 * rule). The sun's haze glow (sunHaze.ts) is on every quality too. Only the costly parts
 * change: Low has no AO, bloom or sun shafts and the cheaper antialiasing, and Medium's AO
 * takes fewer samples.
 */
export function PostEffects() {
  const preset = useGameStore((state) => QUALITY_PRESETS[state.quality])
  // Debug: switch effects off from the console, to measure what each costs (`__deliverItPost`, with ?debug).
  const [debug, setDebug] = useState({ all: true, ao: true, bloom: true, aa: true, sun: true })
  useEffect(() => {
    if (isDebug()) (window as unknown as { __deliverItPost?: unknown }).__deliverItPost = setDebug
  }, [])
  const ambientOcclusion = debug.ao ? preset.ambientOcclusion : 'off'
  const bloom = debug.bloom && preset.bloom
  const antialiasing = debug.aa ? preset.antialiasing : 'none'
  const gl = useThree((state) => state.gl)
  const lut = useMemo(() => createGradeLut(), [])
  const clean = useMemo(() => createCleanPicturePass(), [])
  const sunHaze = useMemo(() => new SunHazeEffect(), [])
  const sunDisc = useMemo(() => createSunDisc(), [])
  // The shafts only show with the sun low, and on High they cost a whole extra pass over the picture
  // (they can't share one with the antialiasing), so they're mounted only while the sun is low.
  const [sunLow, setSunLow] = useState(() => liveSky.look.sunDirection[1] < SUN.shaftsBelow)
  const shafts = preset.sunShafts && debug.sun && sunLow

  // The sun's haze glow, and the disc the shafts shine from, follow the sun in the sky.
  useFrame(({ camera }) => {
    const { look } = liveSky
    // Only by day, and less as cloud dims the sun.
    const sunlight = Math.min(1, look.lightIntensity / SUN.fullLight) * (1 - look.night)
    sunHaze.aim(camera, look.sunDirection, look.lightColor, SUN.hazeGlow * look.haze * sunlight)
    placeSunDisc(sunDisc, camera, shafts ? sunlight : 0)
    // With a little either way, so the chain isn't rebuilt back and forth at the threshold.
    const height = look.sunDirection[1]
    if (sunLow && height > SUN.shaftsBelow + 0.02) setSunLow(false)
    else if (!sunLow && height < SUN.shaftsBelow - 0.02) setSunLow(true)
  })

  useEffect(() => () => lut.dispose(), [lut])
  useEffect(() => () => clean.dispose(), [clean])
  useEffect(() => () => sunHaze.dispose(), [sunHaze])
  useEffect(() => applyExposure(gl), [gl])

  if (!debug.all) return null
  return (
    // The key rebuilds the chain when a part comes or goes, as the composer works its passes out once.
    // No multisampling: antialiasing is an effect at the end instead (see `antialiasing` in qualitySettings.ts).
    // The sun disc isn't added to the scene: the shafts pass draws it in a scene of its own, so
    // the sky's own sun is what's seen.
    <EffectComposer key={`${ambientOcclusion} ${bloom} ${antialiasing} ${shafts} ${debug.sun}`} multisampling={0} autoClear={false}>
      <>
        {ambientOcclusion !== 'off' && (
          <N8AO
            ref={(pass: N8AOPostPass | null) => skipTransparencyPass(pass)}
            aoRadius={AO.radius}
            distanceFalloff={AO.distanceFalloff}
            intensity={AO.intensity}
            color={AO.color}
            halfRes
            quality={ambientOcclusion === 'fast' ? 'performance' : 'medium'}
          />
        )}
        {/* After AO, before everything that blurs: one broken pixel can't black out the frame. */}
        <primitive object={clean} />
        {bloom && (
          <Bloom
            mipmapBlur
            intensity={BLOOM.intensity}
            luminanceThreshold={BLOOM.threshold}
            luminanceSmoothing={BLOOM.smoothing}
            radius={BLOOM.radius}
          />
        )}
        {/* The haze glowing towards the sun, then shafts through leaves where the quality has them: before the tone mapping, so the grade covers them too. */}
        {debug.sun ? <primitive object={sunHaze} /> : <></>}
        {shafts ? (
          <GodRays sun={sunDisc} samples={SUN.shaftSamples} density={0.94} decay={0.93} weight={SUN.shaftWeight} exposure={0.55} clampMax={1} blur kernelSize={KernelSize.SMALL} resolutionScale={SUN.shaftResolution} />
        ) : (
          <></>
        )}
        <ToneMapping mode={ToneMappingMode.AGX} />
        <LUT lut={lut} />
        {antialiasing === 'smaa' ? <SMAA /> : antialiasing === 'fxaa' ? <FXAA /> : <></>}
      </>
    </EffectComposer>
  )
}
