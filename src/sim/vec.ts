// Minimal allocation-free vector math for the simulation core.
// Convention (same as Three.js): +X right, +Y up, +Z backward. Forward is -Z.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w });

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

/** out = a x b. `out` may alias a or b. */
export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return set(out, x, y, z);
}

/** Rotate v by q (body -> world when q is the body attitude). `out` may alias v. */
export function rotate(out: Vec3, q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(qv x v) + 2 qv x (qv x v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  return set(out, x, y, z);
}

/** Rotate v by the inverse of q (world -> body). `out` may alias v. */
export function rotateInv(out: Vec3, q: Quat, v: Vec3): Vec3 {
  const tx = -2 * (q.y * v.z - q.z * v.y);
  const ty = -2 * (q.z * v.x - q.x * v.z);
  const tz = -2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx - (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty - (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz - (q.x * ty - q.y * tx);
  return set(out, x, y, z);
}

/** Advance attitude q by body-frame angular velocity w over dt, then renormalize. */
export function integrateQuat(q: Quat, w: Vec3, dt: number): void {
  const h = 0.5 * dt;
  const dx = h * (q.w * w.x + q.y * w.z - q.z * w.y);
  const dy = h * (q.w * w.y + q.z * w.x - q.x * w.z);
  const dz = h * (q.w * w.z + q.x * w.y - q.y * w.x);
  const dw = h * (-q.x * w.x - q.y * w.y - q.z * w.z);
  q.x += dx;
  q.y += dy;
  q.z += dz;
  q.w += dw;
  const n = 1 / Math.hypot(q.x, q.y, q.z, q.w);
  q.x *= n;
  q.y *= n;
  q.z *= n;
  q.w *= n;
}

/** Quaternion for a rotation of `angle` radians about the +Y (up) axis. */
export function quatFromYaw(out: Quat, angle: number): Quat {
  out.x = 0;
  out.y = Math.sin(angle / 2);
  out.z = 0;
  out.w = Math.cos(angle / 2);
  return out;
}

/** Quaternion for a rotation of `angle` radians about a unit axis. */
export function quatFromAxisAngle(out: Quat, axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  out.x = axis.x * s;
  out.y = axis.y * s;
  out.z = axis.z * s;
  out.w = Math.cos(angle / 2);
  return out;
}

/** out = a * b: the rotation b, then a. `out` may alias a or b. */
export function quatMultiply(out: Quat, a: Quat, b: Quat): Quat {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

/** The attitude a fraction t of the way from a to b, by the shorter way round. `out` may alias a or b. */
export function quatSlerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    ka = Math.sin((1 - t) * angle) / sin;
    kb = Math.sin(t * angle) / sin;
  }
  kb *= sign;
  const x = ka * a.x + kb * b.x;
  const y = ka * a.y + kb * b.y;
  const z = ka * a.z + kb * b.z;
  const w = ka * a.w + kb * b.w;
  const n = 1 / Math.hypot(x, y, z, w);
  out.x = x * n;
  out.y = y * n;
  out.z = z * n;
  out.w = w * n;
  return out;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const DEG = Math.PI / 180;
