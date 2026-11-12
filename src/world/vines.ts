// Vineyards: rows of trained vines a couple of metres apart, as the plots
// mapped as vineyards are planted. The map does not say which way the rows
// run: along the plot's longest side, as they mostly do.

import type { Area } from './dz';
import { inArea } from './dz';

export interface Vineyard {
  area: Area;
  /** Unit vector along the rows: x east, z south. */
  along: [number, number];
  /** Metres between rows. */
  spacing: number;
  /** The plot's bounds: x0, z0, x1, z1. */
  box: [number, number, number, number];
}

/** Row to row: wide enough for a tractor. */
export const VINE_SPACING = 2.4;
/** A row is drawn in lengths of this, m, each following the ground. */
export const VINE_LENGTH = 20;
/** The rows stop short of the plot's edge, where the tractor turns, m. */
const HEADLAND = 1.5;
/** Shorter than this is no row, m. */
const SHORTEST = 4;
/** Half the width of a row and of who lands on it, m. */
const REACH = 0.7;

export function vineyardOf(area: Area, spacing = VINE_SPACING): Vineyard {
  const p = area.points;
  let along: [number, number] = [1, 0];
  let longest = 0;
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const dx = p[i]! - p[j]!;
    const dz = p[i + 1]! - p[j + 1]!;
    const length = Math.hypot(dx, dz);
    if (length > longest) {
      longest = length;
      along = [dx / length, dz / length];
    }
    box[0] = Math.min(box[0], p[i]!);
    box[1] = Math.min(box[1], p[i + 1]!);
    box[2] = Math.max(box[2], p[i]!);
    box[3] = Math.max(box[3], p[i + 1]!);
  }
  return { area, along, spacing, box };
}

/** The rows of a vineyard, each from one end to the other: ax, az, bx, bz. */
export function vineRows(v: Vineyard): [number, number, number, number][] {
  const [ux, uz] = v.along;
  // Along the rows and across them.
  const rings = [v.area.points, ...(v.area.holes ?? [])].map((ring) => {
    const out: number[] = [];
    for (let i = 0; i < ring.length; i += 2) out.push(ring[i]! * ux + ring[i + 1]! * uz, ring[i + 1]! * ux - ring[i]! * uz);
    return out;
  });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < rings[0]!.length; i += 2) {
    lo = Math.min(lo, rings[0]![i]!);
    hi = Math.max(hi, rings[0]![i]!);
  }
  const rows: [number, number, number, number][] = [];
  // The same lines whatever the plot: every `spacing` from the origin.
  for (let k = Math.ceil((lo + HEADLAND) / v.spacing); k * v.spacing <= hi - HEADLAND; k++) {
    const c = k * v.spacing;
    const cuts: number[] = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const a = ring[j + 1]!;
        const b = ring[i + 1]!;
        if (a > c !== b > c) cuts.push(ring[j]! + ((ring[i]! - ring[j]!) * (c - a)) / (b - a));
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const from = cuts[i]! + HEADLAND;
      const to = cuts[i + 1]! - HEADLAND;
      if (to - from < SHORTEST) continue;
      rows.push([from * ux - c * uz, from * uz + c * ux, to * ux - c * uz, to * uz + c * ux]);
    }
  }
  return rows;
}

/** Whether who comes down at the point lands on a row rather than between two. */
export function onVineRow(vineyards: Vineyard[], x: number, z: number): boolean {
  for (const v of vineyards) {
    if (x < v.box[0] || x > v.box[2] || z < v.box[1] || z > v.box[3] || !inArea(v.area, x, z)) continue;
    const across = z * v.along[0] - x * v.along[1];
    const off = Math.abs(across - Math.round(across / v.spacing) * v.spacing);
    if (off < REACH) return true;
  }
  return false;
}
