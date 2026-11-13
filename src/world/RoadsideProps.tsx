import { useEffect, useMemo, useRef } from 'react'
import { useTexture } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { useGameStore } from '../game/gameStore'
import { livePlayer, liveSky } from '../game/livePlayer'
import { QUALITY_PRESETS } from '../game/qualitySettings'
import { CANOPY_HEX, GREEN_TINTS, type Prop, type RoadsideProps as Props } from './props'
import { box, merge } from './simpleShapes'
import {
  createCanopyGeometries,
  createCreeperGeometries,
  createLeafyCanopyGeometries,
  createPetalGeometry,
  createTrunkGeometry,
} from './foliage'
import { windUniforms } from './wind'

const TRUNK_COLOR = '#6f5a43'
const LAMP_COLOR = '#55585c'
const CANOPY_COLORS = CANOPY_HEX.map((color) => new THREE.Color(color))
/** Bougainvillea: mostly magenta, with the odd orange or white one. */
const CREEPER_COLORS = ['#d81e73', '#e0457b', '#c2278f', '#d81e73', '#f08a2c', '#f4f1ea'].map(
  (color) => new THREE.Color(color),
)
const CREEPER_LEAF_COLORS = ['#3f6d3b', '#4f7a3a', '#47803f'].map((color) => new THREE.Color(color))
const TANK_COLORS = ['#17181a', '#1d1e21', '#222327', '#2a5fa8', '#e6e4dc'].map(
  (color) => new THREE.Color(color),
)

/** Photo leaves are dark, so their light and shade is scaled up before tinting. */
const LEAF_BRIGHTNESS = 4.2
/** How much of a leaf card's edge is kept. */
const LEAF_CUTOFF = 0.45
const BARK_REPEAT: [number, number] = [1.5, 2]

/** The number of tree shapes. */
const TREE_KINDS = 3

const GLOW_COLOR = new THREE.Color('#ffc67a')
const GLOW_RADIUS = 7
/** Just above the road (0.05), so it lights the ground without covering the bottom of what stands on it. */
const GLOW_HEIGHT = 0.065
const GLOW_SIDES = 16
/** How bright the middle of a lamp's pool is. */
const GLOW_CENTRE = 0.42
/** Where the bulb is, in a lamp's own space. */
const BULB: [number, number, number] = [1.5, 6.33, 0]
/** Where the lamp's light lands, under the head at the end of its arm. */
const GLOW_OFFSET = 1.5

/**
 * Adds a little GLSL to the standard material. Everything moves sideways, more
 * the higher up it is, and each tree starts at a different point in the sway.
 */
function addSway(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uWindPhase = windUniforms.uWindPhase
  shader.uniforms.uWindStrength = windUniforms.uWindStrength
  shader.vertexShader = `
    uniform float uWindPhase;
    uniform float uWindStrength;
    ${shader.vertexShader}
  `.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float treeOffset = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
      float bend = max(position.y - 1.0, 0.0);
      float amount = (0.012 + uWindStrength * 0.045) * bend;
      transformed.x += sin(uWindPhase + treeOffset) * amount;
      transformed.z += sin(uWindPhase * 0.7 + treeOffset * 1.7) * amount * 0.7;
      // A faster flutter, which differs from corner to corner, reads as leaves.
      transformed += sin(uWindPhase * 3.1 + position.x * 2.0 + position.y * 1.7 + treeOffset)
        * 0.02 * bend * uWindStrength;
    #endif`,
  )
}

/** Behind the title screen, props are drawn this far out, in metres. The whole map's worth would be too many. */
const TITLE_PROP_REACH = 400
/** The list of what's nearby is only rebuilt after the rider moves this far, in metres. */
const REFRESH_DISTANCE = 20

const transform = new THREE.Object3D()

/**
 * A plastic rooftop water tank: a seven-sided drum with a narrower top. There
 * are a lot of these, and they're small, so it stays at 28 triangles.
 */
