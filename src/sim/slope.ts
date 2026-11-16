// The lie of the ground: which way is up from it at a point, and how a speed
// splits into going into it and going along it.

import { dot, set, type Vec3 } from './vec';

/** Height of what stands at (x, z), the top under `y` if given (a bridge's deck over a river). */
export type GroundAt = (x: number, z: number, y?: number) => number;

/** How far apart the ground is read for its slope, m. */
const BASE = 1.5;

/**
 * The ground's up at (x, z), unit length. Of the two sides each way, the
 * gentler, so that a point on a rim or a deck's edge keeps the flat it is on
 * and not the drop beside it. `y`, as for `groundAt`.
 */
export function groundNormal(out: Vec3, groundAt: GroundAt, x: number, z: number, y?: number): Vec3 {
  const h = groundAt(x, z, y);
  // Read from just above, so that a deck is found and not the river under it.
  const probe = h + 0.5;
  const gentler = (a: number, b: number): number => (Math.abs(a) < Math.abs(b) ? a : b);
  const gx = gentler(groundAt(x + BASE, z, probe) - h, h - groundAt(x - BASE, z, probe)) / BASE;
  const gz = gentler(groundAt(x, z + BASE, probe) - h, h - groundAt(x, z - BASE, probe)) / BASE;
  const n = Math.hypot(gx, 1, gz);
  return set(out, -gx / n, 1 / n, -gz / n);
}

/** Speed into the ground (positive going in), m/s, and along it, m/s, for a velocity `v` over ground whose up is `normal`. */
export function againstGround(v: Vec3, normal: Vec3): { into: number; along: number } {
  const n = dot(v, normal);
  const along = Math.sqrt(Math.max(0, v.x * v.x + v.y * v.y + v.z * v.z - n * n));
  return { into: -n, along };
}
