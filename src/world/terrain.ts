// Relief from a grid of measured elevations. The plain the drop zone sits on
// is laid perfectly flat at zero, where the flat surfaces (fields, runway,
// landing area) lie; only what rises clearly above it becomes hills.

export interface HeightGrid {
  /** Metres between grid points. */
  spacing: number;
  /** Points per side; the grid is centred on the landing target. */
  size: number;
  /** Elevations above sea level, m: rows north to south, columns west to east. */
  heights: number[][];
}

export interface ReliefOptions {
  /** Elevation of the plain, m above sea level. */
  plain: number;
  /** Ground less than this above the plain is laid flat, m. */
  flatBelow: number;
  /** Over how many metres of rise the hills grow out of the flat, m. */
  blend: number;
  /**
   * A coarser grid reaching further, centred on the same point, for the
   * mountains on the horizon. Its heights are above the plain, like the main
   * grid's once `plain` is taken off. Beyond the main grid it takes over.
   */
  far?: HeightGrid;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Height of the ground above the plain at a point, m: zero on the plain,
 * hills where the grid rises above it. Beyond the grid (the far one if there
 * is one) the edge is carried on and sinks back to the plain over the next 6 km.
 */
export function reliefFrom(grid: HeightGrid, o: ReliefOptions): (x: number, z: number) => number {
  const near = sampler(grid);
  const far = o.far ? sampler(o.far) : null;
  const nearHalf = ((grid.size - 1) * grid.spacing) / 2;
  /** Over how much of its edge the main grid gives way to the far one, m. */
  const handover = 1000;
  const shape = (rise: number): number => rise * smoothstep(o.flatBelow, o.flatBelow + o.blend, rise);
  return (x, z) => {
    const a = near(x, z);
    if (!far) return shape(a.height - o.plain) * (1 - smoothstep(0, 6000, a.beyond));
    const out = Math.max(Math.abs(x), Math.abs(z));
    const b = out > nearHalf - handover ? far(x, z) : null;
    if (!b) return shape(a.height - o.plain);
    const t = smoothstep(nearHalf - handover, nearHalf, out);
    const rise = (a.height - o.plain) * (1 - t) + b.height * t;
    return shape(rise) * (1 - smoothstep(0, 6000, b.beyond));
  };
}

/** Bilinear height in a grid, clamped at its edge, and how far past the edge the point is. */
function sampler(grid: HeightGrid): (x: number, z: number) => { height: number; beyond: number } {
  const { spacing, size, heights } = grid;
  const half = ((size - 1) * spacing) / 2;
  const last = size - 1;
  const at = (row: number, col: number): number => heights[row]![col]!;
  const result = { height: 0, beyond: 0 };
  return (x, z) => {
    const cx = (x + half) / spacing;
    const cz = (z + half) / spacing;
    const c = Math.min(last - 1e-9, Math.max(0, cx));
    const r = Math.min(last - 1e-9, Math.max(0, cz));
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const fc = c - c0;
    const fr = r - r0;
    result.height =
      (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr) + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
    result.beyond = Math.max(Math.abs(cx - c), Math.abs(cz - r)) * spacing;
    return result;
  };
}

/** A grid of heights from a flat list, rows north to south. */
export function gridOf(size: number, spacing: number, flatHeights: number[]): HeightGrid {
  const heights: number[][] = [];
  for (let r = 0; r < size; r++) heights.push(flatHeights.slice(r * size, (r + 1) * size));
  return { size, spacing, heights };
}
