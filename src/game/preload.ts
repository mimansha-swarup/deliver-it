import * as THREE from 'three'
import { loadRapier } from '../physics/rapier'
import { fetchPackedData } from './packedData'
import { BASIS_PATH } from '../world/ktx2'

/**
 * Downloads everything the game needs, from the moment the title screen opens,
 * so it can show real progress and the world is ready sooner after Play. Each
 * file ends up in three.js's own cache under the key its loader looks for
 * (`file:` for models, `image:` for textures), so the world never downloads it again.
 *
 * Sizes are what each file weighs today, in kilobytes, for the progress bar. If a
 * file changes, the bar is only slightly off; nothing breaks. In development, a
 * file the world loads that isn't listed here is reported in the console.
 */
const MAP_URL = `${import.meta.env.BASE_URL}data/hsr-compact.geojson`
/** The map's smaller files (mapData.ts), fetched with it. */
const EXTRA_DATA = ['hsr-extra-buildings', 'hsr-extra-worship', 'hsr-barriers', 'hsr-transit'].map((name) => `${import.meta.env.BASE_URL}data/${name}.geojson`)

type GameFile = { url: string; kb: number; kind: 'data' | 'model' | 'image' }

const GAME_FILES: GameFile[] = [
  // Gzipped: 1 MB (packedData.ts). A host without the gzipped copy sends 14.3 MB, and the bar stops at this.
  { url: MAP_URL, kb: 1010, kind: 'data' },
  { url: '/models/traffic.glb', kb: 1373, kind: 'model' },
  { url: '/models/city-kit.glb', kb: 1242, kind: 'model' },
  { url: '/models/yamaha.glb', kb: 120, kind: 'model' },
  { url: '/models/people.glb', kb: 426, kind: 'model' },
  { url: '/models/fleet.glb', kb: 686, kind: 'model' },
  { url: '/models/tripo.glb', kb: 996, kind: 'model' },
  // Photos the game draws onto canvases (facades, shop boards) stay JPEG.
  ...[
    ['wall-color', 72],
    ['concrete-color', 43],
    ['brick-color', 87],
    ['board-kirana', 91],
    ['board-darshini', 91],
    ['board-chai', 86],
    ['board-bakery', 93],
    ['board-pharmacy', 90],
  ].map(([name, kb]) => ({ url: `/textures/${name}.jpg`, kb: kb as number, kind: 'image' as const })),
  // The rest are KTX2 (ktx2.ts), read as files, as their loader reads them.
  ...[
    ['ground-color', 248],
    ['road-color', 212],
    ['road-normal', 81],
    ['pavement-color', 205],
    ['pavement-normal', 194],
    ['wall-normal', 81],
    ['concrete-normal', 87],
    ['brick-normal', 157],
    ['park-color', 214],
    ['grass-color', 139],
    ['grass-alpha', 138],
    ['leaf-color', 130],
    ['leaf-alpha', 107],
    ['bark-color', 80],
  ].map(([name, kb]) => ({ url: `/textures/${name}.ktx2`, kb: kb as number, kind: 'model' as const })),
]

/** The physics engine (a small script and its 3 MB .wasm file) isn't listed above, so it counts as about this much download. */
const PHYSICS_KB = 3300

/** Everything the loader downloads, in kilobytes, so the title screen can show it before it starts. */
export const TOTAL_KB = GAME_FILES.reduce((sum, { kb }) => sum + kb, 0) + PHYSICS_KB

export type LoadStage = 'downloading' | 'downloaded' | 'error'
export type LoadProgress = {
  loadedKb: number
  totalKb: number
  stage: LoadStage
  /** The map and the physics engine are in, which is all the world needs to start building. */
  mapReady: boolean
  error?: string
}

/** The map, kept here so the map loader can read it without downloading it again. */
let mapFile: Promise<ArrayBuffer> | null = null

/** The map's bytes, once the loader has them, or null if the loader hasn't started. */
export function waitForPreloadedMap(): Promise<ArrayBuffer> | null {
  return mapFile
}

/** Reads a response a chunk at a time, reporting bytes as they arrive. */
async function download(url: string, onBytes: (bytes: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    onBytes(value.length)
  }
  const whole = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    whole.set(chunk, offset)
    offset += chunk.length
  }
  return whole.buffer
}

