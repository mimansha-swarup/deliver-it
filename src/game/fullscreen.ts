/**
 * Asks for the whole screen in landscape. Android browsers allow both after a
 * tap. iPhone Safari allows neither, so it quietly does nothing there, and the
 * rotate prompt does the job instead.
 */
export async function enterLandscapeFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
    }
    // `lock` isn't in TypeScript's DOM types, as only some browsers have it.
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'landscape') => Promise<void>
    }
    await orientation.lock?.('landscape')
  } catch {
    // Refused or unsupported. The game works the same without it.
  }
}
