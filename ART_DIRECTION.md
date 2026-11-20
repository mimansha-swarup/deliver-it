# Art direction: Swalpa Fast

**Style: stylized realism.** HSR Layout, Bengaluru, as a rider sees it: real proportions,
real colours and real clutter, with detail simplified to what reads at riding speed.

Every visual change follows this file. If a change can't meet it, say so rather than drift from it.

## Golden rule

**The same lighting and colour grade apply to everything.** No asset gets its own lighting,
its own tone mapping or its own saturation boost to "pop". If something looks wrong under the
shared light and grade, fix its material or colour, not the light.

## Performance rule

**It must stay smooth on the "Low" quality setting and on mid-range laptops.** Every visual
addition needs a plan for Low (`src/game/qualitySettings.ts`): cheaper, shorter-range or off.
Prefer textures, vertex colours and merged or instanced meshes over extra lights, extra draw
calls and extra passes.

## The world

### Buildings
- Semi-realistic Bengaluru houses.
- Colourful plaster: pink, mint, yellow and terracotta, not only beige.
- Compound walls, and black Sintex water tanks on roofs.
- Window grills, AC units, laundry on balconies, and overhead wires between poles.

### Roads
- Realistic dark blue-grey asphalt, around `#4E4F57`.
- Patches, cracks and gutters.
- Kerbs painted black and yellow.

### Soil
- Dusty Bengaluru red earth, not rocky:

| Soil | Colour |
| --- | --- |
| Base | `#A65A35` |
| Dry | `#C0794A` |
| Damp | `#8A4A2C` |

### Footpaths
- Grey interlocking I-shaped pavers.
- Clear boundaries, and tree pits.

### Shops
- Signboards in Kannada and English.
- Signs about 1.3× real size, so they read while riding.
- Names and logos are made up. No real brand appears (see the project rules on branding).

### Trees
- Realistic colours, with foliage simplified into clusters.

### Vehicles
- Real proportions, simplified parts.
- KA number plates.

### People
- Grounded stylized: realistic proportions and clothes, simplified faces.

## Light and colour

- **Lighting:** a low, warm sun, soft bounce light, ambient occlusion and a light golden haze.
- **Colour:** warm and slightly muted, with one colour grade (a LUT) over everything.
  The grade doesn't exist in the code yet. When it's added, it is the only grade, and it
  covers the whole frame.
- **Weathering:** stains, grime at the bases of walls, faded paint. Nothing looks brand new.

## Checklist for any visual change

1. Does it sit under the shared sun, haze and grade, with no special lighting of its own?
2. Do its colours fit the warm, slightly muted palette and the values above?
3. Is it weathered, not brand new?
4. Is the detail simplified to what reads at riding speed?
5. Is it still smooth on Low, and what does Low do with it?
6. Is every name, logo and sign made up?

## The brand
- The game is **Swalpa Fast** (ಸ್ವಲ್ಪ ಫಾಸ್ಟ್), "A delivery rider's Bengaluru". "Deliver It" is the
  made-up delivery company in the world: the jacket, the box, the dark store, the rider's app.
- The logo is one drawing (`src/ui/Logo.tsx`; exports in `art/logo`): a chunky rounded wordmark
  leaning forward, cream "Swalpa" over yellow "Fast" with a charcoal edge, three speed lines and a
  scooter's trail swept under it. No dashed road line: other Bengaluru games use roads in theirs.
- Three colours: yellow `#f6b32b`, charcoal `#0e1116`, cream `#fff6e6`. The icon is the Kannada
  letter ಸ in charcoal on a yellow rounded square.
- Menus use the same three colours and Baloo Tamma 2, over pictures taken in the game.

