# Deliver It dev log

This game was called SLIKK IT until Entry 12.

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

---

## 2026-11-06: Entry 12, title screen and a new name

Commit `c26c5a9` holds everything before this entry.

### What I did

| File | Change |
| --- | --- |
| `src/ui/TitleScreen.tsx` | New. Name, controls, saved progress and a start button. It also shows "Loading the neighbourhood…" until the map is ready |
| `src/ui/ErrorBoundary.tsx` | New. Shows a message and a retry button if loading fails |
| `src/camera/TitleCamera.tsx` | New. A slow aerial circle behind the title |
| `src/camera/FollowCamera.tsx` | Flies in from the title view when you start |
| `src/game/gameStore.ts` | Added `started` and `startGame` |
| `src/vehicle/Scooter.tsx` | Ignores the controls until the game has started |
| `src/App.tsx` | Shows either the title screen or the HUD |

**The game is now called Deliver It**, at your request. That's in the title screen, the
browser tab and `package.json`.

### Why

- **Your real neighbourhood is the backdrop.** It's the most striking thing the game has,
  so it does the selling behind the title.
- **Enter starts the game**, because the button has focus. Nobody needs to reach for the
  mouse on a keyboard game.
- **The error screen matters for a demo.** Before this, a failed map load left a blank page.
- **The save key stays `slikk-it-progress`.** Renaming it would have wiped your saved
  credits and XP, and players never see it.
- **The project folder is still `slikk-it`.** Renaming it would disturb your open editor
  and running dev server, so that's your call.
- **"Independent prototype. Not an official product."** stays on the title, since this
  still isn't an approved product.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| On the title: HUD and minimap hidden, Start button focused | Yes |
| Pressing W on the title | Scooter doesn't move, clock stays at 0 |
| Pressing Enter | Starts, with HUD and minimap showing |
| Fly-in | Seen mid-flight in a screenshot |
| Riding after starting | Works, 32 km/h after 1.5 s |
| Map file blocked on purpose | Error screen instead of a blank page |

**Not seen: the loading message.** The map loads too quickly here to catch it on screen.
You'd see it for longer on a slow connection.

### Known issues

- **The green and yellow debug lines show in the aerial view.** They should go before the
  demo.
- **Starting after a long pause keeps the same mission**, which is intended.

### Lesson 44: error boundaries

If a React component throws while rendering, React removes the whole tree, which is why
you'd get a blank page. An **error boundary** catches that and shows something else:

```tsx
static getDerivedStateFromError(): State {
  return { failed: true }
}
```

It's the one thing that still needs a class component. It pairs naturally with `use()` from
Lesson 4: `Suspense` handles "still loading", and an error boundary handles "it failed".

### Lesson 45: swapping cameras by swapping components

There's no camera mode flag here:

```tsx
{started ? <FollowCamera ... /> : <TitleCamera />}
```

Each component drives the same camera in its own `useFrame`, and while it's mounted it's in
charge. In R3F, mounting a component can switch behaviour on, and unmounting it switches
behaviour off.

### Lesson 46: smoothstep

The fly-in uses a small formula you'll see everywhere:

```ts
const eased = progress * progress * (3 - 2 * progress)
```

A straight line from 0 to 1 starts and stops abruptly. This curve starts slowly, speeds up,
and settles gently. It's called **smoothstep**, and it's a one-line way to make any movement
feel polished. `lerp` then blends the two camera positions by that amount.

### Try it

1. Refresh, and watch the aerial view. Press Enter to fly in.
2. In `TitleCamera.tsx`, change `ORBIT_HEIGHT` to `60` for a lower sweep.
3. In `FollowCamera.tsx`, set `INTRO_TIME` to `4` for a slow descent.
4. Replace `eased` with `progress` in the fly-in, and feel the difference.
5. In `mapData.ts`, temporarily misspell `MAP_URL` to see the error screen.

### Next

Remove the debug lines, then make the world look less like boxes.

---

## 2026-11-06: Entry 13, less like boxes

Commit `4445850` holds everything before this entry.

### What I did

| File | Change |
| --- | --- |
| `src/world/Buildings.tsx` | Windows and floor lines on every wall, and darker roofs |
| `src/world/RoadMarkings.tsx` | New. Dashed centre lines that stop short of junctions |
| `src/world/props.ts` | New. Chooses where trees and lamps go, and makes them solid |
| `src/world/RoadsideProps.tsx` | New. Draws 116 trees and 98 lamps |
| `src/world/Boundary.tsx` | New. A low wall around the play area |
| `src/world/roadGeometry.ts` | New. Road-drawing helpers, now shared with the markings |
| `src/world/collision.ts` | Added `addPost`, for small solid things |
| `src/world/World.tsx` | Now builds the collision world, and places the props in it |
| `src/world/DebugMap.tsx` | Deleted, along with the green and yellow guide lines |

### Why

- **One window image, repeated.** Every wall in the city shares a single 128-pixel image
  drawn in code. There are no image files to download, and no extra triangles.
- **Trees and lamps are solid.** Riding through a tree would break the illusion at once, so
  each adds a small post to the collision world.
- **The same trees every visit.** Placement uses a fixed seed (Lesson 12), so collisions and
  routes behave the same way each time.
- **The wall explains the edge.** Until now the scooter stopped at an invisible barrier.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Props placed | 116 trees, 98 lamps, in 10 ms |
| Same placement on each load | Yes |
| Any prop on a road | None: the closest is 0.74 m from a road's edge |
| Bot following only the arrow, around the props | **100 deliveries, all on time**, averaging 55.5 s, 0 steps inside a wall |
| 500 random missions | All valid, 315 customers |
| Views from the air and from the road | Look right, with no errors |

### Frame rate: read this carefully

My test browser renders on the CPU, so these numbers say nothing about your Mac. They only
compare one version with another:

| Version | Test FPS |
| --- | --- |
| All new visuals off | 18 |
| Windows only | 15 |
| Everything except trees and lamps | 14.5 |
| Everything on | 12 |

So the visuals cost about a third here, spread across several features, with no single
cause. Turning off anisotropy, which I suspected, made no difference.

Earlier I measured 26 FPS for the old version, and that wasn't a fair comparison: the same
old visuals measured 18 in this later test, so my machine was simply busier. Timing tests
need to be compared in the same session.

A real GPU should handle this far better than a CPU, but **I can't measure that**, so please
check your FPS. If it's slow, the first things to cut are tree shadows and the shadow map
size.

### Known issues

- **Every wall has the same windows**, with no doors or shop fronts, so ground floors look
  like upper floors.
- **Windows can be cut off at corners**, because the pattern doesn't fit each wall exactly.
- **The ground is one flat colour.** There are no pavements yet.
- **Roads continue a little past the boundary wall**, where their rounded ends poke out.

### Lesson 47: UV mapping

A texture is a flat image. **UV coordinates** say which part of the image each corner of a
triangle shows, from (0, 0) at one corner of the image to (1, 1) at the opposite one. Go
past 1 with `RepeatWrapping` on, and the image repeats. That makes windows easy:

```ts
uvs[i * 2] = alongWall / WINDOW_BAY_WIDTH // one repeat per window
uvs[i * 2 + 1] = position.getZ(i) / FLOOR_HEIGHT // one repeat per floor
```

A 3.2 m floor gets exactly one row of windows, and a 9.6 m building gets three. The roofs
share the same material, so they'd get windows too, except that every roof corner points at
one plain spot on the image.

### Lesson 48: `map` plus vertex colours

Texture and vertex colour **multiply** together. White in the image shows the building's own
colour, and dark areas stay dark. So one image makes a cream building, a pink building and a
blue building, and all 509 stay in one draw call.

### Lesson 49: instancing

Merging (Lesson 10) combines shapes into one. **Instancing** is different: one shape, drawn
many times.

```tsx
<instancedMesh args={[geometry, undefined, props.length]} />
```

The tree's 80-triangle canopy is stored once. Each copy adds only a matrix, which is 16
numbers holding position, rotation and scale. `setColorAt` gives each one its own shade.

| | Merging | Instancing |
| --- | --- | --- |
| Best for | Different shapes | Many of the same shape |
| Memory | Grows with every copy | One shape, plus a matrix per copy |
| Moving one later | Hard | Easy: change its matrix |

### Lesson 50: mipmaps and anisotropy

Far-away windows would shimmer as you move, because many image pixels land on one screen
pixel. **Mipmaps** are pre-shrunk copies of a texture that the GPU switches to with distance.
**Anisotropy** keeps textures sharp on surfaces seen at a steep angle, like a wall running
away from you.

### Lesson 51: comparing fairly

The 26 versus 12 comparison looked alarming and was half wrong. Change one thing at a time,
and measure both versions in the same session, because a machine's speed drifts.

### Try it

1. Ride around, and tell me your FPS.
2. In `Buildings.tsx`, change `WINDOW_BAY_WIDTH` to `2.4` for narrower windows.
3. In `createFacadeTexture`, change the glass colour from `#3e4c58` to `#9ac4d8`.
4. In `props.ts`, set `TREE_CHANCE` to `1` for a leafier neighbourhood. Then try changing the
   seed number passed to `createRandom`.
5. In `Lighting.tsx`, set the sun to `[-180, 80, 120]`. Long shadows look lovely with windows.

### Next

Your FPS decides this. After that, shop fronts on ground floors, pavements, and a rider on
the scooter.

---

## 2026-11-06: Entry 14, a quality setting

Commit `6da86ae` holds everything before this entry.

### What I did

| File | Change |
| --- | --- |
| `src/game/qualitySettings.ts` | New. The three presets |
| `src/ui/QualityPicker.tsx` | New. Low, Medium and High buttons |
| `src/game/gameStore.ts` | Stores the quality, and saves it between visits |
| `src/App.tsx` | Sets the rendering resolution, and shows the picker during a ride |
| `src/ui/TitleScreen.tsx` | Shows the picker on the title screen |
| `src/world/Lighting.tsx`, `Buildings.tsx`, `RoadsideProps.tsx` | Follow the chosen preset |

| Setting | Low | Medium | High |
| --- | --- | --- | --- |
| Rendering resolution | 0.75× | Up to 1.25× | Up to 2× |
| Sun shadows | Off | 2048 | 4096 |
| Tree and lamp shadows | Off | Off | On |
| Window textures | Off | On | On |

### Why

- **Resolution does the most.** On a Retina screen, 2× means four times as many pixels as 1×,
  and every pixel costs GPU work.
- **Trees and lamps stay at every level.** They're solid, and hiding them would mean crashing
  into things you can't see.
- **It applies instantly**, so you can compare levels while riding.
- **High stays the default**, and your choice is saved along with credits and XP.

### What I checked

| Check | Result |
| --- | --- |
| Lint, type check, production build | Pass |
| Test FPS, High | 11.3 |
| Test FPS, Medium | 14.0 |
| Test FPS, Low | 27.3 |
| Switching 5 times during a ride | No reset, no errors, WebGL context stayed alive |
| Choice kept after a reload | Yes |
| Low from the road | Plain but clean, with no shadows or windows |

These are CPU test numbers, so they only compare the levels with each other. My test browser
has a 1× screen, so it **can't show the gain from reducing resolution on a Retina display**.
That means High and Medium differ here only by shadows. On your Mac the gap may well be bigger,
but I haven't measured it.

### Lesson 52: `dpr`

`dpr` stands for device pixel ratio: how many real pixels are drawn per CSS pixel.

```tsx
<Canvas dpr={[1, 2]} />
```

The pair means "use the screen's ratio, kept between these limits". Going from 2 to 1 halves
the width and the height, so it's a quarter of the pixels. Few settings give so much for so
little. Below 1, the browser stretches the picture, so it looks softer.

### Lesson 53: why some changes need a new object

Most props can change at any time, but a few things are baked in when created:

- A **shadow map** is a texture of a fixed size, so it can't simply resize.
- Three.js compiles a **shader** for each material, based on features like having a texture.

So we use React's `key` prop. When a key changes, React throws the old object away and builds a
new one:

```tsx
<directionalLight key={shadowSize} ... />
```

This is normally a way to reset a component. Here it's a one-line way to rebuild a Three.js
object cleanly.

### Lesson 54: selecting from the store

```ts
const { windows } = useGameStore((state) => QUALITY_PRESETS[state.quality])
```

The selector returns an object, which would be dangerous if it created a new one each time, as
React would see a change on every read. These presets are fixed objects, so it's the same one
each time, and the component only re-renders when the quality really changes.

### Try it

1. Press Low, Medium and High while riding, and watch the difference.
2. Run the FPS check from earlier on each level.
3. In `qualitySettings.ts`, try `pixelRatio: [0.5, 0.5]` for Low, to see how far it can go.
4. Make your own mix: set `windows: true` on Low and see what it costs.

### Next

Your FPS on each level decides how much more detail we can add.

## 2026-11-06: Entry 15, the strip, traffic and people

### What I did

- **Made the world four times bigger.** The 450 m square is now a 600 × 1440 m rectangle called
  `PLAY_AREA`. It holds 1,545 buildings (93% of the file) and about 21 km of road.
- **Made the sun follow the rider,** so shadows work everywhere.
- **Stopped drawing distant trees and lamps,** with the distance set per quality level.
- **Kept only the main road network,** and added a preference for nearby pickups.
- **Added vehicles** (cars and auto rickshaws) that keep left, follow each other, give way at
  junctions and stop for the rider. They're solid.
- **Added pedestrians** on the pavements, who step aside when the rider comes close.
- **Added street detail:** pavements on every road, and 113 coloured awnings on the walls
  nearest to mapped shops and restaurants.

I had said the strip was about 500 m × 1.9 km with 98% of the buildings. Measuring it properly
gave 600 × 1440 m and 93%. Going further south adds 7 km of road for about 100 buildings.

### Why

The brief kept the rest of the map for later, and the game had room to grow. Traffic and people
were out of scope for the weekend MVP, which is finished, and you asked for them. They stay
simple on purpose: they follow fixed paths, with a few rules and no real AI.

Pedestrians can't be hit, because that isn't a thing this game should reward or punish. Vehicles
only stop the scooter. As the brief says, nothing damages a package.

### What I checked

| Check | Result |
| --- | --- |
| Road samples reachable from the spawn | 7,055 of 7,055 |
| 500 random missions | All valid |
| 3,000 random starts | No crashes, median 389 m to the pickup, worst 882 m |
| 100 deliveries following the arrow | All on time, average 51.9 s, 0 steps inside walls |
| Sun snapping, 20,000 positions | 0.0000 pixels off the shadow grid, rider always covered |
| 24 simulated minutes of 18 vehicles | 0 in buildings, longest stop 1.8 s |
| Vehicle pairs closer than 1.5 m | 139 pair-frames in 86,400 frames, down from 4,643 |
| Rider rides at a parked car | Stopped behind it, and can reverse away |
| Rider rides along a pedestrian's path at 7 m/s | Closest 1.78 m |
| Traffic update | 0.011 ms per frame in Node |

Some things are **not** clean, or weren't tested:

- A pedestrian's rounded corner clipped a wall corner for 18 person-frames, out of about 3 million.
- Vehicles can still briefly overlap, usually when the patience rule lets one go.
- The delivery bot rode **without traffic**. Only the short rider and car tests had both.
- Shadows reach 260 m from the rider, so distant buildings have none.

Frame rates, all measured on the CPU test renderer on one machine:

| Level | The old square | Strip, before the fix | Final, with traffic |
| --- | --- | --- | --- |
| High | 10.7 | 6.7 | 8.3 |
| Medium | 12.3 | 8.3 | 10.3 |
| Low | 25.3 | 13.0 | 18.3 |

So it's still slower than before, by about 20–30% here. A CPU renderer exaggerates this, so only
**your Mac's number** can tell us the real cost.

### Lesson 55: measure what's slow by removing it

I assumed three times the buildings would be the cost. So I switched things off one at a time:

| Switched off | Low FPS |
| --- | --- |
| Nothing | 13.3 |
| Minimap | 14.7 |
| Buildings | 17.3 |
| Trees and lamps | 25.0 |

The trees and lamps were the biggest cost, and I'd never have guessed it. Each tree is about 100
triangles. 1,500 buildings merged together were cheaper than 838 small things.

### Lesson 56: `count` on an instanced mesh

An `InstancedMesh` has room for a fixed number of copies, but draws only the first `count`:

```ts
instances.setMatrixAt(count, transform.matrix)
count++
// ...
instances.count = count
```

So we write only the nearby trees into the list, and redo it each time the rider has moved 20 m.
This is called **distance culling**. As the copies now change, the mesh's bounding sphere would
be out of date, so `frustumCulled={false}` turns off that check.

### Lesson 57: a shadow map is a picture

The sun "photographs" the world from above to see what's in shadow. Move the camera smoothly and
every shadow edge lands on different pixels each frame, which looks like shimmering. The fix is
to move the sun only in whole shadow-map pixels:

```ts
const snap = (metres: number) => Math.round(metres / pixelSize) * pixelSize
```

Note that a `directionalLight` has a `target`, and direction is decided by the light's position
relative to it. The target isn't in the scene, so we call `updateMatrixWorld()` on it ourselves.

### Lesson 58: colours multiply

A vertex colour and an instance colour are multiplied together. White (1 × anything) takes on
the instance colour, which is why car bodies are white in the geometry. Black stays black, which
keeps tyres and windows dark on every car.

This is also why my first heads came out nearly black: skin × shirt colour. An instance can only
have one colour per shape, so heads became their own instanced mesh with their own colours.

### Lesson 59: test by looking too

Every traffic check passed, yet the first close-up showed an auto rickshaw inside a car. It
started there, and nothing stopped it. Numbers answer the questions you thought to ask. A
screenshot shows you the ones you didn't.

### Lesson 60: rules that can't deadlock

Two cars at a junction can't both give way, or neither moves. The rule here: the car earlier in
the list always yields. As the last car yields to nobody, there can't be a circle of waiting.
Real traffic has no such list, but games get to cheat.

### Try it

1. On each quality level, check the FPS while riding, using Chrome's "Show frame rendering stats".
2. Ride to the far north end, and check that the shadows came with you.
3. Ride straight at a pedestrian, or stop in front of a car.
4. In `qualitySettings.ts`, change `vehicles` on High and see the street fill up.
5. In `trafficLogic.ts`, set `sideOffset: () => -1.4` and the traffic drives on the right.

### Next

Your FPS decides this. If it's fine, missions can use the whole strip. If it isn't, we can draw
only the nearby buildings.

## 2026-11-06: Entry 16, drawing only what's near you

### What I did

- **Cut the world into 160 m map squares.** Buildings, roads, pavements and road markings each
  became many meshes, one per square, instead of one mesh for the whole map.
- **Hid squares beyond the draw distance:** 280 m on Low, 400 m on Medium, 520 m on High.
- **Tied the fog to that distance,** so it's fully thick exactly where drawing stops.
- **Eased the view in from the title screen,** which still shows the whole map.

Collisions, the minimap and routes still use the whole map. The rider can't reach an undrawn
square, as a square reappears long before you get there.

### Why

You asked for it, and it's what big games do. Merged meshes were cheap to draw but all-or-nothing:
if one corner of the map was on screen, every triangle in it was sent. Separate squares can be
skipped on their own, both past the draw distance and behind the camera.

This is **render** streaming, not **data** streaming. The whole 1.6 MB map still loads at the
start, because it's small enough. A big game also loads and unloads from disk, as its world
wouldn't fit in memory.

### What I checked

Measured in one session at the spawn, on the CPU test renderer:

| Level | FPS before | FPS after | Triangles before | Triangles after | Draw calls before | After |
| --- | --- | --- | --- | --- | --- | --- |
| High | 8.7 | 9.0 | 105,342 | 75,212 | 40 | 116 |
| Medium | 10.3 | 11.7 | 77,758 | 42,354 | 37 | 100 |
| Low | 20.0 | 24.3 | 49,686 | 18,572 | 31 | 61 |

The triangle count dropped by about a third on High and over 60% on Low. The cost is more draw
calls, because each visible square is its own call. A real GPU often cares about draw calls more
than a CPU renderer does, so **the gain on your Mac could be larger or smaller** than this.

**One thing I can't fully explain.** Riding through the far north end, some headless screenshots
showed road missing, cut off at a map-square edge. It appeared in 3 of the 16 screenshots I took
there. I couldn't explain it from the picture, so I counted inside the page:

| Check, riding through the same spot | Result |
| --- | --- |
| Nearby road squares skipped by Three.js, over 125 frames | 0 |
| Screenshots with the glitch during that same run | 1 of 7 |
| Same spot, standing still | Road is there |

So Three.js asked for those squares on every frame, and that points to the screenshot, not the
game. Headless screenshots have shown odd things before (the blank band in Entry 2). But I
haven't proved it, as the count can't see what reached the screen.

**Update:** you rode through that spot on your Mac and saw nothing weird. So the glitch appears
only in my headless screenshots, and it looks like a capture fault. That's one ride, so if road
ever blinks out for you, it's worth reopening.

### Lesson 61: chunks

A **chunk** is a piece of the world handled as a unit. It's a trade:

| One big mesh | Many chunks |
| --- | --- |
| 1 draw call | 1 call per visible chunk |
| All triangles, always | Only the chunks you can see |

Too few chunks and little gets skipped. Too many and draw calls pile up. 160 m is a middle
choice, and it's one number in `chunks.ts` if you want to try others.

### Lesson 62: two kinds of skipping

- **Distance culling** is ours: `mesh.visible = false` past the draw distance.
- **Frustum culling** is built into Three.js. The **frustum** is the pyramid-shaped volume the
  camera sees. Each frame, Three.js tests each mesh's **bounding sphere** against it, and skips
  meshes outside.

The second did nothing for us before, because one sphere around the whole map always touches the
view. Splitting the map is what made it work. It's why `computeBoundingSphere()` matters.

### Lesson 63: fog hides the seam

Without fog, you'd see buildings pop into view at the draw distance. So:

```ts
scene.fog.near = liveView.drawDistance * FOG_START
scene.fog.far = liveView.drawDistance
```

At `far`, a surface has become exactly the fog colour, which matches the sky. A square can switch
on there and nobody can tell. Early 3D games used the same trick, for the same reason.

### Lesson 64: sharing one material

Each square shares one material, made once with `useMemo`:

```tsx
<mesh geometry={geometry} material={material} />
```

Had each mesh had its own `<meshStandardMaterial />` child, we'd have hundreds of copies.

### Lesson 65: ask the program, not the picture

A screenshot told me a square was missing, and a one-off check said it was visible. Neither
settled it. Wrapping `gl.render` and counting real draws, frame by frame, did. When two views
disagree, find a third that measures the thing directly.

### Try it

1. Ride along a long straight road, and watch distant buildings fade out of the fog.
2. In `qualitySettings.ts`, set High's `drawDistance` to `150`, and see how close it gets.
3. In `ViewDistance.tsx`, set `FOG_START` to `0.9`, and you'll see squares pop in.
4. In `chunks.ts`, try `CHUNK_SIZE` of `80` and `320`, and compare your FPS.

### Next

Your FPS decides whether we also trim the draw calls, or move on to missions across the strip.

## 2026-11-06: Entry 17, deliveries across the strip

### What I did

Every delivery now has a length, shown in the mission panel and rolled at random:

| Length | Road distance | Chance | Extra credits | Extra XP |
| --- | --- | --- | --- | --- |
| Local | 180–450 m | 50% | 0 | 0 |
| Across town | 450–900 m | 35% | +35 | +15 |
| Long haul | 900–1500 m | 15% | +80 | +35 |

The extras appear as a "Distance bonus" on the results card. The base 50 credits and 25 XP are
paid on every delivery as before, and the on-time bonus still doesn't change. On-time limits
already grew with route length, so they needed no change.

### Why

The map grew four times over, but deliveries stayed at 180–450 m, so most of it went unused.

### What I checked

| Check | Result |
| --- | --- |
| 500 random missions | All valid, routes 181–1497 m |
| 3,000 random starts | No crashes |
| 200 deliveries, no traffic | All on time, 0 steps inside walls |
| 200 deliveries, **with traffic** | All on time, 0 steps inside walls |

This closes the gap from Entry 15, where the delivery bot had only ridden without traffic.

My first bonuses (+50 and +120) were too generous. The bot earned 115 credits a minute on long
hauls and 80 on local trips. With the final values and traffic on:

| Length | Average time | Time limit | Credits per minute |
| --- | --- | --- | --- |
| Local | 57 s | 102 s | 78.5 |
| Across town | 83 s | 154 s | 79.1 |
| Long haul | 109 s | 202 s | 85.5 |

The bot barely slows down and never looks around, so a person will be slower. The comparison
between lengths should hold, but the times won't, and **whether the limits feel fair is yours to
judge**.

The first traffic run failed: only 186 of 200 done, stuck for hours in one spot. I checked before
blaming anything. No vehicle was within 9 m, and reversing freed 10.5 m, so it wasn't a trap.
Traffic had pushed the bot onto a post, and its fixed reverse-and-retry repeated forever. With a
varied escape in the bot, all 200 finished. The game itself didn't change for this.

The rider can still block a car forever by parking in front of it, as cars wait for the rider
without limit. You can always ride around or reverse, so I left it.

### Lesson 66: tune with numbers from play

A bonus looks fair on paper until you divide by time. What matters to a player is earnings per
minute, not per trip. Here, a real measurement replaced a guess:

```
credits per minute = (base + distance + on-time) / average seconds × 60
```

Keep long trips slightly ahead. Too far ahead, and nobody wants short trips.

### Lesson 67: data-driven rules

The lengths are a plain list, and the code just reads it:

```ts
{ label: 'Long haul', minRoute: 900, maxRoute: 1500, chance: 0.15, extraCredits: 80, extraXp: 35 },
```

A new length needs a new row and no new logic. Games use this everywhere, because rules get
tuned far more often than code gets rewritten.

### Try it

1. Do a Long haul, and see if the time limit feels fair.
2. In `missionConfig.ts`, set Long haul's `chance` to `1`, and the other two to `0`, to get only long trips.
3. Park in front of a car and watch it wait.

### Next

Tell me how the long trips feel. After that, the map could use something to ride for: spending
credits, or a level from XP.

## 2026-11-07: Entry 18, trees, a clock and weather

### What I did

- **Trees:** three shapes (round, tall, wide like a rain tree) and 12 colours, including flowering
  ones like the city's gulmohar, tabebuia and jacaranda. They sway, harder as the wind picks up.
- **A sky dome,** with a gradient, sun, moon, stars and drifting clouds.
- **A 24-hour clock,** shown on screen. A day lasts about 8 minutes, as the clock runs twice as
  fast after dark. It starts at 09:00.
- **Weather:** Clear, Cloudy and Rain, each lasting 45–110 seconds and blending into the next.
  Rain darkens the road, thickens the fog and fades the shadows. Wind moves the trees and clouds.
- **Night lighting:** moonlight, lit windows, pools of light under street lamps, and a headlight.
- **Two shortcuts:** `N` jumps 3 hours and `M` changes the weather.

Low skips clouds, and the rain has fewer drops on lower levels.

### Why

The city looked frozen. A sky that changes and trees that move make it feel alive, even when
nothing else is going on. Weather is only for looks for now. It doesn't change the handling.

### What I checked

| Check | Result |
| --- | --- |
| 20 simulated days | All values valid, no sudden jumps in light or colour |
| Weather over 200 minutes | Clear, Cloudy and Rain all came up |
| 200 deliveries with traffic | All passed again |
| Browser | No errors |
| Screenshots | Day, night, rain and rain at night all looked right |

Frame rate, on the CPU test renderer:

| Level | Before | After |
| --- | --- | --- |
| High | 9.0 | 8.3 |
| Medium | 11.7 | 10.7 |
| Low | 24.3 | 25.3 |

**Not checked, or not perfect:**

- Screenshots can't show movement, so I haven't seen the sway, the falling rain or how the shadows
  move as the sun crosses the sky. Moving shadow edges may crawl slightly.
- Tree shadows don't sway. Only the trees do.
- Sunset lasts under a minute, and I didn't screenshot it.
- Cars and pedestrians have no lights at night.
- The cost of the sky on your Retina screen is unknown, as the CPU test runs at 1× resolution.

### Lesson 68: a shader on a dome

The sky isn't a picture. It's a huge sphere, seen from inside, that follows the camera, so you can
never reach it. A **fragment shader** works out its colour pixel by pixel:

```glsl
vec3 color = mix(uHorizon, uZenith, pow(height, 0.55));
```

The fog takes the horizon's colour, so that distant buildings melt into the sky at any time of day.

### Lesson 69: noise makes clouds

Random numbers look like static. **Value noise** blends between them smoothly, and adding finer,
fainter layers gives the billowing shapes of cloud. To draw them, keep only what's above a
threshold. Lower the threshold, and the sky fills up, which is how weather controls cloud cover.

### Lesson 70: moving things on the GPU

Rain is 1,400 lines, and JavaScript never moves one. It passes the time, and the vertex shader
works out each position:

```glsl
drop.y = mod(drop.y - uTime * 24.0, 18.0);
```

`mod` wraps a falling drop back to the top, forever. The trees work the same way: `onBeforeCompile`
adds a few lines to Three.js's own shader, and hundreds of trees sway for the price of one number.

### Lesson 71: fake lights

Every real light adds work to every surface. The lamp pools and the headlight aren't lights: they're
flat shapes with **additive blending**, which adds their colour to what's under them. They can't
light a wall, but on a road nobody notices.

### Lesson 72: R3F copies `uniforms`

This cost me two rounds. Rain was invisible and the clouds were frozen, with no errors. Checking the
live material showed `uOpacity: 0`, even though my code was setting it. Passing `uniforms` as a JSX
prop gave the material a copy, so my updates went nowhere. The fix was to build the material once:

```ts
const skyMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
```

```tsx
<mesh material={skyMaterial} />
```

Camera position still worked, because the copy kept the same `Vector3`. That's what gave it away.

### Try it

1. Press `N` a few times and watch the day pass, then press `M` until it rains.
2. In `skyLogic.ts`, set `dayLength` to `120`.
3. In `Rain.tsx`, change `FALL_SPEED`, or `rainDrops` in `qualitySettings.ts`.
4. In `RoadsideProps.tsx`, multiply `0.045` by four, and the trees get a gale.

### Next

Tell me how it feels. Rain could also make the road slippery, if you'd like weather to matter.

## 2026-11-07: Entry 19, real road and building textures

### What I did

- **Roads** now use a tarmac photo, **pavements** use the brick pavers you chose, and **walls** have
  real plaster weathering. Windows got a sky gradient, shadows, and grime under the sills.
- **Added a surface setting to the quality levels:** Low stays plain, Medium has colour, and High
  also has bump detail from normal maps.
- **Rebuilt the scooter's soft shadow** from geometry, because its texture stopped showing up.

All the textures are CC0 from Poly Haven, listed in `public/textures/CREDITS.txt`. They add 1 MB.

You pointed me to `brick_pavement_03_1k.blend`, which turned out to be a folder. Browsers can't load
a `.blend` file, and its bump map was an EXR, which they can't load either. So I used the folder's
colour JPG, and fetched the same asset's bump map as a JPG from Poly Haven. Your file is unchanged.

### Why

Flat colours were what made the city look like a toy. Real surfaces change every frame you see.

### What I checked

| Check | Result |
| --- | --- |
| Type check, lint, build | Pass |
| Browser | No errors |
| Screenshots | Day and rainy night look right, and the scooter's shadow is back |

Frame rate on the CPU test renderer, measured in repeated runs:

| Level | Before | After |
| --- | --- | --- |
| High | 8.3 | 5.0–7.0 |
| Medium | 10.3–10.7 | 6.0–9.3 |
| Low | 24.3–25.7 | 17.3–23.7 |

Low draws no new textures, yet its range moved too, so **part of this is noise on my machine**.
Textures cost a CPU renderer far more than a GPU, as sampling is what GPUs are built for. So only
your Mac can give the real cost.

**Not solved:**

- **The scooter shadow's real cause is unknown.** The plane drew fine in solid red, and the canvas
  held the right data, but with the texture on, nothing showed. A rebuilt texture didn't help
  either. I replaced it instead of finding out why, so the cause could matter elsewhere.
- **The map-square glitch from Entry 16 came back in a screenshot**, with road missing while
  riding. You saw nothing on your Mac then, so I still think it's a screenshot fault. It's worth
  a look now that the surfaces changed.
- Tiling repeats. It isn't obvious on tarmac, but could be from high up.

### Lesson 73: UVs in metres

Roads had no **UVs**, the numbers saying which part of a texture lands on each corner. A road
made of many separate pieces would show seams if each had its own. So we use world position:

```ts
uvs[corner * 2] = positions[corner * 3]         // x, in metres
uvs[corner * 2 + 1] = positions[corner * 3 + 2] // z, in metres
```

Then `texture.repeat.set(1 / 2.5, 1 / 2.5)` means "one copy every 2.5 m". Every piece lines up,
as they all read from one texture laid across the whole map.

### Lesson 74: normal maps

A **normal map** doesn't change the shape. Each pixel stores which way the surface "faces", so
light catches bumps that aren't there. Its red, green and blue are an X, Y and Z direction, which
is why these images look purple. It's why the bricks seem raised on a flat plane, and it costs
extra work on every pixel, so it's High only.

Colour textures need `colorSpace = SRGBColorSpace`, as they're made for eyes. Normal maps are
data, so they must stay as they are.

### Lesson 75: keep the stains, lose the colour

Every wall shares one texture, but buildings have different colours, which multiply with it. A
brown plaster photo would turn them all brown. So we turn each pixel into a pale grey based on how
it differs from the average. The stains survive, and the paint shows through.

### Lesson 76: when to stop debugging

I made three attempts to find why the shadow texture was blank, and each ruled something out. It's
only a dark oval, so I built it another way. Moving on is often right, as long as you write down
that the cause is unknown. A workaround that's recorded as one can be revisited.

### Try it

1. Press Low, Medium and High to compare the road and walls up close.
2. In `Roads.tsx`, set `PAVEMENT_TILE` to `1` or `6`, and see why real size matters.
3. In `Roads.tsx`, change `TEXTURED_ROAD_COLOR` to `#ffffff` for a paler road.
4. Open `public/textures/road-normal.jpg` to see what a normal map looks like.

### Next

Building detail and street clutter, such as water tanks, shutters and overhead cables.

### Update: making the pavement visible

You said your pavement wasn't there. It was, as a side-by-side with your file showed, but I'd made it
easy to miss: Low skipped it, and at 1.8 m wide, most of what sat beside the road was plain ground.
Now the pavers show on every level, the bumps stay on High only, and pavements are 3 m wide.

## 2026-11-07: Entry 20, water tanks and overhead cables

### What I did

- **1,498 rooftop water tanks,** on about three in four buildings. Most are black, some blue or white,
  and some roofs have two.
- **Overhead cables:** bundles of four sagging wires between 194 pairs of lamp posts, plus single
  wires from every second lamp to the nearest house.
- Moved the building height rules into `buildingData.ts`, so tanks can find each roof.

### Why

Tanks and cable tangles are two of the things that make a street read as Indian. They cost little,
and they're seen against the sky, where the silhouette stands out.

### What I checked

| Check | Result |
| --- | --- |
| Tanks not on a building | 0 of 1,498 |
| Tanks and cables the same on every load | Yes |
| 200 deliveries with traffic | All passed |
| Type check, lint, build, browser errors | All clean |

Cost, measured on the CPU test renderer at the start point:

| Level | Triangles before | Triangles after | FPS before | FPS after |
| --- | --- | --- | --- | --- |
| High | 74,882 | 96,146 | 5.3–7.0 | 6.3 |
| Medium | 42,776 | 50,432 | 6.0–9.3 | 9.3 |
| Low | 19,334 | 24,218 | 17.3–23.7 | 21.7 |

The FPS change is lost in the noise, so all this shows is that it's no big hit here.

**Not perfect:**

- Tanks have no shape detail, such as a lid or stand.
- Cables can pass through a tree's leaves, and they cast no shadows.
- Cables only appear within 130 m, so you may spot a bundle appearing in the distance.
- A house wire goes to the nearest wall, which can be a side wall.
- Lamp posts are doing the job of electricity poles, and only spans that clear buildings are wired.

### Lesson 77: count the triangles of small things

My first tank had 84 triangles, as a lid and stand were included. That's more than a tree, for
something you see from far below. With 1,498 of them, High's total almost doubled. A plain
seven-sided drum has 28, and from the street nobody can tell. Detail should go where the eye goes.

### Lesson 78: lines don't shrink

Triangles get smaller with distance, but a line is always at least one pixel wide. So four wires
that sit metres apart up close merge into a black bar far away, and the aerial view looked awful.
The fix was a separate draw distance for cables. A wider lesson: thin things need different rules
from solid things.

### Lesson 79: a parabola for sag

A hanging cable makes a curve called a catenary, but a parabola is close enough, and simple:

```ts
y = startY + (endY - startY) * along - sag * 4 * along * (1 - along)
```

`along * (1 - along)` is 0 at both ends and 0.25 in the middle, so the `4` makes the drop exactly
`sag` at the centre.

### Try it

1. Look up while riding, and use the title screen to see the tanks from above.
2. In `Cables.tsx`, raise `CABLE_DISTANCE` to `600`, and see the black bars from Lesson 78.
3. In `Cables.tsx`, change a `sag` to `2.5` for very slack wires.
4. In `roofTanks.ts`, set `TANK_CHANCE` to `100`.

### Next

More street clutter (shutters, signboards, parked scooters), soft shading, or better trees.

## 2026-11-07: Entry 21, shutters, signboards and parked scooters

### What I did

- **Rolling shutters and signboards** on all 113 shop fronts, under and above the awnings. Signs glow
  at night.
- **165 parked scooters** outside shops, in six colours, some nosed in and some backed in. They're
  solid, and they never stand on the road.
- Moved the small box helpers into `simpleShapes.ts`, as traffic and parked scooters both use them.

Signs only ever say what kind of place it is, such as `BAKERY` or `SALON`. The map holds real
shop names, but the brief says no real branding without approval, so the game never reads them.

### Why

These are what make a street look lived-in. Shops now look like shops, and not like houses with
an awning.

### What I checked

| Check | Result |
| --- | --- |
| Sign text | Reads forwards, by day and glowing at night |
| 200 deliveries with traffic | All passed, around the new solid scooters |
| Placement | The same on every load, and none on a road |
| Type check, lint, build, browser errors | All clean |

Triangles rose by a little, measured on a busier street than the old start point: High 109,088,
Medium 58,736, Low 26,990. I don't have a fair FPS comparison, as that street isn't where I took
the earlier numbers.

**Not perfect:**

- A shop can face a side wall or a narrow gap, as it uses the wall nearest its map point. Its sign
  can then be cut off by the next building.
- Every shutter is closed, even in daytime.
- Traffic doesn't know about parked scooters, but they're off the road so it shouldn't matter.
- Scooters are simple boxes, and there are none away from shops.
- Signs are in English only. Real Bengaluru signs usually have Kannada too.
- Screenshot test: one run looked broken because it pressed Start before the button appeared. That
  was the test, not the game.

### Lesson 80: a texture atlas

Every sign and shutter shares one image, called an **atlas**. Each quad's UVs just pick its own
rectangle. One image means one material, so every shop front in a map square can merge into
one draw call. With a texture per sign, that would be 200 draw calls.

### Lesson 81: which way is right?

A wall faces outward, but you read it looking back at it, so the viewer's right isn't the wall's.
Forward is `(sin r, cos r)`, and the viewer's right comes out as `(cos r, -sin r)`. If that's
wrong, all the text is mirrored. The corners also go anticlockwise as seen from the front, or
the quad is culled as a back face.

### Lesson 82: glow from a second image

`emissiveMap` says where a surface makes its own light. Copying the atlas and blacking out the
shutters means that only the signs glow, and `emissiveIntensity` fades them in after dark.

### Try it

1. Ride past shops by day, then press `N` a few times.
2. Bump into a parked scooter.
3. In `shopFrontPlacement.ts`, change a word in `SIGN_WORDS`.
4. In `props.ts`, raise `MAX_PARKED_PER_SHOP` to `8`.

### Next

Soft shading, better trees, or open shop fronts with people and light inside.

## 2026-11-07: Entry 22, grass and parks

### What I did

- **Real parks:** the 6 parks inside the riding area, drawn from their true outlines on the map
  with a grass texture. The largest is about 1 hectare.
- **Footpaths:** the map's footways, which the game had loaded but never drawn.
- **Park planting:** 103 more trees and 52 benches, all solid and the same on every load.
- **Open ground** now uses a dusty, patchy texture instead of flat tan.
- **Grass tufts** near the rider that sway in the wind: 4,000 on High, 1,800 on Medium, none on Low.

Two parks, two pitches and a playground on the map fall outside the riding area, so they aren't
in the game. Grass doesn't slow the scooter down.

### Why

The city was all hard surfaces. The parks are real places, so they're where a local would expect.

### What I checked

| Check | Result |
| --- | --- |
| 200 deliveries with traffic | All passed, around the new trees and benches |
| Park planting time | 9 ms |
| Placement | The same on every load |
| Type check, lint, build, browser errors | All clean |
| Screenshots | The biggest park and the normal start |

At the normal start, High went from about 96,000 to about 144,000 triangles. FPS on the CPU test
renderer went from about 6.3 to 5.0 on High, 9.3 to 7.7 on Medium, and stayed at 21.7 on Low. This
one is bigger than recent additions. It's mostly the new ground and grass, and your Mac's number is
the one that counts. If High suffers, `grassTufts` is the first thing to lower.

**Not perfect:**

- Grass is still sparse up close. It's a scatter, not a lawn.
- Grass tufts have no shadows, and I haven't seen them sway, as screenshots can't show it.
- Parks have no fence, gate or hedge, so you can ride straight in.
- Footpaths have small gaps at sharp bends.
- The ground texture may show its repeat from high up.

### Lesson 83: triangulation

A GPU can only draw triangles, but a park is an irregular outline. `THREE.ShapeUtils.triangulateShape`
cuts any outline, with holes, into triangles, using an algorithm called **earcut**.

### Lesson 84: a mask texture

A shader can't ask "is this spot a road?", but it can read an image. So we paint one top-down map:
black for roads and buildings, grey for open ground, and white for parks. Each tuft reads the
pixel under it, and hides itself on black. Images are how you hand data to a GPU.

### Lesson 85: the field that follows you

There are only 4,000 tufts, however big the map is. Each wraps around the rider with `mod`, as the
rain does, and shrinks to nothing near the edge, so that nobody sees it jump. It looks endless, and
JavaScript never moves a single tuft.

### Lesson 86: looks wrong? Name what's wrong

My first grass looked like agave plants. It was too tall and sharp, and grew from a single root. My
second had black spikes, because a back face is lit as if it faces away, and a flipped normal
points down. Each fix came from describing what was wrong, not from "make it better".

### Try it

1. Ride into a park: there's one close to the start, just east of the first road.
2. Press `M` until it rains, and watch the grass and trees move faster.
3. In `qualitySettings.ts`, try `grassTufts: 8000` on High.
4. In `GrassField.tsx`, change `OPEN_GROUND_DENSITY` to `200` for a greener city.

### Next

Fences and gates for parks, or the open shop fronts from before.

## 2026-11-07: Entry 23, realistic trees, grass, vehicles and people

### What I did

**Trees and grass**

- Canopies are now dozens of cards showing real photographed jacaranda fronds, around a dark solid
  core. Trunks have bark and branches. Low keeps the simple solid trees.
- Grass tufts are crossed cards showing real photographed clumps.

**Vehicles**

- Sedans and hatchbacks are built from a side view given width, with proper wheels, windows, bumpers
  and lights. Autos have a curved hood, and motorbike riders joined the traffic.
- Headlights and tail lights come on after dark.

**People**

- Men in shirts and trousers, and women in long kurtas or sarees, with hair and varied skin tones.
- Arms and legs swing as they walk.

The fronds, grass and bark are CC0 from Poly Haven. The full jacaranda model has 312,356 polygons,
so we use only its photographs, on a few hundred triangles per tree.

### What I checked

| Check | Result |
| --- | --- |
| 200 deliveries with traffic | All passed |
| 24 simulated minutes of traffic | 0 vehicles in buildings, closest pass to a pedestrian 1.83 m |
| Vehicle pairs closer than 1.5 m | 119 pair-frames in 86,400 |
| Rider can't pass through a vehicle | Pass |
| Screenshots | Park, day and night street, close-up traffic |

**This was a heavy change.** See the numbers in the next section.

**Bugs found on the way:**

- My grass crop failed silently, which showed the wrong part of the image.
- 150 cards per tree was far too many, so I halved it.
- The people's shader didn't compile, so none appeared. The car shot looked fine, and only the
  browser's error log showed it. In this Three.js version `vColor` is a `vec4`.
- Headlights were far too strong.

### What it cost

Measured at the normal start, on the CPU test renderer:

| Level | Triangles before | Triangles after | FPS before | FPS after |
| --- | --- | --- | --- | --- |
| High | About 144,000 | 235,717 | 5.0 | 3.0 |
| Medium | 64,579 | 101,611 | 7.7 | 4.0 |
| Low | 25,995 | 34,883 | 21.7 | 14.3 |

That's about 35–50% slower here, the largest drop of any change so far. A CPU renderer suffers
most from see-through cards, and a real GPU handles them far better, so these numbers likely
overstate it. Even so, **this is the change most likely to be felt on your Mac**. If it is:

1. Turn off leaf shadows on High, which draw every card a second time.
2. Lower `grassTufts`.
3. Use leaf cards only for nearby trees, with simple shapes further away.

Also not done: tree shadows don't sway, faces have no features, and people don't stop or stand
around. The grass and leaf textures add 1.1 MB, for 2.9 MB of textures in all.

### Lesson 87: cards

Games don't model every leaf. A **card** is a flat rectangle showing a photo, and `alphaMap` cuts
the background away. Dozens of them, facing different ways, read as a full tree from a few hundred
triangles. Our source tree has 312,356.

### Lesson 88: `alphaTest`

```tsx
<meshStandardMaterial map={color} alphaMap={alpha} alphaTest={0.45} />
```

Any pixel below the cutoff isn't drawn at all. Unlike true transparency, this needs no sorting, and
shadows get the leaf shape too. But the GPU still has to run the shader for every hidden pixel, so
stacked cards are costly. That's called **overdraw**.

### Lesson 89: light and shade, not colour

To make a green photo pink, multiplying won't do: green × pink is dark. So the shader first turns
the photo to grey, keeping only light and shade, and each tree's colour then tints that. One photo
makes every tree in the city, flowers included.

### Lesson 90: joints in a shader

Each vertex of an arm stores its joint's height and which way it swings. The shader rotates it by
`sin(stride)`, so 36 people walk for almost no JavaScript.

### Lesson 91: read the error log

A screenshot of a street with no people in it looks like a street with no people in it. Only the
browser's log said that the shader had failed. Always check the log, even when a picture looks fine.

### Try it

1. Ride along a tree-lined road at sunset, and watch for the dappled shade.
2. In `foliage.ts`, set `CARDS_PER_AREA` to `0.3` and `1.2`, and compare FPS.
3. Press `N` until dark, and watch the headlights go by.
4. In `trafficLogic.ts`, change `VEHICLE_MIX` to fill the road with autos.

### Next

Your FPS on High and Medium decides this.

## 2026-11-07: Entry 24, cars that look like cars

### What I did

You said the cars weren't as realistic as the trees, and that was fair. The trees use real photos, and
the cars were shapes I'd built by hand. I looked for a real CC0 car, but Poly Haven only has one
under a tarp, and Kenney's are cartoon-style. So I rebuilt the sedan and hatchback:

- **A sculpted body:** slices along the car, joined into a smooth skin with curved surfaces.
- **Reflections:** paint and glass mirror a tiny painted world of sky, skyline and road. This
  also went onto autos and motorbikes, more weakly.
- **Painted detail:** door seams, handles, windows and pillars, wheel arches, grilles, lights and
  blank number plates.
- **Better wheels:** tyres with a metal rim and hub.

### What I checked

| Check | Result |
| --- | --- |
| Cars close up, front and back | Curved bodies, glass and lights all read correctly |
| Traffic tests | Vehicles and rider rules all still pass |
| Type check, lint, build, browser errors | All clean |

I tested the look by making all traffic cars for one run, then put the normal mix back.

**Not perfect:** there are no real car photos behind this, so up close it's clean, like a new toy,
with no dirt or dents. Autos and motorbikes didn't get this treatment. Their riders are still simple
shapes, and so is your own scooter, which is now the least realistic vehicle on the road.

### Lesson 92: why shiny things look real

Most of what makes a car look like a car isn't its shape. Your eye reads the reflection sliding over
curved paint. An **environment map** is a picture of the surroundings that a material mirrors.
Ours is a small scene rendered once by `PMREMGenerator`, which also prepares blurry versions for
rough surfaces. It's only used for vehicles, and dims with the light at night.

### Lesson 93: lofting

Instead of stacking boxes, describe slices along the length, and join them up. That's **lofting**,
and it's how real boats and cars were drawn. Sharing points between slices gives smooth normals.

### Lesson 94: blueprint projection

A curved body needs painting without a modelling tool. So each triangle checks which way it mostly
faces, and takes its UVs from that view in the image: side, top, front or back. It's how a car's
four blueprint views wrap into a whole car.

### Lesson 95: small tests of big changes

Traffic is random, so the cars I needed to inspect weren't in shot. A temporary change to
`VEHICLE_MIX`, plus a burst of screenshots, found them in one run.

### Try it

1. Watch a car turn in front of you, and see the reflection slide over it.
2. In `Traffic.tsx`, set `REFLECTION_STRENGTH` to `2.5` for a showroom shine.
3. In `carModel.ts`, change the numbers in `SEDAN` to build your own car.

### Next

Your own scooter and rider, then autos and motorbikes.

## 2026-11-07: Entry 25, collisions by weight, and crashes

### What I did

- **Everything that moves now has a weight,** from a 110 kg parked scooter to a 1,200 kg sedan. A hit
  shares speed by weight using the standard collision formula, not a rule for each pair.
- **Parked scooters are loose:** they get thrown, tip over, and can knock each other down.
- **Motorbikes fall over** for a few seconds, and vehicles ease back to their lane afterwards.
- **Crashes:** a wall hit above 7 m/s, or a hit that changes your speed by over 6.5 m/s. You lose
  control, fall, and the camera shakes, and the screen says the package is safe.
- **A clean ride bonus:** +10 credits for a delivery with no crashes. Crashes cost nothing else.

Buildings, trees, lamps and benches never move. Pedestrians still step aside and can't be hit.

### What I checked

Ridden at a stationary vehicle at 14 m/s, in a simulation:

| Hit | How far it moved | Rider |
| --- | --- | --- |
| Sedan | 0.78 m | Crash |
| Hatchback | 0.96 m | Crash |
| Auto | 1.94 m | Crash |
| Motorbike | 3.14 m, and fell over | Crash |
| Parked scooter | 7.2 m, and fell over | Kept going, no crash |

| Check | Result |
| --- | --- |
| Gentle bump, or slow wall hit | Not a crash |
| Row of 5 parked scooters | All moved, 4 fell |
| Crashes and base pay | Base, XP and on-time bonus unchanged by 5 crashes |
| 200 bot deliveries with traffic | All finished, 0 inside walls, no invalid numbers |

**Not checked:** none of this has been run in a browser yet, so I haven't seen a crash, the fall, the
shake or the crash message. The bot crashed 222 times in 200 deliveries, because it doesn't steer
around traffic. It knocked over 0 parked scooters on that ride, so loose scooters are only tested
in the lab cases above.

### Lesson 96: momentum decides who moves

In a collision, both things feel the same push. Speed change is push ÷ mass, so the lighter thing
changes speed more. That one line gives you "the car barely moves and the scooter bounces" with
no special cases.

### Lesson 97: what a physics engine would add

This code treats everything as flat circles and capsules on the ground. It's not a physics engine.
Nothing leaves the ground, so nothing can flip, roll or tumble. An engine such as Rapier handles
real 3D bodies, and that's the question to settle next.

## 2026-11-07: Entry 26, real crash physics with Rapier

### What I did

- **Installed Rapier,** a physics engine, as `@dimforge/rapier3d-compat`. It loads as its own file,
  1.67 MB compressed, and adds no known security problems.
- **Used it only for crashes.** Your scooter and normal traffic stay arcade, and appear in the physics
  world as shapes that push things but can't be pushed.
- **Parked scooters near you are real bodies,** resting until something touches them.
- **A hard hit turns a vehicle into a real body** that can flip and roll. It then rejoins traffic. A
  wreck that can't drive away is cleared once you're 30 m away.
- **All walls, trees, lamps and benches** went into one fixed mesh.

This replaces the flat sliding and fake tipping from Entry 25. Weights, crashes, the clean ride
bonus and base pay all work as they did.

I used the core library, not the `@react-three/rapier` wrapper I'd mentioned. The wrapper suits objects
declared in React, but ours appear mid-frame. Going direct also means it can be tested without a browser.

### What I checked

Riding at a stationary vehicle, against real Rapier:

| Hit at 14 m/s | Moved | Height reached | Result |
| --- | --- | --- | --- |
| Sedan | 0.52 m | 0 m | Stays upright, rejoins traffic in 1.2 s |
| Hatchback | 0.69 m | 0 m | Stays upright, rejoins in 1.3 s |
| Auto | 2.19 m | 1.57 m | Tips past its side, stays a wreck until you leave |
| Motorbike | 7.60 m | 2.58 m | Rolls right over, back up after 4 s |
| Parked scooter | 14.1 m | 2.62 m | Lands on its side, and you ride on with no crash |

| Check | Result |
| --- | --- |
| Browser, riding into parked scooters at 20 km/h | They flew, tumbled and lay on their sides, no errors |
| A parked scooter left alone | Doesn't move at all |
| Thrown scooter meets a wall | Stops at it |
| 40 bot deliveries, with traffic | All finished, 0 inside walls, no invalid numbers |
| Physics and traffic cost | 0.058 ms per frame on average |

**Not checked:** I haven't seen a crash in the browser, as my test ride was too slow for one, so the
fall, the shake and the crash message are unseen there. Crashes were tested only in simulation. The
bot knocked over only 1 parked scooter, so that's tested mostly in the lab cases.

**One thing to watch:** the worst single frame in that ride took 233.6 ms, against 2 ms in the run
before. I don't know why, and it didn't repeat in a way I could study. If you see a sudden hitch,
especially on the first crash, tell me.

**Known gaps:** pedestrians aren't in the physics world, so flying objects pass through them. Lying
scooters stay down, for now. Your scooter's own fall is still scripted, by design.

### Lesson 98: three kinds of body

| Type | Moved by | Used for |
| --- | --- | --- |
| Fixed | Nothing | Ground and walls |
| Kinematic | Your code | Your scooter and normal traffic |
| Dynamic | Forces and collisions | Anything that's been hit |

Mixing them is how a game gets arcade handling and real crashes together.

### Lesson 99: sleeping bodies

A body at rest "sleeps", and costs almost nothing until something touches it. That's why dozens of
parked scooters add almost no cost.

### Lesson 100: test the join, not the parts

Rapier was perfect alone, and my hit code was fine alone. Together, a parked scooter slid 45 m like it
was on ice, as the physics shape reached it before my hit check fired, and shoved it along. The bug
was in the order the two parts met. Tracing one object on its own is what showed this.

### Try it

1. Ride into the parked scooters outside a shop, at different speeds.
2. Hit a motorbike, then an auto, then a car, and compare.
3. In `trafficLogic.ts`, raise `throwUp` to `0.9`.
4. In `crashPhysics.ts`, set `GRAVITY` to `-1.6` for crashes on the Moon.

### Next

Your scooter and rider, or letting flying things hit pedestrians if you want that.

## 2026-11-07: Entry 27, your scooter and rider

### What I did

The old scooter was a stack of boxes with no rider at all. Now:

- **The scooter** has a sculpted, glossy body, leg shield, seat, mudguard, cowl, alloy wheels with
  round tyres, forks, mirrors, a working brake light, and a clean, unbranded delivery box.
- **The rider** wears a helmet with a reflective visor. Hands stay on the grips as the bars turn,
  the left foot drops to the ground when you stop, and they crouch at speed and lean into bends.

### What I checked

Type check, lint and build pass, and the browser shows no errors. I viewed it from the side and from
the normal camera, using a temporary camera change, since reverted.

**Not checked:** I haven't watched it move, so I haven't seen the steering arms, leaning, crouch or
the foot coming down. Crashes still tip the rider over with the scooter.

### Lesson 101: inverse kinematics

Normally you rotate a joint and see where the hand ends up. **Inverse kinematics** works backwards: you
say where the hand must be, and solve for the elbow. Two fixed bones can only meet on a circle, so
`findJoint` uses the triangle's sides to place it, and picks the side a real elbow would bend to.

My first rider's arms were dead straight, because the seat was too far from the bars for the arm
length. IK can't bend what's already at full stretch, so the fix was the pose, not the maths.

### Lesson 102: lofting again

The scooter's panels are the car's trick, with rounded square slices called superellipses. The
`power` number moves a slice between a circle and a square, which is how plastic panels get their
soft corners.

## 2026-11-07: Entry 28, different buildings look different

### What I did

Every building used to be the same box with the same window. Now each one is a house, apartment
block, shop, office or civic building, and each kind has its own walls, colours, height and night
lighting:

| Kind | In the play area | How it looks |
|---|---|---|
| House | 1,256 | 1 to 3 floors mostly, bright paint, small grilled windows |
| Apartment | 110 | 4 to 6 floors, balconies, open stilt parking at street level |
| Shop | 157 | Display windows and shutters at street level, wide windows above |
| Civic | 18 | Long window bands, a sunshade and a painted stripe |
| Office | 4 | Glass walls, 4 to 7 floors, no water tanks |

The map only names about 4% of buildings, so `classifyBuildings` in `buildingKinds.ts` works down from
the surest clue to the weakest: the building's own tags, a mapped shop or school beside it, the area
it stands in, then its size. The window drawing moved to `facadeTextures.ts`.

I also fixed an older bug where lit windows ran in solid vertical columns.

### What I checked

Type check, lint and build pass. I counted the kinds by running the real code on the real map. In
headless Chrome I saw the whole town from above by day, and one street at night.

**Not checked:** shops, offices and civic buildings at street level, daytime street level, Low
quality, and the frame rate on a real graphics card. Sizes are a guess at use: a big building with
no clues becomes apartments, even if it's really something else.

### Lesson 103: one material, one draw call

A draw call can only use one material, so splitting the city by look means more of them. There were
37 building meshes before and 153 now, before Three.js skips what's off-screen. Low quality has no
window textures, so nothing tells the looks apart, and `createCityLayers` puts everything back in
one layer there.

### Lesson 104: a floor can be its own mesh

A real building's street level rarely matches its upper floors. `createBuildingParts` extrudes the
same outline twice, once for the ground floor and again for the rest, each with its own texture. A
hidden roof is left where they meet, which costs a few triangles.

### Lesson 105: read the data before you design around it

The obvious plan was "switch on the `building` tag". But 96% of those tags just say `yes`, so that
plan would have changed almost nothing. Shops are usually mapped as dots beside a building, which is
why joining dots to their nearest building found far more of them.

### Lesson 106: a hash isn't always random enough

`hashString` turned `0,0` and `0,1` into almost the same number, because a change to the last
character barely reaches the top digits, and those decide the result. So each row of windows matched
the one above it. Hashing the hash spreads that change through every digit.

### Try it

1. Press N until it's night, then look under an apartment block for the tube lights.
2. In `buildingKinds.ts`, raise `LARGE_HOME` to `800` and watch apartments turn back into houses.
3. In `facadeTextures.ts`, change the stripe colour in `paintCivic`.
4. Set `litShare` to `1` on `office` for a tower with every light on.

### Next

Silhouettes, as every kind is still a straight-sided box. Roof parapets or set-back top floors would
do the most.

## 2026-11-07: Entry 29, a real city kit on real outlines

### What I did

I used Quaternius's Downtown City MegaKit (CC0) in three ways:

- **Real wall textures.** Apartments, offices and civic buildings now have concrete under the paint,
  and shop upper floors have brick.
- **Details.** Cornices and a door on apartments, shops, offices and civic buildings, plus up to one
  planter beside the door. Planters are solid.
- **Walls built from pieces.** Shops and offices get 2 m kit pieces, floor by floor, around their real
  map outlines.

The kit is 244 MB and the game needs about 1% of it. `scripts/prepare_city_kit.py` packs 12 pieces
into a 1.7 MB `city-kit.glb`, and `cityKitPlacement.ts` decides where each one goes.

| Quality | Kit shown | Most triangles it can add |
|---|---|---|
| Low | Planters | 29,000 |
| Medium | Plus cornices and doors | 457,000 |
| High | Plus whole walls | 1,388,000 |

### What I checked

Type check, lint and build pass. In headless Chrome on High I saw a shop street by day, an office by
night, and the whole town from above. A first version crashed on load in a way the type check
couldn't see, and rendering it is what found that.

**Not checked:** Low and Medium, the frame rate on a real graphics card, an office from street level
by day since I lightened its glass, and riding into a planter. Walls that face another building
closely are skipped, so some buildings have a kit front and a painted side.

### Lesson 107: instancing

Instancing sends one shape to the GPU once, plus a list of positions, then draws it thousands of
times in one call. The game places 15,291 pieces. `CityKit.tsx` uses `InstancedMesh`, with one mesh
per piece, per material and per 320 m square, so faraway squares can be hidden.

### Lesson 108: fit the piece to the wall, not the wall to the piece

A wall of 7.3 m doesn't divide by 2 m. `findEdges` fits 3 pieces and stretches each to 2.43 m. Rounding
down keeps the stretch small, and nobody notices a window 20% wider, while a gap is obvious.

### Lesson 109: a model is more than it looks

Each window piece held an inner wall we'd never see, a fake interior needing a custom shader, two sets
of texture coordinates and paint masks. Stripping those is why packing a kit yourself pays off.

### Lesson 110: glass without reflections goes black

Real glass mostly shows you the sky. Three.js doesn't do that unless you give it a picture of the
surroundings, so my first offices were black slabs. Pale blue stands in for the sky by day, and
`updateWindows` dims it as night falls, or it would look lit.

### Lesson 111: types describe what you said, not what happens

`useTexture` is typed to hand its callback the same shape you passed in, but at runtime it gave an
array. TypeScript was happy and the page crashed. Only running the code shows this.

### Try it

1. Switch between Low, Medium and High, and watch the shop walls change.
2. In `cityKitPlacement.ts`, set `LIT_CHANCE` to `100` and go out at night.
3. Change `apartment`'s cornice to `'Cornice_Trim_Center'` in `STYLES`.
4. Add `ground` and `upper` to `apartment` in `STYLES`, and see how it looks in brick.

### Next

Check the frame rate on your Mac on High. If it's fine, your car models come next.

## 2026-11-07: Entry 30, real Indian traffic

### What I did

Traffic now uses real models: a sedan, hatchback, SUV and MPV, an auto, and three kinds of pedestrian.
SUVs and MPVs are new vehicle kinds with their own size and crash weight.

The downloads held about 5 million triangles, so `scripts/prepare_traffic_models.mjs` bakes them into
one 2.7 MB file. Cars end up at 12,000 to 14,000 triangles, and people at about 3,500 to 4,000.

| Step | Why |
|---|---|
| Shrink-wrap the cars and the woman | Gives one clean skin, and interiors vanish |
| Flat paint colours on vehicles | Printed badges can't survive it |
| Mark the paint | Only paint takes a car's colour, so glass and tyres keep theirs |
| Work out limbs from the bones | The walking shader needs to know what swings |
| Stand people on the ground, facing forward | The files disagree on scale and direction |

### What I checked

Type check, lint and build pass. I viewed every model from the front and back. The game loads them
with no errors, and you've seen autos running in your browser, which is how the backwards auto got
caught.

**Not checked:** people walking, night headlights on the new sizes, crashes with SUVs and MPVs, Low
and Medium, and frame rate. My one in-game shot had no traffic in it.

**Known issues:** the man's long white cloth covers his torso, as it does in the file. Shapes are still
recognisably real cars, even without badges. One of the two women in `south_indian_women` was left
out, because her hair mesh is named after a game character, which suggests it was ripped. Entry 31
removes the other one too.

### Lesson 112: triangle count isn't the whole story

My first cars hit the target and looked crash-damaged. Simplifying works by collapsing edges on a
continuous surface, and a car is hundreds of overlapping panels. Good input matters more than a
clever setting.

### Lesson 113: rebuild instead of reduce

A shrink-wrap throws the mesh away. It fills space with tiny cells, floods in from outside so the
inside is never reached, makes a new skin, then snaps it onto the original. The same steps removed
interiors, joined panels and made a mesh that simplifies well.

### Lesson 114: one flood needs thick walls

A gap between two panels is enough for the flood to leak into the car. Thickening the walls before
flooding, then taking the thickness off again, is called a morphological closing.

### Lesson 115: instancing and skinning don't mix easily

Bones are normally worked out for each character, which is costly for a crowd. Here each vertex just
stores how much it swings and from where, so one shader animates everyone. It can't bend an elbow,
but nobody watching a passer-by will notice.

### Lesson 116: check a guess against the model

My "bring the arms down" step assumed every model stood in a T-pose. The man's skeleton was already
relaxed, so it made him worse. Printing his joint positions showed it in a minute.

### Lesson 117: a viewer pays for itself

Without a page showing every model side by side, I'd have judged these by triangle counts, which
said the crash-damaged cars were fine.

### Try it

1. In `prepare_traffic_models.mjs`, set a car's `triangles` to `3000` and rerun it.
2. Change `wrapCell` to `0.08` to see what cell size does.
3. In `Traffic.tsx`, add a colour to `CAR_COLORS`.
4. Reorder `VEHICLE_MIX` in `trafficLogic.ts` for more SUVs.

### Next

Check walking and crashes while riding. The old `carModel.ts` shapes, `createAutoGeometry` and
`peopleShapes.ts` are no longer used, and can go once you're happy.

## 2026-11-07: Entry 31, wheels that turn, and a safer stand-in

### What I did

- **Wheels** are now their own parts. They roll as a vehicle moves, and front wheels steer into bends.
  This covers all four cars and the auto, but not motorbikes or parked scooters.
- **The auto** was one solid piece, so the bake cuts holes where its wheels were and borrows the
  hatchback's wheel, scaled to fit.
- **The woman** from `south_indian_women` is gone, as the file's other figure had hair that looked
  ripped from a game. The older woman built in code stands in until there's a replacement.

### What I checked

Type check, lint and build pass, and the game loads with no errors. In the model viewer every wheel
sits in its arch. I worked through the spin direction by hand for both sides.

**Not checked:** I haven't watched a wheel roll or steer, as my in-game shots have no traffic in them.
If they spin backwards, flip the sign in `updateWheelState`.

### Lesson 118: animate parts, not vertices

Limbs use a shader because a person's joints stay connected. A wheel is a separate object, so an
ordinary instanced mesh works, and it costs 4 extra matrices per car per frame. Choosing the simple
tool for each job beats forcing one trick onto both.

### Lesson 119: derive motion, don't store it

Traffic never had to learn about wheels. `updateWheelState` compares where a vehicle is with where it
was: distance divided by radius gives the roll, and how fast it's turning gives the steering angle.
Anything that moves a vehicle now turns its wheels for free.

### Lesson 120: the same wheel, turned around

Only one wheel per car is stored. The far side is that wheel turned 180 degrees, which reverses its
spin, so `isLeft` negates the roll to match.

### Lesson 121: measure, don't estimate

I placed the auto's front wheel by eye and got two overlapping tyres. Finding the lowest points of the
mesh showed where each tyre really meets the ground, and the fix took one number.

### Try it

1. Follow a car around a corner and watch its front wheels.
2. In `Traffic.tsx`, raise `MAX_STEER` to `0.9` for very dramatic turns.
3. Lower `STEER_EASING` to `2` and see the steering lag behind.

### Next

A replacement woman, with a clear origin. Then the bike, if you want your Yamaha download used.

## 2026-11-07: Entry 32, black and white delivery bikes

### What I did

A real delivery bike model was baked in black or white, with a white box and rolling wheels. Its blue
paint and number plate are gone, and the rider was rebuilt from joints measured off the bike. Entry 33
moves this bike to the player, and traffic takes the Yamaha.

I also fixed a bug from Entry 30, where car paint was multiplied by the model's original paint. That
was near-black on at least the sedan, so its colour would barely have shown.

The Yamaha was held back at this point, because it's CC-BY-NC-SA. Entry 33 uses it, on your decision.

### What I checked

Type check, lint and build pass, and the game loads with no errors. In the model viewer I've seen both
bike colours, with their riders, from the front and back.

**Not checked:** bikes in moving traffic, and how the rider looks when a bike leans or crashes.

### Lesson 122: check a licence before the work, not after

The `license.txt` in a Sketchfab zip takes seconds to read. CC-BY needs credit, NC bans commercial use,
and SA spreads its licence to your edits. It's now the first step for every model.

### Lesson 123: multiply, don't replace

A shader's tint multiplies what's there. White times red is red, but near-black times red is still
near-black. So anything meant to be tinted must be stored white. My viewer set the colour directly,
which hid the bug that the game would show.

### Lesson 124: a better model exposes what's next to it

The old rider looked fine on a bike made of boxes, because both were equally rough. On a detailed bike
the same rider looked broken. Detail has to rise together.

### Try it

1. In `Traffic.tsx`, add a third colour to `BIKE_COLORS`.
2. In `vehicleShapes.ts`, move the rider's hands by changing the joints in `createBikeRiderGeometry`.

### Next

A replacement woman. Parked scooters still use the old shape, and could use a matching model.

## 2026-11-07: Entry 33, your own delivery bike, and Yamahas in traffic

### What I did

- **You** now ride the delivery bike: black paint, a white box, and a white jacket and helmet. Its
  front end is a separate part, so steering and leaning work as they did on the scooter. The rider's
  hands, hips and feet were moved to fit it, and the wheel radius is now 0.296 m.
- **Traffic bikes** are Yamahas in five colours, with a crouched rider fitted to their low bars.

**Licence warning:** the Yamaha is CC-BY-NC-SA, so no commercial use, and edits share its licence.
This was your decision. It lives in its own `yamaha.glb` with its own credit, so replacing it later
means changing one file. Replace it before anything commercial.

### What I checked

Type check, lint and build pass, and the game loads with no errors. In the game I saw you on the bike
from behind, standing still. In the model viewer I saw the Yamaha with its rider in two colours.

**Not checked:** riding it. That means steering, leaning, the rider's arms following the bars, the foot
coming down at a stop, and bikes in traffic. The handling itself didn't change, but the bike is a
different shape from the scooter.

### Lesson 125: pivots live where the part turns

The bike's front end is modelled in the bike's own space, so turning it directly would spin it around
the middle of the bike. `Scooter.tsx` moves a group to the steering axis, moves the part back by the
same amount inside it, and turns the outer group. That two-group trick works for any hinge.

### Lesson 126: keep different licences in different files

Share-alike terms follow edits of that model. Keeping the Yamaha in its own file makes the boundary
obvious, and makes it easy to remove.

### Lesson 127: names can lie

`plastic_d8` sounded like the bodywork, but it was the black fairing, and a plain-sounding
`Material.004` was the blue paint. Reading the colours took a minute, and guessing cost a rebake.

### Try it

1. In `Scooter.tsx`, change `PAINT_COLOR` to white for a fully white bike.
2. In `Rider.tsx`, change `JACKET` to black.
3. In `Traffic.tsx`, edit `BIKE_COLORS`.

### Next

A replacement woman, and a check of everything above while riding. `scooterShapes.ts` is no longer
used, and can go along with the other old shapes.

## 2026-11-07: Entry 34, no more getting stuck after a crash

### What I did

Fixed a bug where you couldn't accelerate until you reversed. With your nose against a wall, within
about 37 degrees of head-on, your speed was wiped every frame, and steering needs speed to work. So
you could neither move nor turn, and a crash's spin often left you in just that spot.

Now, holding the throttle against something swings the bike along it, towards the way you're steering,
or the nearest way if you aren't. The same applies when you're pressed against a vehicle or a loose
parked scooter.

### What I checked

I ran the real controller in a test script, before and after, for 3 seconds of holding W:

| Situation | Before | After |
|---|---|---|
| Up to 30 degrees off head-on | Stuck, moved about 0.5 m | Free in about 1.2 s |
| Steering away from the wall | Stuck | Free in about 1.2 s |
| Nose on a planter or tree trunk | Not tested | Free in about 0.9 s |
| Inner corner, with steering | Not tested | Free in about 0.6 s |

With no keys pressed against a wall, the bike stays put. Fast hits still crash, as that code didn't
change. Type check, lint and build pass.

**Not checked:** riding it for real, and pressing against a vehicle, which only went through the type
check. In an inner corner, holding W with no steering can still leave you bouncing between the walls,
so steer or reverse there.

### Lesson 128: one rule can undo another

"Steering fades at low speed" stops a parked scooter spinning on the spot. "Head-on hits stop you dead"
is fair too. Each is sensible alone, and together they trap you. Look for bugs where rules meet.

### Lesson 129: a magic number can hide a shape

`headOnThreshold: 0.8` looks like a tuning value, but it's a cosine, and arccos(0.8) is the 37 degree
line the bug sat on. The test showed stuck at 30 degrees and free at 40, which pointed straight to it.

### Lesson 130: reproduce it before you fix it

"Sometimes" bugs feel random until you remove the randomness. A short script placing the bike at set
angles turned "sometimes" into an exact rule, and then proved the fix on the same cases.

### Try it

1. In `vehicleConfig.ts`, lower `wallNudgeRate` to `0.5` and ride into a wall.
2. Raise it to `6` to feel it snap around.

### Next

Your report on how the new bike rides, and a replacement woman.

## 2026-11-07: Entry 35, traffic lights

### What I did

Added working traffic lights at 16 junctions. The map marks no signals, so `trafficSignals.ts` picks
junctions where at least two main roads meet, and keeps them 130 m apart.

- **Timing:** roads facing each other share a turn, with 10 s of green, 2.5 s of yellow and 1.5 s when
  everyone waits on red, so a junction can clear.
- **Traffic obeys them.** Vehicles brake smoothly to a stop line. On yellow, they stop only if they
  comfortably can.
- **Poles** stand on the left kerb, with one set of lights over the road and a lower set you can see
  when you've stopped at the line.

Nothing forces you to stop, and there's no penalty for running a red. Pedestrians ignore the lights.

### What I checked

I ran real traffic on the real map for 15 simulated minutes, about 120 km of driving:

| Crossings | Count |
|---|---|
| On green | 138 |
| On yellow | 7 |
| Red-light runs | 0 |
| Past the line just after spawning, ignored | 3 |

The longest wait was 15.5 seconds, so nothing gridlocked. That run used the lights' final logic and
spacing. In the game I saw the lights by day and night, and the stop lines in the right place on each
approach. Type check, lint and build pass.

**Not checked:** watching traffic queue at a light with my own eyes, and frame rate. There are 53 poles,
but they're very cheap to draw.

### Lesson 131: new rules meet old rules

Vehicles had a "patience" rule: after 4 seconds, go anyway. Unchanged, it would have sent every car
through every red. So the light caps the speed after patience is applied, and time at a light doesn't
count as waiting, or the whole queue would barge off together on green.

### Lesson 132: stopping smoothly

The speed that stops you in time is the square root of 2 x braking x distance. That one line gives a
natural slow-down, with no timers or states to manage.

### Lesson 133: test what you actually mean

My first test said 35 red crossings, but they were cars creeping to the line at 0.2 m/s. The next said
11, and those were real, because vehicles couldn't see past a fork. Defining "ran a red" properly is
what found the true bug.

### Lesson 134: when you can't see it, make it impossible to miss

I blamed the stop line's height, then thought a pale band on the road was it. Painting it bright
magenta proved it wasn't, because nothing magenta appeared. Roads here use `polygonOffset`, which nudges
what the depth test sees, so being physically above the road wasn't enough. Only a stronger nudge wins.

### Try it

1. In `trafficSignals.ts`, set `green` to `4` and watch the queues grow.
2. Change `MIN_JUNCTION_GAP` to `60` for many more lights.
3. Sit at a red, then watch the cross traffic go.

### Next

Whether running a red should matter, such as a small hit to your performance score. Your call.

## 2026-11-07: Entry 36, the rider's phone

### What I did

The map, order details, time, weather and earnings now live on a phone, which sits small in the
bottom-left. Press P or click it to bring it up, with a wider map and the full order. The game keeps
running, so glancing at it while riding has a real cost.

- **Tucked away:** map, route, time, weather, the current stop, its distance and the on-time timer.
- **Raised:** also the order number, delivery type, both stops, what it pays, and your credits and XP.
- **Pay** shows the guaranteed amount with bonuses as extras, matching the rule that a delivery
  always pays its base reward.

The old mission, wallet and clock cards are gone, and `PhoneMap.tsx` replaces the round `Minimap.tsx`.
Speed, the direction arrow and crash notices stay on screen. bengalooru.com redirected to a domain sale
page, so this is an original design from the description.

### What I checked

Type check, lint and build pass. I saw it tucked and raised by day, raised at night with the moon icon,
and the title screen. The route and stop are drawn from live game data.

**Not checked:** the rain and cloud icons, the red timer, a long stop name, the delivered state, the
drop-off leg, and whether the raised phone gets in the way while riding. A window under about 660 px
tall shrinks the raised phone, and its contents could get cramped.

### Lesson 135: guard every exponential

`1 - Math.exp(-rate * delta)` is a lovely smoothing formula, but a negative `delta` makes `exp` explode.
Once one value turns into `NaN`, it stays `NaN` forever, as anything multiplied by it is `NaN` too.
Clamping `delta` to zero or more stops it at the source.

### Lesson 136: canvases have two sizes

A canvas has its pixel size (`width`) and the size CSS shows it at. If they differ, it stretches and
blurs. `fitCanvas` matches them each frame. Setting `width` wipes the canvas, so it only sets it when
the size has really changed.

### Lesson 137: only the tree you can see

Text scaled down with a CSS transform gets tiny, so the phone changes its real size and swaps what's
shown. Different sizes need different content, not just different scale.

### Lesson 138: clean up only what you wrote

Removing `!important` across the whole stylesheet also removed three rules on the title screen that
weren't mine. Searching first would have shown that. Fixes should be as narrow as the mistake.

### Try it

1. In `PhoneMap.tsx`, change the second number in `METRES_PER_PIXEL` to `3` for a much wider raised map.
2. Change `PHONE_KEY` in `Phone.tsx` to `'Tab'`.
3. Change `HURRY_SECONDS` to `60`.

### Next

Your thoughts on the phone while riding, and whether it should show more, like a list of past orders.

## 2026-11-07: Entry 37, the dark store and the handover

### What I did

Deliveries are now one loop, from a single dark store:

- **The dark store** is a real building on 27th Main Road, picked by `findDarkStore`. It gets a lit
  sign, an open front with shelves of parcels, a striped riders' bay, parked bikes and a staff member.
- **Pickup:** stop at the store, and staff walk out and put the parcel in your box.
- **Customers** wait at the kerb, and turn to watch you once you're close.
- **Handover:** the bike holds still and the camera swings side-on. The customer walks up, the parcel
  arcs from your box to their hands, they hop among confetti, and the reward appears as they walk off.

The on-time clock stops when you arrive, and pay is worked out then, so the animation can't lose you
a bonus. Credits are added once the parcel lands.

I also fixed the man's walk, which pedestrians share. His hem counted as a leg, and his arms swung too
far. A rebake was all it took.

### What I checked

Type check, lint and build pass. I stepped through the real game frame by frame with a script: store,
pickup, ride state, handover and reward, with no errors. I planned 500 orders on the real map: all
start at the store, with 232 local, 189 across town and 79 long haul.

**Not checked:** a real ride from the store to a customer. My test moved the customer beside the bike,
so `Delivered in 0:00` on my reward card is from that. Also unchecked: night, Low quality, traffic
during a handover, and the teen as a customer.

Software rendering ran everything very slowly, so I can't vouch for the timing. By the numbers, a
pickup should take a few seconds, and staff hurry when you stop far out. That may still feel long by
the tenth order.

### Lesson 139: a state machine for a show

`collecting` and `handingOver` are real mission phases. While one is active, there's no stop, so the
marker, route and clock all pause by themselves. The mission only moves on when `finishHandoff` is
called, and the animation owns that moment.

### Lesson 140: a cutscene is just a target

No camera rig was needed. `liveShot` holds where the camera wants to be, and `FollowCamera` blends
towards it. Everything in the game keeps running, so traffic carries on behind the moment.

### Lesson 141: test animations by stepping through them

One screenshot can't judge motion. Taking many frames found a camera aimed at the wrong spot, a parcel
hidden behind a person, and a broken walk. All three looked fine in the code.

### Lesson 142: fix the order, not just the symptom

The camera read the customer's place before the customer had moved there, in the same frame. Doing
things in the right order within a frame is a whole class of bug.

### Lesson 143: rare cases need counting

Trying a few orders by hand would have looked perfect. Planning 500 showed 2% of customers against a
wall on narrow streets. When something is random, test it in bulk.

### Try it

1. In `Handoff.tsx`, set `ARC_HEIGHT` to `2` for a much higher toss.
2. Change `CONFETTI_COUNT` to `200`.
3. Raise `STAND_OFF` to `3` so the parcel flies further.
4. In `DarkStoreBuilding.tsx`, change the name on the sign.

### Next

Your thoughts after a real run. A shorter pickup, or skipping it after the first few, could be next.

## 2026-11-07: Entry 38, a black T-shirt

### What I did

Your rider now wears a black T-shirt with SILK printed on the back in white. The sleeves stop at the
elbow, with bare forearms below, and the helmet's stripe turns black to match. Trousers became dark
blue jeans, as near-black ones would have made a black shirt on a black bike look like one dark shape.

### What I checked

Type check, lint and build pass. I saw it from the normal riding camera, where the lettering reads the
right way round, above the delivery box.

**Not checked:** the print while leaning or in a crash, and up close in the handover shot.

### Lesson 144: a print is a piece of the shape

Rather than a flat sticker, the print is a strip of the same cylinder as the torso, a hair larger, open
at the ends and covering only the back. So it curves with the body, and it leans with the rider because
it sits in the same group. `CylinderGeometry` takes a start angle and a length for just this.

### Try it

1. In `Rider.tsx`, change `SHIRT_PRINT`.
2. Raise `PRINT_Y` to move it up the back.
3. Change `SHIRT` to any colour.

## 2026-11-07: Entry 39, staff T-shirts and heavier lettering

### What I did

- **Staff** at the dark store now wear the same black T-shirt, with SILK on the back.
- **The lettering** on both shirts is now heavy, narrow and slanted, based on a reference image. It's
  built from the Impact font, squeezed and leaned over in `shirtPrint.ts`. It's a similar feel, not
  the same font as the reference. Without Impact, it falls back to Arial Black or Arial.

The rider and staff share one `shirtPrint.ts`, so there's a single place to change the shirt.

### What I checked

Type check, lint and build pass, and the game ran with no errors. I saw the staff from the front and
from behind, the print on their back, and the rider's new lettering.

**Workaround to know about:** I never found why the staff's print was hidden when drawn normally. A
depth map shows it should sit clear of the shirt, and a magenta test put it in the right spot, yet it
only appears with the depth test off. So it's drawn over the shirt, and shows only when their back
faces the camera within 30 m. Something passing in front of them could have the print drawn over it.
Staff face you when idle, so you'll mostly see it as they walk away.

**Not checked:** the print at a distance, at night, or with traffic passing in front.

### Lesson 145: be sure which side you're looking at

I spent several tries "fixing" a print on what may have been the staff member's front. They turn to
watch the rider when idle. Forcing a known direction for a test ends that kind of doubt.

### Lesson 146: sample points can lie

A simplified model has big triangles with few corners, so checking corners missed the real surface.
Rasterising the triangles gave a true depth map.

### Lesson 147: change one thing at a time

Magenta and depth-off proved the position. Then lettering with depth on showed it was the depth test.
Each run answered one question, and after that the fix was small.

### Try it

1. In `shirtPrint.ts`, change `PRINT_SLANT` to `0.4` for a faster lean.
2. Change `PRINT_SQUEEZE` to `0.65` for narrower letters.

## 2026-11-10: Entry 40, playing on a phone in landscape

### What I did

- **Touch controls.** On a phone, the left thumb gets ◀ ▶ to steer. The right thumb gets a big Gas
  button, Brake beside it and Drift above. They're in `src/ui/TouchControls.tsx`.
- **One input for both.** The buttons write into `touchInput` (`src/vehicle/touchInput.ts`).
  `useDriveInput` now combines keyboard and touch, so the scooter code didn't change.
- **Phone layout.** On touch screens, `<html>` gets a `touch` class (set in `main.tsx`), and the CSS
  at the bottom of `index.css` rearranges the HUD. The rider's phone moves to the top left and shrinks,
  the speed sits under Quality, the arrow is smaller and the credits line moves to the bottom middle.
  The bottom corners belong to the thumbs. `env(safe-area-inset-*)` keeps clear of the notch.
- **Landscape only.** Held upright, a "Turn your phone sideways" screen covers the game
  (`RotatePrompt.tsx`, shown by a CSS media query). On Android, Start riding also asks for full screen
  and locks it to landscape (`game/fullscreen.ts`). iPhone Safari allows neither, so there the prompt
  does the job.
- **Home screen.** `public/manifest.webmanifest` and the meta tags in `index.html` make it open full
  screen and in landscape when added to the home screen.
- **Phones start on Low quality.** A quality you've already picked is kept.
- **No zooming or selecting.** Pinch zoom, double-tap zoom, text selection and the long-press menu are
  off on touch screens, so a thumb held on Gas doesn't zoom the page.
- **Testing on a computer.** Add `?touch` to the address, for example `localhost:5173/?touch`, and
  the phone layout appears. The mouse works the buttons.

### Why

- **Buttons, not a joystick.** The scooter takes on/off controls (`DriveInput` is all booleans), so
  buttons match exactly. A joystick would give in-between steering that the controller would have to
  round off anyway.
- **Look up the button under the finger.** A plain `onPointerDown` on each button would break when a
  thumb slides from Gas to Brake. Touch pointers stick to the element they started on. So the code
  remembers each finger by `pointerId` and, on every move, asks `document.elementFromPoint` which
  button is under it.
- **`(pointer: coarse)` rather than screen width.** A narrow desktop window isn't a phone, and a big
  tablet is still touch. What matters is whether the main pointer is a finger.

### What I checked

Type check, lint and build pass. In Chrome with `?touch`, at about 844 × 303 and 1512 × 772:

- The title screen shows the touch controls and fits.
- Holding Gas reached 44 km/h in 2.5 s. Sliding the same finger onto Brake lit Brake and slowed to
  4 km/h. Lifting released everything.
- The raised phone fits above the steering buttons. On the shortest screen, its order details scroll.

**Not checked:** a real phone. That means the rotate prompt, full screen, the notch, multi-touch with
two thumbs, iPhone Safari's address bar and frame rate on Low. To try it on your phone, run
`npm run dev -- --host` and open the "Network" address it prints, on the same Wi-Fi.

### Lesson 148: the game loop reads, the UI writes

The scooter reads `input.current` every frame inside `useFrame`. It doesn't care who wrote it.
Keyboard handlers and touch buttons both just flip booleans in plain objects, outside React state. A
press therefore costs nothing: no re-render, no new object. Even the button's lit-up look is set
with `dataset.pressed` straight on the DOM for the same reason. In R3F, anything that changes many
times a second belongs in refs or plain objects, never `useState`.

### Lesson 149: a getter can merge two sources without copying each frame

`useDriveInput` returns `{ get current() { … } }`. It looks like a ref to the scooter, but each read
fills one reused object with `keyboard || touch`. That keeps the old interface and makes no garbage,
which matters because garbage collection pauses show up as stutters in a 60 fps game.

### Try it

1. In `index.css`, change `.touch-gas` to `width: 110px; height: 110px` for a bigger throttle.
2. Swap the order of the Brake and Gas buttons in `TouchControls.tsx`, and feel which suits your
   thumb.
3. Open `localhost:5173/?touch` and make the window taller than it is wide. The rotate prompt
   appears, because `orientation: portrait` only compares the window's height with its width.

## 2026-11-10: Entry 41, the real reason you couldn't ride off after a crash

### What I did

- **Fixed being unable to accelerate after a crash.** It wasn't the wall: Entry 34 fixed that one. Now
  anything slower than `STOPPED_SPEED` (0.05 m/s) counts as stopped, so the throttle drives instead of
  braking (`ScooterController.ts`, `applyControls`). Reverse got the same rule.
- **The shirts now say KILLS** instead of SILK (`SHIRT_PRINT` in `shirtPrint.ts`). Five letters are
  shrunk to fit by the existing `PRINT_MAX_WIDTH` rule.

### Why it happened

A crash sets the scooter spinning (`spin`) and sliding sideways (`slip`). Both fade by multiplying
by a little less than 1 each frame, so they get tiny but never reach exactly zero. Each frame the
scooter turns a hair, and some of that tiny slide ends up pointing slightly backwards. The speed
comes out as something like −0.00000001 m/s.

`applyControls` said: holding the throttle while going backwards? Brake to zero first. So every
frame it braked that speck to zero, and never got to the accelerating line. Reverse worked because
it took a different branch, which matches "I can't accelerate until I reverse".

Whether you got stuck depended on which way the crash spun you, which is why it only happened
sometimes.

### What I checked

I ran the real controller in a script. The scooter hit a parked car at 50 km/h at 33 different angles
and then held the throttle for 12 seconds:

| | Stuck afterwards |
|---|---|
| Before | 12 of 33 |
| After | 0 of 33 |

The wall crash tests from Entry 34 still ride away. Type check, lint and build pass.

**Not checked:** riding it in the game, and the KILLS print on screen.

### Lesson 150: floating point never quite reaches zero

`value *= Math.exp(-rate * dt)` is a smooth fade, but it only approaches zero. Any rule that asks
`if (speed < 0)` will see these crumbs. Compare against a small margin instead (an "epsilon" or a
"dead zone"), or snap the value to 0 once it's tiny.

### Lesson 151: when a fix doesn't fix it, find the second cause

Entry 34 fixed a real case of the same symptom, being pressed against a wall. This bug looked the same
from the saddle but happened in open road. Dumping the whole state at the stuck moment showed speed 0,
grip normal and nothing nearby. That pointed away from collisions and straight at the controls.

### Try it

1. In `ScooterController.ts`, set `STOPPED_SPEED` to `0`, crash into a car at a slight angle and hold W.
   Sometimes you'll be stuck.
2. Change `SHIRT_PRINT` in `shirtPrint.ts` to any word.

## 2026-11-11: Entry 42, pedestrians can be hit

### What I did

- **You can hit pedestrians.** Touch one fast enough and they become a real Rapier body, thrown by
  weight like a car or a parked scooter. A person is 70 kg and you're 180 kg, so they fly and you just
  lose some speed. They lie there for at least 3 seconds, get up where they landed, and walk back to
  their path. The code is `hitPedestrian` and `stepKnockedPedestrian` in `trafficLogic.ts`.
- **You never fall.** The hit changes your velocity directly instead of going through `applyImpact`,
  which is what decides crashes. There's a small camera shake and nothing else. It doesn't count as a
  crash, so the clean-ride bonus is safe.
- **They only dodge slow riders.** Before, anyone within 4 m always stepped aside, so they could
  never be hit. Now they only do that when you're under 18 km/h (`dodgeMaxRiderSpeed`).
- **Walking back is a walk.** After a dodge or a fall, they return to their path at 1.4 m/s
  (`returnSpeed`). Before, they slid back quickly, which would have looked silly from 6 m away.
- **The handover people** (`Handoff.tsx`) got the three new fields, but they can't be hit.

### What I checked

I ran the real `stepTraffic`, `stepScooter` and Rapier in a script, with one person standing on a
pavement across the rider's path:

| Rider speed | Thrown | Landed | Highest | Rider after | Rider fell |
|---|---|---|---|---|---|
| 10 km/h | yes, a stumble | 1.6 m | 0.24 m | 6 km/h | no |
| 25 km/h | yes | 5.9 m | 1.8 m | 16 km/h | no |
| 40 km/h | yes | 13.5 m | 2.7 m | 26 km/h | no |
| 55 km/h | yes | 10.1 m | 2.6 m | 33 km/h | no |

After that I raised the throw threshold (`pedestrianKnock`) from 2 to 3 m/s, so the 10 km/h case is now
just a nudge aside. Type check, lint and build pass.

**Not checked:** seeing it in the game. That covers how the tumbling looks, the getting-up pop
(they snap upright, as there's no get-up animation) and whether 55 km/h landing short of 40 km/h
looks odd. It's from more spin and earlier ground contact.

### Lesson 152: the same rule makes every hit feel consistent

`resolveHit` shares a hit out by weight, and it's the code cars and parked scooters already use. Passing
the person as the first thing and the rider as the second means `change` is what the person feels, and
`other` is what the rider feels. Nothing new had to be invented for "how far should they fly". It's
speed times a weight ratio, which is why the table grows steadily with speed.

### Lesson 153: arcade until it's interesting

Pedestrians walk by simple lane rules with no physics, because 36 bodies would cost frame rate for
nothing. Only at the moment of a hit does one become a Rapier body, and when it settles it goes back to
the cheap rules. It's the same pattern as wrecked cars.

### Try it

1. In `trafficLogic.ts`, raise `maxThrowUp` and watch people fly higher. It's shared with vehicles.
2. Set `dodgeMaxRiderSpeed` to `0` so nobody dodges, and ride slowly into a crowd.
3. Change `PERSON_SHAPE.mass` to `200` and feel yourself slow down far more.

## 2026-11-11: Entry 43, Bengaluru traffic, horns, and a stricter phone check

### What I did

**Traffic that feels like Bengaluru** (`trafficLogic.ts`):

- **More of it, closer to you.** Up to 34 vehicles (Low 12, Medium 22, High 34, from 6, 12 and 18).
  They appear 90–180 m from you instead of 150–260 m, so they're packed around you instead of spread
  over the map.
- **Bumper to bumper.** Cars leave 1.4 m to the vehicle in front, and two-wheelers and autos 0.6 m.
  Before, every vehicle kept 6.5 m between centres, whatever its size. Gaps are now measured bumper to
  bumper, using each vehicle's real length and width.
- **Two-wheelers and autos weave.** With something within 8 m ahead, they try the gap to the right
  (past cars and partly into the other side of the road) and along the kerb on the left (past other
  two-wheelers). They take whichever has more room, then drift back to their lane when it's clear
  (`squeezeThrough`). Oncoming traffic counts as in the way, so they won't pull out into it.
- **Some ignore red lights.** 35% of two-wheelers and 25% of autos (`rebel`).
- **Horns.** Stuck behind you, they honk about every 1–2 seconds until you move. In a queue they honk
  now and then, and occasionally on the move too (`maybeHonk`).
- **No driving through each other.** The "after 4 s, go anyway" rule now applies only to traffic
  crossing at a junction, which is what it was for. In a queue, it was making cars pass through the car
  in front, and bumper-to-bumper jams would have made that obvious.

**Sound, for the first time** (`src/audio/horns.ts`). Horns are made in code with the Web Audio API,
so there are no sound files. Each is two tones played together and filtered: cars a low blast, autos
a nasal double toot, two-wheelers a quick "peep peep". Nearer is louder, and they pan left or right
by where the vehicle is. At most 5 sound at once, so a jam doesn't become noise. Sound starts when you
press Start riding, as browsers only allow sound after a click or tap.

**Your own horn.** Press H, or tap Horn on a phone (`PlayerHorn.tsx`, `TouchControls.tsx`).

**The phone layout is for phones only** (`touchDevice.ts`). It now needs a mobile browser *and* a
finger as the main pointer. iPads count, as they report themselves as a Mac with a touchscreen. A
touchscreen laptop or a desktop browser keeps the keyboard layout. `?touch` still forces the phone
layout, for testing.

### What I checked

I ran the real `stepTraffic` in a script on a straight road, with a car at 5 km/h leading three cars,
three bikes and an auto, for 40 seconds:

| | Before the fixes in this entry | After |
|---|---|---|
| Got past the slow car | none (squeezing 1.4 m wasn't enough to clear a car) | the auto and two bikes |
| Smallest bumper gap between cars | cars inside each other (−4.2 m) | 1.4–2.0 m |
| Rider parked in the lane | — | 30 honks in 40 s |

The game loads and rides on desktop with no console errors, using the desktop layout. Type check,
lint and build pass.

**Not checked:** hearing the horns (I can't hear), how jams look in the game, the frame rate with 34
vehicles on High, and the Horn button and mobile detection on a real phone.

### Lesson 154: make the sound, don't load it

A car horn is mostly two notes a third apart, played on harsh waves, with the top cut off. The Web
Audio API builds that from parts: `OscillatorNode`s for the notes, a `BiquadFilterNode` for the tone,
a `GainNode` for each beep's fade in and out, and a `StereoPanner` for left and right. A few lines
replace a folder of recordings, and every honk can be detuned a little so no two sound the same.

### Lesson 155: ask "what if I moved over?"

To let bikes weave, `findGapAhead` got a `sideways` argument. It measures the gap as if the vehicle
were that far to the side. Trying three answers and picking the best is all the "AI" there is. The
`+ 1.5` margin before changing stops them dithering between two nearly equal gaps.

### Try it

1. In `trafficLogic.ts`, set `bikeRebels` to `1` and watch every bike sail through red.
2. Set `honkAtRiderAfter` to `3` for more patient drivers.
3. In `horns.ts`, change `CAR.tones` to `[300, 300]` for one flat note, and hear how much the
   second note matters.

## 2026-11-11: Entry 44, a radio on the rider's phone

### What I did

The raised phone now has a radio along the bottom: ‹ › to change station, ♪ to turn music on or off,
and 📯 to turn horns on or off. R changes station from the keyboard. Your choices are saved with your
progress.

| Station | What it is | Made by |
|---|---|---|
| Chai Break FM | Lo-fi: lazy swung beat, soft electric-piano chords, vinyl crackle | Code |
| Tabla Taxi | Tanpura drone, tabla playing keherwa, a sitar-like line in raga Kafi | Code |
| Ring Road Nights | Synthwave: four-on-the-floor kick, running bass, arpeggio | Code |
| HSR Indie | 12 Bengaluru and Indian indie songs on YouTube | YouTube |

HSR Indie plays, in order and then on loop: Raghu Dixit's *Lokada Kalaji* and *Hey Bhagwan*, When Chai
Met Toast's *Firefly*, Prateek Kuhad's *cold/mess*, Swarathma's *Raah e Fakira*, Ritviz's *Udd Gaye*,
*Belageddu* from Kirik Party, The Local Train's *Choo Lo*, Easy Wanderlings' *Mellow*, Anuv Jain's
*Baarishein*, Thermal and a Quarter's *Origami*, and Lifafa's *Jaago*. Each is the artist's or label's
own upload. I checked each one with YouTube's oEmbed address, which answers only for videos that allow
playing on other sites.

New files:

- `audio/audioEngine.ts`: one AudioContext with a music bus and a sound-effects bus, so each can be
  muted. It suspends while the game is in the background.
- `audio/instruments.ts`: kick, snare, hi-hat, crackle, tabla, held tones and plucked strings.
- `audio/stations.ts`: the four stations. `audio/radio.ts`: the scheduler that plays code stations.
- `ui/Radio.tsx`: the radio buttons, the YouTube player, and `RadioPlayer`, which keeps the sound in
  step with the settings.

### Why

- **Music made in code is the default.** It always works, offline too, with no sign-in, ads or
  licences.
- **YouTube is one station, not the plan.** It has real songs, but YouTube's rules say the player must
  stay visible and at least 200 × 200 px. So on that station the video takes the map's place on the
  phone, and the phone grows to fit it. On a phone in landscape, the order details are hidden under it
  to make room. The direction arrow still points the way.
- **Not Spotify.** Its full player needs Premium, a login and a registered app, and doesn't run in
  mobile browsers. Its simple embed plays 30-second previews to anyone not signed in.

### What I checked

- In Chrome: the radio shows on the raised phone, ‹ › cycles through all four stations, and the
  settings save. On HSR Indie, YouTube's player loads at 302 × 200 px with the first song cued. There
  are no console errors.
- I rendered 8 seconds of each code station silently into a buffer (`OfflineAudioContext`) and
  measured it:

| Station | Peak (1.0 is clipping) | Average loudness (RMS) |
|---|---|---|
| Chai Break FM | 0.31 | 0.030 |
| Tabla Taxi | 0.22 | 0.021 |
| Ring Road Nights | 0.28 | 0.034 |

Type check, lint and build pass.

**Not checked:** listening to any of it (I can't hear), YouTube actually playing (my test clicks
came from a script, and browsers don't count those as a real tap, so autoplay was blocked), and the
radio and video on a real phone.

### Lesson 156: two clocks

`setInterval` is late by tens of milliseconds whenever the page is busy, and the game's page is
always busy. So `radio.ts` never plays a note "now". The timer wakes every 25 ms and books every note
due in the next 0.12 s, at an exact time on `context.currentTime`, the audio card's own clock. A late
timer only means a note is booked a little closer to its time, never played late.

### Lesson 157: a bus is just a gain

Muting music doesn't stop anything. It fades the music bus's `GainNode` to 0 with `setTargetAtTime`,
which avoids the click a sudden jump makes. Every station has its own fader into the bus, so the old
one fades out while the new one fades in.

### Lesson 158: test sound without hearing it

`OfflineAudioContext` renders audio as fast as it can into a buffer instead of the speakers. Run a
station into one, and you can measure the peak (is anything clipping?) and the loudness (are the
stations balanced?). It's the audio version of a screenshot test.

### Try it

1. In `stations.ts`, change Chai Break's `tempo` to `90`, or its `swing` to `0` and hear the lilt go.
2. Swap Tabla Taxi's raga: replace `kafi` with `[0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19]` (Yaman).
3. Add a YouTube video id to `hsrIndie.videos`.

## 2026-11-11: Entry 45, clearer stop markers on the phone map

### What I did

The stop on the phone's map was a plain coloured dot. When the stop was off the map, the same dot sat
at the edge, so it was hard to tell "it's here" from "it's that way". In `PhoneMap.tsx`:

- **On the map, it's a pin.** It's a round badge on a point, with the point exactly on the stop. The
  badge has a picture: a box (orange/yellow) to collect, a house (green) to deliver to.
- **Off the map, it's an arrow.** The badge sits at the edge with an arrow pointing the way to the
  stop. Next to it is the distance by road, the same number as on the order sheet. It pulses gently,
  so it reads as "over there", not as a place on the map.
- The pin's head stands above its point, so it counts as off the map a little sooner at the top.
  That way the head is never cut off by the status bar.

### What I checked

In Chrome, at the start of a delivery with the pickup 275 m away:

- Tucked away, the map shows about 130 m each side, so the pickup was off it. The box badge sat at
  the left edge with the arrow pointing left and "275 m" beside it.
- Raised, the map shows about 300 m each side, and the pickup showed as a pin at the end of the route
  line.

My first box icon looked like a padlock, and the second like a pause button. The third, a box with a
wider lid, reads as a parcel. Type check and lint pass.

**Not checked:** the green house marker on screen. I couldn't skip the mission ahead from a script,
but it's the same drawing code with a different shape.

### Lesson 159: an arrow needs a direction, and a direction is just atan2

The stop's place on the screen, relative to the rider, is `(x, y)`. `Math.atan2(y, x)` turns that into
an angle, and `cos` and `sin` of that angle give a one-pixel step towards the stop. The arrow is three
points: a tip 19 px along that step, and two corners either side of the badge. "Either side" means
turning the step a quarter turn, which is just swapping it to `(-y, x)`. The label goes the opposite
way, `-step`, so it can never sit under the arrow.

### Try it

1. In `PhoneMap.tsx`, change `PIN_RADIUS` to `12` for bigger markers.
2. Remove the `nudge` from `drawOffMap` to stop the pulsing, and see if it still reads as "that way".

## 2026-11-11: Entry 46, the YouTube player stops covering the map

### What I did

YouTube's player must stay visible and at least 200 × 200 px while it plays, but it doesn't have to
cover the map. Now (`Phone.tsx`, `Radio.tsx`, `index.css`):

- **On a computer**, the video has its own card beside the phone, 356 × 200 px, above the controls
  hint. It slides along when the phone is raised. The phone always shows the map.
- **On a phone**, the video shows on the raised phone only. Put the phone away and the map is back
  and the music pauses. Raise it again and it carries on from the same song and second (`resumeAt`).
  There's no free 200 px spot on a phone held sideways, and this keeps the map while riding.
- The three code stations play in the background everywhere, as before.

### What I checked

In Chrome, on HSR Indie:

| | Map | Video |
|---|---|---|
| Computer, phone down | shown | card at the left, 356 × 200 |
| Computer, phone up | shown | card moved right, 356 × 200, same player, so no restart |
| Phone layout, phone up | hidden | in the phone, 270 × 200 |
| Phone layout, phone down | shown | gone |

Type check, lint and build pass. I put your station back to Chai Break FM after testing.

**Not checked:** carrying on from the same second. Nothing actually played, as my test clicks
weren't real taps. Also, YouTube showed *Firefly*, the second song, ready to play first rather than
*Lokada Kalaji*. That song may not be allowed to play on other sites where you are, in which case
YouTube skips it.

### Lesson 160: unmount, but remember

React removes a component's DOM when it stops rendering it, and YouTube's player goes with it. That's
what makes "visible or not playing" easy to keep to. To make it feel like a pause, the cleanup
function saves the song and second into a plain module variable, which outlives the component, and
the next player starts from there with `start` and a turned playlist.

## 2026-11-11: Entry 47, the YouTube card above the phone, or beside it on a phone

### What I did

You asked for the YouTube player above the rider's phone on a computer, and to its right on a phone.
It now always has its own card, and never covers the map (`Phone.tsx`, `index.css`):

- **Computer:** the card sits just above the rider's phone, 10 px apart, as wide as the phone: 238 ×
  200 tucked, 316 × 200 raised. To make room, the raised phone on this station is 246 px shorter
  than usual (`.phone-raised.phone-video-above`). That's the card's 200 px, the 10 px gap and the
  usual top and bottom margins.
- **Phone held sideways:** the card sits at the top, just right of the rider's phone, at YouTube's
  smallest allowed size, 200 × 200. It moves along when the phone is raised.
- So on a phone, HSR Indie now keeps playing while you ride, rather than only while the phone is up
  (Entry 46). The player is no longer removed when you put the phone away, so the "carry on from the
  same second" code is rarely needed now. It stays for when you switch stations and come back.

### What I checked

In Chrome, measured on screen:

| | Rider's phone | Video card |
|---|---|---|
| Computer, phone down | 238 × 372, top at 444 | 238 × 200, top at 234, so it ends 10 px above |
| Computer, phone up | 316 × 582, top at 234 | 316 × 200, top at 24 |
| Phone layout, phone down | 150 × 190 at the top left | 200 × 200, from x 168, right of it |
| Phone layout, phone up | 280 wide | 200 × 200, from x 298, right of it |

On an 844 × 390 phone, the card ends at x 368 and y 208. It stays clear of the direction arrow (from x
390) and the steering buttons (from y 304). On a narrower phone, such as 667 wide, it would overlap
the arrow a little. Type check, lint and build pass. I put your station back to Chai Break FM.

## 2026-11-11: Entry 48, your playlist: HSR After Hours

### What I did

The YouTube station is now **HSR After Hours**, your 30-song list, in your order (`stations.ts`).
Its id stays `hsr-indie`, so anyone who had the station picked keeps it.

Most of the list was YouTube search links, not videos. For each one I took the top results, read
each video's title and channel through YouTube's oEmbed address, and picked the artist's or label's
own upload. I skipped covers, lyric-video channels and fan uploads.

| # | Song | What I used |
|---|---|---|
| 3 | Alag Aasmaan | The acoustic version on Anuv Jain's channel |
| 4 | Aaftab | The official audio, spelt "Aaftaab" |
| 5, 15, 17 | Doora, Tulasi, Ghaib | The artist's own upload or YouTube's official "Topic" channel |
| 11 | Ninna Notavu | Sony Music South's visualiser |
| 12 | Jamba | British Council Soundpad's video. It's not on Swarathma's own channel |
| 21 | Bass Rani | *Bass Rani* is an album, so its track *Aaja* on Nucleya's channel |

**Stand-ins:** three songs weren't on YouTube under the name given, so the closest song by the same
artist takes their place. They're marked "stand-in" in the code.

| # | On your list | Stand-in |
|---|---|---|
| 9 | Savera, by OAFF and Savera (the duo's name) | *Doobey*, by OAFF and Savera |
| 14 | Namma Bengaluru, by Thermal and a Quarter | *Bangalore Blues*, by Thermal and a Quarter |
| 26 | A Song for the Moon, by The Bicycle Days | *Circles*, by The Bicycle Days |

### What I checked

All 30 ids are different, and all 30 pass the oEmbed check, which means they allow playing on other
sites. Type check, lint and build pass.

**Not checked:** playing through the list. Some videos may still be blocked in your country or
age-restricted, which oEmbed doesn't show. YouTube skips those.

## 2026-11-11: Entry 49, a poster on every lamp post

### What I did

Your "Diwali Dhamaka Days" poster for Kills now hangs on every lamp post (`RoadsideProps.tsx`):

- It's a two-sided board, 0.6 × 0.9 m, from 2.2 m to 3.1 m up, out of reach of passers-by. It's
  strapped to the side of the post, sticking out a little towards the road.
- It faces along the road, so you see it head-on when riding towards a post from either direction.
  The back is the same picture, not mirrored.
- The image is `public/textures/poster-kills.jpg`: your 1024 × 1536, 1.6 MB PNG, resized to 512 ×
  768 and saved as an 83 KB JPEG.
- Every poster is one copy in the same instanced mesh as the lamp posts, with the same distance
  culling: one draw call and 16 triangles each.

### What I checked

In Chrome, near the start: 93 lamp posts were being drawn and 93 posters. Close-up frames rendered
2.5 m in front of and behind one poster show the whole design reading correctly from both sides. Type
check and lint pass.

**My first try faced the wrong way.** I assumed a lamp's +X pointed over the road, because the code
comment says "A lamp's arm reaches back over the road". But the rotation in `props.ts` makes +X run
**along** the road, and +Z point out over it, so my first posters faced across the road, side-on to
riders. Turning the poster a quarter turn fixed it. The same maths means the lamp's arm also runs
along the road, not over it. I haven't changed that.

**Not checked:** posters at night (they're unlit, so they'll go dark), and the frame rate on Low.

### Lesson 161: read the maths, not the comment

`atan2(-directionZ * side, directionX * side)` as a Y rotation sends the model's +X to
`(cos, -sin)`, which is `side × (directionX, directionZ)`: the road's own direction. The comment
beside it said otherwise. When a placement looks wrong, work out where one axis ends up by hand. It
takes a minute and settles it.

### Lesson 162: one picture, many copies, still one draw call

An `InstancedMesh` draws one shape many times, so all the copies share one material and one texture.
The poster's board edges still need a colour, so their UVs all point at one spot in the poster's plain
maroon corner. One picture covers the faces and the edges, and the poster stays a single shape.

### Try it

1. Change `POSTER_BOTTOM` to `1.6` and the posters come down to eye level.
2. Drop a different image at `public/textures/poster-kills.jpg`. Any 2:3 picture fits.

## 2026-11-11: Entry 50, crashes that look like real crashes

### What I did

You said crashes and throws didn't feel real, for people, you, autos or bikes. I measured them first,
with the real code and Rapier in a script, and the numbers agreed:

| At 40 km/h, before | Highest | Turned | Slid |
|---|---|---|---|
| A person | 2.6 m | 3.3 full turns | 25 m |
| A bike | 2.0 m | 1.3 turns, end over end | 7.7 m |

Real hits at wheel or leg height mostly shove the bottom along while the top lags, so things **tip
over and slide**. They don't fly and spin. Changes:

**1. A throw rule per kind of thing** (`throwFor` and `THROW_STYLES` in `trafficLogic.ts`):

- People fall over any way.
- Two-wheelers fall onto their side, and hardly ever go end over end.
- Autos are tall and narrow, so they roll onto their side when hit from the side, and only rock when
  hit from behind.
- Cars mostly just get shoved.

The push is split into "across" and "along" the thing using its heading, and each part tips it by
its own amount. Lift is small and capped.

**2. How each one slides** (`CrashSurface` in `crashPhysics.ts`): each kind has its own friction,
bounce and slowing. A body drags to a stop and can't keep rolling like a box. A bike on its side skids
further. People also soak up a hit (`bodyBounciness`) rather than bouncing off it like metal.

**3. Your scooter no longer bulldozes bodies.** Your shape in the physics world never moves, and it
was shoving fallen people 25 m down the road as you rode on. Collision groups now keep it from
touching bodies.

**4. People go limp and get up.** A knocked-over person's arms fling out and legs part, by a
`down` value from 0 to 1 that the walking shader blends to. After lying a few seconds, they turn
smoothly from however they landed back to standing over about a second (`blendRotation`, a slerp),
then walk back to the pavement.

**5. Bike riders are thrown off.** A hit bike's rider becomes a real body of their own. They carry on
with most of the bike's speed and tumble. Then they lie a moment, get up, walk back to the bike, and
get on as it's stood back up. Fallen vehicles are stood back up over 0.9 s, rather than snapping.

**6. You're thrown off.** In a crash above about 14 km/h, the rider comes off over the bars and rolls
forward under gravity. They land, slide to a stop, settle flat, lie still, get up, jog back and climb
on as the scooter is lifted. Walls stop them dead. It's plain maths in `stepThrownRider`
(`ScooterController.ts`), not Rapier. The rider is still drawn inside the scooter, so `placeRider`
(`Scooter.tsx`) turns their world pose into one relative to the scooter's lean group. It blends
between that pose and the seat while they get on. Their arms and legs get standing, walking and limp
poses (`Rider.tsx`).

**7. Traffic stops for anyone lying in the road.** Knocked-over people, thrown riders and you, while
off the scooter, now count as in the way. Cars and bikes stop short and honk, instead of driving on
and shoving the body along.

### What I checked

The same script before and after:

| At 40 km/h | Highest | Turned | Slid | Comes to rest |
|---|---|---|---|---|
| A person, before | 2.6 m | 3.3 turns | 25 m | never, in 8 s |
| A person, after | 0.24 m | a quarter turn, falls flat | 6.9 m | 1.9 s |
| A bike, before | 2.0 m | 1.3 turns | 7.7 m | 2.5 s |
| A bike, after | 0.27 m | a quarter turn, onto its side | 4.2 m | 1.6 s |
| An auto hit side-on | 0.85 m | rolls onto its side | 1.1 m | 1.6 s |

At 25 km/h a person slides 5.5 m. A thrown bike rider at 40 km/h travels 5.6 m, is back on after
4.9 s, and the bike is riding again after 5.8 s.

You, hitting a stopped car:

| Speed | Thrown | Hips highest (seat is 0.93 m) | Riding again after |
|---|---|---|---|
| 30 km/h | 4.6 m | 1.09 m | 4.1 s |
| 40 km/h | 6.6 m | 1.14 m | 4.8 s |
| 50 km/h | 9.0 m | 1.18 m | 5.6 s |

A car driving at someone lying in its lane stopped with its bumper 2.3 m short and honked 8 times in
15 s. The traffic-jam test from Entry 43 still passes. In Chrome I rode into a building and rendered
frames through the crash. You fly off, slump against the wall, lie flat by the scooter, which is on
its side, are up at 2 s, and back on soon after. Type check, lint and build pass.

**Bugs found on the way:**

- At first a person still "slid" 25 m. That was the bulldozing above.
- My first rider "glided" further at 40 km/h than at 50. Rolling through upright made the hips pop
  up off the ground, so friction stopped working. Landing now sticks.
- My first rider did a headstand against a wall, because an upside-down body was treated as having
  its hips high.

**Not checked:** watching people and bike riders fall and get up in the game (I checked them by the
numbers), and the frame rate when several things crash at once. A limp arm can still poke into a
wall, and a thrown rider passes through cars, as they only collide with buildings.

### Lesson 163: measure the feel

"Doesn't feel real" turned into four numbers: highest point, turns, distance and time to rest.
Each fix was then a change to one of them, and the before-and-after tables say whether it worked.

### Lesson 164: a quaternion blend for getting up

Standing a body back up is a turn from "however it landed" to "upright, facing the same way". A
quaternion slerp (`blendRotation`) follows the shortest turn between any two orientations, and an
eased amount (`smooth`) makes it start and finish gently. The same few lines right a fallen bike.

### Lesson 165: a child in world space

The rider is inside the scooter's lean group, but a thrown rider has a place in the world. Each
frame, `placeRider` builds the world matrix it wants, multiplies by the inverse of the parent's
world matrix, and uses the result as the child's local matrix. That's how you place a child exactly
in world space without moving it out of its parent.

### Try it

1. In `trafficLogic.ts`, raise `AUTO_THROW.roll` to `0.6` and autos tip over at the slightest touch.
2. In `ScooterController.ts`, set `RIDER_CARRY` to `0.9` for longer throws.
3. Set `throwOffSpeed` in `vehicleConfig.ts` to `99` and the rider never comes off.

## 2026-11-12: Entry 51, top speed up to 56 km/h

### What I did

The scooter's top speed is now 56 km/h, up from 50 (`maxSpeed`, 14 → 15.56 m/s, in `vehicleConfig.ts`).
Everything that scales with top speed follows on its own: the engine's pull near the top, the lean, the
camera's widening view, and the rider's crouch. The crouch had 14 written in by hand in `Rider.tsx`, so
it now reads `SCOOTER.maxSpeed` instead. Boost still adds 3 m/s on top, now about 67 km/h.

The on-time timer is unchanged, as it's based on an average route speed of 6.7 m/s, not the top
speed, so deliveries get slightly easier to finish on time.

### What I checked

Type check, lint and build pass. **Not checked:** riding it.

## 2026-11-12: Entry 52, levels and new kinds of order

### What I did

Step 1 of the progression plan. XP now gives you a **level**, and levels unlock new work.

**Levels** (`src/game/progression.ts`). Reaching level L takes 50 × (L − 1) × L XP in all, up to
level 20:

| Level | Total XP | Unlocks |
|---|---|---|
| 2 | 100 | Long haul orders |
| 3 | 300 | Rush orders |
| 4 | 600 | Night shift pay |
| 5 | 1,000 | Double drops |
| 10 | 4,500 | — |

The level is never saved. It's worked out from your saved XP, so old saves are already the right
level.

**New kinds of order** (`missionPlanner.ts`, `missionConfig.ts`, `missionLogic.ts`):

- **Rush** (level 3, a quarter of orders): the timer is 70% of normal. On time, the bonus is 65
  instead of 25, plus 10 XP. Late, you still get the full base pay.
- **Double drop** (level 5, up to a fifth of orders): one pickup, then two customers 120–500 m apart
  by road. Each customer pays the base reward. The timer covers the whole trip. If no second customer
  fits, it becomes a standard order.
- **Night shift** (level 4): delivered after dark, base and distance pay go up 25%.
- Long haul orders now need level 2.

**On the phone:** a "Rush" tag and "Drop off 1/2" on the order sheet. The raised phone shows the
order kind, every customer in turn, the rush bonus and night pay, and a level bar with your XP. The
results card says "Both orders delivered" for a double drop and shows night pay. When you go up a
level, a green card says what you've unlocked. The title screen shows your level.

### What I checked

In a script, with the real store and pay rules:

| Order | Credits | XP |
|---|---|---|
| Standard, Local, on time | 85 | 25 |
| Rush, Local, on time | 125 | 35 |
| Rush, Local, late | 60 (base 50 + clean 10) | 25 |
| Double, Across town, on time, at night | 204 (base 2 × 50, night +34) | 65 |

A double drop went through the store in order: store, first customer, second customer, then pay.
Starting at 280 XP, it crossed 300 and announced level 3 with Rush unlocked.

On the real map in Chrome, I asked the planner for 40 orders at each level:

- Level 1 gave only Local and Across town.
- Level 5 gave 9 rush, 4 double drops and 9 Long haul.
- Rush timers averaged 98 s, against 129 s for standard.
- Second customers were 210–360 m from the first.

The raised phone showed a double drop correctly. Type check, lint and build pass.

**Not checked:** riding a full rush or double drop, and the night bonus during real play. **Known
rough edge:** on a double drop, the one customer figure moves to the second address once the first
handover ends, so the first customer disappears instead of walking home.

### Lesson 166: derive, don't store

The level could have been saved next to the XP, but then the two could disagree, say after a change
to the XP curve. Working it out from XP every time (`levelFromXp`) means there's one truth.

### Try it

1. In `progression.ts`, change `xpForLevel` to `30 * (level - 1) * level` for faster levels.
2. In `missionConfig.ts`, set `rushChance` to `1` to make every order a rush.

## 2026-11-12: Entry 53, the Garage at the dark store

### What I did

Step 2 of the progression plan. Credits now buy things.

**The Garage** opens from a button on the raised phone, but only while you're stopped near the dark
store's kerb (within 16 m, below 5 km/h). Elsewhere the button says "Garage · stop at the dark store".
Riding off or putting the phone away closes it. It has three tabs:

| Upgrade | Each of 3 levels | Prices |
|---|---|---|
| Engine | +2 km/h top speed, +6% pull | 150 / 350 / 700 |
| Tyres | +10% grip, and wins back a third of the grip rain takes | 150 / 350 / 700 |
| Brakes | +15% braking | 120 / 280 / 560 |

Paints: Midnight, which you have, plus six colours at 100 each. Helmets: White, which you have, plus
three colours at 80 each. A colour you own is free to switch back to.

**Rain now costs grip**: up to 30% in a downpour. Before, rain made no difference to riding, so
better tyres would have done nothing.

How it works:

- `src/game/garage.ts` is the catalogue: items, prices and effects.
- `src/vehicle/tuning.ts` holds the scooter's live handling: `SCOOTER` plus upgrades plus rain. The
  controller, camera and rider read `tuning` instead of `SCOOTER` for top speed, pull, grip and
  braking.
- The store saves what you own and what's in use, and calls `applyUpgrades` whenever the upgrades
  change, including when a saved game loads.
- `MissionTracker` reports `atStore` along with the speed and distance.
- The paint repaints the scooter model, and the helmet colour changes the helmet material.

### What I checked

In a script: buying went 1,000 → 850 → 500 credits for engine levels 1 and 2. Level 3 (700) was
refused at 500, and brakes level 1 then cost 120. A paint bought with 150 left 50, a 100 paint was
refused at 50, and owned paints switched for free. Handling, using the real scooter code:

| | Top speed | 0–50 km/h | Stopping from 50 | Sliding in a hard turn |
|---|---|---|---|---|
| Stock, dry | 56 km/h | 2.8 s | 8.7 m | 0.97 m/s |
| Stock, heavy rain | 56 km/h | 2.8 s | 8.7 m | 1.36 m/s |
| Tyres 3, heavy rain | 56 km/h | 2.8 s | 8.7 m | 0.74 m/s |
| Everything maxed, dry | 62 km/h | 2.2 s | 5.9 m | 0.81 m/s |

In Chrome, a script rode the route to the dark store in 34 s. The phone said "Open the Garage", and
the Garage showed the three upgrades and prices. Buying Signal red took 155 → 55 credits and turned
the scooter red. I then put your save back. That ride also finally showed the green house marker with
its arrow on the phone map (from Entry 45). Type check, lint and build pass.

**Not checked:** the Garage on a phone in landscape, and the helmet colour on screen.

### Lesson 167: one place for "how it handles now"

The controller used to read fixed numbers from `SCOOTER`. Upgrades and rain change those numbers,
so they now live in one plain object, `tuning`, worked out from `SCOOTER`. Anything that needs the top
speed (the controller, the camera's widening view, the rider's crouch) reads `tuning.maxSpeed`, and
an upgrade changes all of them at once.

### Try it

1. In `garage.ts`, make all prices `[10, 20, 30]` and max everything out in a couple of deliveries.
2. In `tuning.ts`, set `RAIN_GRIP_LOSS` to `0.6` for a truly slippery monsoon.

## 2026-11-12: Entry 54, career chapter 1 and the daily shift

### What I did

Step 3 of the progression plan.

**Ravi from dispatch**, a made-up dispatcher at the made-up dark store, now messages you. He writes in
English with common Bengaluru Kannada mixed in: *Namaskara*, *maga*, *bega banni* (come quickly),
*olle kelsa* (good work), *jopana* (careful), *sakkath* (awesome), *chennagide* (it's nice), *swalpa
adjust maadi*, *nale sigona* (see you tomorrow). A new message pops up at the top right for 7 seconds.
The Career tab keeps the last few.

**Chapter 1, "First week in HSR"** (`src/game/career.ts`). Five goals, done in order, each with a
message from Ravi:

1. Finish your first delivery.
2. Deliver 3 orders on time.
3. Finish a delivery with no crashes.
4. Finish an Across town or Long haul order.
5. Deliver after dark or in the rain.

Finishing the chapter pays 300 credits and unlocks **Dark store green**, a paint that can only be
earned, never bought. The Garage shows it as "Career reward" until then.

**The daily shift.** Each calendar day in your own time zone brings 3 goals. The date seeds the
random choice, so a day always has the same goals. The goals are picked from what your level allows:

- 5 deliveries
- 3 on time
- 3 with no crashes
- 2 rush orders on time (level 3 and up)
- a Long haul (level 2 and up)
- a delivery after dark
- ride 5 km
- 3 drift boosts

Finishing all three pays 150 credits and 50 XP, plus 25 credits for each day in a row, up to +100.
A missed day resets the streak.

**On the phone:** the raised phone has three tabs. **Order** is as before. **Career** shows the
chapter's goals, ticked off or with a count, and Ravi's messages. **Today** shows the three goals with
progress bars, the bonus and the streak. A dot on Today means goals are left.

How it works: `career.ts` holds the goals and small pure functions (`advanceCareer`, `advanceDaily`,
`finishShift`). The store's `applyEvent` feeds them every delivery, plus ridden distance (sent every 2
seconds) and drift boosts from `MissionTracker`, then pays out and adds Ravi's messages. The career,
shift, streak and messages are all saved.

### What I checked

In a script with the real store:

- Starting gave Ravi's welcome and today's shift.
- Seven deliveries moved the chapter on only when each goal's own condition was met.
- A full run through all five goals paid 300 credits, sent the chapter message, and gave the paint,
  which could then be used.
- A date always gave the same goals, and different days gave different ones.
- The day before 1 March is 28 February, and the day before 1 January is 31 December of the year
  before.
- Streak bonuses went 150, 175, 200, then back to 150 after a missed day.

In Chrome: Ravi's welcome popped up on a first start, and the Career and Today tabs looked right. Two
bugs came up and are fixed:

- The pop-up missed the welcome, because the pop-up only appears once the game has started, and by
  then the welcome already counted as old. "Old" now means "there when the page loaded".
- The daily progress bars had no height, because they were inline elements.

I put your save back as it was, career not started, so the welcome is yours to see. Type check, lint
and build pass.

**Not checked:** playing through the chapter and a whole shift in the game, the tabs on a phone in
landscape, and the shift changing at midnight while playing. That should work, as each event checks
the date.

### Lesson 168: same seed, same day

`createDailyShift` doesn't use `Math.random`. It hashes the date into a small seeded random number
generator, so "2026-11-12" always gives the same three goals: today, after a reload, and on anyone's
machine. Repeatable randomness is what makes a daily challenge feel like *the* day's challenge.

### Lesson 169: keep rules pure, let the store remember

The career rules take a state and an event and return a new state, with no store, React or timers.
That's why a script could run a whole week of play in milliseconds. The store only decides when to
call them and saves the result.

### Try it

1. In `career.ts`, add a goal to `CHAPTER_ONE.goals`, say "Earn 2 drift boosts", copying the shape of
   the others.
2. Change `DAILY_BONUS.credits` to `300` for a generous shift.

## 2026-11-13: Entry 55, real headlights, solid traffic, a rider-following camera, and sound

### What I did

Five fixes you asked for.

**1. Headlights light things up.** Both the scooter's beam and traffic's were shapes painted on the
road, so nothing they "hit" got brighter. Now:

- The scooter has a real spotlight (`Headlight.tsx`), so it lights the road, walls, people and the
  vehicles in front.
- Traffic gets a small pool of real spotlights (`CarHeadlights` in `Traffic.tsx`), handed each frame
  to the nearest moving vehicles: none on Low, 2 on Medium, 4 on High (`carLights` in
  `qualitySettings.ts`). Further vehicles keep their painted glow.
- The lights are never added or removed, only turned down to 0 by day. Changing how many lights there
  are makes three.js rebuild every material, which would cause a hitch at dusk.

**2. Crashed vehicles' tyres no longer sink into the road.** Each vehicle's crash box started 20–30 cm
above the ground, at the bottom of the body, so a vehicle resting on its box sank its wheels into the
road. Every box now runs from the ground to the roof (`VEHICLE_SHAPES`).

**3. Nothing passes through anything** (`trafficLogic.ts`):

- **Vehicles and people** (`hitPersonWithVehicle`): a moving vehicle knocks a person over by weight,
  brakes hard and honks. A crawling one nudges them aside.
- **Traffic stops for people in its path**, walking or down, and honks. Walkers are narrow, so people
  on the pavement don't stop anything. Someone stepping into the road, such as at a corner, does.
- **People and people** (`separatePeople`): walkers keep 0.6 m apart, stepping back and to the side,
  so two meeting head-on slip past each other.
- **Vehicles and vehicles** (`mustGiveWay`): if two would overlap, at a crossing or with a bike
  squeezing past, whichever has the other in front of it stops. Side by side, the earlier one goes
  first.
- At low speed, the scooter now moves a person fully aside, instead of half-way into them.

**4. The camera follows the rider after a crash.** While they're off the scooter it eases over to
them, looks at them rather than past them, and stops turning with the spinning scooter. It eases back
once they're on (`FollowCamera.tsx`).

**5. Sound**, all made in code, with no recordings:

- **Engines** (`engines.ts`): a buzz at the firing rate, an octave below for body, filtered noise for
  rasp, and a filter that opens under throttle. Each kind sounds different: the scooter's busy buzz,
  cars' low hum, the auto's two-stroke rattle and the motorbike's sharper note.
- **Your engine follows the throttle you actually press**, so it revs even standing still, as at a
  light. A crash stalls it until you're back on (`PlayerSounds.tsx`).
- **Traffic engines**: the 3 nearest moving vehicles get an engine voice each. The voices are reused,
  so a jam of 30 cars costs 3 voices, not 30. They're quieter further away and placed left or right
  (`trafficSounds.ts`).
- **The neighbourhood** (`ambience.ts`): a low rumble of distant traffic, rain that follows the
  weather, birds by day and crickets at night.
- **A tyre skid** that follows how much you're sliding.
- **Thuds** for your crashes, and for anything traffic hits or you knock over.
- All of it is in the sound-effects mix. The 📯 toggle on the phone is now 🔊 "Sound effects", and it
  turns these off too.

### What I checked

| Check | Result |
|---|---|
| A car hit side-on, at rest (rendered in a script) | Base sat 0.22 m into the road with the old box, 0.00 m now |
| A car approaching someone standing in its lane | Stopped 1.7 m short, didn't knock them over |
| Two cars sent at the same crossing at once | Both got through, never overlapping (nearest 4.5 m apart) |
| Two people walking head-on | Never closer than 0.6 m, and both walked on past |
| The Entry 43 traffic jam | Still flows: bikes and autos weave past, cars queue 1.4–2 m apart |
| The Entry 50 crashes | Unchanged: a person slides 6–7 m, a bike tips over and slides 4–5 m |

**Sound**, rendered silently and measured (peak, where 1.0 is clipping):

- The engines at idle, mid and full revs all play, from 0.06 to 0.14.
- Day and night background and heavy rain all play.
- A hard skid is about 40% as loud as your engine.
- A crash thud reaches 0.16.
- Nothing clips. I turned up the city rumble, crickets and skid after the first measurement, as they
  were barely there.

**In Chrome:**

- At night, the headlight lit the road ahead, the walls beside it, and the back of an auto in front.
- Riding into a building, the camera followed the rider as they flew off, slumped and got up, then
  swung back behind the scooter once they were on. Afterwards the camera sat close because the
  scooter had stopped against a building corner, and the camera moves in when a wall is behind it.
- I put your save back as it was.

Type check, lint and build pass.

**Not checked:** listening to any of it, as browsers don't let a script start sound and I can't hear.
Also not checked: traffic headlights lighting something up close, the frame rate on High at night
with 5 spotlights, and how often traffic knocks people over in real play.

### Lesson 170: real lights cost per pixel, so use a few and hand them out

Every real light adds work to every pixel of every lit material, so 34 headlights would be ruinous. A
few lights handed each frame to the vehicles you can actually see up close look almost the same,
because distant headlights barely light anything you'd notice. A fixed number of lights also means
three.js never rebuilds its materials.

### Lesson 171: one voice per thing you can hear, not per thing

The same goes for sound. Your ears pick out the nearest few engines and blur the rest into a rumble.
So three engine voices for the three nearest vehicles, plus one rumble for the rest of the city,
sound like a whole street.

### Try it

1. In `qualitySettings.ts`, set `carLights` on High to `8` and watch the frame rate at night.
2. In `engines.ts`, change the scooter's `wave` to `'square'` for a harsher engine.
3. In `ambience.ts`, raise `RUMBLE_VOLUME` for a busier city.

## 2026-11-13: Entry 56, a new title screen that downloads the game

### What I did

You found the old title card over the live 3D world a bit odd, and showed a reference: a full-bleed
game image, a bold name, a big play button and a line of facts. I kept that idea and made our own
look. Nothing is copied from that site.

**The screen** (`TitleScreen.tsx`, the title styles at the end of `index.css`):

- **Backdrop:** three screenshots from our own game (`public/title/`) fade from one to the next every
  7 seconds, drifting slowly larger. They're darkened from the left and bottom, where the words sit.
  A small badge says they're in-game screenshots, with a caption.
- **The name:** "Deliver It" in Baloo Tamma 2, by the Indian foundry Ek Type. One family covers
  English and Kannada, so ಡೆಲಿವರ್ ಇಟ್ sits under the name in the same type. The name is tilted
  like a sticker, with a maroon drop and a marigold road underline that has a dashed centre line.
- **Colours** come from the game's world: the maroon-black of the Kills poster, Diwali marigold for
  the one button that matters, chalk for text and jacaranda for the Kannada.
- **The Start button is the download bar.** It fills as files arrive ("Downloading the city 42%",
  with "4.7 of 11.1 MB downloaded" beneath), then says "Building HSR Layout" with a moving sheen,
  then becomes a solid marigold "Start riding" button with an Enter hint. Enter works from anywhere
  on the page.
- **How to ride** opens the controls in a panel. Welcome back and Quality sit top right.
- If the download fails, the button becomes "Download failed. Try again" and the facts line says why.

**The loader** (`src/game/preload.ts`) downloads the map, the 3 models and the 18 textures, four at
a time, counting bytes as they arrive, and starts the physics engine alongside. It hands each file
to three.js's own cache under the exact key its loader looks for (`file:` for models, `image:` for
textures), and keeps the map for `mapData.ts`. The 3D world is only built once the downloads are
done (`App.tsx`), so it finds everything already there. In development, any file the world loads
that isn't in the list is reported in the console.

### What I checked

In Chrome:

- A fresh load went from 0 to 84% in 0.3 s locally, then "Building HSR Layout", then "Start riding"
  at about 5.8 s.
- Each of the 25 files downloaded once. My first version downloaded the 3 models twice, because each
  model file called `useGLTF.preload` as soon as its code loaded, before the cache was filled. Those
  calls are gone.
- At 42%, the button's fill and the MB line read clearly.
- How to ride opens and closes, the backdrop moves on to the next screenshot, and Enter starts the
  game.

Type check, lint and build pass. The console is clean, after one more fix: the people shader used
each figure's own colour without checking it existed. When it didn't, three.js couldn't build the
shader, and those figures, such as thrown bike riders, weren't drawn. I put your save back
afterwards.

**Not checked:** the screen on a phone held sideways (it has its own tighter layout below 500 px of
height), a slow connection, and the "Building" sheen on screen.

### Lesson 172: preload into the loader's own cache

Downloading files early only helps if the loaders then use them. Each three.js loader checks
`THREE.Cache` under its own key before fetching, so the preloader fills exactly those keys. Anything
that starts a download early by itself, like `useGLTF.preload`, defeats it.

### Try it

1. Add your own screenshot to `public/title/` and to `SCREENSHOTS` in `TitleScreen.tsx`.
2. In Chrome's developer tools, Network tab, choose "Slow 4G" and reload to watch the bar fill.

## 2026-11-13: Entry 57, computers only

### What I did

You decided Deliver It is a computer game, played with a keyboard. So the phone version is gone, and
phones and tablets get a page saying where to play.

**Deleted:** the on-screen touch buttons (`TouchControls.tsx`, `touchInput.ts`), the rotate-your-phone
screen (`RotatePrompt.tsx`), the full-screen and landscape lock (`fullscreen.ts`), and about 40
phone-layout rules in `index.css`. Also:

- **`useDriveInput`** reads the keyboard only again.
- **Quality** starts on High.
- **The in-game phone** always says "Open · P".
- **The YouTube card** always sits above the in-game phone.
- **The page head** no longer has the mobile meta tags, and the app manifest no longer asks for
  landscape and full screen.

The in-game phone (map, orders, radio, Garage, career) is part of the game and stays.

**Kept:** the device check, renamed `mobileDevice.ts`. It's a mobile browser *and* a finger as the main
pointer, so touchscreen laptops still get the game.

**Phones and tablets** see `MobileNotice.tsx`: the title screen's look, "Deliver It is played on a
computer, with a keyboard", and buttons to share or copy the link. `Root.tsx` decides which to show,
and the game is only loaded on a computer (`lazy(() => import('./App'))`). A phone downloads the
small main bundle, about 70 KB compressed, and none of three.js, the 1.2 MB game code, the 4.3 MB
physics engine or the 11 MB of city files. Add `?mobile` to the address to see the phone page on a
computer.

### What I checked

In Chrome:

- With `?mobile`, the notice showed, with no 3D canvas and none of the game's files downloaded.
- Without it, the normal title screen loaded and reached "Start riding", with no console errors.

Type check, lint and build pass. **Not checked:** a real phone or tablet.

## 2026-11-13: Entry 58, the koel and a busier city

### What I did

Two background sounds you asked for, both made in code like the rest (`ambience.ts`).

**The cuckoo.** In Bengaluru that's the Asian koel, a cuckoo whose rising *ku-OO, ku-OO* carries
over everything. Each song is 4–7 calls. Each call is a short low note, then a long note sliding up
by about a third. Every call starts 6% higher than the one before, so the run climbs, as a real
koel's does. A soft octave overtone gives the hollow, flute-like edge. A short echo (0.21 s) makes it
sound like it's coming from a tree between buildings. It sings every 20–45 seconds by day, a quarter
as often at night, never in heavy rain, and each song comes from a different direction.

**A busier city.** On top of the existing low rumble:

- **Traffic out of sight** swells and fades every 0.6–2 seconds, and its pitch wanders, as vehicles
  pass on nearby streets.
- **A murmur of people and shops** by day, rising and falling quickly. It's quieter in the rain and
  silent at night.
- **Distant horns** from any direction, 45–85 m away, every 2.5–8 seconds by day and every 10–25 at
  night. A mix of cars, autos and bikes.

The whole city gets about two-thirds quieter at night.

### What I checked

Rendered silently and measured:

- The daytime background is now about twice as loud as before (about 0.023 average, against 0.007),
  but stays well under your engine, peaking at 0.10 against the engine's 0.12.
- The night background is about a quarter of the daytime level.
- Measured at the koel's pitch (700–1,300 Hz), its first version was only 1.4 times the city noise,
  and would have been lost. I nearly tripled it, and it's now 5.5 times the city noise while
  singing, then drops away once it stops.

Type check, lint and build pass. **Not checked:** listening to it. I can't hear, and a script can't
start sound in a browser.

### Try it

1. In `ambience.ts`, set `KOEL_EVERY` to `[3, 6]` to hear the koel right away.
2. Lower `DISTANT_HORNS_DAY` to `[0.5, 2]` for a proper Silk Board jam.

## 2026-11-13: Entry 59, a myna, a passing scooter, rain drips, a tyre squeal and an SUV

### What I did

You shared sound files from benglooru.com. They're another game's own sounds, and I couldn't see a
licence for reusing them, so you chose to keep making our sounds in code. These match what those
files covered (`ambience.ts`, `engines.ts`):

- **Common myna**, Bengaluru's chattiest bird: 5–9 notes picked from what mynas mix. A clear whistle
  sliding up or down, a harsh "chake" (two quick bursts of filtered noise), and a bubbly gurgle (a
  tone wobbled fast). Every 8–20 seconds by day, not in rain, from a random direction.
- **A scooter passing** on a nearby street: it swells and fades over 2–3.5 seconds, moving from one
  side to the other, and its note drops as it passes (the Doppler effect). It also gets brighter as
  it's closest. Every 6–15 seconds by day, 18–40 at night.
- **Rain drips** off roofs and leaves: a tiny "plip" whose pitch rises fast. More of them the harder
  it rains.
- **A tyre squeal** on top of the scrubbing skid: two tones wobbling quickly through a narrow filter,
  the sound of rubber catching and slipping. It only comes in on a real slide, as it follows the
  slide squared, and rises in pitch the faster you slide.
- **An SUV engine**: SUVs used the car's sound. Now they have a lower, growlier diesel.

### What I checked

Rendered silently and measured:

- **Tyre squeal:** at its pitch, 4.8 times louder sliding hard than still.
- **SUV engine:** heavier than the car (average 0.053 against 0.044).
- **Passing scooter:** shows as a clear swell in the daytime mix. Its first version peaked at 0.156,
  louder than your own engine (about 0.12) for something out of sight, so I halved it. The daytime
  mix now peaks at 0.107.
- **Myna:** its notes are short and share their pitch range with the koel's overtone, so a level
  reading undersells it. I doubled its volume to be safe.
- **Drips:** they share their pitch range with the rain's hiss, so I raised them a little. I couldn't
  measure them apart from it.

Type check, lint and build pass. **Not checked:** listening to any of it.

## 2026-11-13: Entry 60, the HSR house kit

### What I did

The buildings didn't read as HSR. The map says almost nothing about each building, but by size and
place the game treats 1,310 of them as houses, about four in five. Each was an extruded outline with
windows painted on. Now every house gets the details that make an HSR street (`houseKit.ts`):

- **Chajjas:** a thin concrete sunshade over every window. They line up exactly with the painted
  windows, which repeat every 3.4 m by a world direction, not from each wall's corner, so
  `windowCentres` works out the same positions the paint uses.
- **Balconies** on every upper floor of the side facing the road: a slab, a solid parapet and a dark
  metal rail. About a third have washing hung over the rail in bright colours.
- **The terrace:** a parapet wall around the roof, and a staircase room ("headroom") with a door. The
  black water tanks now stand on top of it, as on most Bengaluru homes, rather than on the roof slab.
- **A front door** in a window bay away from the balconies. The painted window above it reads as a
  ventilator.
- **A compound wall with a gate** between the house and the pavement, where there's at least 1.2 m to
  spare and the pavement keeps 1.6 m. It has two pillars with pale caps, a dark metal gate with a rail
  across, and short walls back to the house. The walls are solid to the scooter and to everything
  placed after them (trees, lamps, parked scooters).
- **HSR colours:** house paint is now mostly off-white, cream and beige, with the odd pastel or
  turmeric. The walls and the kit share one palette, `HOUSE_COLORS`, so balconies match.

The front of a house is the visible wall nearest a road, found by stepping out from each wall until
the road starts. That gap also sets where the compound wall goes.

Everything is plain boxes merged into one shape per map square, so the extra draw calls are small.
Chajjas are their own layer: drawn within 180 m, on Medium and High only. Every face checks its own
corner order, because map outlines run either way round and a face only shows from one side.

### What I checked

Over the real map, in a script: the kit builds for all 1,310 houses in 0.44 s, adding about 327,000
triangles of main details and 113,000 of chajjas across 32 map squares, and 1,676 water tanks.

In Chrome:

- **Street level:** balconies with washing, a door, and a compound wall with a gate down the street.
- **A drone's-eye view:** terraces with parapets and staircase rooms with tanks on top, all across
  the rooftops, plus chajjas and balconies on the street side.
- **Speed on High:** 114 frames a second on this Mac, 421 draw calls.

I put your save back. Type check, lint and build pass.

**Not checked:** slower machines and Low quality, night, and riding along a street of compound walls.
The camera moves in when there's a wall behind it, which could happen more often now. **Known
limits:** walls with another building close in front get no chajjas, and houses still have no stilt
parking or car porch.

### Lesson 173: one source of truth for what the paint shows

The chajjas sit over windows that only exist in a texture. Rather than guess, the kit uses the same
measurements the painting code uses (`FACADE_LOOKS.house.bayWidth` and the window's size). Change the
paint, and the chajjas follow.

### Lesson 174: let the face decide which way it's wound

A triangle shows from the side where its corners run anticlockwise. Instead of working out the right
order for every box against outlines that run either way, `quad` takes the normal it should have,
checks the corners against it with a cross product, and swaps them if needed.

## 2026-11-13: Entry 61, shop fronts that stay on their wall

### What I did

Your screenshot showed a CLOTHING shop whose awning, shutter and sign ran past the corner of the
building into the air, with a black corner column cutting through the middle of them. There were two
causes:

1. **Shop fronts ignored the wall's ends.** Each is centred on the point of the wall nearest the
   mapped shop, up to 7 m wide, and nothing checked where the wall ended. Near a corner, half of it
   hung off the building. Now `findNearestWall` also says where the wall starts, which way it runs and
   how far along the nearest point is. `generateShopFronts` slides each front along, and narrows it if
   it must, so it stays at least 0.5 m inside both corners. The spacing between shop fronts is now
   checked at their final position.
2. **Corner columns ignored awnings.** The city kit puts a dark column on every corner to hide the
   seam between walls. Now a corner within an awning's half-width plus 1 m gets no column on the two
   floors the awning and sign reach (`placeCorner` in `cityKitPlacement.ts`).

### What I checked

Over the whole map, in a script: all 113 shop fronts now sit fully inside their wall, none hanging
past a corner. In Chrome, the CLOTHING shop's awning stops inside its wall. Type check, lint and build
pass.

**Not checked:** the corner column next to that shop, on screen. My camera angles didn't catch the
corner.

**Still to do:** the shop blocks themselves still use the European brick-and-glass kit, which doesn't
look like Bengaluru. The plan is an HSR shop kit, like the house kit.

## 2026-11-13: Entry 62, HSR shop streets

### What I did

Shop buildings now look like HSR's: a house upstairs, a row of small open shops at street level.

1. **Your five boards are in the game.** The kirana, darshini, chai stall, bakery and medicals boards
   you made are cropped to the board itself and saved as `public/textures/board-*.jpg` (about 90 KB
   each, 1024×224). The loader downloads them with everything else.
2. **Every other board is drawn in code** (`src/world/signboards.ts`), in the same layout as yours:
   icon on the left, the name in Kannada over the name in English, and a band along the bottom listing
   what's sold. There are 16 kinds of shop: kirana, darshini, chai stall, bakery, medicals, clothing,
   salon, jewellers, electronics, supermarket, chat centre, filter coffee, mobiles, tailor, hardware,
   general stores. For the five with a photo board, half the shops get the photo and half get a drawn
   board with a different name, so a street doesn't repeat itself.
3. **Shops are open, with a room behind the shutter** (`src/world/shopInteriors.ts`), drawn from your
   reference picture. Each kind has its own room, painted in perspective onto one flat picture: the
   kirana has packed shelves, snack strips hanging from the ceiling and rice sacks at the door; the
   darshini has white tiles, a menu board and steel tables; the chai stall has a marigold garland,
   biscuit jars and a steaming kettle; the bakery has pendant lamps and a glass case of cakes and
   puffs; the medicals has white shelves of boxes and a green cross. Every other one of a kind is drawn
   mirrored. Rooms and boards light up at night.
4. **Striped awnings** in each shop's colour, and **chalk menu boards** on the pavement outside some
   kiranas, darshinis, chai stalls, bakeries and medicals ("Idli, Dosa, Vada, Meals, Filter Coffee").
   Menu boards are solid.
5. **Shop buildings use the house kit.** The European brick-and-glass kit is gone from them. They're
   painted in house colours, with chajjas, balconies from the second floor up (the first is behind the
   signboards), a terrace parapet and a roof room with tanks. Their road-facing wall is split into
   units of about 4 m with a concrete pier between each. A unit standing where a shop is mapped becomes
   that kind of shop. The dark store's building is left alone.

### Why

Mapped shops only gave 113 awnings across the whole map, on whatever wall was nearest. Splitting
every shop building's front into units gives 458 shops, and a street of them looks like an HSR main
road.

### What I checked

Type check and lint pass. In Chrome, on High: 458 shop fronts built, no console errors. Close up, a
row of three reads clearly: medicals photo board, Sneha Fashions with its striped purple awning and
clothes racks, the Udupi Darshini photo board. Down a street: kirana, salon, Iyengar bakery with a
chalk menu board outside. About 85 fps in that view, 358 draw calls.

**Not checked:** the night glow on screen, and the Kannada on the drawn boards by a Kannada reader.
The names are transliterations I wrote, and they're worth a check before the game is shown widely.

### Lesson 175: a texture atlas lets 458 shops share one draw call

Each shop has its own board and room, but they're all parts of two big images drawn once at start-up
(`BOARD_ATLAS` and `INTERIOR_ATLAS` in `ShopFronts.tsx`). A shop's quads carry texture coordinates
that point at its part of the image, so all the shops in a map square are one geometry, with one
material, drawn in one call. A different texture for each shop would mean a draw call each.

### Lesson 176: a painted room is one quad

A real room behind each shutter would be five walls and a lot of shelf boxes. From the road you
only ever see it from the front, so `drawInterior` paints the back wall smaller and the side walls,
floor and ceiling as shapes that run back to it: one-point perspective, as in a drawing. The eye reads
depth, and the GPU draws two triangles.

### Lesson 177: changing a built-in material in a shader hook

The striped awnings use ordinary `MeshStandardMaterial` with `onBeforeCompile`, which lets you edit
three.js's shader text before it's compiled. The vertex shader reads how wide each awning is stretched
from its instance matrix (`length(instanceMatrix[0].xyz)`), so every stripe is 45 cm whatever the
awning's width, and the fragment shader mixes in white on every other stripe. Lighting, shadows and
fog all still work, because it's still the standard material.

### Try it

Ride down any main road with shops. Look for the darshini board with idli on a banana leaf, and the
chalk menu outside. Then wait for night and watch the rooms light up.

## 2026-11-13: Entry 63, parked bikes that look like bikes

### What I did

You said the parked scooters looked dull and boxy. They were five plain boxes. Now they're built from
the same sculpted model as your own bike in `traffic.glb` (`createParkedScooterGeometry` in
`src/traffic/vehicleShapes.ts`):

- **The delivery box is cut off.** Every triangle that isn't paint, sits above 0.82 m and is behind
  the seat is dropped, as a bike parked outside a shop isn't on a delivery.
- **They're parked the way bikes park:** front wheel and bars turned 0.35 rad about the steering axis,
  and the whole bike leaning 0.11 rad onto its side stand.
- **Only the paint takes each bike's colour.** They use the same paint shader as the traffic, so the
  seat, tyres, rims and chrome keep their own colours.

The model is detailed (about 28,000 vertices), and there are 747 parked bikes. Before, the far ones
were shrunk to nothing, but the GPU still works through every vertex of a shrunken copy. Now
`writeNearest` in `Traffic.tsx` writes only the bikes within 90 m to the instanced mesh and sets its
`count` to match, so only those are drawn: 89 near a busy shop row, none at the start.

### What I checked

Type check and lint pass. In Chrome, close up outside a row of shops: proper bikes with spoked wheels,
mudguards, seat and rear rack, leaning on their stands with bars turned, in different colours. Your
save is unchanged.

**Not checked:** the frame rate with them. My measurement script failed, so I don't have a number.

### Lesson 178: an instanced mesh draws `count` copies, not "the ones you can see"

Setting a copy's scale to zero hides it, but the GPU still runs the vertex shader for every one of its
corners. For a cheap shape that doesn't matter. For a detailed one, pack the visible copies at the
front of the list and set `instancedMesh.count` to how many there are. Copies past `count` cost
nothing.

## 2026-11-13: Entry 64, blocks of flats on stilts (in progress)

### What I did

The 159 apartment blocks now get the house kit too (`buildApartment` in `houseKit.ts`). The European
city kit is gone from them.
- **Stilts:** a block of 3 or more floors has an open ground floor (`hasStilts` in `buildingData.ts`;
  `Buildings.tsx` starts its walls one floor up). It has pillars round the edge every 4.6 m and in a
  5.5 m grid inside, a stair and lift core with a grey door, and a concrete floor slab.
- **Parking underneath:** a hatchback in about half the gaps between the front pillars, and bikes in
  the rest, some backed in, some nose first (`StiltParking.tsx`). They're drawn only within 75 m.
- **Balconies** on every bay of the front, on every floor, some with a potted plant or washing.
  Sunshades go over the windows on the other walls you can see. The apartment wall texture is now a
  wide grilled window with a sill, instead of a painted balcony that clashed with the real ones.
- **Roof:** a terrace parapet, a bigger stair and lift room, and three tanks in a row. A compound wall
  has a 4.2 m gate in the middle where there's room.
- Apartment paint is in `APARTMENT_COLORS`, shared by the walls and the kit.

### What I checked

Type check and lint pass. In Chrome, before the last two changes: a four-storey block on stilts with
pillars, three parked cars and bikes underneath, and balconies with a plant and washing.

**Checked since (with Entry 65):** the grilled windows and the stilt floor are on screen and look
right from the road, and the frame rate held at 120 on High in a street with two blocks of flats.

**Not checked yet:** the view from inside the stilts. The building's footprint is still solid, so riding
into the open parking floor stops you at the edge, like an invisible wall.

## 2026-11-13: Entry 65, HSR in bloom: flowering roads, bougainvillea, kolams, carts and name boards

### What I did

You asked for a prettier city that feels more like HSR. The houses and shops were already HSR's, but
the streets between them were bare: trees in random colours, plain walls, nothing on the pavement.
Five things changed.

1. **Whole roads flower together.** Before, each tree picked its own colour, so one tree in three was
   in flower and no two neighbours matched. HSR's roads were planted a species at a time, which is
   why a whole cross road turns pink in tabebuia season. Now every road gets one planting from its
   name (`AVENUES` in `props.ts`), so all the pieces of 18th Cross Road match: plain green, big rain
   trees, pink tabebuia, yellow tabebuia, gulmohar or jacaranda. On a flowering road about seven
   trees in ten are in flower. Trees on roads 7 m wide or more grow a fifth bigger, and there are
   more of them (seven slots in ten are planted, up from just over half).
2. **Petals on the road.** Every tree in flower has about 260 small petals lying under it, in its own
   colour, thickest near the trunk (`createPetalGeometry` in `foliage.ts`).
3. **Bougainvillea over compound walls**, on about one house in three with a long enough wall:
   mostly magenta, some orange or white. It's built from the same leaf cards as the trees, in two
   layers, green behind and flowers in front, so each can take its own colour.
4. **Kolams at the gates** of just under half the houses: four patterns (a lotus, a star, a dotted
   pulli kolam and a sun), drawn in code as white rice-flour lines with pink and yellow powder
   (`StreetLife.tsx`).
5. **Vendors' carts and street name boards** (`streetPlacement.ts`). Carts stand at the back of the
   pavement, each under a striped umbrella: tender coconuts, vegetables, or flowers with garlands
   hanging from a rail. Name boards are blue with white letters, Kannada over English, and use the
   map's real road names. Both are solid.

The Kannada on the boards is only written for numbered roads, where it follows a fixed pattern: "18th
Cross Road" becomes "18ನೇ ಅಡ್ಡ ರಸ್ತೆ", and "24th Main Road" becomes "24ನೇ ಮುಖ್ಯ ರಸ್ತೆ". Roads named after
people and places (Gurumurthy Swamy Temple Road, for one) get English only, as I'd be guessing at the
spelling.

### Why

Each of these is something you'd notice was missing if you stood on a real HSR cross road, and each is
cheap. The trees cost nothing more than before: they're the same shapes with a chosen colour. The
petals, kolams and boards are flat faces. The carts are a few hundred triangles, drawn as copies.

Carts stand 2 m from the kerb because people walk 0.7 m from it and need 0.4 m clear. Any closer and
`createLanes` would find the pavement blocked and stop sending walkers down that side.

### What I checked

Type check, lint and build pass. In Chrome, with no errors in the console:

- **Counts over the whole map:** 583 trees, 267 of them in flower; 268 bougainvilleas; 344 kolams;
  64 carts; 64 name boards.
- **On High, on screen:** a road of pink tabebuia with petals on the tarmac; a gulmohar beside a
  coconut cart; bougainvillea over a compound wall; a sun kolam outside a gate; and a board reading
  "18ನೇ ಅಡ್ಡ ರಸ್ತೆ / 18th Cross Road", the right way round.
- **On Low:** the same things in their simple shapes, with a vegetable cart in view.
- **Speed on High:** 120 frames a second on this Mac, which is as fast as the screen goes.

Two things I fixed on the way. The petals were first drawn as 25 cm squares, which looked like pink
tiles, so they're now 12 cm diamonds and there are more of them. And the board's pole ran through the
middle of its lettering, so the board now sits just in front of the pole.

**Not checked:** night, rain, Medium quality, and slower machines. I didn't ride into a cart or a
board to test that they're solid, and I haven't seen the flower cart or the back of a name board on
screen. The Kannada on the boards is worth a look from a Kannada reader, like the shop boards.
**Known limits:** a kolam sits on bare ground, not paving, where a house is set far back from the
road. Some name boards are partly hidden behind a house corner. Riding under a block of flats is
still blocked at its edge.

### Lesson 179: give copies the facts, not a random number to decode

Every tree used to carry one number, `variation`, and the drawing code worked out size, colour and
shape from it. That was fine while they were all random. It can't say "this tree is on a pink road".
So `Prop` gained three optional fields, `tint`, `kind` and `size`, and `PropInstances` uses them when
they're there: `colors[tint ?? ...]` in `setColorAt`, and `* size` on the scale. The placement code
decides what a tree is, and the drawing code only draws it. Park trees and water tanks leave the
fields out and behave as before.

### Lesson 180: one texture coordinate can be a whole colour

A name board needs a picture, and its pole needs plain grey. Two materials would mean two draw calls
per map square. Instead, the first cell of the boards' image is filled with grey (`paintSigns`), and
all four corners of every pole face point at the same spot in the middle of it (`grey` in
`createSignGeometries`). A face whose corners share one texture coordinate comes out as one flat
colour, so boards and poles are one shape with one material.

### Lesson 181: which side of a face shows, and why a wrong one looks mirrored

A board must read correctly from both sides, so it's two faces back to back. For a face looking along
`normal`, the reader's right-hand side is `up × normal`, which for a level direction is
`(normal.z, 0, -normal.x)`. Corners then go bottom-left, bottom-right, top-right, top-left, which is
anticlockwise from the front, so three.js draws the face from that side only. Get "right" backwards
and two things go wrong together: the face shows from behind, and its picture is mirrored. If you
ever see mirrored writing in a scene, check the corner order first.

### Try it

From the start, turn round and ride north about 15 m to the T-junction, then turn left. There's a
coconut cart on the left and a gulmohar behind it. Then use the phone map to reach the next road
north that runs east to west, about 75 m north of the start, and ride along it under the pink trees.
Its blue board at the west end reads 18th Cross Road. In `props.ts`, change `AVENUE_BLOOM` from 72 to
100 and reload: every tree on a flowering road is now in flower.

## 2026-11-13: Entry 66, street and area names on the phone map

### What I did

You asked for street and area names on the map, like Google Maps. The phone map now shows:

- **Street names along the roads**, from the map's real names: "25th Main Road", "18th Cross Road",
  and so on. Main roads are a little bolder and brighter. A name runs along its road, turns as the
  map turns, and is never upside down.
- **The road you're on**, in a pill at the top of the map, as a map app shows while navigating. It
  hides on unnamed roads and off the road. It only changes when another road is clearly closer, so
  it doesn't flicker at a junction.
- **Area names:** neighbourhoods in spaced grey capitals (PARANGIPALYA, HSR LAYOUT, SECTOR 2), park
  names in green italics (Kaveri Park, Hemavati Park), and housing colonies and campuses in pale
  blue (Purva Fairmont, CPWD Quarters, National Institute of Fashion Technology).
- **Parks are green** on the map, where before they were the same dark grey as the ground.

All of it comes from the map file, nothing made up. Neighbourhood names come from the addresses
OpenStreetMap gives some places (`addr:place`), and "Sector 2" from the name of a bank's ATM there,
so there are only three. If the area names should be the HSR sectors throughout, they'd need adding
by hand from a real sector map.

### Why

The map image is drawn once at start-up and then turned every frame to keep "ahead" at the top. Text
painted into that image would turn with it and end up sideways or upside down. So the names are a
separate layer (`src/ui/mapLabels.ts`), placed again every frame, on top of the turned image.

### What I checked

Type check and lint pass. In Chrome, with no console errors:

- **Phone down:** a "25th Main Road" pill at the top, "25th Main Road" running up its road and
  "18th Cross Road" across the bottom, readable over the orange route.
- **Phone raised:** 27th, 25th and 23rd Main Road, PARANGIPALYA, and a green park.
- **After turning onto a diagonal:** "24th Main Road" and "25th Main Road" lie along their
  diagonal roads, the right way up.

**Not checked:** how much the name layer costs per frame on its own. The game ran at 95 frames a
second in that last view, but I didn't measure the same spot with names off. I also haven't seen the
park and campus names on screen yet, only the code that places them.

### Lesson 182: draw what turns into a picture, and what must stay upright every frame

A rule of thumb for 2D canvases that move: anything that should move with the world (roads,
buildings, parks) goes in a picture you draw once and then transform. Anything that should stay
upright for the reader (names, pins, the rider's arrow) is drawn each frame at the screen position
the transform gives it. `toScreen` in `PhoneMap.tsx` is that transform written out by hand, and
`drawMapLabels` uses it to find where each name goes.

### Lesson 183: keeping a name the right way up

A name along a road takes the road's angle on screen, from `Math.atan2`, which can be anything from
-180° to 180°. Anything past ±90° would read upside down, so `drawMapLabels` turns it half a turn
(adds or takes away π), which keeps it on the same line but reading left to right.

### Lesson 184: overlap checks with circles

Names at different angles are turned rectangles, and testing two turned rectangles for overlap
takes some maths. Instead, each name is covered by a row of small circles along its length
(`footprint`), and two names overlap if any two circles do: a distance check. It's a little rough
at the corners, which is fine for labels. Names are placed in order of importance, and each one
that would overlap one already placed is skipped.

### Try it

Raise the phone with P and ride round a corner: watch the street names turn with the map and flip
over as a road passes upright. In `mapLabels.ts`, set `STREET_LABEL_SPACING` to 30 for more repeats
of each name, or `MAX_BEND` to 0.3 to let names sit on bendy roads too.

## 2026-11-13: Entry 67, soft headlights and street lamps

### What I did

You said other vehicles' headlights had "one trapezium that is looking weird", and that the street
lights looked flat.

**Vehicle lights** (`createVehicleGlowGeometry` in `src/traffic/vehicleShapes.ts`):

- **The trapezium was the pool of light** every vehicle paints on the road ahead after dark. It
  faded along its length, but its two sides were sharp lines, so it read as a shape painted on the
  road. It's now a grid of 8 × 7 squares whose brightness falls away to nothing towards both sides
  and the far end. It also builds up from the bumper rather than starting at full strength. It has
  no edges.
- **Headlamps and tail lamps were flat squares.** They're now small round lamps, a bright middle
  with a halo that fades out.

**Street lamps** (`RoadsideProps.tsx`):

- **The pool on the ground** faded in a straight line to a hard rim. It's now seven rings on a bell
  curve, brightest under the lamp, with no rim.
- **A cone of light** falls from each bulb to the ground: faint on a clear night, hazier in rain.
- **A halo round each bulb** always turns to face you, so lamps glow down the length of a street.

### What I checked

Type check, lint and build pass. In Chrome at night, on High:

- An oncoming SUV and a hatchback with round headlamps, and soft pools of light on the road ahead
  of them, with no hard sides.
- A street lamp with a glowing bulb, a warm pool on the pavement, and in rain a hazy cone, as well
  as halos on the lamps further down the street.

Two things went wrong on the way and are fixed. The new lamp pool was invisible at first, because its
triangles faced down (see Lesson 186). The cone was also too faint to see, so for one look I made it
ten times brighter to check it was drawn, then set it back to a subtle haze.

**Not checked:** Low and Medium quality, and the frame rate with the cones. They're one draw call
each, for the lamps within reach. After a hot reload in development, the lamps once disappeared until
the page was reloaded. I didn't chase that, as a normal page load shows them.

**Then you spotted** that tyres, feet and anything else standing in a pool of light looked sunk
into it. The pools floated 12 to 14 cm above the road, and were also pulled towards the camera
(`polygonOffset` -6) so they'd never flicker against it. Because they add light on top of whatever is
behind them, they painted over the bottom 12 to 14 cm of anything standing in them. Now every pool
sits at 6.5 cm, just 1.5 cm above the road (which is at 5 cm) and 3.5 cm above the pavement, with half
the pull (-3). Fallen petals and kolams came down to the same height. In Chrome, a lamp post and an
oncoming bike now stand cleanly in their pools, with no flicker in that view.

### Lesson 185: soft light needs corners to fade between

`MeshBasicMaterial` with vertex colours blends a triangle's colour between its three corners. One big
triangle can only fade one way, from a bright corner to dark ones, so a trapezium fades along its
length but keeps sharp sides. To fade both ways, cut it into a grid and give every corner its own
brightness. Here that's `sides × length`: a bell curve across and a ramp up then down along.

### Lesson 186: a face that's drawn back to front isn't drawn at all

The new lamp pool didn't show at first. Its triangles went round the wrong way, so they faced
down, and three.js skips the back of a face by default. The fix was to swap two corners so each
triangle goes a → b → c in the same order as its square's corners go round. It's the same rule as
Lesson 174, and a good first thing to check when something you built is invisible.

### Lesson 187: a ShaderMaterial on an InstancedMesh

The cone and the halo use `THREE.ShaderMaterial`, where you write the GLSL yourself. On an instanced
mesh, three.js still supplies `instanceMatrix`, but you must use it: `modelMatrix * instanceMatrix`
gives each copy's place. The halo uses that only for the bulb's position, `uBulb`. It moves the bulb
into camera space with `viewMatrix`, then adds the square's corners there, so the square always lies
flat to the screen: a billboard, with no work on the CPU. The cone fades at its edges with
`abs(dot(normal, toCamera))`. A side facing you means you're looking through lots of lit air, and a
side seen edge-on means very little.

### Lesson 188: a see-through layer above the ground covers what stands in it

Anything drawn without writing depth (`depthWrite: false`), such as additive light, still has to pass
the depth test. So it shows wherever nothing nearer the camera has been drawn. A tyre's bottom 14 cm
is behind a pool 14 cm up when you look down at it, so the pool's light lands on top of the tyre.
Keep such layers as close to the surface as the depth buffer allows. A small `polygonOffset` is a
better way to win the depth fight with the road than lifting the layer up.

### Try it

Press N until it's night and M until it rains, then look down a street of lamps. In `RoadsideProps.tsx`,
change the cone's `(0.3 + uRain * 0.35)` to `3.0` to see the whole cone, which is how I checked it
was there.

## 2026-11-13: Entry 68, the whole of the new map

### What I did

You put a new export from overpass-turbo in `public/data/hsr-compact.geojson` and asked to render all
of it. It's a different size of map:

| | Before | Now |
| --- | --- | --- |
| File | 1.6 MB | 14.7 MB |
| Buildings | 1,654 | 16,470 |
| Play area | 600 × 1,440 m | 3,700 × 3,080 m (every building, with about 40 m to spare) |
| Road in play | about 21 km | 332 km |
| Road points | about 2,000 | 33,975 |

`PLAY_AREA` now covers every building in the file (x −3,340 to 360, z −1,720 to 1,360). The origin
hasn't moved, so the start, the dark store and your save are where they were. Some roads in the file
run on for kilometres past the buildings; they're cut off at the edge, as before.

Just widening the play area made the game take more than a minute to start, and it never got as far
as the Start button. Here's what was slow, and what fixed it:

| Step | Before | After | Fix |
| --- | --- | --- | --- |
| Trees, lamps, parked bikes | 13.1 s | 0.03 s | A road index and a point grid (Lesson 189) |
| Park trees and benches | 3.9 s | 0.03 s | The road index |
| House kit plan | 2.5 s | 0.4 s | The road index |
| Road markings | 4.4 s | 0.06 s | Junctions in a point grid |
| Working out what each building is | about 2 s | under 0.1 s | Ruling out far buildings by their box first |
| A route to one stop | 1.06 s | 0.004 s | A heap in Dijkstra's algorithm (Lesson 190) |
| The whole world, built about 15 times over | over a minute | once, about 1.1 s | Built outside React (Lesson 191) |

Four other changes were needed for the bigger map:

- **The house kit is built as you ride** (`HouseKitMesh.tsx`). For all of HSR it's 8.2 million
  triangles, close to 900 MB. The plan (tanks, shops, parked vehicles, compound walls) is still worked
  out for everything at the start. The shapes are built only for the 160 m map squares within 600 m,
  nearest first, a few milliseconds a frame. Squares left behind are freed. Within reach that's about
  50 squares and 1.2 million triangles. Normals and colours are now a byte per number instead of
  four, which halves what's left.
- **Traffic and people are spawned from nearby roads.** They were picked at random from every road on
  the map until one landed 90 to 180 m from you. On a map 13 times bigger, that would almost never
  happen and the streets would empty. Lanes are now sorted into 60 m squares, and only those near you
  are tried.
- **The ground, the crash-physics floor and the edge walls** follow the play area, which no longer
  fits in the old 6 km square around the origin.
- **The phone map's picture** is drawn at a resolution that keeps it under 16 million pixels (1.18
  pixels per metre now, 2 before), or it would have been 180 MB. Street names are skipped for roads
  nowhere near the screen.

Also: the title screen draws trees and lamps within 400 m rather than all of them, and the loader's
size for the map file is updated to 14.3 MB.

### What I checked

Type check, lint and build pass. In Chrome:

- **Start-up:** the Start button is ready about 6 to 10 s after the page opens, including downloading
  24 MB from the dev server.
- **Riding from the start, on High:** 120 frames a second. Balconies, bougainvillea and a kolam build
  in around you, and the phone map shows 25th Main Road.
- **Far west, 2.3 km from the start:** houses, a yellow tabebuia, a coconut cart, an SUV, a bike and
  people walking. 120 frames a second, and the phone map names Hosur Road and its service road.
- **Low, Medium and High,** switched while riding, with no errors.
- **Route finding:** the new version gives exactly the same distance as the old one for all 33,975
  points, in 4 ms instead of 1,060 ms.

One thing I tried and took out: freeing the house kit's JavaScript copy once the GPU had it. It
worked until the quality changed, when three.js needed to upload it again and everything went black.

**Not checked:** a slower computer, the memory used in total (Chrome's figure wasn't reliable here),
night, and a full delivery far from the start. The dark store is still the one near the start, so
some deliveries may now be long rides. **Also:** `public/data/a.geojson` is the old map, which you
kept. Vite copies everything in `public` into the build, so it ships with the game (1.6 MB) until
it's moved or deleted.

### Lesson 189: a grid turns "check everything" into "check what's near"

Placing a tree asked "is this spot clear of every road?", which meant looking at all 9,207 road
pieces. Do that for 25,000 spots and it's 230 million distance checks. `indexRoadPieces` in
`props.ts` sorts each piece into the 32 m squares it touches once, at the start. A check then only
looks in the few squares around the spot. `PointGrid` does the same for things already placed. It's
the same idea as the collision world's grid from earlier entries. Any time code runs a loop inside a
loop over things spread across the map, a grid is the first thing to try.

### Lesson 190: Dijkstra's algorithm needs a priority queue

Dijkstra's algorithm settles one point at a time, always the nearest one not yet settled. The old
`createRouteField` found that point by looking at all of them, every time: for 34,000 points, over a
billion checks. A binary heap (`MinHeap` in `roadGraph.ts`) keeps the nearest at the front, and adding
or taking one costs about 15 steps (log₂ of 34,000) instead of 34,000. The same answer, 250 times
faster.

### Lesson 191: React may throw away a render, memos and all

`useMemo` keeps a value between renders of a component that has been shown. While a component is
being shown for the first time and a child suspends (a texture or model still loading), React
throws away the unfinished work, memos included, and starts again once it has loaded. `World` has many
children that load things, so its memo ran about 15 times. That was cheap for a small map. For a large
one it became over a minute. `getWorld` keeps the built world in a module variable, keyed by the map
data, so it's built once however many times React starts over. Dev mode's StrictMode runs memos twice
on purpose to catch problems like this.

### Lesson 192: only keep the part of the world that's near

The game already drew only the map squares near you (`ChunkedMesh`), but every square still existed in
memory. For the house kit, that was most of a gigabyte. `HouseKitMesh` goes one step further: a square
doesn't exist until you come near, and is freed when you leave. The plan for each building is fixed,
so a square rebuilt later is identical. That only holds because the kit reads a copy of the
collision world taken at the start, before trees and lamps are added (`copyCollisionWorld`).

### Try it

Ride west from the start for a couple of kilometres. Watch the balconies build in ahead and look for
Hosur Road on the phone map. In `HouseKitMesh.tsx`, set `BUILD_BUDGET` to 0.5 and ride fast: you'll
see squares arrive a moment late, which is the work being spread over frames.

## 2026-11-13: Entry 69, dark brown soil

### What I did

You said the soil looked too light. The ground's photo is a pale, dusty soil, drawn untinted. Now
`Ground.tsx` tints it with a mid brown (`SOIL_TINT`, `#8a6447`), which turns it into the dark brown
earth of HSR's empty plots and verges. On Low, where there's no photo, the plain colour is now a
dark brown too (`#5b4330`, was a pale khaki). (Changed again in Entry 71.)

### What I checked

Type check and lint pass. In Chrome, on Medium, on 18th Cross Road: the empty plot beside the road is
dark brown, with the green grass tufts standing out on it. **Not checked:** Low, and the soil at
night.

### Lesson 193: a material's colour multiplies its texture

In `MeshStandardMaterial`, `color` and `map` are multiplied together for each pixel. White
(`#ffffff`) shows the photo as it is. Any other colour scales each channel: `#8a6447` keeps about 54%
of the red, 39% of the green and 28% of the blue, so a pale photo comes out darker and browner while
keeping all its grain. It's the cheapest way to recolour a texture: no new image, no shader.

## 2026-11-13: Entry 70, paved park paths

### What I did

You asked what the grey areas on the footpath and in the park were. They were footpaths from the map,
drawn as flat 2 m strips of plain grey (`#b9b2a2`) with no texture and no shading, so they read as
grey paint. Two kinds of them didn't belong at all:

- **Sidewalks** (`footway=sidewalk`, 229 of them) are OpenStreetMap's own lines for pavements. The
  game already draws a pavement along every road, so these sat on top of it as grey bands.
- **Crossings** (`footway=crossing`, 142) are zebra crossings, drawn as grey bands across the tarmac.

Now `Parks.tsx` leaves both out, and the paths that are left, through parks and between streets, are
paved with the pavements' own stones, a shade warmer (`PATH_TINT`). On Low, which has no textures,
they're a darker plain stone colour.

### What I checked

Type check and lint pass. In Chrome, on Medium, at Kaveri Park on 16th Cross Road: the paths through
the park and the one meeting the pavement are now paved, with no grey bands. **Not checked:** Low, and
whether any crossings or sidewalks were the only way into somewhere. They're only drawn shapes, not
the paths people walk on, so nothing moves differently.

### Lesson 194: map data says more than one thing about the same place

OpenStreetMap lets people map a pavement twice: as a tag on the road (`sidewalk=both`) and as a
separate line beside it (`footway=sidewalk`). A game that draws its own pavement for every road
should skip the separate lines, or it draws the same pavement twice. Before drawing a kind of feature,
count its tags (as in Entry 1) and check which ones the game already shows some other way.

## 2026-11-13: Entry 71, zig-zag pavers, and soil that sits with them

### What I did

**Footpaths.** You asked for a better footpath texture. I put ten paving textures from Poly Haven side
by side, and you chose Patterned Concrete Pavers: the grey interlocking zig-zag blocks that most of
HSR's BBMP footpaths are laid with. It replaces Brick Pavement 03 in `pavement-color.jpg` and
`pavement-normal.jpg`, re-saved at about 270 KB and 155 KB, and `CREDITS.txt` names the new source
(CC0). One repeat of the photo covers 1.8 m, against 2.5 m for the old one, so `PAVEMENT_TILE` is
now 1.8 in `Roads.tsx` and `Parks.tsx`, and each paver comes out about 20 cm, as real ones are. The
photo is a warm beige, so the pavements are tinted towards concrete grey (`PAVEMENT_COLOR`,
`#c8c8c6`), and park paths a touch warmer (`PATH_TINT`, `#d6d0c6`).

**Soil.** You said the ground wasn't blending. You'd tried `#C97A50`, a red earth, which came out
orange against the grey pavers. I kept the red earth but dusty and dulled (`SOIL_TINT`, `#a07a63`),
so it sits between the paving's grey and the plants' green. On Low it's `#6e5444`.

### What I checked

Type check, lint and build pass. In Chrome on High: the zig-zag pattern is clear on the pavement near
Kaveri Park, and on 18th Cross Road the soil, the pavers and the grass read as one street. **Not
checked:** Low and Medium, night, and rain.

**Still hard:** where the pavement meets the soil it's a straight, sharp line. Real footpaths have a
kerb there, often painted black and yellow, which would hide the join. That would be the next thing to
add.

### Lesson 195: a texture's real size

Every Poly Haven texture lists how much ground its photo covers: 1.8 m for these pavers. The game
repeats a texture every `TILE` metres, so `TILE` should match, or every paver comes out stretched or
shrunk by the same amount. When you swap a texture, check its size along with its look.

## 2026-11-13: Entry 72, kerbs

### What I did

The pavement met the road and the soil in flat, sharp lines, which looked more like a game than a
street. `src/world/Kerbs.tsx` adds two kinds of edge along every road:

- **A kerb between the road and the pavement:** 18 cm wide, standing 13 cm high. On main roads
  (secondary and tertiary) it's painted in alternating black and yellow blocks of 0.9 m, as HSR's are,
  with a thin gap between blocks. On other roads it's bare grey concrete, in one of three shades.
- **A low edge between the pavement and the soil:** 12 cm wide and 7 cm high.

Each edge is walked in 50 cm steps, and a stretch is left out where it would cross another road
(the kerb) or another road's pavement, a building or a wall (the edge). So junctions stay open, and
nothing runs through a compound wall. Only the top and the two long faces are made, as the ends and
the bottom are never seen, and the sides are a shade darker than the top.

Kerbs are only for looks: the scooter rides over them, so nothing about riding changes.

### Why the numbers

The whole map has about 950,000 triangles of kerb. They're drawn within 260 m, in the map's 160 m
squares, with normals and colours a byte each (as for the house kit), which halves their memory. They
take about 0.6 s to build. The first version was built 14 times while the game loaded, because React
starts over while textures load (Lesson 191), which added about 8 s. They're now kept in a `WeakMap`
keyed by the road list, so they're built once.

### What I checked

Type check, lint and build pass. In Chrome on High:

- **18th Cross Road:** a grey kerb along both sides of the road, and the low edge where the pavers
  meet the soil.
- **24th Main Road:** black and yellow kerbs, open where 18th Cross Road joins.
- **Start-up:** ready in 8.4 s, back to what it was. 120 frames a second.

**Not checked:** Low and Medium, night, and how a kerb looks across a gate or driveway. It runs
straight across, where real ones dip.

### Lesson 196: build only the faces anyone can see

A box has six faces, but a kerb lying on the ground never shows its bottom, and its ends are hidden
against the next block or the junction. Leaving those three out halves the triangles. Ask which faces
can ever be in view before building a shape that will be copied a million times.

### Lesson 197: a WeakMap as a cache

`built` in `Kerbs.tsx` is a `WeakMap` keyed by the array of roads. A normal `Map` would keep the
roads and their kerbs in memory for ever. A `WeakMap` lets both go once nothing else holds the roads,
which suits a cache that should live as long as the data it was made from.

### Try it

Ride along 24th Main Road and look down at the painted kerb. In `Kerbs.tsx`, add `'residential'` to
`PAINTED_ROADS` to paint every street, then take it out again. Painted everywhere, it's too busy, which is
why HSR keeps it for the main roads.

## 2026-11-13: Entry 73, nothing slides any more

### What I did

You saw people and vehicles sliding, moving sideways instead of turning. There were three causes,
all in `src/traffic/trafficLogic.ts`:

1. **Everything was pinned to a point on its path.** A path is a chain of straight lanes that turns
   sharply at each junction. Each frame the body was pulled towards the point on the lane, and its
   heading eased round separately. At a corner the point jumped onto the new lane at once, so the body
   moved off in the new direction while still facing the old one.
2. **Bikes squeezing past and people stepping aside** were moved sideways off their line, with no
   turning at all.
3. **People who met were pushed apart sideways every frame** (`separatePeople`).

Now everything steers (`steerAlong`):

- It aims at a point a little way ahead on its path: 2.5 to 7 m for vehicles, depending on speed,
  1.1 m for people. That point carries on round the next corner, so the next lane is now chosen in
  advance (`pickNext`).
- It turns towards that point no faster than it can. A vehicle turns no tighter than its turning
  circle (4.5 m for cars, 2.4 m for bikes and autos), so it can't turn at all while stopped. People
  turn on the spot.
- It only ever moves the way it faces. Corners come out as curves.
- Its place on the path (`along`) runs on as before, so traffic lights, gaps and queues work as they
  did. The body goes a little slower when ahead of that place, as when cutting a corner, and a little
  faster when behind.
- Vehicles now slow down before sharp turns (`nextTurn`): a right angle at 4.5 m/s, gentler bends
  faster.
- A sideways move (a bike squeezing past, someone dodging the rider) moves the line it aims at, so it
  steers over.
- People notice each other 2.2 m off and each step aside, opposite ways, so they pass on the footpath.
  They're only pushed apart if they still touch, which in my test didn't happen.
- Anything more than 2.5 m from its path (after a knock, or when the next path starts on the other
  pavement) turns and heads straight back to it, a little quicker, as someone crossing the road does.
  Before, it was dragged sideways across.

### What I checked

I measured the angle between the way each one faces and the way it actually moved, every frame, in
Chrome:

| | Steps measured | Off by more than 10° |
| --- | --- | --- |
| Vehicles | 29,217 | 0 (largest 0.00°) |
| People, standing at the start | 32,001 | 206 (0.6%), in the first version |
| People, riding through traffic, final version | 35,972 | 0 |

Type check, lint and build pass. **Not checked on screen:** how the curves through a junction look,
and whether vehicles now slowing for turns makes queues at junctions longer. A vehicle that bumps
someone at a crawl still nudges them aside, which is a push, not a slide.

### Lesson 198: move along the heading, and steer the heading

The simplest way to make something follow a path is to set its position on the path every frame and
point it along the path. Do that, and position and direction are two separate things, which is what
sliding is. A vehicle moves the other way round: it can only go where it's pointing, and it changes
where it's pointing by steering. Moving only by `sin(heading)` and `cos(heading)`, and changing
`heading` by a limited amount each frame, makes sliding impossible by construction.

### Lesson 199: pure pursuit

Aiming at a point a fixed distance ahead on the path and steering towards it is called pure pursuit,
and it's how many real self-driving cars follow a route. A short distance follows the path tightly
but weaves. A long one is smooth but cuts corners. Tying it to speed (`aimTime`) gives tight
following when slow, and smooth lines when fast.

### Try it

Stop at a junction and watch a car turn across in front of you: it slows, swings round in a curve
and straightens up. In `trafficLogic.ts`, set `carTurnRadius` to 12 and watch cars swing wide like
buses. Then set it back.

## 2026-11-14: Entry 74, the Iblur Military Area is walled off

### What I did

You asked to make the Iblur Military Area off limits, with a high wall round it. It's a single
fenced outline in the map file (`landuse=military`), 8.6 km round. Most of it lies east of the play
area, but about 0.2 km² of its western edge is inside it, along 27th Main Road.

- **No way in** (`src/world/restricted.ts`). When the map loads, every road and footpath is cut where
  it crosses the boundary, and only the parts outside are kept. One road and three tracks went
  inside. They now stop at the wall, so no traffic, people, delivery stop or route goes in.
  Everything that builds on the road list (lanes, kerbs, trees, the phone map's names) sees the cut
  roads.
- **A wall** (`RestrictedWall.tsx`) wherever the boundary falls inside the play area:
  - Plastered and 3 m high, with a darker band along the bottom.
  - Pillars every 4 m, each with a post on top carrying four strands of barbed wire that sag a little
    between posts.
  - A red-and-white board on the outside about every 140 m, centred between two pillars: "ನಿರ್ಬಂಧಿತ
    ಪ್ರದೇಶ / RESTRICTED AREA / NO ENTRY · NO PHOTOGRAPHY".
- **Solid** (`addRestrictedWalls`). Added to the collision world before anything else is placed, and
  1.5 m thick on the inside, out of sight, so even a fast scooter on a slow computer can't get
  through in one frame.
- **On the phone map**, the area is filled dark olive, and its name was already labelled there.

The kerb code's box builder moved to `src/world/blocks.ts` so the wall could use it too. It now also
makes end faces (for pillars) and boxes that start above the ground (for the posts and the wall above
its band).

### What I checked

Type check, lint and build pass. In Chrome on High, on 27th Main Road: the wall with pillars, barbed
wire and a warning board, behind the soil verge and the painted kerb. Riding straight into it at full
speed, the scooter stopped and slid along the outside. The phone map shows the olive area.

**Not checked:** the wall's southern stretch (near x 160–250, z −1,610 to −1,300), night, and Low. The
Kannada on the board is mine and worth a check, as with the other boards. The one building inside
the area is still drawn, behind the wall.

### Lesson 200: change the data, and everything downstream follows

The wall could have been drawn and made solid on its own, with traffic, deliveries and routes each
taught to avoid it. Instead the roads are cut once, as the map loads (`cutOutRestricted`), and
everything built from them (lanes, kerbs, trees, routes, labels) simply never sees a road inside.
When a rule applies to the world itself, put it as early as possible, in the data, and the rest of
the code needs no changes.

### Lesson 201: where two lines cross

`crossings` finds where a road segment from a to b crosses a boundary edge from c to d. Write each
as a start plus a fraction of its length: a + t(b − a) and c + u(d − c). Setting them equal gives two
equations, and their solution has the same denominator, the 2D cross product of the two directions.
It's 0 when the lines are parallel. They cross only if both t and u are between 0 and 1. The road is
cut at each t, in order, flipping between inside and outside each time.

### Try it

Use the phone map to reach 27th Main Road about 650 m south of the start, near the olive area, and
ride along it: the wall runs beside you on the east side. Then try to ride into it.

## 2026-11-14: Entry 75, plaster on balconies, compound walls and boundary walls

### What I did

You asked for texture on the walls of houses, balconies and boundaries. The house walls already
had the plaster photo, but everything the house kit adds was flat paint: balconies, parapets, roof
rooms, compound walls, gate pillars, and also the new military wall and the kerbs. Next to the
mottled house walls, those looked like plastic.

They have no texture coordinates, so `src/world/plaster.ts` adds the photo in the shader instead
(`createPlasterMaterial`):

- The UVs come from the world position, projected from whichever way each face points: walls facing
  east or west use Z and Y, walls facing north or south use X and Y, tops use X and Z. Where a face
  leans, the three are blended. This is triplanar mapping (Lesson 202).
- Only the photo's light and shade is used, divided by its average brightness (measured once from a
  32 × 32 copy), so each piece keeps its own paint and just gains grain and patches.
- The plaster photo is soft, so its contrast is boosted: 2.2 times for the house kit, 2.6 times for
  the long military wall, and 1.8 times for the kerbs, which use the concrete photo. The result is
  kept between 60% and 135% of the paint, so a dark speck can't turn into a black hole.
- On Low, the kit stays flat paint, as Low's house walls have no photo either.

Two fixes on the way. Changing quality used to free every house-kit square, because the clean-up was
tied to the material. Now a quality change only swaps the material on the squares already built.
And the first strength (0.55) was too subtle to see, so I tried 3 to make sure the shader ran, then
settled on 2.2.

### What I checked

Type check, lint and build pass. In Chrome on High, on 18th Cross Road, the compound walls and
balcony have the same patchy plaster as the house walls behind them. On 27th Main Road, the military
wall has it along its length. 97 frames a second there. **Not checked:** Medium, night, and the
cost of the extra texture reads on a slower machine.

### Lesson 202: triplanar mapping

A texture needs to know where on the image each point of a surface is (its UV). Shapes built in
code often don't have UVs, and working them out for every box is tedious. Triplanar mapping skips
it. Each pixel looks up the image three times, as if projected from the side, from the front and
from above, using its world position as the coordinates, and blends them by its normal. A wall facing
east gets almost all of the side projection. The cost is three texture reads instead of one, and
it's why the kit, the wall and the kerbs could all be textured without touching their geometry.

### Lesson 203: three.js compiles a shader once and shares it

`customProgramCacheKey` returns the same key for every plaster material, so three.js compiles the
GLSL once. Each material still gets its own uniforms, which is how the kit, the wall and the kerbs
can use different photos and strengths with the same shader.

## 2026-11-14: Entry 76, crashed riders and wrecks are solid

### What I did

You found two ways through traffic:

1. **Your thrown rider went through cars.** When you crash, the rider flying off the scooter is moved
   with simple maths in `ScooterController.ts` (`stepThrownRider`), which only checked buildings and
   walls. Cars, bikes and parked scooters weren't in that check.
2. **A car that had already crashed could be ridden through.** When a vehicle is hit hard, it becomes
   a Rapier body. From then on, `stepTraffic` stepped its physics and moved on, skipping
   `hitRider`, the check that stops the scooter at a vehicle. The same was true while it was being
   stood back up.

Both are in `src/traffic/trafficLogic.ts`, which knows about every vehicle:

- **`blockRider`** runs for crashed and righting vehicles. It's a bump by weight (`resolveHit`), as
  for a moving vehicle, but it never launches anything: a wrecked car stops the scooter, and a light
  fallen bike barely slows it. Rapier was already pushing the body with the scooter's invisible
  "pusher". This is the other half, which stops the scooter, as Rapier doesn't move it.
- **`blockThrownRider`** runs after each physics step, while you're off the scooter (thrown, lying,
  getting up or walking back). Any vehicle, moving or crashed, and any parked scooter pushes your
  body out of itself. The speed you were carrying into it is turned round with a little bounce,
  sliding along the side is kept, and your roll is cut. A hard hit plays a thud. Thrown higher than a
  vehicle's roof by 15 cm or more, you clear it, so a big crash can still throw you over a bike.

### What I checked

In Chrome, with the scooter and traffic briefly reachable from the console:

- **Into a car at 15 m/s:** the scooter crashed, the rider was thrown, lay down, got up and walked
  back, and never came within the car's outline.
- **Into a crashed car at 9 m/s** (a hatchback turned into a resting body): the scooter stopped 0.6 m
  from its side, which is the scooter's own radius, and crashed as against any car. It never got
  inside, and the car didn't move. Before this change, nothing stopped it there.
- **Into a fallen bike:** the scooter's pusher shoves it away before they touch, which is what a
  light bike lying in the road should do.

Type check, lint and build pass. **Not checked on screen:** how the rider's bounce off a car looks.
Pedestrians are still not in the rider's check, so a thrown rider can pass through someone standing.

### Lesson 204: two physics, one world

The game runs two kinds of physics side by side: arcade rules for the scooter and traffic, which are
quick and predictable, and Rapier for things that tumble. They don't see each other on their own.
Rapier sees the scooter only as a "kinematic pusher" that moves things but is never moved itself, and
the arcade code sees Rapier's bodies only if it asks. Every pair that should touch needs a check in
both directions: Rapier for the body's side, arcade code for the scooter's. A missing direction is
exactly what makes something pass through.

## 2026-11-14: Entry 77, building sites on open plots, and a faster start

### What I did

You asked for buildings under construction on a few open plots. `src/world/sitePlacement.ts` finds
plots, and `ConstructionSites.tsx` draws them.

**Where they go:** the areas the map marks `landuse=construction` (25 of them), where a plot fits, and
now and then an empty plot beside a residential road, set back from the pavement and facing it. A
plot must be clear of buildings, walls, roads, parks and military land, and at least 300 m from
another site. That gives 54 sites across HSR. They're placed after the house kit and before trees and
lamps, and each gets a solid wall round it, so trees keep clear and the scooter can't ride in.

**What a site looks like**, as an HSR building going up:

- A bare concrete frame of 2 to 4 floors: columns every 3.6 m, and slabs on every floor but the top.
- Rebar sticking up out of the top floor's columns.
- Brick walls going in on the lower floors: the back and sides, and part of the front.
- Bamboo scaffolding across the front, with green shade net hung on part of it (see-through, drawn
  separately).
- In the yard: a heap of sand, a stack of bricks, cement bags under a blue tarp, and the builder's
  board on two posts.

The concrete has the concrete photo's grain (`createPlasterMaterial`, from Entry 75).

### The slow start, and the fix

The first version took 37 s to reach the Start button. Placing the sites was quick (16 ms), but each
new part that loads a texture adds another round of React starting over (Lesson 191). With no
boundaries, every part of the world not yet on screen was thrown away and rebuilt each time.

`World` now wraps every part, the player and traffic included, in its own `<Suspense>`. A part that's
still loading only holds up itself, and the rest go on screen and stay there. On the dev server the
start went from 37 s to about 13 s. On the production build it's about 9 s with files cached, as it
was before the sites.

### What I checked

Type check, lint and build pass. In Chrome on High, from 21st Cross Road: a four-floor site facing
the road, with the frame, brick walls, scaffolding and green net, and the sand, bricks, tarp and board
in its yard. **Not checked:** night, Low, the sites inside construction areas (which face along the
area's longest side, not necessarily the road), and whether any site blocks a delivery stop.

**Still slow:** about 6 s of start-up, after the world is built, goes on the parts setting
themselves up. The buildings are the biggest at about 3 s. That's the next thing to speed up.

### Lesson 205: Suspense boundaries keep finished work

Suspense isn't only for loading spinners. When a component suspends, React keeps everything up to the
nearest boundary above it and throws away the rest of the unfinished render below that boundary. One
boundary round a whole scene means any texture still loading throws away the whole scene, however
much work it took. A boundary per part means a part that's ready goes on screen and stays there. With
`fallback={null}`, nothing shows for a part until it's ready, which is fine behind a title screen.

## 2026-11-14: Entry 78, smooth riding on a sharp screen

### What I did

You said the deployed game felt a little laggy. I measured a production build in Chrome on this Mac
(Apple M5, 120 Hz screen, 2 screen pixels per point), riding 1 km up 24th Main Road on High.

**What I found:**

- Frames took about 10.5 ms. The screen refreshes every 8.3 ms, so some pictures stayed up for one
  refresh and others for two. That uneven rhythm is the lag you felt, even at about 95 fps.
- The JavaScript per frame was small: about 1 ms for every `useFrame` together, and 2.5 ms for
  three.js to send the draw calls. The GPU was the limit.
- I switched things off one at a time to see what the GPU spends its time on:

  | At 2 pixels per point | Average frame |
  |---|---|
  | As it was | 11.2 ms |
  | No traffic-light lamps (600,000 triangles) | 11.2 ms |
  | No shadows from the house kit | 10.8 ms |
  | Shadow map 2048 instead of 4096 | 11.0 ms |
  | No shadows at all | 8.4 ms (the screen's limit) |
  | 1.5 pixels per point | 8.4 ms (the screen's limit) |

  Triangles barely mattered. Pixels did: High drew at 3024 × 1656, five million pixels, and each one
  looks up the shadow map several times.

**The fixes:**

- High now draws at most 1.5 pixels per point, not 2 (`qualitySettings.ts`). That's just over half
  the pixels, and while riding it's hard to see the difference. Riding the same road: 120 fps, no
  late frames, slowest frame 10 ms.
- A new `AdaptiveResolution` component (`src/world/AdaptiveResolution.tsx`, store in
  `src/game/resolution.ts`) watches frame times and lowers the resolution a quarter step at a time
  when frames are late, down to 0.75. It steps back up after five calm seconds. Slower laptops get
  smooth riding instead of a stutter.
  - A frame is late when it takes over 1.3 refreshes. The refresh is the fastest the screen has been
    seen to go, never taken as slower than 60 Hz nor faster than 120.
  - Two late seconds in a row are needed, so one hitch doesn't change anything. It waits 3 s after
    Start, while shaders compile.
  - If a step up is too much straight away, that level isn't tried for a minute, so the picture
    doesn't keep sharpening and blurring.
- Traffic-light lamps use 8 × 5 spheres instead of 12 × 8: 3,582 lamps, 600,000 triangles down to
  about 230,000. It made no difference here but helps a weaker GPU.

### What I checked

Type check, lint and build pass. I tested the adaptive part by adding a delay that grows with the
pixel count, to act like a slower GPU. It stepped from 1.5 to 1.25 and tried 1.5 once more. That was
too slow, so it went back to 1.25 and held there. A minute after the delay was removed it was back at
1.5, at 120 fps. **Not checked:** night and rain (more light pools, more pixels to shade), Medium and
Low, and a real slower machine.

### Lesson 206: frame pacing, and finding what the GPU is busy with

**Pacing.** A screen shows a new picture only when it refreshes. If a frame takes 10 ms and the
screen refreshes every 8.3 ms, that frame waits for the next refresh, so pictures stay up for 8.3 ms,
then 16.7 ms, unevenly. 90 uneven frames a second feel worse than 60 even ones. What matters is
fitting under the refresh every time, not the average.

**Finding the cost.** The GPU works in parallel with JavaScript, so timing `gl.render()` only
measures sending the work, not doing it. The honest test is to make the GPU the limit (here, by
drawing at 2 pixels per point), then switch one thing off and see if frames get faster. If halving
the pixels helps and halving the triangles doesn't, the cost is per pixel ("fill rate"): resolution,
shadows, heavy shaders. If triangles matter, it's geometry: draw distance, detail, instancing.

**Resolution in R3F.** `<Canvas dpr={[1, 2]}>` means "the screen's own pixel ratio, kept within 1
and 2". R3F reapplies this prop every time the Canvas renders. So to change the resolution while
playing, the prop itself has to change: here it reads from a small store that `AdaptiveResolution`
updates. Calling `setDpr` directly would be undone the next time the Canvas renders.

## 2026-11-14: Entry 79, Play straight away, and a loading screen that builds while it downloads

### What I did

You asked for the Play button to work from the start, with the download running in the background
from the first page, and a big loading screen after Play that shows the download and the building
side by side.

**The title page.** Play works as soon as the page shows (Enter works too). Under it, a thin bar and
a line: "Downloading the city in the background: 18%, 4.4 of 24.1 MB", then "City downloaded". The
download starts when the page opens, as before.

**The loading screen** (`src/ui/LoadingScreen.tsx`), after Play:

- The game's own screenshots, cut into panels with black gutters, in three layouts: one big panel
  with two stacked beside it, a wide panel over two, and one full-screen shot. The layouts take
  turns every 9 s, cross-fading, and each panel drifts slowly.
- A tip along the bottom left, a new one every 7 s: drifting, the phone, the base reward, the radio
  and horn, time and weather, and OpenStreetMap.
- Bottom right, two progress lines and a spinner:
  - the download, if it isn't finished ("Downloading the city 83%, 20.2 of 24.1 MB");
  - the build: "Waiting for the map", then "Laying out the streets", then "Built: trees and lamps"
    and so on as each part goes on screen, then "Ready".
- When every part is on screen and the first delivery is planned, the ride starts and the loading
  screen fades out over it.
- If the download fails, it says so, with a Try again button.

**Building while downloading.** The world used to wait for every file. Now it starts once the map
and the physics engine are in, and the models and textures carry on downloading. A part that needs
a file that hasn't arrived waits on its own (each part has its own Suspense boundary, from Entry 77),
and the rest go ahead.

That only works if nothing is downloaded twice, so the preloader (`src/game/preload.ts`) now
fetches models and textures through three.js's own loaders, the ones the world uses:

- `FileLoader` keeps a list of requests in flight. If `useGLTF` asks for a model the preloader is
  still downloading, it's added to that request instead of starting another.
- `ImageLoader` puts each image in `THREE.Cache` the moment it starts. If `useTexture` asks for it,
  it waits for that image to finish.
- The map is downloaded by the preloader alone, and the map loader waits for it
  (`waitForPreloadedMap`).

The shop fronts loaded their photo boards with a plain `new Image()` when the cache didn't have
them yet, so with a slow connection they came down twice. They now use `ImageLoader` too, which
also fixes a board being drawn blank from an image still downloading.

**Knowing what's built.** `src/game/launch.ts` holds the list of world parts and their names, and a
small store: Play pressed, the loading screen painted, the streets laid out, and the parts on
screen. In `World`, each part is wrapped in `<Part name="...">`, which is its Suspense boundary plus
a tiny `Built` component beside the part. `Built` mounts only when its whole boundary does, so its
effect says "this part is on screen".

### What I checked

Type check, lint and build pass. On the dev server, Play goes straight to the loading screen, the
lines move, and it fades into the ride. To test a slow connection, I put a proxy in front of the
dev server that slowed the models and textures to 120 KB/s each and the map to 2 MB/s. The streets
were being laid out at 83% downloaded, and the build was at "trees and lamps" at 99%. Every file was
downloaded once (it was five twice before the shop board fix). The ride started about 25 s after
Play. **Not checked:** a phone-sized screen, reduced motion, the failure message, or Safari.

### Lesson 207: animation that keeps going while JavaScript is busy

Building the city keeps the page's one JavaScript thread busy for seconds at a time. Nothing done in
JavaScript can move then: no React update, no `requestAnimationFrame`, no timer. But browsers run
CSS animations and transitions of `transform` and `opacity` on a separate thread, the compositor,
which only moves and fades layers that are already painted. So everything that moves on the loading
screen (the drifting panels, the scenes taking turns, the tips, the spinner, the glint on the bar)
is a CSS animation of those two properties, with timings set by `animation-delay`, not timers. The
numbers in the progress lines change only between the busy stretches, and that's fine.

Two details make it work. The screen must be painted before the busy work starts, so the world
waits until the loading screen has decoded its pictures and two frames have passed (the
`curtainDrawn` flag). Otherwise the click would freeze the title page instead. And
`will-change: transform` tells the browser to give an element its own layer up front, so the
compositor can move it without asking the main thread.

**Follow-up:** the Play button no longer takes focus by itself. A button focused when the page opens
counts as focused "by keyboard", so it showed the white focus ring straight away. Enter still plays,
as the title page listens for it on the whole window. Pressing Tab still shows the ring, for people
who use the keyboard to move around.

## 2026-11-15: Entry 80, wheels on the road, and people who walk like people

### What I did

**Why things sank.** The road is drawn 5 cm above the soil, the pavement 3 cm, the kerbs stand
13 cm, and the scooter, its rider and all the traffic were drawn at height 0. So every tyre was
always 5 cm into the road, and a kerb went straight through the wheel. On top of that, the scooter
tilted about a point on the ground: braking dipped the nose and pushed the front tyre into the
road, and a crash tipped it 1.3 radians about its middle, putting half the bike under the tarmac.

- **New `src/world/surface.ts`** holds the surface heights (moved out of `Roads.tsx` and
  `Kerbs.tsx`) and `createSurface(roads)`, which answers "how high is the ground here?" from the
  road grid: road, kerb, pavement, edging or soil, by how far the point is outside the nearest road's
  edge (new `nearestRoadEdge` in `props.ts`). It's built once in `buildWorld` and given to the player.
- **Each tyre follows the ground** (`followGround` in `ScooterController.ts`). Up a step it rolls
  up over a little forward travel (`climbPerMetre`), the way a round wheel meets an edge. Down a
  step it falls under gravity, so riding off a kerb is a little drop and landing.
- **`Scooter.tsx` has a new nesting**: position and heading, then a `terrain` group that tilts with
  the two wheel heights (nose up while only the front is on the kerb), then `lean`, which holds the
  wheels, then `body`, which carries everything the suspension carries. Braking and throttle pitch
  only `body`, so the tyres stay on the road.
- **Nothing goes into the ground.** The scooter's shapes are boiled down to about two hundred
  "probes" (`createScooterProbes`). Every frame, after leaning, the scooter lifts by however far the
  lowest probe went under. Riding, that's the edge of a tyre's rounded tread. On its side, it's the
  side of the body, so a fallen scooter now lies on the road instead of in it. The rider gives
  twelve probes too (hips, chest, helmet, elbows, hands, knees, feet), which lift a thrown rider
  lying face down, whose helmet used to be in the road.
- **Traffic** is drawn on the road surface, and pedestrians on the pavement. Road markings came
  down to 1 cm above the road (their polygon offset stops flicker), so tyres don't sink into them.

**Walking.** Pedestrians' legs were straight sticks swinging on a sine wave, and the body bounced
highest when the legs were furthest apart. So their feet skated, one foot passed through the ground
on every step, and they floated. Now (`traffic/gait.ts` and the shader in `Traffic.tsx`):

- each foot is **planted** for 55% of a stride, sliding back under the body at exactly the speed
  the body moves, then **lifted and swung** forward;
- the legs have **knees**: a ring of corners at knee height, and the shader works out the thigh and
  shin angles that put each foot where it should be (inverse kinematics);
- the hips **dip** when both feet are down, the way a body does;
- strides follow the **ground actually covered**, so someone hurrying out of your way doesn't
  moonwalk;
- people standing still (customers at the door) stand with their feet together, with a little
  weight shift, instead of frozen mid-step.

The thrown rider now **jogs** back to the scooter in the same way, with the jog's own numbers
(`JOG` in `riderShape.ts`): speeding up from a standstill, turning to face the scooter rather than
snapping round, arms bent and pumping, a lean into the run. Two old slips are fixed with it: once off
the scooter, the shoulders were still where they are when sitting, 16 cm in front of the body, and
the head kept tipping back as if peering over handlebars.

### What I checked

Type check, lint and build pass, and the console is clean. On the dev server, with a temporary hook
(removed): riding over a kerb, the front wheel goes 0.05 → 0.13 (kerb) → 0.03 (pavement) and back,
smoothly. In a crash, the scooter lies on its side on top of the road, and the rider lies on the
pavement, not in it. The jog back has a knee up and the arms pumping. A pedestrian walking past is
mid-stride with a bent knee and both feet on the pavement. **Not checked:** night, Low and Medium
quality, a phone, how the delivery customers look walking, and kerb bumps at full speed for long.
Kerbs are found from the roads, not from the kerb blocks themselves, so a gap in the kerb (where it
meets a wall) still counts as kerb.

### Lesson 208: standing on the ground, and why feet skate

Three ideas made this work, and they come up in every game with things on the ground.

**One source of truth for the ground.** If the road is drawn at 5 cm, everything that touches it
has to ask the same question, "how high is the ground here?", of the same code. Here it's
`Surface.heightAt`. Constants copied into each file drift apart, and that's how the tyres ended up
5 cm in the road.

**Lift by the lowest point, not by the middle.** A rotation turns about one point, but what touches
the ground changes as something tilts: the tyre tread, then the side of the bike. So instead of
working out a pivot for every case, turn freely, then find the lowest point and lift by that much.
Checking every corner of a model each frame is too slow, so a few "probe" points stand in for the
shape: only the outermost points of each slice can ever be lowest.

**A planted foot moves with the ground.** A foot on the ground doesn't move in the world, so in the
body's own space it slides backwards at exactly the walking speed. A sine wave can't do that: it's
fast in the middle and slow at the ends, so the foot skates. The gait here is in two parts: a
straight line back at the body's speed while planted, then a quick swing forward through the air.
How fast the stride goes comes from how far the body has moved, not from time. Then inverse
kinematics (as with the rider's arms on the handlebars) bends the knee to put the foot there.

## 2026-11-15: Entry 81, cars that turn in time

### What I did

Some cars swung wide at junctions and drove through the buildings on the far side. I added a
temporary probe that checked every car, every frame, for being inside a building. In 30 seconds it
caught four, and none of them had been hit: all were driving normally, 3 to 8 m off their lane, just
after a sharp turn.

**Why.** A car can't turn tighter than its 4.5 m turning circle. It steers by aiming at a point a
little ahead on its lane, and at junction speeds that point was only 2.5 m ahead. So the car didn't
start turning until 2.5 m before the corner, which is too late for a 4.5 m circle, and it ran wide
into the corner building. Meanwhile its place on the lane carried on round the corner, and the car,
now behind, hurried to catch up, which made it look wilder still.

- **Turn in time** (`stepVehicle` in `trafficLogic.ts`): coming up to a corner, the aim point
  reaches at least `radius × tan(angle / 2)` ahead, which is how early a turn on that circle must
  start (`sharpestCorner` caps it for near U-turns).
- **Walls stop driving traffic.** The traffic world now keeps the collision world, and each moving
  vehicle is pushed out of any building it would enter (`wallMargin`), the same push the scooter uses.
- **No grinding for ever.** A vehicle pressed against a wall for 3 s, more than 30 m from the rider,
  is taken away, and a new one appears elsewhere (`pinned`, `pinnedTime`).

### What I checked

Type check, lint and build pass, and the console is clean. The same 30-second probe found no cars in
buildings, and neither did a 40-second run. Eight rams at 16 m/s knocked four cars, and no thrown
car went into a wall. Nine cars touched a wall in that 40 seconds and were stopped by it, so some
corners are still taken a bit wide. I also saw a car stopped at a red light 21 m from its lane,
facing the wrong way. It wasn't in a wall, and I've left it for now.

### Lesson 209: measure before guessing

"Cars pass through walls" had several possible causes: the crash physics (thin walls a fast body can
tunnel through), cars heading straight back to their lane after a knock, or the normal steering. A
probe running every frame, recording each car found inside a building along with what it was doing
(hit or not, how far from its lane, how fast), settled it at the first try: undamaged cars, just
after corners. A short trace of one car showed its heading turning a fixed amount each frame while
the gap to its lane grew, which pointed straight at the turning circle and the aim point. Then the
same probe, run again, showed the fix worked. Keep these probes temporary, and take them out after.

**Follow-up, the same day: cars on the footpath at turns.** The fix above swapped one fault for
another. Aiming further round the corner made cars start turning early, but steering at a point
far ahead cuts the inside of a bend, so they mounted the footpath on the inside instead.

The better fix gives each corner a real curved path (`findCorner` in `trafficLogic.ts`). Where one
lane meets the next, the corner is rounded off with a quadratic Bézier curve. The curve leaves the
first lane a short way (the "leg") before the point where the two lanes' lines cross, bends through
that point, and joins the second lane the same distance after it. The leg is r × tan(angle / 2),
about the turning circle, kept within half of each lane so the curves at the two ends of a short
lane don't overlap. `pathPoint` maps a place on the lanes onto this path, so a vehicle near a
corner aims at a point on the curve. That needed `prevLane` on each mover, as the end of the curve
lies on the next lane. Two numbers also changed:

- the shortest look-ahead went from 2.5 m to 1.2 m (`aimMin`), as a long one shortcuts a tight curve;
- vehicles may turn a little tighter than their nominal circle (`steeringSlack`), to hold curves
  that come out tight on short lanes.

The earlier "aim further round the corner" change is gone. The wall push and the stuck-car
replacement stay as a safety net.

**Checked**, with temporary hooks (removed). Every one of the 501 corner curves within 400 m stays
on the road. Cars were cutting about 1 m inside the curve before the look-ahead change. Over
40 seconds of traffic, a corner of a car was off the road in 0.49% of car-frames (1.77% before),
its centre in 0.11% (0.71% before), and no car touched a wall. A car watched turning out of a side
street stayed on the tarmac. Most of what's left is the corner of a car's body just over the inside
kerb on narrow roads. Lanes run 1.4 m left of the road's centre whatever the road's width, so the
inside kerb is close on a 5 m road. Type check, lint and build pass.

## 2026-11-15: Entry 82, kolams that fit the pavement

### What I did

Kolams outside house gates were running under the kerb, which cut them in two. Each one is 1.5 m
wide and was put 0.95 m out from the compound wall, so it reached 1.7 m out. The pavement in front
of a compound wall is often only about 1.3 m wide to the kerb. The house kit finds the road in 0.5 m
steps, so the pavement can be narrower than planned.

Now `houseKit.ts` measures the real room. It asks how far the road's edge is from the wall's face
(`nearestRoadEdge`) at the gate's middle and at both sides of where the kolam would go, because the
road needn't run square to the wall. Then it takes off the kerb and a small gap at each side. The
kolam is drawn as wide as that, up to 1.5 m, and left out where there's less than 0.9 m. `Prop` has
a new `width` for this, which `StreetLife` uses for the kolam's size. Kolam is the Tamil name; this
is what the user calls a rangoli.

### What I checked

On the dev server, with a temporary hook (removed), I tested every kolam in the city, at 81 points
across each one, against the surface heights. Before this second version, 27 of 2,025 touched a
kerb, all where the road runs at an angle to the wall. Now 0 of 1,952 touch a kerb or the road.
About half are full size, and the smallest is 0.9 m. Type check, lint and build pass. **Not
checked:** looking at one on screen.

## 2026-11-15: Entry 83, the woman's face and arms

### What I did

The women walking about are still built in code (`createWomanGeometry` in `peopleShapes.ts`), and
their skin looked patchy. Her hair was a ball of radius 0.12 m, centred just 3.5 cm above and 1.5 cm
behind the head, which is a ball of 0.115 m. Round the sides of the face, the two surfaces were
within a millimetre of each other, so the graphics card couldn't settle which was in front, and the
face showed in blotches of skin and hair. Her arms were bare skin sticks with flat ends.

- The hair is now clearly bigger (0.13 m) and sits up and back, so it covers the top and back of
  the head, and the face is plainly in front of it.
- She has half sleeves in her outfit's colour, with a ball rounding each shoulder, skin forearms,
  and hands. The new balls swing with the arms (same `swing` and `joint` as the arm).
- `ball()` takes an `x` now, for the shoulders and hands.

### What I checked

Type check, lint and build pass. On the dev server, with a temporary hook (removed), I looked at a
woman from the front, close up: the face is evenly skin-coloured with the hair on top, and the
shoulders, sleeves, forearms and hands look right. **Not checked:** her walking up close, or at night.

### Lesson 210: z-fighting

The depth buffer keeps, for every pixel, how far away the nearest surface drawn there is, and only
draws something nearer. It stores that distance with limited precision. Two surfaces closer together
than that precision draw as a toss-up that changes from pixel to pixel and frame to frame:
"z-fighting", which shows as stripes or patches that crawl as the camera moves. The fix is to keep
surfaces clearly apart. A few millimetres is plenty up close, but it needs more far away, because
precision falls off with distance. Where two surfaces have to lie flat on each other, as road
markings do, `polygonOffset` nudges one forward in the depth test only.

## 2026-11-15: Entry 84, the man in the dhoti, rebuilt

### What I did

The man in the dhoti walked like a plank in a robe. His dhoti ran from his shoulders to his feet,
swung as one stiff slab, and his feet poked out beside it.

**Why.** The walking shader swings each limb from the joint height stored with it (`_limb.y`). The
model script (`scripts/prepare_traffic_models.mjs`) took those heights from the skeleton. In his
source file, the skeleton is about 1.6 times the size of his mesh: his hips joint is at 1.02 units
on a mesh 1.2 units tall. So on the finished 1.72 m man, his hips came out at 1.47 m and his
shoulders at 2.16 m. Three things followed from that one number:

- the script stretches the dhoti up to "hip + 10 cm", so it reached his chest;
- his legs pivoted from chest height;
- the new walk (Entry 80) treats anything that pivots above 1.1 m as an arm, so his dhoti and feet
  swung like an arm.

**The fix, at the source.** `bakePerson` now records, for each joint, the heights of the corners it
moves most. `fitJointsToMesh` fits a straight line, by least squares, from each joint's height to
the middle of its corners, and the hip and shoulder heights go through that line. Where skeleton and
mesh agree, it changes almost nothing: the teen's hips moved from 0.85 to 0.82 m, and her shoulders
stayed at 1.31 m. For the man, the hips are now at 0.95 m and the shoulders at 1.40 m. I rebuilt
`public/models/traffic.glb` from the original downloads. Every vehicle came out byte for byte the
same; only the man's mesh (his dhoti, refitted to his real waist) and the people's joint labels
changed.

**The shader** (`Traffic.tsx`) also stops assuming everyone is built like the code-made people:

- each leg uses its own model's hip height (`_limb.y`), with the knee at the same share of it;
- how strongly a part follows its limb (`|_limb.x|`) scales its swing. That's 0.3 for the loose
  dhoti, 0.4 for the man's arms (`armSwing` in the script), and fractions where a limb meets the
  body. The old shader did this, and the new one had dropped it.

### What I checked

Type check, lint and build pass. I compared the rebuilt model file with the old one mesh by mesh
(vertex counts and data hashes): all 12 vehicle meshes are identical, the teen's mesh is identical,
and only the man's changed. On the dev server, with a temporary hook (removed), the man now has a
shirt above his waist and a dhoti from waist to ankle, and his feet step beneath its hem. Before
rebuilding, I tried a fix at load time (resetting joint heights from body proportions), but removed
it once the file was right. **Not checked:** the delivery customers who use these models, at the
door.

### Lesson 211: rest pose, bind pose and the mesh

A skinned model has a skeleton (joints in a tree) and a mesh whose corners each follow a few joints.
Each joint also has an "inverse bind matrix": it carries a corner from the mesh's own space into the
joint's space, as the joint stood when the mesh was attached (the bind pose). Exporters don't always
keep these in step with the joints' own positions (the rest pose). Then the joints can sit at a
different scale from the mesh, as here, and the model still draws correctly, because drawing only
uses the two together. Anything that reads joint positions on their own must be checked against
the mesh. Matching each joint to the corners it moves is a simple, robust way to do that.

## 2026-11-15: Entry 85, a man in a kurta instead of the dhoti

### What I did

Even with the right joint heights (Entry 84), the dhoti still looked wrong. The dhoti in that model
is a huge sheet: four times his width, reaching his shoulders, with no legs modelled under it. I
tried two fixes in the script: squashing that sheet, then wrapping a new dhoti of my own round him.
With nothing under it to give it shape, the new one read as a stiff lampshade.

The user then found three more models:

- **"Indian Male Character" by Kalakar** (CC BY 4.0): a man in a kurta and pyjama, with a full
  skeleton. He now replaces the dhoti man as the `man` model, so the game code didn't change.
- "semi cartoon - Indian Human 3D Character": no skeleton, so its arms and legs can't move, and its
  cartoon style wouldn't match. Not used.
- "Indian Man In Dhoti (1)": byte for byte the same file as before.

The model script (`scripts/prepare_traffic_models.mjs`) needed four things for him:

- **Rigify bone names.** His skeleton is Blender's Rigify, as MB-Lab characters use: `DEF-thigh_L`,
  not `LeftUpLeg`. `RIGS` lists each part's name for each kind of skeleton, and a person picks one
  with `rig`.
- **Muscle bones.** Much of his skin is moved by "muscle" bones (thigh muscles, biceps and so on)
  that hang off the pelvis and shoulders, not off the limb. So a limb is now its bones *and* any bone
  matching that rig's `legParts` or `armParts`. Without this, his thighs wouldn't have swung.
- **Corners with no weights.** 26 corners of his kurta are tied to no bone at all, which made
  impossible numbers. Weights are now scaled to add up to 1, and a corner with none follows its
  first bone.
- **Rigid parts.** His hair isn't skinned. It hangs off his head bone, and the script only read
  skinned meshes, so he came out bald. Meshes that hang off a bone now move with it. His hair has no
  colour in the file, so `colors` gives it one (near black).

The dhoti code is gone. Only his kurta takes each person's colour; its border and his white pyjama
keep theirs. `CREDITS.txt` now credits Kalakar in place of the dhoti model's author. To rebuild, the
models folder needs `indian_male_character` (unzipped from `indian_male_character.zip`).

### What I checked

Type check, lint and build pass. The rebuilt file has the same 12 vehicle meshes and the same teen,
byte for byte; only `man` changed. His joints came out at 0.86 m (hips) and 1.35 m (shoulders), with
about 400 corners on each leg and each arm. On the dev server, with a temporary hook (removed): a
kurta with its coloured border, white pyjama, dark hair, and legs stepping. **Not checked:** him as
a customer at the door, or up close at night. His face is coarse at 4,500 triangles, which suits a
crowd but not a close-up.

## 2026-11-15: Entry 86, sharper cars

### What I did

Up close, the traffic cars looked melted: lumpy, dented panels, with door lines, lights and the
grille smeared away. Two causes, both in the model script:

- **A coarse wrap.** Each car is hundreds of separate panels, with an interior. The script wraps a
  new outer skin round it on a grid of 3.5 cm cells (`shrinkWrap`), so the interior and overlaps
  vanish and the result can be simplified. 3.5 cm is too coarse for a door line or a headlight edge.
  The skin was then cut down to 12,000 to 14,000 triangles.
- **Borrowed normals.** Each corner of that skin snaps back onto the nearest original surface and
  takes its normal from there. Neighbouring corners can snap to different panels, so a smooth door
  was shaded as if it were dented.

The fixes:

- The four cars wrap on a 1.8 to 2.1 cm grid and keep 24,000 to 28,000 triangles.
- New `smoothNormals` works out every corner's normal again from the finished surface: the average
  of the faces round it, weighted by area. Faces turned more than 50° from the corner's old normal
  are left out, so real edges stay crisp. It runs on every wrapped model, so the player's scooter
  and the Yamaha are shaded this way too; their shapes are unchanged.

I tried leaving the wrap out altogether. The simplifier then can't get the cars below 30,000 to
157,000 triangles, as a car made of separate panels has nothing it can merge, so the wrap stays.

### What I checked

Type check, lint and build pass. `traffic.glb` went from 3.2 to 4.9 MB. Mesh by mesh: the four
cars changed, the scooter's and the Yamaha's normals changed (their positions didn't), and the
wheels, the auto and the people are the same. In the game, a sedan and an MPV seen close up have
smooth panels, door lines, handles, mirrors, lights, a grille and roof rails. With 34 vehicles about
on the dev server, frames held at 8.3 ms (120 fps), 99% under 9.3 ms, on the M5. **Not checked:**
a slower machine, or night. Some dark specks remain along panel edges, where the colour is taken
from the gap between two panels.

### Lesson 212: why simplifying needs a clean mesh

A simplifier merges neighbouring corners (an "edge collapse"), choosing the merges that move the
surface least. It only merges corners joined by edges. A car modelled as hundreds of separate
panels, with seats and a dashboard inside, has few such joins and many tiny loose pieces, so the
simplifier soon runs out of safe merges. Rebuilding the outside as one closed skin first (here, by
filling a grid of small cells and keeping the outer boundary) gives it a mesh it can reduce
smoothly. The grid size sets the smallest detail that survives, so it's a trade between detail and
size.

## 2026-11-15: Entry 87, speed breakers, potholes and puddles

### What I did

**Where they go** (new `src/world/roadFeatures.ts`, placed once from the road graph with a fixed
seed, so they're in the same places every visit):

- **Speed breakers**, 3,628 of them, on roads up to 10 m wide (HSR's side roads, not its main
  ones). From each junction, every road leaving it is walked to the next junction. A breaker goes
  5 m past the edge of the widest road at the junction, on 60% of these approaches, and on long
  stretches every 140 m. Each spans the road: a smooth hump 0.9 m deep and 7.5 cm high
  (`breakerHeight`), painted in worn yellow and black stripes.
- **Potholes**, 902: a chance on each 10 m of road, placed where wheels run, not near breakers or
  junctions. Each is a 4 cm bowl.
- **Puddles**, 1,765: over every pothole (a little wider), and extra ones along road edges.

**How you feel them.** `Surface.heightAt` adds the features to the road's height, so the tyres from
Entry 80 ride over breakers and dip into potholes. `followGround` now keeps some of a tyre's upward
speed as it rolls up a slope (`launchShare`, at most `maxLaunch`), so taken fast, a breaker gives a
small hop. Landing harder than 0.9 m/s is a jolt: a camera shake, a soft thud, and a little lost
speed. In the rain, a tyre entering a puddle throws a splash (`Splashes`: droplets from a fixed
pool, with a hiss), and the tyres lose up to 60% of their grip, which comes back over a moment.

**Traffic.** Each lane knows where its breakers are (`breakersOnLink`, by the road link the lane
follows). Vehicles slow to 2.2 m/s for one (3.5 for two-wheelers and autos), braking in time as
they do for corners, and rise over the hump as they cross.

**Drawing** (new `RoadDetails.tsx`): breakers as coloured geometry, and potholes and puddles as flat
pictures on the road, in map squares (`ChunkedMesh`). Potholes have a pale broken rim round a dark
gritty hollow. Puddles are a shiny, dark material reflecting the street, in four soft shapes. They
fade in as `water.level` rises: it follows the rain, filling over about 14 s and drying over 70 s.
The flat-picture builder moved out of StreetLife into `quads.ts`, so both can use it.

### What I checked

Type check, lint and build pass. On the dev server, with temporary hooks (removed):

| Speed into a breaker | Jolts | Strongest (0 to 1) | Speed after |
| --- | --- | --- | --- |
| 22 km/h | 2 | 0.21 | 15 km/h |
| 32 km/h | 2 | 0.28 | 27 km/h |
| 45 km/h | 2 | 0.36 | 39 km/h |
| 56 km/h | 1 | 0.37 | 52 km/h |

At 45 km/h the front tyre peaks 13 cm above the road (a 6 cm hop over the hump). My first version
threw the rear tyre 36 cm off a kerb at speed, so the hop is now capped. Over 15 seconds, traffic
crossed breakers at an average of 2.8 m/s and never faster than 3.5. Through a puddle at 36 km/h:
two splashes, one for each tyre, and grip fell from 12 to 4.8. Frame times with puddles full
matched the dry baseline: 95% of frames under 10.3 ms. **Not checked:** night, Low and Medium
quality, a slower machine, or how often riders meet breakers on a real delivery route. Potholes
are subtle to ride through at speed, as the tyre skims a small one.

## 2026-11-15: Entry 88, a gentler pick-up

### What I did

The scooter went from standing to top speed (56 km/h) in 3.2 seconds, like a sports bike. Its
engine pull started at 6.5 m/s² and only tailed off near the top, as it shrank with the square of
the speed.

Now it starts at 4 m/s² and falls off evenly to 1 m/s² at top speed (`engineForce` in
ScooterController.ts, numbers in `SCOOTER`). That gives 20 km/h in 1.6 s, 40 km/h in about 4 s and
54 km/h in about 6.7 s: like a 110 cc delivery scooter, a little quicker for fun. Garage engine
upgrades still add their 6% a level to both numbers.

Each stretch between turns now takes a little longer, and the speed breakers slow things too, so
the on-time limit for a delivery is now based on 6 m/s rather than 6.7 (`onTimeRouteSpeed`): about
10% more time. A delivery still always pays its base reward.

### What I checked

I simulated both curves first. In the game, with the throttle held from a standstill up 24th Main:
20 km/h at 1.6 s, 30 at 2.7 s and 40 at 4.3 s, as simulated. Type check, lint and build pass.
**Not checked:** how a full delivery feels against the new time limit.

## 2026-11-15: Entry 89, the pick-up halfway between

### What I did

Entry 88's pick-up felt too slow in play. The pull now starts at 5.25 m/s² and falls off evenly to
1.4 m/s² at top speed, halfway between the two earlier versions. The on-time limit's route speed is
6.3 m/s, also halfway (between 6.7 and 6).

| Speed | Entry 87 | Entry 88 | Now |
| --- | --- | --- | --- |
| 20 km/h | 0.9 s | 1.6 s | 1.2 s |
| 40 km/h | 2.0 s | 4.3 s | 3.0 s |
| 54 km/h | 3.2 s | 6.7 s | 5.0 s |

### What I checked

The same simulation that matched the game for Entry 88 (only the engine acts on speed while the
throttle is held). Type check and lint pass. Not ridden in the game this time.

### Lesson 213: tune by feel, in halves

When one value feels too much and another too little, try halfway between them before reaching for
a new number. Each try halves the gap. Writing the times down (0 to 40 km/h) turns "feels slow" into
something you can compare.

## 2026-11-15: Entry 90, every delivery is a small story

### What I did

Each order now says who it's for, what's in it, and what the customer wrote, and ends with the
customer's star rating, a tip and a line in their words. New file `src/missions/orderStory.ts`
holds all of it as plain data and pure functions.

- **Stories:** 16 made-up customers (Priya, Lakshmi aunty, Suresh uncle, …) and 16 items, each with
  its own note ("Phone is on 3%. Please hurry!"). The planner gives each customer a story, double
  drops included, and the stop is named after them ("Priya on 24th Main").
- **Care:** a few items need it.
  - **Fragile** (cake, eggs, pickle jars, a plant): hard landings count while it's on board
    (`knocks` in the store, counted by MissionTracker from the scooter's `bumpCount`). An amber
    "Bump!" notice shows for a moment.
  - **Cold** (ice cream, kulfi, paneer): minds the clock.
- **Rating:** starts at 5 stars and loses:
  - 1 for being late, or 2 if very late (over 1.5× the limit);
  - 1 per crash, up to 2;
  - for fragile items, 1 for 2–3 bumps or 2 for 4 or more (one bump is forgiven);
  - for cold items, 1 more when late.
  - It never goes below 1. The card lists why stars went, e.g. "3 bumps −1★".
- **Tip:** 30 for 5★, 15 for 4★, 5 for 3★. Each 5-star delivery in a row after the first adds 5,
  up to 25 more.
- **Rider rating:** the average of the last 20 is saved, with the 5-star streak. It shows on the
  results card and next to the credits on the phone.
- **Phone and results card:** the phone shows the item and a Fragile or Cold tag. Raised, it adds
  the note, how to carry the item, and "Customer's tip: up to +30 for 5★".

The base reward never changes. The rating only decides the tip, which is always extra, and nothing
is ever broken: a bumpy ride only makes the customer less happy.

`calculateReward` now takes a `RideRecord` object (crashes, knocks, streak, nightPay) instead of
loose arguments.

### What I checked

Type check, lint and build pass. In the game:

- The phone showed "A birthday cake for Rahul · FRAGILE" with the note and the care hint.
- I drove the store through deliveries from the console:
  - a fragile order with 3 bumps gave 4★ and a tip of 15;
  - three clean ones in a row gave tips of 30, 35 and 40;
  - one very late with a crash gave 2★ and no tip, with the base reward still paid.
- The results card showed the stars, the quote and the reasons.

Those test deliveries were saved to the real progress (credits, XP, career goals, today's goals,
ratings), so I put them back as they were. **Not checked:** knocks counted from a real ride over a
breaker (it reuses the same `bumpCount` the camera jolt uses, which was tested in Entry 87), phone
width, and how often players see each item.

### Lesson 214: game state as plain functions

The rating is a pure function: inputs in, stars out, no React, no three.js. That made it possible
to test every rule from the browser console in seconds, without riding a single delivery. Keep game
rules out of components, and the components only show what the rules decided.

## 2026-11-15: Entry 91, nitro, and "Package is safe" only with a package

### What I did

**Crash notice.** "Crash!" always shows, but "Package is safe" now only shows with an order on board
(`phase === 'toCustomer'`). On the way to the dark store there's no package to be safe.

**Nitro.** Hold Shift with the throttle for a burst. The numbers are in `SCOOTER` in vehicleConfig.ts:

- **Speed and pull:** it adds 7 m/s² of pull and lifts the speed limit by 5 m/s (18 km/h), to about
  74 km/h.
- **Tank:** a full tank burns in 3.5 s, and starting a burst needs 15% in the tank so it doesn't
  flicker on and off.
- **Filling:** it fills while riding, with the speed ratio squared, so near top speed it fills from
  empty in about 40 s and crawling barely fills it. Each drift boost adds 20%. A new game starts at
  60%.
- **Crashes:** a crash stops the burn.

In ScooterController.ts:

- **State:** `ScooterState` has `nitro` and `nitroOn`, and `DriveInput` has `nitro`, mapped to both
  Shift keys.
- **`updateNitro`:** burns and fills the tank each step.
- **`speedLimit` and `engineForce`:** they now add the drift boost and nitro together, in one place
  each, where the limit used to be written out twice.

**On screen:**

- The speedometer has a tank bar with a Shift key cap, dim until there's enough to start. It glows
  while burning, and a blue "Nitro" label shows.
- The camera widens by 6° more.
- The rider crouches as for a boost.
- The controls hint lists "Shift nitro".

### What I checked

Type check, lint and build pass. On 24th Main from a standstill, with a temporary hook (removed):

- **Throttle only:** 30 km/h at 2 s and 49 km/h at 4.5 s.
- **With nitro:** 35 km/h at 1 s, 60 km/h at 2 s and 74 km/h at 2.5 s. The tank went from 1 to 0.17
  in 3 s, as set.
- **Both runs:** each ended in a crash further up the street at speed, which shows the cost of
  going that fast.
- **On screen:** the gauge, label and wider view showed.

My saved progress copy was put back afterwards. **Not checked:** the engine sound above top speed,
and whether 74 km/h feels too fast for HSR's narrow streets.

### Lesson 215: one place for a rule

The speed limit was written out twice: once for the throttle and once for the slide recovery. Adding
nitro to one and forgetting the other would have let corners cap the speed at the old limit. Before
adding to a rule, find every copy of it, and make it one function.

## 2026-11-15: Entry 92, the phone comes up at each stop, and fashion orders

### What I did

**The phone at stops.** When a parcel starts changing hands (`collecting` at the dark store,
`handingOver` at the customer), the phone comes up by itself on the Order tab. It goes down once the
rider is more than 11 m (`zoneRadius` + 4) from where it came up. The Phone component subscribes to
the store (`useGameStore.subscribe`), which the telemetry updates ten times a second, and checks
`livePlayer`'s position. Raising or lowering it by hand (P or the button) leaves it to the rider.

While a parcel changes hands, the order sheet used to show only "Collecting the order". It now shows
the whole order with that as its heading: the customer, the item, their note, the route and the pay.
So at the dark store you read who the order is for, and after a drop you see the next order before
riding off.

**Fashion only.** The dark store now sells fashion: clothes, shoes and accessories.

- **Items:** the 16 items are all fashion, such as a silk saree, white sneakers, glass bangles, a
  formal blazer and jeans to try on. All are made up, with no brands.
- **Care types:** "Cold" became "Event" (pink tag): a saree for a wedding at 7, a blazer for an
  interview. It minds the clock in the same way, and lateness costs "Nearly missed the event −1★".
- **Fragile items:** perfume, glass bangles, sunglasses and a gift-wrapped watch.

### What I checked

Type check, lint and build pass. In the game, with a temporary hook (removed), using the real arrival
code (the scooter placed on the stop):

| Step | Phase | Phone |
| --- | --- | --- |
| Arrive at the dark store | collecting | up, showing "A sherwani for Nandini · EVENT" and her note |
| 20 m away | toCustomer | down |
| Arrive at Nandini | handingOver | up |
| Delivered (5★, "Just in time! I look sakkath") | delivered | up |
| Next order, then 20 m away | toPickup | down |

The saved progress was put back afterwards. **Not checked:** phone-width screens, where the raised
phone covers more of the view during a handover.

### Lesson 216: subscribe outside React for things that change often

`useGameStore.subscribe` calls a function on every store change without re-rendering anything.
It's the right tool when a component only needs to *react* to a change (here: raise or lower the
phone) rather than show the value. A selector (`useGameStore((s) => s.x)`) would re-render the
phone ten times a second just to check a distance.

## 2026-11-15: Entry 93, the phone is up only during the handover

### What I did

Entry 92's phone stayed up until the rider was 11 m away. Now it's up only while the handover
animation plays: it comes up when the phase becomes `collecting` or `handingOver`, and goes down the
moment the phase moves on (to `toCustomer`, or `delivered` when the results card shows). The distance
check and `livePlayer` are gone from Phone.tsx. A phone raised or lowered by hand is still left
alone.

### What I checked

Type check and lint pass. In the game, at a customer: the phase was `handingOver` with the phone up,
then `delivered` with the phone down and the results card showing. That was a real delivery, so I
put the saved progress back to how it was (155 credits, 60 XP, the first career goal, today's goals
at 0, no ratings).

## 2026-11-15: Entry 94, a nitro flame

### What I did

New `src/vehicle/NitroFlame.tsx`, mounted in the scooter's body group (so it pitches and leans with
the bike), at the exhaust: low on the right, behind the rear wheel (`EXHAUST`).

- **Three cones** pointing backwards: a white-hot core, a blue flame (0.95 m) and a faint orange
  edge. They are made with `ConeGeometry`, moved so the base sits at the pipe, and tipped over.
- **Two glow sprites:** a wide blue haze and a small white centre. Sprites always face the camera,
  which matters because the chase camera sits behind the bike, looking almost straight down the
  flame. Without them it read as a thin spike.
- **Materials:** all additive, unlit, not tone mapped and not writing depth, so the flame shines the
  same by day or night and only brightens what's behind it.
- **Motion:** it grows in quickly when the nitro lights and fades out more slowly, so it never pops.
  Its length flickers with two sine waves at speeds that don't line up, so the flicker never looks
  like a loop.
- **Cost:** hidden when not burning. There's no light, as adding or removing a light makes three.js
  recompile every lit material.

### What I checked

Type check, lint and build pass. On 24th Main with nitro burning: a bright blue jet with a white
centre at the exhaust, flickering, gone a moment after letting go. The first version was too thin
from behind, so it got wider and the two glows. The saved progress was put back afterwards.
**Not checked:** night (it should glow more there), and Low quality.

### Lesson 217: additive blending for light

`AdditiveBlending` adds the colour to what's behind instead of covering it. Black adds nothing, and
overlapping parts get brighter. That's how fire, sparks and glows look right without any lights.
Pair it with `depthWrite: false`, so the see-through parts don't hide each other.

## 2026-11-15: Entry 95, nitro speed carries on

### What I did

After a nitro burst, the speed fell back to top speed in about 1.7 s, so the burst felt like it
vanished. The pull back down (`overspeedDrag`, with the throttle held) is now 1.2 m/s² instead of 3:
from full nitro speed back to 56 km/h takes about 4 s. Drift boosts carry on longer too, as they use
the same drag.

Off the throttle, it used to slow at that same over-speed rate. Now it coasts down at the normal
`coasting` rate (1.6 m/s²) whatever the speed, so letting go after nitro doesn't suddenly slow you
less than letting go at normal speed would.

### What I checked

Type check, lint and build pass. In the game, on 24th Main riding south, with the throttle held
throughout and nitro for its last 2 s:

> 73 km/h as the tank ran out, then 72, 70, 68, 66, 63, 61, 56 every half second, then a steady 56.

Riding north, two runs crashed at about 60 m at nitro speed, so that direction isn't a good test
road at 70+ km/h. The saved progress was put back afterwards.

## 2026-11-15: Entry 96, new title covers, bright and without the purple cast

### What I did

**New covers.** The three title screenshots were from before the shops, signboards, traffic, the
delivery scooter, rain puddles and nitro, so they showed an empty town. They're replaced by three
new in-game shots in `public/title/` (the old ones are removed):

| File | Shot |
| --- | --- |
| `shop-street-morning.jpg` | The rider coming down 27th Main Road at 9 am, shops either side (Sneha Fashions on the right) |
| `nitro-night-rain.jpg` | Nitro burning in the rain at night, the shops lit, the rider on the right |
| `midday-handover.jpg` | A customer holding her parcel as the confetti goes up, gulmohar trees behind |

The bright morning shot comes first, and `index.html` preloads it. The loading screen's panel crops
and the phone notice use the new files. Every shot keeps its subject on the right, as the title
words cover the left.

**No more pink and purple.** The screen darkened every photo from the left with a maroon-purple
wash (92% at the edge), gave the name a maroon shadow and made the Kannada lavender. Now:

- **Shade:** neutral (no tint), and lighter: 72% at the edge, gone by 55% across, and only the
  bottom third from below.
- **Photos:** a touch more saturated and contrasty with a CSS filter.
- **Colours:** the name has a chilli-red sticker shadow, and the Kannada is marigold. The panels'
  maroon backgrounds are neutral too.

**How the shots were taken:** temporary hooks (all removed) let me place the camera anywhere, set
the hour and the weather, and drive the scooter from the console, with the HUD hidden by a style.
The handover was the hardest. The customer walks over first, so the confetti peaks about 2.3 s after
arriving, and the scooter had to be turned to face along the road, or the camera ended up behind a
wall.

### What I checked

Type check, lint and build pass. On the title screen, all three covers fade in turn. The morning shot
is bright with no colour cast, the night shot shows the flame on the right, and the handover is clear
of the words.

Taking the shots made real deliveries, which were saved. The first time I put the save back, the
game saved again as the page closed. So I restored it again on the title screen, reloaded, and
checked: "Welcome back. Level 1, 155 credits".

### Lesson 218: overlays tint everything under them

A dark gradient over a photo, to keep text readable, isn't neutral unless its colour is. A dark
maroon at 90% turns every photo maroon-purple. Use a near-black with no hue, keep it only where the
text sits, and let the rest of the picture show its own colours.

## 2026-11-15: Entry 97, HSR's well-known shops and petrol bunks, at their real spots

### What I did

You sent the positions of 33 well-known shops and food places and 8 petrol bunks. They're now in
the game at those spots. The brief says no real brands without approval, so every chain has a
made-up name and look. A chain's branches share theirs, as real chains do. For example: Stitch &
Strut (2 branches), Clearview Optics (4), Slice Station (3), Brew Republic (3), Stride Shoe Co. (3),
Crispy Coop, Big Bun Burgers and Swarna Mahal. The fuel brands are Surya Fuels, Kaveri Petroleum,
Hampi Petro and Coral Energy.

**Shop signs** (`landmarks.ts`, `LandmarkSigns.tsx`):

- **Data:** 22 chains, each drawn in code with a name, tagline, colours and one of three lettering
  styles, so none copies a real logo. The 33 branches are kept as positions.
- **Placement:** each sign goes on the wall its building faces the street with. It looks for walls
  from the mapped spot and 8 points round it, and takes the nearest wall with a road in front.
- **Look:** a big backlit sign box above the ground floor's awnings (3.3 m up, up to 8 m wide).
  It's slightly lit by day and glows at night.
- **Cost:** all 33 placed, as two meshes and one texture.

**Petrol bunks** (`fuelStationData.ts`, `FuelStations.tsx`):

- **The roof problem:** at five of the six inside the map, OpenStreetMap has the bunk's canopy as a
  building tagged `roof`, which the game was drawing as a solid block. Those roofs are now taken out
  of the buildings (`MapData.fuelRoofs`), and the bunk's canopy goes exactly where the roof was, at
  its size.
- **Facing the road:** each bunk faces the nearest road at least 6 m wide. The nearest road of any
  width was usually the bunk's own 4 m driveway.
- **What's built:** a white canopy on four pillars with the brand's band and name round it, two or
  three pump islands with two pumps each, and a tall price sign (Petrol, Diesel, Power) behind the
  pavement. There's a concrete forecourt, and lights under the canopy that brighten after dark.
- **Collisions:** the pillars, pumps and sign pole are solid.
- **Cost:** three meshes for all of them.
- **Outside the map:** the two Haralur Road bunks are 0.5 and 1.3 km east of where the map ends, so
  they're left out.

**Phone map:** every shop and bunk shows as a dot in its sign colour, with its name, after the
street names, where there's room.

### What I checked

Type check, lint and build pass. In the game, using temporary hooks (removed) to place the camera
and the time of day:

- Sprint Lab and Silicon Square sit above the shop awnings on 27th Main Road.
- Big Bun Burgers glows at night on 14th Main.
- Surya Fuels at Agara and Kaveri Petroleum on 27th Main stand on their mapped roofs. At night the
  canopy is lit and the price sign reads clearly.
- "Roll & Sub" shows on the phone map with a green dot.

The first canopy band didn't show. The canopy's depth offset (`polygonOffset`) pulled the box in
front of the band, which sat only 1 cm proud, so the band now stands 4 cm out. The saved progress
was put back afterwards.

**Not checked:** all 33 signs one by one (a sign on the wrong wall is possible where buildings are
packed tightly), and grass tufts that grow on a bunk's forecourt.

### Lesson 219: the map's data has its own meaning

OpenStreetMap tags a petrol bunk's canopy as `building=roof`: a roof on posts, not a building. The
game treated every building as a solid block, so canopies turned into boxes. When something looks
wrong where a real place is, check how the map tagged it, and draw what the tag means.

## 2026-11-16: Entry 98, petrol bunks fill the nitro

### What I did

Pull in under a bunk's canopy and slow below about 9 km/h, and the nitro tank fills, from empty to
full in 2.5 seconds. Riding through fast doesn't count, so a refill costs a stop.

- **`bunkAt(stations, x, z)`** in `fuelStationData.ts`: the bunk whose canopy is over a spot, with
  1.5 m of reach past its edge. It turns the spot into the canopy's own "along the road" and "back
  from it" directions, so a turned canopy is checked as the rectangle it is.
- **`BunkRefill`** (`src/vehicle/BunkRefill.tsx`): each frame, while riding, not crashed, not
  burning nitro and slow, it tops up the tank under a canopy. It tells the store which bunk (by its
  made-up name) only when that changes, so the HUD doesn't re-render every frame.
- **HUD:** "Filling nitro · Kaveri Petroleum" above the speed, then "Nitro full".
- `World` passes the placed bunks to `Player`.

### What I checked

Type check, lint and build pass. In the game, with a temporary hook (removed): stopped at Kaveri
Petroleum on 27th Main with an empty tank, it was 40% full after 1 s and full by 3 s, and the HUD
showed both messages. Riding through the forecourt at 32 km/h added only the normal riding top-up
(0.30 to 0.31) and showed no message, and the message went away after leaving. The saved progress
was put back afterwards.

### Lesson 220: point in a turned rectangle

To ask "is this point inside a rectangle that's turned at some angle?", don't turn the rectangle.
Take the point relative to the rectangle's middle and project it onto the rectangle's two unit
directions with dot products (`dx * alongX + dz * alongZ`). Those two numbers are the point's
position in the rectangle's own frame, and the test becomes `|along| <= length / 2` and
`|out| <= depth / 2`.

## 2026-11-16: Entry 99, nothing planted on a bunk's forecourt

### What I did

A street lamp stood in the middle of the Kaveri Petroleum forecourt on 27th Main, beside the pumps.
The bunk only made its pillars, pumps and price sign solid, so the roadside placer saw open ground
there and planted a lamp, a tree and two parked scooters.

- **`isOnForecourt(stations, x, z)`** in `fuelStationData.ts`: from the road's edge to 1 m behind the
  canopy, and 3 m past each end, where the price sign stands.
- **`generateRoadsideProps`** takes a `keepClear(x, z)` check. Trees, lamps and parked scooters
  skip any spot it says yes to. `World` passes the forecourt check.

The forecourt stays rideable: it's kept clear without being made solid.

### What I checked

Type check, lint and build pass. With a temporary hook (removed), I listed everything placed in the
world near each bunk. Before: a lamp, a tree and two parked scooters at Kaveri on 27th Main, and a
tree at two other bunks. After: none of the 10,372 trees, 3,986 lamps or 3,868 parked scooters are
on a forecourt.

### Lesson 221: solid and kept clear are different things

The collision world answers one question: can you ride here? The placers ask another: is this
spot free to put something on? A forecourt, a driveway or a bus stop must be free of trees but
still rideable, so it needs its own check passed to the placers, not a wall in the collision world.

## 2026-11-16: Entry 100, dark stores across all of HSR

### What I did

Every order started at the one dark store, and customers were at most 1.5 km away by road. The store
is at the map's east edge, so only 21% of the streets ever got an order. The west four-fifths of the
map, which came in with the bigger map file, never did.

- **`findDarkStores`** (`darkStore.ts`): finds the home store as before (same spot, so nothing
  changes for a save), then adds stores until no more than 4% of the streets are out of reach, up
  to 8. Each new one goes where the most out-of-reach streets are: they're counted in 100 m squares,
  and the square with the most within 800 m wins. The nearest suitable shop building within 450 m
  of it becomes the store. If none suits, that area is given up and the next is tried.
- **Names:** the home store keeps its plain name. The others add their road, such as "Deliver It
  dark store, Begur Road". Plain "Service Road", unnamed roads and flyovers are skipped for the
  nearest better name within 250 m.
- **Orders** start at the store nearest the rider (`nearestStore` in `missionPlanner.ts`), with
  customers from that store by the same trip lengths. Since the next order is planned where the last
  one ended, a long haul out west brings orders from the stores there.
- **Each store** has its front, bikes and a staff member. The order's own store does the handover.
  The shirt print follows whichever staff member is nearest the camera.
- **One light:** each store front had a point light. Now one light moves to the store nearest the
  rider. Every light in a scene adds work to every lit surface, and a far store's light can't be
  seen anyway.
- **Garage** opens at any dark store. **Phone map:** every store shows as an orange "Dark store" dot,
  drawn before shops so it wins the space.
- `planHouseKit` skips a list of store buildings instead of one.

### What I checked

Type check, lint and build pass.

- **Coverage:** placement run in Node against the real map file, through Vite's `ssrLoadModule`.
  6 stores, 93.7% of the streets within 1.5 km by road of one (was 21%), placed in 173 ms. The home
  store is at (171, −136), as before.
- **In the game:** each store is within 11 m of its pickup point. Orders planned from the west, the
  south-west, the north and the south each came from the nearest store, with customers around it.
  At the Begur Road store the front, bikes and staff showed, and the staff member walked the parcel
  out. Credits stayed at 155, and the saved progress was put back afterwards.

**Not checked:** the moving night light at a store after dark, and Low quality.

### Lesson 222: greedy covering

To place a few things so they reach as much as possible, place them one at a time. Each goes where
the most is still unreached, then you recount. It isn't the best possible answer, but it's close,
simple and fast. The trick that keeps it fast is counting into a coarse grid once per round, so
scoring a spot means adding up nearby squares, not visiting every street.

## 2026-11-16: Entry 101, the lighting pass

### What I did

Following ART_DIRECTION.md: one tone mapping and one colour grade over everything, a low warm sun,
a warm golden haze, and ambient occlusion and bloom where the quality allows.

- **Post effects** (`PostEffects.tsx`, new packages `@react-three/postprocessing` and
  `postprocessing`, with N8AO): ambient occlusion, then bloom, then AgX tone mapping, then the grade
  as a 32×32×32 LUT, then antialiasing. Every quality gets the tone mapping and grade, so the game
  looks the same on each. The canvas's own antialiasing is off, as everything is drawn through the
  effects.
- **Colour grade** (`colorGrade.ts`): warmer white balance, saturation at 88%, a gentle S-curve and
  a faded warm black. One function, `gradeColor`, baked into the LUT.
- **Sun** (`skyLogic.ts`): the light comes from lower (peaking at about 51° instead of 62°) and
  warmer. The sky's colours still follow the real sun, so mornings stay blue rather than dusky.
- **Ambient fill:** the hemisphere light's ground colour is now a warm red-earth bounce that
  follows the time of day. The sky colour is a little cooler, so shadows read slightly blue.
- **Haze** (`haze.ts`): replaces three's fog shader. It builds slowly over the view, then closes
  in over the last 40%, so it's still solid where drawing stops. It starts 15 m out when the sun is
  low and 90 m out at noon. In rain its start moves behind the camera, so even nearby air is
  thick. The day horizon is a pale warm white.
- **Shadows** cover a smaller box that follows the rider, so they're sharper: Low 50 m at 1024 px
  (Low had none before), Medium 90 m at 2048, High 140 m at 4096. Edges are softened, and a
  normal bias stops striping.

### What I checked

Type check, lint and build pass. In Chrome, on an Apple M5 with a 120 Hz screen, at a fixed spot,
with the resolution held steady and the sky pinned (temporary hooks, removed), each preset ran for
5 seconds by day (10:00) and at night (21:00):

| Preset | FPS before | FPS after | CPU ms before → after |
| --- | --- | --- | --- |
| Low, day / night | 120 / 120 | 120 / 119 | 3.2 → 3.6 / 3.6 → 4.1 |
| Medium, day / night | 120 / 120 | 118 / 110 | 3.9 → 6.1 / 4.2 → 7.1 |
| High, day / night | 118 / 114 | 87 / 79 | 6.6 → 7.4 / 7.3 → 9.7 |

Two fixes came out of measuring. Multisampling cost about 12 ms a frame on High, as ambient
occlusion then works on four times the samples, so antialiasing is now an effect at the end (FXAA on
Low, SMAA above). N8AO found transparent materials and drew the whole scene twice more every frame,
about 5 ms of CPU, so that's off. Full-size AO cost about 20 ms on High, so it's always half size.

Screenshots at 9:00, 17:20, 21:00 and in rain, on Medium and Low, and the title screen. The saved
progress was put back afterwards.

**Not checked:** a mid-range laptop. Medium and High on a 120 Hz screen will see the resolution
scaler step down, as before.

### Lesson 223: measure each part, not just the total

Turning everything on showed High at 42 FPS. Turning each part off one at a time showed where that
went, and two of the costs weren't the effects themselves: multisampling made ambient occlusion
four times the work, and the AO library quietly drew the scene again for transparent objects. When a
total is bad, take it apart before cutting features.

### Lesson 224: a GPU timer can mislead on tiled GPUs

WebGL's timer query said High took 26 ms on the GPU while the game ran at 87 FPS, which needs under
12 ms. Apple's GPUs overlap frames, and the timer counts that overlap. Frame rate (and the time
until the GPU is truly done) is the number to trust. The timer is only good for comparing settings.

## 2026-11-16: Entry 102, black frames when braking at night

### What I did

The whole screen flashed black for a few frames at a time, mostly when braking or reversing. It
came from the lighting pass's effects meeting an old problem.

- **The cause:** the headlight is a spotlight 0.95 m up at the scooter's nose, and a light that
  fades with distance gets without limit brighter the closer a surface is. When braking dips the
  nose, part of the scooter comes right up against the lamp. That pixel overflows the effects'
  picture (half floats top out at 65,504) to infinity. Bloom's blur then mixes it into every
  pixel as NaN, which shows as black. Before the effects, one bad pixel was all it ever was.
- **The fix** (`brightnessCap.ts`): like the haze, it changes the shader code every built-in
  material shares. Each pixel's light is capped at 64 (tone mapping already shows anything above
  about 16 as white), and NaN or infinity becomes black, before any effect sees it. App imports it
  first.

### What I checked

Type check, lint and build pass. To see what was really on screen, I captured the canvas as a video
stream (`canvas.captureStream()` read through `MediaStreamTrackProcessor`) and measured each
delivered frame. The same ride each time, at the same spot, at 22:30 in cloud, on High (temporary
hooks, removed):

| | Before | After |
| --- | --- | --- |
| No AO | 73 of 761 frames black | 0 of 721 |
| Everything on | 70 of 726 | 0 of 530 to 558 |
| Daytime | 0 of 652 | — |

A night screenshot while braking looks as it should. The saved progress was put back afterwards.

### Lesson 225: one bad pixel, and a blur, make a black screen

Blurs, bloom and ambient occlusion all mix many pixels into each one. Anything mixed with NaN is
NaN, so a single broken pixel can become a whole broken frame. With post effects, cap brightness
and clear NaN where colours are made, not after.

### Lesson 226: test what's on screen, not what you can read

My first checks read pixels back from the canvas. They reported black frames that weren't there,
when the game happened to draw after the read, and missed real ones. A video stream of the canvas
gives exactly the frames that were shown. When a bug is "I saw it flicker", measure the frames
that were seen.

## 2026-11-16: Entry 103, black flashes by day too

### What I did

After Entry 102 you still saw occasional black flashes, at 11:15 in cloud, so not the headlight.
I couldn't make one happen there in 45 seconds of riding and braking, nor by changing the
resolution six times. So rather than chase every possible source, the picture is now made safe
before anything blurs it.

- **Clean-picture pass** (`cleanPicture.ts`): one full-screen pass straight after ambient occlusion
  and before bloom. Any pixel that is NaN or infinite becomes black, and brightness is capped at
  64. It catches what the material cap can't: the four custom shaders (sky, rain, car reflections,
  light cones) and the AO pass itself.
- **A sturdier test** (`safeColorGlsl` in `brightnessCap.ts`): it checks a number's bits (all
  exponent bits set means NaN or infinity) instead of `isnan()`. Apple's GPUs compile with "fast
  math", which may drop an `isnan()` check as impossible. The material cap uses it too.

### What I checked

Type check, lint and build pass. I put a small test object in front of the camera, at 11:15 in
cloud on High, whose shader outputs infinity, and recorded the frames shown (temporary hooks,
removed):

| | Clean pass on | Clean pass off |
| --- | --- | --- |
| Infinite pixel | 0 of 59 frames black | 44 of 44 black |
| No test object | 0 of 60 | — |

So one infinite pixel did black out every frame, and the pass stops it. The game looks the same.
The saved progress was put back afterwards.

**Not found:** what made your daytime flash. The pass stops it whatever it was. If a flash still
shows, it isn't a broken pixel, and the next suspect is a hitch in drawing.

### Lesson 227: guard the place every path goes through

When something can break in many places (any shader, any pass), fixing each one you find leaves
the ones you haven't. Put one guard where all of them have to pass, here the moment before the
blurring effects, and test it with a deliberate fault.

## 2026-11-17: Entry 104, the flash when the resolution changes

### What I did

You still saw black flashes, at 10:45 as the sun gave way to rain. Over 2,070 frames of that
weather, recorded from the canvas, none were black, with no errors and no lost context. So the
flash was never in a drawn frame. It was the moments between them.

- **The cause:** the resolution scaler changes the canvas's size, and resizing a canvas wipes it.
  The change went through a React prop, so it happened during React's update, between frames. If
  the browser showed the page before the next frame was drawn, you saw the wiped canvas, and the
  page behind it is black (`color-scheme: dark`). The lighting pass made this more likely: High
  now runs below a 120 Hz screen's rate, so the scaler steps more often. In one minute's riding it
  stepped twice, from 1.25 to 0.75.
- **The fix** (`AdaptiveResolution.tsx`): a new resolution is kept until the start of the next
  frame and applied there, with R3F's `setDpr`, before that frame is drawn. The wiped canvas is
  drawn over straight away. The store, and the Canvas prop it feeds, are updated at the same time,
  so React then finds nothing to change. A quality change goes the same way.

### What I checked

Type check, lint and build pass. I watched every write to the canvas's size and where it came
from (temporary hooks, removed), during a quality change and a step by the scaler: all 6 came from
the frame loop, through `AdaptiveResolution`, and none from React. I can't see the browser's own
compositing, so the flash itself can't be recorded. This removes the gap it needs. The saved
progress was put back afterwards.

I also checked whether the effects keep their old size when only the resolution changes. They
don't: the composer compares the pixel ratio every frame and resizes itself.

### Lesson 228: change the canvas only where you draw

Anything that resizes a WebGL canvas (its width, the pixel ratio) wipes the picture. Do it in the
same frame as the next draw, inside the render loop. Done from a React update or an event, the
browser may show the wiped canvas first, which looks like a flash.

## 2026-11-17: Entry 105, the new ground, tried on 27th Main Road

### What I did

The ground, to ART_DIRECTION.md, on one road first: `NEW_GROUND_ROADS` in `streetEdgeConfig.ts`
lists only 27th Main Road. The old ground (`Roads`, `Kerbs`) skips the roads on that list, and
`StreetEdges` draws them. Rolling out is one change: make `usesNewGround` return true.

- **Kerbs** (`streetEdgeGeometry.ts`): 15 cm above the road, 20 cm wide, with a 4 cm bevel on the
  road side, built along each road edge from the OSM lines. Painted in 1 m black and yellow blocks,
  each a little worn. End faces only where a run starts or stops. In front of a compound gate (gate
  positions now kept by `planHouseKit`) the kerb drops to 4 cm.
- **Rounded corners:** at each junction, the corner between two neighbouring roads (45° to 150°
  apart) gets an arc of 3 m radius, or 1.5 m between short pieces. The asphalt fills the web inside
  the arc, the kerb follows it, and the footpath fills the corner out to where the two footpaths'
  far edges meet. Straight kerbs and footpaths stop at the corner, found to within millimetres by
  bisection. The old kerbs of a side street stop there too.
- **Footpaths:** level with the kerb top, from the kerb's back out to 3 m, or less where another
  road is nearer (the median of a dual carriageway). Not raised across a petrol bunk's forecourt.
  An edge stone stands along the far side, and a face drops to the ground wherever a footpath
  ends against something lower.
- **Pavers** (`groundTextures.ts`): interlocking I-shaped blocks drawn in code, 4 across and 8 rows
  in each 0.96 m repeat, every block a slightly different grey, with a normal map from the same
  drawing. UVs are in world metres, so the pattern runs on across pieces. The shader adds broad
  variation, grime, and soil dust drifted onto the far side.
- **Soil:** the palette's base, dry and damp, mixed by broad noise (about 80 m and 15 m across),
  with the photo's grain at 40%, so it's earth, not gravel. Only in a box round 27th Main for now,
  fading out over 30 m.
- **Dust and damp:** a 0.9 m strip of dust on the soil beside the edge stones. Each tree on the
  footpath gets a square pit with an edge-stone frame and damp soil. Trees on the verge get a soft
  patch of damp soil.
- **Asphalt** (`groundShaders.ts`): the palette's #4E4F57, with the photo for fine grain only, broad
  variation, darker smoother tyre tracks in each lane, a darker gutter strip by the kerb, and dust
  at the edges. The gutter and dust show only where a kerb runs beside them, so a side street's
  opening stays clean. It darkens and shines in the rain.
- **Decals:** one 1024 px picture holds a tar patch, a crack, a manhole and a newer patch, laid
  along the road by a seeded random walk: 153 on 27th Main, 13 of them manholes.
- **Standing on the raised footpath:** `groundLift.at(x, z)` gives the footpath's height there
  and 0 elsewhere. Roadside props, carts, people (pedestrians and the handover), shop fronts,
  kolams and the dark store's bikes and bay use it. The physics surface takes the new ground's
  heights too, with "road" in the rounded corners.

Everything is merged per 160 m map square: one geometry per kind per square.

### What I checked

Type check, lint and build pass. In the game, with temporary hooks (removed): kerbs, corners, pavers,
a tree pit, the edge stone and dust, a manhole and a tar patch, by day on High and on Low. Across
the road's east side the surface runs: road, 0.20 m from the kerb out (kerb top and footpath level),
0.212 m on the edge stone, then soil. Corners' webs are road.

Two fixes on the way. The first asphalt didn't show, as its triangles faced down. And the gutter
and dust appeared in the middle of junctions, until they were limited to where a kerb runs.

Frame rate on an Apple M5 at the same spot on 27th Main, with the resolution held steady:

| Preset | Old ground | New ground |
| --- | --- | --- |
| Low | 120 FPS | 118 FPS |
| Medium | 120 FPS | 120 FPS |
| High | 93 FPS | 89 FPS |

27th Main came to about 138,000 vertices, after cutting the first build's 440,000 (one footpath
piece per stretch of even width, and kerb end faces only at run ends). Kerbs are 103,000 of them.

**Before rolling out:** kerbs for the whole map at this rate would be about 15 million vertices,
too many to keep on the GPU. They should become long runs with the stripes painted by the shader.
Where a road with the new ground meets one without, the corner steps down to the old, lower
footpath.

### Lesson 229: test a look on one street, behind one switch

A change to the whole ground touches every road, every junction and everything standing on the
pavement. Behind a single list of roads, it could be tried, measured against the old one on the
same street, and compared, without the rest of the map changing at all.

## 2026-11-17: Entry 106, weathered buildings in more colours

### What I did

ART_DIRECTION.md asks for colourful plaster and weathering, with nothing brand new, and without
heavy textures. Everything here is shader maths, vertex data, or see-through quads in one colour.

- **Colours** (`buildingData.ts`): houses now draw from 16 colours. Off-white, cream and beige
  are a quarter of them; the rest are pink, dusty rose, mint, sea green, pistachio, yellow,
  turmeric, terracotta, brick orange, peach, sky blue and lilac. Flats gain sand, pale pink, mint,
  blue and yellow. The house kit's balconies and compound walls follow, as before.
- **Wall weathering** (`weathering.ts`, `addWeathering`), on the building walls and the house kit:
  - a ragged band of grime at the foot of every wall (up to about 0.75 m), splashed red-brown
    by the soil, and darker where the wall meets the ground: baked ambient occlusion;
  - paint faded in broad patches, paler and greyer, and darker damp stains;
  - on house, flat and shop-upstairs walls, thin streaks run down from about half the window
    sills, matching each look's window width;
  - how weathered a building is comes from a per-building `aWeather` (0 to 1), so some look
    freshly painted and some haven't been for years. The kit uses a fixed 0.5.
- **Stains** (`StainBuilder` in `houseKit.ts`): see-through dark quads, faded by vertex alpha,
  just off the wall. They darken whatever paint is under them, so one colour does for every
  house. Under every balcony slab (0.8 m) and sunshade (0.35 m), as baked ambient occlusion.
- **AC units:** about 18% of house windows above the ground floor have an outdoor unit under the
  sill: a pale box with a dark grille. Water stains run down from each, a thin dark streak and
  a wider faint one.
- The stains are drawn as a third mesh per house-kit square, up to 220 m away, on every quality.

### What I checked

Type check, lint and build pass. In the game, by day on High: the new colours along 25th and 24th
Main. On a pink house, streaks under the sills, the grime band, faded patches and shade under the
balcony. On flats, mottled paint. AC units with their streaks. Temporary hooks were removed, and
the saved progress put back.

Frame rate on an Apple M5, the resolution held, at the spawn, looking at a block of flats:

| Preset | Weathering off | Weathering on |
| --- | --- | --- |
| Low | 119 FPS | 120 FPS |
| Medium | 86 FPS | 85 FPS |
| High | 59 FPS | 56 FPS |

**Not checked:** night (window glow over the streaks), rain, and Low up close.

### Lesson 230: darken, don't paint

A stain that's a colour has to match the wall it's on, and with 16 paints and patchy fading it
never would. A stain that's a see-through dark, faded at its edges, darkens whatever it's laid
on, so one quad works on every wall. The same goes for baked shade: draw the shadow, not the
shaded paint.

## 2026-11-17: Entry 107, corners in the road, on 27th Main

### What I did

Your screenshot showed a rounded kerb corner and a slab of footpath in the middle of 27th Main, with
an orange line and a brown patch. 19 of the 73 corners had their footpath on a road. Where the
dual carriageway splits, or a road runs close, the "corner" between two arms is the other
carriageway or the Outer Ring Road.

- **Corners must be clear:** a corner is kept only if its footpath fill (its centre, the far
  corners, and points along the kerb's back) is clear of every road. 54 corners remain, none on
  a road.
- **No kerb stubs:** a kerb needs 0.6 m of room behind it before the next road, and runs shorter
  than 1.2 m are dropped. That removed the short kerbs floating in the carriageway where it splits.
- **Paving underneath:** wedges of red soil showed between the footpath, which narrows near a
  side road, and the corner fill. Like the old ground, a low paved strip now runs under each road
  and its footpaths, at the old 3 cm, so any gap shows paving. Corners no longer shade dust from
  their far point, which had spread orange across them.

### What I checked

Type check, lint and build pass. The same view as your screenshot's junction, before and after,
with temporary hooks (removed). The saved progress was put back.

**Still to fix:** a small gap where a corner's kerb meets the straight kerb.

### Lesson 231: check a shape against the world, not just its own maths

The corner maths was right for two roads meeting. It never asked what else was there. A cheap test
(sample a few points of the result, and ask whether they're on a road) catches every case the
maths didn't think of.

## 2026-11-17: Entry 108, waving customers and KA plates (people and vehicles, part 1)

### What I did
- **People** (`Traffic.tsx` walking shader): a shared clock and a per-person `aWave`. Customers raise one arm and wave as the rider comes within 35 m and while the parcel reaches them, easing in and out (`Handoff.tsx`). People standing still breathe and shift their weight, each in their own time. Clothing colours are now everyday Indian wear.
- **Number plates** (`numberPlates.ts`): one 1024×512 picture of 32 made-up Karnataka plates (KA 01/03/05/51/53...), black on white, and black on yellow for autos. Each kind's plates are placed on the model's own bumper, found by scanning its shape at plate height. Drawn instanced, within 70 m, one draw call per kind.

### What I checked
Type check, lint and build pass. In the game: plates on an SUV (front and back), autos (yellow, front and back) and a bike (rear). The wave was not seen in the game. The saved progress was put back.

### Still to do
The wave seen in the game, scooter and commuter-motorcycle shapes, distance level of detail for vehicles, and the prop kit gaps from Entry 107's list.

## 2026-11-17: Entry 109, two-wheelers, far-away vehicles and the prop kit's gaps

### What I did
- **Waving checked:** in the game, a customer raises an arm and waves as the rider arrives (Entry 108).
- **Two-wheelers** (`twoWheelers.ts`): an unbadged step-through scooter (small wheels, floorboard,
  leg shield) and a commuter motorcycle (tank, long seat, engine, exhaust), with real proportions
  and simplified parts, each under 400 triangles. Bikes in traffic are now a third each of the
  model, the scooter and the motorcycle, picked once per bike. All carry the seated rider and a
  rear KA plate. Only the model has separate spinning wheels.
- **Far-away vehicles** (`vehicleProxies.ts`): beyond `vehicleDetailDistance` (70 m on High, 50 m
  Medium, 35 m Low), each vehicle is a stand-in of a few boxes, sized from its own model: a body in
  its colour, a dark cabin and four wheels, 48–72 triangles against about 28,000 for a car model.
  Wheels and plates stop at the same distance. Autos' stand-ins are green with a yellow canopy.
- **Shop names:** 11 second names for the commonest shops (Sri Lakshmi Stores, Royal Gents Parlour,
  Kaveri Tea Point...), all made up, picked per shop. The board picture grows to 2048 × 3936, inside
  the 4,096 limit many GPUs have, which is why there aren't more.
- **Posters** (`posters.ts`): one generated picture of 8 posters (tuition, yoga, to-let, a made-up
  film, a Rajyotsava greeting, packers and movers, water tank cleaning, music classes), with no
  parties, real people or brands, and numbers in the unassigned 90000 range. About a third of
  compound walls carry one beside the gate, slightly tilted, on the street side.
- **Potted plants** on the compound wall top either side of about 45% of gates.
- **Density by quality:** AC units, pots, posters and wall stains now live in the house kit's
  detail layers. Low shows none, Medium most, and High adds more in a new `fine` layer. AC water
  streaks go only with units that Medium shows, so none hangs under nothing.

### What I checked
Type check, lint and build pass. In the game: the wave, the scooter side-on, a motorcycle with its
plate, stand-ins down a long road, "Royal Gents Parlour", a pot on a wall top and a "Water Tank
Cleaning" poster (206 posters built near the spawn). The saved progress was put back.

**Not checked:** frame rate after these changes, and the scooter and motorcycle at night (no
headlight glow of their own; they share the bike's).

### Still to do
The small gap where a rounded corner's kerb meets the straight kerb on 27th Main.

### Lesson 232: a texture has a ceiling
Adding names meant a taller atlas, and WebGL only promises textures up to 4,096 pixels on many
devices. Check the size against that limit before growing an atlas, and choose what's worth the room.

## 2026-11-17: Entry 110, parked bikes on the footpath, zebra crossings, railings and park walls

### What I did
- **Bikes sinking into the footpath:** a parked scooter's height came from its middle only. Parked
  nose-in or tail-in to a shop on 27th Main, one wheel could be up on the raised footpath and the
  other below it. `settleParkedScooters` (`groundLift.ts`) now checks both wheels. A scooter whose
  wheels are on different levels slides along its length, up to 1.5 m, to a level spot. If none is
  free, it isn't placed. To do this, the street edges are now built before traffic.
- **Zebra crossings** at every signal junction (597 approaches): white stripes 0.5 m wide and 3 m
  deep across the road, just in front of the stop line. The stop line moved back from 2 m to 5 m
  past the crossing road to make room, so traffic now waits behind the zebra.
- **Junction railings** (`fencing.ts`, `Fences.tsx`): 16 m of steel railing along both kerbs on
  the way into each signal, starting just back from the stop line. They're 1 m high with three
  rails, and panels alternate yellow and black like the kerbs. A panel is left out where it would
  block a gate, a petrol bunk, a building or a side road, or where the road bends away. 12.7 km in
  all.
- **Park walls:** a 0.45 m plaster plinth with green iron railings on it, around every park
  (5.7 km). There's a gap wherever a path comes in, a 3.5 m gate halfway along sides over 40 m, and
  nothing on the pavement. The bars are one flat strip per panel with an alpha map cutting the
  gaps, two triangles a side instead of a dozen thin boxes.
- Railings and park walls are solid, merged per map square, and drawn out to the props distance
  for the chosen quality.

### What I checked
Type check, lint and build pass. In the game: zebra crossings at the Outer Ring Road and at a small
junction, railings on the 27th Main footpath, and a park wall in the rain. All 3,903 parked scooters
now have both wheels on one level (98 of them stand on the raised footpath). About 107 FPS on High at
a park, as a rough check. The saved progress was put back.

### Lesson 233: an alpha map reads green
The park railing first drew as a solid green sheet. The bar pattern was in the texture's alpha
channel, but three.js reads `alphaMap` from the **green** channel (so a greyscale JPEG works). Put
the pattern in RGB.

## 2026-11-17: Entry 111, park fences on every side, and walls and barriers from OSM

### What I did
- **Park fences were missing on most sides.** Two reasons:
  - Any panel within a pavement's width of a road was dropped, and most parks' mapped edges run
    right up to the road.
  - Any panel near a footpath was dropped too, and HSR's parks have walking tracks running just
    inside the edge.

  Now a fence point too close to a road moves inwards (up to 6 m) until it's behind the pavement.
  Openings are left only where a path actually crosses the fence line, or ends at it. Park
  fencing went from 5.7 km to about 17 km.
- **Fence styles**, from a web search on what Bengaluru uses. BBMP's park and vacant-land tenders
  specify chain-link, MNK Park has steel railings, and the plinth-and-iron-railing park wall is
  common. Each park gets one style, seeded: green railing on a plinth (half), chain-link on
  concrete posts with barbed wire (30%), or tubular steel railing (20%).
- **Walls and barriers from OSM** (`public/data/hsr-barriers.geojson`, 159 ways, made with
  Overpass and loaded beside the map). In the play area:
  - 2.9 km of boundary walls: plastered, with a coping and pillars every 3 m, in one of five
    colours.
  - 4.7 km of fences: chain-link, or steel railing where tagged metal.
  - 340 m of stone retaining wall.
  - 65 m of yellow-and-black concrete road divider.
  - All of OSM's crash barriers (4.1 km) lie outside the play area; there's a drawing for them if
    it grows.
  - Barriers on flyovers (`layer=1`) are left out, as the game's roads are flat.
  - Walls keep off roads and out of anything already there, such as the house kit's compound
    walls.
  - Everything is clipped to the play area, which at first it wasn't.
- The chain-link mesh is a second cut-out strip with a diamond pattern, drawn to 60% of the props
  distance. From further away it thins out, as real chain-link does.

### What I checked
Type check, lint and build pass. In the game: a park's green railing set back behind the pavement
along its whole road side, a 663 m chain-link fence, a tech park's boundary wall, steel railing on
the Outer Ring Road service road and the divider on 17th Cross. The saved progress was put back.

### Lesson 234: map data has edges too
The OSM query box was the map's box, and the play area is smaller. The first barriers I looked at
stood in empty soil past the map's edge wall. Data from a second source needs the same clipping
as the first.

## 2026-11-17: Entry 112, missing buildings, and temples (Agara's Jagannath temple in the Kalinga style)

### What I did
- **Why buildings looked wrong:** the map file matches today's OpenStreetMap closely (16,470
  buildings in the play area against OSM's 16,949), but OSM simply lacks thousands of buildings
  nobody has traced. Overture Maps (free) adds footprints traced from satellite images by Google
  Open Buildings and Microsoft.
  - `scripts/prepare_extra_buildings.py` (DuckDB + Shapely) takes the 5,770 in the play area. It
    leaves out 748 smaller than 20 m² (mostly trees and shadows) and 1,282 that sit on an OSM
    building, a road or its pavement, a park or military land.
  - The remaining 3,740 go in `public/data/hsr-extra-buildings.geojson`, loaded beside the map.
    The city goes from 16,470 to 20,204 buildings.
  - They're classified like any other building, mostly as small houses, and get the house kit.
- **Temples, mosques and churches** (`worship.ts`, `Temples.tsx`). OSM had 41 places of worship;
  the game drew none.
  - `scripts/prepare_extra_places.py` adds Overture's (Meta and Microsoft) places of worship with
    confidence of at least 0.6 that OSM lacks: 38, 5 of which only name a place OSM has unnamed.
    That's how the Agara Jagannath temple was found: OSM has its compound with no name.
  - Matching:
    - a building tagged as a place of worship is one;
    - a compound's buildings are its, the largest being the main one;
    - a pin takes the building it's in (up to 1,200 m², not flats or offices), or the nearest
      small building within 10 m. Otherwise the game builds one, sized to the compound or as a
      roadside shrine, shrinking it until it fits.
  - Their buildings get the kind `temple`, so the plain buildings, house kit and roof tanks leave
    them alone. 62 places of worship in all.
  - **Hindu (Dravidian):** cream walls on a red-ochre plinth and parapet, a stepped, painted
    vimana with a dome and gold kalasha, a gold flag post (dhwajastambha) in front when there's
    room (13 have one), and compounds walled in red-ochre and white kaavi stripes with a gateway
    towards the road.
  - **Jagannath (Kalinga):** a rekha deula in ten ribbed courses, rising straight and then curving
    in, with ochre ribs, a wide amalaka, kalasha, Nila Chakra and red flag, plus a stepped pidha
    roof over the hall in front. Agara's is in its OSM compound; HSR's other Jagannath temple,
    which OSM lacks, is generated by Silk Board.
  - **Mosques:** green bands, a dome on a drum, two minarets. **Churches:** a bell tower with a
    pyramid roof and a cross. **Buddhist:** a white stupa dome.
- Credits: `public/data/CREDITS.txt` and the on-screen line name Overture Maps, Google Open
  Buildings (CC BY 4.0) and Microsoft (ODbL).

### What I checked
Type check, lint and build pass. In the game: Agara's Jagannath temple from the road (striped
wall, flag post, the Kalinga tower; the first version, a smooth lathe, looked like a rocket and
was rebuilt in ribbed courses), HSR's Jagannath temple, a Dravidian temple with its flag post, a
mosque and a church. 120 FPS on both High and Low at a dense spot, but that's the display's cap
on this Mac. A mid-range laptop isn't tested. Settings were put back.

### Lesson 235: a name tells you more than a tag
OSM had Agara's Jagannath temple all along, as an unnamed compound tagged only "hindu". Matching
a second source by place, not just adding it, turned "missing" into "unnamed". And the name is
what decides its style.

## 2026-11-17: Entry 113, shops with real depth

### What I did
The inside of every shop was one picture painted in perspective on a flat quad in the doorway. It
only looked right from straight in front; from anywhere else it was plainly a screen.

- **A room the shader draws (interior mapping):** the doorway is still one quad, but its shader
  follows each pixel's line of sight into a box behind the wall (as wide and tall as the doorway,
  2.6 to 4.2 m deep). It finds which face it meets first (back wall, side walls, floor or ceiling)
  and paints that face from the shop's square in a new atlas, darker further back. The room
  shifts in true perspective as you ride past.
  - The atlas has one 512 px square per kind of shop: its back wall straight on (the old
    drawings, reused in a new flat mode), then a tiled floor and a ceiling with a tube light.
  - The side walls carry on the back wall's shelves.
  - `textureGrad` with gradients from the doorway's own coordinates stops the face edges flashing
    the smallest mipmap.
  - The rooms glow a little by day (tube lights), more at night.
- **3D fronts** (`shopFrontKit.ts`), merged per map square, all shops:
  - the rolled-up shutter in its box, guide rails down each side, and a granite step;
  - **kirana:** strips of snack packets hanging from the shutter box, a counter with sweet jars,
    and rice sacks;
  - **darshini:** a steel counter with big vessels;
  - **chai:** a kettle, glasses and a bench;
  - **bakery:** a glass display with trays of cakes;
  - glass counters at chemists, phone and jewellery shops;
  - a rail of clothes at clothing shops;
  - buckets and leaning pipes at hardware shops;
  - and so on for each type, plus a cool-drinks fridge by the door at some.
  - Drawn to the props distance, but only within 60 m on Low.

### What I checked
Type check, lint and build pass. In the game: a kirana (shelves on the back and side wall, tiled
floor, hanging packets, jars, sacks), a bakery from an angle, and a darshini. 120 FPS on High on a
shop street (the display's cap; 2,730 shops in all). Not checked: Low on a mid-range laptop, and
the rooms at night. The saved progress was untouched.

### Lesson 236: a room can live in a pixel shader
Interior mapping draws a convincing 3D room on one quad: intersect the view ray with a box in the
quad's own frame and colour by whichever face it hits. It's cheap, works from every angle, and
needs no hole in the building, which here is a solid extrusion.

## 2026-11-17: Entry 114, a debug spawn, a clear-sky sun, deeper shade, and walls that hold

### What I did
- **`?spawn=<street>`** (`src/dev/spawn.ts`) starts the rider on that street, in the left lane,
  facing along it.
  - The street is a slug of its name: `27th-main-road`, or just `27th-main`.
  - If several roads match, the longest stretch in the play area wins.
  - It logs which road it chose, or warns with some names that exist.
  - Only in the dev server, or anywhere with `?debug` (for `vite preview`). Players never get it.
- **Clear-weather sun** (`CLEAR_SKY` in `skyLogic.ts`). With no cloud:
  - the sun is 20% stronger and warmer (towards `#ffd6a3`);
  - the sky overhead is a deeper blue (the hazy horizon is left alone);
  - the fill light drops to 88%, so shadows read;
  - shadows are crisper: the PCF filter radius shrinks by up to half (`shadowSharpness`).

  All of it fades out between cloud 0.25 and 0.55, so cloudy and rainy days are unchanged.
- **Ambient occlusion:**
  - N8AO's radius goes from 1.6 to 2.2 m (it reaches up under a 3.2 m stilt floor) and its
    intensity from 2.2 to 3.0.
  - Baked into the wall shader, every downward face is 50% darker: stilt ceilings, and the
    undersides of slabs and sunshades.
  - Wall-base contact shade: 0.5 m and 60%, up from 0.35 m and 45%.
  - Shade under balconies and sunshades: deeper and taller.
  - The stilt floor is a darker concrete.
- **Walls that hold.** Buildings and compound walls (with their closed gates) were already
  solid. But with nitro on a slow frame (the game allows down to 20 fps) the scooter moves over a
  metre per step. That's more than the 0.25 m wall plus the scooter's 0.6 m radius, so its middle
  landed past the wall's middle, and the push out sent it through. Movement is now cut into steps
  of at most 0.25 m, each checked against the walls (up to 10 per frame).

### What I checked
Type check, lint and build pass.
- **Collisions:** the real collision code, run outside the game. At 23.5 and 30 m/s at 20 fps,
  the old single step went through a compound wall; with sub-steps it stops at the wall every
  time. Normal speeds were unchanged.
- **In the game:**
  - `?spawn=27th-main` started on 27th Main Road in the left lane;
  - the clear morning sun is warmer;
  - under an apartment's stilts reads as shaded;
  - 120 FPS on High, the display's cap.

The saved progress was untouched.

### Lesson 237: collide in steps no longer than the thing you hit
Collision by "push out of whatever you overlap" only works if each move is shorter than the
thinnest wall plus your own radius. Fast objects on slow frames need sub-steps (or a swept test),
or they pass straight through.

## 2026-11-17: Entry 115, polishing 27th Main Road, and new title covers

### What I did
Tested throughout with `?spawn=27th-main&debug=1`.

1. **Clear-weather light** (`CLEAR_SKY` in `skyLogic.ts`, `Sky.tsx`, `Lighting.tsx`):
   - The sun is 25% stronger and warmer under a clear sky.
   - During the riding windows, **8–11 am and 4–6 pm**, it's 15% stronger and warmer still. In
     those windows the fill light drops to 82% and the warm ground bounce to 75%, so shadows are
     darker.
   - Shadows are crisper: the PCF radius shrinks by up to 60%.
   - The zenith is a deeper blue, and under a clear sky the blue comes further down the sky
     (gradient exponent 0.55 → 0.36), so the sky a rider sees is blue above a warm haze.
   - Cloudy and rainy days are unchanged.
2. **Product cards in shops** (`productCards.ts`): the back walls of the 3D rooms now show framed
   picture cards drawn in code, all generic with no brands:
   - **jewellery:** necklaces, bangles, rings and earrings on dark red;
   - **phone and electronics shops:** handsets, earphones, chargers and power banks;
   - **hardware:** hammers, spanners, paint tins, taps, padlocks and screwdrivers;
   - **darshini:** a green picture menu of dosa, idli, vada, coffee and meals, with prices;
   - **chaat:** the same kind of menu, in red;
   - **kirana, general and supermarket:** chips, biscuits, noodles, bottles and chocolate.

   Rooms are darker than the street: by-day glow 0.18 → 0.06, and an 82% shade.
3. **Forecourts:** where shops on a new-ground street stand back from the footpath, the ground
   from the footpath to their walls is paved with the same pavers.
   - Neighbouring shops' forecourts join up, within 4 m.
   - Each end is dusty, with a face down to the soil and dust blown out onto it.
   - The street's height includes them, so the rider, parked bikes and people stand on them.
   - Grass stays off them.
   - 27th Main's right side now matches its left.
4. **Weathering:**
   - **Kerbs:** paint chipped to grey concrete in patches, most on the tops where tyres scuff,
     with a band of road grime at the base (a shader step on the kerb material).
   - **Gutters:** silt in patches along the gutter, more roadside dust, and drifts of dry leaves
     along the kerbs.
   - **Asphalt marks:** every 4 m instead of 6, with more tar patches and cracks.
   - **Walls:** the grime band at wall bases is taller and stronger (everywhere).
5. **Night:** about 30% of signboards are backlit boxes, glowing 2.4× (the bloom picks them up);
   the rest glow at 0.55×. Each open shop throws a soft pool of warm light onto the footpath in
   front of it after dark.
6. **The hatched stub:** it was the dark store's riders' bay, painted 4.1 m from the wall. On 27th
   Main's footpath that's across the kerb and onto the road. It's now placed from the real road
   edge, inside the footpath, and lit by the shared sun (it was unlit).
7. **People at shops** (`ShopPeople.tsx`, `shopPeoplePlacement.ts`):
   - a shopkeeper in the doorway of about 45% of shops;
   - 2–3 customers at the counter of each darshini, chaat, tea and coffee stall;
   - now and then one at a kirana.

   Only on new-ground streets, and drawn only within 70 m of the rider (45 m on Low), as a
   person model is up to 9,300 triangles.

**Title covers** (`public/title/`), all three re-shot on the new 27th Main, 1500×779:
- **Morning:** the rider riding towards the camera at 9:20.
- **Midday:** the rider pulled up by the chaat centre and medicals, customers at the counter.
  The caption is now "Pulling up at the chaat centre, midday", as there's no handover in it.
- **Night:** nitro in the rain at 9 pm, the medicals lit, light on the footpath.

The old covers are kept in the session's scratchpad.

### What I checked
Type check, lint and build pass. Every part above was looked at in the game, by day and by night.

Frame cost was timed with `gl.finish()`, so the GPU's share counts. The display caps at 120 FPS.

| | FPS before | FPS after | Frame (median / 90th percentile) before | after | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- |
| High | 119 | 112–113 | 3.7 / 4.0 ms | 4.0 / 4.2 ms | 514 → 518 | 3.87 M → 4.10 M |
| Low | 119 | 120 | 3.2 / 3.7 ms | 2.7 / 3.1 ms | 297 → 299 | 2.49 M → 2.66 M |

On High about 3 FPS of the drop is the shop people (measured by hiding them). Before limiting them
to near the rider, they added 1.1 M triangles. Low's change is within noise.

Taking the shots made a delivery, which saved (+80 credits). The save was put back on the title
screen and checked: 850 credits, 280 XP, High.

### Lesson 238: count triangles before trusting the frame rate
At a 120 Hz cap, FPS hides cost. The per-frame triangle count showed a million triangles of
people the rider could never see. Time the GPU and count what's drawn, not just frames per
second.

---

## 2026-11-17: Entry 116, final polish on 27th Main: people, shop goods, stains, the rider's colours

### What I did
Tested throughout with `?spawn=27th-main&debug=1`.

1. **Proper people at the shops** (`ShopPeople.tsx`): the grey, cone-shaped figure outside Ganga
   Jewellers was the woman built in code (`createWomanGeometry`), whose long kurta is a cone.
   Shop people now use only the two models traffic uses, the man and the teen. Traffic's
   walkers still include the coded woman, until a model with a clear licence takes her place.
2. **Life on the footpath** (`shopPeoplePlacement.ts`, the walking shader in `Traffic.tsx`):
   - **Idle poses** (`IDLE_POSE` in `gait.ts`), done on the graphics card like the walk:
     - **weight shift:** the hips move about 4 cm onto one leg, stay there, then move to the other;
     - **phone:** forearm up across the body, bent at the elbow, head bowed;
     - **chatting:** in pairs facing each other, a hand coming up now and then, taking turns.
   - **Walkers:** about a third of shops have someone pacing the footpath past them, on a lane
     0.85 m out from the walls. That's clear of counters and fridges, which reach about 0.6 m,
     and of the parked scooters, which start about 1.15 m out. A walker only uses a stretch where
     nobody is standing. They stop at each end for 1–4 s, turn, and walk back.
   - **Less uniform:**
     - 1–3 customers instead of 2–3, unevenly spaced;
     - shopkeepers placed differently in each doorway;
     - turned more or less towards the counter;
     - each person on their own timing, where before all of them breathed in step.
3. **Shop goods at real size** (`productCards.ts`, the room shader in `ShopFronts.tsx`):
   - The back wall used to stretch one picture across the doorway, so a 7 m shop showed bangles
     a metre wide. The picture now covers a fixed 3.5 m of wall and repeats along wider walls.
     One `fract()` in the shader does it.
   - Shelves and glass cabinets now hold rows of small goods, several of each side by side:
     - **jewellery:** pieces about 15 cm, in velvet cabinets;
     - **phones:** about 10 × 17 cm;
     - **snacks:** packets about 15 × 22 cm on six shelves;
     - **chemist:** medicine boxes about 9 × 12 cm;
     - **bakery:** loaves, buns, cakes and puffs.
   - Darshinis and chaat stalls keep their picture menu, now a board high on the wall, with
     tumblers and bottles on a shelf below it.
   - **Glass counters** (`shopFrontKit.ts`) at jewellers, phone shops and chemists show rows of
     small goods behind the glass. Each item is a flat quad of two triangles, merged into the
     existing shop-front mesh, so it adds no draw calls.
4. **Oil stains** (`groundTextures.ts`, `StreetEdges.tsx`):
   - **Softer:** a soft halo, a see-through core and pooled spots, all radial gradients, instead
     of one opaque black blob.
   - **Wet look:** the decal material turns glossier (roughness 0.85 → 0.28) where a stain is
     dense, so it catches the light. This is one shader step, with no extra texture or pass.
   - **More variants:** two smaller round stains and a trail of drips along the lane.
   - The decal picture is now 4 × 2 cells instead of 2 × 2 (`DECAL_COLUMNS`/`DECAL_ROWS`).
5. **The hatched stub is gone.** It was the dark store's riders' bay stripe: a single 0.5 m
   hatched band on the footpath, which read as a broken zebra crossing. A zebra crossing
   belongs on the road, so the stripe, its texture and `placeRidersBays` were removed rather
   than converted.
6. **The rider in brand colours** (`brandPrint.ts`, `Rider.tsx`, `Scooter.tsx`):
   - **Dye:** a purer yellow, `BRAND_DYE` `#ffd200`, not the wordmark's on-screen `#f6b32b`.
     From behind, the rider's back faces away from the sun and is lit mostly by the bluish sky
     fill, and the warm grade pushes it towards orange. `#f6b32b` came out as cardboard tan; the
     purer yellow comes out as the logo's marigold. The material changed, not the light.
   - **Jacket:** dyed with it, with full sleeves, a dark brown collar and
     "Deliver It" across the back in the wordmark's style: heavy dark brown, tilted 3°, over a
     chilli-red stroke.
   - **Box:** split off the scooter model (`splitDeliveryBox`) so it gets its own non-metallic
     plastic material in the same dye. Its baked shading is brightened so the marigold
     comes through rather than a tan.
   - **Box logo:** the name with the Kannada underneath, on the back and both sides, with light
     grime and scuffs.
   - The dark store's staff keep their black T-shirts.

7. **Road marks showing through the delivery marker** (`MissionMarker.tsx`): the beam and the
   road's stain and patch decals are both see-through. Three.js draws see-through shapes far to
   near by their middles. A map square's decals are one big shape whose middle is often nearer
   the camera than the beam, so they were drawn over it. The beam now has `renderOrder={10}`,
   so it's always drawn after them.

Debug aids (`?debug` or the dev server only):
- `DevStats.tsx` puts the renderer, scene and camera on `window.__deliverIt`.
- `DevTeleport.tsx` puts the rider's state on `window.__deliverItScooter`, so the console can
  move the rider.

### What I checked
Type check, lint and build pass. I looked at every part in the game.

Frame cost was timed with `gl.finish()`, at the spawn point, in the first minute after loading:
morning, dry, Low then High, twice each. The display caps at 120 FPS. Results were noisy on this
Mac: two whole runs, one before and one after, came out twice as slow as the rest, so the
before and after runs were alternated. These are the matching quiet runs:

| | FPS before | FPS after | Frame (median / 90th percentile) before | after | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- |
| Low | 118.6 | 120 | 2.8 / 3.1 ms | 2.8 / 3.0–3.1 ms | 306–308 → 305–306 | 2.67 M → 2.66–2.72 M |
| High | 118.5 | 118.8–119.2 | 3.7–3.8 / 4.1 ms | 3.9–4.0 / 4.5–7.5 ms | 519–523 → 525–526 | 4.09–4.13 M → 4.22–4.33 M |

- Low is unchanged. Low draws people only within 45 m, and moves only half the walkers.
- High costs about 0.2 ms more a frame: more people near the rider, the box's own material and
  its three logo quads.

### Lesson 239: control the scene before you time it
At first the "after" run looked twice as slow. That wasn't the change:
- The game clock had run to night and the rain had come in.
- On High, `AdaptiveResolution` had moved between 1.5× and 0.75× resolution partway through.

Before comparing two timings, check that they had the same time of day, weather and pixel
ratio. Also alternate the before and after runs, so drift in the machine itself (heat, other
apps) lands on both.

### Try it
In the room shader in `ShopFronts.tsx`, change
`fract(hit.x / ${BACK_WALL_TILE.toFixed(3)})` to `hit.x / vRoomSize.x` and reload. The back
wall stretches across the whole doorway again, so in a wide shop every item comes out wider
than it should, and wider in one shop than in the next. That's the problem this entry fixed:
`fract()` repeats the picture every 3.5 m instead.

---

## 2026-11-17: Entry 117, street presets across the whole map, and a rider on the pedestrians' model

### What I did
27th Main Road is the approved reference street. What was built for it is now a set of
data-driven presets, rolled out to every street.

1. **Street presets** (`streetPresets.ts`). There are three, each a plain object of sizes,
   shares and switches:

   | | Shop street | Residential street | Main road |
   | --- | --- | --- | --- |
   | Footpath | 3 m | 1.8 m | 3.2 m |
   | Kerb | 0.2 m, black and yellow | 0.18 m, bare grey | 0.3 m, black and yellow |
   | Median | none | none | 1 m, on two-way roads 9 m or wider |
   | Marks on the asphalt | one tried every 4 m, 55% kept | every 6 m, 40% | every 3 m, 60% |
   | People at shops | most | fewest | in between |
   | Scooters parked per shop | up to 4 | up to 2 | up to 3 |
   | Washing / creepers on houses | 30% / 20% | 45% / 40% | 20% / 15% |
   | Traffic placed here (weight) | ×1.5 | ×1 | ×3, and buses |

   **Picking a road's preset** (`assignStreetPresets`) is done once per named street, so a
   street doesn't change kind from block to block:
   - Any motorway, trunk or primary piece makes it a main road.
   - Otherwise, 2.5 or more shops per 100 m along it (shop buildings and mapped shops, within
     28 m) make it a shop street. 27th Main has about 10.
   - Otherwise, a mostly secondary street is a main road.
   - The rest are residential.
   - Service roads and tracks keep the plain ground.

   27th Main is mapped partly as a secondary road and partly as a tertiary one. Deciding per
   street makes all of it a shop street.

   **Across the map:**

   | Preset | Road length |
   | --- | --- |
   | Shop street | 29 km |
   | Residential | 220 km |
   | Main road | 53 km |
   | Plain ground | 40 km |

   `usesNewGround(road)` now just asks whether the road has a preset.
2. **The edge builder per preset** (`streetEdgeGeometry.ts`):
   - Footpath and kerb width come from each road's preset. A junction corner between two kinds
     of street uses each road's own footpath, and the wider kerb.
   - **Painted kerbs are long pieces now, not 1 m blocks.** The kerb shader paints the black and
     yellow blocks from a new `aStripe` attribute: metres along the kerb, or -1 for bare
     concrete. Each block gets its own wear and a dark joint.
   - **Medians:** a main road's two kerbs fit into a narrow gap to the next carriageway, each up
     to half its width, so dual carriageways get a painted median. A wide two-way main road gets
     a median strip down the middle, stopping 9 m short of each junction. It's made solid only
     after traffic's lanes are laid out, as a lane beside it would otherwise count as blocked.
3. **Buses** (`bus.ts`):
   - An 11.2 m city bus, built in code, with doors on the left.
   - The livery is made up: green, red, blue or ochre below a cream band, with no operator's
     name.
   - It has a deep air horn, and only takes lanes on main roads.
   - Each lane carries its street's traffic weight, and new vehicles are placed in proportion
     to it (`Lane.weight`), so main roads are busier.
4. **Seeded per street** (`streetSeed`, `streetRandom`):
   - Marks on the asphalt and the people at shops are seeded by their street and their spot,
     so a street looks the same on every visit and different from its neighbours.
   - Everything else placed in the world was already seeded.
5. **A pool of shop names** (`shopNames.ts`):
   - Six made-up names for each kind of shop, from about 30 common first words (Sri Lakshmi,
     Kaveri, Nandi, New, Royal…) and each kind's own words, in Kannada and English.
   - That's 96 more boards. The board atlas went to four columns of 512 × 112 to hold 128 and
     stay under 4,096 px tall.
   - `assignBoards` gives each shop a board no other shop within 250 m has, while there's one
     to give.
6. **Solid plots** (`houseKit.ts`):
   - Every compound wall was already solid, gates included, and so is every building, and every
     wall on the map.
   - Checked by driving the scooter at walls at 10 m/s in 16 directions: it never ended up
     inside one.
   - What was open was the side passage between houses into the plot behind. A plot's side
     walls now run back past its house, where the line is clear of the house, other buildings
     and roads, so a corner plot keeps its open side.
7. **Build time.** The rollout made the new-ground build ~6 s; it's now 3.8 s:
   - The kerb check against gates went through every gate for every 0.25 m of kerb. Kerbs now
     get their lowered stretches from the gates near them.
   - Gutter leaves were most of the dust layer's 3.6 M vertices, so they're thinner, by preset.
   - Triangles are built without allocating vectors.
   - Railings and walkers checked every gate and every shop map-wide. Both now use grids:
     railings 3.3 s → 44 ms, shop people 1.4 s → 20 ms.
   - Forecourt heights, asked every frame, are in a grid too.
8. **Low** draws kerbs and edge stones to 140 m and the small layers (dust, tree pits, marks)
   to 70 m. The new ground has seven layers per map square where the old had two.
9. **The rider on the pedestrians' character base** (`riderModel.ts`, `Rider.tsx`):
   - The rider is now the man model the walkers use, bent by a shader the same way they are,
     rather than cylinders.
   - The existing inverse kinematics still decides where the hands and feet go. Each frame
     those become shoulder, elbow, hip and knee angles: the law of cosines for the bend, then
     two turns to aim the limb, in the model's own frame.
   - The normals turn with the limbs, so the arms light correctly.
   - **Dressed once at load:** the jacket over the shirt with full sleeves, gloves, trousers,
     shoes. The head and neck are hidden under the helmet and collar.
   - **Stopping:** the foot goes down on tiptoe and the hips shift over, as a real-sized leg
     doesn't reach the ground flat from the seat.
   - The helmet, print and branded box are unchanged.

**Review streets** (`?spawn=…`, see `REVIEW_STREETS` in `spawn.ts`):

| Spawn | Street |
| --- | --- |
| `shop-street` | 24th Main Road |
| `residential-street` | 13th Cross Road |
| `main-road` | Sarjapur Road |
| `27th-main` | the reference street, as before |

**Debug aids:**

| Aid | What it does |
| --- | --- |
| `?streets=reference` | Dresses only 27th Main, for comparing costs |
| `window.__deliverItStreets()` | Lists the longest streets of each preset |
| `window.__deliverItSolidAt(x, z, r)` | Says whether a point is inside something solid |

### What I checked
Type check, lint and build pass. I looked at each review street in the game, and at the rider
side-on, both riding and stopped.

**Load and memory:**

| | Only 27th Main dressed | Full rollout |
| --- | --- | --- |
| Time until the rider can ride | 21 s | 21 s |
| Scene geometry | 15.6 M vertices, 428 MB | 17.4 M vertices, 568 MB |

Geometry grows less than the rollout might suggest, because the new ground replaces the old
roads' and kerbs' meshes.

**Frame cost.** Timed with `gl.finish()`, morning and dry, in the first minute after load, as in
Lesson 239. This Mac was running about twice as slow as in Entry 116 throughout: the last commit
itself measured 5.0 ms on Low at 27th Main, against 2.8 ms then. So compare the columns, not
these numbers with Entry 116's. "Before" is the same build with `?streets=reference`, except at
27th Main, where it is the last commit.

| Street (preset) | Low before | Low after | Low draw calls | High before | High after | High draw calls |
| --- | --- | --- | --- | --- | --- | --- |
| 27th Main (shop) | 5.0–5.1 ms | 5.4 ms | 300 → 290 | 10.1–14.7 ms | 7.8–12.6 ms | 522 → 523 |
| 24th Main (shop) | 4.6–5.2 ms | 5.4–5.5 ms | 257 → 277 | 12.3–13.2 ms | 10.3–12.1 ms | 530 → 548 |
| 13th Cross (residential) | 5.7–5.8 ms | 5.5–5.6 ms | 254 → 290 | 10.8–11.4 ms | 10.3–13.9 ms | 485 → 524 |
| Sarjapur Road (main) | 4.3–5.1 ms | 5.5–5.8 ms | 177 → 200 | 8.6–9.3 ms | 6.2–8.7 ms | 313 → 332 |

- **FPS:** Low held 117–120 everywhere, against the 120 Hz cap.
- **High:** the resolution moved between 0.75× and 1.5× from run to run, so its milliseconds
  are rougher. They're within noise of before.
- **Low:** up to about 1 ms more at three of the four streets, from about 20–36 more draw calls.
  The 27th Main and 24th Main rows were measured before the Low draw distances in item 8; the
  27th Main row after them shows fewer draw calls than before.

### Lesson 240: describe a street as data, and let the code read it
A preset is a plain object (footpath width, kerb paint, how often a mark appears, how many
people stand about), and every builder asks the road for its preset instead of keeping its own
numbers. Adding a fourth kind of street is a new object, not a change to a dozen files. And
because a road's preset is decided once, by its name, the whole of a street is one kind.

### Try it
In `streetPresets.ts`, set the residential preset's `kerb.painted` to `true` and reload with
`?spawn=residential-street`. Every residential kerb on the map is now black and yellow,
painted by the shader from `aStripe`. The kerbs' shapes are the same; only the stripe values
and base colour they're built with change, and the shader does the rest.

### Follow-up: the picture had gone blurry
The automatic resolution scaler (`AdaptiveResolution.tsx`) had two problems:
- **It chased the screen's refresh.** On a 120 Hz screen it counted any frame over about 11 ms
  as late. On a busy street High takes 10–13 ms at its full 1.5×, so the scaler stepped down,
  first to 1×, then to 0.75×: a quarter of a Retina screen's pixels, while the game ran a smooth
  but blurry 120 FPS.
- **It ignored High's own floor.** 0.75× is below the 1× minimum High is meant to have.

The fix:
- It now judges frames against 60 FPS whatever the screen's refresh.
- It never goes below the quality's own lowest resolution: 1× on High and Medium, 0.75× on Low.

On 27th Main in the rain, High now holds 1.5× at about 70 FPS on this Mac, where before it had
dropped to 0.75×.

### Follow-up: shadows moving every second
Two causes:
- **The day was 10 real minutes long** (`SKY_RULES.dayLength` 600), so the sun turned about
  0.6° a second and every shadow visibly swept. A day now lasts 30 minutes (1800): about 0.2° a
  second, and about 16 minutes of daylight before night, which still runs twice as fast.
- **The light's direction was updated every frame**, so the shadow map's pixel grid turned a
  fraction every frame and shadow edges crawled and shimmered. `Lighting.tsx` now keeps the
  direction until the sun has moved 0.25°, then steps. Each step moves a 10 m building's shadow
  by about 4 cm.

Measured in the game: over 10 s the sun moved 1.77°, and the light changed direction 7 times in
301 frames, where before it changed every frame.

### Follow-up: Low was pixelated on a Retina screen
Low rendered at a fixed 0.75× (`qualitySettings.ts`). That's mildly soft on an ordinary
1× laptop screen, but on a 2× (Retina) screen it is under 40% of the native pixels across: each
rendered pixel is a block of about 2.7 × 2.7 screen pixels.

Low's range is now 0.75–1. It starts at 1× (the screen's scale, capped at 1), and
`AdaptiveResolution` steps down to 0.75× only if the computer can't hold about 60 FPS, so a slow
laptop still gets the cheaper picture. Checked in the game: switching to Low now gives 1× on this
Mac, where it gave 0.75× before.

## 2026-11-17: Entry 118, filling the streets, a skyline past the edge, and a jacket that doesn't tear

### What I did
A review round across the three test streets (`?spawn=shop-street`, `residential-street`,
`main-road`).

1. **Shops on the shop streets' ground floors** (`addGroundFloorShops` in `streetPresets.ts`).
   24th Main showed mostly plain buildings because OSM tags most of its buildings as houses or
   apartments, and only buildings tagged as shops got a shop front. Now any house or apartment
   within 9 m of a shop street's or main road's frontage becomes a shop on the ground floor (90%
   on shop streets, 80% on main roads; picked by a hash of the building's id, so the same ones every
   visit). That's 1,674 buildings. They're kept out of the count that decides whether a street is a
   shop street, so converting them can't change the presets.
2. **Empty plots filled** (new `infillPlots.ts`). Each side of every preset street is walked,
   and wherever a plot's worth of ground beside the footpath is clear (of buildings, roads, parks,
   schools, petrol pumps and the map's edge) it's built on:
   - residential: houses behind a 3 m yard (`houseKit.ts` gives them their compound walls and
     gates), a car in about a third of the yards, and a building site on about one plot in 14;
   - shop streets: shops, close to the footpath;
   - main roads: shops and showrooms, hoardings on some gaps (new `Hoardings.tsx`, eight made-up
     Kannada and English ads), petrol pumps on long gaps (at most one every 900 m) and small
     roadside temples (at most one every 700 m).

   Where a full-depth plot won't fit in front of a building standing further back, it tries
   shallower ones (down to a 6 m row of one-room shops, or a small house behind a 1.5 m yard), so
   no deep strip of bare earth is left by the road. Totals on a fresh load: 7,306 buildings, 407
   building sites, 1,766 cars in yards, 46 hoardings, 7 petrol pumps, 4 temples.
3. **The map's edge hidden** (new `Skyline.tsx`, `haze.ts`). Outside the boundary wall: a line of
   trees, then two rows of building silhouettes in HSR's plaster colours, with water tanks on the
   roofs and windows drawn by their shader. The whole ring is three instanced draw calls. The
   haze is thicker too: `HAZE_STRENGTH` 0.3 → 0.42 and the far wall starts closing in sooner
   (`HAZE_WALL` 0.6 → 0.5), so the skyline reads as far-off city.
4. **The rider's shoulders.** The spikes were in the model, not only in the posing: with the arms
   at rest, colouring each corner by what it is showed the shirt's edges are ragged round the
   shoulders (made to sit under skin), and bare arm skin pokes through the sleeves. Bending those
   corners far enough to reach the bars tore them. The rider now wears a jacket of simple shapes
   merged into the model (`createJacketShell` in `riderModel.ts`): a torso of rings fitted to the
   body, a ball at each shoulder centred on the joint, sleeves to the elbow, a ball at the elbow
   and sleeves to the cuff. The model's own arms and shirt underneath are hidden. Each shape
   carries the same `_limb` weights as the model, so the same shader poses it, and the back print
   now wraps the jacket.
5. **Crack decals** (`groundTextures.ts`): drawn as a soft halo at 12% plus a thin line at 45%,
   blurred by 0.8 px, where before they were thick opaque black lines.
6. **No shop name twice within 300 m.** Whole names on the board atlas ran out (96 names for
   about 8,000 shops). Now a board is its kind's blank board with a name laid over it as two words,
   a first word and one of the kind's words (`shopNames.ts`), each drawn once in white on the atlas
   and tinted with the kind's lettering colour. That gives dozens of names per kind from a few
   hundred words. Repeats within 300 m went from 3,582 to 0. The atlas is 4096 × 2428, under the
   4,096 limit.
7. **Busier main roads.** Main roads' traffic weight is 4 → 10 (shop streets 1.5 → 2), and the
   traffic pool is a little larger (16 / 28 / 40 vehicles on Low / Medium / High, was 12 / 22 / 34).
   About 400 m of main road in the spawn ring competes with kilometres of residential lanes, so at
   a weight of 4 it got only about a quarter of the pool. Buses (made-up liveries, no operator
   name) run only on main roads.

### Frame rate
Standing at each spawn, 6 s per reading, this Mac (120 Hz screen):

| Street | Low | High |
| --- | --- | --- |
| Shop street (24th Main) | 100–117 FPS, 8.3 ms median | 52–56 FPS, 16.7 ms median, p95 25–32 ms |
| Residential (13th Cross) | 119 FPS, 8.3 ms | 84 FPS, 8.6 ms |
| Main road (Sarjapur Road) | 117 FPS, 8.3 ms | 83 FPS, 9.0 ms |

Low stays well above 60 everywhere. High on the shop street is the cost of the new buildings: the
same spot with `?streets=reference` (infill on the reference streets only) runs 87 FPS at 551
draw calls and 4.29 million triangles; with infill everywhere it's 588 calls and 5.25 million.

### Lesson 241: take the bend out before blaming the bend
The shoulders looked like a posing bug, and the first two fixes were to the posing:
position-based weights, then a gentler blend. Neither helped, because the fault was in the shape
being posed. The test that settled it took one line: zero every arm weight so nothing bends, and
look again. Still ragged, so the posing was innocent. Then colour each corner by its class (arm
skin, arm cloth, torso cloth, other) and the culprits are obvious. When a deformed mesh looks
wrong, first switch the deformation off.

A second lesson came from the shoulder weights: `average` over both arms gave a shoulder x of
nearly 0, because left and right cancel out. Measure one side and mirror it.

### Try it
In `infillPlots.ts`, set `SITE_SHARE` to `0.5` and reload with `?spawn=residential-street`. Every
other empty plot on the residential streets is now a building site with scaffolding. Every plot is
seeded from the street and the spot, so the same plots change on every visit.

Note: in the dev server, a hot reload reruns the infill on map data that already holds the last
run's buildings, so the logged counts drop. Reload the page for true numbers.

## 2026-11-17: Entry 119, loading in under 15 seconds, people on the traffic bikes, and traffic that never overlaps

### What I did
1. **Loading** (Play to riding: 41.7 s before, 11.6 s now, on the production build).
   A load timeline (`src/dev/loadTimeline.ts`, `__deliverItLoad()` in the console) timed every
   planning step and every part going on screen. The waits, and what was done about each:
   - **Shop goods, 6.2 s.** Every counter, crate and bucket was its own three.js shape, about
     300,000 of them, merged at the end. `shapeWriter.ts` makes each kind of shape once and writes
     every copy straight into one array per map square: 1.0 s.
   - **Parts built twice.** A part that builds its shapes and then asks drei for a texture
     "suspends" the first time, and React throws the work away. `WarmAssets.tsx` asks for every
     texture and model first, so every part builds once. Buildings alone had cost 1.9 s twice.
   - **Building all of HSR before the ride.** Buildings, shop fronts, fences, road details and the
     new kerbs, footpaths and asphalt are now built a map square at a time, nearest the rider first,
     a few milliseconds a frame (`StreamedChunks.tsx`, the way the house kit already worked). The
     street-edge plan went from 4–5 s to 0.09 s; I checked that all seven layers build exactly the
     same vertex counts as before.
   - **Traffic** is built once the ride has begun, behind the fading loading screen.
   - **Infill** remembers which ground it has tested between placements (40% fewer tests).

   The models are compressed with Meshopt (`scripts/compress_models.mjs`): traffic.glb 4.8 MB to
   1.6 MB, yamaha.glb 335 KB to 131 KB. City-kit.glb is mostly JPEG textures, so it barely changed
   (1.63 to 1.60 MB). KTX2 needs the KTX-Software encoder, which isn't on this Mac, so it isn't done.
2. **People on the traffic bikes.** The figure of cylinders and balls is replaced by the same man
   as the walkers and the player, posed once on the CPU by the same maths as the rider's shader
   (`createSeatedRiderGeometry`): hands on the bars, feet on the pegs, a helmet, and a jacket in an
   everyday colour (only the jacket takes the instance colour). Seated, the thighs swing forward
   about 80° and the hips tore like the shoulders did, so the jacket shell now has trousers too:
   a seat, a ball at each hip joint, thighs and knees.
3. **No overlapping traffic.** After each vehicle moves, if it's deeper into another vehicle's
   footprint (a capsule along its heading) than before, the move is taken back and it waits. New
   vehicles also keep a gap based on both lengths, so nothing spawns inside a bus. Over 30 s on
   Sarjapur Road with 40 vehicles: overlaps in 7 frames, up to 1.7 m deep, before; none after.
4. **Speckled car paint.** It wasn't texture compression: the cars have no textures. Their colour
   is baked into the corners, and it came from two flaws in the bake (`prepare_traffic_models.mjs`):
   shrink-wrapping took some corners' colour from the dark seals under panel gaps, and simplifying
   merged triangles across the paint's edge. A majority filter now cleans up the paint after
   wrapping, and the simplifier protects the paint edge. The paint is also satin rather than glossy
   (roughness 0.5, metalness 0.15). Re-run with the models in ~/Downloads, unzipped.
5. **Buses and autos** were already on the main roads (Entry 118), in made-up liveries with no
   BMTC name or logo.
6. **New title and loading pictures** in `public/title/`: 24th Main in the morning, nitro in the
   rain on Sarjapur Road, and Sarjapur Road at midday (replacing the handover shot). Taken in the
   game with `__deliverItPhoto` (holds the camera still) and `__deliverItSky` (sets the hour and
   weather), both only with `?debug`.

### Frame rate
The test tab was held to 30 FPS by the browser, so frames are timed by their work: each frame's
callbacks plus `gl.finish()`. Production builds of the last commit and of this one, run one after
the other. Both settle at 0.75× on Low and 1× on High:

| Street | Load before | Load now | Low before | Low now | High before | High now |
| --- | --- | --- | --- | --- | --- | --- |
| Main road | 29.6 s | 14.6 s | 8.2 ms | 7.1 ms | 12.4 ms | 8.5 ms |
| Shop street | 31.6 s | 15.4 s | 9.8 ms | 7.5 ms | 13.3 ms | 10.7 ms |
| Residential | 32.1 s | 13.8 s | 8.6 ms | 8.2 ms | 12.3 ms | 11.6 ms |

Load here is Play until the loading screen has faded; riding starts about 1.5 s before that.

### Lesson 242: find the wait before speeding anything up
The first guess at a slow load is a big download. The timeline showed the download took 0.4 s and
the rest was building: one part making 300,000 throwaway shapes, others building twice, and
everything building the whole map before the first frame. The counters I added to find a hot loop
misled me too: two million `performance.now()` calls were themselves a big share of what they
measured. Time whole steps; count calls, don't time them; and check output is unchanged (vertex
counts) after making something faster.

### Try it
Open the game with `?debug`, press Play, and run `__deliverItLoad()` in the console once you're
riding: every planning step and every part, with when it finished.

### Follow-up: KTX2 textures
KTX-Software isn't in Homebrew, so the official Khronos package (v4.4.2, signed by The Khronos
Group and notarised by Apple) was unpacked with `pkgutil --expand-full`, not installed, and its
`ktx` tool used from there. To re-run, unpack it the same way, put `libktx*.dylib` in a `lib`
folder beside its `bin`, and pass the tool as `KTX=…`.

- `scripts/compress_textures.mjs` encodes 15 tiling textures as Basis ETC1S with mipmaps: 3.0 MB
  of JPEG became 2.2 MB of KTX2. The originals moved to `art/textures` (not served). Colour is
  sRGB; normal and alpha maps are tagged linear, or the encoder would convert their values. Each
  picture is flipped first, as a JPEG texture is flipped on upload and a KTX2 one can't be.
- The wall colour photos and the shop boards stay JPEG: the game draws them onto canvases.
- city-kit.glb's eight textures are KTX2 too (`compress_models.mjs` with `KTX` set):
  1,595 KB to 1,242 KB.
- In the game, `useCompressedTextures` (`ktx2.ts`) loads them with three.js's own `KTX2Loader`;
  the transcoder is served from `public/basis`, copied from three.js, so they always match.

Checked in the game: no errors, every street surface and leaf the same, the poster the right way
up. The 20 compressed textures loaded on 24th Main take 11.1 MB of GPU memory, against 89 MB
uncompressed. Load was 4.8–5.0 s from Play to riding, but in those runs the planning steps that
KTX2 doesn't touch also ran about 4× faster than earlier in the day, so most of that is the
machine, not this change.

The poster (`poster-kills`) shows the real Google Play and App Store badges. It's left as it was,
for you to decide.

### Follow-up: new lamp-post posters
The old poster (a "Kills" delivery app with the real Google Play and App Store badges) is gone.
The lamp posts now carry two made-up ads in the style of what's pasted on every pole in HSR,
drawn in code (`lampPosters.ts`), side by side in one picture, sun-faded and rain-streaked like
the hoardings:
- **tez basket**, a 10-minute grocery app: yellow and green, a basket, "Groceries in 10 minutes"
  and ಹತ್ತು ನಿಮಿಷದಲ್ಲಿ ದಿನಸಿ.
- **DRIFT CO.**, a streetwear label: black, an oversized tee, "New drop · Oversized tees",
  ಹೊಸ ಸಂಗ್ರಹ ಬಂದಿದೆ and "From ₹599".

Alternate lamp posts get each (two draw calls instead of one), and each board's edges take its
own poster's background colour. No real brand names, logos or store badges, per ART_DIRECTION.md.
To add a third ad, draw it in `lampPosters.ts` and raise `POSTER_COLUMNS`.

## 2026-11-17: Entry 120, a profile before the performance and variety pass

### What I did
- **Kills branding gone.** The last of it was the print on the dark-store staff's T-shirts
  (`shirtPrint.ts`). It now reads DELIVER IT, the game's own name.
- **Profiled before changing anything.** New debug tools for it, all only with `?debug`:
  - every part of the world is a named group (`part:buildings` and so on), so a draw call can be
    traced to its part;
  - `__deliverItPost({ all, ao, bloom, aa })` switches post effects off one at a time;
  - `__deliverItLockDpr = 1.5` holds the resolution still (the scaler otherwise changes it
    mid-measurement).

### The profile (production build, 24th Main, 9 am, dry)
Draw calls and triangles in one frame:

| | Draw calls | Triangles | Shadow calls | Shadow triangles | Shadow casters in view |
| --- | --- | --- | --- | --- | --- |
| Low | 248 | 2.8 M | 44 | 0.56 M | 108 |
| High | 473 | 3.9 M | 130 | 1.39 M | 308 |

The "player" part (traffic, people, the rider) alone is 1.5 M triangles on Low and 2.0 M on
High: each car model is 24,000–28,000 triangles.

Frame time with a one-pixel read-back at the end, so the GPU's work is included, and with each
thing hidden in turn (what the frame saved, in ms). Low at 1×: 16.1 ms in all. High at 1.5×:
23.1 ms.

| Hidden | Low | High |
| --- | --- | --- |
| Traffic and people | 1.1 | 2.2 |
| Whole player part | 1.3 | 3.6 |
| Shadows | 1.3 | 2.4 |
| All post effects | ~0 | 2.5 (AO 1.4, bloom 0.5, SMAA 0.4) |
| Houses' kit | 0.4 | 1.6 |
| Shops | 0.2 | 1.0 |
| Street edges | 0.5 | 1.0 |
| Buildings | 0.4 | 0.8 |

The game's own JavaScript each frame (traffic, people, culling and the rest) is 3.9 ms on Low and
5.5 ms on High, before any drawing.

### Lesson 243: measure the thing you'll change
GPU timer queries were available but wrong on this Mac: every full-screen pass came out at about
4 ms, more than the whole frame. `gl.finish()` returned at once. The figures that held were the
plain ones: hide a part, see what the frame saves, and check the first figure again at the end
to catch the machine drifting.

## 2026-11-17: Entry 121, performance step 1: lighter cars, and far versions under 1,000 triangles

### What I did
- **Near cars** are re-baked at about 6,500 triangles (were 24,000–28,000): sedan 6,408, hatchback
  6,388, SUV 6,494, MPV 6,380. The motorbike is 6,918 and the auto 4,976. Wheels are 300–730.
  The simplifier had stopped at 11,000–18,000 whatever error it was allowed: the shrink-wrapped
  surface has tiny seams it wouldn't merge across. meshoptimizer's `Permissive` flag lets it, and
  then the hatchback reached 6,200 at a smaller shape error than before.
- **Far versions**, under 1,000 triangles with their wheels (530–610 for each body, 30–60 per wheel),
  replace the box stand-ins beyond the detail distance, now 16 / 20 / 24 m on Low / Medium / High
  (was 35 / 50 / 70). They use meshoptimizer's "sloppy" simplifier, which reaches any count.
  Far bikes add a rider of three simple shapes. The bus is built in code and stays itself out to 80 m.
- **Parked scooters and parked cars** (along the shops, in yards, under stilts) switch to their far
  versions beyond 20 m too: they had drawn the full models out to 75–90 m.
- `scripts/bench.mjs`: Low and High, unthrottled and at 4× CPU (as DevTools throttles), on a
  production build, in its own Chrome over the DevTools protocol. Run with
  `node --experimental-websocket scripts/bench.mjs`.

### Frame time (ms of work per frame, 24th Main)
Measured side by side with the previous commit, as this Mac's speed drifted 2.5× over the day:

| | Low | High | Low, 4× CPU | High, 4× CPU |
| --- | --- | --- | --- | --- |
| Before | 12.6 | 13.9 | 15.9 | 21.2 |
| After | 11.3 | 11.7 | 15.7 | 22.2 |

Triangles are GPU work, which CPU throttling doesn't slow, so the 4× columns barely move. Those
need the JavaScript work cut (step 3).

## 2026-11-17: Entry 122, performance step 2: shadows near the rider, and a lighter Low

### What I did
- **Shadows only near the rider.** A map square casts into the sun's shadow map only if its
  nearest edge is within the shadow range (`StreamedChunks`, `ChunkedMesh`, `HouseKitMesh`, checked
  every frame). Before, every square touching the shadow box drew all its geometry into it.
- **Cheaper shadow settings:** High's map 4096 → 2048 and range 140 → 90 m; Medium 90 → 70 m;
  Low 50 → 35 m (1024 map).
- **Low preset:** traffic 16 → 10 vehicles, pedestrians 10 → 6, draw distance 280 → 220 m, props
  140 → 110 m.
- **Optional 0.75× on Low:** a "0.75×" button beside the quality buttons when Low is picked; it's
  saved with your settings (`lowScale`) and holds the resolution at 0.75× of the screen.

On High at 24th Main: shadow-map draw calls 133 → 57, shadow triangles 1.15 M → 0.65 M.

### Frame time (ms of work per frame, 24th Main, two pairs side by side with step 1)

| | Low | Low at 0.75× | High | Low, 4× CPU | High, 4× CPU |
| --- | --- | --- | --- | --- | --- |
| Step 1 | 10.9–11.1 | 11.0 | 11.6–14.0 | 16.0–16.7 | 22.1–23.1 |
| Step 2 | 10.1–10.4 | 10.1–10.4 | 12.6 | 15.0–15.3 | 21.7–22.0 |

Low gains about 0.7 ms (1 ms at 4× CPU); High is within its run-to-run noise. Low at 0.75×
costs the same as at 1×: the frame is limited by CPU work, not pixels, so the next step is the
JavaScript.

## 2026-11-18: Entry 123, performance step 3: the game's own JavaScript

### What I checked first
- **HUD and phone re-rendering every frame?** No: no React work appears in a CPU profile of
  riding. The phone map is a canvas, though, and redrew everything every frame (below).
- **Allocations causing GC pauses?** Garbage collection was 1% of busy time. One per-frame
  allocation (a colour in `writeNearest`) is gone anyway.
- **Per-vehicle raycasts?** There are none in the code.
- **Traffic routing recomputed?** There's no route planning: a vehicle picks its next lane when
  its lane ends.

### What the profile did show, and what changed
(CPU profile of an unminified production build, High, 24th Main)
- `writeNearest` (6.8% of busy time) looked at every parked scooter on the map, twice a frame.
  Each instance now keeps a short list of those within reach plus 15 m, refreshed every 10 frames.
- three.js working out every object's place in the world every frame (`updateMatrixWorld` and the
  matrix maths under it, about 10%), though nearly everything never moves. Still parts (buildings,
  streets, shops, fences and the rest: `STILL_PARTS` in World.tsx) are placed once and skipped after.
- `ChunkedMesh` and `StreamedChunks` (4.4%) re-measured every map square every frame, for about 30
  parts. They now look again only after the rider has moved 2 m, or every 30 frames (and the
  streamer every frame while squares are still being built).
- The phone map redraws at most 30 times a second.

### Measuring, more carefully
The benchmark now reports, for each case, **synced** time (the frame with the GPU waited for),
**CPU** time (without waiting: what CPU throttling slows), and an **empty-frame floor** (scene
hidden, synced). The floor is 4–6 ms: the cost of waiting for the GPU at all, which a real frame
doesn't pay, as the GPU works on one frame while the next is being prepared. A frame's real cost is
roughly the larger of its CPU time and its GPU time (synced less the floor).

24th Main, synced / CPU ms, two pairs side by side with step 2:

| | Low | High | Low, 4× CPU | High, 4× CPU | Floor |
| --- | --- | --- | --- | --- | --- |
| Step 2 | 11.9 / 4.6–4.7 | 12.0–12.2 / 4.7 | 17.8–18.7 / 11.4–11.6 | 25.1–26.2 / 17.2–17.9 | 5.8–5.9 |
| Step 3 | 9.9–11.3 / 3.4–4.3 | 12.1–13.1 / 4.1–4.3 | 13–16 / 6.3–8.5 | 19.1–21.3 / 11.2–13.8 | 4.3–4.8 |

Against the targets (High 16.6 ms, Low 10 ms): CPU is within both, unthrottled and at 4×; GPU
(synced less floor) is about 6 ms on Low and 8 ms on High.

## 2026-11-18: Entry 124, performance step 4: Rapier's standard build

### What I did
The physics engine moves from `@dimforge/rapier3d-compat` to `@dimforge/rapier3d` (same version,
0.21.0). The compat build is a 4.3 MB script with the WebAssembly written inside it as text; the
standard build is a 0.3 MB script and a separate 3 MB `.wasm` file, which the browser compiles
while it's still downloading. `vite-plugin-wasm` wires the `.wasm` import into the build, and
`loadRapier` no longer calls `init()`: importing the module starts it.

Downloaded with compression (as a real server sends it): 1.65 MB → 1.22 MB (51 KB script +
1.17 MB `.wasm`).

### Frame time and load (24th Main, two pairs side by side with step 3, synced / CPU ms)

| | Load | Low | High | Low, 4× CPU | High, 4× CPU |
| --- | --- | --- | --- | --- | --- |
| Step 3 | 4.6–5.4 s | 10.1–11.5 / 3.7–3.9 | 12.2–12.9 / 4.1–4.3 | 12.2–15.4 / 6.9–8.2 | 19.9–21.3 / 12.3–13.9 |
| Step 4 | 4.7 s | 10.2–10.8 / 3.6–4.1 | 12.1–13.3 / 3.7–4.3 | 14.5 / 6.9–7.5 | 20.2–20.3 / 12.2–12.8 |

No change in frame time, as expected. Load over localhost doesn't change either: the gain is the
smaller download and compiling while downloading, which only a real connection shows.

Note: three.js's own Basis transcoder also lands in `dist/assets` (its KTX2Loader names it), but
it's never downloaded: the game points the loader at `public/basis`.

## 2026-11-18: Entry 125, performance step 5: checked, and left as it is

- **AO and bloom at half resolution:** both already were. N8AO runs with `halfRes`, and the
  bloom effect's resolution scale defaults to 0.5 (with mip-map blur on top).
- **Cheaper AO on High** ('performance' instead of 'medium'): measured side by side, High was
  17.0 and 19.1 ms against 17.8 and 17.0 ms before, so no clear saving. Reverted, as it's
  visibly noisier.
- **Merging layers that share a material:** after steps 1–3, High's 476 draw calls are mostly one
  per map square in view per material (street edges 83, buildings 53, house kit 44, shops 41).
  Merging squares would lose per-square culling; merging the house kit's layers would draw their
  near-only detail at every distance. The dark store's 18 calls are one building, rarely on screen.
  None was worth it with the CPU now well inside its budget.

**The machine drifts.** These runs came out 2–3× slower for both builds than an hour earlier
(High at 4× CPU: 46–55 ms here, 20 ms in step 4's runs). Every comparison in this pass is made
side by side with the previous commit for this reason. My own browser tab running the game in
the background also skewed one set of runs; it's closed during benchmarks now.

## 2026-11-18: Entry 126, variety: tree species, placed by where they grow

### What I did
`treeSpecies.ts` lists HSR's trees: rain tree, gulmohar, jacaranda, pink and yellow tabebuia,
copper pod, neem, ashoka, coconut palm, banyan and peepal. Each has a canopy shape, a size range,
its own green or flower colour (and the share in flower), and a lean range. `plantTree` makes one
from a seed, so each tree gets its own size, turn, lean and shade, the same on every visit.

- **Avenues** are still planted a species per road (by the road's name), now from the species list.
- **Parks** get a mix.
- **Context trees**: a coconut palm, ashoka or neem behind about a third of compound gates; a
  peepal or banyan beside each temple; a rain tree or banyan on a corner of one junction in five.
- **New shapes** (foliage.ts): umbrella (rain tree, gulmohar), column (ashoka), dome (banyan,
  peepal), on Low as solid balls and on Medium/High as leaf cards like the others. The palm has
  its own bowed trunk and a vertex-coloured crown of 14 arching fronds (about 300 triangles,
  two-sided), the same on every quality.
- **Lean**: instanced trees are turned in YXZ order, so the lean tips them sideways and the turn
  points that lean any way round. Trunk and canopy share it, so the canopy stays on its trunk.

### Why
Three shapes in four greens made every street look alike. Species placed by context also tell
you where you are: palms mean houses, a huge dome means a temple.

### Lesson 244: check a colour under the material, not as a swatch
Copper pod's `#d99a22` looked like a fine gold as hex, but the leaf photo multiplies it down, and
on screen the tree looked dead and autumnal. Flower tints must be lighter than the colour you
want, since the texture darkens them. Check in the game, under the day's light, before choosing.

### Frame time (24th Main, side by side with the previous build, synced / CPU ms)
Low 10.6–12.2 / 4.3–5.6 vs 11.4–11.7 / 4.2–5.7; High 15.6–16.0 / 6.2–7.5 vs 15.3–16.3 / 6.2–6.8.
No measurable cost (five more draw calls for the new shapes and palms).

### Try it
Ride off 24th Main into the houses: palms behind gates. Find a temple for its peepal.

## 2026-11-18: Entry 127, variety: the building kit, and schools and hospitals

### What I did
Each house now picks from a kit by a seeded roll of its id (`chooseStyle` in houseKit.ts), with
a hash of its own, so nothing that was already placed moved:

- **Roofs:** the flat terrace with parapet, stair room and tanks (as before); about a third of
  terraces also get a **sheet-metal shed** on posts, blue, grey, teal or sand, placed wherever it
  fits clear of the stair room. Small (≤ 180 m²), near-rectangular houses of one or two floors
  get a **Mangalore tile roof** about a third of the time: two slopes at 24°, past the walls by
  45 cm, laid in courses of two tones, with a ridge cap and gable ends in the house's paint.
- **Outside stair:** two in five houses of two floors or more get a stair up an open side wall
  to the first floor, with a landing, a door and a stepped parapet. The compound wall widens on
  that side to take it in, and the stair is solid to the scooter.
- **Balconies:** two in five have a metal grille on a low kerb instead of a solid parapet (the
  bars show from Medium up).
- **Elevation tiles:** about a third of house fronts get a strip of slate, sandstone, brick tile
  or pale ceramic up one end, in courses, clamped so it never covers a painted window.
- **Schools and hospitals:** civic buildings now keep what the map says they are (`civicUse`, from
  their own tags, a school or hospital mapped beside them, or the grounds they stand in). Both get
  a porch on pillars over the way in and a parapet. A school gets a compound wall painted in
  yellow, blue and white blocks with a wide open gate; a hospital a red cross on a white board on
  its roof. No names on either, so nothing real is copied.

Already in the game before this: shop ground floors, stilt parking, gates with gardens and
kolams, real heights from Overture/OSM, temples, petrol pumps, blocks of flats and glass offices.
Not done: more painted window styles (the facade textures are one per look).

### Why
Every house had the same roof, balcony and front. Now one street has tile roofs beside
terraces, outside stairs and tiled fronts, as HSR's mix of old and new houses does.

### Lesson 245: a new kind of thing needs its own random numbers
The house kit picks everything from one hash of the building's id, a few bits at a time. Taking
bits from that same hash for the new choices would have moved every existing kolam, creeper
and tank. A second hash (`hashString(id + '/roof')` and so on) adds choices without changing
any old ones.

### Frame time (synced / CPU ms, side by side with step 6a)
24th Main: High 15.3–15.4 / 6.3–6.4 vs 15.1–15.3 / 6.5–6.6. 13th Cross: High 15.1–15.6 /
7.1–7.5 vs 15.1–15.8 / 7.2–7.7. No measurable cost: it's all in the existing per-square
house-kit meshes, so no new draw calls.

### Try it
`?spawn=residential-street`: tile roofs, outside stairs and grille balconies along 13th Cross.

## 2026-11-18: Entry 128, the reviewer's regression: stutters at the start of riding, and load

### What the reviewer saw
On Sarjapur Road, 2× Retina, High: 55–68 FPS (about 120 the night before), 35 frames over 20 ms in
6 s, worst about 40 ms; 13–16 s to ride (about 7 s before).

### What I measured first
`scripts/bench.mjs --ride` (new): rides forward and records what a player sees, frame intervals,
frames over 20 ms, the worst, and whether a shader compiled in a long frame. `--dpr 2` emulates a
sharp screen, `--profile-load` profiles loading and the first seconds of riding. Last night's
`main` (c3d2d71) against this pass, side by side, and in my own Chrome on the Retina screen:

- **No shader compiles while riding**, in either build: the count of GPU programs doesn't
  change after loading, traffic's first appearance included (WarmAssets already prepares them).
- **Pixel ratio:** High already tops out at 1.5 in total, under the cap of 2 asked for.
- **Traffic:** High still has 40 vehicles; Low went from 16 to 10 in step 2. Both are per preset.
- **The production build was already faster** than last night's (88–89 FPS against 60–73),
  and loading the same. The dev server had the regression the reviewer saw, and its first load
  after the pull also re-optimises dependencies (Vite: "vite config has changed").
- **Run-to-run noise on this Mac was bigger than any difference between builds.** Last night's
  build gave 84 FPS once and 55 FPS with 25.5 s to ride another time.

### What was actually wrong, and the fixes
1. **The first seconds of riding were a run of long frames:** squares of the world round the
   rider were still being built, and a missing square nearby could take 40–60 ms of a frame.
   The ride now waits behind the loading screen until they're built (each streamed part reports
   it, `nearWaiting` in launch.ts, with a 4 s limit), and once riding, nearby squares get 8 ms a
   frame (`NEAR_BUDGET`).
2. **A house kit square was slow to build**, more so with step 6's kit: `Int8Array.from(list,
   fn)` (a callback per number through the iterator protocol) and 24 new vectors per `box`. Both
   are now plain loops into reused memory.
3. **Ground heights were looked up again on every refresh** for every tree, lamp and tank, all in
   one frame. They're worked out once per prop now.
4. **Load:** `isNearBuilding` checks each footprint's box before measuring its outline (the
   same answers, without measuring nearly every building in the cell), and the house kit's
   planning pass skips the drawing maths it never used.

### Before and after (my Chrome, Retina, High, Sarjapur Road, 8 s ride from the moment the screen clears)

| | Ride starts | Planning | FPS | Frames over 20 ms | Worst |
| --- | --- | --- | --- | --- | --- |
| Last night's build | 9.4–10.6 s | 6.1–6.9 s | 60 | 33–49 | 83–100 ms |
| Before these fixes | 10.0 s | 5.4 s | 65 | 36 | 83 ms |
| After | 8.3 s | 5.1 s | 68 | 21 | 26 ms |

The frames still over 20 ms after the fixes are single missed refreshes on the 120 Hz screen
(25 ms), not hitches. Planning in the benchmark Chrome: 5.1 s → 3.9 s (house kit 1.42 → 0.82 s,
traffic lanes 0.55 → 0.27 s).

### Lesson 246: measure the way the player plays
My benchmark stood still at a locked resolution on a 1×, 60 Hz window, so it never saw the
squares built as you ride, or the first seconds after the loading screen. The reviewer rode off
at once. A benchmark has to ride, from the first frame, on the player's screen.

### Try it
`node --experimental-websocket scripts/bench.mjs --ride --dpr 2 --streets main-road`

## 2026-11-18: Entry 129, duty modes: free roam, going online, shifts and days

### What I did
The game is free-roam now; delivering is optional (`src/game/duty.ts`, `src/ui/DutyUi.tsx`).

- **Off duty** after loading: ride anywhere, no orders, no clock. A badge says "Off duty · O to
  go online", and the phone's sheet has a Go online button.
- **Online** (O, or the phone): the dispatcher offers orders now and then. An offer card shows
  the item, customer, route, kind and rough pay, with a 15 s bar. **Y accepts, X declines**;
  one left to run out counts as declined. The last 20 answers make an **acceptance rate** (on
  the phone); below 60% offers come about a third slower and Ravi says so.
- **Going offline mid-order** asks: finish it first (offline after the delivery), or cancel it
  (−40 credits, and it counts as a 1★ rating), or stay online.
- **Time of day** (morning, lunch rush, evening rush, night) sets pay (+20% at lunch, +15% in
  the evening, shown as its own line on the delivery card), how often offers come, how often
  they're rushes or double drops, what's ordered (gym shorts in the morning, party dresses in the
  evening), and how much **traffic** is out (night 45%, evening 100% of the quality preset's
  count). Traffic never goes above the preset; vehicles are only held back when they'd respawn,
  out of sight.
- **Shift goal** (optional): one per shift, chosen for the time and level: earn N credits, N
  orders before a time, 3 five-star deliveries, or 4 with no crashes. Met, it pays a bonus.
- **Shift summary** on going offline: deliveries (and cancellations), earnings, tips, average
  rating, distance, time online (real and on the game clock), the goal, and the best moment
  (the biggest tip, the earliest arrival, or a spotless 5★ ride).
- **Home and days:** home is the gate of the family house nearest the start, with a soft blue
  ring nearby when off duty. Stopped there, **Z sleeps** until 7 am: the screen fades, the day
  counter moves on and everything is saved (the day and acceptance answers are saved now too).

### Why
Delivering every minute made the city a route between markers. Off duty, it's a place to ride
around; online is a choice, with time of day giving each shift its own feel.

### Lesson 247: a "ready" check can hide an assumption
The loading screen waited for `mission !== null`, which meant "the planner is ready" only
because a mission used to be planned the moment it was. Once missions waited for going online,
loading never finished. It now waits for the planner itself.

### Try it
Load, press O, accept with Y. Press O mid-order to see the choice. Ride home and press Z.

## 2026-11-18: Entry 130, customer chat on the HUD

### What I did
While online, compact chat bubbles on the right of the HUD (`src/ui/ChatBubbles.tsx`), the last
four, each fading after nine seconds, so the phone needn't be raised to keep up:

- **The customer** writes their order note when it's accepted, a word on pickup, then gets more
  pointed as the on-time limit runs down: at half of it, three quarters, when it's late, and when
  it's very late (1.5×). Event orders worry about the function; lines live in
  `src/missions/customerChat.ts` (made-up people, English with some Kannada and Hindi).
- **Ravi** at dispatch posts the assignment, and his usual messages (shift goal done, low
  acceptance) appear as bubbles while online. Off duty there's no chat; his toast shows as before.

Customer bubbles are light with their name in red, Ravi's dark with his in green, so they're
told apart at a glance.

### Why
The timer alone is abstract. A customer asking "where have you reached?" makes the same minutes
feel like someone waiting.

### Try it
Go online, accept an order, and ride slowly: the customer's messages change as the clock runs.

## 2026-11-18: Entry 131, the customer's frustration

### What I did
Each order has a frustration meter, 0 (happy) to 1 (they cancel), rules in
`src/missions/customerChat.ts`:

- **Time:** nothing until half the on-time limit is used, then 0.6 per share of the limit up to
  it and 1.2 per share past it (×1.3 for event orders). Worked out from the share used each
  time, not added up frame by frame, so it can't drift.
- **Rough riding with the parcel on board:** +0.15 a crash, +0.04 a hard landing on a pothole or
  breaker (+0.08 if fragile). Crashes on the way to the pickup don't count: the customer can't
  tell.
- **Effects:** the stars come from it (5 under 0.22, then one fewer per 0.22), the tip shrinks
  by up to half, and the rating card still says what caused it (late, crashes, bumps). At 0.85
  the customer warns they'll cancel; at 1 they **cancel**: no pay, it counts as a 1★ rating,
  and Ravi and the customer both say so.
- **On screen:** a small meter on the right ("Divya · Annoyed", green to red) while their order
  is on, the same on the phone, and chat lines for a crash, a bump on something fragile, and the
  last warning.

Also fixed: a chat bubble pushed out of the last four by newer ones could come back after they
faded, as its fade timer had stopped when it left the screen. Bubbles now fade by their age.

### Why
Stars used to be a list of penalties added up at the end. Now the rider can watch the customer's
patience go and make it up by riding carefully or fast, and a really bad trip can be lost.

### Try it
Accept an order and crash a few times with it on board: the meter climbs, the customer writes.

## 2026-11-18: Entry 132, kerbside parking

### What I did
Most parked vehicles now stand along the kerb (`src/world/streetParking.ts`), as in HSR:

- **Cars and bikes parallel to the road edge**, on the road. Cars in slots of 5.2 m, bikes in
  rows of two to four; three car models (hatchback, sedan, SUV). Shop streets are the fullest,
  then residential streets and main roads. None near junctions (14 m), in front of gates, on a
  petrol bunk's forecourt, or where the ride starts. Streets under 5 m (service lanes, tracks)
  aren't parked on; under 7 m, only one side is, chosen per road.
- **A few bikes stay on the footpath** outside shops (3 shops in 10, one or two each), still
  loose, so they can be knocked over.
- **Solid:** each car is a wall as wide as itself, each kerb bike a post, added after the
  traffic lanes are built so they don't count as blocking them.
- **Traffic eases out around them.** Each lane knows where something is parked at its kerb and
  how far it pokes in (`markParkedOnLanes`); a vehicle there keeps its own side clear of it
  (`parkedLimit` in trafficLogic.ts), pulling towards or over the middle of a narrow street, and
  the existing overlap guard makes it wait for oncoming traffic. Two-wheelers and autos keep
  squeezing as before, never further left than that. Checked: 6,286 samples of moving traffic
  over 20 s on 13th Cross, none inside anything solid, 830 eased out round parked vehicles.

### Performance
4,356 cars and 11,501 bikes in all. The first try had 10,852 cars and 25,559 loose bikes, and
two all-pairs loops (spots against every junction and gate; parked vehicles against every
lane) took 15 s each at load. Now: grids for both (about 60 ms in all), kerb bikes are static
instances (loose bodies cost a little every frame each), and parked meshes upload only the slots
they use. Riding, side by side with the previous commit: frame work 6.9–9.0 ms against
8.3–10.8 ms, load 9.7–11.1 s against 9.8–10.7 s.

### Lesson 248: count before you build
"Along every kerb" is tens of thousands of things on a whole map. Logging the counts on the load
timeline (`street parking: N cars, N bikes`) showed it at once; the fix was in the numbers.

### Try it
`?spawn=residential-street`: cars along one kerb, bikes along the other, traffic pulling out
round them.

## 2026-11-18: Entry 133, breakers taken slowly aren't bumps

### What I did
A hard landing (off a speed breaker or into a pothole) only counts as a bump above half the
scooter's top speed (`bumpSpeedShare` in vehicleConfig.ts): 28 km/h on the stock engine, more
with engine upgrades. Below that there's no bump: no thud, no camera jolt, no lost speed, no
"Bump!" notice, and a fragile order's customer doesn't mind. The fragile hint now says "below
half speed".

### Why
It counted by how far the wheel dropped, not how fast the scooter was going, so easing over a
breaker at walking pace still upset the customer. Slowing for breakers is what a careful rider
does, and the game now rewards it.

### Try it
Accept a fragile order and roll over a breaker slowly: nothing. Take it fast: "Bump!".

## 2026-11-18: Entry 134, customers cancel at three times the timer

### What I did
Only time makes a customer cancel now, and only at **3× the timer shown to the rider** (a 2:31
timer cancels at about 7:33). Frustration from time is 0 until half the timer is used, 0.3 when it
runs out (0.45 for event orders), then climbs evenly to 1 at 3×. The customer warns ("last
chance") at 2.5×. Rough riding still adds frustration, costing stars and tip, but can't take it
past 0.95 before the cancel time, so a crash or two never makes anyone cancel.

Stars by time alone: 5–4★ within the timer, 3★ around 1.5–2×, 2★ by 2.5×, 1★ just before 3×.

### Why
The customer cancelled at about 1.6× the timer, sooner if the ride was rough, which was too quick
and too easily triggered by things they couldn't see. Three times the promised time is when a
real customer gives up.

## 2026-11-18: Entry 135, the customer can't see the ride

### What I did
- **Mood is the wait alone.** The frustration meter and the cancellation follow the timer only:
  all a real customer has is the app's map and estimate.
- **Rough riding shows at the door.** Crashes and hard landings with the order on board add up
  as the parcel's condition (`roughness`), and at the handover it costs stars and tip: a star
  per crash, or per two hard landings for something fragile (four otherwise), up to three
  stars; the tip shrinks by up to half. The customer says what they see ("The box is all
  dented!"), and the rating card still lists the crashes and bumps.
- **No live chat about crashes or bumps** ("Did you just fall??" is gone): they couldn't know.

### Why
A customer reacting the instant you crashed broke the illusion. Now the ride still matters,
but it comes back to you when you hand the parcel over, as it would.

## 2026-11-18: Entry 136, a round minimap instead of the phone's map

### What I did
The map has left the phone. A round **minimap** sits bottom-left (`src/ui/Minimap.tsx`),
centred on the rider and turned so ahead is up: roads, buildings, street names, the route, the
stop (or a waypoint), the street being ridden, and the distance by road. It's 140 px off duty
and grows to 190 px online, a little more zoomed in. Clicking it will open the full map (next
entry). Off-map stops sit on the rim with an arrow, as on the phone, but clamped to the circle.

The drawing code moved to `src/ui/mapDrawing.ts`, shared with the full map. Waypoints are new
in the store: the route tracking leads to one when there's no order, and clears it on arrival.
The phone now sits right of the minimap.

### Try it
Go online and accept: the route and pickup marker appear on the minimap.

## 2026-11-18: Entry 137, the full map

### What I did
**Tab**, or clicking the minimap, opens the full map over the game (`src/ui/FullMap.tsx`): all of
HSR north up, with street names, the rider's arrow, the route, the stop, home and every dark
store. Scroll to zoom about the pointer, drag to move. With no order on, **a click sets a
waypoint** at the nearest road point: the route and minimap lead there, and it clears on
arrival, or with "Clear waypoint". Tab, Esc or the Close button shuts it. The game keeps running
underneath. M is still the weather.

### Try it
Off duty, press Tab, click somewhere across town, close the map and follow the blue route.

## 2026-11-18: Entry 138, order offers at the bottom centre

### What I did
The order offer is a compact card bottom centre, just above the rider: the item, the customer,
the whole trip by road (store and drop-off), the pay, Y to accept and X to decline, with a ring
counting down the 15 s (it turns red in the last five). It arrives with a soft rising ping and a
short green pulse, and pings again at 5 s left. Pings are synthesized tones on the effects bus
(`src/audio/uiSounds.ts`), so there are no sound files to load. Missions now carry their trip
length (`routeLength`).

### Why
Top right was out of the way of the road, which is where the rider is looking.

## 2026-11-18: Entry 139, top centre: arrow, timer, distance, mood

### What I did
Top centre holds only the way: the order's timer (amber in the last 20 s, red with "+0:23"
once late) with the customer's mood bar under it, the direction arrow in the middle (in the
stop's colour, or the waypoint's), and the distance by road on the right. The mood meter that
sat top right and the copy on the phone are gone: there's one, beside the timer it follows.

## 2026-11-18: Entry 140, the phone holds the conversation

### What I did
- **The phone (P)** has five screens: Order (the order, or going online), Chats (the current
  customer's thread and Ravi's), Music (the radio), Career (the career and today's goals), and
  Settings (quality, music, sound effects, keys).
- **Away, it's hidden** below the screen, but for a small "Phone · P" tab with an unread count.
- **Peeks:** a new message slides the phone's top up for 3 s with who it's from and the first
  line, and a soft ping; clicking it opens the chats. Urgent ones (the customer's late, very
  late, about to cancel, or cancelled) stay 6 s, with a red edge and a sharper, lower sound. A
  new station peeks "Now playing". Nothing peeks while the phone is up.
- The chat bubbles on the HUD and Ravi's toast are gone: the phone and its peeks replace them.
  The small quality picker stays top right.

### Why
The HUD had grown a message stack, a toast, an order card and a mood box. Now the screen is the
road, the minimap and the way to go; the phone is where you read, and it tells you when to.

## 2026-11-18: Entry 141, the order clock starts after a grace period

### What I did
An accepted order's clock now starts 10 s after accepting (`graceSeconds`), whether the rider has
moved or not. Before, it stayed frozen until the scooter moved, so waiting at the kerb cost
nothing. The top timer shows the full time with "starts in 7" during the grace.

### Try it
Accept an order and don't move: the grace counts down, then the clock runs.

## 2026-11-18: Entry 142, a slower clock while online

### What I did
Online, the game clock runs at a quarter of its speed (`ONLINE_CLOCK_SCALE`): about five real
minutes per game hour, against 75 s off duty. A twenty-minute shift is now about four game
hours, and the lunch rush lasts most of half an hour, so each period has time to feel like
itself. The weather keeps its own pace. Shift goals against the clock give two game hours
(about ten real minutes) instead of five. The shift summary shows time online in real minutes
only; game-clock durations are gone.

### Why
At full speed a single shift swept through most of a day, lunch rush and all, in a few minutes.

## 2026-11-18: Entry 143, fuming customers cancel, and each has their own patience

### What I did
- **45 s of fuming, then they cancel.** Once a customer's mood reaches Fuming (frustration 0.7)
  they warn ("Last chance…"), the mood bar counts down ("cancels in 30s"), and after 45 s of it
  they cancel. Ravi says so, and the cancel penalty applies: −40 credits and a 1★ rating. This
  replaces the cancellation at three times the timer.
- **Patience by personality.** Each made-up customer has a patience: Lakshmi aunty (1.45) and
  Suresh uncle (1.35) wait the longest, Joseph and Manju are easy-going, Vikram (0.7) and Rahul
  (0.75) the least patient. Patience stretches the timer as they feel it, so an impatient
  customer turns Fuming sooner after the timer runs out. For a customer of usual patience, Fuming
  arrives at about 2.1× the timer; for Vikram about 1.5×; for Lakshmi aunty about 3.1×.

## 2026-11-18: Entry 144, one welcome and one goal per shift

### What I did
Going online posted Ravi's welcome and the shift goal once each time, but his messages are saved,
so every shift's welcome and goal stayed in his thread: after a few shifts it read like the same
messages over and over. These lines are now tagged, and going online replaces the last shift's
instead of adding to them (old saves' untagged copies are tidied up by their wording). The chat
picks out new messages by id, so a replaced one can't make it re-post older lines.

Checked: online, offline, online again leaves one welcome and one goal.

## 2026-11-18: Entry 145, the shift's best moment, always

### What I did
The shift summary always has a "Best moment" row now. Meeting the shift goal counts first, then
the best delivery (the biggest tip, the earliest arrival, or a spotless 5★ ride); with nothing
outstanding, the deliveries done, the distance ridden, or a word that it was a quiet one. Before,
it only appeared when a delivery scored one, so most short shifts showed nothing.

### Performance, this pass (Entries 136–145)
Riding Sarjapur Road at an emulated 2× screen on High, side by side with the build before the
HUD rework: 60 FPS both, frame work 3.6–3.8 / 4.5–4.9 ms (mean / p95) against 3.3–3.5 /
4.3–4.8 ms, time to ride 4.7–5.2 s against 4.8–5.5 s. The minimap redraws at most 30 times a
second, as the phone's map did; the full map draws only while open.

## 2026-11-18: Entry 146, the full map fills its panel

### What I did
The full map always fills its panel now. Its furthest zoom is where HSR just covers the panel
(it was where HSR just fitted inside it, leaving the rest empty), and the view is kept on the
map: centred on the rider where it can be, never so near an edge that empty ground shows beyond
it. Scroll to zoom about the pointer and drag to move, both within those limits.

## 2026-11-18: Entry 147, one goal system: the shift goal, plus quiet daily challenges

### What I did
There were two: the old daily "shift" (three goals for the calendar day, announced by Ravi on
every new day: "Three goals. All the best!", which could arrive alongside the new shift goal)
and the optional shift goal set on going online. The shift goal stays as the one Ravi talks
about. The old three are now **daily challenges**: shown quietly in the phone, never announced,
and Ravi only speaks when all three are done ("Daily challenges done! +N credits"), with the same
bonus and streak as before. Old saves' "Three goals" messages are cleared when the game starts.
Teaching moves to the tutorial (Entry 150).

## 2026-11-18: Entry 148, the phone as a phone

### What I did
The phone's tabs are gone. It works like a phone now (`src/ui/Phone.tsx` for the phone itself,
`src/ui/phoneApps.tsx` for its apps):

- **Lock screen** when it comes up (P): a big clock, the day and weather, and the notifications
  since it was last unlocked; click one to open its chat, or click anywhere (or Enter) to unlock.
- **Home screen** on a dusk-over-HSR wallpaper: eight app icons, with **badges** for unread
  messages, an order offer, and being at the dark store.
- **Status bar**: time, weather, signal, 4G, and a battery that drains about 4% a game hour from
  7 am and is full again after sleeping.
- **Banners** at the top of the open phone for new messages (not for the chat that's open).
- **Back**: Esc goes from a chat to Messages, from an app to the home screen, and from there
  puts the phone away; the bar at the bottom goes home. A handover still raises it straight
  into Deliver It.
- **Apps:**
  - Deliver It: going online, the order or offer, rating, shift pay, daily challenges, career,
    and the last twelve deliveries.
  - Messages: a thread for Ravi and one per customer, with unread counts.
  - Maps: the full map, and saved places (home, the nearest dark stores, the five nearest chai
    stalls by street) that set a waypoint when no order is on.
  - Radio.
  - Wallet: the balance, today's earnings, tips and expenses, and recent lines. A new ledger
    records deliveries, tips, bonuses, cancellations and purchases.
  - Garage: look anywhere; buying works only stopped at the dark store.
  - Camera: photo mode. The game pauses (R3F's clock stops, so every frame's delta is 0), the
    HUD hides, W A S D, Q/E and drag fly the camera, scroll zooms, and Space saves a PNG. Esc
    returns, and an order offer gets back the time it was paused.
  - Settings: controls, picture quality, sound, language (English; Kannada is listed as coming
    later), and the tutorial.

## 2026-11-18: Entry 149, starting at home in central HSR

### What I did
- **First play starts at home** (`src/world/homeStart.ts`): the family house on the west arm of
  16th Cross Road in Sector 2, a quiet residential street just off 27th Main Road. The rider
  starts in the street outside its gate, facing along it towards 27th Main and its shops. The
  play area ends about 180 m east of 27th Main, so home is on the west side, looking east at the
  shops across the junction: no wall, no map edge.
- **The main dark store is on 27th Main**, 60 m away: the shop front nearest a spot on 27th Main
  in Sector 2 (`MAIN_STORE_NEAR`), so the tutorial's first ride is a short one. The other stores
  are placed from it, where streets are out of reach, as before (two more are 1.4–1.5 km away).
- **Returning players start where they last were**: the position is saved every 3 s (not
  mid-crash), and sleeping resets it to home. `?spawn=` still overrides it for testing, and
  `?tutorial=1` always starts at home.
- Up close, the home marker's pointer hides; the ring stays.

## 2026-11-18: Entry 150, keys: changeable, and a help overlay

### What I did
- **Every key is changeable** (`src/game/keyBindings.ts`). Each action (riding, drift, nitro,
  horn, online, accept, decline, sleep, phone, map, radio, skip time, weather, help) has its
  keys, saved apart from progress. Every handler asks the bindings instead of a fixed key.
  Enter and Esc stay fixed: the phone's unlock and the back key everywhere.
- **Controls in Settings**: click an action's key, press the new one. The press is caught
  before the game sees it (binding O doesn't also send you online), and a key given to one
  action is taken from any other. Esc cancels; "Reset to the default keys" restores them.
- **Help overlay**: F1 or ? lists every key by group, over the game.
- The permanent key list along the bottom of the screen is gone. Everywhere the UI names a key
  (the off-duty badge, the offer card, the home prompt, the phone's tab, the maps) it shows the
  current binding.

Checked: phone moved to K opens and closes the phone and P does nothing; reset brings P back.

## 2026-11-18: Entry 151, the tutorial

### What I did
- **When it runs** (`src/game/tutorial.ts`): on first play when no `tutorialDone` flag is saved.
  Returning players skip it: a save from before the tutorial existed, with progress in it,
  counts as done. `?tutorial=1` forces it, and Settings → Replay the tutorial runs it again.
  For a new rider it replaces the career's welcome, so there's one greeting, not two.
- **How it teaches** (`src/ui/Tutorial.tsx`): Ravi introduces each step in chat (peeking the
  phone), and a card top-left says what to do in the keys as currently set, with **Skip step**
  and **Skip tutorial** at every step. Each step finishes when the rider has done it:
  1. ride and steer;
  2. take a speed breaker slowly (the scooter now counts gentle landings; a hard one gets "Too
     fast, maga!"; with no breaker in a minute, a firm stop from speed will do);
  3. open the phone and go online in Deliver It (O works too);
  4. accept the first order, which comes at once and waits for an answer;
  5. follow the arrow and minimap to the dark store on 27th Main, a short ride from home;
  6. open the full map;
  7. deliver, and see the rating and tip;
  8. optionally, two of drift, nitro, horn and radio;
  9. go offline and see the shift summary.
- The career's welcome no longer says an order is waiting, as in free roam it isn't.

Checked end to end with `?tutorial=1`: every step advances, Skip works, and `tutorialDone` is
saved at the end. A speed breaker sits just ahead of the start, so step 2 is right there.

### Performance, this pass (Entries 146–151)
Riding Sarjapur Road at an emulated 2× screen on High, side by side with `main`: 60 FPS both, no
frames over 20 ms, frame work 3.4–3.9 / 4.1–4.8 ms (mean / p95) against 3.6–3.9 / 4.8 ms, time
to ride 4.8–4.9 s against 5.3–5.4 s. The phone's apps draw only while open; photo mode costs
nothing until used; the tutorial checks a few values five times a second.

## 2026-11-18: Entry 152, the phone half open on the right

### What I did
The phone lives bottom-right now and is never fully hidden. Away, it's slid down so its top
150 px show: the status bar (with the unread count beside the time) and the lock screen's clock.
New messages appear as a banner across that strip, with a red glow round the phone when urgent,
so the separate peek card and the "Phone · P" tab are gone. Hovering lifts it a touch; a click
(or P) raises it to the lock screen, and a click on a banner opens that chat. To make room, the
speedometer moved beside the minimap, a music video sits above the phone, and the map credits
moved left of it.

## 2026-11-18: Entry 153, notifications in the air above the phone

### What I did
With the phone half open, new messages float above it, outside its frame: up to three cards,
newest nearest the phone. Each rises out of it, hangs for 3 s (6 s with a red edge for urgent
ones, 2.5 s for "Now playing") and drifts up as it fades; a click opens its chat. They sit above
a music video if one is showing. The strip of phone below stays a clean clock with the unread
count; the open phone still shows a banner inside, as there's no room above it.

Also fixed: one message could notify twice. A chat line added from inside another store
update was seen again when that outer update's listeners ran with the latest state, so
comparing with `previous` wasn't enough. The phone now keeps the highest chat and message id it
has shown, and shows only what's above it.

## 2026-11-18: Entry 154, a phone that looks like a phone

### What was breaking
- In the apps, cards sat in a grid whose items couldn't shrink below their longest unbroken
  line, so the order card ran off the right of the screen (the timer, "85 credits", the bonuses
  cut off). Grid columns are `minmax(0, 1fr)` now and long words wrap.
- Lists in the phone kept the browser's 40 px indent (`ul` wasn't reset, only `ol` and `dl`),
  pushing the lock-screen notifications and the home-screen icons off the right edge.
- Half open, the screen's content wasn't stretched to its height, so the wallpaper covered only
  a strip and the clock sat on black.
- The home bar covered the last line of an app; apps now leave room above it.

### What it looks like now
A modern handset of about 19.5:9 (300 × 650 px, less on short windows): a thin even bezel, a
brushed-metal edge with power and volume buttons, a "dynamic island", and a status bar with the
time on the left and signal, 4G and battery on the right. The lock screen has the day and
weather over a large thin clock, frosted notification cards, and torch and camera buttons. The
home screen has an icon grid, page dots and a frosted dock with Deliver It, Messages, Maps and
Radio. Apps have a "‹ Home" link over a large title and grouped cards, and chat threads open at
the newest message.

## 2026-11-18: Entry 155, one ground map for the whole city

### What I did
`src/world/surfaceMap.ts` draws one map of what the ground is, a metre to a cell over the whole
play area (11 MB, about 160 ms at load): road, median, footpath, paved ground, building, park,
empty plot, or open ground. It comes from the road geometry with each street's footpath and
median widths, the gap between the two halves of a dual carriageway (a median), the building
footprints, OSM's land-use tags (fuel, parking, school yards and markets paved; parks, gardens,
pitches, grass and cemeteries park; construction land a plot), petrol forecourts and building
sites. Drawn in priority order, so a road always wins and a footpath over a park is a footpath.

Every placement now asks it first (`surfaceAllows`), by what's being placed:

| Thing | Allowed on |
| --- | --- |
| grass | open ground, medians, parks, plots (sparse weeds) |
| trees | open ground, medians, footpaths (tree pits), parks |
| poles | footpaths, medians, open ground, paved |
| props (carts, signs) | footpaths, open ground, paved, parks, plots |
| benches | parks, footpaths |
| a bike on the footpath | footpaths, paved |
| parked vehicles | road (the kerb rule: next entry) |
| buildings, fences | entries after that |

The grass reads it as its mask (a one-byte data texture now, not a canvas), so no tufts grow on
petrol forecourts, parking or school yards any more; before, the forecourt wasn't on the mask.
The roadside trees and lamps, footpath scooters, park trees and benches, context trees, and
street-life carts and signs all check it. Refusals are counted for the debug report.

Also: `?spawn=petrol-pump` starts at the bunk nearest the middle of the map, facing its canopy,
and `scripts/shots.mjs` takes the same screenshots every time for before/after comparisons.

## 2026-11-18: Entry 156, parked vehicles only at the outer kerb

### What I did
`planStreetParking` now asks the surface map before parking a car or a row of bikes. The whole
footprint must be on drawn road, there must be footpath (not more road or a median) just beyond
the kerb, and the road being parked on must be the nearest one there. So nothing parks beside a
median, on the inner edge of a dual carriageway, across a side road's mouth, or on a road that
overlaps another. Junctions and gates were already kept clear.

Street parking went from 4,356 cars and 11,501 bikes to 3,501 cars and 8,087 bikes. Spots
refused: 3,999 for road or a median just beyond the kerb, 113 for a footprint off the road, and 4
for an overlapping road.

### Lesson: a grid answers in cells
My first count refused 7,541 spots as "off the road". A car's outer side sits 0.15 m from the
kerb, and on a 1 m grid that edge is in a cell whose centre is on the footpath. Checking a
footprint against a grid needs it inset by most of a cell (`CELL_SLACK = 0.75`). After the inset,
113 spots were refused for that reason.

## 2026-11-18: Entry 157, no building on a road or footpath

### What I did
`src/world/buildingSetback.ts` runs before anything looks at the buildings. Each footprint is
measured against every road near it, the road plus its street's footpath each side. A small
overlap (up to 30% of the footprint) is trimmed back to just behind the footpath, cut parallel
to the road piece, so it doesn't walk into its neighbour the way a shift would. A large overlap
leaves a smaller building on what's behind the footpath, if that piece is still house-sized (28
m², not a sliver). Otherwise the building goes, and a plot of 20 m² or more is walled in with a
gate facing the nearest road (`planTempleWalls` with `kind: 'wall'`).

Of 20,204 buildings: 11,421 were clear, 6,950 trimmed, 1,163 made smaller, 670 removed (238
plots walled). Most of the removals are small houses on 5 m residential lanes.

Each trimming round tries a cut against each of the three road pieces it overlaps most, on
either side, and keeps the one that leaves the most building. With only the most-overlapped
piece and the centroid's side, 29 large buildings were removed over a 7–30% overlap, among them
a block of flats on Sarjapur Road. With the best cut, 17 were removed, and 7 of those were
buildings the trim couldn't clear.

### Load time
2.56 s at first, measuring every footprint on a 1 m grid. Now 0.53 s: a footprint is first
checked only round its edge (a road can only reach in across the edge), road clearances are
looked up once, and only overlapping footprints get the full count.

Also: `scripts/shots.mjs` runs Chrome headless (`--windowed` to watch), because typing in
another window while it ran reached the game and rode the bike off, and it prints the load
timeline's report lines.

## 2026-11-18: Entry 158, closed boundaries that stop at the footpath

### What I did
`src/world/boundaries.ts` builds every boundary as a closed loop: temple compounds, plots
walled where a building was taken off the road (entry 157), school and college grounds (new),
parks, and the sides and back of each petrol bunk (new, with the front left open). The outline
is cut into panels. Each panel corner moves in, square to its side or along the bisector at a
corner so the sides still meet, until the surface map says it's off the road, median and
footpath. A corner that would have to move more than 8 m is where a road runs in, and the loop
stops there with a pillar. Where a road or path crosses the line the loop opens in a gate with a
pillar each side, and every loop gets at least one gate, on the side nearest a road. A panel
that runs into a building is left out, so the building's own wall closes the loop.

OSM's mapped walls and fences: pieces whose ends meet are joined into one line, a line whose
ends nearly meet is closed, a wall standing on the footpath moves straight back behind it, and
a mapped line along a loop that's already built is left out, so there's no double wall. Crash
barriers and road dividers stay at the road's edge as before.

This replaces `planParkFences`, `planMappedBarriers` and `planTempleWalls`, which dropped any
panel that was in the way and left half boundaries.

### Counts
367 loops, 12,330 panels, 327 gates, 1,084 openings where a road runs in, 4 for paths. 5,412
corners moved behind the footpath, 1,355 panels left out against a building. Mapped lines: 159
pieces joined into 151 lines; 531 points moved behind the footpath, 1,143 panels dropped as they
cross a road, 609 left out as duplicates of a loop, and 8,319 are outside the play area (most of
the barrier file is). No mapped line was near enough to closed to close. 59 ms at load.

### Lesson: a petrol bunk's front is its gate
The bunk's forecourt runs right up to the road, so moving its front corners in put two gate
pillars in the middle of the forecourt. A loop with an open front keeps its corners where they
are and counts the front as its way in.

## 2026-11-18: Entry 159, a debug view of the surface map

### What I did
With `?debug=1`, F8 colours the ground by the surface map (`src/dev/SurfaceDebug.tsx`): road,
median, footpath, paved, building, park, plot and open ground, each its own colour, with a faint
metre grid. Press once for the rider's view, twice for the view from 120 m straight above the
rider (north up), a third time to hide it. A panel lists the colours with each one's area, and
what the placement fixes did: buildings set back (entry 157), boundaries (158), parked vehicles
placed and refused (156), and every refusal by the surface map (trees, poles, footpath bikes,
benches, props).

`scripts/shots.mjs` takes `--press F8,F8` for keys before each shot and `--eval <js>` for a
script, so the same spots can be shot from above, with and without the overlay.

### Lesson: an overlay belongs on the ground
I first drew the overlay 0.35 m up, to sit over the raised footpaths, and it showed a median
across the asphalt of Sarjapur Road. From a rider's eye height, about 1.5 m, a plane 0.35 m up
lands about 30% further away than the ground it marks. Drawn just over the road, through
everything, and checked from above, the medians on the map are where the drawn medians are.

## 2026-11-18: Entry 160, a lower, closer camera

### What I did
The follow camera (`src/camera/FollowCamera.tsx`) sits 2 m up and 3.8 m behind (was 2.5 m and
5.2 m), looking at a point 7 m ahead at 1.5 m. Buildings and trees now rise over the frame,
and the road ahead takes less of it. The field of view starts at 64° (was 60°), so a close
camera still shows both sides of the street, and still widens with speed, by up to 10° (was 12°),
plus 6° on nitro. In a turn the camera rolls gently with the scooter's lean: 18% of it, at most
3.4°, and slower than the lean, so it sways rather than snaps. There's no roll in set shots or
while the rider is off the scooter.

### Lesson: the helmet and the vanishing point
At 1.8 m, about head height, the helmet sat right on the vanishing point and hid the road
ahead. At 2 m it's just under the horizon.

### Performance
Riding Sarjapur Road, measured back to back with a build from before the world pass on the
same machine: High 60 fps, no frames over 20 ms (before: 60, none). Low 54 fps with 7 frames
over 20 ms (before: 52 fps, 9). The Low hitches were there before; the machine was busier
than for the earlier baselines (the dev server and another game tab were open). The ride now
starts 0.5–0.9 s later than before the world pass, most of it the building setback (entry 157).

## 2026-11-18: Entry 161, golden hour, sun in the haze, warmer mornings, a stronger grade

### What I did
- **A first visit starts at golden hour.** With no saved progress (`isFirstVisit`, read before
  the store saves anything), the clock starts at 17:30 instead of 9:00. Through the evening's
  golden hour (16:45 to 18:24) the clock runs at half speed, so it lasts about two and a half
  real minutes rather than one.
- **The haze glows towards the sun** (`src/world/sunHaze.ts`): one pass over the picture, reading
  depth, before the tone mapping. Looking towards the sun the air glows with its light, more
  the further away what you see is, so the end of a street turns gold and trees and buildings
  stand dark against it. Every quality has it, Low too.
- **Sun shafts through leaves and between buildings** on Medium and High (`sunShafts` in
  qualitySettings.ts): postprocessing's `GodRays`, from a disc where the sun is that's never
  drawn itself (the pass draws it in a scene of its own), at half resolution with 48 samples.
- **Stronger warm haze**: 25% haze halfway to the draw distance (was 21%), and the haze's
  colour moves from the horizon's towards gold as it thickens.
- **Warmer mornings** (6:30 to 9:30): more of the warm sun colour, thicker haze, a warmer
  horizon, and the sky's fill, which lights the shade, moved 40% towards a warm white. A
  street in morning shade was a cool blue-grey; now it's neutral and warm.
- **The grade**: contrast 0.42 (was 0.3), and a touch of green added to the midtones
  (most at middle grey, none in black or white), so leaves and grass read alive under the warm
  light without greening the sky or the shadows. Still the one LUT over everything.

`scripts/bench.mjs` takes `--hour` (9 by default, as the old baselines), as a fresh profile is
now a first visit and would ride at 17:30.

### Lessons
- `getViewPosition` belongs to postprocessing's own depth materials, not to effect shaders. An
  effect rebuilds the view ray from its own inverse projection.
- A shafts disc added to the scene covered the sky's sun, which is brighter, and showed as a
  dark sun in a bright ring.

### Performance (riding Sarjapur Road, back to back with a build from before the world pass)
| | High work, ms | Low work, ms | FPS High / Low |
| --- | --- | --- | --- |
| 9:00, before | 4.8 | 3.5 | 60 / 54 |
| 9:00, now | 5.0 | 3.7 | 60 / 60 |
| 17:18, before | 5.1 | 4.3 | 60 / 60 |
| 17:18, now | 5.6 | 3.6 | 60 / 60 |

The shafts cost about half a millisecond on High with the sun low. The haze glow doesn't show
on Low.

## 2026-11-18: Entry 162, avenues of rain trees arching over the roads

### What I did
- **Arching avenues.** Residential and main roads are lined on both sides with big rain trees
  (three roads in four) or gulmohars, one every 13 m a side, the two sides staggered and a
  little jittered. Each stands in a pit on the footpath just behind the kerb (0.85 m out), turned
  to face the road with a little play, and leans into it by 3 to 7°. Its canopy is a new shape
  (`TREE_SHAPE.arch`, foliage.ts): a high spread reaching up to about 6 m out over the road,
  more on wide roads, so the rows from the two sides nearly meet over the middle. On a dual
  carriageway the trees on the inside edges stand on the median.
- **Median trees** on main roads' painted medians: neem, gulmohar and copper pod, every 15 m,
  none within 11 m of another road (where the median breaks for a junction).
- **A level of detail for trees.** Only trees within `leafyReach` (70 m on Medium, 90 m on
  High) get the leafy cards; past that, the solid canopies Low uses, out to the props' draw
  distance. It's hazy enough there that the change doesn't show.
- **Props by grid square.** Each instanced prop mesh (trees, lamps, tanks...) now refreshes from
  the 48 m squares within reach, not by walking every prop in the city.

20,959 avenue trees and 17 median trees: 27,969 trees in all (was 9,542). 17,092 arch spots
were refused, most for a gate, a lamp or a wall too close.

### Lessons
- The first arches stood 2 m past the kerb, and almost none were planted: houses and compound
  walls stand right behind the footpath on these streets. Real avenue trees stand in the
  footpath, at the kerb.
- A whole avenue of gulmohars in flower read as a rust-red tunnel. Three in four avenues are
  rain trees.
- At 11 m spacing, without the level of detail, High fell to 39 fps.

### Performance (Sarjapur Road, 9:00; the machine's load average was about 3)
High 60 fps, 4.5 to 5.0 ms of work a frame (5.0 before this entry). Low 60 fps, 4.4 ms (3.7
before: twice the trees in reach).

## 2026-11-18: Entry 163, grass over the red earth, hedges, pots, pocket parks

### What I did
- **Ground cover** (`src/world/groundCover.ts`): a cover map, a byte a metre, from the surface
  map. Parks are lawn, medians nearly so, open ground mostly covered, empty plots and building
  sites only a few weeds. Within 3 m of a footpath, forecourt or road, open ground is worn back
  towards bare earth, as it is where people walk. The soil shader lays sun-dried and green grass
  over the red earth in patches, as much as the map says, with darker clumps of weeds. It's a
  shader change, so Low has it too. Grass tufts on open ground are thicker (150 of 255, was 95).
- **Hedges** inside the front compound wall on 55% of houses with a yard, a bush every 1.5 m
  either side of the gate. **Shrubs** down main roads' medians every 4.5 m. One bush shape
  (`createBushGeometry`, foliage.ts): smaller leaf cards than a tree's, leafy within 45 m on
  Medium and High, solid beyond and on Low, none past 110 m.
- **Potted plants** on 40% of balconies and either side of the front door on 55% of houses
  (Medium and High, with the other fine house detail). More **bougainvillea**: on 30% of
  shop-street walls, 60% on residential streets, 25% on main roads (were 20, 40, 15).
- **Pocket parks**: on residential streets, where a gap 18 m long and 14 m deep is free, none
  within 350 m of another park, half the time. They join the map's own parks, so they get a
  lawn, trees, benches, a fence with a gate, ground on the surface map and a place on the
  phone's map. 25 in the city.

### Lessons
- A bush with a tree's leaf cards had fronds three metres long, spilling over the wall onto
  the footpath. Its cards are 40% of a tree's, and there are more of them.
- Pocket parks 24 × 18 m found only 10 gaps. Residential streets are filled with houses first.

### Performance
The ride fps on this machine swung between 39 and 60 from run to run. Another Chrome process
(the dev-server game tab) had used over four hours of CPU. Timing frames standing still with
the GPU's work included, on Sarjapur Road: High 16.1 ms and Low 11.0 ms with everything on.
The build from before the world pass measured 18.5 and 11.2 ms. Switching single features off
moved the numbers more by noise than by their own cost, so none of them is measurably expensive.
PostEffects' debug toggle (`__deliverItPost`) now switches the sun's haze and shafts too.

## 2026-11-18: Entry 164, the clutter that tells a street's story

### What I did
- **Posters** (posters.ts): the wall-poster sheet is now 12 posters, 4 by 3. The new ones are
  a tuition centre's SSLC toppers with their photos, a lost dog ("Bruno", reward), a ward
  election poster and a PG room for rent. The election poster's candidate ("Shri K. Manjunatha")
  and party ("Namma Nagara Paksha") are made up, and so is its symbol, a street lamp. I first
  drew a bicycle and changed it, as that's a real party's symbol. Half of compound walls carry a
  poster by the gate (was 35%).
- **Story props** (`storyPlacement.ts`, drawn by `StoryProps.tsx`), seeded and checked on the
  surface map, each kind one instanced shape of a few vertex-coloured boxes, drawn only near
  the rider on every quality (35 m for newspapers up to 220 m for transformers):

| | How placed | Count |
| --- | --- | --- |
| stray dogs | one or two every ~60 m of street, by the wall, in six coats | 1,298 |
| cows | at the kerb of residential and main roads, every ~450 m, solid | 58 |
| plastic chairs | two stacked outside 14% of shops | 888 |
| flower pots | three by the door of 16% of shops | 1,168 |
| garbage piles | every ~140 m, on open ground past the footpath or by a wall | 435 |
| cycles | leaning on the compound wall by 10% of house gates | 301 |
| newspapers | rolled at 30% of house gates | 3,334 |
| transformers | on two concrete poles beside 5% of lamp posts, solid | 218 |
| cable coils | hung on 22% of lamp posts | 965 |

3,486 spots were refused by the surface map, a wall or something already there.

The tender coconut cart was already there (street life's carts).

### Lessons
- `storyProps.ts` and `StoryProps.tsx` are one file on a Mac's disk. The placement is
  `storyPlacement.ts`.
- A shot taken half a second after moving the rider caught balconies and pots floating
  before the buildings under them had streamed in. Shots that move the rider now wait 3 s.

### Performance (Sarjapur Road, 9:00)
Low 60 fps, 4.4 ms of work a frame. High 53 fps with the intermittent hitches this busy
machine has shown since the start (5.2 ms of work).

## 2026-11-18: Entry 165, closer-packed streets

### What I did
- Residential lanes are 4.6 m wide (were 5): two cars pass with care, and traffic, which
  keeps 1.4 m either side of the middle, still fits. Their footpaths are 1.5 m (were 1.8).
- Infill houses stand behind a 2.2 m yard (was 3 m), still room for a car, and neighbours are
  0.4 to 1.2 m apart (were 0.8 to 2). Shops and showrooms close up too: 0.1 to 0.5 m apart on
  shop streets, 0.1 to 0.6 m on main roads, set back 0.4 and 0.5 m.

7,690 infill buildings (was 7,425). With the narrower lanes, fewer mapped buildings reached
over the road and footpath: 504 removed (was 670), 6,419 trimmed (was 6,950).

### Not done: shortening long blocks
The city is drawn to OSM's real coordinates, and the roads, the delivery addresses, the saves
and the phone's map all depend on them. Shortening a block would mean bending the map
under all of them. The long blocks are filled in instead: denser infill, avenue trees, story
props and pocket parks along them.

## 2026-11-18: Entry 166, landmarks to steer by

### What I did
`src/world/landmarkPlacement.ts` places them, `CityLandmarks.tsx` draws them.
- **Agara Lake.** OSM has "Agara Lake Park", a kilometre across, but the map file has no
  water, so the game drew it as one huge lawn. Now the lake fills the park more than 30 m in
  from its edge (a two-pass distance on the surface map's grid), leaving a ring of park round
  it: 0.29 km² of water. It's a new kind of ground on the surface map, `Water`, where nothing is
  placed, so no tree, bench or tuft lands in it. The water is one flat mesh under the shared
  light, a muddy green-grey, and at a low angle it takes the colour of the hazy horizon, broken
  into streaks by fine ripples and darker in broad patches.
- **The metro viaduct** along Hosur Road, where the real one runs: 89 pillars, every 32 m in
  the median between the carriageways (found on the surface map), with caps and a deck with
  parapets 12 m up, in 91 spans. The pillars are solid and drawn out to 600 m, so the line of
  them reads from blocks away.
- **Bus shelters** on main roads' footpaths, about every 520 m: 8 of 6 m and 3 of 12 m. Each
  has posts, a sloping roof with a blue fascia, a back panel, a bench and an ad panel. Solid
  front and back, so no tree grows inside one (the first did).
- **The BDA Complex's board**, in Kannada and English, inside its compound's corner nearest a
  road, facing it.
- Roadside shrines on main roads at most every 450 m (was 700), and petrol bunks on long
  gaps every 750 m (was 900).
- With `?debug=1`, `__deliverItLandmarks` lists them all, for going to look.

### Performance
High 60 fps, 4.6 ms of work. Low 53 to 55 fps with this machine's usual hitches, 3.4 ms. The
load average was 6 to 8 during one run, where High's work read 8.9 ms; the repeat read 4.6.

## 2026-11-18: Entry 167, heavier weathering

### What I did
All in the shaders, so it costs no textures and Low has it too.
- **Walls** (weathering.ts): faded patches up to 55% (was 45%), damp stains 30% darker (was
  20%), streaks under 70% of sills (was 55%), 38% darker. New: long thin rain streaks the full
  height of the wall, and rust runs. In about one 1.2 m strip of wall in six, each storey, a
  thin orange-brown run starts near the top and runs down, as from a grille, an AC's bracket
  or a pipe clamp.
- **Roads** (groundShaders.ts, the asphalt): tar patches, fresh black rectangles where a
  trench was filled in (about 7% of 5 × 3 m cells) and blobs where a pothole was, with less
  dust and a little more shine than the road round them. Damp patches darker and shinier along
  the gutters, and the odd one out in the road.

### Performance (back to back with the build from before the world pass)
High 60 fps, 5.0 ms of work (before: 60 fps, 4.8 ms). Low 60 fps, 4.4 ms (before: 54 fps
with this machine's hitches, 4.1 ms). One run read High at 32 fps under load and its repeat
read 60.

## 2026-11-18: Entry 168, a stronger golden hour

### What I did
At 17:30, a first visit's start, 27th Main looked overcast and 13th Cross already dusky. The real
sun was only 6° up, so the sunlight had faded to 60% and its colour was a pale amber, and the fill
from the sky was nearly as strong as the sun. All of it is in `getSkyLook` (skyLogic.ts), as an
`evening` share (16:15 to 18:25, peaking 16:55 to 18:05, clear skies only):
- **The sun keeps its strength** until it's nearly down, and is 35% stronger at the peak.
- **A deep orange light**: 70% of the way to `[1, 0.56, 0.27]`.
- **Its path swings** (`eveningSwing`): the evening sun crosses HSR's grid of streets at about 30°
  instead of running straight down the east-west ones, where both sides of the street were in
  shade. The sky's sun and the light swing together, so the glow in the haze and the shadows
  agree. Tried the other side first: on 13th Cross the tall block on the left then shaded the whole street.
- **The light comes from about 15° up** (11.5° before, at the lowest the light was allowed): any lower
  and the street stays in the shade of the houses, with no sun on the road or the shopfronts.
  The sun in the sky is still at its real height.
- **A lower, bluer fill**: 72% as strong, 60% of the way to a sky blue, and less warm bounce off
  the ground, so the shade reads cool against the orange.
- **The sky overhead** goes 45% back towards a clear blue, so it doesn't read as overcast.

Screenshots at 17:30 on High and Low, before and after: `world-pass.local/shots/fu1-before`, `fu1-d`.

### Performance
No new light, pass or texture: the same shader work as before.

## 2026-11-18: Entry 169, trees and pots on the shop streets

### What I did
- **Trees in footpath pits on shop streets** (props.ts). Shop streets had almost none: the
  roadside trees stand 2 m out and need 1.8 m from a wall, and 27th Main's shops are closer than
  that. Now one every 26 m a side, the two sides staggered, in a pit at the kerb (0.85 m out,
  as the avenues), neem, copper pod or rain tree by road. A smaller arch canopy (0.7×) leaning
  out over the road by 7 to 10°, further than an avenue's, so the leaves hang over the road and
  not the boards. **No trunk stands in front of a signboard**: a spot within a shop's front, less
  0.35 m at each end, is moved along by up to 4.5 m to the gap between two shops, or dropped.
  2,276 trees. The pits come with them (streetEdgeGeometry.ts draws one under any tree on a footpath).
- **Potted plants outside shops** (storyPlacement.ts, StoryProps.tsx): on shop streets 45% of
  shops have pots (16% elsewhere), a third of them at both ends of the front, by the wall beside the
  shutter. The cluster is new: an areca palm in a big terracotta pot (about 1.5 m), a rounder
  plant in a weathered cement pot and a small one with a few flowers. Low-poly leaf mounds,
  vertex coloured, one instanced shape, drawn within 70 m on every quality, as before.

Screenshots: `world-pass.local/shots/fu2b` (27th Main and 24th Main, High and Low).

### Performance
On Low the shop trees are solid canopies like all the others; item 5's tree thinning covers them too.

## 2026-11-18: Entry 170, concrete, petrol bunks and sports pitches

### What I did
- **A concrete material** (`concreteColor` in groundShaders.ts): poured slabs 3 m square with
  dark sawn joints, each slab its own shade, broad blotches, grit, tyre grime, oil drips (more
  where vehicles stand, and a little shinier) and the odd cracked slab. All in the shader, no
  texture, so Low has it too.
- **Paved ground on the map** (parking, school and college yards, markets, bus stands) was
  drawn as worn soil. The cover map (groundCover.ts) now has a second byte a metre for paving,
  and the soil shader lays the concrete there. Car parks get faded white bays, 2.5 m by 5 m in
  pairs of rows either side of a 6 m aisle, turned along the car park's longest side (the angle
  is in that byte).
- **Petrol bunk forecourts** (FuelStations.tsx): the forecourt is the concrete, with most oil
  in the lanes by the pumps; a yellow lane painted round each island, white arrows in and out.
  The islands have a kerb painted yellow and black, a raised top, a bollard past each end and a
  hose on each pump. **A car filling up and a scooter** at the pumps, and **the attendant** at
  the car (fuelStationData.ts, `pumpVisitors`).
- **The empty field beside the pump is the bunk's yard now.** Where there's open ground at one
  end (7 to 18 m, clear of buildings and streets, the bunk's own driveways allowed), the
  forecourt runs on into a paved yard with the office (plaster, the company's colours along the
  top, a black water tank), the air and water stand, drums, and the staff's car and bikes. The
  compound wall goes round it. 6 of the 10 bunks have one. Beside 2 others, on open ground past
  the forecourt, **a tyre puncture shop**: a tin shed, tyres stacked out front, a compressor, a
  board in Kannada and English, two vehicles waiting and the mechanic.
- **Sports pitches** (pitches.ts, SportsPitches.tsx): the map's 17 pitches were plain lawn and
  read as empty fields. Cricket grounds are worn to the red earth round the middle, with a
  rolled clay strip, creases and stumps, and kids playing (batter, keeper, bowler, four
  fielders); basketball courts are red oxide with their lines and two hoops; tennis, badminton
  and volleyball courts are green with a net; football grounds get goals; kabaddi an earth court.
  Parks no longer plant trees on a pitch.

### Two bugs found on the way
- **Walls cut across corners.** `joinPanels` (boundaries.ts) joined any two wall panels that
  touched into one straight run, even round a corner, so a loop could be drawn, and made solid, as
  a diagonal from one corner to another. Panels now join only when they run on within 3°. It
  showed as a wall across a petrol bunk's new yard; it could have happened on any walled loop.
- **Half the bunks were drawn mirrored.** The drawing frame (`stationMatrix`) runs along the road
  whichever way keeps faces the right way out, but the placement (`spotOf`) doesn't. Anything not
  the same at both ends (the price sign, now the yard, office and tyre shop) was drawn at the
  other end from where it's solid on four of the ten bunks. Mirrored to match now.

Screenshots: `world-pass.local/shots/fu3-before` (before), `fu3k` (the pump), `fu3j` (the yard),
`fu3-cricket`, `fu3-court`.

### Performance
Paving is one branch in the soil shader, taken only on paved ground. The cover map is two
bytes a metre now, 23 MB on the GPU (11 MB before). The bunks are still three meshes for all of
them, plus one for the paint and one for the pads; the pitches one mesh; the tyre shops two.

## 2026-11-18: Entry 171, the phone out of the way

### What I did
The phone no longer sits half open in the bottom-right while riding: its lock screen was always
there, over the street. Away, it's now below the bottom edge, with nothing showing
(Phone.tsx, index.css). **A new message peeks it up**: the top strip (status bar, unread count
and clock) rises with the notification floating above it, for as long as the notification shows
(3 s, 6 s if urgent, 2.5 s for "Now playing"), then it slides away again. A click on the strip or
a note opens it as before. **P** raises it to the lock screen, and handovers still bring it up by
themselves. A music video drops to the corner while the phone is away.

Screenshots: `world-pass.local/shots/fu4` (riding), `fu4-peek` (a message), `fu4-p` (after P).

## 2026-11-19: Entry 172, performance after the world pass

### What I did
- **Trees** (RoadsideProps.tsx, foliage.ts, qualitySettings.ts):
  - Leafy canopies within 45 m on High and 40 m on Medium (were 90 and 70), the solid canopies past that.
  - **A far level**: past `farTreeReach` (High 120 m, Medium 100, Low 45) each tree is an impostor,
    one rough ball the size of its canopy on a four-sided post, about 28 triangles against 190,
    with no shadow. Trunks stop there too; they used to go out to the props' draw distance
    (260 m on High), shadows and all.
  - **Fewer trees on Low and Medium** (`treeThin`): past 40 m on Low, 45% of the trees are drawn;
    past 50 m on Medium, 70%. The same trees in every part (trunk, canopy, impostor), by a roll on
    their spot. Near the rider every tree is drawn, so none that could be ridden into is missing
    (props refresh every 20 m, so the nearest a hidden tree gets is 20 m on Low).
- **Sun shafts**: High only (Medium drops them). On High they cost a whole extra pass over the
  picture, as they can't share one with SMAA, so they're mounted only while the sun is lower than
  about 18° (from about 16:20, until about 7:40), and they're cheaper: 32 samples at 0.4 of the
  picture's size (were 48 at 0.5).
- **Small shadow casters**: story props (but the cow and the transformer), bougainvillea flowers
  and far bushes cast no shadows on High: too small to read, and each was another draw in the shadow map.
- **Load**: the lake's distance pass ran on a scratch map of the whole city; it's on the park's own
  box now (87 → 15 ms). The surface map's scanline fill writes runs at a time (163 → 129 ms with
  the places of worship). The cover map's wear pass uses a table of offsets (162 → 80 ms). The
  crash physics' wall mesh shares corners, built straight into typed arrays.
- `scripts/bench.mjs --eval <js>` runs a script before measuring, e.g. to hide a part.
- Tried and dropped: compiling each part's shaders as it mounts (`gl.compile`), so the driver
  would compile them side by side. Load was the same within noise.

### Performance (Sarjapur Road, back to back with the build from before the world pass, `48bd4b5`)
This Mac was busy with another Chrome using most of two cores, so runs were interleaved, pre then
now, and medians taken. The review's numbers came from a slower moment on the same machine, so
here is each as measured, and scaled to the review's "before" numbers.

| | Before the world pass | The reviewed build | Now | Now, on the review's scale |
| --- | --- | --- | --- | --- |
| High, ms | 10.5 | 12.2 (+16%) | 11.5 (+9%) | about 17.9 (target 16.6) |
| Low with the CPU 4× slower, ms | 12.0 | 12.7 (+6%) | 12.4 (+3%) | about 22.1 (target ~22) |
| Load (Play to riding), s | 3.7 | 4.6 (+24%) | 4.45 (+20%) | about 8.0 (target 7) |

At 17:30, with the shafts on: High 11.4 ms against 10.5.

### Not met
- **High** is still about 1 ms over the build from before the world pass. Hiding the world part by
  part, no single part costs more than about half a millisecond on High; the rest of the world
  pass's cost is spread over the weathering and ground shaders, the closer camera and the extra
  props. Bringing it the rest of the way means cheaper wall and ground shaders on High, or a lower
  top resolution.
- **Load** is still about 20% over. What's new in planning: setting buildings back from the
  footpath (250 ms, half of it road-distance queries for 20,000 buildings), the surface map
  (130 ms), the extra colliders (+70 ms) and the cover map (80 ms). Getting under 7 s needs that
  planning baked into the map data at build time, or done in a worker.

## 2026-11-19: Entry 173, a helmet with some shape

### What I did
With the camera closer, the rider's helmet read as a plain white egg: from behind, the visor
(on the front) never shows. It's built for the view from behind and a little above now
(Rider.tsx): a dark rubber rim round the bottom edge, higher at the front; the visor as a
band across the eyes that wraps round to the sides, on dark pivots at the temples; a chin bar a
little proud of the shell; two vents on top; twin dark stripes from the back of the neck over the
top to the visor; a thin orange reflector strip above the rim at the back; and the chin straps
down from under the rim. The shell keeps the colour bought at the Garage. A few hundred triangles
more, one rider, every quality.

Tried: one centre stripe with a spoiler across the back read as a cross, and with a square
reflector under twin stripes, as a face.

Screenshots: `world-pass.local/shots/fu6d` (`zoom.png` against `fu6/zoom-before.png`).

## 2026-11-19: Entry 174, ?hour and ?weather in the address

### What I did
With ?debug, `?hour=17.5` starts the clock at 17:30 and `?weather=clear` (or `cloudy`, `rain`)
holds that weather for an hour, alongside ?spawn: `/?spawn=27th-main&debug=1&hour=17.5&weather=clear`
(dev/spawn.ts, Sky.tsx). The world loads at that time, shadows and all, rather than being set
after. `scripts/shots.mjs` puts its `--hour` in the address too.

Screenshots at 17:30 of 27th Main, 13th Cross and Sarjapur Road, High and Low:
`world-pass.local/shots/p1-1730`.

## 2026-11-19: Entry 175, the hitches on High

### What I found
On this Mac, quiet, I couldn't make Sarjapur Road hitch on its own: standing and riding, at 9:00
and 17:30, from the moment the ride starts or later, and with the CPU slowed 4×, no frame
went over 26 ms. The prop refresh (every instanced mesh rebuilding its list each 20 m) took at most
0.6 ms in a frame; no long frame compiled a shader.

**What does make exactly the reported pattern is a change of resolution.** Two changes,
1.5 → 1.25 → 1.5, gave 18 frames over 20 ms and a worst of 100 ms. Each change rebuilds the
canvas and every buffer behind the effects, and for a second or so after, frames take about 90 ms.
`AdaptiveResolution` makes those changes by itself when frames come late, so on a busier
machine it would drop, hitch, settle, raise, hitch again. With the effects off a change costs
nothing; the long run of slow frames goes away without the sun's haze effect in the chain,
though not because of its depth read (tried without it). Why that effect makes resizing slow
isn't found yet.

### What I did
- **The resolution changes rarely now** (AdaptiveResolution.tsx): it drops after 3 slow seconds
  running (was 2), raises after 20 calm seconds (was 5) and no sooner than 45 s after the last
  change; a level that proved too much isn't tried for 5 minutes (was 1). After any change, 2.5 s
  aren't judged, so a change's own slow frames can't call for the next one. Judging starts 6 s
  after the start (was 3), past the streaming of the nearby city.
- **Only the copies in use go to the GPU** when a prop list refreshes (RoadsideProps.tsx): the
  buffers are sized for every copy in the city (28,000 trees, 1.8 MB for one mesh), and all of it
  was sent at each refresh, for every mesh at once.
- `scripts/bench.mjs`: `--stand` (as `--ride`, standing still), `--now` (from the moment the ride
  starts), `--throttle 4` (the CPU slowed during the run), and the long frames listed with when
  they came.

### Worst frames (High, Sarjapur Road, a 2× screen)
| | FPS | Frames over 20 ms | Worst |
| --- | --- | --- | --- |
| Standing, 4 s | 120 | 0 | 16.4 ms |
| Riding, 6 s | 120 | 0 | 16.6 ms |
| Riding, CPU 4× slower | 68 to 82 | 1 to 49 | 24.5 to 50 ms (the same build, run to run, with another Chrome busy) |
| Two forced resolution changes (before) | 75 | 18 | 100 ms |

## 2026-11-19: Entry 176, load time by spawn, and the map gzipped

### What I found
Every spawn loads the same here: Play to riding in 4.4 to 4.8 s, in a visible window and
headless, for 27th Main, Sarjapur Road (`main-road`), 13th Cross, 24th Main, the petrol pump
and home, run twice in turn. A spawn only changes which squares stream in last (0.27 to 0.39 s).
All the planning and building is for the whole city, wherever you start.

What differs between a first and a second visit is the download: the map is 14.7 MB as
it is (with 1.4 MB more of extra buildings), and gzipped it's 1 MB. A host that doesn't compress
`.geojson` files on the way (it's `application/geo+json`, which many don't) sends all 16 MB,
about 6 s more at 20 Mbit/s and 12 s at 10. The reported 15 s on `?spawn=main-road` against 7 s
on 27th Main fits a cold first visit, then a warm one.

### What I did
- The build writes a gzipped copy of each map file beside it (`.geojson.gz`, vite.config.ts).
  The game asks for that and unpacks it itself with the browser's `DecompressionStream`
  (src/game/packedData.ts). If the host unpacked it on the way, or there's no copy (the dev
  server answers with the page), it uses the file as it is. Map data downloaded: 15.7 MB → 1.2 MB.
- The loading bar counts the map as 1 MB.

## 2026-11-19: Entry 177, leafy plants in the pots

### What I did
The pots' plants were faceted low-poly balls and cones. They're leafy now, in the trees' style:
each plant is one or two small clumps of the bush shape the hedges use (leaf cards on Medium and
High near the rider, the solid shape further off and on Low), standing on the pot's soil
(`rise`, a height above whatever ground the prop stands on, a raised footpath included). The pots
themselves keep their terracotta and cement, with a rim and soil now.
- Shops' pot clusters: a tall plant of two clumps in the big pot, one in each smaller pot.
- The city kit's planters beside doors were faceted cones; they're pot clusters now.
- The salon's pot by its door had a green cone; it gets a leafy plant too.
Screenshots: `world-pass.local/shots/p4e`.

## 2026-11-19: Entry 178, no far models near the camera

### What I did
Traffic changed to its far versions (under 1,000 triangles, against about 6,500) at 16 m from
the rider on Low, 20 on Medium and 24 on High. The camera is 3.8 m behind the rider, so on a laptop
an auto 20 m off was about 140 px long in its far version, and read as low detail. Now:
- Traffic (autos, cars, two-wheelers, their riders and wheels): 32 m on Low, 40 on Medium, 50 on
  High (qualitySettings.ts). Buses keep their 80 m.
- Parked vehicles under stilt buildings: 35 m (was 20). Loose parked scooters: 30 m (was 20).

### Performance (Sarjapur Road, riding 6 s, a 2× screen)
High 120 fps, no frame over 20 ms, worst 10.4 ms, 3.1 ms of work a frame. Low 120 fps, worst 10.4 ms, 2.2 ms.

## 2026-11-19: Entry 179, the back of the helmet

### What I did
From behind, the helmet still read mostly as a white dome. Its back now has (Rider.tsx,
brandPrint.ts):
- **The Deliver It decal**: the wordmark on a marigold pill, laid on a patch of the shell itself
  so it follows the curve (`createHelmetDecalTexture`).
- **Two exhaust vents** at the back, outside the twin stripes, as well as the two on top.
- **The strap's buckle end** across the back under the rim, as well as the straps down each side.
- The twin stripes now stop above the decal. The orange reflector strip is gone: under the decal
  it made the back read as a face.

Screenshot: `world-pass.local/shots/p6b/zoom.png`.

## 2026-11-19: Entry 180, the quality switch and the credits move into the phone

### What I did
- **The Low/Medium/High switch** is gone from the top-right corner while riding. It was already
  in the phone's Settings app; that's where it lives now (and on the title screen). The help
  overlay (F1) says where it is.
- **Credits** (src/ui/Credits.tsx): while riding, only a small "© OpenStreetMap", as its licence
  asks, just right of the minimap. The full line (OpenStreetMap, Overture Maps, Google Open
  Buildings, Microsoft, the 3D model credits) is on the title screen, in Settings ("Map and model
  credits") and in the help overlay.
- With ?debug, `__deliverItQuality('high')` sets the quality and `__deliverItStore` is the game's
  store, for scripts; `scripts/bench.mjs` and `scripts/shots.mjs` set the quality that way.

## 2026-11-19: Entry 181, a new HUD layout, and a mini phone

### What I did
One block at the end of index.css says where everything sits, with a gutter that follows the
window (`--edge`, 10 to 24 px), so nothing touches an edge on a small laptop or a wide screen:
- **Top-left**: duty status and the objective line (and the tutorial card under them).
- **Top centre**: the order's timer, the arrow, the distance and the customer's mood, only on an order.
- **Top-right**: the speedometer, speed over the nitro bar (was bottom-left). Chat bubbles under it.
- **Bottom-left**: the round minimap, about 1.4 times as big (196 px off duty, 266 online, less on a
  short window), with the street name in it.
- **Bottom centre**: order offers and the prompts of the moment (collecting, handing over, home).
- **Bottom-right**: **a mini phone** (Phone.tsx), a small handset tilted 8°, 116 to 140 px tall,
  showing the time, the weather, the signal and the unread count. A click or P raises the real
  phone. A new message makes it jump and glow (green, red if urgent), with the notification
  floating above it. The half-hidden full phone is gone.

Checked at 1280 × 720, 1440 × 810, 1920 × 1080 and 2560 × 1080 (`scripts/shots.mjs --size`).
Screenshots: `world-pass.local/shots/p7` (sizes), `p7-offer`, `p7-order`.

## 2026-11-19: Entry 182, the metro: tracks, trains and stations from OSM

### What I did
- **OSM's transit data** (scripts/prepare_transit.mjs → public/data/hsr-transit.geojson): the
  map file had no metro and no bus stops, so a script asks the public Overpass API for the play
  area's box once: metro lines, stations and entrances, bus stops with the routes from their
  relations, and bus stations. It ships gzipped like the rest of the map.
- **The viaduct follows the real line.** The Yellow Line's ways are stitched into one line
  (transitPlacement.ts). The pillars landmarkPlacement.ts stands in Hosur Road's median are kept
  only within 30 m of it (31 stood on other roads sharing the name, and their spans made a
  second, branching deck), and the deck spans them in the line's order.
- **Tracks and overhead line** on the deck: two tracks on concrete plinths with their rails, a
  wire over each, masts every other span (Transit.tsx).
- **Trains**: two three-car trains, steel with the line's yellow band and a purple trim, one each
  way. Each runs at up to 16 m/s, brakes into each station, waits 16 s, and off the end of the
  line waits 35 to 80 s and comes back the other way. Instanced, six cars in one draw.
- **Stations at OSM's nodes**: Hongasandra and Bommanahalli (Central Silk Board is past the
  pillars' end). Each is a 76 m concourse over the road, as wide as the road and its footpaths,
  glazed with a purple band and a yellow line, on columns; platforms either side of the tracks at
  the deck with yellow edge lines; a shallow gabled roof with a purple fascia. **Stairs and an
  escalator** under a purple canopy climb from the footpath at each of OSM's entrances (one each side
  where it has none), with a bridge across to the concourse. **Name boards** in Kannada over English,
  with a round M mark (the city's metro, not its logo), on both sides.
- **Below**: autos waiting in a row at the kerb by each entrance (the traffic model, parked), bikes
  parked along the median under the viaduct, and fruit carts under striped umbrellas between them.
  All checked on the surface map and solid. 9 autos, 58 bikes, 8 carts.

Debug: `__deliverItMetro` (the plan) and `__deliverItTrains` (to move them), with ?debug.
Screenshots: `world-pass.local/shots/p11d` (from above), `p11e` (an entrance), `p11g` (a train).

### Performance (riding 6 s, a 2× screen)
| | High | Low |
| --- | --- | --- |
| Sarjapur Road | 103 fps, 1 frame over 20 ms, worst 25 ms | 120 fps, none over 20 ms, worst 10 ms |
| Hosur Road, beside the metro | 88 fps, 1 over 20 ms, worst 42 ms | 120 fps, none, worst 10 ms |

## 2026-11-19: Entry 183, flyovers as scenery

### What I did
- **Which roads are flyovers** (mapData.ts): a major road (motorway, trunk, primary and their
  links) mapped as a bridge or viaduct on layer 1 or higher, at least 150 m of it under one name.
  The 30 or so short bridges on other roads (7 to 73 m) are over storm drains, at ground level,
  and stay roads. That leaves the Silk Board flyover, double-decker flyover, interchange and Ramp A,
  the Outer Ring Road's flyovers at Agara, the Electronic City elevated road and the Ragigudda
  flyover under construction: 18 ways. They're taken out of the roads (which are all at ground
  level), so they're no longer drawn flat on the ground under themselves, nor ridden.
- **Decks** (transitPlacement.ts, Transit.tsx): each at its layer's height (6.8 m, or 9.4 m for layer 2,
  under the metro's 12 m), sloping down to the ground over 130 m at an end that meets a road at ground level and
  staying up where it meets another flyover. Concrete with asphalt on top and crash barriers.
  Pillars every 28 m where the ground below allows (a median, open ground, a footpath, not a
  carriageway), with a cap across the deck. Drawn within 300 m of the map: the Electronic City road
  runs on for 8 km.
- **Traffic overhead**: cars, autos and buses as simple instanced shapes, in their lanes each way
  (one way on one-way decks), 10 to 16 m/s, about one per 40 m of deck, seen only where the deck
  is off the ground.
- **Underneath**: in the shade beside every third pillar, rows of parked bikes on open ground or the
  median, now and then a tea stall (a tin-roofed kiosk, a kettle, glasses, red stools), and posters on
  a third of the pillars. 125 pillars, 296 bikes, 11 stalls.

Screenshots: `world-pass.local/shots/p12a-11` (Silk Board interchange), `p12a-6` (Agara), `p12b` (a stall).

### What it would take to ride them
Everything that moves assumes one level of ground today, so a flyover touches all of it:
1. **Height on the road surface.** Roads are flat meshes at y = 0, with kerbs and a surface map of
   one level. Ridable decks need the road mesh, markings and kerbs built along a 3D line (the deck
   heights here are the start), and a second surface map for the deck, or the surface map
   becoming layered, so props, parking and people know which level a spot is on.
2. **The scooter's physics.** It's arcade: position in x and z, with the ground's height read from
   `groundLift`. It would need the height from whichever level it's on, a rule for which level that
   is (the one it entered by the ramp, kept until it leaves by one), slopes on the ramps (pitch,
   speed lost uphill), and the crash physics' colliders on the deck (barriers as walls at height),
   with nothing below catching it.
3. **The road graph and traffic.** The graph is 2D: junctions where lines cross. A flyover crosses
   roads without meeting them, so its nodes need a level, and crossings at different levels
   mustn't join. Traffic lanes, overtaking, signals and the collision checks between vehicles would
   all need the level, or a car on the flyover brakes for one below.
4. **Collisions.** The collision world is footprints on the ground. Pillars are fine; walls and
   posts on the deck need a height range, or riding under the deck hits its barriers.
5. **Routing, the maps and the camera.** Deliveries route on the graph (the level again); the
   minimap and full map draw roads flat, so a flyover needs drawing over what it crosses; the camera
   pulls in when a wall is behind it and would need to ignore the deck overhead when riding under it.

Roughly: making the ground layered (surface map, collisions, groundLift) is the base; the
scooter's height and slopes, and the graph with levels, are each a solid piece of work on top;
traffic on levels is the largest. A first ridable version could be the scooter alone on one
flyover (the Agara one on the Outer Ring Road), with traffic and deliveries still kept off it.

### Performance
Two merged meshes for the decks and pillars, one for the posters, three instanced meshes for the traffic.

## 2026-11-19: Entry 184, bus stops and the bus stand

### What I did
- **Shelters at OSM's bus stops** (landmarkPlacement.ts): each on the footpath on its stop's side of
  the nearest road, facing it, slid along up to 10 m to find a clear footpath; a big shelter where
  three or more routes stop. 46 stops (29 left out: no clear footpath near). The old one-every-520-m
  shelters are kept only for a map with no stops. Each has **a board** on its roof's front, the
  city buses' green: the stop's name in Kannada and English and its route numbers from OSM's route
  relations (30 stops have them). The boards share three pictures (CityLandmarks.tsx). One to three
  **people waiting** at each.
- **Buses stop** (trafficLogic.ts, `setBusStops`): each stop belongs to the bus lane nearest it, within
  15 m. A bus brakes to stop there, waits 9 s, and goes on; lanes are short pieces of road, so it looks
  into the lane it has chosen next as well. Tested by putting a bus 10 m before a stop: it stopped
  0.3 m short, waited 9 s and pulled away.
- **HSR Layout's bus stand** by the BDA Complex (transitPlacement.ts, Transit.tsx): OSM has its
  station as a point. The nearest site that's clear (open or paved ground, no buildings), along a
  road or square to it, within 200 m, is 80 m west of the point; there the stand is four-fifths size.
  Its apron is paved ground (concrete, nothing planted); an island with a kerb painted yellow and
  black, a long canopy on posts with green fascias, benches; four numbered bays with boards of the
  routes most stops have; a name board in Kannada and English at each end; three buses at the bays;
  nine people on the island.

## Report: fixes, HUD layout and transit landmarks (Entries 174 to 184)

### FPS and worst frames (a 2× screen, 4 s standing or 6 s riding)
| | FPS | Over 20 ms | Worst frame | Work a frame (mean / p95) |
| --- | --- | --- | --- | --- |
| Sarjapur Road, High, riding | 120 | 0 | 10.4 ms | 3.3 / 3.9 ms |
| Sarjapur Road, High, standing | 120 | 0 | 10.4 ms | 3.2 / 3.8 ms |
| Sarjapur Road, Low, riding | 120 | 0 | 10.3 ms | 2.2 / 2.9 ms |
| Sarjapur Road, Low, standing | 120 | 0 | 10.0 ms | 2.2 / 2.9 ms |
| Sarjapur Road, Low, riding, CPU 4× slower | 118 | 0 | 18.5 ms | 7.5 / 9.2 ms |
| Hosur Road (the metro), High, riding | 108 | 1 | 34.9 ms | 3.6 / 4.1 ms |
| Hosur Road, High, standing | 108 | 0 | 17.1 ms | 3.5 / 3.9 ms |
| Hosur Road, Low, riding | 120 | 0 | 10.3 ms | 2.3 / 2.8 ms |
| Hosur Road, Low, standing | 120 | 0 | 10.3 ms | 2.2 / 2.9 ms |

### Load time, Play to riding, by spawn (local, cached)
27th Main 4.7 s, Sarjapur Road 4.5 s, 13th Cross 4.7 s, 24th Main 5.1 s, the petrol pump 4.6 s,
Hosur Road 4.6 s, home 4.6 s. Planning 2.6 s, building the parts 1.3 s, the nearby squares 0.3 s.
On a cold first visit add the download, now 1.2 MB of map instead of 15.7 MB.

Screenshots in `world-pass.local/shots/report`.

## 2026-11-19: Entry 185, flyovers and the metro off the houses, ramps solid

### What was wrong
- **Houses under the flyovers.** Taking the flyovers out of the roads (Entry 183) also took them
  out of everything that keeps buildings off roads: the setback kept houses standing in their path,
  and the infill built new ones there, as the ground looked empty.
- **Grass on the ramps.** Their footprint was open ground on the surface map, so grass and weeds
  grew there and showed through where the decks come down to the ground.
- **Riding through them.** Nothing on a ramp was solid.
- **Stations over houses.** A station reached out to the footpath plus 2 m, measured at its middle only.

### What I did
- The setback and the infill see the flyovers as roads (`clearRoads` in World.tsx), so nothing is kept
  or built under one. 1,012 points along the decks: none over a building.
- **An overhead layer on the surface map** (`overhead`, `markOverhead`): under every flyover and the
  metro's deck and stations, no tree, lamp post or building can stand, and there's no grass
  (groundCover.ts): bare earth. I tried paving it in concrete first; over that much ground the concrete
  shader cost about 1.3 ms a frame on High (62 fps against 110 back to back), so bare earth it is.
- **Solid ramps** (transitPlacement.ts): decks are resampled every 8 m; where a deck is under 3.6 m,
  too low to ride under, it's a solid embankment between retaining walls, walled each side, with a
  row of striped barriers across its foot. Riding at four ramps' feet, the rider stops 1.6 m short
  of the barrier each time.
- **Stations keep off buildings**: each slides along the line, up to 64 m from OSM's spot, to the
  nearest place with room either side, and stops its width short of the buildings all along its
  length; a stair that would land on a house is left out. Hongasandra (both stairs) and Bommanahalli
  (one): no building under either.

### Performance (Hosur Road, High, riding; the machine was busy with the hosted game)
110 to 115 fps, 1 frame over 20 ms, worst 33 to 42 ms, 3.5 ms of work a frame.

## 2026-11-19: Entry 186, temples out from under the flyovers

Two temples the game builds itself, where the map has only a pin (the Jagannath Temple by Silk
Board and the Ayyappan Temple at Agara), stood under flyovers: their pins are on the median and
the ground under the deck. Shrines now keep clear of flyovers as well as roads (worship.ts, given
the same roads-and-flyovers index as the setback), and at their smallest look up to 40 m from
their pin for ground (was 12). Both are placed again, 26 m and 35 m from their pins, and no
temple's building is under a deck. Ramp feet checked from the rider's view: the road runs up
to the barriers, no building in the way.

## 2026-11-19: Entry 187, riding the flyovers

### What I did
The scooter rides every flyover now: up a ramp from the road at its foot, along the deck, and down
the far end or on to the flyover it joins. Traffic and deliveries stay on the ground.
- **Which level** (World.tsx, `createDeckLevels` in transitPlacement.ts): the ground's height at a
  spot now takes how high the wheel already is (`Surface.heightAt(x, z, near)`). A deck counts if it's
  no more than 0.6 m above the wheel, so riding up from a ramp's foot carries the scooter up with it,
  and riding under a deck keeps it on the street. Each wheel and the thrown rider use it.
- **Up on a deck** (above 2.2 m), only the decks' edges are solid, and closed ends where a deck stops
  in the air. They're **banded by height** (1.5 m bands): the first try crashed mid-deck at Silk Board
  into the barriers of the interchange crossing 2.6 m higher. The camera rises with the scooter and
  looks for walls on the deck.
- **The traffic below ignores a rider up on a deck** (trafficLogic.ts): it deals with a stand-in far
  away, so a car underneath doesn't hit or block the rider. Where traffic appears still follows the rider.
- The ramps are open: the barriers across their feet are gone. Their sides stay walled where the
  embankment is high enough to see, so they're ridden up from the foot, not climbed from the side.

### Checked
- Both Silk Board flyovers, end to end at full throttle: up to 6.8 m, along, down to 0.1 m at the
  far end, no crash. The Silk Board Interchange: up to 9.4 m, no crash.
- Riding across under the Silk Board and Agara decks: the wheels stay at 0.2 m (the kerb).

### Not done
- The traffic drawn on the decks doesn't see the rider: it passes through them.
- The minimap's street name is the road below, not the flyover.

## 2026-11-19: Entry 188, a debug FPS overlay, and the world drawn once before riding

### What I did
- **FPS overlay** with ?debug=1 (dev/FpsOverlay.tsx), above the minimap: FPS over the last second,
  the worst frame in the last second and the last 10 s, how many frames took over 20 ms in the last
  10 s, and the whole frame's draw calls and triangles (three.js resets its counts at each render
  call, and the effects make several a frame, so the overlay resets them once a frame instead), and
  the resolution. Its edge turns amber past 20 ms and red past 33. It times frames with its own
  requestAnimationFrame and writes the text twice a second, without React.
- **Prewarm** (World.tsx): once every part is built, behind the loading screen, the whole world is
  compiled (`compileAsync`, every material, seen or not) and drawn once with nothing culled, so every
  geometry, texture and shadow shader reaches the GPU now, not in the frame where it first comes into
  view: the metro's viaduct, stations, boards and trains included (instanced meshes with no copies yet,
  as the trains waiting off the line, are drawn with one for that frame). The ride waits for it
  (`warmed` in launch.ts).

### Measured
- Shaders compiled at load: 244 (were about 170, the rest compiling on first sight while riding).
- The prewarm takes 0.24 s; Play to riding 4.6 to 4.8 s here, as before.
- Riding past both stations on Hosur Road: one shadow shader still compiles on the way, in a 7.6 ms
  frame. The one remaining frame over 20 ms (33 to 42 ms, about 4 s into the ride) has no compile or
  upload in it: the city streaming in round the rider.

## 2026-11-19: Entry 189, load time on a real connection

### What I found
Locally (no network) Play to riding is 4.7 s. On an emulated connection, pressing Play as soon as
the title shows: 8.0 s at 20 Mbit/s, 14.7 s at 8 Mbit/s. 11 MB comes down in all (the preview server
doesn't compress .wasm: the physics engine is 3 MB as it is, 1.2 MB gzipped).
- The world didn't start building until the 3 MB physics engine was in, though only one step near the
  end of building uses it.
- The map shared the connection with the physics engine and the models from the first moment.
- The extra buildings (1.3 MB unpacked) only started downloading on Play, and the texture decoder only
  once the parts were being built.

### What I did
- **Building starts with the map alone** (World.tsx): `buildWorld` is a generator that pauses at the
  step that makes the physics world, and carries on once the engine is in. The loader says the map is
  ready without waiting for the engine (preload.ts).
- **The map and its smaller files come down first, on their own**; then the texture decoder, the
  physics engine, the models and textures, while the world is being planned.
- **The extra files** (extra buildings, places of worship, barriers, transit) and **the texture
  decoder** download from the title screen, each once (packedData.ts keeps each download).

### Measured (Play pressed as soon as the title shows)
| | Before | Now |
| --- | --- | --- |
| Local | 4.7 s | 4.7 s |
| 20 Mbit/s | 8.0 s | 6.0 s |
| 8 Mbit/s | 14.7 s | 12.4 s |

At 8 Mbit/s it's the download itself: 11 MB at about 1 MB/s, about 9 MB on a host that compresses
.wasm. Under 8 s there needs a faster connection, some time on the title screen first (everything
downloads from the moment the page opens), or fewer bytes: the city kit model (1.2 MB, and nothing
of it is drawn on Low since its planters became pots) and the physics engine are the big ones.

## 2026-11-19: Entry 190, the viaduct's detail

### What I did (CityLandmarks.tsx)
- **Under the deck**: two box girders along each span and cross beams at its ends, bearing pads on
  the pillar caps, and a rain stain down the deck's sides under each parapet.
- **Pillars**: a darker plinth and grime at the foot, and a **drainpipe** down one face from the
  deck, with clamps, bending out at the bottom.
- **Lights**: lamp posts on the parapets every 18 m, staggered, their arms over the tracks, and
  fixtures under both girders every 10 m, seen from the street. Both glow after dusk (no real lights,
  so no cost per light).
- **Pillar numbers**: "P-101" onwards, painted white on dark blue on both faces across the road,
  from one picture for all of them.
- **Posters** on two in three pillars, both sides, from the posters' picture.

All of it is in the deck's merged mesh, the pillars' instanced shape, or three new meshes (lamp heads,
numbers, posters) for the whole line.

Screenshots: `world-pass.local/shots/viaduct-10` (day), `viaduct-night2` (night).

## 2026-11-19: Entry 191, the undersides of the decks

The underside a rider sees on Hosur Road is the Electronic City flyover's deck over the road,
which was one flat 1.2 m slab; the metro's girders (Entry 190) were too close in colour to its
soffit to read. Now, wherever a deck can be ridden under (Transit.tsx, CityLandmarks.tsx): a thin
deck slab with a dark soffit, light girders along it with bottom flanges (one per 3.2 m of width on
the flyovers, two on the metro), a cross beam at every joint (every 8 m on the flyovers, about 6 m on
the metro) and a drainpipe along one side. Light against dark, so the structure reads from the street
at golden hour. Ramps keep their solid body. Screenshot: `world-pass.local/shots/under-rider2`.

## 2026-11-19: Entry 192, leafy trees at every distance, and leaves without dots

### What I did (RoadsideProps.tsx, foliage.ts, qualitySettings.ts)
- **No more faceted far trees.** Past 45 m on High (40 on Medium, everywhere on Low) trees were
  faceted solid balls, very visible at golden hour. Every level is leafy now, with the real leaf
  texture: the full leaf cards to 70 m on High, 60 on Medium (none on Low); bigger, fewer cards (2.2×,
  a fifth as many) to 140 m on High, 110 on Medium, 60 on Low; then 3.6× cards without shadows to the
  draw distance. The impostor balls are gone.
- **Cross-fades**: each level dissolves into the next over 8 m, in a fine screen pattern by the copy's
  distance from the rider (`leafLook`'s `uFade`). Each level is listed 20 m past its band, as lists
  refresh every 20 m, so the shader always has the copies it fades.
- **The dotted leaves**: alpha-tested fronds thinner than a pixel broke into dots and holes. The leaf
  shader now scales the alpha up with the texture's mip level (so fronds keep their coverage when
  small) and sharpens it over one pixel round the cutoff (`fwidth`), so each edge is a single clean
  step. Alpha to coverage would need multisampling, which the effects chain doesn't use.

### Performance (riding, 17:30, a 2× screen)
Sarjapur Road High 115 fps (worst 25 ms), Low 120 (10 ms); Hosur Road High 97 (42 ms), Low 120
(10 ms). Synced frame on Sarjapur Road: High 11.9 ms, Low 6.9 ms, Low with the CPU 4× slower 13.2 ms,
as before.

## 2026-11-19: Entry 193, no freeze in the first second of riding

The freeze (about 400 ms, 1 s into the ride) was the traffic's shaders compiling: the traffic was
built 0.6 s after the ride started, to keep the loading screen's fade smooth, so the prewarm never
saw it, and a CPU profile of the first 2 s of riding showed 303 ms in compiling shaders. The traffic
is built during loading now (Player.tsx), so the prewarm covers it. Four spawns, riding at 17:30:
no frame over 50 ms after the ride starts (one of 51 ms on Hosur Road). Play to riding 4.9 to 5.1 s
here (about 0.25 s more: the traffic's building moved into loading).

## 2026-11-19: Entry 194, planning on the title screen, crash walls built round the rider

### What I found
On an emulated mid-range laptop (the CPU 2× slower) on 20 Mbit/s, pressing Play as soon as the title
shows, Play to riding was 9.3 s: the 9.7 s seen on the preview. It's mostly the CPU: planning the city
about 5 s, building the parts about 2.5 s. Pressing Play 5 s later it was 3.5 s, as the downloads were done.

### What I did
- **The city is planned on the title screen** (World.tsx, planAhead.ts): as soon as the map is in,
  the world build runs a step at a time between frames (the build is a generator that yields after each
  step, and where it needs the physics engine). The title's pictures pan on the compositor, so they keep
  moving. When Play is pressed, whatever's left is finished at once.
- **Crash walls are built round the rider** (crashPhysics.ts): one physics mesh of every wall in the
  city took a quarter of a second to build while loading (0.6 s on the slower CPU). The walls are sorted
  into 200 m tiles at the same moment as before (so the same walls are in it), and each tile's mesh is
  made when the rider comes within a tile of it: about 9 tiles at the start, a few milliseconds each.
  Physics step while loading: 300 → 46 ms.
- Tried and reverted: keeping infill's answers across buildings (forgetting only round each new one).
  The version bookkeeping cost more than the answers saved.

### Measured (Play to riding)
| | Play at once | 2 s on the title |
| --- | --- | --- |
| Local | 3.4 s (was 4.9) | |
| CPU 2×, 20 Mbit/s | 8.65 s (was 9.3) | 6.2 s |

From the page opening to riding on that profile is about 10.4 to 10.7 s however long the title is up:
what's left is CPU. The next step is to bake the building setback and the infill (1.7 s on the slower
CPU, deterministic from the map) into the map data at build time.

## 2026-11-19: Entry 195, vehicles' detail by the camera, and better near cars

### What I did
- **Per-vehicle levels of detail from the camera, with hysteresis** (traffic/vehicleLod.ts). Every
  part of a vehicle (body, rider, wheels; parked cars and scooters too) asked its own question, by the
  rider's distance, with no margin, and the parked cars only every 20 frames. Now each vehicle has one
  answer a frame, from the camera's position: detailed nearer than its cutoff less 4 m, back to its far
  version only past the cutoff plus 4 m, so one queued round the cutoff at a junction doesn't flicker
  between the two. Moving, stopped, crashed and parked alike. Riding Sarjapur Road for 20 s, 282
  samples of traffic within 40 m of the camera: none on its far model.
- **The near cars themselves.** Close up, the SUV that looked low-detail was the detailed model: a
  jagged grille and blotchy paint, baked at 6,500 triangles from a 2.1 cm wrap with colours sampled
  from 256-pixel textures. The four cars are re-baked at 14,000 triangles from a 1.5 cm wrap, sampling
  512-pixel textures (prepare_traffic_models.mjs, from the original downloads). The far versions are
  unchanged. traffic.glb 0.77 → 1.1 MB compressed; a handful of near cars at once.

### Not done
The paint is stored per corner, so a triangle crossing from paint to dark trim smears between them:
a ragged dark fringe at wheel arches and window frames, close up. Baking the cars with a texture
instead of corner colours would fix it.

## 2026-11-19: Entry 196, trees cheaper again

### What I found
Triangles weren't it: on Hosur Road at 17:30 trees are about 280k of 4.7M (the house kit is 1.4M, traffic
0.87M, the city kit 0.81M). The cost was in the cross-fade: tree lists refresh every 20 m, so each level
was listed 20 m past its band, and in a 48 m band round each handover every tree was drawn twice in
full (one copy dissolving, its pixels shaded then thrown away), and cast two shadows.

### What I did
- Tree lists refresh every 6 m (`TREE_REFRESH`): the double-drawn band is about 14 m.
- Full leaf cards to 45 m on High (was 70), 40 on Medium (60); the coarse cards to 110 m on High (140),
  90 on Medium (110), 50 on Low (60); the far cards, without shadows, beyond.

### Measured (17:30, back to back with the build before the tree change; this Mac was busy)
| | Before the tree change | Now |
| --- | --- | --- |
| Hosur Road, High, riding | 72 fps, worst 57 ms | 72 fps, worst 58 ms |
| Sarjapur Road, High, riding | 82 fps, worst 34 ms | 83 fps, worst 18 ms |
| Hosur Road, High, synced frame | 18.7 ms | 20.1 ms (the new near cars, 14k triangles each) |

## 2026-11-19: Entry 197, residential streets wide enough to turn

### What I did
- **Carriageways**: residential 6.5 m (was 4.6), unclassified 6 m, living streets 5.5 m (roadData.ts).
- **Density kept by the edges, not the road**: residential footpaths 1.2 m (were 1.5), infill yards
  1.8 m (were 2.2; a car in the yard from 1.8 m). The setback and the surface map are built from the
  new widths at load, so nothing overlaps: the setback trims 6,959 buildings (was 6,419), replaces 1,286
  (805) and removes 723 (504); the infill builds 7,369 (7,597). About 450 fewer buildings of some 27,000.
- **Rounded junction corners** of 5 m (were 3; 2.5 where 5 won't fit).
- **Parking**: residential streets are now wide enough to park on, so they get a light sprinkle
  (4% of slots, a car or a few bikes), to keep them wide. Nothing is parked within 14 m of a junction
  (streetParking.ts already kept that). Kerbside cars 1,818 (were 1,676).
- **Traffic** now uses residential streets too (they're over the 5 m minimum), at their lighter weight:
  61,590 lanes (were 22,093). Lanes sit a quarter of the road out from the middle (1.6 m on a residential
  street, never under 1.4).
- **Steering** up to 35% tighter below 20 km/h, most at a crawl (vehicleConfig.ts `slowTurnBoost`).

### Performance
Riding Sarjapur Road on Low with the CPU slowed 4×, back to back with the build from before the tree change:
47 fps against 44: the same (this Mac was busy, load average 4).

## 2026-11-19: Entry 198, flyover decks as one smooth road

### What I did
- **One continuous surface** (Transit.tsx `createDeckSurfaces`). The deck top was a box per 8 m
  segment, each tilted to its own slope, so at every joint the surface stepped. It's now one ribbon
  through every point of the deck's path at that point's height, sampled every 4 m (was 8). The
  scooter rides the same heights (`heightOnFlyover` interpolates between the same points), so what's
  drawn and what's ridden match.
- **Smooth ramps**: each ramp is an S-curve (smoothstep) instead of a straight slope: level where it
  leaves the road and where it meets the deck, steepest halfway. On the 130 m ramps that's about 8%
  at most. Some short OSM deck pieces (88 m, so a 44 m ramp) reach 23%.
- **Textured the whole way, both directions**: the streets' asphalt (the same photo and shader,
  tyre tracks and gutters), white edge lines, dashed lane lines, and a continuous concrete crash
  barrier along each edge, all following the ramp's heights up and down. The concrete deck body stays
  underneath, girders and all.
- Debug: `window.__deliverItFlyovers` lists the decks (with ?debug).

## 2026-11-19: Entry 199, traffic drives over the flyovers

### What I did
- **Deck lanes in the traffic's own lane list** (traffic/deckLanes.ts): every flyover deck becomes a run
  of lanes about 8 m long along its path (left lane on one-way decks, each half on two-way ones), 1,000
  in all, clipped to the map. Each knows where it is along its deck, so a vehicle on it is drawn at the
  deck's height there (`Vehicle.deck`, part of its `lift`), up the S-curve ramps and over.
- **Joined at the ends**: a ramp's foot joins up to two ground lanes ending near it heading up it (they
  may carry on along the road or take the flyover), and the end of a ramp down joins the ground lanes
  that carry on; a short link lane bridges any gap. Where a deck ends in the air (the Silk Board
  interchange), it runs on to the next deck heading the same way at the same height.
- **Two levels that never meet**: each step, traffic up on a deck (over 2.2 m) deals only with the
  others up there and traffic below only with traffic below: queues, giving way, overlaps. The rider
  counts only on the same level. Up there, a vehicle has no physics body (the crash world is all on
  the ground), isn't pushed out of the buildings below and doesn't stop for anyone lying in the road
  below. It never drives through the rider (`blockRider`), but it can't be knocked over.
- **The stand-in streams** (`FlyoverTraffic`) now only show beyond 210 m of the rider, past where the
  real traffic reaches.
- scripts/shots.mjs: `--eval` runs inside an async function, so a script can wait for traffic to settle.

### Measured
Under the Agara flyover on Outer Ring Road, 40 s: about 5 vehicles up on the deck at a time (8 at
most), two drove up from the ground and six came down onto it. Every vehicle on a deck lane was drawn
at the deck's height.

### Not done
Vehicles stay level on the ramps (up to about 8%); they don't pitch with the slope.

## 2026-11-19: Entry 200, nothing comes up through a flyover or the viaduct

### What I did
- **An overhead-structure layer with heights** (surfaceMap.ts `overhead`): each cell under a flyover
  deck, the metro viaduct or a station now holds the lowest underside above it, in quarter metres (it
  was a yes/no mask). Flyover decks: the deck's height at that segment less 1.7 m of deck and girders
  (the ground on a ramp's embankment); the viaduct 11.6 m; station concourses 5.8 m.
- **A clearance pass once every tree and lamp post is planted** (overheadClearance.ts), from each tree
  kind's real reach and top (foliage.ts `treeExtent`), its drawn size and its lean. Under a deck: a
  shrub instead, where the ground takes one. Beside a deck, with leaves that would come within 1 m of
  it: made smaller (down to 60%), or moved 2 to 5 m to where a tree may stand clear, or taken out.
  A lamp post whose head would reach a deck goes, with its cables. Their solid posts move or go with
  them (collision.ts `removePost`).

### Counts (whole map: all flyovers, the viaduct and stations)
558 trees stood near a deck. 230 made smaller, 31 moved, 245 removed, none turned to shrubs (none was
planted under a deck: the old mask already stopped that). 9 lamp posts removed. 92 ms at load.

### Not checked
Signs and hoardings, and buildings beside a deck: buildings are already kept off the decks' footprints
by the setback, but a sign or hoarding near a deck's edge isn't checked against it.
