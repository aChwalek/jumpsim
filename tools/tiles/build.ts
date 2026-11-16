// Builds a real drop zone's terrain as 3D Tiles: a tree of squares, each a
// grid of the ground as the game draws it and an aerial photo, the root
// covering the whole map coarsely, each child a quarter of its parent drawn
// twice as finely. The game shows the squares fine near the eye and coarse
// far from it (3d-tiles-renderer), so the triangles and the picture's texels
// on screen stay about the same wherever one flies. See README.md.

import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { facetedHeight } from '../../src/world/cover';
import { TERRAIN_SPACING } from '../../src/world/ground';
import { createRealDz, type RealDzData } from '../../src/world/real';
import { LOOKS } from '../../src/world/realDzs';
import { Frame, type Rect, type Source, fetchTiles, pictureSource, tilesOver, wmtsSource } from './imagery';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** The root square, m a side, centred on the origin: 1024 cells of 100 m, so that every grid of the data falls on its lines. */
const ROOT_SIZE = 102400;
/** Cells a side of a tile's grid, at most. */
const CELLS = 64;
/** Texels a side of a tile's picture; its edge texels lie on the tile's edges, shared with the next tile. */
const TEX = 512;
/** How far the terrain is drawn, m either way: beyond, no relief and no picture. */
const REACH = 40960;
/**
 * Geometric error of a tile, as the renderer weighs it against its target
 * (16 px): the height error counts HEIGHT_WEIGHT times, a texel TEXEL_WEIGHT
 * times, so that a tile is split once its heights are 2 px out or its
 * texels 1.3 px wide on screen.
 */
const HEIGHT_WEIGHT = 8;
const TEXEL_WEIGHT = 12;

interface Tile {
  level: number;
  i: number;
  j: number;
  x0: number;
  z0: number;
  size: number;
  /** Cells a side of its grid, and the metres between its lines. */
  cells: number;
  spacing: number;
  children: Tile[] | null;
  yMin: number;
  yMax: number;
  heightError: number;
  error: number;
  file: string;
}

