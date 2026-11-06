import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { liveSky } from '../game/livePlayer'

/** The box of rain around the camera, in metres. */
const BOX_WIDTH = 30
const BOX_HEIGHT = 18
const FALL_SPEED = 24
const STREAK_LENGTH = 0.8

const VERTEX_SHADER = /* glsl */ `
  attribute float aEnd;
  uniform float uTime;
  uniform vec3 uCentre;
  varying float vEnd;

  void main() {
    vec3 drop = position;
    // mod() wraps each drop back to the top, and keeps it in a box around the camera.
    drop.y = mod(drop.y - uTime * ${FALL_SPEED.toFixed(1)}, ${BOX_HEIGHT.toFixed(1)});
    drop.xz = mod(drop.xz - uCentre.xz, ${BOX_WIDTH.toFixed(1)}) - ${(BOX_WIDTH / 2).toFixed(1)} + uCentre.xz;
    drop.y += aEnd * ${STREAK_LENGTH.toFixed(1)};
    vEnd = aEnd;
    gl_Position = projectionMatrix * viewMatrix * vec4(drop, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying float vEnd;

  void main() {
    gl_FragColor = vec4(0.78, 0.84, 0.92, uOpacity * (0.2 + vEnd * 0.4));
    #include <colorspace_fragment>
  }
`

const uniforms = {
  uTime: { value: 0 },
  uCentre: { value: new THREE.Vector3() },
  uOpacity: { value: 0 },
}

/** Made once, here, for the same reason as the sky's material: see Sky.tsx. */
const rainMaterial = new THREE.ShaderMaterial({
  vertexShader: VERTEX_SHADER,
  fragmentShader: FRAGMENT_SHADER,
  uniforms,
  transparent: true,
  depthWrite: false,
})

function createDropGeometry(count: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 6)
  const ends = new Float32Array(count * 2)

  for (let drop = 0; drop < count; drop++) {
    const x = Math.random() * BOX_WIDTH
    const y = Math.random() * BOX_HEIGHT
    const z = Math.random() * BOX_WIDTH
    positions.set([x, y, z, x, y, z], drop * 6)
    ends[drop * 2 + 1] = 1
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1))
  return geometry
}

/**
 * Rain as thin lines. All the movement happens in the shader, on the GPU, so
 * JavaScript only has to pass in the time and the camera's position.
 */
export function Rain({ count }: { count: number }) {
  const geometry = useMemo(() => createDropGeometry(count), [count])
  useFrame(({ camera, clock }) => {
    uniforms.uTime.value = clock.elapsedTime % 1000
    uniforms.uCentre.value.copy(camera.position)
    uniforms.uOpacity.value = liveSky.rain
  })

  return (
    <lineSegments key={count} geometry={geometry} material={rainMaterial} frustumCulled={false} />
  )
}
