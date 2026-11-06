# slikk-it dev log

What was done, why it was done, and what it teaches about Three.js and
React Three Fiber (R3F). Newest entry goes at the bottom, so the lessons read in
order.

Each entry has:

- **What I did**: the change, in plain terms
- **Why**: the reasoning and what was rejected
- **Lesson**: a Three.js / R3F concept, taught through this project's real code
- **Try it**: a small experiment to do yourself

---

## 2026-11-06: Entry 1, starting point

### What I did

Started this log. No app code has changed. I read the project and measured the
map data so that later decisions rest on real numbers.

Where the project stands:

| Thing | State |
| --- | --- |
| `src/App.tsx` | Still the Vite starter page, with no 3D yet |
| `src/world.tsx` | Empty |
| Installed | `three` 0.187, `@react-three/fiber` 9.8, `@react-three/drei` 10.7, React 19.3 |
| `public/data/hsr-compact.geojson` | OpenStreetMap export, 1.6 MB, 2,254 features |
| Git | Not a repository yet |

What's in the map data:

| Measure | Value |
| --- | --- |
| Area covered | About 2.8 km by 3.4 km, around lat 12.909, lon 77.652 (HSR Layout, Bengaluru) |
| Polygons | 1,745, of which 1,654 are buildings and 91 are something else |
| Lines | 319 (roads, tagged `highway`) |
| Points | 190 (shops, amenities and so on) |
| Corner points across all buildings | 8,966 |
| Buildings with a `height` tag | 0 |
| Buildings with a `building:levels` tag | 21 |
| Buildings with holes (courtyards) | 2 |

### Why

- **Measure first.** The numbers above shape the 3D work. For example, 1,633 of
  the 1,654 buildings have no height information, so we will have to choose
  heights ourselves.
- **A file in the repo.** The log sits next to the code it describes, so the two
  stay in step.

### Lesson 1: what Three.js and R3F each do

**Three.js** draws 3D with WebGL. Everything you see needs three things:

- **Scene**: the container holding your objects and lights
- **Camera**: the viewpoint
- **Renderer**: turns the scene and camera into pixels on a `<canvas>`, once per
  frame

The basic visible object is a **Mesh**, which is two things together:

- **Geometry**: the shape, stored as a list of triangles
- **Material**: how the surface looks and reacts to light

**R3F** does not replace Three.js. It lets React manage Three.js objects: where
`react-dom` turns JSX into HTML elements, R3F turns JSX into Three.js objects.

```tsx
// Plain Three.js: you create and connect everything
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 'orange' }),
)
scene.add(mesh)

// R3F: the same object, written as JSX
<mesh>
  <boxGeometry args={[1, 1, 1]} />
  <meshStandardMaterial color="orange" />
</mesh>
```

The naming rule: take the Three.js class name and lowercase the first letter
(`BoxGeometry` becomes `boxGeometry`). `args` holds the constructor arguments.
`<Canvas>` sets up the scene, camera, renderer and render loop for you.

**Drei** is a library of ready-made R3F helpers, such as `OrbitControls` for
moving the camera with the mouse.

### Lesson 2: turning a map into 3D

Three problems sit between our GeoJSON and a 3D building.

**1. Degrees are not metres.** The data stores longitude and latitude, while a 3D
scene works best in plain units, and we can treat one unit as one metre. Over an
area this small, a simple conversion is accurate enough:

```ts
const LON0 = 77.65201
const LAT0 = 12.90877
const METRES_PER_DEGREE = 111_320

function toMetres([lon, lat]: [number, number]): [number, number] {
  const x = (lon - LON0) * METRES_PER_DEGREE * Math.cos((LAT0 * Math.PI) / 180)
  const y = (lat - LAT0) * METRES_PER_DEGREE
  return [x, y]
}
```

Two details matter here:

- Lines of longitude get closer together away from the equator, which is what the
  `cos` corrects. Without it, the map would be stretched east to west.
- Subtracting the centre keeps coordinates small. A GPU stores positions with
  limited precision, and values centred near zero avoid jitter.

**2. A footprint is flat.** `THREE.Shape` describes a 2D outline, and
`ExtrudeGeometry` pushes it into 3D like a cookie cutter.

**3. Three.js is Y-up, but extrusion goes along Z.** The footprint is drawn on the
X/Y plane and pushed along Z, so the building comes out lying on its side. One
rotation stands it up:

```ts
const shape = new THREE.Shape(ring.map((c) => new THREE.Vector2(...toMetres(c))))
const geometry = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false })
geometry.rotateX(-Math.PI / 2)
```

I ran this on the first building in the data, using a centre point of the data's
bounding box:

| | X | Y | Z |
| --- | --- | --- | --- |
| Before rotating | 3.1 to 22.1 | 550.8 to 586.3 | 0 to 10 |
| After rotating | 3.1 to 22.1 | 0 to 10 | -586.3 to -550.8 |

So the building ends up standing on the ground (Y from 0 to 10), with east as +X
and north as -Z. That building came to 76 triangles.

### Things to watch for

- **`<Canvas>` fills its parent, so the parent needs a real height.** Otherwise the
  canvas can collapse and you get a blank page with no error. Our `#root` styles
  in `src/index.css` are for the starter page and will need changing.
- **Each separate mesh is usually one draw call.** 1,654 meshes means about 1,654
  instructions to the GPU every frame, which can get slow. Merging them into one
  geometry is the common fix. We'll measure before deciding.

### Try it

1. In `App.tsx`, render a `<Canvas>` containing an orange box and an
   `<ambientLight />`. Remove the light and see what happens to the box.
2. Add `<OrbitControls />` from drei and drag the view around.
3. Change `-Math.PI / 2` to `+Math.PI / 2` in the snippet above and work out where
   the building ends up. Hint: look at the sign of Y.

---

## 2026-11-06: Entry 2, loading the map and drawing it from above

Roadmap: Phase 1, Step 1 (inspect and load the GeoJSON), plus the coordinate
conversion.

### What I did

| File | Change |
| --- | --- |
| `src/world/worldUtils.ts` | New. Converts longitude/latitude to metres and to Three.js positions |
| `src/world/mapData.ts` | New. Loads the file once and sorts features into buildings, roads, footways and places |
| `src/world/DebugMap.tsx` | New. Draws everything as flat lines and dots |
| `src/world/World.tsx` | New. Loads the data and shows the debug map. This is where the real 3D world will go |
| `src/App.tsx` | Replaced the Vite starter page with a full-screen `<Canvas>` and the OpenStreetMap credit |
| `src/index.css` | Replaced the starter styles so the canvas fills the window |
| `src/world.tsx` | Deleted. It was empty, and the brief's structure uses `src/world/World.tsx` |

`src/App.css` and the images in `src/assets/` are now unused. I left them in place
because there's no git history to restore them from.

### Why

- **A flat map before any 3D.** If the conversion were wrong, the street grid would
  look bent or squashed here. Finding that out after building roads and a scooter
  on top would be far harder to diagnose.
- **Footways are separate from roads.** 63 lines are `footway` or `path`. Keeping
  them apart now means the scooter's road network won't include them later.
- **The world origin is a fixed constant.** If it were calculated from the data, a
  new export would move every coordinate in the game without warning.
- **The credit is on screen from day one.** The ODbL licence requires it, so it
  shouldn't depend on someone remembering at the end.
- **No new dependencies.** The GeoJSON types are hand-written and cover only what
  this file contains.

### What I checked

| Check | Result |
| --- | --- |
| File served by Vite | Yes: HTTP 200, 1,592,099 bytes |
| Coordinates are lon/lat | Yes: no custom `crs`, and the values fall in Bengaluru |
| Polygon rings closed | All of them |
| Roads connected | 312 of 319 share one network, joined by exact shared points |
| Conversion accuracy | About 0.11% against the haversine formula, or 2.5 m over 2.2 km |
| Directions | North goes to -Z, east to +X |
| Type check and lint | Pass |
| Browser | Renders with no errors, and the grid looks square |

The browser check used headless Chrome, because the Chrome extension wasn't
connected. That screenshot has a blank band along the bottom, which comes from
headless mode: a plain test page reported a 913 px viewport in a 1000 px image. I
haven't seen it in a normal Chrome window, so check that yours fills the window.

