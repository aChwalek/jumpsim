// Where the neck takes the eyes in freefall, seen from inside the helmet.

import type { BodyPosition, Freefall } from '../sim/freefall';
import { DEG } from '../sim/vec';

/**
 * Flat on the air the head comes up, eyes on the horizon as students are
 * taught, as far as the neck goes; in the door they look out and down.
 */
export const FREEFALL_GAZE = -20 * DEG;
export const DOOR_GAZE = -12 * DEG;
const NECK_UP = 75 * DEG;
const NECK_DOWN = -40 * DEG;

export interface Neck {
  /** The pitch of the line of sight it goes for, rad. */
  gaze: number;
  /** The neck angle it would rather have when two would do, rad, positive towards the top of the head. */
  prefer: number;
  /** How far it goes, rad. */
  lo: number;
  hi: number;
}

/**
 * Where the neck takes the eyes in each freefall position: the pitch of the
 * line of sight it goes for, the neck angle it would rather have when two
 * would do, and how far it goes, rad, positive towards the top of the head.
 */
export const NECKS: Record<BodyPosition, Neck> = {
  belly: { gaze: FREEFALL_GAZE, prefer: 60 * DEG, lo: NECK_DOWN, hi: NECK_UP },
  // Chin to the chest and the shoulders curled, to look out past the knees
  // at the horizon beyond the feet.
  back: { gaze: FREEFALL_GAZE, prefer: -75 * DEG, lo: -75 * DEG, hi: NECK_UP },
  // The knees just in sight under the horizon.
  sit: { gaze: -20 * DEG, prefer: 0, lo: NECK_DOWN, hi: NECK_UP },
  // The horizon upside down: ground on top, sky underneath.
  headDown: { gaze: -10 * DEG, prefer: 0, lo: NECK_DOWN, hi: NECK_UP },
};

/** On the back, the head this far below the feet (the sine of the angle), the body is going head first. */
const HEAD_FIRST = Math.sin(8 * DEG);

/**
 * Where the neck takes the eyes for how the body is held; flat on the belly
 * with none. Flown progressively, head low on the back (a back angle, a back
 * track) the body goes head first: the eyes go over the top of the head to
 * where it goes, as on the belly, not past the knees to where it came from.
 */
export function neckOf(body: Freefall | null): Neck {
  if (!body) return NECKS.belly;
  const headFirst = body.progressive && body.position === 'back' && body.aim.y < -HEAD_FIRST;
  return headFirst ? NECKS.belly : NECKS[body.position];
}

/**
 * The neck angle that tips the face onto the pitch `gaze`, given how high
 * the face (`f`) and the top of the head (`h`) point: of the two that do, the
 * nearer `prefer`, within the neck's range.
 */
export function neckFor(f: number, h: number, gaze: number, prefer: number, lo: number, hi: number): number {
  const r = Math.hypot(f, h);
  let a = prefer;
  if (r > 0.05) {
    // f cos a + h sin a = r cos(a - phi) = sin(gaze)
    const phi = Math.atan2(h, f);
    const c = Math.acos(Math.max(-1, Math.min(1, Math.sin(gaze) / r)));
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const a1 = wrap(phi + c);
    const a2 = wrap(phi - c);
    a = Math.abs(a1 - prefer) <= Math.abs(a2 - prefer) ? a1 : a2;
  }
  return Math.max(lo, Math.min(hi, a));
}
