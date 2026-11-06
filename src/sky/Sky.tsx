import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../game/gameStore'
import { liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { Rain } from './Rain'
import {
  changeWeather,
  createSkyState,
  formatClock,
  getSkyLook,
  stepSky,
  WEATHERS,
  type Rgb,
} from './skyLogic'

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
    vec3 color = mix(uHorizon, uZenith, pow(height, 0.55));

    float clearSky = 1.0 - smoothstep(0.35, 0.95, uClouds);

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

/** Runs the clock and the weather, and paints the sky. Everything else reads `liveSky`. */
export function Sky() {
  const { skyClouds, rainDrops } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const state = useRef(createSkyState())
  const dome = useRef<THREE.Mesh>(null)
  const drift = useRef(0)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyN') state.current.hours = (state.current.hours + SKIP_HOURS) % 24
      if (event.code === 'KeyM') changeWeather(state.current, Math.random)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useFrame(({ camera, scene }, delta) => {
    const dt = Math.min(delta, MAX_STEP)
    const sky = state.current
    stepSky(sky, dt)

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

    if (scene.fog) setColor(scene.fog.color, look.horizon)
    dome.current?.position.copy(camera.position)

    const clock = `${formatClock(sky.hours)} · ${WEATHERS[sky.weather].label}`
    if (useGameStore.getState().clock !== clock) useGameStore.getState().setClock(clock)
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