function createTankGeometry(): THREE.BufferGeometry {
  const tank = new THREE.CylinderGeometry(0.42, 0.64, 1.45, 7, 1, false)
  tank.translate(0, 0.72, 0)
  return tank
}

function createLampGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.06, 0.09, 6.5, 6)
  post.translate(0, 3.25, 0)
  post.deleteAttribute('uv')

  const arm = new THREE.BoxGeometry(1.6, 0.07, 0.07)
  arm.translate(0.8, 6.45, 0)
  arm.deleteAttribute('uv')

  const head = new THREE.BoxGeometry(0.5, 0.1, 0.18)
  head.translate(1.5, 6.4, 0)
  head.deleteAttribute('uv')

  const lamp = mergeGeometries([post.toNonIndexed(), arm.toNonIndexed(), head.toNonIndexed()])
  if (!lamp) throw new Error('Could not merge lamp geometry')
  return lamp
}

/** The marketing poster on every lamp post, in metres. */
const POSTER_URL = '/textures/poster-kills.jpg'
const POSTER_WIDTH = 0.6
const POSTER_HEIGHT = 0.9
/** How high its bottom edge is, out of reach of passers-by. */
const POSTER_BOTTOM = 2.2
/** How far its middle sits from the post, towards the road, as boards strapped to poles do. */
const POSTER_OUT = 0.38
const BOARD_THICKNESS = 0.024
const BOARD_EDGE = 0.025
/** A spot in the poster's plain maroon corner, used to colour the board's edges. */
const BOARD_UV = 0.03

/**
 * A poster board strapped to a lamp post. It faces along the road, both ways,
 * so a rider sees it head-on when riding towards the post from either side.
 *
 * In a lamp's own space, +X runs along the road and +Z points out over it (see
 * how `rotation` is worked out in props.ts). So the faces point along ±X, and
 * the board sits a little way out along +Z.
 *
 * Each face is a flat rectangle with the whole image on it. The back face is
 * the front turned, not mirrored, so the writing reads the right way from
 * behind too. The board between them takes one colour from the image, so the
 * whole poster is one shape with one texture, in one draw call.
 */
function createPosterGeometry(): THREE.BufferGeometry {
  const middle = POSTER_BOTTOM + POSTER_HEIGHT / 2
  const gap = BOARD_THICKNESS / 2 + 0.002

  // A plane starts facing +Z. A quarter turn one way faces it along +X, the other way along -X.
  const front = new THREE.PlaneGeometry(POSTER_WIDTH, POSTER_HEIGHT)
  front.rotateY(Math.PI / 2)
  front.translate(gap, middle, POSTER_OUT)

  const back = new THREE.PlaneGeometry(POSTER_WIDTH, POSTER_HEIGHT)
  back.rotateY(-Math.PI / 2)
  back.translate(-gap, middle, POSTER_OUT)

  const board = new THREE.BoxGeometry(
    BOARD_THICKNESS,
    POSTER_HEIGHT + BOARD_EDGE * 2,
    POSTER_WIDTH + BOARD_EDGE * 2,
  )
  board.translate(0, middle, POSTER_OUT)
  const uv = board.getAttribute('uv')
  for (let index = 0; index < uv.count; index++) uv.setXY(index, BOARD_UV, BOARD_UV)

  const poster = mergeGeometries([front, back, board])
  if (!poster) throw new Error('Could not merge poster geometry')
  front.dispose()
  back.dispose()
  board.dispose()
  return poster
}

function preparePosterTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace
  // Keeps the writing sharp when the poster is seen at an angle.
  texture.anisotropy = 8
}

/**
 * Sway, plus two changes for leaf cards. The photo's green is reduced to light
 * and shade, so that each tree's own colour can tint it, flowers included. And
 * both sides of a card are lit alike, or half the leaves would look black.
 */