interface Square extends Rect {
  spacing: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const rectOf = (t: { x0: number; z0: number; size: number }): Rect => ({ x0: t.x0, z0: t.z0, x1: t.x0 + t.size, z1: t.z0 + t.size });

export async function main(args: string[]): Promise<void> {
  const map = args[0];
  if (!map) throw new Error('usage: node tools/tiles/run.mjs <map> [--dz id,id] [--focus x,z,radius] [--quality 1-255] [--workers n]');
  const option = (name: string): string | undefined => {
    const k = args.indexOf(`--${name}`);
    return k >= 0 ? args[k + 1] : undefined;
  };
  const dzIds = (option('dz') ?? map).split(',') as (keyof typeof LOOKS)[];
  const focus = option('focus')?.split(',').map(Number);
  // ETC1S quality: 192 is a fifth lighter than 255 and looks the same on the ground.
  const quality = Number(option('quality') ?? 192);
  // Each build has its own folder, so that what is cached of an older one never mixes with it.
  const version = option('version') ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const workers = Number(option('workers') ?? Math.max(2, os.cpus().length - 2));
  // Only the tileset, from the tree and the heights: the squares already written stand.
  const tilesetOnly = args.includes('--tileset-only');
  const out = path.join(ROOT, 'public', 'tiles', map, version);
  const conf = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'dz', `${map}.json`), 'utf8'));
  const { DATA } = (await import(`../../src/world/data/${map}.ts`)) as { DATA: RealDzData };
  const started = Date.now();
  const seconds = (): string => `${Math.round((Date.now() - started) / 1000)} s`;

  // --- The ground as the game draws it ------------------------------------------------------
  // One pack per exit where there are several: each draws the relief about its
  // own exit every metre. Elsewhere they all draw the same.
  const packs = dzIds.map((id) => createRealDz(DATA, LOOKS[id]));
  const drawnBy = packs.map((p) => facetedHeight(p.groundAt, TERRAIN_SPACING, p.terrainDetail));
  const squares: Square[] = [];
  const own: { rect: Rect; k: number }[] = [];
  packs.forEach((p, k) => {
    (p.terrainDetail ?? []).forEach((d, n) => {
      const sizeZ = d.sizeZ ?? d.size;
      const rect = { x0: d.x - d.size / 2, z0: d.z - sizeZ / 2, x1: d.x + d.size / 2, z1: d.z + sizeZ / 2, spacing: d.spacing };
      if (!squares.some((s) => s.x0 === rect.x0 && s.z0 === rect.z0 && s.spacing === rect.spacing)) squares.push(rect);
      if (n > 0) own.push({ rect, k });
    });
  });
  const drawn = (x: number, z: number): number => {
    for (const o of own) if (x >= o.rect.x0 && x <= o.rect.x1 && z >= o.rect.z0 && z <= o.rect.z1) return drawnBy[o.k]!(x, z);
    return drawnBy[0]!(x, z);
  };
  // The packs agree outside their own squares.
  for (let n = 0; n < 2000; n++) {
    const x = (Math.random() - 0.5) * 30000;
    const z = (Math.random() - 0.5) * 30000;
    if (own.some((o) => x >= o.rect.x0 - 2 && x <= o.rect.x1 + 2 && z >= o.rect.z0 - 2 && z <= o.rect.z1 + 2)) continue;
    const h = drawnBy.map((f) => f(x, z));
    if (Math.max(...h) - Math.min(...h) > 0.01) throw new Error(`the exits' packs differ at ${x}, ${z}: ${h}`);
  }
  console.log(`relief: ${squares.map((s) => `${s.x1 - s.x0}x${s.z1 - s.z0} m at ${s.spacing} m`).join(', ')}`);

  /** The finest spacing of the data over a rectangle: the grid a tile must follow to draw it exactly. */
  const dataSpacing = (r: Rect): number => {
    let finest = overlaps(r, { x0: -REACH, z0: -REACH, x1: REACH, z1: REACH }) ? TERRAIN_SPACING : 1600;
    for (const s of squares) if (overlaps(r, s)) finest = Math.min(finest, s.spacing);
    return finest;
  };

  // --- The photos ----------------------------------------------------------------------------
  const frame = new Frame(DATA.origin.lat, DATA.origin.lon);
  const service: string = conf.imagery;
  const snow = !!conf.snow;
  const pictures: Source[] = [];
  const names = ['far', 'mid', 'near'];
  for (const level of DATA.imagery) {
    const name = path.basename(level.url, '.jpg');
    if (!names.includes(name)) continue;
    pictures.push(await pictureSource(name, path.join(ROOT, 'public', level.url), level.x ?? 0, level.z ?? 0, level.size));
  }
  pictures.sort((a, b) => b.res - a.res);
  // Finer orthophotos fetched for the tiles: zoom 18 over the fine relief, zoom 19 about the spots.
  const ortho: Source[] = [];
  if (DATA.fine) {
    const f = DATA.fine;
    const half = ((f.size - 1) * f.spacing) / 2;
    const halfZ = (((f.rows ?? f.size) - 1) * f.spacing) / 2;
    const rect = { x0: f.x - half, z0: f.z - halfZ, x1: f.x + half, z1: f.z + halfZ };
    ortho.push(wmtsSource('z18', service, frame, 18, rect, 60, snow));
  }
  for (const [k, c] of (DATA.imagerySpots?.centres ?? []).entries()) {
    const half = DATA.imagerySpots!.size / 2;
    ortho.push(wmtsSource(`z19-${k}`, service, frame, 19, { x0: c[0] - half, z0: c[1] - half, x1: c[0] + half, z1: c[1] + half }, 40, snow));
  }
  for (const s of ortho) {
    const zoom = s.name === 'z18' ? 18 : 19;
    let rect = { x0: s.rect.x0 - 300, z0: s.rect.z0 - 300, x1: s.rect.x1 + 300, z1: s.rect.z1 + 300 };
    // Trying it out on a small area: only the tiles there.
    if (focus) {
      const [fx, fz, fr] = focus as [number, number, number];
      rect = { x0: Math.max(rect.x0, fx - fr), z0: Math.max(rect.z0, fz - fr), x1: Math.min(rect.x1, fx + fr), z1: Math.min(rect.z1, fz + fr) };
      if (rect.x0 >= rect.x1 || rect.z0 >= rect.z1) continue;
    }
    await fetchTiles(service, tilesOver(frame, rect, zoom), s.name);
  }
  // Coarsest first.
  const sources = [...pictures, ...ortho.sort((a, b) => b.res - a.res)];
  console.log(`photos: ${sources.map((s) => `${s.name} ${s.res.toFixed(2)} m`).join(', ')} (${seconds()})`);
  const imageryRes = (r: Rect): number => Math.min(...sources.filter((s) => overlaps(r, s.rect)).map((s) => s.res), 1e9);
  const fallback = packs[0]!.grass.area.color;
  const fallbackRgb = [(fallback >> 16) & 255, (fallback >> 8) & 255, fallback & 255];

  // --- The tree --------------------------------------------------------------------------------
  const inFocus = (r: Rect): boolean => {
    if (!focus) return true;
    const [fx, fz, fr] = focus as [number, number, number];
    const dx = Math.max(r.x0 - fx, 0, fx - r.x1);
    const dz = Math.max(r.z0 - fz, 0, fz - r.z1);
    return Math.hypot(dx, dz) < fr;
  };
  const plan = (level: number, i: number, j: number): Tile => {
    const size = ROOT_SIZE / 2 ** level;
    const x0 = -ROOT_SIZE / 2 + i * size;
    const z0 = -ROOT_SIZE / 2 + j * size;
    const rect = rectOf({ x0, z0, size });
    const data = dataSpacing(rect);
    const res = imageryRes(rect);
    const exact = size / CELLS <= data;
    const sharp = size / TEX <= res;
    const leaf = (exact && sharp) || (!inFocus(rect) && size <= 3200);
    const cells = exact ? size / data : CELLS;
    const tile: Tile = {
      level,
      i,
      j,
      x0,
      z0,
      size,
      cells,
      spacing: size / cells,
      children: null,
      yMin: 0,
      yMax: 0,
      heightError: 0,
      error: 0,
      file: `${level}/${i}_${j}.glb`,
    };
    if (!leaf) tile.children = [0, 1, 2, 3].map((k) => plan(level + 1, i * 2 + (k & 1), j * 2 + (k >> 1)));
    return tile;
  };
  const root = plan(0, 0, 0);
  const all: Tile[] = [];
  const walk = (t: Tile): void => {
    all.push(t);
    t.children?.forEach(walk);
  };
  walk(root);
  const leaves = all.filter((t) => !t.children);
  console.log(`tree: ${all.length} tiles, ${leaves.length} leaves, deepest ${Math.min(...leaves.map((t) => t.size))} m (${seconds()})`);

  // --- Heights, and how far each tile's grid is from the ground -----------------------------------
  const grids = new Map<Tile, Float64Array>();
  for (const t of all) {
    // The grid with a cell's margin all round, for the normals.
    const n = t.cells;
    const g = t.spacing;
    const h = new Float64Array((n + 3) * (n + 3));
    for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) h[(j + 1) * (n + 3) + i + 1] = drawn(t.x0 + i * g, t.z0 + j * g);
    grids.set(t, h);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const y = h[(j + 1) * (n + 3) + i + 1]!;
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    // Where the grid is coarser than the data, how far it strays from the ground.
    let worst = 0;
    const data = dataSpacing(rectOf(t));
    if (g > data) {
      const step = Math.max(data, t.size / 192);
      const steps = Math.round(t.size / step);
      for (let b = 0; b <= steps; b++) {
        for (let a = 0; a <= steps; a++) {
          const x = t.x0 + (a * t.size) / steps;
          const z = t.z0 + (b * t.size) / steps;
          const y = drawn(x, z);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
          worst = Math.max(worst, Math.abs(y - onGrid(h, n, g, t.x0, t.z0, x, z)));
        }
      }
    }
    t.yMin = yMin;
    t.yMax = yMax;
    t.heightError = worst;
  }
  // A parent's error is at least its children's, its box holds theirs.
  const settle = (t: Tile): void => {
    if (!t.children) {
      t.error = 0;
      return;
    }
    t.children.forEach(settle);
    const texel = t.size / (TEX - 1);
    t.error = Math.max(t.heightError * HEIGHT_WEIGHT, texel * TEXEL_WEIGHT, ...t.children.map((c) => c.error * 1.01));
    t.yMin = Math.min(t.yMin, ...t.children.map((c) => c.yMin));
    t.yMax = Math.max(t.yMax, ...t.children.map((c) => c.yMax));
  };
  settle(root);
  console.log(`heights: root error ${root.error.toFixed(0)} (${seconds()})`);

  // --- Pictures and files -------------------------------------------------------------------------
  if (!tilesetOnly) {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
  }
  const pool = new Pool(path.join(HERE, 'worker.mjs'), tilesetOnly ? 0 : workers);
  let written = 0;
  let bytes = 0;
  let textureBytes = 0;
  const tmp = new Float32Array(3);
  const leafPicture = async (t: Tile): Promise<Uint8Array> => {
    const rect = rectOf(t);
    const here = sources.filter((s) => overlaps(rect, s.rect));
    // Finest first: each shows over what is left of the coarser ones.
    here.reverse();
    for (const s of here) await s.prepare({ x0: rect.x0 - 1, z0: rect.z0 - 1, x1: rect.x1 + 1, z1: rect.z1 + 1 });
    const rgb = new Uint8Array(TEX * TEX * 3);
    const step = t.size / (TEX - 1);
    for (let j = 0; j < TEX; j++) {
      const z = t.z0 + j * step;
      for (let i = 0; i < TEX; i++) {
        const x = t.x0 + i * step;
        let r = 0;
        let g = 0;
        let b = 0;
        let left = 1;
        for (const s of here) {
          const w = s.sample(x, z, tmp);
          if (w <= 0) continue;
          const k = left * w;
          r += k * tmp[0]!;
          g += k * tmp[1]!;
          b += k * tmp[2]!;
          left *= 1 - w;
          if (left < 1e-3) break;
        }
        const o = (j * TEX + i) * 3;
        rgb[o] = Math.round(r + left * fallbackRgb[0]!);
        rgb[o + 1] = Math.round(g + left * fallbackRgb[1]!);
        rgb[o + 2] = Math.round(b + left * fallbackRgb[2]!);
      }
    }
    return rgb;
  };
  const process = async (t: Tile): Promise<Uint8Array> => {
    let rgb: Uint8Array;
    if (t.children) {
      const kids: Uint8Array[] = [];
      for (const c of t.children) kids.push(await process(c));
      rgb = shrink(kids);
    } else rgb = await leafPicture(t);
    const job = geometry(t, grids.get(t)!);
    const rgba = new Uint8Array(TEX * TEX * 4);
    for (let p = 0, q = 0; p < rgb.length; p += 3, q += 4) {
      rgba[q] = rgb[p]!;
      rgba[q + 1] = rgb[p + 1]!;
      rgba[q + 2] = rgb[p + 2]!;
      rgba[q + 3] = 255;
    }
    grids.delete(t);
    void pool
      .run({ ...job, file: path.join(out, t.file), texture: { data: rgba, size: TEX }, quality }, [
        rgba.buffer,
        job.positions.buffer,
        job.normals.buffer,
        job.uvs.buffer,
        job.indices.buffer,
      ])
      .catch((e: Error) => {
        console.error(`${t.file}: ${e.message}`);
        globalThis.process.exit(1);
      })
      .then((done) => {
        if (!done) return;
        written++;
        bytes += done.bytes;
        textureBytes += done.texture;
        if (written % 200 === 0 || written === all.length) {
          console.log(`  ${written}/${all.length} tiles, ${(bytes / 1e6).toFixed(0)} MB (pictures ${(textureBytes / 1e6).toFixed(0)}) (${seconds()})`);
        }
      });
    await pool.ready();
    return rgb;
  };
  if (!tilesetOnly) await process(root);
  await pool.close();

  // --- The tileset ------------------------------------------------------------------------------------
  const describe = (t: Tile): object => {
    const skirt = skirtDepth(t);
    const cy = (t.yMax + t.yMin - skirt) / 2;
    const hy = (t.yMax - t.yMin + skirt) / 2 + 0.5;
    const half = t.size / 2;
    return {
      // The tileset's frame is z up: x east, y north, z up.
      boundingVolume: { box: [t.x0 + half, -(t.z0 + half), cy, half, 0, 0, 0, half, 0, 0, 0, hy] },
      geometricError: t.error,
      refine: 'REPLACE',
      content: { uri: t.file },
      // What the error is made of, for the game to weigh it its own way: the
      // grid's height error and the photo's texel, m.
      extras: { h: +t.heightError.toFixed(2), t: +(t.size / (TEX - 1)).toFixed(3) },
      ...(t.children ? { children: t.children.map(describe) } : {}),
    };
  };
  const tileset = {
    asset: { version: '1.0', generator: 'jumpsim tools/tiles', extras: { map, texture: TEX, cells: CELLS } },
    geometricError: root.error * 2,
    root: describe(root),
  };
  writeFileSync(path.join(out, 'tileset.json'), JSON.stringify(tileset));
  console.log(`wrote ${out}: ${all.length} tiles, ${(bytes / 1e6).toFixed(0)} MB (${seconds()})`);
  // The game finds each map's tileset in src/world/tilesets.ts.
  const index = path.join(ROOT, 'src', 'world', 'tilesets.ts');
  const known: Record<string, string> = existsSync(index)
    ? JSON.parse(readFileSync(index, 'utf8').match(/TILESETS: Record<string, string> = (\{[\s\S]*?\});/)![1]!)
    : {};
  known[map] = `${map}/${version}/tileset.json`;
  writeFileSync(
    index,
    `// Written by tools/tiles/build.ts: each map's tileset, under the tiles' origin
// (src/world/tiles.ts). Upload a build (tools/tiles/upload.mjs) before shipping its line here.

export const TILESETS: Record<string, string> = ${JSON.stringify(known, null, 2)};
`,
  );
  console.log(`version ${version}: src/world/tilesets.ts updated; upload with node tools/tiles/upload.mjs ${map} ${version}`);
}

