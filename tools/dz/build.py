"""Builds a real drop zone for jumpsim from open data.

  python3 tools/dz/build.py <id> [--cache DIR] [--only relief,imagery,osm]

Reads tools/dz/<id>.json (what is specific to the drop zone: aerodrome,
landing areas, target, buildings of the DZ, pattern, wind; WGS84 lat/lon)
and downloads, once, into the cache:
  - relief: Mapzen/AWS Terrain Tiles (Terrarium PNG; SRTM, EU-DEM, GEBCO...);
  - imagery: orthophotos (IGN BD ORTHO in France and overseas, PNOA in Spain,
    SWISSIMAGE in Switzerland, DGU DOF5 in Croatia, the Province of Trento's
    2015 flight in Trentino, NAIP in the United States) near the field,
    Sentinel-2 cloudless (EOX) out to the horizon;
  - OpenStreetMap through Overpass: buildings, trees, woods, water, coastline.

Writes:
  public/dz/<id>/near.jpg, mid.jpg, far.jpg   imagery draped on the relief
  src/world/data/<id>.ts                      everything else, in local metres

The local frame is web mercator scaled to true size at the origin, so the
imagery tiles map onto it without resampling distortion: x east, z south,
metres, origin at the centre of the main landing area.
"""

import concurrent.futures
import hashlib
import json
import math
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

sys.setrecursionlimit(100000)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R = 6378137.0
UA = 'jumpsim-dz-builder/1.0'

args = sys.argv[1:]
DZ_ID = args[0]
CACHE = os.path.expanduser('~/.cache/jumpsim-dz')
ONLY = None
for i, a in enumerate(args):
    if a == '--cache':
        CACHE = args[i + 1]
    if a == '--only':
        ONLY = set(args[i + 1].split(','))
os.makedirs(CACHE, exist_ok=True)

with open(os.path.join(ROOT, 'tools', 'dz', f'{DZ_ID}.json')) as f:
    CONF = json.load(f)

LAT0 = CONF['origin']['lat']
LON0 = CONF['origin']['lon']
K = math.cos(math.radians(LAT0))


# --- Projection -----------------------------------------------------------------
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


def world_px(mx, my, zoom):
    """Global pixel coordinates of a mercator point at a zoom level."""
    n = 256 * 2 ** zoom
    return (mx + math.pi * R) / (2 * math.pi * R) * n, (math.pi * R - my) / (2 * math.pi * R) * n


def ll_list(points):
    return [local(p[0], p[1]) for p in points]


# --- Downloads ----------------------------------------------------------------
def cache_path(url, ext, data=None):
    key = hashlib.sha1((url + (data or '')).encode()).hexdigest()
    return os.path.join(CACHE, key[:2], key + ext)


# A busy map server (the USGS's above all) may turn a request away a few times running.
TRIES = 7


def cached(url, ext, data=None, content_type=None):
    path = cache_path(url, ext, data)
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    headers = {'User-Agent': UA, **({'Content-Type': content_type} if content_type else {})}
    req = urllib.request.Request(url, data=data.encode() if data else None, headers=headers)
    for attempt in range(TRIES):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            # A map server in trouble can still answer 200, with an XML report
            # where the picture should be: once more, then a blank tile.
            if ext in ('.jpg', '.png', '.tif') and body[:1] == b'<':
                if attempt == TRIES - 1:
                    body = b''
                    break
                raise ConnectionError('service exception')
            break
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                body = b''
                break
            # 429: too many requests for the service's quota; once more, a little later.
            if (e.code < 500 and e.code != 429) or attempt == TRIES - 1:
                raise
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            # A connection dropped by a busy server: once more, a little later.
            if attempt == TRIES - 1:
                raise
        time.sleep(min(2 ** attempt, 30))
    tmp = path + '.part'
    with open(tmp, 'wb') as f:
        f.write(body)
    os.replace(tmp, path)
    return path


def fetch_all(jobs, threads=8):
    with concurrent.futures.ThreadPoolExecutor(threads) as pool:
        return list(pool.map(lambda j: cached(*j), jobs))


def decode(path, w, h):
    """Raw RGB bytes of an image file, through ffmpeg."""
    out = subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-'],
        capture_output=True, check=True,
    ).stdout
    if len(out) != w * h * 3:
        raise RuntimeError(f'{path}: got {len(out)} bytes')
    return out


def encode(rgb, w, h, path, quality=3):
    subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-i', '-',
         '-q:v', str(quality), path],
        input=bytes(rgb), check=True,
    )


# --- Tile sources ---------------------------------------------------------------
SOURCES = {
    'ign': 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS'
           '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    'pnoa': 'https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage'
            '&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    'sentinel': 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg',
    'terrarium': 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    'swissimage': 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    # Croatia: the DGU's orthophoto of 2019/20 (Istria flown in 2020), a WMS asked
    # one web mercator tile at a time. Its later years carry a watermark for
    # anonymous users; this INSPIRE service does not.
    'dgu': 'https://geoportal.dgu.hr/services/inspire/orthophoto_2019_2020/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
           '&LAYERS=OI.OrthoimageCoverage&STYLES=&CRS=EPSG:3857&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg',
    # Trentino: the Province of Trento's orthophoto of 2015 (20 cm), a WMS too.
    'pat': 'https://siat.provincia.tn.it/geoserver/stem/ecw-rgb-2015/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
           '&LAYERS=ecw-rgb-2015&STYLES=&CRS=EPSG:3857&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg',
    # United States: the USDA's NAIP (0.6 m, public domain) through the USGS
    # National Map, an ArcGIS image server asked one web mercator tile at a time.
    'naip': 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={bbox}'
            '&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image',
}


def tile_url(source, zoom, x, y):
    """A tile's address: its column and row, or for a WMS, its web mercator box."""
    span = 2 * math.pi * R / 2 ** zoom
    x0, y1 = -math.pi * R + x * span, math.pi * R - y * span
    bbox = f'{x0:.3f},{y1 - span:.3f},{x0 + span:.3f},{y1:.3f}'
    return SOURCES[source].format(z=zoom, x=x, y=y, bbox=bbox)


def is_blank(path, photo):
    """
    Whether a tile holds no picture: missing or, from a photo service, all
    one colour, as they send beyond their flights. The satellite's open sea
    is all one blue too, but it is the sea: there is nothing else to show.
    """
    size = os.path.getsize(path)
    if size == 0:
        return True
    if size > 4000 or not photo:
        return False
    try:
        raw = decode(path, 256, 256)
    except (subprocess.CalledProcessError, RuntimeError):
        return True
    # A glacier's snow is nearly as even: among snow, only a tile all of one
    # colour, to the last level, is taken for no picture.
    least = 0.5 if CONF.get('snow') else 9
    for c in range(3):
        channel = raw[c::3][::7]
        mean = sum(channel) / len(channel)
        if sum((v - mean) ** 2 for v in channel) / len(channel) > least:
            return False
    return True