/**
 * Models and textures go through three.js's own loaders, the same ones the world
 * uses. If the world asks for a file while it's still coming down, the loader
 * hands it the download already under way instead of starting another: the file
 * loader keeps a list of requests in flight, and the image loader puts each image
 * in the cache the moment it starts. So the world can start building before
 * everything has arrived, and nothing downloads twice.
 */
function loadModel(url: string, onBytes: (bytes: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.FileLoader()
    loader.setResponseType('arraybuffer')
    let seen = 0
    loader.load(
      url,
      () => resolve(),
      (event) => {
        onBytes(event.loaded - seen)
        seen = event.loaded
      },
      () => reject(new Error(`${url} could not be downloaded`)),
    )
  })
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    new THREE.ImageLoader().load(url, () => resolve(), undefined, () => reject(new Error(`${url} could not be downloaded`)))
  })
}

let running: Promise<void> | null = null

/**
 * Starts the download, once, as the page opens. `report` hears progress as it
 * happens. The map comes first, then everything else together, as the world can't
 * start building without it.
 */
export function preloadGame(report: (progress: LoadProgress) => void): Promise<void> {
  if (running) return running

  THREE.Cache.enabled = true
  const totalKb = TOTAL_KB
  let loadedKb = 0
  let filesLeft = GAME_FILES.length
  let mapIn = false
  let physicsIn = false
  const send = () =>
    report({
      loadedKb: Math.min(loadedKb, totalKb),
      totalKb,
      stage: filesLeft > 0 || !physicsIn ? 'downloading' : 'downloaded',
      // The world starts building with the map alone; it waits for the physics engine only where it needs it (World.tsx).
      mapReady: mapIn,
    })

  const fetchOne = async ({ url, kb, kind }: GameFile) => {
    // Bytes count towards the bar, but never past the file's listed size, so a
    // compressed or changed file can't push the bar back or over.
    let counted = 0
    const count = (bytes: number) => {
      const add = Math.min(bytes / 1024, kb - counted)
      counted += add
      loadedKb += add
      send()
    }

    if (kind === 'data') {
      mapFile = fetchPackedData(url, (address) => download(address, count))
      await mapFile
      mapIn = true
    } else if (kind === 'model') {
      await loadModel(url, count)
    } else {
      await loadImage(url)
    }
    loadedKb += kb - counted
    filesLeft--
    send()
  }

  // The map and its smaller files come first, on their own: building starts with them alone, and
  // takes long enough (seconds) for everything else to arrive meanwhile. On a slow line, sharing the
  // connection from the start put the map, and so everything, a few seconds later.
  const [mapEntry, ...rest] = GAME_FILES
  const mapFirst = Promise.all([fetchOne(mapEntry), ...EXTRA_DATA.map((url) => fetchPackedData(url).catch(() => new ArrayBuffer(0)))])
  const afterMap = mapFirst.then(
    () => undefined,
    () => undefined,
  )

  // Then the texture decoder, the physics engine (needed only near the end of building), the models and textures.
  void afterMap.then(() => {
    new THREE.FileLoader().load(`${BASIS_PATH}basis_transcoder.js`)
    new THREE.FileLoader().setResponseType('arraybuffer').load(`${BASIS_PATH}basis_transcoder.wasm`)
  })
  const physics = afterMap.then(loadRapier).then(() => {
    loadedKb += PHYSICS_KB
    physicsIn = true
    send()
  })

  // Then everything else at once. They were fetched four at a time, each next one asked for as one
  // finished; but the page is busy planning the city meanwhile, a few hundred milliseconds at a
  // stretch, and "as one finished" waited for the page to notice. The last textures were arriving a
  // second after the plan was done, with the world waiting on them. Asked for together, they come
  // down while the page is busy, and are all there when it looks up.
  const others = afterMap.then(() => Promise.all(rest.map(fetchOne)))

  send()
  running = Promise.all([mapFirst, physics, others])
    .then(() => undefined)
    .catch((error: unknown) => {
      running = null
      report({
        loadedKb,
        totalKb,
        stage: 'error',
        mapReady: mapIn && physicsIn,
        error: error instanceof Error ? error.message : String(error),
      })
    })

  if (import.meta.env.DEV) {
    const listed = new Set(GAME_FILES.map(({ url }) => url))
    THREE.DefaultLoadingManager.onStart = (url) => {
      if (!listed.has(url) && !url.startsWith('blob:') && !url.startsWith('data:')) {
        console.warn(`[preload] ${url} isn't in GAME_FILES, so it downloads on its own.`)
      }
    }
  }

  return running
}
