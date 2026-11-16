// The trees of a map, one by one, from the height of the canopy above the
// ground the IGN's LiDAR HD measures (MNH: its surface model less its ground
// model, every 50 cm, open data): each crown is a peak of it. Its top gives
// the tree's place and height, the fall round it the crown's width.
//
// The canopy is fetched in Lambert 93, the only frame the service gives it in,
// a metre a cell, and each tree is brought into the local frame on its own.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE, type Frame, type Rect } from './imagery';

/** A tree found in the canopy: where (local m), how tall and how wide its crown (m), and whether it is a conifer. */
export interface Tree {
  x: number;
  z: number;
  height: number;
  radius: number;
  conifer: boolean;
}

// --- Lambert 93 (RGF93, GRS80): Lambert conformal conic, two standard parallels -------------
const A = 6378137;
const FL = 1 / 298.257222101;
const E = Math.sqrt(2 * FL - FL * FL);
const RAD = Math.PI / 180;
const P0 = 46.5 * RAD;
const P1 = 44 * RAD;
const P2 = 49 * RAD;
const L0 = 3 * RAD;
const X0 = 700000;
const Y0 = 6600000;
const mOf = (p: number): number => Math.cos(p) / Math.sqrt(1 - (E * Math.sin(p)) ** 2);
const tOf = (p: number): number => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const N = (Math.log(mOf(P1)) - Math.log(mOf(P2))) / (Math.log(tOf(P1)) - Math.log(tOf(P2)));
const F = mOf(P1) / (N * tOf(P1) ** N);
const R0 = A * F * tOf(P0) ** N;

export function toLambert93(lat: number, lon: number): [number, number] {
  const r = A * F * tOf(lat * RAD) ** N;
  const th = N * (lon * RAD - L0);
  return [X0 + r * Math.sin(th), Y0 + R0 - r * Math.cos(th)];
}

export function fromLambert93(x: number, y: number): [number, number] {
  const dx = x - X0;
  const dy = R0 - (y - Y0);
  const r = Math.sign(N) * Math.hypot(dx, dy);
  const t = (r / (A * F)) ** (1 / N);
  const lon = Math.atan2(dx, dy) / N + L0;
  let lat = Math.PI / 2 - 2 * Math.atan(t);
  for (let k = 0; k < 8; k++) {
    const es = E * Math.sin(lat);
    lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (E / 2));
  }
  return [lat / RAD, lon / RAD];
}

// --- Fetching ----------------------------------------------------------------------------------
const LAYER = 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
/** Metres a side of each request, a cell a metre. */
const BLOCK = 1000;

