"""
Places of worship that OpenStreetMap doesn't have, from Overture Maps' places
theme (CDLA Permissive 2.0), such as the Agara Shri Jagannatha Swamy Temple.

Writes public/data/hsr-extra-worship.geojson: points in the play area, tagged
like OSM (amenity=place_of_worship, religion, name), leaving out:
  - places Overture isn't sure of (confidence below MIN_CONFIDENCE),
  - any within MATCH_DISTANCE of a place of worship already in the map file. If
    that one has no name, a point is written with `nameFor` set to its id, and
    the game gives it this name (the Agara Jagannatha temple's compound is
    mapped in OSM, but not named),
  - repeats of each other (the surest one of a cluster is kept).

Needs DuckDB (with its httpfs and spatial extensions):
    python3 -m venv geo && geo/bin/pip install duckdb
    geo/bin/python scripts/prepare_extra_places.py [overture release]
"""

import json
import math
import sys
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
MAP = ROOT / 'public/data/hsr-compact.geojson'
OUT = ROOT / 'public/data/hsr-extra-worship.geojson'
RELEASE = sys.argv[1] if len(sys.argv) > 1 else '2026-10-21.0'

ORIGIN_LON, ORIGIN_LAT = 77.6502, 12.9095
METRES_PER_DEGREE = 111_320
LON_SCALE = math.cos(math.radians(ORIGIN_LAT))
PLAY_AREA = {'minX': -3340, 'maxX': 360, 'minZ': -1720, 'maxZ': 1360}

MIN_CONFIDENCE = 0.6
MATCH_DISTANCE = 40  # metres
RELIGIONS = {
    'hindu_place_of_worship': 'hindu',
    'muslim_place_of_worship': 'muslim',
    'christian_place_of_worship': 'christian',
    'buddhist_place_of_worship': 'buddhist',
    'jewish_place_of_worship': 'jewish',
}


def to_metres(lon, lat):
    return ((lon - ORIGIN_LON) * METRES_PER_DEGREE * LON_SCALE, (lat - ORIGIN_LAT) * METRES_PER_DEGREE)


def centre(geometry):
    if geometry['type'] == 'Point':
        return geometry['coordinates']
    ring = geometry['coordinates'][0][:-1]
    return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]


def main():
    min_lon = ORIGIN_LON + PLAY_AREA['minX'] / (METRES_PER_DEGREE * LON_SCALE)
    max_lon = ORIGIN_LON + PLAY_AREA['maxX'] / (METRES_PER_DEGREE * LON_SCALE)
    max_lat = ORIGIN_LAT - PLAY_AREA['minZ'] / METRES_PER_DEGREE
    min_lat = ORIGIN_LAT - PLAY_AREA['maxZ'] / METRES_PER_DEGREE

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'; SET geometry_always_xy = true;")
    categories = ', '.join(f"'{category}'" for category in RELIGIONS)
    rows = con.execute(
        f"""
        SELECT id, names.primary, basic_category, ST_X(geometry), ST_Y(geometry), confidence, sources[1].dataset
        FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {min_lon} AND {max_lon} AND bbox.ymin BETWEEN {min_lat} AND {max_lat}
          AND basic_category IN ({categories}) AND confidence >= {MIN_CONFIDENCE}
        ORDER BY confidence DESC
        """
    ).fetchall()
    print(f'{len(rows)} places of worship from Overture in the play area')

    # Each mapped place of worship: where, its id, and whether it has a name yet.
    mapped = [
        [*to_metres(*centre(feature['geometry'])), feature['id'], bool(feature['properties'].get('name'))]
        for feature in json.loads(MAP.read_text())['features']
        if feature['properties'].get('amenity') == 'place_of_worship'
    ]
    kept, added = [], []
    for overture_id, name, category, lon, lat, confidence, source in rows:
        x, y = to_metres(lon, lat)
        if any(math.hypot(x - ax, y - ay) < MATCH_DISTANCE for ax, ay in added):
            continue
        near = sorted((math.hypot(x - mx, y - my), place) for place in mapped for mx, my, _, _ in [place] if math.hypot(x - mx, y - my) < MATCH_DISTANCE)
        name_for = None
        if near:
            # Unnamed, and the nearest: it gets this name. Otherwise it's a different place already mapped.
            unnamed = [place for _, place in near if not place[3]]
            if not unnamed or not name:
                continue
            name_for = unnamed[0][2]
            unnamed[0][3] = True
        added.append((x, y))
        properties = {
            '@id': f'overture/{overture_id}',
            'amenity': 'place_of_worship',
            'religion': RELIGIONS[category],
            'name': name,
            'source': f'Overture Maps ({source})',
        }
        if name_for:
            properties['nameFor'] = name_for
        kept.append(
            {
                'type': 'Feature',
                'id': f'overture/{overture_id}',
                'properties': properties,
                'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
            }
        )

    OUT.write_text(json.dumps({'type': 'FeatureCollection', 'features': kept}, separators=(',', ':'), ensure_ascii=False))
    by_religion = {}
    for feature in kept:
        by_religion[feature['properties']['religion']] = by_religion.get(feature['properties']['religion'], 0) + 1
    print(f'kept {len(kept)} {by_religion}')
    for feature in kept:
        if 'jagan' in (feature['properties']['name'] or '').lower():
            print('  ', feature['properties']['name'], feature['geometry']['coordinates'], feature['properties'].get('nameFor', 'new'))
    print(f"{sum(1 for feature in kept if 'nameFor' in feature['properties'])} of them name a place already mapped")


if __name__ == '__main__':
    main()