function addLeafLook(shader: THREE.WebGLProgramParametersWithUniforms) {
  addSway(shader)
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1))) * LEAF_BRIGHTNESS;`,
    )
    .replace(
      '#include <normal_fragment_begin>',
      `float faceDirection = 1.0;
      vec3 normal = normalize(vNormal);
      vec3 nonPerturbedNormal = normal;`,
    )
    .replace('void main() {', `#define LEAF_BRIGHTNESS ${LEAF_BRIGHTNESS.toFixed(1)}\nvoid main() {`)
}

/** A park bench: slats on two legs, with a backrest. */
function createBenchGeometry(): THREE.BufferGeometry {
  const wood = '#8a5f3c'
  const iron = '#2a2c30'
  return merge([
    box([1.7, 0.06, 0.46], [0, 0.45, 0], wood),
    box([1.7, 0.3, 0.05], [0, 0.72, -0.22], wood),
    box([0.08, 0.45, 0.44], [-0.75, 0.22, 0], iron),
    box([0.08, 0.45, 0.44], [0.75, 0.22, 0], iron),
  ])
}

/** A soft pool of light on the ground, plus a bright spot at the lamp's head. */
function createLampGlowGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const add = (x: number, y: number, z: number, brightness: number) => {
    positions.push(x, y, z)
    colors.push(GLOW_COLOR.r * brightness, GLOW_COLOR.g * brightness, GLOW_COLOR.b * brightness)
  }

  // Rings from the middle out, each dimmer than the last on a bell curve, so the
  // pool has no rim. A straight fade to a hard edge read as a flat painted disc.
  const RINGS = 7
  const ringRadius = (ring: number) => (ring / RINGS) * GLOW_RADIUS
  const ringLight = (ring: number) => GLOW_CENTRE * Math.exp(-3 * (ring / RINGS) ** 2) * (1 - ring / RINGS)
  const at = (ring: number, side: number): [number, number] => {
    const angle = (side / GLOW_SIDES) * Math.PI * 2
    return [GLOW_OFFSET + Math.cos(angle) * ringRadius(ring), Math.sin(angle) * ringRadius(ring)]
  }
  for (let ring = 0; ring < RINGS; ring++) {
    for (let side = 0; side < GLOW_SIDES; side++) {
      const [ax, az] = at(ring, side)
      const [bx, bz] = at(ring, side + 1)
      const [cx, cz] = at(ring + 1, side + 1)
      const [dx, dz] = at(ring + 1, side)
      const inner = ringLight(ring)
      const outer = ringLight(ring + 1)
      // Corners in this order face up, the side three.js draws.
      add(ax, GLOW_HEIGHT, az, inner)
      add(bx, GLOW_HEIGHT, bz, inner)
      add(cx, GLOW_HEIGHT, cz, outer)
      add(ax, GLOW_HEIGHT, az, inner)
      add(cx, GLOW_HEIGHT, cz, outer)
      add(dx, GLOW_HEIGHT, dz, outer)
    }
  }

  const pool = new THREE.BufferGeometry()
  pool.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  pool.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const head = new THREE.IcosahedronGeometry(0.2, 0)
  head.translate(GLOW_OFFSET, 6.33, 0)
  head.deleteAttribute('normal')
  head.deleteAttribute('uv')
  head.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(head.getAttribute('position').count * 3).fill(1), 3),
  )

  const merged = mergeGeometries([pool, head])
  if (!merged) throw new Error('Could not merge lamp glow geometry')
  pool.dispose()
  head.dispose()
  return merged
}

/** Shared by the lamps' cone and halo materials, updated once a frame. */
const lampUniforms = {
  uNight: { value: 0 },
  uRain: { value: 0 },
  uBulb: { value: new THREE.Vector3(...BULB) },
  uColor: { value: GLOW_COLOR.clone() },
}

/** The light falling from a lamp: an open cone from the bulb to the ground. */
function createLightConeGeometry(): THREE.BufferGeometry {
  const [x, y, z] = BULB
  const cone = new THREE.CylinderGeometry(0.12, 3.4, y - 0.1, 20, 1, true)
  cone.translate(x, (y - 0.1) / 2 + 0.05, z)
  return cone
}

