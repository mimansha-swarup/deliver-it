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

/** vite-plugin-wasm's types describe its CommonJS build; in its ES build, used here, the default export is the plugin. */
const wasm = wasmModule as unknown as () => PluginOption

// https://vite.dev/config/
export default defineConfig({
  // Rapier's standard build imports its .wasm file directly (src/physics/rapier.ts).
  plugins: [react(), wasm(), packMapData()],
})
