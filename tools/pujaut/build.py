"""Builds src/world/pujautData.ts from OpenStreetMap and IGN extracts around
the Avignon-Pujaut aerodrome (LFNT).

Inputs (a folder, first argument), all in local metres about the centre of
the parachute landing area (x east, z south):
  pujaut-dz-geometry.json     aerodrome: boundary, runways, landing area,
                              buildings, paved areas (from the SIA VAC chart
                              and OSM)
  osm_core_local.json         OSM ways within 2 km: buildings, roads, tree rows
  osm_landuse_local.json      OSM land use polygons within ~6 km
  osm_surroundings_local.json OSM main roads, water, rivers within ~6 km
  heightmap_101x100m_ign.json IGN RGE ALTI elevations, 101 x 101 at 100 m

Output: a TypeScript module of plain arrays. Data (c) OpenStreetMap
contributors, ODbL; IGN RGE ALTI, Licence Ouverte 2.0.

  python3 tools/pujaut/build.py <input folder> src/world/pujautData.ts
"""

import json
import math
import sys

src = sys.argv[1]
out = sys.argv[2]


def load(name):
    with open(f'{src}/{name}') as f:
        return json.load(f)


geo = load('pujaut-dz-geometry.json')
core = load('osm_core_local.json')
landuse = load('osm_landuse_local.json')['elements']
around = load('osm_surroundings_local.json')['elements']
hmap = load('heightmap_101x100m_ign.json')

SIZE = hmap['size']
SPACING = hmap['spacing']
HALF = (SIZE - 1) * SPACING / 2
PLAIN = hmap['originElevation']
# Must match createPujaut: ground this close to the plain is laid flat.
FLAT_BELOW = 12
heights = hmap['heights']


def rise_at(x, z):
    """Height above the plain from the grid, bilinear, clamped at the edge."""
    c = min(SIZE - 1 - 1e-9, max(0.0, (x + HALF) / SPACING))
    r = min(SIZE - 1 - 1e-9, max(0.0, (z + HALF) / SPACING))
    c0, r0 = int(c), int(r)
    fc, fr = c - c0, r - r0
    h = (heights[r0][c0] * (1 - fc) + heights[r0][c0 + 1] * fc) * (1 - fr) + (
        heights[r0 + 1][c0] * (1 - fc) + heights[r0 + 1][c0 + 1] * fc
    ) * fr
    return h - PLAIN


def on_plain(points, margin=0.0):
    return all(rise_at(x, z) < FLAT_BELOW - margin for x, z in points)


def rdp(points, tolerance):
    if len(points) < 3:
        return points
    (x0, z0), (x1, z1) = points[0], points[-1]
    dx, dz = x1 - x0, z1 - z0
    length = math.hypot(dx, dz) or 1e-9
    worst, index = 0.0, 0
    for i in range(1, len(points) - 1):
        x, z = points[i]
        d = abs((x - x0) * dz - (z - z0) * dx) / length
        if d > worst:
            worst, index = d, i
    if worst <= tolerance:
        return [points[0], points[-1]]
    return rdp(points[: index + 1], tolerance)[:-1] + rdp(points[index:], tolerance)


