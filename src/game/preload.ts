import * as THREE from 'three'
import { loadRapier } from '../physics/rapier'

/**
 * Downloads everything the game needs before the world is built, so the title
 * screen can show real progress. Each file goes into three.js's own cache under
 * the key its loader looks for (`file:` for models, `image:` for textures). When
 * the world then asks for it, three.js finds it there and doesn't download it again.
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

export type LoadStage = 'downloading' | 'physics' | 'building' | 'ready' | 'error'
export type LoadProgress = { loadedKb: number; totalKb: number; stage: LoadStage; error?: string }

/** The map, kept here so the map loader can read it without downloading it again. */
const files = new Map<string, ArrayBuffer>()

export function takePreloadedFile(url: string): ArrayBuffer | undefined {
  return files.get(url)
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

/** Turns downloaded image bytes into the ready-to-use image three.js's TextureLoader would make. */
function toImage(bytes: ArrayBuffer): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const address = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
    image.onload = () => {
      URL.revokeObjectURL(address)
      resolve(image)
    }
    image.onerror = () => reject(new Error('An image could not be read'))
    image.src = address
  })
}

let running: Promise<void> | null = null

/**
 * Starts the download, once. `report` hears progress as it happens. Files come
 * down a few at a time, so one slow file doesn't hold up the bar.
 */
export function preloadGame(report: (progress: LoadProgress) => void): Promise<void> {
  if (running) return running

  THREE.Cache.enabled = true
  const totalKb = TOTAL_KB
  let loadedKb = 0
  let filesLeft = GAME_FILES.length
  const send = (stage: LoadStage) => report({ loadedKb: Math.min(loadedKb, totalKb), totalKb, stage })

  const fetchOne = async ({ url, kb, kind }: GameFile) => {
    // Bytes count towards the bar, but never past the file's listed size, so a
    // compressed or changed file can't push the bar back or over.
    let counted = 0
    const bytes = await download(url, (chunk) => {
      const add = Math.min(chunk / 1024, kb - counted)
      counted += add
      loadedKb += add
      send('downloading')
    })
    loadedKb += kb - counted

    if (kind === 'data') files.set(url, bytes)
    if (kind === 'model') THREE.Cache.add(`file:${url}`, bytes)
    if (kind === 'image') THREE.Cache.add(`image:${url}`, await toImage(bytes))
    filesLeft--
    send(filesLeft > 0 ? 'downloading' : 'physics')
  }

  const physics = loadRapier().then(() => {
    loadedKb += PHYSICS_KB
    send(filesLeft > 0 ? 'downloading' : 'physics')
  })

  // Four at a time: enough to keep the connection busy, few enough to show steady progress.
  const queue = [...GAME_FILES]
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) await fetchOne(file)
  }

  send('downloading')
  running = Promise.all([physics, ...Array.from({ length: 4 }, worker)])
    .then(() => send('building'))
    .catch((error: unknown) => {
      running = null
      report({ loadedKb, totalKb, stage: 'error', error: error instanceof Error ? error.message : String(error) })
    })

  if (import.meta.env.DEV) {
    const listed = new Set(GAME_FILES.map(({ url }) => url))
    THREE.DefaultLoadingManager.onStart = (url) => {
      if (!listed.has(url) && !url.startsWith('blob:') && !url.startsWith('data:')) {
        console.warn(`[preload] ${url} isn't in GAME_FILES, so it downloads after the loader finishes.`)
      }
    }
  }

  return running
}
