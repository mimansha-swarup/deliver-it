import {
  addPost,
  addWall,
  isNearBuilding,
  type CollisionWorld,
} from "./collision";
import { getFootprintArea } from "./buildingData";
import type { BuildingFeature, PointFeature, PolygonFeature } from "./mapData";
import { isClearOfRoads, nearestRoadPiece, type RoadIndex } from "./props";
import {
  isInsideBounds,
  isInsideOutline,
  lonLatToWorld,
  type GroundPoint,
  type LonLat,
} from "./worldUtils";

/*
 * Temples, mosques and churches (ART_DIRECTION.md). OSM maps them three ways:
 * as a building tagged `amenity=place_of_worship`, as a compound (the temple's
 * ground, with or without buildings drawn inside), or as a pin. Overture's
 * places fill in ones OSM lacks, and name some it has unnamed
 * (scripts/prepare_extra_places.py).
 *
 * `findPlacesOfWorship` runs as the map loads: it marks their buildings with
 * the kind `temple`, so the plain building drawing, the house kit and the roof
 * tanks all leave them alone. `planPlacesOfWorship` runs as the world is built:
 * it works out which way each faces, and where a pin or an empty compound has no
 * building, puts up a small shrine or prayer hall of its own.
 */

/** `kalinga`: a Jagannath temple, built in Odisha's style with a tall curved tower. */
export type Faith = "hindu" | "kalinga" | "muslim" | "christian" | "other";

export type PlaceOfWorship = {
  faith: Faith;
  name?: string;
  /** Its buildings on the map, the main one first. Empty if it has none. */
  buildingIds: string[];
  /** The temple's grounds, walled in by `planTempleWalls` (fencing.ts). */
  compound?: GroundPoint[];
  /** Where its pin is, if it has no building. */
  point?: GroundPoint;
};

/** A place of worship, ready to draw. */
export type WorshipSite = {
  faith: Faith;
  name?: string;
  /** The main building's outline, where the tower goes. */
  outline: GroundPoint[];
  /** Its other buildings: halls and the priest's house, drawn in the same paint. */
  halls: GroundPoint[][];
  /** True when the game put the building up, as the map has none. */
  generated: boolean;
  /** The way in, towards the nearest road, as a unit direction. */
  front: GroundPoint;
  /** A Hindu temple's flag post (dhwajastambha), in front of its door, where there's room. */
  flagPost?: GroundPoint;
};

/** A pin outside any building takes the nearest one within this many metres. */
const PIN_REACH = 10;
/** A pin inside a building this big or smaller makes it the temple. Bigger ones are blocks of flats with a shrine in them. */
const MAX_PINNED_BUILDING = 1200;
/** Shrines the game builds where a pin has no building: size across, in metres. */
const SHRINE_SIZE: Record<Faith, [number, number]> = {
  hindu: [3, 3],
  kalinga: [7, 9],
  other: [3, 3],
  muslim: [6, 8],
  christian: [6, 9],
};
/** A compound with no building gets a shrine this share of its width, within these sizes. */
const COMPOUND_SHRINE: [number, number, number] = [0.35, 4, 9];
/** The flag post stands this far out from the temple's front wall, in metres, if the temple is at least this big, in square metres. */
const FLAG_POST_OUT = 2.4;
const FLAG_POST_TEMPLE = 40;
const FLAG_POST_RADIUS = 0.45;
/** How far a generated shrine may move from its pin to find room, in metres. */
const SHRINE_SEARCH = 12;
/** At its smallest, a shrine looks this far from its pin, in metres. */
const SHRINE_FAR = 40;

function faithOf({
  religion,
  name = "",
}: Record<string, string | undefined>): Faith {
  if (/jagan+ath/i.test(name)) return "kalinga";
  if (religion === "hindu") return "hindu";
  if (religion === "muslim") return "muslim";
  if (religion === "christian") return "christian";
  if (/temple|mandir|devi|swamy|swami/i.test(name)) return "hindu";
  if (/church|chapel/i.test(name)) return "christian";
  if (/masjid|mosque/i.test(name)) return "muslim";
  return "other";
}

function toOutline(ring: LonLat[]): GroundPoint[] {
  return ring.slice(0, -1).map((position): GroundPoint => {
    const [x, , z] = lonLatToWorld(position);
    return [x, z];
  });
}

function centreOf(outline: GroundPoint[]): GroundPoint {
  return [
    outline.reduce((sum, [x]) => sum + x, 0) / outline.length,
    outline.reduce((sum, [, z]) => sum + z, 0) / outline.length,
  ];
}

const WORSHIP_BUILDINGS = new Set([
  "temple",
  "church",
  "mosque",
  "shrine",
  "chapel",
  "cathedral",
]);

