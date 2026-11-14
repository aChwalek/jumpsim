// How many points a landing is worth, from how far off the target's centre
// the feet first touched. On its own, with nothing to import: the Worker
// counts the leaderboard's points with it too, from the distance sent.

/** Radii of the rings painted round the centre, m: 1, 2, 5, then the wide ones seen from the circuit. */
export const ACCURACY_RINGS = [1, 2, 5, 10, 20] as const;
/** Radius of the disc in the middle, m. */
export const ACCURACY_CENTRE = 0.3;
/** From this far out, no points, m. */
export const ACCURACY_MAX = 100;
/** Points for the dead centre. */
export const ACCURACY_TOP = 1000;
/** Points of the bullseye, won in the last metre; the rest go down slowly all the way out. */
const BULLSEYE = 300;
/** Where half the bullseye's points are gone, m, and how sharp its edge: above 1, a few centimetres off the centre lose little. */
const BULL_HALF = 0.5;
const BULL_SHARPNESS = 1.5;
/** Distance scale of the rest, m: the larger, the slower they go. */
const REACH = 4;

/**
 * Points for touching down this far from the centre, m: 1000 on it, 970 at
 * 10 cm, 825 at half a metre, 730 at a metre, 646 at 2 m, 535 at 5 m, 434
 * at 10 m, 316 at 20 m, 141 at 50 m, down to none at 100 m. Two parts: a
 * bullseye of 300 points that is all in the last metre, and 700 more that
 * fall off a little less with every metre out. The first metre is worth 270,
 * the tenth 17, the fiftieth 4.
 */
export function accuracyPoints(distance: number): number {
  if (!(distance < ACCURACY_MAX)) return 0;
  const d = Math.max(0, distance);
  const bull = 1 / (1 + (d / BULL_HALF) ** BULL_SHARPNESS);
  const reach = 1 - Math.log1p(d / REACH) / Math.log1p(ACCURACY_MAX / REACH);
  return Math.round(BULLSEYE * bull + (ACCURACY_TOP - BULLSEYE) * reach);
}
