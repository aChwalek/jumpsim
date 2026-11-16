// The aerial photos the tiles are coloured with, finest first: orthophoto
// tiles fetched from a WMTS (zoom 18 over the lines, zoom 19 about the exits
// and the landings), then the drop zone's own pictures in public/dz (near,
// mid, far), which reach the horizon. Each covers a square of the local frame
// and fades into the coarser ones under it near its edge.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const R = 6378137;
const UA = 'jumpsim-dz-builder/1.0';
export const CACHE = path.join(os.homedir(), '.cache', 'jumpsim-dz');

/** Web mercator scaled to true size at the origin, as tools/dz/build.py has it: x east, z south, metres. */
export class Frame {
  readonly k: number;
  readonly mx0: number;
  readonly my0: number;

  constructor(lat0: number, lon0: number) {
    this.k = Math.cos((lat0 * Math.PI) / 180);
    [this.mx0, this.my0] = Frame.merc(lat0, lon0);
  }

  static merc(lat: number, lon: number): [number, number] {
    return [R * ((lon * Math.PI) / 180), R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
  }

  /** Global pixel coordinates of a local point at a zoom level, 256 pixels a tile. */
  pixel(x: number, z: number, zoom: number): [number, number] {
    const n = 256 * 2 ** zoom;
    const mx = this.mx0 + x / this.k;
    const my = this.my0 - z / this.k;
    return [((mx + Math.PI * R) / (2 * Math.PI * R)) * n, ((Math.PI * R - my) / (2 * Math.PI * R)) * n];
  }

  /** Metres of the local frame a pixel spans at a zoom level. */
  metresPerPixel(zoom: number): number {
    return ((2 * Math.PI * R) / (256 * 2 ** zoom)) * this.k;
  }
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A picture of the ground over a square: how much it shows at a point, and its colour there. */
export interface Source {
  name: string;
  rect: Rect;
  /** Metres of the local frame a pixel spans. */
  res: number;
  /** Over how many metres inside its edge it fades into the coarser ones. */
  fade: number;
  /** Readies what `sample` needs over a rectangle (fetches, decodes). */
  prepare(rect: Rect): Promise<void>;
  /** Writes the colour at (x, z) into out; returns the weight it shows with (0 where it has no picture). */
  sample(x: number, z: number, out: Float32Array): number;
}

function edgeWeight(s: { rect: Rect; fade: number }, x: number, z: number): number {
  const d = Math.min(x - s.rect.x0, s.rect.x1 - x, z - s.rect.z0, s.rect.z1 - z);
  return d <= 0 ? 0 : smoothstep(0, s.fade, d);
}

/** One of the drop zone's own pictures: a square centred on (cx, cz), `size` metres a side. */
export async function pictureSource(name: string, file: string, cx: number, cz: number, size: number): Promise<Source> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width;
  const rgb = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const rect = { x0: cx - size / 2, z0: cz - size / 2, x1: cx + size / 2, z1: cz + size / 2 };
  const source: Source = {
    name,
    rect,
    res: size / px,
    // As the game's shader fades them: over the outer 5 %.
    fade: size * 0.05,
    async prepare() {},
    sample(x, z, out) {
      const w = edgeWeight(source, x, z);
      if (w <= 0) return 0;
      bilinear(rgb, px, px, ((x - rect.x0) / size) * px - 0.5, ((z - rect.z0) / size) * px - 0.5, out);
      return w;
    },
  };
  return source;
}

function bilinear(rgb: Uint8Array, w: number, h: number, u: number, v: number, out: Float32Array): void {
  const x = Math.min(w - 1.0001, Math.max(0, u));
  const y = Math.min(h - 1.0001, Math.max(0, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = (y0 * w + x0) * 3;
  const b = a + 3;
  const c = a + w * 3;
  const d = c + 3;
  for (let k = 0; k < 3; k++) {
    const top = rgb[a + k]! + (rgb[b + k]! - rgb[a + k]!) * fx;
    const bottom = rgb[c + k]! + (rgb[d + k]! - rgb[c + k]!) * fx;
    out[k] = top + (bottom - top) * fy;
  }
}

// --- Orthophoto tiles ---------------------------------------------------------------------
const SERVICES: Record<string, string> = {
  ign:
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
    '&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
};

/** Where tools/dz/build.py keeps the same download, so that the two share it. */
function cachePath(url: string): string {
  const key = createHash('sha1').update(url).digest('hex');
  return path.join(CACHE, key.slice(0, 2), `${key}.jpg`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function cached(url: string): Promise<string> {
  const file = cachePath(url);
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  let body = new Uint8Array(0);
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 400 || res.status === 404) break;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // A service in trouble can answer 200 with an XML report where the picture should be.
      if (bytes[0] === 0x3c) throw new Error('service exception');
      body = bytes;
      break;
    } catch (e) {
      if (attempt === 6) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(Math.min(2 ** attempt * 1000, 30000));
    }
  }
  writeFileSync(`${file}.part`, body);
  renameSync(`${file}.part`, file);
  return file;
}

/** Fetches every tile in the list, `threads` at a time, saying how far it has got. */
export async function fetchTiles(service: string, tiles: [number, number, number][], label: string, threads = 8): Promise<void> {
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async (): Promise<void> => {
    while (next < tiles.length) {
      const [z, x, y] = tiles[next++]!;
      await cached(tileUrl(service, z, x, y));
      done++;
      if (done % 500 === 0 || done === tiles.length) {
        console.log(`  ${label}: ${done}/${tiles.length} tiles, ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
  };
  await Promise.all(Array.from({ length: threads }, worker));
}

function tileUrl(service: string, z: number, x: number, y: number): string {
  return SERVICES[service]!.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/** The tiles of a zoom level over a rectangle of the local frame. */
export function tilesOver(frame: Frame, rect: Rect, zoom: number): [number, number, number][] {
  const [left, top] = frame.pixel(rect.x0, rect.z0, zoom);
  const [right, bottom] = frame.pixel(rect.x1, rect.z1, zoom);
  const out: [number, number, number][] = [];
  for (let y = Math.floor(top / 256); y <= Math.floor(bottom / 256); y++) {
    for (let x = Math.floor(left / 256); x <= Math.floor(right / 256); x++) out.push([zoom, x, y]);
  }
  return out;
}

/** A decoded tile: raw RGB, or null where the service has no picture. */
type Decoded = Uint8Array | null;

/**
 * Whether a tile holds no picture: missing, or small and all one colour, as
 * services send beyond their flights. Among snow (`snow`), only a tile of
 * one colour to the last level is taken for none.
 */
async function decodeTile(file: string, snow: boolean): Promise<Decoded> {
  const size = statSync(file).size;
  if (size === 0) return null;
  let raw: Buffer;
  try {
    raw = await sharp(readFileSync(file)).removeAlpha().resize(256, 256, { fit: 'fill' }).raw().toBuffer();
  } catch {
    return null;
  }
  if (size <= 4000) {
    const least = snow ? 0.5 : 9;
    let even = true;
    for (let c = 0; c < 3 && even; c++) {
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let i = c; i < raw.length; i += 21) {
        sum += raw[i]!;
        sq += raw[i]! * raw[i]!;
        n++;
      }
      const mean = sum / n;
      if (sq / n - mean * mean > least) even = false;
    }
    if (even) return null;
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** Orthophoto tiles of one zoom level over a rectangle, fetched beforehand with fetchTiles. */
export function wmtsSource(name: string, service: string, frame: Frame, zoom: number, rect: Rect, fade: number, snow: boolean): Source {
  const decoded = new Map<string, Decoded>();
  // The tiles of the rectangle being worked on, side by side.
  let mosaic: { rgb: Uint8Array; seen: Uint8Array; tx0: number; ty0: number; cols: number; rows: number } | null = null;
  const source: Source = {
    name,
    rect,
    res: frame.metresPerPixel(zoom),
    fade,
    async prepare(area) {
      const clip = {
        x0: Math.max(area.x0, rect.x0),
        z0: Math.max(area.z0, rect.z0),
        x1: Math.min(area.x1, rect.x1),
        z1: Math.min(area.z1, rect.z1),
      };
      if (clip.x0 >= clip.x1 || clip.z0 >= clip.z1) {
        mosaic = null;
        return;
      }
      const [left, top] = frame.pixel(clip.x0, clip.z0, zoom);
      const [right, bottom] = frame.pixel(clip.x1, clip.z1, zoom);
      // A tile's worth of margin for the bilinear lookups at the edges.
      const tx0 = Math.floor(left / 256) - 1;
      const ty0 = Math.floor(top / 256) - 1;
      const cols = Math.floor(right / 256) + 1 - tx0 + 1;
      const rows = Math.floor(bottom / 256) + 1 - ty0 + 1;
      const w = cols * 256;
      const rgb = new Uint8Array(w * rows * 256 * 3);
      const seen = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const key = `${tx0 + i}/${ty0 + j}`;
          let tile = decoded.get(key);
          if (tile === undefined) {
            const file = cachePath(tileUrl(service, zoom, tx0 + i, ty0 + j));
            tile = existsSync(file) ? await decodeTile(file, snow) : null;
            decoded.set(key, tile);
            // Keep the memory in hand: the work goes over the ground in order.
            if (decoded.size > 4000) decoded.delete(decoded.keys().next().value!);
          }
          if (!tile) continue;
          seen[j * cols + i] = 1;
          for (let r = 0; r < 256; r++) rgb.set(tile.subarray(r * 768, (r + 1) * 768), ((j * 256 + r) * w + i * 256) * 3);
        }
      }
      mosaic = { rgb, seen, tx0, ty0, cols, rows };
    },
    sample(x, z, out) {
      const w = edgeWeight(source, x, z);
      if (w <= 0 || !mosaic) return 0;
      const [gx, gy] = frame.pixel(x, z, zoom);
      const u = gx - mosaic.tx0 * 256 - 0.5;
      const v = gy - mosaic.ty0 * 256 - 0.5;
      // No picture where any of the four texels read is missing.
      const i0 = Math.floor(u / 256);
      const j0 = Math.floor(v / 256);
      const i1 = Math.floor((u + 1) / 256);
      const j1 = Math.floor((v + 1) / 256);
      const { seen, cols, rows } = mosaic;
      if (i0 < 0 || j0 < 0 || i1 >= cols || j1 >= rows) return 0;
      if (!seen[j0 * cols + i0] || !seen[j0 * cols + i1] || !seen[j1 * cols + i0] || !seen[j1 * cols + i1]) return 0;
      bilinear(mosaic.rgb, cols * 256, rows * 256, u, v, out);
      return w;
    },
  };
  return source;
}