/**
 * Finds every place of worship, marks its buildings `temple`, and returns them.
 * Also takes the Overture pins that only name a mapped place out of `places`.
 */
export function findPlacesOfWorship(
  buildings: BuildingFeature[],
  places: PointFeature[],
  areas: PolygonFeature[],
): { worship: PlaceOfWorship[]; places: PointFeature[] } {
  // Names Overture gives to places OSM has but hasn't named.
  const names = new Map<string, string>();
  const otherPlaces: PointFeature[] = [];
  for (const place of places) {
    const { nameFor, name } = place.properties;
    if (nameFor && name) names.set(nameFor, name);
    else otherPlaces.push(place);
  }
  const nameOf = (feature: {
    id: string;
    properties: Record<string, string | undefined>;
  }) => feature.properties.name ?? names.get(feature.id);

  const outlines = buildings.map((building) =>
    toOutline(building.geometry.coordinates[0]),
  );
  const boxes = outlines.map((outline) => {
    const xs = outline.map(([x]) => x);
    const zs = outline.map(([, z]) => z);
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  });
  const buildingAt = (x: number, z: number): number => {
    for (let i = 0; i < buildings.length; i++) {
      const [minX, maxX, minZ, maxZ] = boxes[i];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      if (isInsideOutline(outlines[i], x, z)) return i;
    }
    return -1;
  };

  const nearestBuilding = (x: number, z: number): number => {
    let nearest = -1;
    let nearestDistance = PIN_REACH;
    for (let i = 0; i < buildings.length; i++) {
      const [minX, maxX, minZ, maxZ] = boxes[i];
      if (
        x < minX - PIN_REACH ||
        x > maxX + PIN_REACH ||
        z < minZ - PIN_REACH ||
        z > maxZ + PIN_REACH
      )
        continue;
      const kind = buildings[i].kind;
      if (
        kind === "apartment" ||
        kind === "office" ||
        getFootprintArea(buildings[i]) > MAX_PINNED_BUILDING
      )
        continue;
      const outline = outlines[i];
      for (let j = 0; j < outline.length; j++) {
        const [ax, az] = outline[j];
        const [bx, bz] = outline[(j + 1) % outline.length];
        const dx = bx - ax;
        const dz = bz - az;
        const length = dx * dx + dz * dz;
        const along =
          length > 0
            ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length))
            : 0;
        const distance = Math.hypot(x - ax - dx * along, z - az - dz * along);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      }
    }
    return nearest;
  };

  const worship: PlaceOfWorship[] = [];
  const claimed = new Set<number>();
  const claim = (
    indexes: number[],
    place: Omit<PlaceOfWorship, "buildingIds">,
  ) => {
    // The biggest building is the main one, where the tower goes.
    const sorted = [...indexes].sort(
      (a, b) => getFootprintArea(buildings[b]) - getFootprintArea(buildings[a]),
    );
    for (const index of sorted) {
      claimed.add(index);
      buildings[index].kind = "temple";
    }
    worship.push({
      ...place,
      buildingIds: sorted.map((index) => buildings[index].id),
    });
  };

  // Buildings tagged as places of worship.
  buildings.forEach((building, index) => {
    const { amenity, building: type } = building.properties;
    if (amenity !== "place_of_worship" && !WORSHIP_BUILDINGS.has(type ?? ""))
      return;
    claim([index], {
      faith: faithOf({ ...building.properties, name: nameOf(building) }),
      name: nameOf(building),
    });
  });

  // Compounds: the buildings inside are the temple's.
  const compounds: GroundPoint[][] = [];
  for (const area of areas) {
    if (area.properties.amenity !== "place_of_worship") continue;
    const compound = toOutline(area.geometry.coordinates[0]);
    compounds.push(compound);
    const inside = outlines
      .map((outline, index) =>
        claimed.has(index) || !isInsideOutline(compound, ...centreOf(outline))
          ? -1
          : index,
      )
      .filter((index) => index >= 0);
    const faith = faithOf({ ...area.properties, name: nameOf(area) });
    if (inside.length > 0)
      claim(inside, { faith, name: nameOf(area), compound });
    else
      worship.push({
        faith,
        name: nameOf(area),
        buildingIds: [],
        compound,
        point: centreOf(compound),
      });
  }

  // Pins: the building they're in, unless it's big, or a shrine of their own.
  for (const place of otherPlaces) {
    if (place.properties.amenity !== "place_of_worship") continue;
    const [x, , z] = lonLatToWorld(place.geometry.coordinates);
    if (!isInsideBounds(x, z, 5)) continue;
    if (compounds.some((compound) => isInsideOutline(compound, x, z))) continue;
    const faith = faithOf(place.properties);
    let index = buildingAt(x, z);
    // A pin on the street beside its temple, as shop pins often are: the nearest small building.
    if (index < 0) index = nearestBuilding(x, z);
    if (index >= 0 && claimed.has(index)) {
      // Already a temple: the pin may at least give it a name, or its style.
      const known = worship.find((item) =>
        item.buildingIds.includes(buildings[index].id),
      );
      if (known && !known.name && place.properties.name)
        known.name = place.properties.name;
      if (known && faith === "kalinga") known.faith = "kalinga";
      continue;
    }
    const building = index >= 0 ? buildings[index] : null;
    if (
      building &&
      getFootprintArea(building) <= MAX_PINNED_BUILDING &&
      building.kind !== "apartment" &&
      building.kind !== "office"
    ) {
      claim([index], { faith, name: place.properties.name });
    } else if (!building) {
      worship.push({
        faith,
        name: place.properties.name,
        buildingIds: [],
        point: [x, z],
      });
    }
  }

  return { worship, places: otherPlaces };
}

