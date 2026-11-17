import { useEffect, useMemo, useState } from 'react'
import { isDebug } from '../dev/spawn'
import type { N8AOPostPass } from 'n8ao'
import { useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, FXAA, LUT, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useGameStore } from '../game/gameStore'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { createCleanPicturePass } from './cleanPicture'
import { createGradeLut } from './colorGrade'
import { AO, applyExposure, BLOOM, skipTransparencyPass } from './postSettings'

/**
 * Everything drawn goes through these, in order: ambient occlusion, a clean-up
 * of broken pixels (cleanPicture.ts), bloom, AgX tone mapping, then the colour grade. Every quality gets the tone mapping
 * and the grade, so the game looks the same on each (ART_DIRECTION.md's golden
 * rule). Only the costly parts change: Low has no AO or bloom and the cheaper
 * antialiasing, and Medium's AO takes fewer samples.
 */
export function PostEffects() {
  const preset = useGameStore((state) => QUALITY_PRESETS[state.quality])
  // Debug: switch effects off from the console, to measure what each costs (`__deliverItPost`, with ?debug).
  const [debug, setDebug] = useState({ all: true, ao: true, bloom: true, aa: true })
  useEffect(() => {
    if (isDebug()) (window as unknown as { __deliverItPost?: unknown }).__deliverItPost = setDebug
  }, [])
  const ambientOcclusion = debug.ao ? preset.ambientOcclusion : 'off'
  const bloom = debug.bloom && preset.bloom
  const antialiasing = debug.aa ? preset.antialiasing : 'none'
  const gl = useThree((state) => state.gl)
  const lut = useMemo(() => createGradeLut(), [])
  const clean = useMemo(() => createCleanPicturePass(), [])

  useEffect(() => () => lut.dispose(), [lut])
  useEffect(() => () => clean.dispose(), [clean])
  useEffect(() => applyExposure(gl), [gl])

  if (!debug.all) return null
  return (
    // The key rebuilds the chain when a part comes or goes, as the composer works its passes out once.
    // No multisampling: antialiasing is an effect at the end instead (see `antialiasing` in qualitySettings.ts).
    <EffectComposer key={`${ambientOcclusion} ${bloom} ${antialiasing}`} multisampling={0}>
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
        <ToneMapping mode={ToneMappingMode.AGX} />
        <LUT lut={lut} />
        {antialiasing === 'smaa' ? <SMAA /> : antialiasing === 'fxaa' ? <FXAA /> : <></>}
      </>
    </EffectComposer>
  )
}