def mosaic(source, zoom, size_m, px_out, label, cx=0.0, cz=0.0):
    """
    The square of `size_m` metres centred on (cx, cz), the origin unless
    given, from a tile source, as raw RGB `px_out` pixels a side, and a mask
    of the pixels the source has no data for (1 = missing).
    """
    half = size_m / 2 / K
    mx, my = MX0 + cx / K, MY0 - cz / K
    left, top = world_px(mx - half, my + half, zoom)
    right, bottom = world_px(mx + half, my - half, zoom)
    tx0, ty0, tx1, ty1 = int(left // 256), int(top // 256), int(right // 256), int(bottom // 256)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f'  {label}: {source} z{zoom}, {cols}x{rows} tiles', flush=True)
    jobs = [(tile_url(source, zoom, x, y), '.jpg') for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
    # The USGS's image server mosaics each tile on demand: a few at a time.
    paths = fetch_all(jobs, 3 if source == 'naip' else 8)
    # Stitch with ffmpeg's tile filter: frames in reading order. Tiles that are
    # missing or blank (sea beyond the photo flights) become black, masked.
    work = os.path.join(CACHE, 'stitch', f'{DZ_ID}-{label}')
    os.makedirs(work, exist_ok=True)
    for f_ in os.listdir(work):
        os.remove(os.path.join(work, f_))
    black = os.path.join(work, 'black.jpeg')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=256x256', '-frames:v', '1', black], check=True)
    blank = []
    for i, p in enumerate(paths):
        empty = is_blank(p, source != 'sentinel')
        blank.append(empty)
        os.symlink(black if empty else p, os.path.join(work, f'{i:05d}.jpg'))
    big_w, big_h = cols * 256, rows * 256
    crop_x, crop_y = left - tx0 * 256, top - ty0 * 256
    crop_w, crop_h = right - left, bottom - top
    vf = (f'tile={cols}x{rows},crop={crop_w:.3f}:{crop_h:.3f}:{crop_x:.3f}:{crop_y:.3f},'
          f'scale={px_out}:{px_out}:flags=lanczos')
    raw = subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-f', 'image2', '-framerate', '1', '-i', os.path.join(work, '%05d.jpg'),
         '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        capture_output=True, check=True,
    ).stdout
    rgb = bytearray(raw)
    # Mask, per output pixel, from the blank tiles...
    mask = bytearray(px_out * px_out)
    scale = crop_w / px_out
    for ty in range(rows):
        for tx in range(cols):
            if not blank[ty * cols + tx]:
                continue
            i0 = max(0, int((tx * 256 - crop_x) / scale) - 2)
            i1 = min(px_out, int(((tx + 1) * 256 - crop_x) / scale) + 3)
            j0 = max(0, int((ty * 256 - crop_y) / scale) - 2)
            j1 = min(px_out, int(((ty + 1) * 256 - crop_y) / scale) + 3)
            for j in range(j0, j1):
                mask[j * px_out + i0:j * px_out + i1] = b'\x01' * (i1 - i0)
    # ...and from the open sea beyond the photo flights, which comes out
    # white: big white patches only, not white roofs. Not among glaciers,
    # whose snow is as white and as wide.
    B = 32
    for bj in range(0, px_out, B) if not CONF.get('snow') else ():
        for bi in range(0, px_out, B):
            white = []
            for j in range(bj, min(px_out, bj + B)):
                for i in range(bi, min(px_out, bi + B)):
                    o = (j * px_out + i) * 3
                    if rgb[o] > 248 and rgb[o + 1] > 248 and rgb[o + 2] > 248:
                        white.append(j * px_out + i)
            if len(white) > B * B * 0.3:
                for k in white:
                    mask[k] = 1
                # And its neighbours, smeared by the scaling.
                for j in range(max(0, bj - 2), min(px_out, bj + B + 2)):
                    for i in range(max(0, bi - 2), min(px_out, bi + B + 2)):
                        o = (j * px_out + i) * 3
                        if rgb[o] > 225 and rgb[o + 1] > 225 and rgb[o + 2] > 225:
                            mask[j * px_out + i] = 1
    return rgb, mask


def sample_rgb(rgb, size_px, u, v):
    """Bilinear colour at (u, v) in [0, 1] of a square raw RGB image."""
    x = min(size_px - 1.001, max(0.0, u * size_px - 0.5))
    y = min(size_px - 1.001, max(0.0, v * size_px - 0.5))
    x0, y0 = int(x), int(y)
    fx, fy = x - x0, y - y0
    out = []
    for c in range(3):
        a = rgb[(y0 * size_px + x0) * 3 + c]
        b = rgb[(y0 * size_px + x0 + 1) * 3 + c]
        d = rgb[((y0 + 1) * size_px + x0) * 3 + c]
        e = rgb[((y0 + 1) * size_px + x0 + 1) * 3 + c]
        out.append((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy)
    return out


def match_colours(fine, fine_mask, fine_px, fine_m, coarse, coarse_px, coarse_m, fine_c=(0, 0), coarse_c=(0, 0)):
    """
    Per channel, the scale and offset bringing the coarse level to the colours
    of the finer one over the ground they share, mean and spread: two sources
    never agree, and the satellite is darker and more saturated than the photos.
    """
    acc_f = [[0.0, 0.0] for _ in range(3)]
    acc_c = [[0.0, 0.0] for _ in range(3)]
    n = 0
    step = max(1, fine_px // 256)
    for j in range(0, fine_px, step):
        for i in range(0, fine_px, step):
            k = j * fine_px + i
            if fine_mask[k]:
                continue
            x = fine_c[0] + (i + 0.5) / fine_px * fine_m - fine_m / 2
            z = fine_c[1] + (j + 0.5) / fine_px * fine_m - fine_m / 2
            c = sample_rgb(coarse, coarse_px, (x - coarse_c[0]) / coarse_m + 0.5, (z - coarse_c[1]) / coarse_m + 0.5)
            for ch in range(3):
                f = fine[k * 3 + ch]
                acc_f[ch][0] += f
                acc_f[ch][1] += f * f
                acc_c[ch][0] += c[ch]
                acc_c[ch][1] += c[ch] * c[ch]
            n += 1
    if n == 0:
        return [(1.0, 0.0)] * 3
    out = []
    for ch in range(3):
        mf = acc_f[ch][0] / n
        mc = acc_c[ch][0] / n
        sf = math.sqrt(max(1e-6, acc_f[ch][1] / n - mf * mf))
        sc = math.sqrt(max(1e-6, acc_c[ch][1] / n - mc * mc))
        scale = sf / sc
        out.append((scale, mf - scale * mc))
    return out


def apply_gain(rgb, gain):
    lut = [[max(0, min(255, int(v * a + b + 0.5))) for v in range(256)] for a, b in gain]
    for k in range(0, len(rgb), 3):
        rgb[k] = lut[0][rgb[k]]
        rgb[k + 1] = lut[1][rgb[k + 1]]
        rgb[k + 2] = lut[2][rgb[k + 2]]


def zoom_for(metres_per_px):
    """Smallest zoom whose ground pixel is no bigger than wanted."""
    z = 0
    while 2 * math.pi * R * K / (256 * 2 ** z) > metres_per_px:
        z += 1
    return z


# --- Relief ------------------------------------------------------------------------
_dem_tiles = {}


def dem_tile(zoom, x, y):
    key = (zoom, x, y)
    if key not in _dem_tiles:
        path = cached(SOURCES['terrarium'].format(z=zoom, x=x, y=y), '.png')
        raw = decode(path, 256, 256)
        _dem_tiles[key] = [raw[i * 3] * 256 + raw[i * 3 + 1] + raw[i * 3 + 2] / 256 - 32768 for i in range(256 * 256)]
    return _dem_tiles[key]


def elevation(lat, lon, zoom):
    mx, my = merc(lat, lon)
    px, py = world_px(mx, my, zoom)
    px -= 0.5
    py -= 0.5
    x0, y0 = math.floor(px), math.floor(py)
    fx, fy = px - x0, py - y0

    def at(x, y):
        t = dem_tile(zoom, x // 256, y // 256)
        return t[(y % 256) * 256 + (x % 256)]

    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy


def relief_grid(size, spacing, zoom, label):
    half = (size - 1) * spacing / 2
    points = [(r, c, *latlon(c * spacing - half, r * spacing - half)) for r in range(size) for c in range(size)]
    # Fetch the tiles first, in parallel.
    tiles = set()
    for _, _, lat, lon in points:
        px, py = world_px(*merc(lat, lon), zoom)
        for dx in (-1, 1):
            for dy in (-1, 1):
                tiles.add((int((px + dx) // 256), int((py + dy) // 256)))
    print(f'  relief {label}: {size}x{size} at {spacing} m, z{zoom}, {len(tiles)} tiles', flush=True)
    fetch_all([(SOURCES['terrarium'].format(z=zoom, x=x, y=y), '.png') for x, y in tiles])
    return [elevation(lat, lon, zoom) for _, _, lat, lon in points]


# --- Overpass ------------------------------------------------------------------
def overpass(query, label):
    print(f'  osm {label}', flush=True)
    body = 'data=' + urllib.parse.quote(query)
    for attempt in range(3):
        # A drop zone can name its own servers first, such as a national mirror.
        for server in (*CONF.get('overpass', []), 'https://overpass-api.de/api/interpreter',
                       'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'):
            try:
                path = cached(server, '.json', body)
                with open(path) as f:
                    result = json.load(f)
                if 'remark' in result and 'error' in result['remark'].lower():
                    raise RuntimeError(result['remark'][:200])
                return result['elements']
            except Exception as e:  # noqa: BLE001
                print('   ', server, 'failed:', str(e)[:200], flush=True)
                if os.path.exists(cache_path(server, '.json', body)):
                    os.remove(cache_path(server, '.json', body))
    raise RuntimeError('overpass failed')


def bbox_around(metres, cx=0.0, cz=0.0):
    s, w = latlon(cx - metres, cz + metres)
    n, e = latlon(cx + metres, cz - metres)
    return f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'


# --- Geometry helpers ------------------------------------------------------------
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
    far = max(range(len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    a = rdp(ring[: far + 1], tolerance)
    b = rdp(ring[far:] + [ring[0]], tolerance)
    return a[:-1] + b[:-1]


def ring_area(ring):
    s = 0.0
    for i in range(len(ring)):
        x0, z0 = ring[i]
        x1, z1 = ring[(i + 1) % len(ring)]
        s += x0 * z1 - x1 * z0
    return s / 2


def centre(ring):
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


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
    heading = math.degrees(math.atan2(math.cos(a), -math.sin(a))) % 180
    return cx, cz, du, dv, heading


def flat(points, digits=0):
    if digits == 0:
        return [round(v) for p in points for v in p]
    return [round(v, digits) for p in points for v in p]


def chains(ways):
    """Joins ways that meet end to end into longer lines, keeping their direction."""
    lines = [list(w) for w in ways if len(w) >= 2]
    key = lambda p: (round(p[0], 2), round(p[1], 2))  # noqa: E731
    merged = True
    while merged:
        merged = False
        starts = {}
        for i, l in enumerate(lines):
            if l is not None and key(l[0]) != key(l[-1]):
                starts.setdefault(key(l[0]), i)
        for i, l in enumerate(lines):
            if l is None or key(l[0]) == key(l[-1]):
                continue
            j = starts.get(key(l[-1]))
            if j is not None and j != i and lines[j] is not None:
                lines[i] = l + lines[j][1:]
                lines[j] = None
                merged = True
                break
    return [l for l in lines if l is not None]


def relation_rings(element):
    """Outer and inner rings of a multipolygon relation, from its members' geometry."""
    outer, inner = [], []
    for m in element.get('members', []):
        if m.get('type') != 'way' or 'geometry' not in m:
            continue
        pts = [(g['lat'], g['lon']) for g in m['geometry'] if g]
        (inner if m.get('role') == 'inner' else outer).append(pts)

    def close(ways):
        out = []
        pool = [w for w in ways if w]
        while pool:
            ring = pool.pop(0)
            changed = True
            while ring[0] != ring[-1] and changed:
                changed = False
                for k, w in enumerate(pool):
                    if w[0] == ring[-1]:
                        ring = ring + w[1:]
                    elif w[-1] == ring[-1]:
                        ring = ring + w[::-1][1:]
                    elif w[-1] == ring[0]:
                        ring = w + ring[1:]
                    elif w[0] == ring[0]:
                        ring = w[::-1] + ring[1:]
                    else:
                        continue
                    pool.pop(k)
                    changed = True
                    break
            if ring[0] == ring[-1] and len(ring) >= 4:
                out.append(ring)
        return out

    return close(outer), close(inner)


def sea_polygons(coast_ways, half):
    """
    The sea inside the square of half-side `half`, from coastline ways (land
    on their left): polygons, each with the islands in it as holes.
    """
    lines = chains([ll_list(w) for w in coast_ways])
    islands = []
    segments = []

    def inb(p):
        return -half <= p[0] <= half and -half <= p[1] <= half

    def cross_edge(a, b):
        """Where the step from a (inside) to b (outside) crosses the square."""
        t_best, hit = 2.0, None
        for axis in (0, 1):
            for bound in (-half, half):
                d = b[axis] - a[axis]
                if d == 0:
                    continue
                t = (bound - a[axis]) / d
                if 0 <= t <= 1 and t < t_best:
                    other = a[1 - axis] + t * (b[1 - axis] - a[1 - axis])
                    if -half - 1e-6 <= other <= half + 1e-6:
                        t_best = t
                        hit = (bound, other) if axis == 0 else (other, bound)
        return hit

    for line in lines:
        closed = math.hypot(line[0][0] - line[-1][0], line[0][1] - line[-1][1]) < 0.01
        if closed and all(inb(p) for p in line):
            islands.append(line[:-1])
            continue
        if closed:
            # Rotate the ring so that it starts outside the square.
            k = next((i for i, p in enumerate(line) if not inb(p)), None)
            ring = line[:-1]
            line = ring[k:] + ring[:k] + [ring[k]]
        current = None
        for i, p in enumerate(line):
            if inb(p):
                if current is None:
                    if i == 0:
                        current = {'pts': [p], 'open_start': True}
                    else:
                        entry = cross_edge(p, line[i - 1])
                        current = {'pts': [entry, p]}
                else:
                    current['pts'].append(p)
            elif current is not None:
                current['pts'].append(cross_edge(line[i - 1], p))
                segments.append(current)
                current = None
        if current is not None:
            print('    coastline ends inside the square: dropped a piece of', len(current['pts']), 'points')
    segments = [s for s in segments if not s.get('open_start')]

    def perimeter(p):
        """Clockwise position on the square seen north-up: from the NW corner east along the north edge."""
        x, z = p
        if abs(z + half) < 1e-6:
            return x + half
        if abs(x - half) < 1e-6:
            return 2 * half + (z + half)
        if abs(z - half) < 1e-6:
            return 4 * half + (half - x)
        return 6 * half + (half - z)

    corners = [(0, (-half, -half)), (2 * half, (half, -half)), (4 * half, (half, half)), (6 * half, (-half, half))]
    total = 8 * half
    polys = []
    if segments:
        for s in segments:
            s['in'] = perimeter(s['pts'][0])
            s['out'] = perimeter(s['pts'][-1])
        used = [False] * len(segments)
        for start in range(len(segments)):
            if used[start]:
                continue
            ring = []
            k = start
            while True:
                used[k] = True
                ring.extend(segments[k]['pts'])
                t = segments[k]['out']
                # Next entry clockwise from this exit.
                nxt = min(range(len(segments)), key=lambda j: (segments[j]['in'] - t) % total)
                t_next = segments[nxt]['in']
                span = (t_next - t) % total
                for tc, pc in sorted(corners, key=lambda c: (c[0] - t) % total):
                    if 0 < (tc - t) % total < span:
                        ring.append(pc)
                if nxt == start:
                    break
                if used[nxt]:
                    break
                k = nxt
            polys.append({'ring': ring, 'holes': []})
    else:
        polys.append({'ring': [(-half, -half), (half, -half), (half, half), (-half, half)], 'holes': []})
    for isle in islands:
        x, z = isle[0]
        for p in polys:
            if inside(x, z, p['ring']):
                p['holes'].append(isle)
                break
    return polys


# --- Bridges --------------------------------------------------------------------------------
class BridgeFrame:
    """
    A bridge's deck in the local frame: its ends (those of the OSM way), its
    length along the axis, straight or an arc of `radius_m` (positive if it
    bends to the right from the first end to the second), and its piers
    (metres along it from the first end), the published spans laid from
    `firstPier_m`. As in src/world/bridge.ts.
    """

    def __init__(self, b):
        (ax, az), (bx, bz) = local(*b['ends'][0]), local(*b['ends'][1])
        self.a, self.b = (ax, az), (bx, bz)
        chord = math.hypot(bx - ax, bz - az)
        ux, uz = (bx - ax) / chord, (bz - az) / chord
        self.radius = abs(b.get('radius_m', 0))
        if self.radius < chord / 2:
            self.radius = 0
            self.length = chord
            self.u, self.r = (ux, uz), (-uz, ux)
        else:
            R = self.radius
            self.right = 1 if b['radius_m'] > 0 else -1
            off = math.sqrt(R * R - (chord / 2) ** 2) * self.right
            self.c = ((ax + bx) / 2 - uz * off, (az + bz) / 2 + ux * off)
            self.angle_a = math.atan2(az - self.c[1], ax - self.c[0])
            sweep = self.wrap(math.atan2(bz - self.c[1], bx - self.c[0]) - self.angle_a)
            self.turn = 1 if sweep > 0 else -1
            self.length = R * abs(sweep)
        self.piers = [b['firstPier_m']]
        for span in b['spans_m'][1:-1]:
            self.piers.append(self.piers[-1] + span)

    @staticmethod
    def wrap(t):
        return math.atan2(math.sin(t), math.cos(t))

    def local(self, x, z):
        """Metres along the axis and to its right of a point."""
        if not self.radius:
            dx, dz = x - self.a[0], z - self.a[1]
            return dx * self.u[0] + dz * self.u[1], dx * self.r[0] + dz * self.r[1]
        rho = math.hypot(x - self.c[0], z - self.c[1])
        s = self.radius * self.wrap(math.atan2(z - self.c[1], x - self.c[0]) - self.angle_a) * self.turn
        return s, (self.radius - rho) * self.right

    def world(self, s, u):
        """The point `s` metres along the axis and `u` to its right."""
        if not self.radius:
            return self.a[0] + self.u[0] * s + self.r[0] * u, self.a[1] + self.u[1] * s + self.r[1] * u
        t = self.angle_a + self.turn * s / self.radius
        rho = self.radius - u * self.right
        return self.c[0] + rho * math.cos(t), self.c[1] + rho * math.sin(t)


BRIDGES = [BridgeFrame(b) for b in CONF.get('bridges', [])]


def erase_bridges(rgb, px, size_m):
    """
    Paints out the decks the photos show lying on the valley floor, where the
    3D bridge now stands over it: each side of the band is mirrored in from the
    ground beside it, and the two halves meet with a fade along the middle.
    """
    m_px = size_m / px
    for conf, f in zip(CONF.get('bridges', []), BRIDGES):
        if not conf.get('inPhotos'):
            continue
        half = conf['width_m'] / 2 + conf.get('photoMargin_m', 4)
        to_px = lambda x, z: ((x / size_m + 0.5) * px - 0.5, (z / size_m + 0.5) * px - 0.5)  # noqa: E731
        # The band's bounds, from points all along both its edges.
        edge = [to_px(*f.world(s, u)) for s in [-4 + (f.length + 8) * k / 64 for k in range(65)] for u in (-half, half)]
        i0, i1 = max(0, int(min(c[0] for c in edge))), min(px - 1, int(max(c[0] for c in edge)) + 1)
        j0, j1 = max(0, int(min(c[1] for c in edge))), min(px - 1, int(max(c[1] for c in edge)) + 1)
        src = bytes(rgb)

        def at(s, u):
            i, j = to_px(*f.world(s, u))
            i, j = min(px - 1, max(0, round(i))), min(px - 1, max(0, round(j)))
            k = (j * px + i) * 3
            return src[k:k + 3]

        fade = max(3.0, m_px * 2)
        count = 0
        for j in range(j0, j1 + 1):
            z = ((j + 0.5) / px - 0.5) * size_m
            for i in range(i0, i1 + 1):
                x = ((i + 0.5) / px - 0.5) * size_m
                s, u = f.local(x, z)
                if s < -4 or s > f.length + 4 or abs(u) > half:
                    continue
                # Mirrored in from either side, the ground just past the band.
                left = at(s, -2 * half - u if u < 0 else -2 * half + u)
                right = at(s, 2 * half - u if u > 0 else 2 * half + u)
                t = min(1.0, max(0.0, (u + fade) / (2 * fade)))
                k = (j * px + i) * 3
                for c in range(3):
                    rgb[k + c] = int(left[c] * (1 - t) + right[c] * t + 0.5)
                count += 1
        print(f'  painted out {conf["name"]}: {count} pixels', flush=True)


# =================================================================================
print('build', DZ_ID, flush=True)
data_out = os.path.join(ROOT, 'src', 'world', 'data', f'{DZ_ID}.ts')
img_dir = os.path.join(ROOT, 'public', 'dz', DZ_ID)
os.makedirs(os.path.dirname(data_out), exist_ok=True)
os.makedirs(img_dir, exist_ok=True)
state_path = os.path.join(CACHE, f'{DZ_ID}-state.json')
state = {}
if os.path.exists(state_path):
    with open(state_path) as f:
        state = json.load(f)

# --- Relief -------------------------------------------------------------------------
NEAR = {'size': CONF.get('nearRelief', {}).get('size', 121), 'spacing': 100}
FAR = {'size': 161, 'spacing': 500}
if ONLY is None or 'relief' in ONLY:
    plain = elevation(LAT0, LON0, 13)
    near = relief_grid(NEAR['size'], NEAR['spacing'], 13, 'near')
    far = relief_grid(FAR['size'], FAR['spacing'], 10, 'far')
    state['relief'] = {'plain': plain, 'near': near, 'far': far}
    print(f'  plain at {plain:.1f} m', flush=True)

# --- Fine relief, for cliffs and valleys ------------------------------------------------
# The terrain tiles round off a cliff over a hundred metres, and the near grid,
# every 100 m, fills a narrow valley in. Where there is one to jump into, a
# square of finer relief is laid over the near grid: from a national survey
# where one is open (`survey`: swissalti3d), else from the terrain tiles at
# their finest (terrarium), which follow a valley floor better than the grid
# does but know no more than the tiles do. Its sides fall on the 100 m lines.
# Open surveys: swissALTI3D (swissalti3d), the IGN's RGE ALTI (rgealti) and the Province of Trento's LiDAR (pat).
FINE = CONF.get('fineRelief')


def lv95(lat, lon):
    """Swiss LV95 east and north of a WGS84 point, m: swisstopo's approximate formulas, to a metre or so."""
    p = (lat * 3600 - 169028.66) / 10000
    l = (lon * 3600 - 26782.5) / 10000
    e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
    n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return e, n


def swissalti3d(points):
    """Heights of WGS84 points from swissALTI3D at 2 m, a 1 km tile at a time."""
    import numpy as np  # noqa: PLC0415  Only this survey needs them.
    from PIL import Image  # noqa: PLC0415
    lv = [lv95(lat, lon) for lat, lon in points]
    keys = sorted({(int(e // 1000), int(n // 1000)) for e, n in lv})
    stac = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items'
    print(f'  fine relief: swissALTI3D, {len(keys)} tiles', flush=True)

    def tile(key):
        with open(cached(f'{stac}?bbox={",".join(str(v) for v in key_bbox(key))}', '.json')) as f:
            items = json.load(f)['features']
        name = f'{key[0]}-{key[1]}'
        item = max((i for i in items if i['id'].endswith(name)), key=lambda i: i['id'])
        href = next(a['href'] for a in item['assets'].values() if a['href'].endswith('.tif') and a.get('eo:gsd') == 2)
        return np.array(Image.open(cached(href, '.tif')), dtype=np.float32)

    def key_bbox(key):
        lat0, lon0 = wgs84(key[0] * 1000 + 500, key[1] * 1000 + 500)
        return [round(lon0 - 0.001, 5), round(lat0 - 0.001, 5), round(lon0 + 0.001, 5), round(lat0 + 0.001, 5)]

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        tiles = dict(zip(keys, pool.map(tile, keys)))
    out = []
    for e, n in lv:
        # Pixel centres every 2 m, rows from the north edge of the tile.
        key = (int(e // 1000), int(n // 1000))
        t = tiles[key]
        c = min(498.999, max(0.0, (e - key[0] * 1000) / 2 - 0.5))
        r = min(498.999, max(0.0, ((key[1] + 1) * 1000 - n) / 2 - 0.5))
        c0, r0 = int(c), int(r)
        fc, fr = c - c0, r - r0
        out.append(float((t[r0, c0] * (1 - fc) + t[r0, c0 + 1] * fc) * (1 - fr) + (t[r0 + 1, c0] * (1 - fc) + t[r0 + 1, c0 + 1] * fc) * fr))
    return out


def terrarium(points):
    """Heights of WGS84 points from the terrain tiles at their finest zoom."""
    zoom = 15
    tiles = set()
    for lat, lon in points:
        px, py = world_px(*merc(lat, lon), zoom)
        for dx in (-1, 1):
            for dy in (-1, 1):
                tiles.add((int((px + dx) // 256), int((py + dy) // 256)))
    print(f'  fine relief: terrain tiles z{zoom}, {len(tiles)} tiles', flush=True)
    fetch_all([(SOURCES['terrarium'].format(z=zoom, x=x, y=y), '.png') for x, y in tiles])
    return [elevation(lat, lon, zoom) for lat, lon in points]


def rgealti(points, resource='ign_rge_alti_wld', threads=4, label='RGE ALTI'):
    """
    Heights of WGS84 points from the IGN's RGE ALTI (1 m to 5 m) through the
    Géoplateforme's altimetry service, 5000 points a request.
    """
    url = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
    batches = [points[i:i + 5000] for i in range(0, len(points), 5000)]
    print(f'  fine relief: {label}, {len(batches)} requests', flush=True)

    def batch(pts):
        body = json.dumps({'lon': '|'.join(f'{p[1]:.7f}' for p in pts), 'lat': '|'.join(f'{p[0]:.7f}' for p in pts),
                           'resource': resource, 'zonly': 'true'})
        with open(cached(url, '.json', body, 'application/json')) as f:
            return json.load(f)['elevations']

    with concurrent.futures.ThreadPoolExecutor(threads) as pool:
        heights = [h for part in pool.map(batch, batches) for h in part]
    if len(heights) != len(points) or min(heights) < -1000:
        raise RuntimeError(f'{label}: no height for some points')
    return heights


def lidarhd(points):
    """
    Heights from the IGN's LiDAR HD terrain model (50 cm), through the same
    service: where it has been flown, the high mountains included, it is far
    truer than the RGE ALTI, made there from photos (80 m out on a summit of
    the Aiguilles de Chamonix). The service counts requests: two at a time.
    """
    return rgealti(points, 'ign_lidar_hd_mnt_mono_wld', 2, 'LiDAR HD')


def utm32(lat, lon):
    """UTM zone 32 north east and north of a WGS84 point, m: Krüger's series to the fourth order, well under a millimetre."""
    f = 1 / 298.257223563
    n = f / (2 - f)
    a = 6378137.0 / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    alpha = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16 + 41 * n ** 4 / 180,
             13 * n ** 2 / 48 - 3 * n ** 3 / 5 + 557 * n ** 4 / 1440,
             61 * n ** 3 / 240 - 103 * n ** 4 / 140,
             49561 * n ** 4 / 161280]
    e = math.sqrt(f * (2 - f))
    phi, lam = math.radians(lat), math.radians(lon - 9)
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi, eta = math.atan2(t, math.cos(lam)), math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    x = eta + sum(alpha[j] * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j in range(4))
    y = xi + sum(alpha[j] * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j in range(4))
    return 500000 + 0.9996 * a * x, 0.9996 * a * y


# The Province of Trento's LiDAR of 2006-2009: a DTM in 2 km tiles, GeoTIFFs at
# 1 m where people live and in the valleys, at 2 m elsewhere, in UTM 32N. Its
# index, a WFS layer, names the tiles over a box.
PAT_INDEX = ('https://siat.provincia.tn.it/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature'
             '&typeName=stem:inqlid2009_dtm_asc&outputFormat=application/json&bbox={},{},{},{},EPSG:32632')
PAT_DTM = 'https://siatservices.provincia.tn.it/idt/raster/lidar_2009_pat_dtm_{}/{}.tif'


def pat(points):
    """Heights of WGS84 points from the Province of Trento's LiDAR DTM, a 2 km tile at a time."""
    import numpy as np  # noqa: PLC0415  Only the surveys need them.
    from PIL import Image  # noqa: PLC0415
    utm = [utm32(lat, lon) for lat, lon in points]
    box = [math.floor(min(e for e, _ in utm)), math.floor(min(n for _, n in utm)),
           math.ceil(max(e for e, _ in utm)), math.ceil(max(n for _, n in utm))]
    with open(cached(PAT_INDEX.format(*box), '.json')) as f:
        names = sorted({os.path.basename(t['properties']['location']).split('.')[0] for t in json.load(f)['features']})
    print(f'  fine relief: PAT LiDAR, {len(names)} tiles', flush=True)

    def tile(name):
        # At 1 m if flown so, else at 2 m.
        path = cached(PAT_DTM.format('1mX1m', name), '.tif')
        if os.path.getsize(path) == 0:
            path = cached(PAT_DTM.format('2mX2m', name), '.tif')
        im = Image.open(path)
        x0, y0 = im.tag_v2[33922][3:5]
        return np.array(im, dtype=np.float32), x0, y0, im.tag_v2[33550][0]

    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        tiles = list(pool.map(tile, names))
    out = []
    for e, n in utm:
        for t, x0, y0, step in tiles:
            # Pixel centres every `step` metres, rows from the north edge of the tile.
            c = (e - x0) / step - 0.5
            r = (y0 - n) / step - 0.5
            if not (0 <= c < t.shape[1] - 1 and 0 <= r < t.shape[0] - 1):
                continue
            c0, r0 = int(c), int(r)
            corners = t[r0:r0 + 2, c0:c0 + 2]
            if corners.min() < -1000:
                continue  # No data there: the next tile overlapping it may have some.
            fc, fr = c - c0, r - r0
            out.append(float((corners[0, 0] * (1 - fc) + corners[0, 1] * fc) * (1 - fr) + (corners[1, 0] * (1 - fc) + corners[1, 1] * fc) * fr))
            break
        else:
            raise RuntimeError(f'no LiDAR at {e:.0f} E, {n:.0f} N')
    return out


def wgs84(e, n):
    """The other way, to WGS84 latitude and longitude."""
    y = (e - 2600000) / 1e6
    x = (n - 1200000) / 1e6
    l = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3
    p = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x ** 3
    return p * 100 / 36, l * 100 / 36


SURVEYS = {'swissalti3d': swissalti3d, 'terrarium': terrarium, 'rgealti': rgealti, 'lidarhd': lidarhd, 'pat': pat}

if FINE and (ONLY is None or 'relief' in ONLY):
    step = FINE['spacing_m']
    if 'box_m' in FINE:
        # A rectangle (west, north, east, south, local metres), its sides on the
        # mesh's lines: 100 m apart out to the near grid's reach, 400 beyond.
        bx0, bz0, bx1, bz1 = FINE['box_m']
        cx, cz = (bx0 + bx1) / 2, (bz0 + bz1) / 2
        cols, rows = int((bx1 - bx0) / step) + 1, int((bz1 - bz0) / step) + 1
    else:
        cx, cz = local(*FINE['centre'])
        cx, cz = round(cx / 100) * 100, round(cz / 100) * 100
        cols = rows = int(FINE['size_m'] / step) + 1
    x0, z0 = cx - (cols - 1) * step / 2, cz - (rows - 1) * step / 2
    grid = [latlon(x0 + c * step, z0 + r * step) for r in range(rows) for c in range(cols)]
    survey = SURVEYS[FINE.get('survey', 'swissalti3d')]
    heights = survey(grid + [(LAT0, LON0)])
    # The landing area is the plain: this survey says best how high it is.
    state['relief']['plain'] = heights.pop()
    state['fine'] = {'x': cx, 'z': cz, 'size': cols, 'rows': rows, 'spacing': step, 'heights': heights}
    print(f'  fine relief {cols}x{rows} at {step} m about ({cx}, {cz}), plain at {state["relief"]["plain"]:.1f} m', flush=True)


def exit_lips():
    """Where each exit's run ends, local metres: the lip given, or the run's end from where it starts."""
    if CONF.get('exits'):
        return [local(*e['lip']) for e in CONF['exits']]
    if CONF.get('base') and 'bridge' not in CONF['base']:
        b = CONF['base']
        sx, sz = local(b['lat'], b['lon'])
        h = math.radians(b['heading_deg'])
        return [(sx + math.sin(h) * b['runUp_m'], sz - math.cos(h) * b['runUp_m'])]
    return []


# Finer still about a BASE exit on a cliff (`fineRelief.exit`): the lip, the
# slab behind it and the rocks round it, which the eye sees from a metre or
# two. A square centred on each lip, its sides on the lines of the fine grid,
# from the same survey.
EXIT_RELIEF = FINE.get('exit') if FINE else None
if EXIT_RELIEF and exit_lips() and (ONLY is None or 'relief' in ONLY):
    fine = state['fine']
    step = fine['spacing']
    if EXIT_RELIEF['size_m'] % step:
        raise ValueError(f'fineRelief.exit.size_m must be a multiple of {step}')
    fx0 = fine['x'] - (fine['size'] - 1) * step / 2
    fz0 = fine['z'] - (fine.get('rows', fine['size']) - 1) * step / 2
    squares = []
    for lip_x, lip_z in exit_lips():
        ex0 = fx0 + round((lip_x - EXIT_RELIEF['size_m'] / 2 - fx0) / step) * step
        ez0 = fz0 + round((lip_z - EXIT_RELIEF['size_m'] / 2 - fz0) / step) * step
        size = int(EXIT_RELIEF['size_m'] / EXIT_RELIEF['spacing_m']) + 1
        grid = [latlon(ex0 + c * EXIT_RELIEF['spacing_m'], ez0 + r * EXIT_RELIEF['spacing_m']) for r in range(size) for c in range(size)]
        survey = SURVEYS[FINE.get('survey', 'swissalti3d')]
        ecx, ecz = ex0 + EXIT_RELIEF['size_m'] / 2, ez0 + EXIT_RELIEF['size_m'] / 2
        squares.append({'x': ecx, 'z': ecz, 'size': size, 'spacing': EXIT_RELIEF['spacing_m'], 'heights': survey(grid)})
        print(f'  exit relief {size}x{size} at {EXIT_RELIEF["spacing_m"]} m about ({ecx}, {ecz})', flush=True)
    state['exitRelief'] = squares[0]
    state['exitReliefs'] = squares
PLAIN = state['relief']['plain']

# --- Imagery -------------------------------------------------------------------------
IMG = CONF.get('imageryLevels', {})
# Their centre, local metres, to the metre: the origin unless the drop zone's lines lie elsewhere.
IMG_C = tuple(round(v) for v in local(*IMG['centre'])) if 'centre' in IMG else (0, 0)
LEVELS = [
    # name, metres a side, pixels a side, source, centre
    ('far', 81920, 2048, 'sentinel', (0, 0)),
    ('mid', IMG.get('mid_m', 16384), 4096, CONF['imagery'], IMG_C),
    ('near', IMG.get('near_m', 4096), 4096, CONF['imagery'], IMG_C),
]


def spot_centres():
    """Squares of photo at 1 m about each exit and each landing, where the levels are coarser: centres, local metres."""
    if 'spots_m' not in IMG:
        return []
    out = []
    for e in CONF.get('exits', []):
        for c in (local(*e['lip']), local(e['target']['lat'], e['target']['lon'])):
            out.append((round(c[0]), round(c[1])))
    return out


SPOT_PX = 1024
if ONLY is None or 'imagery' in ONLY:
    levels = {}
    for name, size_m, size_px, source, middle in LEVELS:
        zoom = min(zoom_for(size_m / size_px * 1.25), 18 if source != 'sentinel' else 13)
        rgb, mask = mosaic(source, zoom, size_m, size_px, name, *middle)
        levels[name] = (rgb, mask, size_px, size_m, middle)
    # Colours of the satellite level matched to the photos over the ground they share.
    far_rgb, far_mask, far_px, far_m, far_c = levels['far']
    mid_rgb, mid_mask, mid_px, mid_m, mid_c = levels['mid']
    gain = match_colours(mid_rgb, mid_mask, mid_px, mid_m, far_rgb, far_px, far_m, mid_c, far_c)
    print('  far scale and offset to match the photos', [(round(a, 2), round(b, 1)) for a, b in gain], flush=True)
    apply_gain(far_rgb, gain)
    work = os.path.join(CACHE, 'stitch', f'{DZ_ID}-blend')
    os.makedirs(work, exist_ok=True)

    def raw_file(name, data):
        path = os.path.join(work, name)
        with open(path, 'wb') as f:
            f.write(data)
        return path

    def blend(fine, coarse, label, sigma):
        """
        Where the fine level has no data, the coarse one shows through, with
        a soft edge: the mask is blurred, then doubled so that it stays full
        over the hole and fades out round it. The edge of the photos out at
        sea follows the tiles, in steps, and its sea is not the same blue as
        the satellite's: it takes a wide fade to hide.
        """
        rgb, mask, px, size_m, (fx, fz) = fine
        c_rgb, c_px, c_m, (cx, cz) = coarse
        if not any(mask):
            return rgb
        side = c_px * size_m / c_m
        off_x = c_px / 2 + (fx - cx) / c_m * c_px - side / 2
        off_z = c_px / 2 + (fz - cz) / c_m * c_px - side / 2
        mask_path = raw_file(f'{label}-mask.gray', bytes(255 if m else 0 for m in mask))
        out = subprocess.run(
            ['ffmpeg', '-loglevel', 'error',
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{px}x{px}', '-i', raw_file(f'{label}.rgb', rgb),
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{c_px}x{c_px}', '-i', raw_file(f'{label}-under.rgb', c_rgb),
             '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', f'{px}x{px}', '-i', mask_path,
             '-filter_complex',
             f'[1]crop={side:.3f}:{side:.3f}:{off_x:.3f}:{off_z:.3f},scale={px}:{px}:flags=bicubic,format=gbrp[under];'
             f'[0]format=gbrp[top];'
             f'[2]gblur=sigma={sigma},lut=y=min(val*2\\,255),format=gbrp[m];'
             f'[top][under][m]maskedmerge,format=rgb24',
             '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
            capture_output=True, check=True,
        ).stdout
        print(f'  {label}: {sum(mask)} pixels from the level beneath', flush=True)
        return bytearray(out)

    mid_rgb = blend(levels['mid'], (far_rgb, far_px, far_m, far_c), 'mid', 100)
    near_rgb = blend(levels['near'], (mid_rgb, mid_px, mid_m, mid_c), 'near', 100)
    erase_bridges(mid_rgb, mid_px, mid_m)
    erase_bridges(near_rgb, levels['near'][2], levels['near'][3])
    for name, rgb, px in (('far', far_rgb, far_px), ('mid', mid_rgb, mid_px), ('near', near_rgb, levels['near'][2])):
        encode(rgb, px, px, os.path.join(img_dir, f'{name}.jpg'), quality={'near': 5, 'mid': 6, 'far': 6}[name])
        print(f'  wrote {name}.jpg', os.path.getsize(os.path.join(img_dir, f"{name}.jpg")) // 1024, 'KB', flush=True)
    # The squares at 1 m, side by side in one picture, two to a row.
    spots = spot_centres()
    if spots:
        cells = 2 if len(spots) <= 4 else 3
        side = cells * SPOT_PX
        atlas = bytearray(side * side * 3)
        for k, (sx, sz) in enumerate(spots):
            zoom = min(zoom_for(IMG['spots_m'] / SPOT_PX * 1.25), 18)
            rgb, _ = mosaic(CONF['imagery'], zoom, IMG['spots_m'], SPOT_PX, f'spot{k}', sx, sz)
            ox, oy = (k % cells) * SPOT_PX, (k // cells) * SPOT_PX
            for j in range(SPOT_PX):
                o = ((oy + j) * side + ox) * 3
                atlas[o:o + SPOT_PX * 3] = rgb[j * SPOT_PX * 3:(j + 1) * SPOT_PX * 3]
        encode(atlas, side, side, os.path.join(img_dir, 'spots.jpg'), quality=5)
        print('  wrote spots.jpg', os.path.getsize(os.path.join(img_dir, 'spots.jpg')) // 1024, 'KB', flush=True)
    # Kept for colouring the roofs.
    raw_near = os.path.join(CACHE, f'{DZ_ID}-near.rgb')
    with open(raw_near, 'wb') as f:
        f.write(near_rgb)
NEAR_IMG = os.path.join(CACHE, f'{DZ_ID}-near.rgb')

# --- OpenStreetMap ------------------------------------------------------------------
CORE = 3000
WIDE = 15000
COAST = 41000
# Where buildings and trees are fetched: round the origin, or round each of
# the places the drop zone names (`osmAreas`: a landing far from the origin).
OSM_AREAS = [(*local(*a['centre']), a['core_m'], a['woods_m']) for a in CONF['osmAreas']] if CONF.get('osmAreas') else [(0, 0, CORE, 4500)]


def in_core(x, z):
    return any(math.hypot(x - ax, z - az) <= core for ax, az, core, _ in OSM_AREAS)


if ONLY is None or 'osm' in ONLY:
    parts = []
    for ax, az, core_m, woods_m in OSM_AREAS:
        c, w = bbox_around(core_m, ax, az), bbox_around(woods_m, ax, az)
        parts.append(f"""  way["building"]({c});
  relation["building"]({c});
  way["natural"="tree_row"]({c});
  way["barrier"="hedge"]({c});
  node["natural"="tree"]({c});
  way["leisure"="swimming_pool"]({c});
  way["landuse"~"^(forest|orchard|vineyard)$"]({w});
  way["natural"~"^(wood|scrub|wetland)$"]({w});
  relation["landuse"="forest"]({w});
  relation["natural"~"^(wood|scrub|wetland)$"]({w});""")
    core = overpass('[out:json][timeout:180];\n(\n' + '\n'.join(parts) + '\n);\nout geom;', 'core')
    water = overpass(f"""[out:json][timeout:180];
(
  way["natural"="water"]({bbox_around(WIDE)});
  relation["natural"="water"]({bbox_around(WIDE)});
  way["waterway"="riverbank"]({bbox_around(WIDE)});
  way["landuse"~"^(reservoir|basin)$"]({bbox_around(WIDE)});
);
out geom;""", 'water')
    # Inland drop zones say so, and spare the servers the biggest query.
    coast = [] if CONF.get('inland') else overpass(f"""[out:json][timeout:300];
way["natural"="coastline"]({bbox_around(COAST)});
out geom;""", 'coastline')
    state['osm'] = {'core': core, 'water': water, 'coast': coast}
with open(state_path, 'w') as f:
    json.dump(state, f)

core = state['osm']['core']
water_el = state['osm']['water']
coast_el = state['osm']['coast']


def way_points(e):
    return [(g['lat'], g['lon']) for g in e.get('geometry', []) if g]


# Roofs take their colour from the photo.
with open(NEAR_IMG, 'rb') as f:
    near_rgb = f.read()
NEAR_M, NEAR_PX, NEAR_C = LEVELS[2][1], LEVELS[2][2], LEVELS[2][4]


def photo_colour(points):
    """Mean colour of the near photo inside a footprint, as an int."""
    x0 = min(p[0] for p in points)
    x1 = max(p[0] for p in points)
    z0 = min(p[1] for p in points)
    z1 = max(p[1] for p in points)
    if max(abs(x0 - NEAR_C[0]), abs(x1 - NEAR_C[0]), abs(z0 - NEAR_C[1]), abs(z1 - NEAR_C[1])) > NEAR_M / 2 - 2:
        return None
    acc = [0, 0, 0]
    n = 0
    step = max(1.0, min(x1 - x0, z1 - z0) / 6)
    z = z0 + step / 2
    while z < z1:
        x = x0 + step / 2
        while x < x1:
            if inside(x, z, points):
                i = int(((x - NEAR_C[0]) / NEAR_M + 0.5) * NEAR_PX)
                j = int(((z - NEAR_C[1]) / NEAR_M + 0.5) * NEAR_PX)
                k = (j * NEAR_PX + i) * 3
                for c in range(3):
                    acc[c] += near_rgb[k + c]
                n += 1
            x += step
        z += step
    if n == 0:
        return None
    return (int(acc[0] / n) << 16) | (int(acc[1] / n) << 8) | int(acc[2] / n)


# --- Buildings ------------------------------------------------------------------------
LEVEL_H = 3.0
TYPE_H = {'hangar': 8, 'church': 14, 'industrial': 8, 'warehouse': 8, 'retail': 7, 'commercial': 9, 'farm_auxiliary': 5,
          'greenhouse': 3.5, 'apartments': 13, 'hotel': 13, 'school': 9, 'university': 12, 'garage': 2.7, 'garages': 2.7,
          'shed': 2.6, 'roof': 4, 'carport': 2.6, 'kiosk': 3}
known = {b['osmWay']: b for b in CONF.get('buildings', []) if b.get('osmWay')}
buildings = []
footprints = []
for e in core:
    t = e.get('tags', {})
    if 'building' not in t:
        continue
    if e['type'] == 'way':
        rings = [way_points(e)]
    elif e['type'] == 'relation':
        rings = relation_rings(e)[0]
    else:
        continue
    for pts in rings:
        if len(pts) < 4:
            continue
        loc = ll_list(pts[:-1] if pts[0] == pts[-1] else pts)
        footprints.append((e.get('id'), t, loc))
for b in CONF.get('buildings', []):
    if not b.get('osmWay') and b.get('polygon'):
        footprints.append((None, {'building': 'yes', 'name': b['name']}, ll_list(b['polygon'])))
seen_centres = set()
for osm_id, t, loc in footprints:
    x, z, length, width, heading = oriented_rect(loc)
    if length < 2.5 or width < 2 or not in_core(x, z):
        continue
    key = (round(x), round(z))
    if key in seen_centres:
        continue
    seen_centres.add(key)
    k = known.get(osm_id) if osm_id else next((b for b in CONF.get('buildings', []) if b.get('name') == t.get('name')), None)
    height = None
    try:
        if 'height' in t:
            height = float(t['height'].split()[0].replace(',', '.'))
        elif 'building:levels' in t:
            height = float(t['building:levels']) * LEVEL_H + 1
    except ValueError:
        pass
    if height is None:
        height = TYPE_H.get(t['building'], 6.5 if length * width > 60 else 3.2)
    roof = photo_colour(loc)
    wall = None
    flat_roof = 1 if (t.get('roof:shape') == 'flat' or length * width > 600) else 0
    if t.get('roof:shape') in ('gabled', 'hipped', 'pitched'):
        flat_roof = 0
    hangar = 1 if t['building'] == 'hangar' else 0
    if k:
        height = k.get('height_m') or height
        if k.get('roofHex'):
            roof = int(k['roofHex'].lstrip('#'), 16)
        if k.get('wallHex'):
            wall = int(k['wallHex'].lstrip('#'), 16)
        flat_roof = 1 if k.get('flatRoof') else 0
        hangar = 1 if k.get('hangarDoor') else 0
    buildings.append([round(x, 1), round(z, 1), round(length, 1), round(width, 1), round(heading), round(height, 1),
                      roof if roof is not None else -1, wall if wall is not None else -1, flat_roof, hangar,
                      1 if t['building'] == 'greenhouse' else 0])
buildings.sort(key=lambda b: math.hypot(b[0], b[1]))
buildings = buildings[:9000]

# --- Trees ----------------------------------------------------------------------------
woods = []
WOOD_KIND = {'forest': 'w', 'wood': 'w', 'scrub': 's', 'orchard': 'o', 'vineyard': 'v', 'wetland': 'm'}
for e in core:
    t = e.get('tags', {})
    kind = WOOD_KIND.get(t.get('landuse')) or WOOD_KIND.get(t.get('natural'))
    if not kind or 'building' in t:
        continue
    if kind == 'm' and t.get('wetland') not in ('mangrove', 'swamp'):
        continue
    if e['type'] == 'way':
        outers, inners = [way_points(e)], []
    elif e['type'] == 'relation':
        outers, inners = relation_rings(e)
    else:
        continue
    for pts in outers:
        if len(pts) < 4:
            continue
        ring = simplify_ring(ll_list(pts), 3)
        if len(ring) < 3 or abs(ring_area(ring)) < 300:
            continue
        holes = [simplify_ring(ll_list(h), 3) for h in inners if h and inside(*local(*h[0]), ring)]
        woods.append([kind, flat(ring)] + [flat(h) for h in holes if len(h) >= 3])
tree_rows = []
for e in core:
    t = e.get('tags', {})
    if e['type'] == 'way' and (t.get('natural') == 'tree_row' or t.get('barrier') == 'hedge'):
        tree_rows.append([1 if t.get('barrier') == 'hedge' else 0] + flat(rdp(ll_list(way_points(e)), 1)))
single_trees = []
for e in core:
    if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'tree':
        x, z = local(e['lat'], e['lon'])
        single_trees.extend([round(x, 1), round(z, 1)])

# --- Water ------------------------------------------------------------------------------
waters = []
seen_water = set()
for e in water_el + [c for c in core if c.get('tags', {}).get('leisure') == 'swimming_pool']:
    if e['type'] == 'way':
        outers, inners = [way_points(e)], []
    elif e['type'] == 'relation':
        outers, inners = relation_rings(e)
    else:
        continue
    pool = e.get('tags', {}).get('leisure') == 'swimming_pool'
    for pts in outers:
        if len(pts) < 4:
            continue
        loc = ll_list(pts)
        cx, cz = centre(loc)
        dist = math.hypot(cx, cz)
        tol = 0.5 if pool else (2 if dist < 3000 else 8)
        ring = simplify_ring(loc, tol)
        a = abs(ring_area(ring)) if len(ring) >= 3 else 0
        if a < (8 if pool else 150) or (dist > 5000 and a < 20000):
            continue
        key = tuple(flat(ring)[:4])
        if key in seen_water:
            continue
        seen_water.add(key)
        holes = [simplify_ring(ll_list(h), tol) for h in inners if h and inside(*local(*h[0]), ring)]
        waters.append({'kind': 'pool' if pool else 'lake', 'ring': flat(ring, 1 if pool else 0),
                       'holes': [flat(h) for h in holes if len(h) >= 3]})
seas = []
if coast_el:
    for p in sea_polygons([way_points(e) for e in coast_el if e['type'] == 'way'], COAST - 1000):
        ring = simplify_ring(p['ring'], 4)
        if len(ring) < 3:
            continue
        holes = [simplify_ring(h, 4) for h in p['holes']]
        seas.append({'kind': 'sea', 'ring': flat(ring), 'holes': [flat(h) for h in holes if len(h) >= 3 and abs(ring_area(h)) > 400]})

# --- The aerodrome and the DZ, from the configuration ----------------------------------------
def poly(points):
    return flat(ll_list(points), 1)


def pt(p):
    x, z = local(p['lat'], p['lon']) if isinstance(p, dict) else local(p[0], p[1])
    return [round(x, 1), round(z, 1)]


def rect_of(points):
    x, z, length, width, heading = oriented_rect(ll_list(points))
    return [round(x, 1), round(z, 1), round(length, 1), round(width, 1), round(heading, 1)]


dz = {
    'boundary': poly(CONF['boundary']),
    'fieldRect': rect_of(CONF['boundary']),
    'runways': [{'ref': r['ref'], 'a': pt(r['ends'][0]), 'b': pt(r['ends'][1]), 'width': r['width_m'], 'surface': r['surface']}
                for r in CONF['runways']],
    'paved': [{'name': p['name'], 'surface': p['surface'], 'points': poly(p['polygon']), 'rect': rect_of(p['polygon'])}
              for p in CONF.get('paved', [])],
    'landing': [{'name': l['name'], 'use': l['use'], 'surface': l.get('surface', 'grass'), 'color': l.get('colorHex'),
                 'points': poly(l['polygon']), 'rect': rect_of(l['polygon'])} for l in CONF['landingAreas']],
    'target': ({**dict(zip(('x', 'z'), pt(CONF['target']))), 'radius': CONF['target']['radius_m'],
                'color': CONF['target'].get('colorHex'), 'shown': CONF['target'].get('shown', True)}
               if CONF.get('target') else None),
    'people': [pt(p) for p in CONF.get('people', [])],
    'pond': poly(CONF['pond']['polygon']) if CONF.get('pond') else None,
    'windsocks': [pt(w) for w in CONF.get('windsocks', [])],
    'flags': [pt(f) + [f.get('height_m', 4)] for f in CONF.get('flags', [])],
}
def bridge_out(b, f):
    """A deck as src/world/dz.ts has it: its axis, the road's height above the landing area, the piers, its shape."""
    out = {'name': b['name'], 'a': [round(v, 2) for v in f.a], 'b': [round(v, 2) for v in f.b],
           'top': round(b['deckTop_m'] - PLAIN, 1), 'width': b['width_m'], 'piers': [round(p, 1) for p in f.piers],
           'depth': b['girderDepth_m']}
    if b.get('grade'):
        out['grade'] = b['grade']
    if f.radius:
        out['radius'] = b['radius_m']
    for key, name in (('girderShare', 'girder'), ('parapet_m', 'parapet'), ('pierShape', 'pierShape'), ('pylons', 'pylons')):
        if key in b:
            out[name] = b[key]
    if 'paintHex' in b:
        out['paint'] = int(b['paintHex'].lstrip('#'), 16)
    return out


def road_at(b, s):
    """The road's height `s` metres along a deck, absolute, m."""
    return b['deckTop_m'] + b.get('grade', 0) * s


if CONF.get('bridges'):
    dz['bridges'] = [bridge_out(b, f) for b, f in zip(CONF['bridges'], BRIDGES)]
if CONF.get('base') and 'bridge' in CONF['base']:
    # Off a bridge: no run, the jumper stands on the edge of the deck, outside
    # the parapet, square to the road; as high as the road above the landing.
    b = CONF['base']
    conf, f = CONF['bridges'][b['bridge']], BRIDGES[b['bridge']]
    side = 1 if b['side'] == 'right' else -1
    out = conf['width_m'] / 2 - b['edgeInset_m']
    x, z = f.world(b['station_m'], side * out)
    x1, z1 = f.world(b['station_m'], side * (out + 1))
    heading = math.degrees(math.atan2(x1 - x, -(z1 - z))) % 360
    dz['base'] = {'x': round(x, 2), 'z': round(z, 2), 'headingDeg': round(heading, 1), 'runUp': 0, 'width': 1,
                  'height': round(road_at(conf, b['station_m']) - PLAIN, 1), 'name': b['name']}
elif CONF.get('base'):
    # The exit: where the jumper stands, the way to the edge, and how far it is.
    b = CONF['base']
    dz['base'] = {**dict(zip(('x', 'z'), pt(b))), 'headingDeg': b['heading_deg'], 'runUp': b['runUp_m'], 'width': b['width_m'],
                  'height': b['altitudeToLanding_m'], 'name': b['name']}
    if 'pad' in b:
        # A steel step built on the lip, level, its front edge over the wall.
        dz['base']['pad'] = {'length': b['pad']['length_m'], 'width': b['pad']['width_m']}


def surveyed(x, z):
    """Height of the ground at a local point as the fine relief knows it, the finest square first; None outside them."""
    for g in [*state.get('exitReliefs', []), state.get('fine')]:
        if not g:
            continue
        step, cols, rows = g['spacing'], g['size'], g.get('rows', g['size'])
        c = (x - g['x']) / step + (cols - 1) / 2
        r = (z - g['z']) / step + (rows - 1) / 2
        if 0 <= c < cols - 1 and 0 <= r < rows - 1:
            c0, r0 = int(c), int(r)
            fc, fr = c - c0, r - r0
            hs = g['heights']
            a, b = hs[r0 * cols + c0], hs[r0 * cols + c0 + 1]
            d, e = hs[(r0 + 1) * cols + c0], hs[(r0 + 1) * cols + c0 + 1]
            return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr
    return None


if CONF.get('exits'):
    # Several exits, each with its own landing: the run starts `runUp_m` back
    # from the lip; its height is the ground's there above its own target.
    dz['exits'] = []
    for e in CONF['exits']:
        lx, lz = local(*e['lip'])
        h = math.radians(e['heading_deg'])
        sx, sz = lx - math.sin(h) * e['runUp_m'], lz + math.cos(h) * e['runUp_m']
        tx, tz = local(e['target']['lat'], e['target']['lon'])
        top, foot = surveyed(sx, sz), surveyed(tx, tz)
        height = e.get('altitudeToLanding_m') or round(top - foot, 1)
        dz['exits'].append({
            'name': e['name'],
            'landing': e['landing'],
            'base': {'x': round(sx, 2), 'z': round(sz, 2), 'headingDeg': e['heading_deg'], 'runUp': e['runUp_m'],
                     'width': e['width_m'], 'height': height, 'name': e['name']},
            'target': {'x': round(tx, 1), 'z': round(tz, 1), 'radius': e['target']['radius_m'], 'shown': e['target'].get('shown', True)},
        })
        print(f'  exit {e["name"]}: run from ({sx:.1f}, {sz:.1f}) at {top:.1f} m, {height} m above its target', flush=True)
    dz['base'] = dz['exits'][0]['base']


def rel(h):
    return round((h - PLAIN) * 2) / 2


relief = state['relief']
out = {
    'origin': {'lat': LAT0, 'lon': LON0, 'elevation': round(PLAIN, 1)},
    'near': {'size': NEAR['size'], 'spacing': NEAR['spacing'], 'heights': [rel(h) for h in relief['near']]},
    'far': {'size': FAR['size'], 'spacing': FAR['spacing'], 'heights': [round(h - PLAIN) for h in relief['far']]},
    'imagery': [{'url': f'dz/{DZ_ID}/{name}.jpg', 'size': size_m, **({'x': c[0], 'z': c[1]} if c != (0, 0) else {})}
                for name, size_m, _, _, c in reversed(LEVELS)],
}
if spot_centres():
    cells = 2 if len(spot_centres()) <= 4 else 3
    out['imagerySpots'] = {'url': f'dz/{DZ_ID}/spots.jpg', 'grid': cells, 'size': IMG['spots_m'],
                           'centres': [list(c) for c in spot_centres()]}
if FINE:
    import base64  # noqa: PLC0415
    import struct  # noqa: PLC0415
    fine = state['fine']
    # Decimetres above the plain, as little-endian 16-bit integers in base64: a quarter of the size of a list.
    dm = [max(-32768, min(32767, round((h - PLAIN) * 10))) for h in fine['heights']]
    out['fine'] = {'x': fine['x'], 'z': fine['z'], 'size': fine['size'], 'spacing': fine['spacing'],
                   'heights': base64.b64encode(struct.pack(f'<{len(dm)}h', *dm)).decode()}
    if fine.get('rows', fine['size']) != fine['size']:
        out['fine']['rows'] = fine['rows']

    def packed(ex):
        dm = [max(-32768, min(32767, round((h - PLAIN) * 10))) for h in ex['heights']]
        return {'x': ex['x'], 'z': ex['z'], 'size': ex['size'], 'spacing': ex['spacing'],
                'heights': base64.b64encode(struct.pack(f'<{len(dm)}h', *dm)).decode()}

    if EXIT_RELIEF and CONF.get('exits') and 'exitReliefs' in state:
        out['exitReliefs'] = [packed(ex) for ex in state['exitReliefs']]
    elif EXIT_RELIEF and 'exitRelief' in state:
        out['exitRelief'] = packed(state['exitRelief'])

with open(data_out, 'w') as f:
    f.write(f'// Generated by tools/dz/build.py from tools/dz/{DZ_ID}.json: do not edit by hand.\n')
    f.write(f'// {CONF["aerodrome"]["name"]} ({CONF["aerodrome"]["icao"]}), local metres about the centre of the\n')
    f.write('// main landing area: x east, z south (web mercator scaled to true size there).\n')
    f.write('// Data (c) OpenStreetMap contributors, ODbL; relief from Mapzen Terrain Tiles\n')
    f.write('// (SRTM, EU-DEM, GMTED, ETOPO1)' + (f' and {FINE["source"]}' if FINE else '') + '; imagery in public/dz: see tools/dz/README.md.\n\n')
    f.write('/* eslint-disable */\n')
    f.write("import type { RealDzData } from '../real';\n\n")
    f.write('export const DATA: RealDzData = {\n')
    f.write(f'  origin: {json.dumps(out["origin"])},\n')
    f.write(f'  utcOffsetH: {CONF["utcOffsetSummer_h"]},\n')
    f.write('  /** Ground above the plain, m, rows north to south: 12 km at 100 m, then 80 km at 500 m. */\n')
    f.write(f'  near: {json.dumps(out["near"], separators=(",", ":"))},\n')
    f.write(f'  far: {json.dumps(out["far"], separators=(",", ":"))},\n')
    if FINE:
        f.write(f'  /** Fine relief about the exit, {FINE["source"]}: decimetres above the plain, int16 little-endian in base64, rows north to south. */\n')
        f.write(f'  fine: {json.dumps(out["fine"], separators=(",", ":"))},\n')
    if 'exitRelief' in out:
        f.write('  /** Finer still about the exit, every metre, the same way. */\n')
        f.write(f'  exitRelief: {json.dumps(out["exitRelief"], separators=(",", ":"))},\n')
    if 'exitReliefs' in out:
        f.write('  /** Finer still about each exit, every metre, the same way, in the order of dz.exits. */\n')
        f.write(f'  exitReliefs: {json.dumps(out["exitReliefs"], separators=(",", ":"))},\n')
    f.write(f'  imagery: {json.dumps(out["imagery"])},\n')
    if 'imagerySpots' in out:
        f.write('  /** Squares of photo at 1 m about the exits and the landings, side by side in one picture. */\n')
        f.write(f'  imagerySpots: {json.dumps(out["imagerySpots"])},\n')
    f.write('  /** x, z, length, width, heading of the long side, height, roof colour (-1: none), wall colour (-1), flat roof, hangar door, greenhouse. */\n')
    f.write(f'  buildings: {json.dumps(buildings, separators=(",", ":"))},\n')
    f.write('  /** Woods: kind (w wood, s scrub, o orchard, v vineyard, m mangrove or swamp), ring, holes. */\n')
    f.write(f'  woods: {json.dumps(woods, separators=(",", ":"))},\n')
    f.write('  /** Rows of trees: hedge (1) or trees (0), then x, z pairs. */\n')
    f.write(f'  treeRows: {json.dumps(tree_rows, separators=(",", ":"))},\n')
    f.write('  /** Single trees mapped one by one: x, z pairs. */\n')
    f.write(f'  trees: {json.dumps(single_trees, separators=(",", ":"))},\n')
    f.write('  /** Lakes, ponds, rivers, pools and the sea, with their islands. */\n')
    f.write(f'  water: {json.dumps(waters + seas, separators=(",", ":"))},\n')
    f.write(f'  dz: {json.dumps(dz, separators=(",", ":"), ensure_ascii=False)},\n')
    f.write('};\n')
print('  buildings', len(buildings), 'woods', len(woods), 'tree rows', len(tree_rows), 'trees', len(single_trees) // 2,
      'water', len(waters), 'sea', len(seas), '->', os.path.relpath(data_out, ROOT), os.path.getsize(data_out) // 1024, 'KB')