/** The way towards the nearest road from a point, or north if no road is near. */
function towardsRoad(roads: RoadIndex, [x, z]: GroundPoint): GroundPoint {
  const near = nearestRoadPiece(roads, x, z, 120);
  if (!near) return [0, -1];
  const { start, end } = near.piece;
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = dx * dx + dz * dz;
  const along =
    length > 0
      ? Math.min(
          1,
          Math.max(0, ((x - start[0]) * dx + (z - start[1]) * dz) / length),
        )
      : 0;
  const toX = start[0] + dx * along - x;
  const toZ = start[1] + dz * along - z;
  const distance = Math.hypot(toX, toZ);
  return distance > 0 ? [toX / distance, toZ / distance] : [0, -1];
}

/** A rectangle `width` across and `depth` deep, facing `front`, its middle at `centre`. */
function rectangle(
  [x, z]: GroundPoint,
  [fx, fz]: GroundPoint,
  width: number,
  depth: number,
): GroundPoint[] {
  const sideX = -fz;
  const sideZ = fx;
  return [
    [
      x + (fx * depth) / 2 + (sideX * width) / 2,
      z + (fz * depth) / 2 + (sideZ * width) / 2,
    ],
    [
      x + (fx * depth) / 2 - (sideX * width) / 2,
      z + (fz * depth) / 2 - (sideZ * width) / 2,
    ],
    [
      x - (fx * depth) / 2 - (sideX * width) / 2,
      z - (fz * depth) / 2 - (sideZ * width) / 2,
    ],
    [
      x - (fx * depth) / 2 + (sideX * width) / 2,
      z - (fz * depth) / 2 + (sideZ * width) / 2,
    ],
  ];
}

/**
 * Turns the places of worship into sites to draw. A pin or an empty compound
 * gets a building of its own, on the nearest clear ground, solid to the rider.
 */
export function planPlacesOfWorship(
  worship: PlaceOfWorship[],
  buildings: BuildingFeature[],
  roads: RoadIndex,
  collisions: CollisionWorld,
  /** Roads and flyovers together: a shrine of the game's own keeps clear of both (World.tsx). */
  clear: RoadIndex = roads,
): WorshipSite[] {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const sites: WorshipSite[] = [];

  for (const place of worship) {
    const outlines = place.buildingIds
      .map((id) => byId.get(id))
      .filter((building): building is BuildingFeature => !!building)
      .map((building) => toOutline(building.geometry.coordinates[0]));

    if (outlines.length > 0) {
      const [outline, ...halls] = outlines;
      sites.push({
        faith: place.faith,
        name: place.name,
        outline,
        halls,
        generated: false,
        front: towardsRoad(roads, centreOf(outline)),
      });
      continue;
    }
    if (!place.point) continue;

    // A building of the game's own: sized to the compound, or a small roadside shrine.
    let [width, depth] = SHRINE_SIZE[place.faith];
    if (place.compound) {
      const xs = place.compound.map(([x]) => x);
      const zs = place.compound.map(([, z]) => z);
      const across = Math.min(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...zs) - Math.min(...zs),
      );
      const size = Math.min(
        COMPOUND_SHRINE[2],
        Math.max(COMPOUND_SHRINE[1], across * COMPOUND_SHRINE[0]),
      );
      width = Math.max(width, size);
      depth = Math.max(depth, size * 1.2);
    }
    const fits = (centre: GroundPoint, front: GroundPoint) => {
      const corners = rectangle(centre, front, width + 0.6, depth + 0.6);
      return [centre, ...corners].every(
        ([x, z]) =>
          isClearOfRoads(clear, x, z, 0.8) &&
          !isNearBuilding(collisions, x, z, 0.2) &&
          (!place.compound || isInsideOutline(place.compound, x, z)),
      );
    };
    let spot: { centre: GroundPoint; front: GroundPoint } | null = null;
    // Smaller and smaller until it fits, down to a roadside shrine.
    for (let shrink = 1; shrink >= 0.4 && !spot; shrink -= 0.2) {
      if (shrink < 1) {
        width = Math.max(3, width * 0.8);
        depth = Math.max(3, depth * 0.8);
      }
      // A pin under a flyover or on a median may need to look further for ground (SHRINE_FAR).
      const search = shrink <= 0.41 ? SHRINE_FAR : SHRINE_SEARCH;
      for (let reach = 0; reach <= search && !spot; reach += 1.5) {
        const tries = reach === 0 ? 1 : Math.max(12, Math.round(reach * 1.5));
        for (let i = 0; i < tries && !spot; i++) {
          const angle = (i / tries) * Math.PI * 2;
          const centre: GroundPoint = [
            place.point[0] + Math.cos(angle) * reach,
            place.point[1] + Math.sin(angle) * reach,
          ];
          const front = towardsRoad(roads, centre);
          if (fits(centre, front)) spot = { centre, front };
        }
      }
    }
    if (!spot) continue;
    const { centre, front } = spot;
    addWall(
      collisions,
      [centre[0] - (front[0] * depth) / 2, centre[1] - (front[1] * depth) / 2],
      [centre[0] + (front[0] * depth) / 2, centre[1] + (front[1] * depth) / 2],
      width,
    );
    sites.push({
      faith: place.faith,
      name: place.name,
      outline: rectangle(centre, front, width, depth),
      halls: [],
      generated: true,
      front,
    });
  }
  for (const site of sites) placeFlagPost(site, roads, collisions);
  return sites;
}

