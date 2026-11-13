// Two bodies meeting in the air. Gently, they push each other away and fly
// on. Harder, the one hit is thrown off the airflow and tumbles, limp, for a
// few seconds. Harder still, it goes dark: the edges of what the eyes see,
// then all of it, and from a blow hard enough the jumper comes to on the
// ground, if the AAD saw to the rest.

import { clamp, cross, dot, set, vec3, type Vec3 } from './vec';

/** A body in the air, as far as bumping into it goes: a ball about its middle, m. */
export const BODY_RADIUS = 0.45;
/** Share of the closing speed given back. */
const RESTITUTION = 0.3;

/** Closing speed, m/s, from which a blow throws the body into a tumble. */
export const STUN_FROM = 4;
/** From which the sight narrows, goes out altogether, and stays out until the ground. */
export const DIM_FROM = 9;
export const DARK_FROM = 15;
export const COLD_FROM = 24;
/** The longest tumble, s. */
export const LONGEST_STUN = 8;

export interface Contact {
  /** From them to us as they touched, unit. */
  normal: Vec3;
  /** What takes us back out of them, m: shared between the two if both give way. */
  shift: Vec3;
  /** How fast they came together along the normal, m/s: negative once going apart. */
  closing: number;
}

/**
 * Whether two bodies touch, or did at some point of the last `dt` seconds on
 * their way to where they are now (at speed, they can go through each other
 * between two frames); their middles and speeds given. Fills `out` if so.
 */
export function contact(out: Contact, usPos: Vec3, usVel: Vec3, themPos: Vec3, themVel: Vec3, dt = 0, reach = 2 * BODY_RADIUS): Contact | null {
  // Us as seen from them, now, and how that changes.
  const rx = usPos.x - themPos.x;
  const ry = usPos.y - themPos.y;
  const rz = usPos.z - themPos.z;
  const vx = usVel.x - themVel.x;
  const vy = usVel.y - themVel.y;
  const vz = usVel.z - themVel.z;
  const n = out.normal;
  const v2 = vx * vx + vy * vy + vz * vz;
  // How long ago they first touched, s: 0 if they touch only now, or already did `dt` ago.
  let ago = 0;
  const sx = rx - vx * dt;
  const sy = ry - vy * dt;
  const sz = rz - vz * dt;
  if (dt > 0 && v2 > 1e-9 && Math.hypot(sx, sy, sz) >= reach) {
    // From apart `dt` ago: where along the way the distance came down to the reach.
    const along = (sx * vx + sy * vy + sz * vz) / v2;
    const nearest = Math.hypot(sx - vx * along, sy - vy * along, sz - vz * along);
    const half = Math.sqrt(Math.max(0, reach * reach - nearest * nearest) / v2);
    const at = -along - half;
    if (nearest >= reach || at < 0 || at > dt) return null;
    ago = dt - at;
  } else if (Math.hypot(rx, ry, rz) >= reach) return null;
  set(n, rx - vx * ago, ry - vy * ago, rz - vz * ago);
  const d = Math.hypot(n.x, n.y, n.z);
  // One inside the other: apart along the way they came together, or else sideways.
  if (d < 1e-6) {
    const v = Math.sqrt(v2);
    if (v < 1e-6) set(n, 1, 0, 0);
    else set(n, -vx / v, -vy / v, -vz / v);
  } else set(n, n.x / d, n.y / d, n.z / d);
  // Back to where they touched; touching still, out of each other.
  if (ago > 0) set(out.shift, -vx * ago, -vy * ago, -vz * ago);
  else set(out.shift, n.x * (reach - d), n.y * (reach - d), n.z * (reach - d));
  out.closing = -(vx * n.x + vy * n.y + vz * n.z);
  return out;
}

export const newContact = (): Contact => ({ normal: vec3(), shift: vec3(), closing: 0 });

/** What a blow does to the one who takes it. */
export interface Blow {
  /** Thrown into a tumble for this long, s: 0 for a push and no more. */
  stun: number;
  /** How fast the tumble starts, rad/s. */
  spin: number;
  /** How dark it goes for the eyes: 0 not at all, up to 1 nothing left to see. */
  dark: number;
  /** Out cold, until the ground. */
  cold: boolean;
}

/** What a blow at this closing speed, m/s, does. */
export function blowAt(closing: number): Blow {
  if (closing < STUN_FROM) return { stun: 0, spin: 0, dark: 0, cold: false };
  return {
    stun: Math.min(LONGEST_STUN, 1 + (closing - STUN_FROM) * 0.5),
    spin: Math.min(14, 1.5 + closing * 0.5),
    dark: closing < DIM_FROM ? 0 : closing >= DARK_FROM ? 1 : 0.35 + (0.6 * (closing - DIM_FROM)) / (DARK_FROM - DIM_FROM),
    cold: closing >= COLD_FROM,
  };
}

/**
 * How our speed changes from a blow, m/s. `share`: 0.5 against a body that
 * gives way as much as ours (another in freefall), 1 against one that does
 * not (hanging under a canopy).
 */
export function rebound(out: Vec3, c: Contact, share: number): Vec3 {
  const k = Math.max(0, c.closing) * (1 + RESTITUTION) * clamp(share, 0, 1);
  return set(out, c.normal.x * k, c.normal.y * k, c.normal.z * k);
}

/** The axis a blow sets the body turning about, world frame, unit: across the way it came and the way they met. */
export function tumbleAxis(out: Vec3, c: Contact, usVel: Vec3, themVel: Vec3): Vec3 {
  const rel = set(out, themVel.x - usVel.x, themVel.y - usVel.y, themVel.z - usVel.z);
  // What of it goes past rather than straight in: that is what turns the body.
  const along = dot(rel, c.normal);
  set(rel, rel.x - c.normal.x * along, rel.y - c.normal.y * along, rel.z - c.normal.z * along);
  if (Math.hypot(rel.x, rel.y, rel.z) < 0.5) {
    // Square on: over, about any axis across the blow.
    const n = c.normal;
    if (Math.abs(n.y) < 0.9) set(rel, 0, 1, 0);
    else set(rel, 1, 0, 0);
  }
  const axis = cross(vec3(), c.normal, rel);
  const l = Math.hypot(axis.x, axis.y, axis.z) || 1;
  return set(out, axis.x / l, axis.y / l, axis.z / l);
}