/**
 * The cone is brightest where you look straight through it and fades to nothing
 * at its edges, as haze lit from inside does. Its sides face out from its middle,
 * so how directly a side faces the camera says how much lit air you're looking
 * through. Rain makes the air hazier, so the cone shows more.
 */
function createLightConeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: lampUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying float vFacing;
      varying float vHeight;
      void main() {
        mat4 model = modelMatrix * instanceMatrix;
        vec4 world = model * vec4(position, 1.0);
        vec3 normal = normalize(mat3(model) * normal);
        vFacing = abs(dot(normal, normalize(cameraPosition - world.xyz)));
        vHeight = uv.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uNight;
      uniform float uRain;
      uniform vec3 uColor;
      varying float vFacing;
      varying float vHeight;
      void main() {
        float strength = pow(vFacing, 3.0) * mix(0.35, 1.0, vHeight) * smoothstep(0.0, 0.15, vHeight);
        gl_FragColor = vec4(uColor * strength * uNight * (0.3 + uRain * 0.35), 1.0);
      }
    `,
  })
}

/** A square that always turns to face the camera, for the glow round each bulb. */
function createHaloGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1.8, 1.8)
}

function createHaloMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: lampUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform vec3 uBulb;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Put the bulb in camera space, then spread the corners out flat to the screen.
        vec4 centre = viewMatrix * modelMatrix * instanceMatrix * vec4(uBulb, 1.0);
        gl_Position = projectionMatrix * (centre + vec4(position.xy, 0.0, 0.0));
      }
    `,
    fragmentShader: `
      uniform float uNight;
      uniform float uRain;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float distance = length(vUv - 0.5) * 2.0;
        float glow = exp(-distance * distance * 7.0) * (1.0 - smoothstep(0.8, 1.0, distance));
        gl_FragColor = vec4(uColor * glow * uNight * (0.55 + uRain * 0.3), 1.0);
      }
    `,
  })
}

/**
 * Draws many copies of one shape in a single draw call. Each copy only needs a
 * transform matrix: its position, rotation and size packed into 16 numbers.
 *
 * Only copies near the rider are written into the list, and `count` tells the
 * GPU to stop there. In the title screen's aerial view, everything is drawn.
 */
