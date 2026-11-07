type RapierModule = typeof import('@dimforge/rapier3d-compat')

let rapier: Promise<RapierModule> | null = null

/**
 * Rapier is compiled to WebAssembly, which has to start up before first use. It's
 * loaded as a separate file, so the rest of the game doesn't wait to download it.
 */
export function loadRapier(): Promise<RapierModule> {
  rapier ??= import('@dimforge/rapier3d-compat').then(async (module) => {
    await module.init()
    return module
  })
  return rapier
}