def simplify_ring(points, tolerance):
    ring = points[:-1] if points[0] == points[-1] else points[:]
    if len(ring) < 4:
        return ring
    # Split at the point farthest from the first so RDP has two open halves.
    far = max(range(len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    a = rdp(ring[: far + 1], tolerance)
    b = rdp(ring[far:] + [ring[0]], tolerance)
    return a[:-1] + b[:-1]


def area(ring):
    s = 0.0
    for i in range(len(ring)):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % len(ring)]
        s += x0 * z1 - x1 * z0
    return abs(s) / 2


def centre(ring):
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def flat(points):
    return [round(v) for p in points for v in p]


def hull(points):
    pts = sorted(set((p[0], p[1]) for p in points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def oriented_rect(points):
    """Smallest rectangle round a footprint: centre, length, width, compass heading of the long side."""
    h = hull(points)
    best = None
    for i in range(len(h)):
        x0, z0 = h[i]
        x1, z1 = h[(i + 1) % len(h)]
        a = math.atan2(z1 - z0, x1 - x0)
        ca, sa = math.cos(a), math.sin(a)
        us = [x * ca + z * sa for x, z in h]
        vs = [-x * sa + z * ca for x, z in h]
        size = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or size < best[0]:
            u, v = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (size, a, max(us) - min(us), max(vs) - min(vs), u * ca - v * sa, u * sa + v * ca)
    _, a, du, dv, cx, cz = best
    if dv > du:
        a += math.pi / 2
        du, dv = dv, du
    # Direction (cos a, sin a) in x east, z south: compass heading from north.
    heading = math.degrees(math.atan2(math.cos(a), -math.sin(a))) % 180
    return cx, cz, du, dv, heading


# --- Relief -----------------------------------------------------------------
relief = [round((h - PLAIN) * 2) / 2 for row in heights for h in row]

# --- Land classes -----------------------------------------------------------
CLASS = {
    'vineyard': 'v', 'orchard': 'o', 'farmland': 'f', 'meadow': 'g', 'grass': 'g', 'grassland': 'g',
    'greenfield': 'g', 'recreation_ground': 'g', 'forest': 'w', 'wood': 'w', 'scrub': 's',
    'residential': 'r', 'industrial': 'i', 'retail': 'i', 'commercial': 'i', 'railway': 'i',
    'construction': 'q', 'brownfield': 'q', 'quarry': 'q', 'landfill': 'q', 'bare_rock': 'q',
    'greenhouse_horticulture': 'h', 'allotments': 'a', 'farmyard': 'a', 'cemetery': 'c',
    'water': 'l', 'reservoir': 'l', 'basin': 'l',
}
polys = []
for e in landuse:
    pts = e.get('points')
    if e['type'] != 'way' or not pts or len(pts) < 4:
        continue
    t = e['tags']
    kind = CLASS.get(t.get('landuse')) or CLASS.get(t.get('natural'))
    if not kind:
        continue
    cx, cz = centre(pts)
    if math.hypot(cx, cz) > 6500:
        continue
    polys.append((kind, pts))


def inside(x, z, ring):
    hit = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            hit = not hit
        j = i
    return hit


def bbox(ring):
    xs = [p[0] for p in ring]
    zs = [p[1] for p in ring]
    return min(xs), min(zs), max(xs), max(zs)


boxed = [(k, p, bbox(p)) for k, p in polys]
# Smaller polygons win where they overlap bigger ones (a wood in a park).
boxed.sort(key=lambda b: -area(b[1]))
land = []
for row in range(SIZE):
    line = []
    z = row * SPACING - HALF
    for col in range(SIZE):
        x = col * SPACING - HALF
        cls = '.'
        for k, p, (x0, z0, x1, z1) in boxed:
            if x0 <= x <= x1 and z0 <= z <= z1 and inside(x, z, p):
                cls = k
        line.append(cls)
    land.append(''.join(line))

# Flat polygons on the plain, drawn as they are.
areas = []
for kind, pts in polys:
    if kind in 'wsr' or not on_plain(pts):
        continue
    ring = simplify_ring(pts, 1.5 if math.hypot(*centre(pts)) < 2000 else 4)
    if len(ring) >= 3 and area(ring) > 150:
        areas.append([kind] + flat(ring))

# Villages, for scattering houses beyond the buildings mapped one by one.
CORE_RADIUS = 1900
villages = []
for kind, pts in polys:
    if kind != 'r':
        continue
    ring = simplify_ring(pts, 5)
    if len(ring) >= 3 and area(ring) > 2000:
        villages.append(flat(ring))

# --- Buildings ----------------------------------------------------------------
HEIGHT = {'hangar': 8, 'church': 14, 'industrial': 8, 'warehouse': 8, 'farm_auxiliary': 5, 'greenhouse': 3.5}
buildings = []
named = {b['osmWay']: b for b in geo['buildings']}
for w in core['ways']:
    t = w['tags']
    if 'building' not in t or len(w['points']) < 4:
        continue
    x, z, length, width, heading = oriented_rect(w['points'][:-1])
    if length < 2.5 or width < 2:
        continue
    known = named.get(w['id'])
    height = known['heightGuess_m'] if known else HEIGHT.get(t['building'], 6.5 if length * width > 60 else 3.5)
    roof = 0 if t['building'] == 'greenhouse' else 1
    buildings.append([round(x, 1), round(z, 1), round(length, 1), round(width, 1), round(heading), height, roof])

# --- Roads, tracks, tree rows -----------------------------------------------
WIDTH = {
    'motorway': 22, 'trunk': 14, 'primary': 8, 'secondary': 7, 'tertiary': 6, 'unclassified': 5,
    'residential': 5, 'service': 4, 'track': 3,
}
roads = []
seen = set()
for w in core['ways'] + [e for e in around if e['type'] == 'way']:
    hw = w['tags'].get('highway')
    if hw not in WIDTH or w['id'] in seen or not w.get('points'):
        continue
    seen.add(w['id'])
    pts = rdp(w['points'], 2)
    # Only what lies on the plain: roads over the hills are left to the hills.
    keep = [p for p in pts if math.hypot(*p) < 6000]
    if len(keep) < 2:
        continue
    dirt = 1 if hw == 'track' or w['tags'].get('surface') in ('unpaved', 'gravel', 'dirt', 'ground', 'compacted') else 0
    roads.append([WIDTH[hw], dirt] + flat(keep))

tree_rows = []
for w in core['ways']:
    if w['tags'].get('natural') == 'tree_row' or w['tags'].get('barrier') == 'hedge':
        tree_rows.append(flat(rdp(w['points'], 1)))

water = []
for e in around + landuse:
    t = e.get('tags', {})
    if e['type'] != 'way' or not e.get('points') or len(e['points']) < 4:
        continue
    if t.get('natural') == 'water' or t.get('landuse') in ('reservoir', 'basin'):
        ring = simplify_ring(e['points'], 3)
        if len(ring) >= 3 and area(ring) > 200 and math.hypot(*centre(ring)) < 7000:
            key = tuple(flat(ring)[:4])
            if key not in seen:
                seen.add(key)
                water.append(flat(ring))

# --- Aerodrome -----------------------------------------------------------------
aero = {
    'boundary': flat(geo['aerodromeBoundary'][:-1]),
    'landingArea': flat(geo['landingArea']['polygon'][:-1]),
    'runways': [
        {
            'ref': r['ref'],
            'a': [round(v, 1) for v in r['northOrWestEnd']],
            'b': [round(v, 1) for v in r['southOrEastEnd']],
            'width': r['width_m'],
        }
        for r in geo['runways']
    ],
    # Rectangles round the field and the landing area: x, z, length, width, heading.
    'fieldRect': [round(v, 1) for v in oriented_rect(geo['aerodromeBoundary'][:-1])],
    'landingRect': [round(v, 1) for v in oriented_rect(geo['landingArea']['polygon'][:-1])],
    'sandCircle': geo['altLandingCircle']['centre'] + [geo['altLandingCircle']['diameter_m'] / 2],
    'rail': [flat(rdp(line, 5)) for line in geo['surroundings']['lgvMediterranee']],
    'windsock': geo['windsock'],
    'paved': [
        [p['name'], round(p['centre'][0], 1), round(p['centre'][1], 1), round(p['length_m'], 1), round(p['width_m'], 1),
         round((p['longAxisBearingTrue']) % 180)]
        for p in geo['pavedAreas']
    ],
}

with open(out, 'w') as f:
    f.write('// Generated by tools/pujaut/build.py: do not edit by hand.\n')
    f.write('// Around the Avignon-Pujaut aerodrome (LFNT), local metres about the centre\n')
    f.write('// of the parachute landing area, x east, z south.\n')
    f.write('// Data (c) OpenStreetMap contributors, ODbL; IGN RGE ALTI, Licence Ouverte 2.0;\n')
    f.write('// aerodrome layout from the SIA VAC chart of LFNT.\n\n')
    f.write('/* eslint-disable */\n')
    f.write(f'export const ORIGIN = {{ lat: {hmap["originLat"]}, lon: {hmap["originLon"]}, elevation: {PLAIN} }};\n\n')
    f.write('/** Ground above the plain, m, on a grid centred on the origin: rows north to south. */\n')
    f.write(f'export const RELIEF = {{ size: {SIZE}, spacing: {SPACING}, flatBelow: {FLAT_BELOW}, heights: {json.dumps(relief, separators=(",", ":"))} }};\n\n')
    f.write('/**\n * Land use on the same grid, one letter a point: v vineyard, o orchard, f farmland,\n'
            ' * g grass, w wood, s scrub, r houses, i industry, q quarry or bare, h greenhouses,\n'
            ' * a allotments and farmyards, c cemetery, l water, . unmapped.\n */\n')
    f.write(f'export const LAND = {json.dumps(land, separators=(",", ":"))};\n\n')
    f.write('/** Land use polygons lying on the plain: class letter, then x, z pairs. */\n')
    f.write(f'export const AREAS: (string | number)[][] = {json.dumps(areas, separators=(",", ":"))};\n\n')
    f.write('/** Built-up areas, x, z pairs. */\n')
    f.write(f'export const VILLAGES: number[][] = {json.dumps(villages, separators=(",", ":"))};\n\n')
    f.write(f'/** Buildings mapped one by one, within {CORE_RADIUS} m: x, z, length, width, heading of the long side, height, roof (0 flat). */\n')
    f.write(f'export const BUILDINGS: number[][] = {json.dumps(buildings, separators=(",", ":"))};\n\n')
    f.write('/** Roads and tracks: width, dirt (1) or paved (0), then x, z pairs. */\n')
    f.write(f'export const ROADS: number[][] = {json.dumps(roads, separators=(",", ":"))};\n\n')
    f.write('/** Rows of trees (windbreaks): x, z pairs. */\n')
    f.write(f'export const TREE_ROWS: number[][] = {json.dumps(tree_rows, separators=(",", ":"))};\n\n')
    f.write('/** Ponds, basins and the Rhone: x, z pairs. */\n')
    f.write(f'export const WATER: number[][] = {json.dumps(water, separators=(",", ":"))};\n\n')
    f.write(f'export const AERODROME = {json.dumps(aero, separators=(",", ":"), ensure_ascii=False)};\n')

print('areas', len(areas), 'villages', len(villages), 'buildings', len(buildings),
      'roads', len(roads), 'tree rows', len(tree_rows), 'water', len(water))
