type RapierModule = typeof import('@dimforge/rapier3d')

let rapier: Promise<RapierModule> | null = null

/**
 * Rapier is compiled to WebAssembly. This is its standard build: the WebAssembly is its own
 * .wasm file, which the browser compiles as it downloads (vite-plugin-wasm wires it in), rather
 * than the compat build's 4.3 MB script with the binary written inside as text. Importing the
 * module starts it up. It's a separate chunk, so the rest of the game doesn't wait for it.
 */
export function loadRapier(): Promise<RapierModule> {
  rapier ??= import('@dimforge/rapier3d')
  return rapier
}