### Correction to Entry 1

Entry 1 gave the area as about 2.8 km by 3.4 km. That is only the bounding box, and
long roads stretch it. The map shows the buildings sit in a narrow strip: 98% of them
fall within about **460 m east to west and 1.8 km north to south**. This helps us,
because the strip is already about the width of the 400–500 m playable area. It also
means `WORLD_ORIGIN` sits on the strip's eastern edge, so we should move it to the
centre of the playable area when we pick one.

### Lesson 3: BufferGeometry, or how the GPU sees shapes

The GPU doesn't know about buildings or roads. It reads long flat lists of numbers:

```ts
//                     point 1      point 2
new Float32Array([ 0, 0, 0,     10, 0, 0, /* and so on */ ])
```

`BufferGeometry` holds those lists, and each list is an **attribute**. `position` is
the main one, and later we'll add others. `bufferAttribute` needs `args={[positions, 3]}`
because the array has no structure of its own, so the `3` says every three numbers
make one point.

```tsx
<lineSegments>
  <bufferGeometry>
    <bufferAttribute attach="attributes-position" args={[positions, 3]} />
  </bufferGeometry>
  <lineBasicMaterial color={color} />
</lineSegments>
```

`attach` tells R3F where to put the object on its parent, here
`geometry.attributes.position`. This is a key R3F idea: nesting usually means
"add as a child", and `attach` means "assign to this property".

**This is the fix for the problem from Entry 1.** All 1,654 building outlines are in
one array, so they make one object and one draw call. The whole map is just four
objects. Drawing each building separately would need 1,654.

`lineSegments` reads points in pairs, which is why `toSegmentPositions` stores the
middle points of a line twice. For a line A-B-C it stores A, B, B, C. Plain `line`
would connect everything into one continuous stroke, joining each building to the
next.

### Lesson 4: loading data in R3F

```tsx
export function World() {
  const data = use(loadMapData())
  return <DebugMap data={data} />
}
```

`use()` is the React 19 hook for reading a promise. While the promise is pending,
React pauses the component and the nearest `<Suspense>` takes over. That works inside
`<Canvas>` too, because R3F is a React renderer.

The important detail is in `loadMapData`, which always returns **the same** promise.
A new promise on each render would make React wait again, and again, forever. So
`mapData ??= fetchMapData()` creates it once.

`useMemo` on the position arrays has a similar purpose. Without it, every render would
redo the conversion and create a new array, and a new array means uploading it to the
GPU again.

### Lesson 5: two kinds of camera

- **PerspectiveCamera**: distant things look smaller, like real eyes. The game will
  use this one.
- **OrthographicCamera**: no shrinking with distance, like a blueprint. That's why
  it suits this debug map: distances on screen are true to the map.

With `orthographic` on `<Canvas>`, `zoom` means pixels per world unit, so `0.25` is
one pixel for every 4 metres. `MapControls` from drei adds drag-to-pan and scroll to
zoom. I turned rotation off because this is a flat map.

### Try it

1. Open `http://localhost:5173/`, then drag and scroll around. Find the large empty
   block in the top half of the strip. That's Kaveri Park, which is blank because
   this map only draws buildings, roads and places.
2. Open the browser console and find the `[map] loaded` line. It should say 1654
   buildings, 256 roads, 63 footways and 190 places.
3. In `worldUtils.ts`, temporarily change `LON_SCALE` to `1` and save. The map gets
   slightly wider. At this latitude that's only about 2.6%, which is why the error
   is easy to miss.
4. In `DebugMap.tsx`, change `<lineSegments>` to `<line>` (and the closing tag) to see
   the "joined together" problem from Lesson 3. Your editor may flag `<line>`, because
   the name clashes with the SVG element, but it still runs. Change it back afterwards.

### Next

Choose the compact playable section: a 400–500 m piece of the strip with good road
connections, then move `WORLD_ORIGIN` to its centre.

---

## 2026-11-06: Entry 3, git and the playable area

Roadmap: the "compact playable section" from the brief.

### What I did

- Ran `git init` on branch `main`. Nothing is committed yet.
- Scored every possible 450 m square across the map and picked the best one.
- Moved `WORLD_ORIGIN` to the centre of that square, in `src/world/worldUtils.ts`.
- Added `PLAY_AREA_SIZE = 450`, drew the boundary in yellow on the debug map, and
  zoomed the camera in on it (`zoom: 1.6` in `src/App.tsx`).

### Why this square

I tested a square every 25 m in both directions. I counted only drivable roads, and
ignored any square where under 90% of the road length was connected. For a driving
game, I weighted **loops** most heavily, then intersections, then buildings, places
and road length.

Three of the best non-overlapping squares, with the winner's numbers at its final
centre:

| | Winner: central strip | South of it | North of it |
| --- | --- | --- | --- |
| Loops | **30** | 25 | 20 |
| Intersections | **57** | 52 | 43 |
| Road length | **5.6 km** | 5.3 km | 5.3 km |
| Roads in one connected network | **100%** | 99% | 98% |
| Buildings | 506 | 574 | 480 |
| Shops and amenities | 71 | 50 | 79 |
| Clothing shops mapped | 9 | 1 | 6 (fashion, including footwear) |

The winner has more loops, more intersections and a fully connected network, so
nowhere in it is cut off. It also has 9 mapped clothing shops, which suits a fashion
delivery game.

The 450 m size sits in the middle of the brief's 400–500 m target. The rest of the
data stays in the file for later expansion.

**Real shops:** the OpenStreetMap points include real shop and brand names. We should
use those spots as *locations* for pickups and deliveries, but show fictional names
in the game. That follows the brief's rule about not implying endorsement.

### Lesson 6: why the origin belongs at the centre of the action

Three.js positions end up as 32-bit floats on the GPU, which have about seven
significant digits. Near zero you get very fine precision. Far from zero the gaps
between possible values grow, and at large distances things visibly shake.

| Distance from origin | Smallest step in a 32-bit float |
| --- | --- |
| 100 m | About 0.008 mm |
| 10 km | About 1 mm |
| 1,000 km | About 6 cm |

At our scale, moving the origin 200 m wouldn't cause any visible difference. It's
still worth doing: when the scooter starts near (0, 0, 0), debugging is easier,
because a position like `(12, 0, -40)` immediately tells you where you are.

### Lesson 7: treating roads as a graph

To a game, a road network is a **graph**. Each point is a vertex and each road piece
between two points is an edge. One formula counts the independent loops:

```text
loops = edges - vertices + connected groups
```

A plain tree of dead-end streets scores 0. Each extra connection adds one loop, and
that is what lets a player choose between routes. It's why I weighted loops highest:
with 30 of them, a delivery has real route decisions and the "route efficiency"
measure in the brief means something.

### Lesson 8: `lineLoop`

Three line objects read the same kind of array in different ways:

| Object | How it connects points |
| --- | --- |
| `lineSegments` | In separate pairs: A-B, C-D |
| `line` | One stroke: A-B-C-D |
| `lineLoop` | One stroke, then back to the start: A-B-C-D-A |

The boundary is a closed square, so `lineLoop` only needs its four corners.

### Open issue

The boundary cuts through some roads and buildings. We'll need to decide how the
edge of the world behaves. My suggestion is to keep buildings by their centre point,
clip roads at the edge, and stop the scooter at an invisible barrier.

### Try it

1. Open the map. It now starts zoomed in, with the yellow square around the play area.
2. Change `PLAY_AREA_SIZE` to `500` and save, to see the upper end of the brief's range.
3. Pick any two blue dots and trace two different routes between them. That's the
   choice the loops give the player.

### Next

Generate the first real 3D buildings inside the square, with a ground plane and
lighting. We'll also need a rule for heights, since nearly all buildings have none.

---

## 2026-11-06: Entry 4, the first 3D neighbourhood

Roadmap: Phase 1, generating buildings, ground and lighting. The first commit,
`d9fcd89`, holds everything before this entry.

### What I did

| File | Change |
| --- | --- |
| `src/world/Buildings.tsx` | New. Turns OSM footprints into one merged 3D mesh |
| `src/world/Ground.tsx` | New. A large flat ground plane |
| `src/world/Lighting.tsx` | New. Sky light, sun and shadows |
| `src/world/worldUtils.ts` | Added `isInsidePlayArea` |
| `src/world/World.tsx` | Now puts lighting, ground, buildings and guide lines together |
| `src/world/DebugMap.tsx` | Dropped the building outlines and kept roads, places and the boundary as guides |
| `src/App.tsx` | Switched to a perspective camera, with shadows, fog and orbit controls |