export function PropInstances({
  props,
  geometry,
  color,
  colors,
  sizeRange,
  sway = false,
  glow = false,
  vertexColors = false,
  surface,
  leaves,
  flat = false,
  material,
}: {
  props: Prop[]
  geometry: THREE.BufferGeometry
  color?: string
  colors?: THREE.Color[]
  sizeRange: number
  sway?: boolean
  /** Keeps the colours stored on the shape, such as a black seat on a coloured scooter. */
  vertexColors?: boolean
  /** A texture for the whole shape, such as bark. */
  surface?: THREE.Texture
  /** Colour and cutout images for leaf cards. */
  leaves?: { color: THREE.Texture; alpha: THREE.Texture }
  /** Draws a light that adds to the scene and shows only at night. */
  glow?: boolean
  /** Lies on the ground, such as fallen petals: drawn over the road, and casts no shadow. */
  flat?: boolean
  /** A ready-made material, such as a shader for lamp light. It casts and takes no shadows. */
  material?: THREE.Material
}) {
  const { treeShadows, propDistance } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const started = useGameStore((state) => state.started)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const glowMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const lastRefresh = useRef<{ x: number; z: number; reach: number } | null>(null)

  useFrame(() => {
    const instances = mesh.current
    if (!instances) return

    if (glowMaterial.current) {
      glowMaterial.current.opacity = liveSky.look.night
      instances.visible = liveSky.look.night > 0.01
    }

    const reach = started ? propDistance : TITLE_PROP_REACH
    const last = lastRefresh.current
    if (
      last &&
      last.reach === reach &&
      Math.hypot(last.x - livePlayer.x, last.z - livePlayer.z) < REFRESH_DISTANCE
    ) {
      return
    }
    lastRefresh.current = { x: livePlayer.x, z: livePlayer.z, reach }

    let count = 0
    for (const { x, y = 0, z, rotation, variation, tint, size = 1 } of props) {
      if (Math.hypot(x - livePlayer.x, z - livePlayer.z) > reach) continue

      transform.position.set(x, y, z)
      transform.rotation.y = rotation
      transform.scale.setScalar((1 - sizeRange / 2 + variation * sizeRange) * size)
      transform.updateMatrix()
      instances.setMatrixAt(count, transform.matrix)
      if (colors) {
        instances.setColorAt(count, colors[tint ?? Math.floor(variation * colors.length * 0.999)])
      }
      count++
    }

    instances.count = count
    instances.instanceMatrix.needsUpdate = true
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, props.length]}
      frustumCulled={false}
      castShadow={treeShadows && !glow && !flat && !material}
      receiveShadow={!glow && !material}
    >
      {material ? (
        <primitive object={material} attach="material" />
      ) : glow ? (
        <meshBasicMaterial
          ref={glowMaterial}
          vertexColors
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          polygonOffset
          polygonOffsetFactor={-3}
          polygonOffsetUnits={-3}
        />
      ) : (
        <meshStandardMaterial
          color={colors ? '#ffffff' : color}
          roughness={0.95}
          flatShading={!leaves && !flat}
          polygonOffset={flat}
          polygonOffsetFactor={flat ? -4 : 0}
          polygonOffsetUnits={flat ? -4 : 0}
          vertexColors={vertexColors || !!leaves || flat}
          map={leaves?.color ?? surface ?? null}
          alphaMap={leaves?.alpha ?? null}
          alphaTest={leaves ? LEAF_CUTOFF : 0}
          side={leaves ? THREE.DoubleSide : THREE.FrontSide}
          onBeforeCompile={leaves ? addLeafLook : sway ? addSway : undefined}
        />
      )}
    </instancedMesh>
  )
}

const FOLIAGE_TEXTURES = [
  '/textures/leaf-color.jpg',
  '/textures/leaf-alpha.jpg',
  '/textures/bark-color.jpg',
]

function prepareFoliageTextures([color, alpha, bark]: THREE.Texture[]) {
  color.colorSpace = THREE.SRGBColorSpace
  bark.colorSpace = THREE.SRGBColorSpace
  bark.wrapS = THREE.RepeatWrapping
  bark.wrapT = THREE.RepeatWrapping
  bark.repeat.set(...BARK_REPEAT)
  for (const texture of [color, alpha, bark]) texture.anisotropy = 4
}

