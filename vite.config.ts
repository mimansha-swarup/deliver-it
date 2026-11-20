import react from '@vitejs/plugin-react'
import wasmModule from 'vite-plugin-wasm'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { defineConfig, type PluginOption } from 'vite'

/**
 * Writes a gzipped copy of each map file beside it in the build (`.geojson.gz`), which the game
 * fetches and unpacks itself (src/game/packedData.ts): 14.7 MB of map is 1 MB gzipped, and not
 * every host compresses a .geojson on the way.
 */
function packMapData(): PluginOption {
  let outDir = 'dist'
  return {
    name: 'pack-map-data',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const folder = join(outDir, 'data')
      for (const name of readdirSync(folder).filter((file) => file.endsWith('.geojson'))) {
        writeFileSync(join(folder, `${name}.gz`), gzipSync(readFileSync(join(folder, name)), { level: 9 }))
      }
    },
  }
}

/**
 * Starts the game's first downloads from the page itself, side by side, instead of one after another.
 *
 * As built, the page loads its small entry script, which asks for the game's script (0.8 MB), which
 * once running asks for the map (1 MB), and after that the physics engine's script and then its
 * .wasm (1 MB): four round trips in a row before the city can be planned, each waiting on the last
 * (about a second of a first visit on a good connection). With these links the browser asks for all
 * of them as it reads the page. The game's own requests then find them already there.
 *
 * The physics engine is asked for at low priority: planning needs it only near its end, seconds
 * after it needs the map, so on a slow connection it mustn't hold the map up.
 */
function preloadFirstFiles(): PluginOption {
  return {
    name: 'preload-first-files',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const files = Object.values(context.bundle ?? {})
        const chunk = (name: string) => files.find((file) => file.type === 'chunk' && file.name === name)?.fileName
        const wasm = files.find((file) => file.type === 'asset' && /rapier.*\.wasm$/.test(file.fileName))?.fileName
        const app = chunk('App')
        const rapier = files.find((file) => file.type === 'chunk' && file.fileName.includes('rapier'))?.fileName
        const link = (attrs: Record<string, string | boolean>) => ({ tag: 'link', attrs, injectTo: 'head' as const })
        return [
          ...(app ? [link({ rel: 'modulepreload', href: `/${app}`, crossorigin: true })] : []),
          // The map's files, gzipped (packMapData): fetched by src/game/packedData.ts under these same addresses.
          ...['hsr-compact', 'hsr-extra-buildings', 'hsr-extra-worship', 'hsr-barriers', 'hsr-transit'].map((name) =>
            link({ rel: 'preload', as: 'fetch', href: `/data/${name}.geojson.gz`, crossorigin: true }),
          ),
          ...(rapier ? [link({ rel: 'modulepreload', href: `/${rapier}`, crossorigin: true, fetchpriority: 'low' })] : []),
          ...(wasm ? [link({ rel: 'preload', as: 'fetch', type: 'application/wasm', href: `/${wasm}`, crossorigin: true, fetchpriority: 'low' })] : []),
        ]
      },
    },
  }
}

/** vite-plugin-wasm's types describe its CommonJS build; in its ES build, used here, the default export is the plugin. */
const wasm = wasmModule as unknown as () => PluginOption

// https://vite.dev/config/
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

export default defineConfig({
  // The game's version, shown on the title screen (src/game/brand.ts).
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Rapier's standard build imports its .wasm file directly (src/physics/rapier.ts).
  plugins: [react(), wasm(), packMapData(), preloadFirstFiles()],
})
