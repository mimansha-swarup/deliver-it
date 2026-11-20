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

## The brand

Name "Swalpa Fast", Kannada "ಸ್ವಲ್ಪ ಫಾಸ್ಟ್", tagline "A delivery rider's Bengaluru". Yellow
`#f6b32b`, charcoal `#0e1116`, cream `#fff6e6`. No real brand names appear in the game.