/** Height of a tile's grid at (x, z): its cells are split along the diagonal from the north-east corner to the south-west one. */
function onGrid(h: Float64Array, n: number, g: number, x0: number, z0: number, x: number, z: number): number {
  const fi = Math.min(n - 1e-9, Math.max(0, (x - x0) / g));
  const fj = Math.min(n - 1e-9, Math.max(0, (z - z0) / g));
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const fx = fi - i;
  const fz = fj - j;
  const at = (a: number, b: number): number => h[(b + 1) * (n + 3) + a + 1]!;
  const b = at(i + 1, j);
  const c = at(i, j + 1);
  if (fx + fz <= 1) {
    const a = at(i, j);
    return a + (b - a) * fx + (c - a) * fz;
  }
  const d = at(i + 1, j + 1);
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

/** How far a tile's skirt hangs below its edge, to hide the cracks along a coarser neighbour. */
function skirtDepth(t: Tile): number {
  return Math.min(2000, Math.max(5, 2 * t.spacing));
}

/** A tile's grid as a mesh about its centre: positions, normals, texture coordinates, triangles, with a skirt round it. */
function geometry(t: Tile, h: Float64Array) {
  const n = t.cells;
  const g = t.spacing;
  const row = n + 3;
  const at = (i: number, j: number): number => h[(j + 1) * row + i + 1]!;
  const cx = t.x0 + t.size / 2;
  const cz = t.z0 + t.size / 2;
  const cy = (t.yMin + t.yMax) / 2;
  const grid = (n + 1) * (n + 1);
  const rim = 4 * n;
  const count = grid + rim;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const put = (v: number, i: number, j: number, drop: number): void => {
    positions[v * 3] = t.x0 + i * g - cx;
    positions[v * 3 + 1] = at(i, j) - drop - cy;
    positions[v * 3 + 2] = t.z0 + j * g - cz;
    const nx = -(at(i + 1, j) - at(i - 1, j)) / (2 * g);
    const nz = -(at(i, j + 1) - at(i, j - 1)) / (2 * g);
    const len = Math.hypot(nx, 1, nz);
    normals[v * 3] = nx / len;
    normals[v * 3 + 1] = 1 / len;
    normals[v * 3 + 2] = nz / len;
    uvs[v * 2] = (0.5 + (i / n) * (TEX - 1)) / TEX;
    uvs[v * 2 + 1] = (0.5 + (j / n) * (TEX - 1)) / TEX;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) put(j * (n + 1) + i, i, j, 0);
  // The rim, going round: north edge eastwards, east edge southwards, south edge westwards, west edge northwards.
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) ring.push([i, 0]);
  for (let j = 0; j < n; j++) ring.push([n, j]);
  for (let i = n; i > 0; i--) ring.push([i, n]);
  for (let j = n; j > 0; j--) ring.push([0, j]);
  const drop = skirtDepth(t);
  ring.forEach(([i, j], k) => put(grid + k, i, j, drop));
  const indices = new Uint16Array(n * n * 6 + rim * 12);
  let o = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const s = a + n + 1;
      indices.set([a, s, a + 1, a + 1, s, s + 1], o);
      o += 6;
    }
  }
  // The skirt, both faces: it is seen from whichever side the crack opens.
  for (let k = 0; k < rim; k++) {
    const [i, j] = ring[k]!;
    const [i2, j2] = ring[(k + 1) % rim]!;
    const p = j * (n + 1) + i;
    const q = j2 * (n + 1) + i2;
    const s = grid + k;
    const s2 = grid + ((k + 1) % rim);
    indices.set([p, q, s, s, q, s2, p, s, q, s, s2, q], o);
    o += 12;
  }
  return { positions, normals, uvs, indices, translation: [cx, cy, cz] };
}

