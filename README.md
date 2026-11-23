# Swalpa Fast · ಸ್ವಲ್ಪ ಫಾಸ್ಟ್

**A delivery rider's Bengaluru.** Be a delivery rider in a real, living HSR Layout: go online,
take an order, ride it through real streets, handle whatever the city throws at you, hand it over,
get rated and paid. Free in the browser, no download; progress saves on the device.

"Swalpa Fast" is the game. "Deliver It" is the delivery company inside it: the jacket, the box,
the dark store and the rider's app.

## Read first

- [VISION.md](VISION.md): what the game is and isn't, and how a new feature is decided on.
- [ART_DIRECTION.md](ART_DIRECTION.md): the look, and the two rules every visual change follows.
- [DEVLOG.md](DEVLOG.md): what changed and why, entry by entry.

## Running it

```sh
npm install
npm run dev        # the game at http://localhost:5173 (add ?debug for the debug save and tools)
npm run build      # type-check and build into dist/
npm run preview    # serve the build, as players get it
npm run lint
```

The frame benchmark runs against the built game:
`node --experimental-websocket scripts/bench.mjs --streets shop-street`, with `npm run preview`
on port 4173 and no other game tab open.

## How it's made

React, three.js through @react-three/fiber, Rapier for physics, zustand for state, Vite and
TypeScript. The city is built in the browser from OpenStreetMap and open building data
(`public/data`, credits in `public/data/CREDITS.txt`); models are credited in
`public/models/CREDITS.txt`.

- `src/game`: the rules and saved state (orders, money, the family, the fleet, `brand.ts` for the name).
- `src/world`, `src/traffic`, `src/vehicle`, `src/camera`, `src/sky`: the city and everything moving in it.
- `src/ui`: the title screen, menus, HUD and the rider's phone.
- `art/logo`: the logo's source and exports.

## Licences

- Every model in `public/models` allows commercial use: CC BY 4.0, CC0, or made with Tripo AI on a
  commercial plan (`public/models/CREDITS.txt`). The non-commercial sports bike was replaced by the
  Vega 150 in polish sprint 2 (`scripts/prepare_two_wheelers.mjs`).
- The radio and every sound effect are composed in code; there is no recorded music and no video station.

## The brand

Name "Swalpa Fast", Kannada "ಸ್ವಲ್ಪ ಫಾಸ್ಟ್", tagline "A delivery rider's Bengaluru". Yellow
`#f6b32b`, charcoal `#0e1116`, cream `#fff6e6`. No real brand names appear in the game.

## Analytics

Anonymous gameplay statistics go to [PostHog](https://posthog.com) from one file, `src/analytics.ts`.
Nothing is sent unless a key is set, and never from localhost, a Netlify deploy preview, or a visit
with `?debug` or `?fresh` in the address.

Set these where the site is built (Netlify: Site configuration → Environment variables), or in
`.env.local` to try it:

| Variable | What it is |
|---|---|
| `VITE_POSTHOG_KEY` | The PostHog project's API key (`phc_…`). Without it every call does nothing. |
| `VITE_POSTHOG_HOST` | The PostHog host address for your project's region (PostHog shows it beside the key). Optional: without it the library uses PostHog's US cloud. |

Both values are public by nature: anything named `VITE_…` is built into the page's JavaScript, and a
PostHog project key is made to be shipped to browsers. Netlify's secrets scan would still fail the
build for finding them in its output, so `netlify.toml` tells it to leave these two alone
(`SECRETS_SCAN_OMIT_KEYS`). Don't write either value into the repository.

In the PostHog project, switch on **Discard client IP data**: the `ip: false` option in the code
has no effect in current versions of posthog-js.

What is on and off: autocapture, page views, session recording, surveys and feature flags are off;
no person profiles are made; the anonymous id is kept in memory only (no cookie, no local storage),
so each visit is a new anonymous visitor.

The main funnel:

`page_open` → `new_game` → `order_accepted` → `pickup_done` → `order_delivered`

All events: `page_open {device, quality}`, `new_game`, `explore_start`, `multiplayer_join {players}`,
`tutorial_step {n}`, `tutorial_skip {n}`, `tutorial_done {seconds}`, `order_accepted {order_no}`,
`pickup_done`, `order_delivered {stars, seconds, crashes, on_time, vehicle}`, `crash`,
`vehicle_switch {vehicle}`, `session_end {minutes_played, deliveries}`.
