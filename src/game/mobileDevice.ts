/**
 * Whether this is a phone or tablet. Deliver It is played with a keyboard on a
 * computer, so a phone or tablet gets a short page saying so instead of the game.
 *
 * Two things must both be true:
 * - The browser says it's a mobile device. iPads claim to be Macs, so a "Mac"
 *   with a touchscreen counts too, as no real Mac has one.
 * - The main pointer is a finger ("coarse"), not a mouse or trackpad ("fine").
 *   So a touchscreen laptop still gets the game.
 *
 * Adding `?mobile` to the address shows the phone page on a computer, to check it.
 */
function detectMobile(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('mobile')) return true

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

export const isMobileDevice = detectMobile()
