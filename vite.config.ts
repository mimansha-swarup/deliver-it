import react from '@vitejs/plugin-react'
import wasmModule from 'vite-plugin-wasm'
import { defineConfig, type PluginOption } from 'vite'

/** vite-plugin-wasm's types describe its CommonJS build; in its ES build, used here, the default export is the plugin. */
const wasm = wasmModule as unknown as () => PluginOption

// https://vite.dev/config/
export default defineConfig({
  // Rapier's standard build imports its .wasm file directly (src/physics/rapier.ts).
  plugins: [react(), wasm()],
})
