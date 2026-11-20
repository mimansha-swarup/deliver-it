/*
 * The game's name, in one place. "Swalpa Fast" is the game; "Deliver It" is only the delivery
 * company inside it (the jacket, the box, the dark store, the rider's app).
 */

export const GAME_NAME = 'Swalpa Fast'
export const GAME_NAME_KANNADA = 'ಸ್ವಲ್ಪ ಫಾಸ್ಟ್'
export const TAGLINE = 'A delivery rider’s Bengaluru'
/** Where in Bengaluru the game is set so far: said under the tagline, so the name doesn't promise the whole city. */
export const NOW_RIDING = 'Now riding: HSR Layout'
/** The game's version, from package.json (vite.config.ts). */
export const VERSION: string = __APP_VERSION__
/** Where the game lives. index.html's share tags carry the same address in full, as link previews need. */
export const SITE_URL = 'https://deliver-simulator.netlify.app'
/** A file name's start for anything saved from the game (photos, the score card). */
export const FILE_PREFIX = 'swalpa-fast'

/**
 * Links that are the maker's to give: where feedback goes, and their LinkedIn page. Empty until
 * set; a link with no address isn't shown.
 */
export const FEEDBACK_URL = ''
export const LINKEDIN_URL = ''

/** The brand's three colours. */
export const BRAND = { yellow: '#f6b32b', charcoal: '#0e1116', cream: '#fff6e6' }

/** The logo's own box (ui/Logo.tsx): everything is drawn inside 720 by 400. */
export const LOGO_BOX = { width: 720, height: 400 }
