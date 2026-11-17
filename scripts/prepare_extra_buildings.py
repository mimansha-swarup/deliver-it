"""
Buildings that OpenStreetMap hasn't traced yet, from Overture Maps' buildings
theme: footprints traced from satellite images by Google (Open Buildings,
CC BY 4.0) and Microsoft (ML Building Footprints, ODbL). Overture has already
left out any that overlap an OSM building.

Writes public/data/hsr-extra-buildings.geojson with those in the play area,
leaving out any that:
  - overlap a building in the map file (which may be a little older than Overture),
  - stand on a road or its pavement,
  - stand in a park or playground, or on military land,
  - are smaller than a garden shed (most of those are trees or shadows).

Needs DuckDB (with its httpfs and spatial extensions) and Shapely:
    python3 -m venv geo && geo/bin/pip install duckdb shapely
    geo/bin/python scripts/prepare_extra_buildings.py [overture release]
"""

import json
import math
import sys
from pathlib import Path

import duckdb
from shapely.geometry import LineString, Polygon, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / 'public/data/hsr-compact.geojson'
OUT = ROOT / 'public/data/hsr-extra-buildings.geojson'
RELEASE = sys.argv[1] if len(sys.argv) > 1 else '2026-10-21.0'

# The play area (src/world/worldUtils.ts), turned back into longitude and latitude, with a little to spare.
ORIGIN_LON, ORIGIN_LAT = 77.6502, 12.9095
METRES_PER_DEGREE = 111_320
LON_SCALE = math.cos(math.radians(ORIGIN_LAT))
PLAY_AREA = {'minX': -3340, 'maxX': 360, 'minZ': -1720, 'maxZ': 1360}

# The same widths as src/world/roadData.ts, and the old ground's pavement either side.
LANE_WIDTH = 3.5
ROAD_WIDTHS = {'secondary': 9, 'tertiary': 7, 'residential': 5, 'service': 4, 'track': 3}
DEFAULT_ROAD_WIDTH = 5
PAVEMENT = 3
NOT_DRIVABLE = {'footway', 'path'}
GREEN_SPACES = {'park', 'garden', 'playground', 'pitch'}

MIN_AREA = 20  # square metres
MAX_OVERLAP = 0.1  # of a new building's area, with anything already there


def to_metres(lon, lat):
    """East and north of the world origin, in metres, as the game works them out."""
    return ((lon - ORIGIN_LON) * METRES_PER_DEGREE * LON_SCALE, (lat - ORIGIN_LAT) * METRES_PER_DEGREE)


def metric(geometry):
    if geometry.geom_type == 'Polygon':
        return Polygon([to_metres(*p) for p in geometry.exterior.coords])
    if geometry.geom_type == 'LineString':
        return LineString([to_metres(*p) for p in geometry.coords])
    raise ValueError(geometry.geom_type)


def road_width(properties):
    try:
        lanes = float(properties.get('lanes') or 0)
    except ValueError:
        lanes = 0
    if lanes > 0:
        return lanes * LANE_WIDTH
    return ROAD_WIDTHS.get(properties.get('highway', ''), DEFAULT_ROAD_WIDTH)


def main():
    min_lon = ORIGIN_LON + PLAY_AREA['minX'] / (METRES_PER_DEGREE * LON_SCALE)
    max_lon = ORIGIN_LON + PLAY_AREA['maxX'] / (METRES_PER_DEGREE * LON_SCALE)
    max_lat = ORIGIN_LAT - PLAY_AREA['minZ'] / METRES_PER_DEGREE
    min_lat = ORIGIN_LAT - PLAY_AREA['maxZ'] / METRES_PER_DEGREE

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    rows = con.execute(
        f"""
        SELECT id, sources[1].dataset, ST_AsGeoJSON(geometry)
        FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
        WHERE bbox.xmin > {min_lon} AND bbox.xmax < {max_lon} AND bbox.ymin > {min_lat} AND bbox.ymax < {max_lat}
          AND sources[1].dataset <> 'OpenStreetMap'
        """
    ).fetchall()
    print(f'{len(rows)} buildings from satellite tracing in the play area')

    features = json.loads(MAP.read_text())['features']
    existing, blocked = [], []
    for feature in features:
        props, geometry = feature['properties'], feature['geometry']
        if geometry['type'] == 'Polygon':
            polygon = metric(shape(geometry))
            if props.get('building'):
                existing.append(polygon)
            elif props.get('leisure') in GREEN_SPACES or props.get('landuse') == 'military':
                blocked.append(polygon)
        elif geometry['type'] == 'LineString' and props.get('highway') and props['highway'] not in NOT_DRIVABLE:
            blocked.append(metric(shape(geometry)).buffer(road_width(props) / 2 + PAVEMENT * 0.5))

    taken = existing + blocked
    tree = STRtree(taken)
    kept, reasons = [], {'small': 0, 'overlap': 0}
    for overture_id, source, geojson in rows:
        geometry = json.loads(geojson)
        if geometry['type'] != 'Polygon':
            continue
        polygon = metric(shape(geometry))
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
            if polygon.geom_type != 'Polygon':
                continue
        if polygon.area < MIN_AREA:
            reasons['small'] += 1
            continue
        overlap = sum(taken[i].intersection(polygon).area for i in tree.query(polygon))
        if overlap > polygon.area * MAX_OVERLAP:
            reasons['overlap'] += 1
            continue
        coordinates = [[[round(x, 7), round(y, 7)] for x, y in geometry['coordinates'][0]]]
        kept.append(
            {
                'type': 'Feature',
                'id': f'overture/{overture_id}',
                'properties': {'@id': f'overture/{overture_id}', 'building': 'yes', 'source': source},
                'geometry': {'type': 'Polygon', 'coordinates': coordinates},
            }
        )

    OUT.write_text(json.dumps({'type': 'FeatureCollection', 'features': kept}, separators=(',', ':')))
    by_source = {}
    for feature in kept:
        by_source[feature['properties']['source']] = by_source.get(feature['properties']['source'], 0) + 1
    print(f'kept {len(kept)} {by_source}; left out {reasons["small"]} too small, {reasons["overlap"]} on a building, road, park or military land')


if __name__ == '__main__':
    main()
