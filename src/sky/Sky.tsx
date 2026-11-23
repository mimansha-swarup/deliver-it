import { isKey } from '../game/keyBindings'
import { ONLINE_CLOCK_SCALE } from '../game/duty'
import { useTutorial } from '../game/tutorial'
import { isDebug, requestedHour, requestedWeather } from '../dev/spawn'
import { useEffect, useRef } from 'react'
import { timedFrame } from '../dev/frameTimes'
import * as THREE from 'three'
import { isFirstVisit, useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { Rain } from './Rain'
import {
  changeWeather,
  createSkyState,
  formatClock,
  getSkyLook,
  stepSky,
  SKY_RULES,
  WEATHERS,
  type Rgb,
} from './skyLogic'

/** `useFrame`, timed under its step for `?debug=2` (dev/frameTimes.ts). */
const useFrame = timedFrame('lights and sky')

/** Pressing N jumps the clock forward this far, to see the sky change quickly. */
const SKIP_HOURS = 3
/** The dome only has to be inside the camera's far limit. */
const DOME_RADIUS = 1000
/** Longest a single frame may count for. */
const MAX_STEP = 0.1

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uCloudColor;
  uniform vec3 uSunDirection;
  uniform float uNight;
  uniform float uClouds;
  uniform float uDrift;
  uniform bool uDrawClouds;
  varying vec3 vDirection;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(vec3(cell, 0.0));
    float b = hash(vec3(cell + vec2(1.0, 0.0), 0.0));
    float c = hash(vec3(cell + vec2(0.0, 1.0), 0.0));
    float d = hash(vec3(cell + vec2(1.0, 1.0), 0.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Layers of noise, each finer and fainter, make shapes that look like cloud.
  float layeredNoise(vec2 p) {
    float total = 0.0;
    float strength = 0.5;
    for (int i = 0; i < 4; i++) {
      total += noise(p) * strength;
      p = p * 2.03 + 17.0;
      strength *= 0.5;
    }
    return total;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    float clearSky = 1.0 - smoothstep(0.35, 0.95, uClouds);
    // Under a clear sky the blue comes further down, so the sky a rider sees is blue
    // above a warm haze at the horizon; under cloud it stays pale lower down.
    vec3 color = mix(uHorizon, uZenith, pow(height, mix(0.55, 0.36, clearSky)));

    // A star is a rare grid cell on the dome that passes a random test.
    float star = step(0.9985, hash(floor(direction * 420.0)));
    color += star * uNight * clearSky * smoothstep(0.02, 0.2, height) * 0.8;

    float sunAlign = dot(direction, uSunDirection);
    float sunGlow = pow(max(sunAlign, 0.0), 180.0) * 0.45;
    float sunDisc = smoothstep(0.9988, 0.9993, sunAlign);
    color += vec3(1.0, 0.92, 0.78) * (sunGlow + sunDisc) * clearSky;

    float moonAlign = dot(direction, vec3(-uSunDirection.xy, uSunDirection.z));
    color += vec3(0.9, 0.93, 1.0) * smoothstep(0.9992, 0.9995, moonAlign) * clearSky;

    if (uDrawClouds && direction.y > 0.0) {
      // Dividing by height flattens the dome into a ceiling of cloud.
      vec2 ceiling = direction.xz / (direction.y + 0.12) * 1.3;
      float shape = layeredNoise(ceiling + vec2(uDrift, uDrift * 0.4));
      float threshold = mix(0.62, 0.26, uClouds);
      float amount = smoothstep(threshold, threshold + 0.22, shape);
      color = mix(color, uCloudColor, amount * smoothstep(0.0, 0.12, direction.y) * 0.92);
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

/** The values passed to the shader. */
const uniforms = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uCloudColor: { value: new THREE.Color() },
  uSunDirection: { value: new THREE.Vector3() },
  uNight: { value: 0 },
  uClouds: { value: 0 },
  uDrift: { value: 0 },
  uDrawClouds: { value: true },
}

/**
 * Made once, here, rather than as JSX. React Three Fiber copies a `uniforms` prop,
 * so writing to this object afterwards wouldn't reach the shader.
 */
const skyMaterial = new THREE.ShaderMaterial({
  vertexShader: VERTEX_SHADER,
  fragmentShader: FRAGMENT_SHADER,
  uniforms,
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
})

function setColor(color: THREE.Color, [red, green, blue]: Rgb) {
  color.setRGB(red, green, blue, THREE.SRGBColorSpace)
}

/** The golden haze's own colour, and how far the haze moves to it from the horizon's colour at its thickest. */
const HAZE_GOLD: Rgb = [0.93, 0.76, 0.52]
const HAZE_WARMTH = 0.35

/** Past this much darkness, the phone shows a moon instead of a sun. */
const NIGHT_ICON_LEVEL = 0.5

/** The sky asked for in the address (?hour, ?weather with ?debug), or null. A weather asked for holds for an hour. */
function createDebugSkyState() {
  const hours = requestedHour()
  const weather = requestedWeather()
  if (hours === null && weather === null) return null
  const state = createSkyState(hours ?? (isFirstVisit ? SKY_RULES.firstStartHour : SKY_RULES.startHour))
  if (weather) {
    state.weather = weather
    state.weatherLeft = 3600
    const { clouds, rain, wind } = WEATHERS[weather]
    Object.assign(state, { clouds, rain, wind })
  }
  return state
}

/** Runs the clock and the weather, and paints the sky. Everything else reads `liveSky`. */
export function Sky() {
  const { skyClouds, rainDrops } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  // With ?debug, ?hour=17.5 starts the clock there and ?weather=clear holds that weather.
  const state = useRef(createDebugSkyState() ?? createSkyState(isFirstVisit ? SKY_RULES.firstStartHour : SKY_RULES.startHour))
  // Debug: the clock and the weather, to set from the console (`__deliverItSky` with ?debug).
  useEffect(() => {
    if (isDebug()) (window as unknown as { __deliverItSky?: unknown }).__deliverItSky = state.current
  }, [])
  const dome = useRef<THREE.Mesh>(null)
  const drift = useRef(0)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (isKey('skipTime', event.code)) state.current.hours = (state.current.hours + SKIP_HOURS) % 24
      if (isKey('weather', event.code)) changeWeather(state.current, Math.random)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useFrame(({ camera, scene }, delta) => {
    const dt = Math.min(delta, MAX_STEP)
    const sky = state.current
    if (liveSky.setHoursTo !== null) {
      sky.hours = liveSky.setHoursTo
      liveSky.setHoursTo = null
    }
    const before = sky.hours
    // Online, the clock runs slower: a shift is a few game hours, and a rush lasts a good while.
    // The tutorial's clock barely moves: a first order that began at 6:40 doesn't end at 8.
    // And its weather stays as it began: clear.
    if (useTutorial.getState().step !== null && sky.weatherLeft < 60) sky.weatherLeft = 60
    const learning = useTutorial.getState().step !== null ? (SKY_RULES.tutorialClock * SKY_RULES.dayLength) / 86400 : 1
    stepSky(sky, dt, Math.random, Math.min(learning, useGameStore.getState().duty === 'online' ? ONLINE_CLOCK_SCALE : 1))
    liveSky.totalHours += (sky.hours - before + 24) % 24
    liveSky.hours = sky.hours

    const look = getSkyLook(sky)
    drift.current += dt * (0.015 + sky.wind * 0.05)

    liveSky.look = look
    liveSky.rain = sky.rain
    liveSky.wind = sky.wind

    setColor(uniforms.uZenith.value, look.zenith)
    setColor(uniforms.uHorizon.value, look.horizon)
    setColor(uniforms.uCloudColor.value, look.cloudColor)
    uniforms.uSunDirection.value.set(...look.sunDirection)
    uniforms.uNight.value = look.night
    uniforms.uClouds.value = sky.clouds
    uniforms.uDrift.value = drift.current
    uniforms.uDrawClouds.value = skyClouds

    // The haze is golden where the sun is up and the sky clear: the horizon's colour, warmed as the haze thickens.
    if (scene.fog) {
      // Not under cloud: rain's mist is grey. Warmed to gold it turned the whole wet street olive.
      const cover = Math.min(1, Math.max(0, (sky.clouds - 0.3) / 0.7))
      const warm = HAZE_WARMTH * look.haze * (1 - look.night) * (1 - cover)
      setColor(scene.fog.color, [
        look.horizon[0] + (HAZE_GOLD[0] - look.horizon[0]) * warm,
        look.horizon[1] + (HAZE_GOLD[1] - look.horizon[1]) * warm,
        look.horizon[2] + (HAZE_GOLD[2] - look.horizon[2]) * warm,
      ])
    }
    dome.current?.position.copy(camera.position)

    const skyTime = formatClock(sky.hours)
    const night = look.night > NIGHT_ICON_LEVEL
    const shown = useGameStore.getState()
    if (shown.skyTime !== skyTime || shown.weather !== sky.weather || shown.night !== night) {
      shown.setSky(skyTime, sky.weather, night)
    }
  })

  return (
    <>
      <mesh ref={dome} material={skyMaterial} frustumCulled={false} renderOrder={-1}>
        <sphereGeometry args={[DOME_RADIUS, 32, 16]} />
      </mesh>
      <Rain count={rainDrops} />
    </>
  )
}
