"""Fills a drop zone's OpenStreetMap data from the OSM API when no Overpass
server can be reached.

  python3 tools/dz/osm_api.py <id> [--cache DIR] [--radius 4600]

Downloads the map around the origin of tools/dz/<id>.json in small boxes
(api.openstreetmap.org/api/0.6/map), keeps what tools/dz/build.py would have
asked Overpass for, in the same shape, and writes it into the build's state
file. Then run the other steps:

  python3 tools/dz/build.py <id> --only relief,imagery

The API serves whole boxes, so this reaches less far than Overpass does:
buildings, trees and woods are complete (they are only used within 4.5 km),
water stops at the radius instead of 15 km, and there is no coastline: fine
for a drop zone inland with no lake on the horizon.
"""

import json
import math
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
args = sys.argv[1:]
DZ_ID = args[0]
CACHE = os.path.expanduser('~/.cache/jumpsim-dz')
RADIUS = 4600
for i, a in enumerate(args):
    if a == '--cache':
        CACHE = args[i + 1]
    if a == '--radius':
        RADIUS = float(args[i + 1])
os.makedirs(os.path.join(CACHE, 'osm-api'), exist_ok=True)

with open(os.path.join(ROOT, 'tools', 'dz', f'{DZ_ID}.json')) as f:
    CONF = json.load(f)
LAT0 = CONF['origin']['lat']
LON0 = CONF['origin']['lon']
dlat = math.degrees(RADIUS / 6378137.0)
dlon = dlat / math.cos(math.radians(LAT0))

nodes = {}
ways = {}
relations = {}


def read(path):
    for el in ET.parse(path).getroot():
        tags = {t.get('k'): t.get('v') for t in el.findall('tag')}
        if el.tag == 'node':
            nodes[el.get('id')] = (float(el.get('lat')), float(el.get('lon')), tags)
        elif el.tag == 'way':
            ways[el.get('id')] = ([n.get('ref') for n in el.findall('nd')], tags)
        elif el.tag == 'relation':
            relations[el.get('id')] = ([(m.get('type'), m.get('ref'), m.get('role')) for m in el.findall('member')], tags)


def fetch(w, s, e, n, depth=0):
    """One box; the API refuses those holding more than 50 000 nodes, which are then cut in four."""
    path = os.path.join(CACHE, 'osm-api', f'{DZ_ID}-{w:.5f}-{s:.5f}-{e:.5f}-{n:.5f}.xml')
    if not os.path.exists(path):
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}'
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'jumpsim-dz-builder/1.0'})
                with urllib.request.urlopen(req, timeout=120) as r:
                    data = r.read()
                with open(path, 'wb') as f:
                    f.write(data)
                time.sleep(1)
                break
            except urllib.error.HTTPError as err:
                if err.code == 400 and depth < 4:
                    mx, my = (w + e) / 2, (s + n) / 2
                    for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                        fetch(*box, depth + 1)
                    return
                print('   ', url, 'failed:', err, flush=True)
                time.sleep(5 * (attempt + 1))
            except Exception as err:  # noqa: BLE001
                print('   ', url, 'failed:', err, flush=True)
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError('OSM API failed')
    read(path)


STEPS = 5
for j in range(STEPS):
    for i in range(STEPS):
        w = LON0 - dlon + 2 * dlon * i / STEPS
        s = LAT0 - dlat + 2 * dlat * j / STEPS
        print(f'  osm box {j * STEPS + i + 1}/{STEPS * STEPS}', flush=True)
        fetch(w, s, w + 2 * dlon / STEPS, s + 2 * dlat / STEPS)


def geometry(refs):
    return [{'lat': nodes[r][0], 'lon': nodes[r][1]} for r in refs if r in nodes]


def wanted_core(t):
    return ('building' in t or t.get('natural') in ('tree_row', 'wood', 'scrub', 'wetland') or t.get('barrier') == 'hedge'
            or t.get('leisure') == 'swimming_pool' or t.get('landuse') in ('forest', 'orchard', 'vineyard'))


def wanted_water(t):
    return t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') in ('reservoir', 'basin')


def way_out(wid):
    refs, tags = ways[wid]
    return {'type': 'way', 'id': int(wid), 'tags': tags, 'geometry': geometry(refs)}


def relation_out(rid):
    members, tags = relations[rid]
    out = []
    for kind, ref, role in members:
        # A way the boxes cut off comes whole or not at all: a ring missing a side is dropped by the builder.
        if kind == 'way' and ref in ways:
            out.append({'type': 'way', 'ref': int(ref), 'role': role, 'geometry': geometry(ways[ref][0])})
    return {'type': 'relation', 'id': int(rid), 'tags': tags, 'members': out}


core = [way_out(w) for w, (_, t) in ways.items() if wanted_core(t)]
core += [relation_out(r) for r, (_, t) in relations.items()
         if 'building' in t or t.get('landuse') == 'forest' or t.get('natural') in ('wood', 'scrub', 'wetland')]
core += [{'type': 'node', 'id': int(n), 'lat': lat, 'lon': lon, 'tags': t} for n, (lat, lon, t) in nodes.items() if t.get('natural') == 'tree']
water = [way_out(w) for w, (_, t) in ways.items() if wanted_water(t)]
water += [relation_out(r) for r, (_, t) in relations.items() if t.get('natural') == 'water']

state_path = os.path.join(CACHE, f'{DZ_ID}-state.json')
state = {}
if os.path.exists(state_path):
    with open(state_path) as f:
        state = json.load(f)
state['osm'] = {'core': core, 'water': water, 'coast': []}
with open(state_path, 'w') as f:
    json.dump(state, f)
print(f'  {len(core)} buildings, trees and woods, {len(water)} waters', flush=True)