export function RoadsideProps({
  props,
  tanks,
  benches,
  creepers,
}: {
  props: Props
  tanks: Prop[]
  benches: Prop[]
  /** Bougainvillea on compound walls. */
  creepers: Prop[]
}) {
  const { leafyTrees } = useGameStore((state) => QUALITY_PRESETS[state.quality])
  const trunk = useMemo(() => createTrunkGeometry(), [])
  const canopies = useMemo(
    () => (leafyTrees ? createLeafyCanopyGeometries() : createCanopyGeometries()),
    [leafyTrees],
  )
  const [leafColor, leafAlpha, bark] = useTexture(FOLIAGE_TEXTURES, prepareFoliageTextures)
  const leaves = useMemo(() => ({ color: leafColor, alpha: leafAlpha }), [leafColor, leafAlpha])
  const lamp = useMemo(() => createLampGeometry(), [])
  const poster = useMemo(() => createPosterGeometry(), [])
  const posterImage = useTexture(POSTER_URL, preparePosterTexture)
  const tank = useMemo(() => createTankGeometry(), [])
  const bench = useMemo(() => createBenchGeometry(), [])
  const lampGlow = useMemo(() => createLampGlowGeometry(), [])
  const lightCone = useMemo(() => createLightConeGeometry(), [])
  const lightConeMaterial = useMemo(() => createLightConeMaterial(), [])
  const halo = useMemo(() => createHaloGeometry(), [])
  const haloMaterial = useMemo(() => createHaloMaterial(), [])
  const petals = useMemo(() => createPetalGeometry(), [])
  const creeper = useMemo(() => createCreeperGeometries(leafyTrees), [leafyTrees])
  // Petals lie under the trees in flower, and take their colour.
  const treesInFlower = useMemo(
    () => props.trees.filter(({ tint }) => tint !== undefined && tint >= GREEN_TINTS),
    [props.trees],
  )
  const windPhase = useRef(0)

  // Each kind of tree needs its own instanced mesh, as a mesh holds one shape.
  const treesByKind = useMemo(
    () =>
      canopies.map((_, kind) =>
        props.trees.filter(({ variation, kind: shape }) => (shape ?? Math.floor(variation * 997) % TREE_KINDS) === kind),
      ),
    [canopies, props.trees],
  )

  useFrame((_, delta) => {
    // A phase that speeds up in wind, so a change in wind can't make the trees jump.
    windPhase.current += Math.min(delta, 0.1) * (1 + liveSky.wind * 2.5)
    windUniforms.uWindPhase.value = windPhase.current
    windUniforms.uWindStrength.value = liveSky.wind
    lampUniforms.uNight.value = liveSky.look.night
    lampUniforms.uRain.value = liveSky.rain
  })

  useEffect(
    () => () => {
      trunk.dispose()
      canopies.forEach((canopy) => canopy.dispose())
      lamp.dispose()
      poster.dispose()
      lampGlow.dispose()
      lightCone.dispose()
      lightConeMaterial.dispose()
      halo.dispose()
      haloMaterial.dispose()
      tank.dispose()
      bench.dispose()
      petals.dispose()
      creeper.leaves.dispose()
      creeper.flowers.dispose()
    },
    [trunk, canopies, lamp, poster, lampGlow, lightCone, lightConeMaterial, halo, haloMaterial, tank, bench, petals, creeper],
  )

  return (
    <>
      <PropInstances
        key={String(leafyTrees)}
        props={props.trees}
        geometry={trunk}
        color={leafyTrees ? '#ffffff' : TRUNK_COLOR}
        sizeRange={0.5}
        sway
        surface={leafyTrees ? bark : undefined}
      />
      {canopies.map((canopy, kind) => (
        <PropInstances
          key={`${kind}-${leafyTrees}`}
          props={treesByKind[kind]}
          geometry={canopy}
          colors={CANOPY_COLORS}
          sizeRange={0.5}
          sway
          leaves={leafyTrees ? leaves : undefined}
        />
      ))}
      <PropInstances props={treesInFlower} geometry={petals} colors={CANOPY_COLORS} sizeRange={0.5} flat />
      <PropInstances
        key={`creeper-leaves-${leafyTrees}`}
        props={creepers}
        geometry={creeper.leaves}
        colors={CREEPER_LEAF_COLORS}
        sizeRange={0.4}
        sway
        leaves={leafyTrees ? leaves : undefined}
      />
      <PropInstances
        key={`creeper-flowers-${leafyTrees}`}
        props={creepers}
        geometry={creeper.flowers}
        colors={CREEPER_COLORS}
        sizeRange={0.4}
        sway
        leaves={leafyTrees ? leaves : undefined}
      />
      <PropInstances props={props.lamps} geometry={lamp} color={LAMP_COLOR} sizeRange={0} />
      <PropInstances props={props.lamps} geometry={poster} color="#ffffff" sizeRange={0} surface={posterImage} />
      <PropInstances props={props.lamps} geometry={lampGlow} sizeRange={0} glow />
      <PropInstances props={props.lamps} geometry={lightCone} sizeRange={0} material={lightConeMaterial} />
      <PropInstances props={props.lamps} geometry={halo} sizeRange={0} material={haloMaterial} />
      <PropInstances props={tanks} geometry={tank} colors={TANK_COLORS} sizeRange={0.3} />
      <PropInstances props={benches} geometry={bench} color="#ffffff" sizeRange={0} vertexColors />
    </>
  )
}