/** A parent's picture from its four children's (north-west, north-east, south-west, south-east), a [1 2 1] filter across. */
function shrink(kids: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(TEX * TEX * 3);
  const last = 2 * (TEX - 1);
  // A texel of the children side by side: their shared edges are one column, one row.
  const texel = (X: number, Y: number, c: number): number => {
    const east = X >= TEX - 1 && X > 0 ? 1 : 0;
    const south = Y >= TEX - 1 && Y > 0 ? 1 : 0;
    const x = east ? X - (TEX - 1) : X;
    const y = south ? Y - (TEX - 1) : Y;
    return kids[south * 2 + east]![(y * TEX + x) * 3 + c]!;
  };
  const w = [1, 2, 1];
  for (let l = 0; l < TEX; l++) {
    for (let k = 0; k < TEX; k++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let weight = 0;
        for (let b = -1; b <= 1; b++) {
          const Y = 2 * l + b;
          if (Y < 0 || Y > last) continue;
          for (let a = -1; a <= 1; a++) {
            const X = 2 * k + a;
            if (X < 0 || X > last) continue;
            const f = w[a + 1]! * w[b + 1]!;
            sum += f * texel(X, Y, c);
            weight += f;
          }
        }
        out[(l * TEX + k) * 3 + c] = Math.round(sum / weight);
      }
    }
  }
  return out;
}

/** Worker threads taking jobs, a few queued each. */
class Pool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly waiting: (() => void)[] = [];
  private readonly pending = new Map<number, { resolve: (v: { bytes: number; texture: number }) => void; reject: (e: Error) => void }>();
  private next = 0;
  private running = 0;

  constructor(file: string, size: number) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(file);
      w.on('message', (m: { id: number; error?: string; bytes: number; texture: number }) => {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        this.running--;
        this.idle.push(w);
        this.waiting.shift()?.();
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m);
      });
      w.on('error', (e) => {
        throw e;
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  /** Resolves once a worker is free to take the next job. */
  async ready(): Promise<void> {
    if (this.idle.length > 0) return;
    await new Promise<void>((r) => this.waiting.push(r));
  }

  run(job: object, transfer: ArrayBuffer[]): Promise<{ bytes: number; texture: number }> {
    const w = this.idle.pop();
    if (!w) throw new Error('no worker free: await ready() first');
    const id = this.next++;
    this.running++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...job, id }, transfer);
    });
  }

  async close(): Promise<void> {
    while (this.running > 0) await new Promise<void>((r) => this.waiting.push(r));
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