The result is 509 buildings in 6,572 triangles, all in one mesh.

### Why

- **Merged into one mesh.** Entry 1 asked whether to merge, and the answer turned out
  to be easy: the buildings never move, so nothing is lost by combining them.
  One mesh also means the whole city shares a single material.
- **Keep a building if its centre is inside the square.** This is the rule I suggested
  in Entry 3. Buildings stay whole, rather than being sliced along the boundary.
- **Heights.** Only 9 of the 509 buildings have a mapped floor count. Those 9 range
  from 1 to 5 floors, so the estimates stay in that range:

  | Footprint | Floors |
  | --- | --- |
  | Mapped in OSM | Use the real value |
  | Under 60 m² | 1 to 2 |
  | 60 to 400 m² | 2 to 4 |
  | Over 400 m² | 3 to 5 |

  Each floor is 3.2 m. These are estimates to look plausible, not real heights.
- **Fog.** It hides where the ground and camera range end, which would otherwise be a
  hard edge on the horizon.
- **Roads are still thin guide lines.** They come next, so they aren't real surfaces
  yet, and from street level they're nearly invisible.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Browser console | No errors |
| Walls and roofs | Solid from outside, with no missing or inside-out faces |
| Shadows | Present and attached to the buildings, with no speckling on walls |
| View from a real road at 1.6 m eye height | Reads as a street, and building scale looks right |

**Not checked: frame rate.** My headless browser renders on the CPU, so its speed says
nothing about your Mac. See "Try it" below for how to look.

### Lesson 9: from outline to solid

`createBuildingGeometry` follows the recipe from Lesson 2, with one addition. Real
footprints can have holes, like a courtyard, and `THREE.Shape` supports that through
`shape.holes`. None of the 509 buildings here has one, but two elsewhere on the map do,
so the code will be ready when the world expands.

GeoJSON repeats a ring's first point at the end, while Three.js closes shapes itself.
That's why `toRing` drops the last point.

### Lesson 10: merging, and colour on the geometry

```ts
const parts = buildings.map(createBuildingGeometry)
const city = mergeGeometries(parts)
```

`mergeGeometries` joins many BufferGeometries into one, which is the same trick as
Lesson 3 but for solid shapes. There's a catch. A mesh has one material, so how can
each building have its own colour?

The answer is to store colour **per corner**, as another attribute next to `position`:

```ts
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
```

Then one prop tells the material to use it:

```tsx
<meshStandardMaterial vertexColors roughness={0.9} />
```

`mergeGeometries` requires every part to have the same attributes. That's why each
building gets `color`, and each loses `uv` (texture coordinates, which we don't need
yet).

### Lesson 11: light and shadows

`meshStandardMaterial` reacts to light, so with no lights it's black. We use two:

- **HemisphereLight**: soft fill from all around, so shaded walls aren't pure black
- **DirectionalLight**: the sun. Its rays are parallel, so its `position` only sets
  the direction

Shadows need **four** switches, and missing any one gives no shadow and no error:

```tsx
<Canvas shadows>                       {/* 1. turn shadows on */}
<directionalLight castShadow />        {/* 2. this light makes shadows */}
<mesh castShadow receiveShadow />      {/* 3. buildings cast them, and 4. receive them */}
<mesh receiveShadow />                 {/* the ground receives them too */}
```

How they work: the light renders the scene from its own point of view into a texture,
the **shadow map**, which records what it can see. Any point it can't see is in shadow.

That view is a camera too, and its box is set by `shadow-camera-left` and friends.
This is a trade-off: a texture of 4096 pixels stretched over our 640 m box gives
about 16 cm per pixel. A bigger box covers more ground with blurrier shadows.

`shadow-mapSize` and `shadow-camera-left` are **dash props**. R3F reads them as nested
paths, so `shadow-mapSize` sets `light.shadow.mapSize`. It's the same idea as `attach`.

### Lesson 12: stable randomness

If heights came from `Math.random()`, the city would change on every reload, and a
collision or a mission marker could end up inside a different-sized building. So
`hashString` turns each building's OSM id into a number, and the same id always gives
the same height and colour.

Games use this constantly. It's called **deterministic** or seeded generation.

### One thing you might notice

The console prints `[buildings] built` **twice** in development. That's React
`StrictMode`, which deliberately runs `useMemo` twice in dev to catch impure code. It
doesn't happen in production.

The `useEffect` that calls `geometry.dispose()` is there because GPU memory isn't
garbage collected. R3F cleans up what it creates from JSX, but we made this geometry
ourselves, so we clean it up ourselves.

### Try it

1. Drag to orbit, scroll to zoom, right-drag to pan. Get down between the buildings.
2. Check your frame rate: in Chrome DevTools, press Cmd+Shift+P and run
   "Show frame rendering stats". Tell me the FPS, especially at street level.
3. In `Lighting.tsx`, change the sun's `position` to `[-180, 80, 120]` for a late
   evening look, with long shadows.
4. In `Buildings.tsx`, remove `castShadow` from the mesh and see the shadows vanish.
5. Change `FLOOR_HEIGHT` to `6` to see how much height affects the feel of a street.

### Next

Generate real road surfaces from the OSM lines, using `lanes` and road type for width.
That also replaces the thin guide lines.

---

## 2026-11-06: Entry 5, real road surfaces

Roadmap: Phase 1, generating roads. Commit `d6ef20b` holds everything before this
entry.

### What I did

| File | Change |
| --- | --- |
| `src/world/Roads.tsx` | New. Builds all road surfaces into one flat mesh |
| `src/world/World.tsx` | Added `<Roads />` |
| `src/world/DebugMap.tsx` | Removed the road guide lines, which the surfaces replace |

The result is 1,776 triangles, with 123 joints at bends and junctions. Roads stop at
the play area boundary.

### Why

**Widths come from measurement.** OSM has no width data for these roads, so I measured
the distance from each road's centre to the nearest building, every 3 m or so:

| Road type | Closest 1% | Closest 5% | Typical (median) | Width chosen |
| --- | --- | --- | --- | --- |
| Residential | 1.2 m | 2.0 m | 5.2 m | 5 m |
| Service | 2.9 m | 3.2 m | 10.1 m | 4 m |
| Tertiary, 2 lanes | 4.5 m | 5.6 m | 9.5 m | 7 m |
| Tertiary, 4 lanes | 10.4 m | 10.6 m | 12.1 m | 14 m |

These are distances from the centre, so a 5 m road reaches 2.5 m out. When OSM has a
`lanes` tag, the width is lanes × 3.5 m.

I had expected residential roads to be 6–7 m. At that width they'd run under many more
buildings, so the measurement changed the decision.

**Asphalt is lighter than real asphalt.** My first colour, `#47484c`, made shadows on
the road nearly black. Switching to `#6a6b6f` fixed it. Very dark surfaces leave little
room for shadow detail, but I didn't isolate the exact cause.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Browser console | No errors |
| Network | Connected, with clean bends and junctions |
| View from above | No flicker between road and ground in the screenshots |
| View from a real road at 1.6 m | Reads as a road |
| Tertiary and service roads | No buildings within the road's width |
| Residential roads | **8% of their length is not fully clear (see below)** |

Screenshots can't show flicker that only appears while the camera moves, so please
look for that as you orbit around.

### Known issue: buildings close to residential roads

Along 515 m of residential road (11% of residential, 8% of all road), a building
stands within the 5 m width. The closest is 0.86 m from the centre, and 114 m of road
has a building within 1.5 m.

Visually this is minor, because the wall simply covers the road's edge. It will matter
for collisions, since a scooter could clip a corner on those stretches. Some of it may
be inaccuracy in the mapped footprints or road lines. I'm leaving the data alone until
we can feel it while riding.

### Lesson 13: building a mesh by hand

Until now, Three.js made our triangles. `Roads.tsx` makes them itself, and that's less
mysterious than it sounds. A road piece is a rectangle, so two triangles:

```text
startLeft ------- endLeft
    |  \             |
    |      \         |
startRight ------ endRight
```

To find the corners we need the road's sideways direction. Turning a direction
`(x, z)` by 90 degrees gives `(z, -x)`, which is all `sideX` and `sideZ` do.

Rectangles alone leave wedge-shaped gaps at bends, so `pushJoint` puts a flat circle
at every point, the way a round brush stroke has no gaps at its corners. At a junction,
the circles and rectangles simply overlap. Because they're the same colour at the same
height, you can't see the seams.

### Lesson 14: which way a triangle faces

A triangle has two sides, and by default Three.js draws only the **front**, to save
work. This is called **back-face culling**. The front is decided by the order of the
corners: anticlockwise as seen from the viewer.

That's what the `facesUp` check in `pushTriangle` handles. It uses a cross product to
see which way the triangle would face, and swaps two corners if it's upside down.
Get this wrong and the road is invisible from above, with no error.

A **normal** is a separate thing. It's the direction a surface points *for lighting*.
Three.js's built-in shapes come with normals. Ours has none until we add them, and
without them lighting doesn't work. Roads are flat, so every normal is `(0, 1, 0)`.

### Lesson 15: z-fighting

When two surfaces are at nearly the same depth, the GPU can't reliably tell which is
in front, and they flicker in a striped pattern. That's **z-fighting**. Depth precision
is also worse far from the camera. We use three defences:

- The road sits 5 cm above the ground (`ROAD_HEIGHT`).
- `polygonOffset` nudges the road's depth toward the camera, without moving it.
- `near: 1` on the camera. Depth precision depends heavily on this value, and a tiny
  `near` wastes much of it on the space right in front of the camera.

### Lesson 16: clipping a line to a box

`clipToPlayArea` is the Liang-Barsky algorithm, a classic from graphics. Think of a
road piece as running from 0 (start) to 1 (end). Each of the four box edges can only
push the "enter" point later or the "leave" point earlier. If enter passes leave, the
piece never touches the box.

### Try it

1. Orbit around, including low to the road, and look for flickering.
2. In `Roads.tsx`, set `residential` to `8` and see roads push under buildings.
3. Remove the `pushJoint` loop (the `joints.forEach` line) and look at the bends.
4. In `pushTriangle`, change `facesUp ? [a, b, c] : [a, c, b]` to the opposite order.
   The road disappears from above, and that's back-face culling.
5. Set `ROAD_HEIGHT` to `0`, and remove the three `polygonOffset` props, to see real
   z-fighting.

### Next

Add the scooter and controls, following the brief's recommended order. Sidewalks and
landmarks aren't on the weekend MVP list, so they can wait.

---

## 2026-11-06: Entry 6, the scooter rides

Roadmap: Phases 2 and 3 (basic version), plus the follow camera from Phase 4. Commit
`70e4740` holds everything before this entry.

**This reaches the first major milestone: a player-controlled scooter riding through
a 3D neighbourhood generated from real HSR Layout data.**

### What I did

| File | Change |
| --- | --- |
| `src/vehicle/vehicleConfig.ts` | New. Every handling number, in one place |
| `src/vehicle/ScooterController.ts` | New. The handling, as plain TypeScript with no 3D code |
| `src/vehicle/useDriveInput.ts` | New. Tracks which keys are held |
| `src/vehicle/Scooter.tsx` | New. The procedural model, updated every frame |
| `src/camera/FollowCamera.tsx` | New. Third-person camera |
| `src/vehicle/Player.tsx` | New. Connects the scooter and the camera |
| `src/App.tsx` | Removed orbit controls and added the player and a controls hint |

| Handling | Value |
| --- | --- |
| Top speed | 14 m/s (about 50 km/h) |
| 0 to top speed | 2.8 s |
| Stopping from top speed | 8.8 m braking, 6.4 m with the handbrake |
| Reverse | 3 m/s |

### Why

- **The handling knows nothing about 3D.** `ScooterController.ts` takes numbers and
  returns numbers, so I could test it without a browser. It also keeps the door open
  for the game-state work in Phase 7.
- **A follow camera now.** You asked for controls, but you can't ride without one.
- **The world-edge barrier from Entry 3 is in**, since it's only a few lines.
- **No Zustand yet.** Nothing outside the scooter needs its state. It'll come with the
  HUD, which needs to read the speed.
- **No rider yet.** The roadmap marks it "if time permits".
- **The box is plain.** No logos or branding, as the brief requires.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| 13 handling checks in Node | All pass |
| Same ride at 30, 60 and 144 FPS | Ends within 0.11 m |
| Real key presses in headless Chrome | W accelerates, A and D turn correctly, Space stops, S untested in the browser |
| Browser errors during the rides | None |

The Node checks were throwaway scripts, so they aren't in the repo. We have no test
framework yet.

**Not checked: how it feels.** My test browser ran at about 25 FPS on the CPU, and I
can't judge feel from screenshots. All the numbers in `vehicleConfig.ts` are first
guesses.

### Problems I found by riding

**The sun's shadow looked terrible on the scooter.** At 16 cm per pixel, a 2 m object
becomes a smear. I replaced it with a fake soft shadow (see Lesson 21). My first
version, a plain disc, had a hard edge and looked worse.

One screenshot of that first version, taken mid-turn, didn't show the disc at all. I
couldn't reproduce it. The soft version appears in the shots taken moving straight and
turning, but I never found out why that frame differed, so keep an eye out.

### Known issues

- **There is no building collision.** You can ride through walls, and the camera can
  end up inside a building. This is the biggest gap and should be next.
- **The camera can still clip into walls** on narrow streets, even after collision
  works, since it sits 5.2 m behind the scooter.
- **The bird's-eye orbit view is gone**, replaced by the follow camera.
- **The blue place dots float in the air.** They're debug markers, and will go when
  real mission markers arrive.

### Lesson 17: the game loop, and why not `useState`

React is built for things that change now and then. A game changes 60 times a second.

```tsx
useFrame((_, delta) => {
  stepScooter(state, input.current, Math.min(delta, MAX_FRAME_TIME))
  ref.current.position.set(state.x, 0, state.z)
})
```

`useFrame` runs once per frame, *outside* React's rendering. If position lived in
`useState`, React would re-render the component tree 60 times a second for no benefit.
So the rule in R3F is:

- **Rendered once, changes rarely:** props and state, the normal React way
- **Changes every frame:** refs, changed directly inside `useFrame`

The same applies to `useDriveInput`, where a key press writes to a ref and the loop
reads it. React never hears about it.

`stepScooter` also updates its object in place rather than returning a new one.
Creating objects 60 times a second gives the garbage collector work, and that can show
up as stutter.

### Lesson 18: delta time

`delta` is the number of seconds since the last frame. Everything that moves is
multiplied by it:

```ts
state.x += Math.sin(state.heading) * state.speed * dt
```

Without it, a 120 Hz screen would run the game twice as fast as a 60 Hz one. With it,
the scooter covers the same ground either way, which is what the 30/60/144 FPS check
confirmed.

`MAX_FRAME_TIME` handles the other extreme. If the tab is hidden for 10 seconds, the
next `delta` is huge, and the scooter would teleport through the world.

### Lesson 19: direction from an angle

One number, `heading`, gives the direction of travel:

```ts
forwardX = Math.sin(heading)
forwardZ = Math.cos(heading)
```

At heading 0 that's `(0, 1)`, which is +Z, the way the model faces. This pair of numbers
always has length 1, so multiplying by speed gives the movement directly. The camera
uses the same two numbers to find the spot behind the scooter.

### Lesson 20: nested groups are the scene graph

A child inherits its parent's movement. The scooter's nesting is built around that:

```text
group          position and heading (the whole scooter)
├─ BlobShadow  stays flat on the road
└─ group       lean (tilts everything inside)
   ├─ body, rear wheel
   └─ group    steering (turns only the front)
      ├─ handlebars
      └─ front wheel   spins on its own axis
```

The front wheel spins, turns with the bars, leans, and travels with the scooter, yet
its code only sets its spin. This is the **scene graph**, and it's one of the most
useful ideas in 3D. Notice that the shadow sits outside the lean group, because a
shadow shouldn't tilt.

### Lesson 21: faking it

Games are full of cheats that look right. The blob shadow is a flat rectangle with a
gradient image drawn on a `<canvas>`:

```tsx
<meshBasicMaterial map={texture} transparent depthWrite={false} />
```

- `meshBasicMaterial` ignores light, so it costs almost nothing.
- `map` paints the texture onto the surface, and `transparent` makes its see-through
  parts work.
- `depthWrite={false}` stops this invisible-edged shape from blocking things drawn
  after it.

### Lesson 22: smooth following

The camera eases toward the scooter's heading:

```ts
const heading = previous + (target - previous) * (1 - Math.exp(-TURN_RESPONSE * delta))
```

Each frame it closes a fraction of the remaining gap, so it moves fast when far behind
and settles gently. The `Math.exp` part makes that fraction depend on time rather than
on frame count. A plain `previous + gap * 0.1` would feel tighter on faster screens.

It also makes turns feel better: the scooter swings first and the camera catches up,
so you can see it turning.

### Try it

1. Click the page, then ride with WASD or the arrow keys. Space is the handbrake.
2. Tell me how it feels: too fast, too twitchy, too slow to stop? Try changing
   `maxSpeed`, `turnRateLow` and `turnRateHigh` in `vehicleConfig.ts`, then save. If a
   change doesn't seem to apply, refresh the page.
3. Remove `Math.min(delta, MAX_FRAME_TIME)`, ride, switch tabs for 10 seconds and come
   back. Then put it back.
4. Move `<BlobShadow />` inside the lean group and watch the shadow tilt in corners.
5. In `FollowCamera.tsx`, set `TURN_RESPONSE` to `1`, then `20`. Find what feels best.

### Next

Building collision, so the walls are solid. It uses the same footprints we extruded,
and it's where the narrow residential stretches from Entry 5 will show up. Then come
the pickup, the destination and the first mission.

---

## 2026-11-06: Entry 7, solid walls

Roadmap: Phase 3, collision detection. Commit `08eafc5` holds everything before this
entry.

### What I did

| File | Change |
| --- | --- |
| `src/world/collision.ts` | New. Sorts building footprints into a grid, pushes the scooter out of walls, and checks whether a spot is clear |
| `src/vehicle/ScooterController.ts` | Now reacts to hits: head-on stops you, and a glancing hit turns you along the wall |
| `src/camera/FollowCamera.tsx` | Moves in closer when a building is behind the scooter |
| `src/vehicle/Player.tsx`, `Scooter.tsx` | Pass the collision data along |
| `src/world/World.tsx`, `src/App.tsx` | `<Player />` moved into `World`, because it now needs the map data |
| `src/world/worldUtils.ts`, `Roads.tsx`, `Buildings.tsx` | Shared helpers moved to one place, so buildings look and collide by the same rule |

### Why

- **Plain 2D collision, not a physics engine.** Buildings are straight walls, and the
  scooter stays on flat ground, so this is 2D. It needs no new dependency. Rapier
  remains an option if we ever need real physics.
- **The scooter counts as a 0.6 m circle.** A circle has no corners to snag on, so it
  slides around building edges. The trade-off is that the nose can overlap a wall by
  about 0.3 m in a head-on hit, because the scooter is longer than it is wide.
- **Glancing hits deflect you.** Only the part of your speed running into the wall is
  removed, and the scooter swings to run along it. That's the arcade feel the brief
  asks for. Hits within about 37° of straight-on count as head-on and stop you.
- **No score or damage.** Hits don't change anything except speed, for now. The brief
  says packages stay pristine, and hits may count toward a performance score later.
- **The camera fix came along too**, because the collision data made it about 30 lines,
  and walls blocking the view was a known issue from Entry 6.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Earlier handling checks | All still pass |
| Can every road be reached with solid walls? | **Yes: all 2,055 road sample points** |
| Random bot, 600,000 steps (nearly 3 hours at 60 FPS) | Never ended a step inside a wall, across 1,868 hard hits. **Weak test: see the correction in Entry 9** |
| Slowest allowed frame at top speed | Doesn't pass through a wall |
| Head-on hit, then reverse | Stops, and backs away |
| Browser ride, including S | Glanced off a wall and rode on, with S pressed afterwards, and no errors |
| Browser errors | None |

The reachability check flood-filled a 0.5 m grid with a 0.6 m scooter. So the tight
residential stretches from Entry 5 turned out not to block anything.

As before, these were throwaway scripts, so they aren't in the repo. **I still can't
judge how it feels**, and the camera's movement isn't covered by these checks beyond
the few screenshots.

The head-on stop was only tested in Node, because the browser ride hit its wall at a
glancing angle.

### A bug I found: walls were sticky

My first version only cut speed. A check failed, so I measured what happened when
holding W against a wall from top speed, and it was worse than the test showed. The
scooter kept pointing into the wall, so it lost speed again on every frame:

| Angle into wall | First version, after 0.5 s | Now, after 0.5 s | Now, after 3 s |
| --- | --- | --- | --- |
| 3° | 14.0 m/s | 14.0 m/s | 14.0 m/s |
| 10° | 10.9 m/s | 14.0 m/s | 14.0 m/s |
| 25° | **1.6 m/s** | 13.1 m/s | 14.0 m/s |
| 45° | **0.2 m/s** | 8.1 m/s | 14.0 m/s |

So a 25° brush took you from 50 km/h to walking pace, as if the wall were glue. At first
I wrote that off as a feature, then looked at the numbers again. The fix turns the
scooter along the wall, so you only pay the penalty once.

The tuning values are `headOnThreshold` and `wallDeflectRate` in `vehicleConfig.ts`.

### Lesson 23: broad phase and narrow phase

There are 509 buildings, averaging about 6 walls each. Checking all of them every frame
is wasteful, because nearly all of them are far away. Games split this into two steps:

- **Broad phase:** quickly rule out what can't possibly touch
- **Narrow phase:** do the careful maths on what's left

Our broad phase is a **spatial grid**. The map is divided into 20 m cells, and each cell
lists the buildings that touch it. To find what's nearby, we divide our position by 20
and look in that one list.

```ts
const nearby = world.get(cellKey(toCell(point.x), toCell(point.z)))
```

Building the grid takes about 3 ms, once. Each footprint is stored in every cell it
reaches, plus a 2 m margin, so one cell's list is enough.

### Lesson 24: the nearest point on a wall

The narrow phase needs one thing: the nearest point on a wall. A wall runs from A to B.
Project the scooter onto that line, then clamp the result to the wall's ends:

```ts
const along = ((x - ax) * edgeX + (z - az) * edgeZ) / lengthSquared
const clamped = Math.max(0, Math.min(1, along))
```

`along` is a **dot product**: it measures how far along the wall the scooter sits, from
0 at A to 1 at B. If the distance to that nearest point is less than the radius, we
overlap, and we push out by the difference.

### Lesson 25: the dot product

The dot product is the most useful tool in game maths. For two directions of length 1,
it says how much they agree: 1 means the same way, 0 means at right angles, and -1 means
opposite.

We use it again for hits. `towardWall` is the dot product of your travel direction and
the wall's facing direction:

| You are | `towardWall` | What happens |
| --- | --- | --- |
| Hitting head-on | 1 | Stop |
| Hitting at 45° | 0.71 | Keep 71% of speed and turn along the wall |
| Scraping at 10° | 0.17 | Keep 98% of speed and turn along the wall |
| Moving away | Negative | Nothing |

It also gives us the direction along the wall. Take your travel direction and remove
the part pointing into the wall, and what's left runs parallel to it:

```ts
const alongX = travelX + normalX * towardWall
const alongZ = travelZ + normalZ * towardWall
```

This trick is called **projection**, and you'll see it everywhere in game code.

### Lesson 26: inside or outside?

At top speed in a slow frame, the scooter moves 0.7 m, which is more than its radius, so
its centre can land *inside* a building. Then "move away from the nearest wall" would
push it deeper. This is the start of **tunnelling**, where fast objects skip through
thin walls.

So `measureFootprint` also does the classic **ray test**: walk in a straight line and
count the walls you cross. An odd number means you started inside. If you're inside,
we push the other way.

The speed limit and thick buildings keep us safe here. A bullet would need a more
advanced check.

### Lesson 27: flood fill