/** How far from `from` along `direction` the outline's edge is: walks out until it leaves. */
export function distanceToEdge(
  outline: GroundPoint[],
  [x, z]: GroundPoint,
  [dx, dz]: GroundPoint,
): number {
  let distance = 0;
  while (
    distance < 80 &&
    isInsideOutline(outline, x + dx * distance, z + dz * distance)
  )
    distance += 0.25;
  return distance;
}

/** A point well inside an outline: its middle if that's inside, or else the inside point furthest from the edges on a grid. */
export function innerPoint(outline: GroundPoint[]): GroundPoint {
  const centre = centreOf(outline);
  if (isInsideOutline(outline, ...centre)) return centre;
  const xs = outline.map(([x]) => x);
  const zs = outline.map(([, z]) => z);
  let best = centre;
  let bestRoom = -1;
  for (let i = 1; i < 12; i++) {
    for (let j = 1; j < 12; j++) {
      const point: GroundPoint = [
        Math.min(...xs) + ((Math.max(...xs) - Math.min(...xs)) * i) / 12,
        Math.min(...zs) + ((Math.max(...zs) - Math.min(...zs)) * j) / 12,
      ];
      if (!isInsideOutline(outline, ...point)) continue;
      const room = Math.min(
        ...[
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map((direction) =>
          distanceToEdge(outline, point, direction as GroundPoint),
        ),
      );
      if (room > bestRoom) {
        bestRoom = room;
        best = point;
      }
    }
  }
  return best;
}

function areaOf(outline: GroundPoint[]): number {
  let doubled = 0;
  outline.forEach(([x, z], index) => {
    const [nextX, nextZ] = outline[(index + 1) % outline.length];
    doubled += x * nextZ - nextX * z;
  });
  return Math.abs(doubled) / 2;
}

/** Puts a flag post in front of a Hindu temple's door, if it's big enough and there's clear ground. */
function placeFlagPost(
  site: WorshipSite,
  roads: RoadIndex,
  collisions: CollisionWorld,
) {
  if (
    (site.faith !== "hindu" && site.faith !== "kalinga") ||
    areaOf(site.outline) < FLAG_POST_TEMPLE
  )
    return;
  const inside = innerPoint(site.outline);
  const out = distanceToEdge(site.outline, inside, site.front) + FLAG_POST_OUT;
  const [x, z]: GroundPoint = [
    inside[0] + site.front[0] * out,
    inside[1] + site.front[1] * out,
  ];
  if (
    !isClearOfRoads(roads, x, z, 0.6) ||
    isNearBuilding(collisions, x, z, FLAG_POST_RADIUS + 0.2)
  )
    return;
  addPost(collisions, x, z, FLAG_POST_RADIUS);
  site.flagPost = [x, z];
}

/** The compounds to wall in, for fencing.ts. */
export function templeCompounds(worship: PlaceOfWorship[]): GroundPoint[][] {
  return worship.flatMap((place) => (place.compound ? [place.compound] : []));
}
