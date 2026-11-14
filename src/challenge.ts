// The challenges laid out at every drop zone, which can be turned off. For now
// one: accuracy, a target of rings round the drop zone's own target, scored
// on how close to its centre the feet first touch.

import { accuracyPoints } from './accuracy';
import type { LogEntry } from './logbook';
import type { LandingRating } from './sim/landing';

export { ACCURACY_CENTRE, ACCURACY_MAX, ACCURACY_RINGS, ACCURACY_TOP, accuracyPoints } from './accuracy';

/** Why a landing scores nothing, however close it came: hurt, in the water, in the vines. */
export type Spoilt = 'wet' | 'vines' | 'crash' | 'hard';

export interface AccuracyScore {
  points: number;
  /** From the centre to where the feet first touched, m. */
  distance: number;
  spoilt: Spoilt | null;
}

/**
 * The score of a landing: the distance alone, so long as the pilot came down
 * on dry ground and on their feet; a slide counts, where it began.
 */
export function scoreAccuracy(distance: number, rating: LandingRating, wet: boolean, vines: boolean): AccuracyScore {
  const spoilt: Spoilt | null = wet ? 'wet' : vines ? 'vines' : rating === 'crash' ? 'crash' : rating === 'hard' ? 'hard' : null;
  return { points: spoilt ? 0 : accuracyPoints(distance), distance, spoilt };
}

/** The best score at a drop zone so far, or null if none was scored there. */
export function bestScore(entries: readonly LogEntry[], dz: string): number | null {
  let best: number | null = null;
  for (const e of entries) if (e.dz === dz && e.accuracy !== undefined && (best === null || e.accuracy > best)) best = e.accuracy;
  return best;
}
