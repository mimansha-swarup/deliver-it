import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { livePlayer, liveSky } from '../game/livePlayer'

/*
 * Rain, in three parts, all moved on the GPU (JavaScript passes the time, the camera and the wind):
 *
 *   streaks   soft, slanted strokes of different lengths and strengths, falling through a box round
 *             the camera. Each is a thin four-cornered strip turned to face the camera, faded at
 *             both ends and both edges, so none is a hard white line. They lean with the wind.
 *   splashes  small rings that open and fade on the ground near the camera, where drops land.
 *   mist      the far end of the street greying out: the haze closing in (world/ViewDistance.tsx).
 *
 * Two draw calls and no textures. Measured at 0.1 to 0.2 ms a frame on High (1,400 streaks, 250
 * splashes): the strips are a few pixels wide, so they cover very little of the screen.
 */

/** The box of rain round the camera, in metres. */
const BOX_WIDTH = 30
const BOX_HEIGHT = 18
const FALL_SPEED = 21
/** A streak's length, from the shortest to the longest, and its width, in metres. */
const STREAK = { short: 0.3, long: 1.3, width: 0.016 }
/** How far the wind pushes the rain over as it falls: metres sideways for each metre down, in the strongest wind. */
const SLANT = 0.34
/** Splashes: this share as many as there are streaks, within this far of the camera, each lasting this long (s) and opening to this radius (m). */
const SPLASH = { share: 0.18, reach: 12, life: 0.38, radius: 0.05, fadeFrom: 3.5 }

const uniforms = {
  uTime: { value: 0 },
  uCentre: { value: new THREE.Vector3() },
  uOpacity: { value: 0 },
  /** Which way the rain leans, as metres sideways per metre fallen (x, z). */
  uSlant: { value: new THREE.Vector2(SLANT, SLANT * 0.3) },
  /** The height of the ground the splashes land on. */
  uGround: { value: 0 },
}

const STREAK_VERTEX = /* glsl */ `
  attribute vec3 aDrop;
  attribute vec3 aLook;
  uniform float uTime;
  uniform vec3 uCentre;
  uniform vec2 uSlant;
  varying vec2 vAt;
  varying float vStrength;

  void main() {
    // The way it falls: down, pushed over by the wind.
    vec3 fall = normalize(vec3(uSlant.x, -1.0, uSlant.y));
    vec3 drop = aDrop;
    // Faster drops for the longer streaks, as nearer rain looks; mod() wraps each back to the top.
    float fallen = uTime * ${FALL_SPEED.toFixed(1)} * (0.75 + aLook.x * 0.5);
    drop.y = mod(drop.y - fallen, ${BOX_HEIGHT.toFixed(1)});
    drop.xz += uSlant * (${BOX_HEIGHT.toFixed(1)} - drop.y);
    drop.xz = mod(drop.xz - uCentre.xz, ${BOX_WIDTH.toFixed(1)}) - ${(BOX_WIDTH / 2).toFixed(1)} + uCentre.xz;
    drop.y += uCentre.y - ${(BOX_HEIGHT * 0.4).toFixed(1)};

    float len = mix(${STREAK.short.toFixed(2)}, ${STREAK.long.toFixed(2)}, aLook.x * aLook.x);
    // A strip along the fall, turned to face the camera.
    vec3 toCamera = normalize(cameraPosition - drop);
    vec3 across = normalize(cross(fall, toCamera));
    vec3 corner = drop - fall * (position.y * len) + across * (position.x * ${STREAK.width.toFixed(3)} * (0.7 + aLook.y * 0.6));
    vAt = position.xy;
    // Each has its own strength, and those right at the lens fade out, so none flashes across the whole picture.
    float distanceAway = length(cameraPosition - drop);
    vStrength = (0.25 + aLook.z * 0.75) * smoothstep(1.4, 5.0, distanceAway);
    gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
  }
`

const STREAK_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vAt;
  varying float vStrength;

  void main() {
    // Soft across its width, and tapering to nothing at its tail and its head.
    float across = 1.0 - abs(vAt.x) * 2.0;
    float along = smoothstep(0.0, 0.55, vAt.y) * smoothstep(1.0, 0.82, vAt.y);
    float alpha = uOpacity * vStrength * across * along * 0.8;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(0.74, 0.8, 0.88, alpha);
    #include <colorspace_fragment>
  }
