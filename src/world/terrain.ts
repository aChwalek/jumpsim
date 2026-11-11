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
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Height of the ground above the plain at a point, m: zero on the plain,
 * hills where the grid rises above it. Beyond the grid the edge is carried
 * on and sinks back to the plain over the next 6 km.
 */
export function reliefFrom(grid: HeightGrid, o: ReliefOptions): (x: number, z: number) => number {
  const { spacing, size, heights } = grid;
  const half = ((size - 1) * spacing) / 2;
  const last = size - 1;
  const at = (row: number, col: number): number => heights[row]![col]!;
  return (x, z) => {
    const cx = (x + half) / spacing;
    const cz = (z + half) / spacing;
    const c = Math.min(last - 1e-9, Math.max(0, cx));
    const r = Math.min(last - 1e-9, Math.max(0, cz));
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const fc = c - c0;
    const fr = r - r0;
    const h =
      (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr) + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
    const rise = h - o.plain;
    // Out past the edge of the grid, the hills fade away.
    const beyond = Math.max(Math.abs(cx - c), Math.abs(cz - r)) * spacing;
    const fade = 1 - smoothstep(0, 6000, beyond);
    return rise * smoothstep(o.flatBelow, o.flatBelow + o.blend, rise) * fade;
  };
}