To answer "can the scooter reach every road?", I marked every spot on a grid as free or
blocked. Starting from the spawn point, I spread to neighbouring free spots until
nothing new was reached, the way the paint bucket works in a drawing app. Then I checked
that every road point had been reached.

We'll use the same thinking when we place pickups and deliveries, since a mission must
never target somewhere you can't reach.

### Try it

1. Ride into a wall head-on, then at a shallow angle, and compare. Tell me if the
   deflection feels natural or if it fights your steering.
2. Ride around a tight junction and watch the camera move in near the walls.
3. In `vehicleConfig.ts`, set `collisionRadius` to `2` and try the narrow streets. You
   should feel them close up. Then set it back.
4. In `handleCollisions`, change the `Math.sqrt(...)` line to `state.speed = 0`. Any
   touch now stops you dead, and you'll see why arcade games don't do that.

### Next

The delivery mission: a pickup, a destination, markers and rewards. That needs Zustand
for game state, which is also what the HUD will read.

---

## 2026-11-06: Entry 8, the first complete delivery

Roadmap: Phases 5 and 6 (basic versions) and the start of Phase 7. Commit `2ffb858`
holds everything before this entry.

**This completes all 14 weekend MVP items. You can now ride to a pickup, collect an
order, deliver it to a customer, and earn credits and XP.**

### What I did

| File | Change |
| --- | --- |
| `src/game/gameTypes.ts` | New. Shared mission types |
| `src/game/missionConfig.ts` | New. Locations, rewards and rules, in one place |
| `src/game/gameStore.ts` | New. The Zustand store: mission phase, credits, XP and HUD numbers |
| `src/missions/missionLogic.ts` | New. Mission rules, with no React or 3D code |
| `src/missions/MissionTracker.tsx` | New. Checks arrival every frame and feeds the HUD |
| `src/missions/MissionMarker.tsx` | New. The light beam, ring and pointer |
| `src/missions/TargetArrow.tsx` | New. A compass dart above the scooter |
| `src/ui/Hud.tsx` | New. Mission panel, wallet, speedometer and results card |
| `src/vehicle/Player.tsx`, `Scooter.tsx` | The scooter's state moved up to `Player`, so the mission code can read it |
| `src/world/DebugMap.tsx` | Removed the blue place dots, as promised in Entry 6 |

I also installed `zustand` 5.1. It's the first new dependency since the project began.

### The rules

| Rule | Value |
| --- | --- |
| Delivery reward | 50 credits and 25 XP, **always** |
| On-time bonus | +25 credits within 90 s, and nothing is lost if you miss it |
| Arriving | Be inside the ring, under 3 m/s (about 11 km/h) |
| Route | About 280 m to the pickup, then about 320 m to the customer |

### Why

- **Real spots, fictional names.** The pickup is on 21st Cross Road, about 10 m from a
  mapped clothing shop, but the game calls it "The Fashion Hub". The customer is on a
  residential street. Both are placeholders, and no real shop name appears. I chose
  them by computing routes around the buildings, so both are reachable by design.
- **Time can only add to your reward.** The brief says the base reward must not be
  reduced, so being late costs a bonus, never the base pay.
- **You have to slow down to arrive.** It gives braking a purpose, and "safe braking" is
  one of the brief's performance measures. Riding through at 50 km/h doesn't count.
- **An arrow, not a route line.** The dart points straight at the stop, so it can point
  across buildings. A line along the roads needs pathfinding, which isn't on the MVP.
- **Plain CSS, not Tailwind.** The brief lists Tailwind, but this HUD is small enough
  that adding it wouldn't help yet.
- **No hit penalty.** Hits don't affect score. The brief allows it later, and the
  package stays pristine either way.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| 12 mission rule checks | All pass, including base pay at any time up to 99,999 s |
| Bot riding the real route with the real handling | Finished in 50.5 s, with no hard hits |
| Earlier handling and collision checks | All still pass |
| Browser ride with real keys | Collected, delivered, got 75 credits and 25 XP, and "Next delivery" reset the game |
| Browser errors | None |
| `npm audit --omit=dev` | 0 vulnerabilities |

`npm audit` does report 10 moderate warnings in the full tree, and they come from
ESLint, a development tool, rather than anything shipped to players.

The browser ride moved both stops close to the spawn point, in memory only, so a short
ride could cover the whole flow. So the full route at its real locations was only
ridden by the Node bot.

**The 90 s limit is a guess.** The bot took 50.5 s, knows the route and never makes
mistakes. A person seeing the map for the first time may need much longer.

### Problems I found by looking

- **The arrow was a big kite** floating over the road. I squashed it into a slim dart.
- **The clock started when the page loaded**, so the player lost time before touching a
  key. It now starts when the scooter first moves.

### Known issues

- **Credits and XP vanish on refresh.** Saving them locally is Phase 7.
- **The dart ignores roads.** It can point straight at a wall.
- **The beam can be hidden** behind buildings until you're fairly close.
- **The results card covers part of the scooter**, and you can still ride behind it.
- **The yellow boundary and green footway lines** are still debug guides.

### Lesson 28: a state machine

A delivery is always in exactly one stage:

```text
toPickup  ->  toCustomer  ->  delivered  ->  (next delivery) toPickup
```

This is a **state machine**, and it's one of the most common patterns in games. A single
`phase` value is far safer than separate flags like `hasOrder` and `isDone`, because
those can end up in impossible combinations. `arriveAtStop` is the only way forward, and
it can't skip a stage.

### Lesson 29: Zustand

Zustand is a global store you can read from anywhere, in two different ways. That
difference is why it fits games so well.

**Inside React**, use the hook. The component re-renders when that value changes:

```tsx
const credits = useGameStore((state) => state.credits)
```

The function is a **selector**. Because it picks one value, this component ignores every
other change in the store, like speed updates.

**Outside React**, such as in the game loop, use `getState()`. It reads the current value
with no subscription and no re-render:

```tsx
useFrame(() => {
  const game = useGameStore.getState()
})
```

This solves the gap from Lesson 17, where game loop values live in refs, but the HUD is
React and needs to see them.

### Lesson 30: two speeds, one bridge

The game runs 60 times a second, but people can't read a number that fast, and React
shouldn't re-render that often. So `MissionTracker` copies values to the store only every
0.1 s:

```ts
sinceTelemetry.current += frameTime
if (sinceTelemetry.current >= TELEMETRY_INTERVAL) {
  game.setTelemetry({ /* ... */ })
}
```

This is **throttling**. Rounding helps too, because a selector only triggers a re-render
when its value really changes, so a speed sitting at `50` costs nothing.

### Lesson 31: components that draw nothing

`MissionTracker` returns `null`. In R3F, a component is just a way to attach behaviour
to the scene's lifecycle. It doesn't have to draw anything, and `FollowCamera` works the
same way. Each piece of behaviour gets its own small component, with its own `useFrame`.

### Lesson 32: seeing the marker from far away

Three small settings make the beam work:

- `fog={false}` keeps its colour at a distance, where fog would otherwise fade it.
- `side={DoubleSide}` draws the inside of the cylinder as well, so it still shows when
  you're standing in it.
- `depthWrite={false}` stops the see-through beam from hiding things behind it.

The open-ended cylinder comes from the `true` in its `args`.

### Try it

1. Do a full delivery, and tell me your time. It's the best evidence for the 90 s limit.
2. Ride through the ring at full speed, and watch the HUD ask you to slow down.
3. In `missionConfig.ts`, set `onTimeSeconds` to `20`. Finish late and check the base
   reward is still paid.
4. Open React DevTools, enable "Highlight updates", and ride. The speedometer flashes,
   but the wallet doesn't. That's selectors at work.
5. In `missionConfig.ts`, move `customer` somewhere else. Pick a spot from a road and
   watch the beam move. A spot inside a building would still count as arrival, once
   you're close enough.

### Next

The weekend goal is met, so the priority now depends on your feedback from playing.
After that, the likely order is saving progress, a title screen and a results polish,
then making the world look less like boxes.

---

## 2026-11-06: Entry 9, momentum, drifting and a minimap

Your feedback: deliveries work, nothing flickers, and riding could be better, with
drifting and a minimap. The mission work from Entry 8 isn't committed yet, so this
sits on top of it.

### What I did

