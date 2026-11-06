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
