// A target for the camera: another player, or a fixed point of the world
// picked on the ground. Once locked, the eyes turn to it and the outside
// camera stands behind the jumper on the line from it, so both are in the
// picture.

import * as THREE from 'three';

export type Target = { kind: 'player'; id: string } | { kind: 'point'; pos: THREE.Vector3 };

/** A player in sight, to pick from. */
export interface Candidate {
  id: string;
  pos: THREE.Vector3;
}

/** How far off the middle of the screen a player can be and still be picked, rad. */
export const PICK_ANGLE = 0.08;
/** Furthest a point on the ground can be picked, m. */
const PICK_RANGE = 30000;
/** How much higher than the line from the target the outside camera stands, rad: the target shows over the jumper. */
const OVER = 0.12;

/**
 * Where a ray first meets the ground, or null if it goes up or out of range.
 * Marches along it by a share of the height left, then halves the last step.
 */
export function pickPoint(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  groundAt: (x: number, z: number) => number,
  out = new THREE.Vector3(),
): THREE.Vector3 | null {
  const above = (t: number): number => origin.y + dir.y * t - groundAt(origin.x + dir.x * t, origin.z + dir.z * t);
  if (above(0) < 0) return null;
  let before = 0;
  let t = 0;
  for (let i = 0; i < 2000 && t < PICK_RANGE; i++) {
    const h = above(t);
    if (h <= 0) {
      let lo = before;
      let hi = t;
      for (let j = 0; j < 30; j++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      return out.copy(dir).multiplyScalar(hi).add(origin);
    }
    before = t;
    t += Math.max(0.5, h * 0.4);
  }
  return null;
}

/** The player nearest the middle of the screen, within PICK_ANGLE of it. */
export function pickPlayer(origin: THREE.Vector3, dir: THREE.Vector3, candidates: Candidate[]): string | null {
  let best: string | null = null;
  let bestAngle = PICK_ANGLE;
  const to = new THREE.Vector3();
  for (const c of candidates) {
    to.subVectors(c.pos, origin);
    if (to.lengthSq() < 1e-6) continue;
    const angle = to.angleTo(dir);
    if (angle < bestAngle) {
      bestAngle = angle;
      best = c.id;
    }
  }
  return best;
}

/** The next player in the list after `current` (or before, `step` -1), going round. */
export function cycle(ids: string[], current: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  const next = at < 0 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length;
  return ids[next] ?? null;
}

/**
 * Where the outside camera stands to look at the jumper (`focus`) and past
 * them at the target: the heading behind and the angle above, as ChaseTarget
 * takes them; no heading when the target is straight above or below. Null
 * when they are in the same place.
 */
export function lockedChase(focus: THREE.Vector3, target: THREE.Vector3): { heading: number | null; above: number } | null {
  const dx = focus.x - target.x;
  const dy = focus.y - target.y;
  const dz = focus.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.5) return null;
  // The chase camera stands at (-sin h, ·, cos h) from the focus: on the far side from the target.
  const heading = Math.hypot(dx, dz) < 1e-3 ? null : Math.atan2(-dx, dz);
  const above = Math.max(-1.2, Math.min(1.42, Math.asin(dy / length) + OVER));
  return { heading, above };
}