async function block(x0: number, y0: number): Promise<Float32Array> {
  const url =
    'https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
    `&LAYERS=${LAYER}&STYLES=&CRS=EPSG:2154&BBOX=${x0},${y0},${x0 + BLOCK},${y0 + BLOCK}` +
    `&WIDTH=${BLOCK}&HEIGHT=${BLOCK}&FORMAT=image/x-bil;bits=32`;
  const key = createHash('sha1').update(url).digest('hex');
  const file = path.join(CACHE, key.slice(0, 2), `${key}.bil`);
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'jumpsim-dz-builder/1.0' } });
        const body = new Uint8Array(await res.arrayBuffer());
        if (!res.ok || body.byteLength !== BLOCK * BLOCK * 4) throw new Error(`HTTP ${res.status}, ${body.byteLength} bytes`);
        writeFileSync(`${file}.part`, body);
        renameSync(`${file}.part`, file);
        break;
      } catch (e) {
        if (attempt >= 6) throw new Error(`canopy ${x0},${y0}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
      }
    }
  }
  const bytes = readFileSync(file);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

// --- Finding the trees --------------------------------------------------------------------------
/** Lower than this, m, it is brush, not a tree. */
const LOWEST = 3;
/** Taller than this, m, it is a rock pinnacle or a serac: the Alps' tallest spruces reach 50 m. */
const TALLEST = 55;
/** A crown narrower than this for its height is a spike of rock or ice, not a tree. */
const NARROWEST = 0.07;

/**
 * The trees over a rectangle of the local frame, from the canopy height:
 * every peak of it at least LOWEST high, the highest within a radius that
 * grows with the tree, whose crown fills most of the disc round it (not a
 * power line). `keep` says whether a tree may stand there (not on a roof).
 */
export async function findTrees(frame: Frame, rect: Rect, keep: (x: number, z: number) => boolean): Promise<Tree[]> {
  // The rectangle's box in Lambert 93, on whole blocks, with a margin.
  const corners = [
    [rect.x0, rect.z0],
    [rect.x1, rect.z0],
    [rect.x0, rect.z1],
    [rect.x1, rect.z1],
  ].map(([x, z]) => toLambert93(...frame.latlon(x!, z!)));
  const bx0 = Math.floor((Math.min(...corners.map((c) => c[0])) - 50) / BLOCK) * BLOCK;
  const by0 = Math.floor((Math.min(...corners.map((c) => c[1])) - 50) / BLOCK) * BLOCK;
  const bx1 = Math.ceil((Math.max(...corners.map((c) => c[0])) + 50) / BLOCK) * BLOCK;
  const by1 = Math.ceil((Math.max(...corners.map((c) => c[1])) + 50) / BLOCK) * BLOCK;
  const W = bx1 - bx0;
  const H = by1 - by0;
  // Rows north to south: row 0 is the top of the box.
  const raw = new Float32Array(W * H);
  const jobs: [number, number][] = [];
  for (let y = by0; y < by1; y += BLOCK) for (let x = bx0; x < bx1; x += BLOCK) jobs.push([x, y]);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (next < jobs.length) {
        const [x, y] = jobs[next++]!;
        const cells = await block(x, y);
        const ox = x - bx0;
        const oy = by1 - (y + BLOCK);
        for (let r = 0; r < BLOCK; r++) raw.set(cells.subarray(r * BLOCK, (r + 1) * BLOCK), (oy + r) * W + ox);
        if (++done % 20 === 0 || done === jobs.length) console.log(`  canopy: ${done}/${jobs.length} km²`);
      }
    }),
  );

  // Smoothed [1 2 1]: a single cell of noise is no crown.
  const s = new Float32Array(W * H);
  for (let j = 1; j < H - 1; j++) {
    for (let i = 1; i < W - 1; i++) {
      const o = j * W + i;
      const v = (k: number): number => Math.max(0, raw[k]!);
      s[o] =
        (4 * v(o) + 2 * (v(o - 1) + v(o + 1) + v(o - W) + v(o + W)) + v(o - W - 1) + v(o - W + 1) + v(o + W - 1) + v(o + W + 1)) / 16;
    }
  }

  const trees: Tree[] = [];
  const rays: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const margin = 12;
  for (let j = margin; j < H - margin; j++) {
    for (let i = margin; i < W - margin; i++) {
      const o = j * W + i;
      const h = s[o]!;
      if (h < LOWEST) continue;
      // The highest of its neighbours; of equal ones, the first in reading order.
      if (s[o - 1]! >= h || s[o - W]! >= h || s[o - W - 1]! >= h || s[o - W + 1]! >= h) continue;
      if (s[o + 1]! > h || s[o + W]! > h || s[o + W - 1]! > h || s[o + W + 1]! > h) continue;
      const reach = Math.min(4.5, Math.max(1.5, 1 + 0.06 * h));
      const R = Math.ceil(reach);
      let peak = true;
      for (let dj = -R; dj <= R && peak; dj++) {
        for (let di = -R; di <= R; di++) {
          if (di * di + dj * dj > reach * reach || (di === 0 && dj === 0)) continue;
          const v = s[o + dj * W + di]!;
          if (v > h || (v === h && (dj < 0 || (dj === 0 && di < 0)))) {
            peak = false;
            break;
          }
        }
      }
      if (!peak) continue;
      // The crown: out along eight rays until the canopy falls to half the
      // tree, or rises again into the next one.
      let sum = 0;
      for (const [di, dj] of rays) {
        const step = Math.hypot(di, dj);
        let prev = h;
        let k = 1;
        for (; k <= 12; k++) {
          const v = s[o + dj * k * W + di * k]!;
          if (v < 0.5 * h || v > prev + 0.3) break;
          prev = v;
        }
        sum += (k - 0.5) * step;
      }
      const radius = Math.min(0.45 * h, Math.max(0.8, sum / rays.length));
      // Most of the disc under the crown is canopy: not a cable, nor the edge of a roof.
      const Rc = Math.ceil(radius);
      let inside = 0;
      let full = 0;
      for (let dj = -Rc; dj <= Rc; dj++) {
        for (let di = -Rc; di <= Rc; di++) {
          if (di * di + dj * dj > radius * radius) continue;
          inside++;
          if (s[o + dj * W + di]! > 0.5 * h) full++;
        }
      }
      if (full < 0.45 * inside) continue;
      // Its height: the highest raw cell at its top.
      let top = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) top = Math.max(top, raw[o + dj * W + di]!);
      if (top > TALLEST || radius < NARROWEST * top) continue;
      const [lat, lon] = fromLambert93(bx0 + i + 0.5, by1 - j - 0.5);
      const [x, z] = frame.local(lat, lon);
      if (x < rect.x0 || x > rect.x1 || z < rect.z0 || z > rect.z1 || !keep(x, z)) continue;
      // A narrow crown for its height is a conifer's (build.ts adds the ones high up, where the broadleaves stop).
      const conifer = radius / top < 0.22;
      trees.push({ x, z, height: top, radius, conifer });
    }
  }
  return trees;
}
