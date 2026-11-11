// The audible altimeter in the helmet: under canopy it beeps once on the way
// down through each of the circuit heights it is set to.

import type { Beeps } from './sound';

/** Circuit heights, m above the drop zone, and how each one sounds. */
export const CANOPY_ALARMS: { altitude: number; beeps: Beeps }[] = [
  // Start of the downwind leg: one long tone.
  { altitude: 300, beeps: { count: 1, seconds: 0.9, gap: 0 } },
  // Base leg: two.
  { altitude: 200, beeps: { count: 2, seconds: 0.35, gap: 0.15 } },
  // Last turn onto final: three quick ones.
  { altitude: 100, beeps: { count: 3, seconds: 0.16, gap: 0.09 } },
];

/** Margin above an alarm height a jump must start at for it to go off, m. */
const ARM_MARGIN = 10;

export class Altisonic {
  private armed = CANOPY_ALARMS.map(() => false);

  /** A new start at this altitude: only the heights still below go off. */
  reset(altitude: number): void {
    this.armed = CANOPY_ALARMS.map((a) => altitude > a.altitude + ARM_MARGIN);
  }

  /** The beeps to play now, if an alarm height has just been passed. */
  update(altitude: number): Beeps | null {
    for (let i = 0; i < CANOPY_ALARMS.length; i++) {
      const alarm = CANOPY_ALARMS[i]!;
      if (this.armed[i] && altitude <= alarm.altitude) {
        this.armed[i] = false;
        // Passing several at once, as on a jump straight in, sounds the lowest.
        if (!CANOPY_ALARMS.some((a, k) => k > i && this.armed[k] && altitude <= a.altitude)) return alarm.beeps;
      }
    }
    return null;
  }
}