`

const SPLASH_VERTEX = /* glsl */ `
  attribute vec4 aSplash;
  uniform float uTime;
  uniform vec3 uCentre;
  uniform float uGround;
  varying vec2 vAt;
  varying float vAge;
  varying float vNear;

  void main() {
    // Each lives ${SPLASH.life} s, over and over, at its own moment; every new life it lands somewhere else.
    float clock = uTime / ${SPLASH.life.toFixed(2)} + aSplash.w;
    float life = floor(clock);
    vAge = fract(clock);
    vec2 jump = fract(sin(vec2(life * 12.9898 + aSplash.x, life * 78.233 + aSplash.y)) * 43758.5453) * ${(SPLASH.reach * 2).toFixed(1)};
    vec2 spot = mod(aSplash.xy + jump - uCentre.xz, ${(SPLASH.reach * 2).toFixed(1)}) - ${SPLASH.reach.toFixed(1)} + uCentre.xz;
    // Sizes from a third of the largest up, most of them small.
    float radius = ${SPLASH.radius.toFixed(3)} * (0.25 + 0.75 * sqrt(vAge)) * (0.35 + aSplash.z * aSplash.z * 1.0);
    // Fewer further off: each has its own distance past which it isn't drawn, so they thin out
    // evenly from a few metres away to none at the edge. None right under the camera either.
    float away = length(spot - cameraPosition.xz);
    float most = mix(${SPLASH.fadeFrom.toFixed(1)}, ${SPLASH.reach.toFixed(1)}, fract(aSplash.w * 7.31 + aSplash.z * 3.7));
    vNear = (1.0 - smoothstep(most * 0.8, most, away)) * smoothstep(1.0, 2.2, away);
    vAt = position.xy;
    vec3 corner = vec3(spot.x + position.x * radius * 2.0, uGround + 0.03, spot.y + position.y * radius * 2.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(corner, 1.0);
  }
`

const SPLASH_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vAt;
  varying float vAge;
  varying float vNear;

  void main() {
    // A ring that thins as it opens, with a bright dot in the middle at the first moment: the drop itself.
    float away = length(vAt) * 2.0;
    float ring = smoothstep(0.5, 0.82, away) * smoothstep(1.0, 0.88, away);
    float dot = (1.0 - smoothstep(0.0, 0.3, away)) * (1.0 - smoothstep(0.0, 0.25, vAge));
    float alpha = uOpacity * vNear * (ring * (1.0 - vAge) * 0.16 + dot * 0.3);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(0.8, 0.86, 0.92, alpha);
    #include <colorspace_fragment>
  }
`

/** Made once, here, for the same reason as the sky's material: see Sky.tsx. */
const streakMaterial = new THREE.ShaderMaterial({ vertexShader: STREAK_VERTEX, fragmentShader: STREAK_FRAGMENT, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide })
const splashMaterial = new THREE.ShaderMaterial({ vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide })

/** One strip, copied `count` times: x across (-0.5 to 0.5), y along (0 at the head to 1 at the tail). */
function createStreaks(count: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const drops = new Float32Array(count * 3)
  const looks = new Float32Array(count * 3)
  for (let drop = 0; drop < count; drop++) {
    drops.set([Math.random() * BOX_WIDTH, Math.random() * BOX_HEIGHT, Math.random() * BOX_WIDTH], drop * 3)
    // Its length, its width and its strength: each its own.
    looks.set([Math.random(), Math.random(), Math.random()], drop * 3)
  }
  geometry.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 3))
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(looks, 3))
  geometry.instanceCount = count
  return geometry
}

/** One flat square on the ground, copied for each splash: where it starts (x, z), its size, and its moment in the cycle. */
function createSplashes(count: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const splashes = new Float32Array(count * 4)
  for (let splash = 0; splash < count; splash++) splashes.set([Math.random() * SPLASH.reach * 2, Math.random() * SPLASH.reach * 2, Math.random(), Math.random()], splash * 4)
  geometry.setAttribute('aSplash', new THREE.InstancedBufferAttribute(splashes, 4))
  geometry.instanceCount = count
  return geometry
}

/** `count`: how many streaks, by the quality setting (300 on Low, 1,400 on High). Low gets a third as many splashes for its streaks. */
export function Rain({ count }: { count: number }) {
  const streaks = useMemo(() => createStreaks(count), [count])
  const splashes = useMemo(() => createSplashes(Math.round(count * SPLASH.share)), [count])
  const streakMesh = useRef<THREE.Mesh>(null)
  const splashMesh = useRef<THREE.Mesh>(null)
  useFrame(({ camera, clock }) => {
    // Nothing is worked out, or drawn, while it's dry.
    // No rain indoors (game/rooms.ts).
    const raining = livePlayer.indoors ? 0 : liveSky.rain
    uniforms.uOpacity.value = raining
    for (const mesh of [streakMesh.current, splashMesh.current]) if (mesh) mesh.visible = raining > 0.001
    if (raining <= 0.001) return
    uniforms.uTime.value = clock.elapsedTime % 1000
    uniforms.uCentre.value.copy(camera.position)
    // It leans with the wind: hardly at all in a drizzle, well over in a storm.
    const lean = SLANT * (0.35 + 0.65 * liveSky.wind)
    uniforms.uSlant.value.set(lean, lean * 0.3)
    uniforms.uGround.value = livePlayer.height
  })

  return (
    <>
      <mesh key={`streaks-${count}`} geometry={streaks} material={streakMaterial} frustumCulled={false} renderOrder={5} ref={streakMesh} />
      <mesh key={`splashes-${count}`} geometry={splashes} material={splashMaterial} frustumCulled={false} renderOrder={4} ref={splashMesh} />
    </>
  )
}

