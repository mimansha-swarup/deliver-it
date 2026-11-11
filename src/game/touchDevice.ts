/**
 * Whether this is a phone or tablet, which gets the on-screen buttons and the
 * landscape layout. Everything else, including touchscreen laptops, keeps the
 * keyboard layout.
 *
 * Two things must both be true:
 * - The browser says it's a mobile device. iPads claim to be Macs, so a "Mac"
 *   with a touchscreen counts too, as no real Mac has one.
 * - The main pointer is a finger ("coarse"), not a mouse or trackpad ("fine").
 *   So a phone with a mouse plugged in keeps the keyboard layout.
 *
 * Adding `?touch` to the address forces the phone layout, to try it on a computer.
 */
function detectMobile(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('touch')) return true

  const { userAgent, maxTouchPoints } = navigator
  // Chrome and Edge say directly. Safari and Firefox don't have this yet.
  const saysMobile = (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData
    ?.mobile
  const mobileBrowser =
    saysMobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)

  return mobileBrowser && window.matchMedia('(pointer: coarse)').matches
}

export const isTouchDevice = detectMobile()
