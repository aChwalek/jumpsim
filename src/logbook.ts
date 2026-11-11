// The logbook: every jump that ended on the ground, and what they add up to.
// Kept in the browser, like the setup.

import type { CanopyKind } from './sim/rig';
import type { LandingRating } from './sim/landing';
import type { GustLevel, SkyKind } from './sim/weather';
import type { Start } from './setup';

/** How a jump ended: a landing, or the ground with no canopy flying. */
export type Outcome = LandingRating | 'impact';

export interface LogEntry {
  /** Jump number in this logbook, from 1. */
  n: number;
  /** When it ended, ms since 1970. */
  time: number;
  dz: string;
  dzName: string;
  start: Start;
  hour: number;
  weather: { sky: SkyKind; windFromDeg: number; windKmh: number; gusts: GustLevel };
  canopy: { kind: CanopyKind; areaFt2: number; exitWeightKg: number; wingLoading: number };
  /** From the plane only. */
  freefall?: {
    exitHeight: number;
    /** Null when the AAD fired. */
    pullHeight: number | null;
    seconds: number;
    topSpeed: number;
    aad: boolean;
  };
  /** Time flying the canopy, s. */
  canopySeconds: number;
  outcome: Outcome;
  /** At touchdown, m/s; for an impact, the speed of it. */
  sink: number;
  groundSpeed: number;
  /** From the target, m: landings only. */
  distance?: number;
  wet?: boolean;
}

/** The outcomes, grouped as the logbook shows them. */
export const OUTCOME_GROUPS = [
  { label: 'Debout', outcomes: ['standUp', 'firm', 'heavy'] },
  { label: 'Couru', outcomes: ['run'] },
  { label: 'Glissé', outcomes: ['slide'] },
  { label: 'Dur', outcomes: ['hard'] },
  { label: 'Crash', outcomes: ['crash', 'impact'] },
] as const satisfies readonly { label: string; outcomes: readonly Outcome[] }[];

export const OUTCOME_NAMES: Record<Outcome, string> = {
  standUp: 'Posé debout',
  firm: 'Posé debout, sec',
  heavy: 'Posé debout, lourd',
  run: 'Posé couru',
  slide: 'Posé glissé',
  hard: 'Atterrissage dur',
  crash: 'Crash',
  impact: 'Impact sans voile',
};

/** Keeps the browser's storage small: the oldest go first. */
const MAX_ENTRIES = 1000;
const STORE = 'logbook';

export function loadLogbook(): LogEntry[] {
  try {
    const saved = localStorage.getItem(STORE);
    const list: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(list) ? list.filter((e): e is LogEntry => typeof e?.n === 'number' && typeof e?.outcome === 'string') : [];
  } catch {
    return [];
  }
}

function save(entries: LogEntry[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Private browsing or storage full: the jump is not kept.
  }
}

/** Writes a jump in the logbook and gives it its number. */
export function logJump(entry: Omit<LogEntry, 'n'>): LogEntry {
  const entries = loadLogbook();
  const logged = { ...entry, n: (entries.at(-1)?.n ?? 0) + 1 };
  entries.push(logged);
  save(entries);
  return logged;
}

export function clearLogbook(): void {
  save([]);
}

export interface LogStats {
  jumps: number;
  planeJumps: number;
  freefallSeconds: number;
  canopySeconds: number;
  /** Jumps per group of OUTCOME_GROUPS, in the same order. */
  groups: number[];
  landings: number;
  /** Closest to the target, m, or null with no landing yet. */
  bestDistance: number | null;
  /** Mean distance to the target over the last ten landings, m. */
  recentDistance: number | null;
  /** Lowest pull by hand, m. */
  lowestPull: number | null;
  aadFires: number;
}

export function logStats(entries: readonly LogEntry[]): LogStats {
  const groups = OUTCOME_GROUPS.map((g) => entries.filter((e) => (g.outcomes as readonly Outcome[]).includes(e.outcome)).length);
  const landed = entries.filter((e) => e.outcome !== 'impact' && e.distance !== undefined);
  const distances = landed.map((e) => e.distance!);
  const recent = distances.slice(-10);
  const pulls = entries.flatMap((e) => (e.freefall?.pullHeight != null ? [e.freefall.pullHeight] : []));
  return {
    jumps: entries.length,
    planeJumps: entries.filter((e) => e.start === 'plane').length,
    freefallSeconds: entries.reduce((sum, e) => sum + (e.freefall?.seconds ?? 0), 0),
    canopySeconds: entries.reduce((sum, e) => sum + e.canopySeconds, 0),
    groups,
    landings: landed.length,
    bestDistance: distances.length ? Math.min(...distances) : null,
    recentDistance: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null,
    lowestPull: pulls.length ? Math.min(...pulls) : null,
    aadFires: entries.filter((e) => e.freefall?.aad).length,
  };
}
