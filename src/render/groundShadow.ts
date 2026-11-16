// Shadows on the relief. A shadow is cast along the light to where that ray
// meets the ground, then laid flat on the ground there, as slanted as the
// slope. One drawn at the height of the ground straight below the caster
// hangs in the air over a slope that falls away, and sinks into one that
// rises.

import * as THREE from 'three';
import { groundNormal, type GroundAt } from '../sim/slope';

export type { GroundAt };

/** Where a shadow falls. */
export interface ShadowFall {
  /** On the ground, world frame. */
  readonly point: THREE.Vector3;
  /** The ground's up there. */
  readonly normal: THREE.Vector3;
  /** How far below what casts it, m. */
  drop: number;
}

export const shadowFall = (): ShadowFall => ({ point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), drop: 0 });

/** The relief climbs towards a ray no steeper than this, m up per m across (72°): the march's steps keep under it. */
const STEEP = 3;
const MIN_STEP = 0.25;
/** Steps grow with the distance gone at least by this share, so that a ray running along a slope gets there. */
const GROWTH = 0.05;
const MAX_STEPS = 160;
/** Past this along the light, m, a shadow is too blurred to show. */
const REACH = 3000;
/** Shadows sit this far off the ground, m, so that they stay over it. */
const LIFT = 0.05;

/**
 * Follows the light down from `from` (`light` points towards the sun or
 * moon) to the ground. False if it does not get there within reach.
 */
export function castShadow(from: THREE.Vector3, light: THREE.Vector3, groundAt: GroundAt, fall: ShadowFall): boolean {
  const across = Math.hypot(light.x, light.z);
  // How fast, per metre along the ray, it can close on the ground at most.
  const closing = Math.max(0.02, light.y) + STEEP * across;
  let t = 0;
  let above = from.y - groundAt(from.x, from.z, from.y);
  if (above > 0) {
    let under = -1;
    for (let i = 0; i < MAX_STEPS && under < 0; i++) {
      const next = t + Math.max(MIN_STEP, above / closing, GROWTH * t);
      if (next > REACH) return false;
      const y = from.y - light.y * next;
      const h = y - groundAt(from.x - light.x * next, from.z - light.z * next, y);
      if (h <= 0) under = next;
      else {
        t = next;
        above = h;
      }
    }
    if (under < 0) return false;
    // Between the last step, over the ground, and this one, under it.
    for (let k = 0; k < 12; k++) {
      const mid = (t + under) / 2;
      const y = from.y - light.y * mid;
      if (y - groundAt(from.x - light.x * mid, from.z - light.z * mid, y) > 0) t = mid;
      else under = mid;
    }
    t = under;
  }
  const x = from.x - light.x * t;
  const z = from.z - light.z * t;
  // Read from just above, so that a deck is found and not the river under it.
  const probe = from.y - light.y * t + 0.5;
  const y = groundAt(x, z, probe);
  fall.point.set(x, y, z);
  fall.drop = from.y - y;
  groundNormal(fall.normal, groundAt, x, z, probe);
  return true;
}

/**
 * How strongly the light falls on the ground there, 0 to 1: a slope turned
 * away from it is in its own shade and takes no shadow, and one it grazes
 * spreads a shadow long and faint.
 */
export function shadowGrazing(light: THREE.Vector3, fall: ShadowFall): number {
  return THREE.MathUtils.clamp((light.dot(fall.normal) - 0.02) / 0.1, 0, 1);
}

/**
 * The matrix that lays a shape onto the ground's flat at `fall`, along the
 * light: `out` = (projection along the light onto that plane) · `placed`,
 * where `placed` puts the shape, drawn flat, where its caster is.
 */
export function layShadow(out: THREE.Matrix4, placed: THREE.Matrix4, light: THREE.Vector3, fall: ShadowFall): THREE.Matrix4 {
  const n = fall.normal;
  const s = light;
  // Not below 0.02: shadowGrazing has faded it out by then.
  const sn = Math.max(0.02, s.dot(n));
  // The plane: n·p = q. A point p goes to p − s (n·p − q) / (s·n).
  const q = fall.point.dot(n) + LIFT;
  out.set(
    1 - (s.x * n.x) / sn, -(s.x * n.y) / sn, -(s.x * n.z) / sn, (s.x * q) / sn,
    -(s.y * n.x) / sn, 1 - (s.y * n.y) / sn, -(s.y * n.z) / sn, (s.y * q) / sn,
    -(s.z * n.x) / sn, -(s.z * n.y) / sn, 1 - (s.z * n.z) / sn, (s.z * q) / sn,
    0, 0, 0, 1,
  );
  return out.multiply(placed);
}

/** Where `p` falls on the ground's flat at `fall`, along the light. */
export function onShadowPlane(out: THREE.Vector3, p: THREE.Vector3, light: THREE.Vector3, fall: ShadowFall): THREE.Vector3 {
  const n = fall.normal;
  const sn = Math.max(0.02, light.dot(n));
  const k = (p.dot(n) - fall.point.dot(n) - LIFT) / sn;
  return out.copy(p).addScaledVector(light, -k);
}

/** Opacity of a shadow `drop` metres under its caster, before the light's own strength: crisp near, faint from high up. */
export const shadowOpacity = (drop: number): number => 0.12 + 0.36 * Math.max(0, 1 - drop / 250);
