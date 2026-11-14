import * as THREE from 'three'
import { loadRapier } from '../physics/rapier'

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

type GameFile = { url: string; kb: number; kind: 'data' | 'model' | 'image' }

const GAME_FILES: GameFile[] = [
  { url: MAP_URL, kb: 14342, kind: 'data' },
  { url: '/models/traffic.glb', kb: 3019, kind: 'model' },
  { url: '/models/city-kit.glb', kb: 1634, kind: 'model' },
  { url: '/models/yamaha.glb', kb: 335, kind: 'model' },
  ...[
    ['ground-color', 537],
    ['road-color', 420],
    ['road-normal', 64],
    ['pavement-color', 269],
    ['pavement-normal', 155],
    ['wall-color', 72],
    ['wall-normal', 56],
    ['concrete-color', 43],
    ['concrete-normal', 89],
    ['brick-color', 86],
    ['brick-normal', 194],
    ['park-color', 276],
    ['grass-color', 189],
    ['grass-alpha', 253],
    ['leaf-color', 250],
    ['leaf-alpha', 300],
    ['bark-color', 118],
    ['poster-kills', 81],
    ['board-kirana', 91],
    ['board-darshini', 91],
    ['board-chai', 87],
    ['board-bakery', 93],
    ['board-pharmacy', 91],
  ].map(([name, kb]) => ({ url: `/textures/${name}.jpg`, kb: kb as number, kind: 'image' as const })),
]

/** The physics engine is code, not a file here, so it counts as about this much download. */
const PHYSICS_KB = 1400

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
 * happens. Files come down a few at a time, the map first, as the world can't
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
      mapReady: mapIn && physicsIn,
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
      mapFile = download(url, count)
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

  const physics = loadRapier().then(() => {
    loadedKb += PHYSICS_KB
    physicsIn = true
    send()
  })

  // Four at a time: enough to keep the connection busy, few enough to show steady progress.
  const queue = [...GAME_FILES]
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await fetchOne(file)
  }

  send()
  running = Promise.all([physics, ...Array.from({ length: 4 }, worker)])
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
