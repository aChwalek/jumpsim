#!/usr/bin/env python3
"""The roads and car parks of a drop zone from OpenStreetMap, for the painted
ground (?style=painted): public/dz/<id>/roads.json.

usage: python3 tools/dz/roads.py <id> [--main 10000] [--minor 4000]

Main roads (tertiary and up) are fetched within --main metres of the origin
and of each of the places the drop zone names (`osmAreas`), the others
within --minor. Positions are local metres, x east and z south, in the same
projection as tools/dz/build.py, rounded to the decimetre.

Out:
  {"v": 1, "ways": [[width_m, paved (1|0), x0, z0, x1, z1, ...], ...],
           "areas": [[paved (1|0), x0, z0, x1, z1, ...], ...]}

Tunnels are left out, and bridges longer than 40 m: laid on the relief, they
would run down to the bottom of whatever they cross.
"""

import hashlib
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.expanduser('~/.cache/jumpsim-dz')
UA = 'jumpsim-dz-builder/1.0'
R = 6378137.0

args = sys.argv[1:]
DZ_ID = args[0]
MAIN = float(args[args.index('--main') + 1]) if '--main' in args else 10000.0
MINOR = float(args[args.index('--minor') + 1]) if '--minor' in args else 4000.0

with open(os.path.join(ROOT, 'tools', 'dz', f'{DZ_ID}.json')) as f:
    CONF = json.load(f)
LAT0 = CONF['origin']['lat']
LON0 = CONF['origin']['lon']
K = math.cos(math.radians(LAT0))


# --- Projection: the same as tools/dz/build.py -------------------------------------------
def merc(lat, lon):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


MX0, MY0 = merc(LAT0, LON0)


def local(lat, lon):
    mx, my = merc(lat, lon)
    return (mx - MX0) * K, -(my - MY0) * K


def latlon(x, z):
    mx = MX0 + x / K
    my = MY0 - z / K
    return math.degrees(2 * math.atan(math.exp(my / R)) - math.pi / 2), math.degrees(mx / R)


def bbox_around(metres, cx=0.0, cz=0.0):
    s, w = latlon(cx - metres, cz + metres)
    n, e = latlon(cx + metres, cz - metres)
    return f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'


# --- Overpass, cached like build.py's ---------------------------------------------------
def overpass(query):
    body = 'data=' + urllib.parse.quote(query)
    servers = (*CONF.get('overpass', []), 'https://overpass-api.de/api/interpreter',
               'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter')
    os.makedirs(CACHE, exist_ok=True)
    for attempt in range(3):
        for server in servers:
            path = os.path.join(CACHE, hashlib.sha1((server + body).encode()).hexdigest() + '.json')
            try:
                if not os.path.exists(path):
                    req = urllib.request.Request(server, data=body.encode(), headers={'User-Agent': UA})
                    with urllib.request.urlopen(req, timeout=300) as r:
                        data = r.read()
                    with open(path, 'wb') as f:
                        f.write(data)
                with open(path) as f:
                    result = json.load(f)
                if 'remark' in result and 'error' in result['remark'].lower():
                    raise RuntimeError(result['remark'][:200])
                return result['elements']
            except Exception as e:  # noqa: BLE001
                print('   ', server, 'failed:', str(e)[:200], flush=True)
                if os.path.exists(path):
                    os.remove(path)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError('overpass failed')


# --- Roads ------------------------------------------------------------------------------
# Width of the carriageway by kind of road, m.
WIDTH = {
    'motorway': 11, 'trunk': 10, 'primary': 8.5, 'secondary': 7.5, 'tertiary': 6.5,
    'motorway_link': 6, 'trunk_link': 6, 'primary_link': 6, 'secondary_link': 5.5, 'tertiary_link': 5.5,
    'unclassified': 5, 'residential': 5, 'living_street': 4.5, 'road': 5, 'pedestrian': 5,
    'service': 3.5, 'track': 3,
}
MAIN_KINDS = 'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
MINOR_KINDS = 'unclassified|residential|living_street|road|pedestrian|service|track'
UNPAVED = {'unpaved', 'gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'compacted', 'grass', 'sand', 'mud', 'pebblestone', 'rock',
           'woodchips', 'grass_paver'}