| File | Change |
| --- | --- |
| `src/vehicle/ScooterController.ts` | Rewritten around real momentum, with grip, drifting and boosts |
| `src/vehicle/vehicleConfig.ts` | New handling values, and every drift setting |
| `src/vehicle/SkidMarks.tsx` | New. Black streaks from the rear wheel |
| `src/ui/Minimap.tsx` | New. A round map that turns with you |
| `src/game/livePlayer.ts` | New. Shares the scooter's position with the minimap |
| `src/world/roadData.ts` | New. Road widths, shared by the road mesh and the minimap |
| `src/camera/FollowCamera.tsx` | Follows your slide, and widens the view with speed |
| `src/ui/Hud.tsx`, `src/missions/MissionTracker.tsx` | Drift and boost badges. Speed now means true speed in any direction |

### How to drift

Get above about 22 km/h, then hold **Space** and steer. Keep **W** held to hold your speed.
Steer the other way to catch the slide. Slide for 0.7 s or more and let go of Space for a
boost.

| Handling | Before | Now |
| --- | --- | --- |
| Top speed | 50 km/h | 50 km/h, or 61 km/h on a boost |
| 0 to 25 km/h | 1.4 s | 1.15 s, because power now fades near the top |
| Space, in a straight line | Stops in 6.4 m | Stops in 13.9 m, because it's now for sliding |
| S, from top speed | Stops in 8.8 m | The same |
| Corners | On rails | Up to about 4° of natural slide |
| A 1.2 s drift | Not possible | Slides up to 27°, turns 66°, keeps 50 km/h |

**Space is now worse at stopping.** Use S to stop for pickups and deliveries.

### Why

- **The old scooter couldn't slide at all.** It always moved exactly where it pointed,
  so no tuning could produce a drift. Pointing and travelling had to become two things.
- **The minimap turns with you.** Up is always ahead, so left on the map means left on
  your keyboard. A fixed north-up map makes you work that out while riding.
- **The boost is a reward**, so a drift is worth doing rather than only looking good.
  Letting go is what earns it, and a short tap earns nothing.
- **It uses a pre-drawn image.** The minimap draws the whole area once, then only rotates
  that picture each frame.

### Problems the tests caught

- **The first drift was uncontrollable.** 1.2 s of drifting spun the scooter 103°, killed
  its speed and ended the drift, so no boost could ever be earned. I capped how far it
  can rotate past its direction of travel at about 52°. Counter-steering is never capped.
  Holding W in a drift now feeds the slide back into forward speed.
- **Corners made you faster**: 15.7 m/s, over the 14 m/s limit. Recovering speed from a
  slide was adding free energy, so it's now capped at the speed limit.

### Correction: my bot test was much weaker than I said

In Entries 7 and 8, I reported a random bot riding for nearly 3 hours without ending up
in a wall. When I checked what it was really doing, **it had visited only 33 of about
2,025 map cells and never drifted.** It was stuck near the start the whole time, so that
result said very little. My random inputs changed too often to get anywhere, and I had
never measured coverage.

The replacement rides toward random road points at speed, and drifts at random. It took
several attempts to get right, and three of those runs were flawed by my own bot logic.
They looked like game bugs until I tested them. At each stuck spot, W drove straight
out, so the bot was at fault rather than the game.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| 22 handling checks, including drifting | All pass |
| 14 mission checks, on the new physics | All pass |
| Mission bot on the real route | 49.6 s, with 1 hard hit |
| Touring bot, 333 minutes of riding | 891 cells, 147 destinations, 157 boosts, 4,392 hard hits |
| Steps inside a wall on that tour | **0** |
| Spots where all six control combinations failed to move it | **0** |
| Every road still reachable | Yes, 2,055 of 2,055 |
| Same ride, with a drift, at 30, 60 and 144 FPS | Ends within 0.19 m |
| Real keys in headless Chrome | Rode, drifted, boosted, with no errors |
| Minimap direction | Correct: the pickup is east, which is your left at the start, and it shows there |

The 891 cells is less than half the map, partly because many cells are inside buildings,
and partly because of the 40 destinations the bot used. So it's strong evidence rather
than proof.

**How the drift feels is still your call.** The numbers show that it works, not that
it's fun. All of it is adjustable in `vehicleConfig.ts`.

### Known issues

- **The bonus time needs a new look.** The boost makes you faster, and you've now played
  it, so tell me your time.
- **A minimap target can be behind buildings.** It shows direction, not the road route.
- **Skid marks also appear on grass.** They're drawn at a fixed height on any surface.
- **Earlier issues remain:** credits and XP reset on refresh, and the yellow boundary
  and green footway lines are still debug guides.

### Lesson 33: velocity is not direction

This is the most important idea in vehicle handling. The scooter now has two separate
things:

- `heading`: where it **points**
- `velocityX`, `velocityZ`: where it's actually **going**

When you turn, `heading` changes, but momentum carries on the old way. The difference
is the slide. Every frame we split velocity into two parts, using dot products from
Lesson 25:

```ts
const speed = velocityX * forwardX + velocityZ * forwardZ // along the scooter
const slip = velocityX * sideX + velocityZ * sideZ // sideways
```

The engine and brakes act on `speed`. Tyres act on `slip`:

```ts
const nextSlip = slip * Math.exp(-state.grip * dt)
```

### Lesson 34: grip is one number

That one line is the whole drift. With `grip: 12`, a slide vanishes in a fraction of a
second, so you feel planted. With `driftGrip: 1.4`, it lasts a second or more, so you
slide. The handbrake only changes that number, and everything else follows from it.

`Math.exp` is here for the same reason as in Lesson 22: it makes the fade depend on time
and not on frame rate. That's why the drift ride matched at 30, 60 and 144 FPS.

### Lesson 35: when arcade beats realism

Real drifting loses speed fast, and a real scooter that slid like this would fall over.
So we cheat in ways that feel right:

- `powerSlideRecovery` turns slide into forward speed, so W keeps the drift alive.
- `maxDriftAngle` stops you spinning out, however long you hold the steering.
- `driftTurnBoost` lets you turn sharper while sliding.

Good handling is rarely accurate. It's about making the player feel skilled.

### Lesson 36: a 2D canvas alongside 3D

The minimap isn't Three.js at all. It's a plain `<canvas>` using the browser's 2D drawing
tools, sitting on top of the 3D view. Not everything in a 3D game needs to be 3D.

It runs its own `requestAnimationFrame` loop, because it's outside `<Canvas>`, so
`useFrame` isn't available. It reads `livePlayer`, a plain object rather than store
state. Lesson 30 throttled the HUD to 10 updates a second, but a map at that rate would
stutter visibly.

So there are now three ways to share data, each for a different speed:

| Data | Tool | Updates |
| --- | --- | --- |
| Credits, mission phase | Zustand with selectors | Rarely |
| Speed and distance on the HUD | Zustand, throttled | 10 times a second |
| Position for the minimap | A plain object | Every frame |

### Lesson 37: the ring buffer

Skid marks could pile up forever, so `SkidMarks.tsx` uses a fixed block of 500 segments.
A counter moves along it, and when it reaches the end it wraps to the start, overwriting
the oldest mark:

```ts
nextSegment.current = (nextSegment.current + 1) % MAX_SEGMENTS
```

The memory used never grows. Games use this for bullet holes, particles and more.

### Lesson 38: test your tests

The bot lesson applies far beyond games. A test that passes can mean the code works, or
it can mean the test isn't testing much. Mine passed for days of simulated riding while
barely moving. Two habits would have caught it:

- **Measure what a test really covered**, as well as whether it passed.
- **Be suspicious of neat results.** The same 1,868 hits under completely different
  physics was the clue here.

### Try it

1. Practise on a long straight, then at a junction. Hold Space, steer, and keep W held.
2. Catch a slide by steering the other way.
3. Earn a boost, and watch for the green badge by the speedometer.
4. In `vehicleConfig.ts`, try `driftGrip: 0.6` for an icy feel, then `3` for a tight one.
5. Set `maxDriftAngle` to `1.5` and see how close you get to spinning out.
6. In `Minimap.tsx`, set `VIEW_METRES` to `400` for a wider view.

### Next

Your feedback on the drift decides this. After that, a route line on the minimap would
fix "the target is behind buildings", and saving progress is still waiting.

---

