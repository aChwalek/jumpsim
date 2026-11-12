// What the ground shows at a point, for what grows on it: the colour of the
// flat surface lying there, and the height of the terrain as it is drawn.

import type { Area, Rect } from './dz';
import { inArea, inRect } from './dz';

/** Side of the squares the surfaces are sorted into, m. */
const CELL = 64;

/**
 * The colour of the topmost flat surface at a point, `base` where there is
 * none. The surfaces are sorted into squares once, so that a lookup only
 * tries the few that lie nearby.
 */
export function surfaceColorAt(base: (x: number, z: number) => number, rects: Rect[], areas: Area[]): (x: number, z: number) => number {
  const cells = new Map<number, (Rect | Area)[]>();
  const key = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
  const sort = (s: Rect | Area, x0: number, z0: number, x1: number, z1: number): void => {
    for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        const k = key(i, j);
        const list = cells.get(k);
        if (list) list.push(s);
        else cells.set(k, [s]);
      }
    }
  };
  for (const r of rects) {
    const reach = Math.hypot(r.length, r.width) / 2;
    sort(r, r.x - reach, r.z - reach, r.x + reach, r.z + reach);
  }
  for (const a of areas) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < a.points.length; i += 2) {
      x0 = Math.min(x0, a.points[i]!);
      x1 = Math.max(x1, a.points[i]!);
      z0 = Math.min(z0, a.points[i + 1]!);
      z1 = Math.max(z1, a.points[i + 1]!);
    }
    sort(a, x0, z0, x1, z1);
  }
  return (x, z) => {
    let top: Rect | Area | undefined;
    for (const s of cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      // Of two on the same layer, the later one is drawn over the other.
      if (top && s.layer < top.layer) continue;
      if ('points' in s ? inArea(s, x, z) : inRect(s, x, z)) top = s;
    }
    return top ? top.color : base(x, z);
  };
}

/** A square of terrain drawn finer, centred on (x, z). */
interface Finer {
  x: number;
  z: number;
  size: number;
  spacing: number;
}

/**
 * The height of the terrain as it is drawn: flat triangles between points
 * `spacing` apart on lines through the origin, closer inside the squares of
 * `finer`, each inside the one before. They cut the corners that `groundAt`
 * rounds.
 */
export function facetedHeight(groundAt: (x: number, z: number) => number, spacing: number, finer: Finer[] = []): (x: number, z: number) => number {
  return (x, z) => {
    let step = spacing;
    let ox = 0;
    let oz = 0;
    for (const f of finer) {
      if (Math.max(Math.abs(x - f.x), Math.abs(z - f.z)) >= f.size / 2 - f.spacing) break;
      step = f.spacing;
      ox = f.x - f.size / 2;
      oz = f.z - f.size / 2;
    }
    const x0 = ox + Math.floor((x - ox) / step) * step;
    const z0 = oz + Math.floor((z - oz) / step) * step;
    const fx = (x - x0) / step;
    const fz = (z - z0) / step;
    const b = groundAt(x0 + step, z0);
    const c = groundAt(x0, z0 + step);
    // Each square is split along the diagonal from its north-east corner to its south-west one.
    if (fx + fz <= 1) {
      const a = groundAt(x0, z0);
      return a + (b - a) * fx + (c - a) * fz;
    }
    const d = groundAt(x0 + step, z0 + step);
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
}