def paved(tags):
    surface = tags.get('surface')
    if surface:
        return surface not in UNPAVED
    # A track is a farm or forest track, unless graded hard.
    return tags.get('highway') != 'track' or tags.get('tracktype') == 'grade1'


def width(tags):
    kind = tags['highway']
    if kind == 'service' and tags.get('service') in ('driveway', 'parking_aisle', 'drive-through'):
        return 3.0
    w = WIDTH.get(kind, 4)
    try:
        # A given width is taken if it is believable.
        given = float(tags.get('width', '').replace('m', '').strip())
        if 2 <= given <= 30:
            w = given
    except ValueError:
        pass
    # One-way main roads are often one carriageway of two.
    if tags.get('oneway') == 'yes' and kind in ('motorway', 'trunk', 'primary'):
        w *= 0.75
    return round(w, 1)


def rdp(points, tolerance):
    if len(points) < 3:
        return points
    (ax, az), (bx, bz) = points[0], points[-1]
    dx, dz = bx - ax, bz - az
    length = math.hypot(dx, dz) or 1e-9
    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        px, pz = points[i]
        d = abs(dx * (az - pz) - dz * (ax - px)) / length
        if d > worst:
            worst, index = d, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return rdp(points[:index + 1], tolerance)[:-1] + rdp(points[index:], tolerance)


def flat(points):
    return [v for p in points for v in (round(p[0], 1), round(p[1], 1))]


def main():
    centres = [(0.0, 0.0)] + [local(*a['centre']) for a in CONF.get('osmAreas', [])]
    parts = []
    for cx, cz in centres:
        big, small = bbox_around(MAIN, cx, cz), bbox_around(MINOR, cx, cz)
        parts.append(f"""  way["highway"~"^({MAIN_KINDS})$"]({big});
  way["highway"~"^({MINOR_KINDS})$"]({small});
  way["amenity"="parking"]({small});""")
    print(f'  osm roads {DZ_ID}', flush=True)
    elements = overpass('[out:json][timeout:180];\n(\n' + '\n'.join(parts) + '\n);\nout geom;')
    ways, areas, seen = [], [], set()
    skipped = {'tunnel': 0, 'bridge': 0}
    for e in elements:
        if e['type'] != 'way' or e['id'] in seen or not e.get('geometry'):
            continue
        seen.add(e['id'])
        tags = e.get('tags', {})
        points = [local(g['lat'], g['lon']) for g in e['geometry'] if g]
        if len(points) < 2:
            continue
        if tags.get('tunnel', 'no') != 'no' or tags.get('covered') == 'yes' or tags.get('location') == 'underground':
            skipped['tunnel'] += 1
            continue
        if tags.get('bridge', 'no') != 'no':
            length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))
            if length > 40:
                skipped['bridge'] += 1
                continue
        closed = points[0] == points[-1] and len(points) >= 4
        if tags.get('amenity') == 'parking':
            if tags.get('parking', 'surface') not in ('surface', 'lane', 'street_side') or not closed:
                continue
            areas.append([1 if paved(tags) else 0, *flat(rdp(points[:-1], 0.5))])
            continue
        if closed and tags.get('area') == 'yes':
            areas.append([1 if paved(tags) else 0, *flat(rdp(points[:-1], 0.5))])
            continue
        ways.append([width(tags), 1 if paved(tags) else 0, *flat(rdp(points, 0.5))])
    out_dir = os.path.join(ROOT, 'public', 'dz', DZ_ID)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'roads.json')
    with open(path, 'w') as f:
        json.dump({'v': 1, 'ways': ways, 'areas': areas}, f, separators=(',', ':'))
    print(f'  {len(ways)} roads, {len(areas)} areas, left out {skipped}: {path} ({os.path.getsize(path) // 1024} KB)')


main()