## 2026-11-06: Entry 10, real directions and varied deliveries

Your feedback: the direction arrow is hard to figure out, and the delivery location is
always the same.

Both came from one gap: the game had no idea what a road was. The dart pointed straight
through buildings at a fixed spot, and nothing could choose a new one.

### What I did

| File | Change |
| --- | --- |
| `src/world/roadGraph.ts` | New. Turns the roads into a network, and finds routes across it |
| `src/missions/missionPlanner.ts` | New. Picks a random pickup and customer for each delivery |
| `src/missions/routeTracking.ts` | New. Works out the route and where the arrow aims, every frame |
| `src/ui/DirectionArrow.tsx` | New. A large arrow at the top of the screen |
| `src/ui/Minimap.tsx` | Now draws the route along the roads |
| `src/world/collision.ts` | Added `hasClearLine`, a line-of-sight check |
| `src/game/gameTypes.ts`, `gameStore.ts`, `missionConfig.ts` | Missions are now generated, not fixed |
| `src/missions/TargetArrow.tsx` | Deleted. The large arrow replaces the 3D dart |

### How it works now

- **The arrow** shows where to go *next*, with up meaning straight ahead and down meaning
  turn around. It follows the roads, not a straight line to the stop.
- **The minimap** shows the route in the target's colour.
- **Every delivery** has a new pickup and a new customer. Customers are 180–450 m by road
  from the pickup, and at least 60 m from the last one.
- **"Next delivery"** carries on from where you are, with no jump back to the start.
- **The bonus time** scales with the route: about 6.7 m/s of road, and at least 30 s. The
  limits came out between 38 and 164 s.
- **The HUD distance** now means metres by road.

### Why

- **Why the 3D dart failed.** It lay nearly flat, and the camera sees it from a low angle,
  so it was often just a thin sliver. An arrow on the screen is always face-on.
- **Why "up means ahead".** It needs no thinking: the arrow matches your keys.
- **Why five pickups.** Each sits by a real mapped clothing shop, and shops close together
  share one. The game shows fictional names, and customers are labelled by real street
  names, which are just geography.
- **Why generated, not a list.** A hand-written list would run out and need updating. The
  planner works from the map, so it will also keep working as the world grows.

### A bug the bot found: the arrow pointed into walls

My first version aimed 22 m along the route. A bot steering only by the arrow managed 34
deliveries, then got stuck for an hour and a half at one corner. Given last time, I
checked before blaming the bot, and all 620 road links were clear.

The real cause: at a tight corner, a point 22 m along the route is on the far side of a
building, so the arrow pointed into the wall. You'd have been confused there too. The
arrow now aims at the furthest route point you can actually see.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| 22 handling checks | All pass |
| 500 random missions | All valid: reachable, clear of buildings, within the length limits |
| Variety | 315 different customers, 5 pickups |
| Repeats | A customer never within 60 m of the last, and no pickup twice in a row |
| Road network | All 591 points connected, and all 620 links clear for the scooter |
| Bot following only the arrow | **100 deliveries in 88.5 minutes**, averaging 53 s, all on time |
| That bot's coverage | 611 map cells, 23 hard hits, 15 reversals, 0 steps inside a wall |
| Real keys in headless Chrome | Collected, delivered and got paid through the new tracker |
| Next delivery in the browser | New stops each time, and the scooter stayed put |
| Browser errors | None |

The browser ride moved the stops close by, in memory only, as in Entry 8. Later deliveries
in that test were completed through the store, to check that the locations changed, so
only the bot rode full-length routes.

### Known issues

- **Routes ignore one-way streets.** 31 road pieces are tagged one-way, and the game treats
  them all as two-way. There's no traffic yet, so it doesn't matter.
- **The bonus time is still untested on people.** The bot's near-perfect score only shows
  that it's possible.
- **Route length is measured along the road**, so cutting through gaps between buildings
  can beat it. That seems fine, even fun.
- **Skid marks still appear on grass.** Credits and XP still reset on refresh, and the
  debug lines are still there.

### Lesson 39: roads as a graph, for real

Lesson 7 used a graph to count loops. Now we use one to navigate. `createRoadGraph` turns
each road into points, joined by links, and adds extra points on long straights. Where two
OSM roads share an exact point, they become one node, and that's what makes a junction.

### Lesson 40: Dijkstra's algorithm

To find the shortest route: start at the destination with distance 0, then repeatedly take
the closest unfinished point and check its neighbours. If going through this point gives a
neighbour a shorter distance, record it, along with which way to go.

Here's the trick. Usually you search from the rider to the goal, but then you'd have to
search again whenever the rider moves. We search **outward from the goal** instead, once,
and get an answer for **every point on the map**:

```ts
node = field.nextNode[node] // from anywhere, this is the next step toward the goal
```

This is called a **flow field**. Take a wrong turn, and the route updates instantly with no
new search. It's how strategy games move hundreds of units toward one target.

### Lesson 41: line of sight

`hasClearLine` is the simplest possible version: step along a line, one metre at a time,
and check each spot. It's cheap because the spatial grid from Lesson 23 keeps each check
small, and the arrow only tests a few points each frame.

"Aim at the furthest point I can see" is a classic trick called **path smoothing**, and it
often turns a jagged route into a natural-looking one.

### Lesson 42: randomness you can test

`createMissionPlanner` takes `random` as a parameter, defaulting to `Math.random`:

```ts
export function createMissionPlanner(data, collisions, random = Math.random) {
```

The game gets real randomness, and a test can pass in a predictable sequence and get the
same 500 missions each run. A failure you can repeat is a failure you can fix. This is
called **dependency injection**, and the idea is simple: pass things in, rather than
reaching out for them.

### Try it

1. Do a few deliveries. Take a wrong turn on purpose, and watch the route redraw instantly.
2. In `routeTracking.ts`, set `AIM_DISTANCE` to `40`, then `10`. See which reads best.
3. In `missionConfig.ts`, change `minRouteLength` and `maxRouteLength` for shorter or longer
   deliveries.
4. Set `onTimeRouteSpeed` to `9` for tighter bonus times.
5. In `Minimap.tsx`, try `VIEW_METRES` at `300` to see more of your route.

### Next

Your feedback again. Otherwise, the next items are saving progress and a title screen, then
making the world look less like boxes.

---

## 2026-11-06: Entry 11, saving progress

Your feedback: the arrow, the drift and the bonus times all look fine, so those settings
stay as they are. Commit `e1413e4` holds everything before this entry.

### What I did

Wrapped the store in `src/game/gameStore.ts` with Zustand's `persist` middleware, so
credits and XP now survive a refresh. There's no new dependency, because `persist` comes
with Zustand. Roadmap: Phase 7, local credits and XP storage.

### Why

- **Only `credits` and `xp` are saved.** If the current mission were saved, a refresh could
  bring back an old mission, without the planner it needs.
- **`localStorage`, not IndexedDB.** Two numbers don't need a database.
- **`version: 1`.** If the save format changes later, this tells us which format a player
  has, so old saves can be converted.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Earn 75 credits and 25 XP, then reload in headless Chrome | Both kept, and a new mission started |
| Corrupted save data | No crash, starts from 0 |
| Browser errors | None |

Progress lives in that one browser, so it won't follow you to another browser or device,
and clearing site data erases it.

### Lesson 43: middleware

**Middleware** wraps something to add behaviour, without changing the thing itself. Here,
`persist` sits around the store and watches every update:

```ts
create<GameState>()(
  persist((set, get) => ({ /* the same store as before */ }), {
    name: 'slikk-it-progress',
    partialize: ({ credits, xp }) => ({ credits, xp }),
  }),
)
```

None of the code that reads the store had to change. `partialize` picks what gets saved.
Without it, the store would try to save everything, including speed updates 10 times a
second and the planner.

The odd `create<GameState>()(...)`, with its extra `()`, is only there to help TypeScript
work out the types when middleware is involved.

### Try it

1. Do a delivery and refresh. Your credits should still be there.
2. In DevTools, open Application, then Local Storage, and find `slikk-it-progress`.
3. Change `credits` to `9999` there, and refresh. Saves on a player's device can always be
   edited, which matters if we ever add leaderboards.
4. Delete that entry and refresh to start again.

### Next

A title screen and loading screen, then making the world look less like boxes.
