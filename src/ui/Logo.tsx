import { GAME_NAME } from '../game/brand'

/*
 * The Swalpa Fast logo: a chunky rounded wordmark leaning into its own speed, cream over yellow
 * with a charcoal edge, three speed lines behind "Fast" and a scooter's trail swept under it. The
 * same drawing is the title screen's wordmark, the share image's and the exports in art/logo
 * (made from this by src/dev/brandExport.ts), so there is one logo to change.
 *
 * The letters are Baloo Tamma 2 (Ek Type, SIL Open Font Licence), the game's own typeface, which
 * the page already loads; the exported SVG carries the font inside it.
 */

export const BRAND = { yellow: '#f6b32b', charcoal: '#0e1116', cream: '#fff6e6' }

/** The logo's own box: everything is drawn inside 720 by 400. */
export const LOGO_BOX = { width: 720, height: 400 }

const FONT = "'Baloo Tamma 2', system-ui, sans-serif"

export function Logo({ className, title = GAME_NAME }: { className?: string; title?: string }) {
  const { yellow, charcoal, cream } = BRAND
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${LOGO_BOX.width} ${LOGO_BOX.height}`} role="img" aria-label={title}>
      <g transform="rotate(-4 360 200)">
        {/* The trail: thin where the scooter was, full where it is, flicking up past the last letter. */}
        <path
          d="M34 350 C 230 366, 470 366, 694 300 C 700 298, 704 304, 699 309 C 520 412, 250 402, 34 362 C 27 360, 27 350, 34 350 Z"
          fill={yellow}
          stroke={charcoal}
          strokeWidth="10"
          strokeLinejoin="round"
        />
        <g transform="skewX(-9)" fontFamily={FONT} fontWeight="800" stroke={charcoal} strokeLinejoin="round" paintOrder="stroke" style={{ paintOrder: 'stroke' }}>
          <text x="118" y="158" fontSize="136" fill={cream} strokeWidth="24" letterSpacing="-2">
            Swalpa
          </text>
          <text x="262" y="322" fontSize="196" fill={yellow} strokeWidth="28" letterSpacing="-3">
            Fast
          </text>
        </g>
        {/* Speed lines behind "Fast": longest in the middle, each a rounded bar. */}
        <g fill={cream} stroke={charcoal} strokeWidth="9" strokeLinejoin="round">
          <rect x="96" y="212" width="92" height="22" rx="11" />
          <rect x="40" y="250" width="132" height="22" rx="11" />
          <rect x="82" y="288" width="78" height="22" rx="11" />
        </g>
      </g>
    </svg>
  )
}

/** The app icon: the Kannada letter ಸ (sa, for ಸ್ವಲ್ಪ) on a yellow rounded square. `bleed`: yellow to every edge, for icons the system rounds or masks itself. */
export function BrandIcon({ bleed = false, safe = false }: { bleed?: boolean; safe?: boolean }) {
  const { yellow, charcoal } = BRAND
  // A maskable icon keeps the letter inside the middle 80%.
  const size = safe ? 300 : 380
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label={GAME_NAME}>
      <rect width="512" height="512" rx={bleed ? 0 : 112} fill={yellow} />
      <text x="256" y={safe ? 362 : 390} fontSize={size} fontFamily={FONT} fontWeight="800" fill={charcoal} textAnchor="middle">
        ಸ
      </text>
    </svg>
  )
}
