// The logbook: every jump that ended on the ground, and what they add up to.
// Kept in the browser, like the setup.

import type { ReserveBy } from './sim/jump';
import type { Malfunction } from './sim/opening';
import type { CanopyKind } from './sim/rig';
import type { LandingRating } from './sim/landing';
import type { GustLevel, SkyKind } from './sim/weather';
import type { Start } from './setup';
import type { Swoop } from './sim/swoop';

/** How a jump ended: a landing, or the ground with no canopy flying. */
export type Outcome = LandingRating | 'impact';

export const JUMP_DISCIPLINES = ['normal', 'wingsuit', 'base', 'wingbase', 'canopy', 'unknown'] as const;
export type JumpDiscipline = (typeof JUMP_DISCIPLINES)[number];
export type LogbookFilter = 'all' | JumpDiscipline;

export interface LogEntry {
  /** Jump number in this logbook, from 1. */
  n: number;
  /** When it ended, ms since 1970. */
  time: number;
  dz: string;
  dzName: string;
  start: Start;
  /** Absent on older jumps, whose suit was not recorded. */
  discipline?: Exclude<JumpDiscipline, 'unknown'>;
  hour: number;
  weather: { sky: SkyKind; windFromDeg: number; windKmh: number; gusts: GustLevel };
  canopy: { kind: CanopyKind; areaFt2: number; exitWeightKg: number; wingLoading: number };
  /** Freefall from a plane or BASE exit. */
  freefall?: {
    exitHeight: number;
    /** Null when the AAD fired. */
    pullHeight: number | null;
    seconds: number;
    topSpeed: number;
    /** Peak horizontal ground speed in freefall, m/s; absent on older jumps. */
    topHorizontalSpeed?: number;
    aad: boolean;
  };
  /** A malfunction, a cutaway, a reserve: only when there was one. */
  emergency?: {
    malfunction: Malfunction | null;
    /** Where the main was cut away, m, or null. */
    cutawayHeight: number | null;
    /** Where the reserve was pulled, m, and by what; null if it stayed in. */
    reserveHeight: number | null;
    reserveBy: ReserveBy | null;
  };
  /** Time flying the canopy, s. */
  canopySeconds: number;
  /** Entire airborne path, including opening; absent from older entries. */
  flight?: { seconds: number; horizontalDistance: number };
  /** Measured on new jumps only, including attempts ending in a crash. */
  swoop?: Swoop;
  outcome: Outcome;
  /** At touchdown, m/s; for an impact, the speed of it. */
  sink: number;
  groundSpeed: number;
  /** From the target, m: landings only. */
  distance?: number;
  wet?: boolean;
  /**
   * Points of the accuracy challenge, 0 to 1000: landings with the challenges
   * on only. (Named so that scores out of 100 kept by a first version are left out.)
   */
  accuracy?: number;
}

/** The outcomes, grouped as the logbook shows them; named in T.logbook. */
export const OUTCOME_GROUPS = [
  { id: 'upright', outcomes: ['standUp', 'firm', 'heavy'] },
  { id: 'run', outcomes: ['run'] },
  { id: 'slide', outcomes: ['slide'] },
  { id: 'hard', outcomes: ['hard'] },
  { id: 'crash', outcomes: ['crash', 'impact'] },
] as const satisfies readonly { id: string; outcomes: readonly Outcome[] }[];

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

export function jumpDiscipline(entry: LogEntry): JumpDiscipline {
  return entry.discipline ?? (entry.start === 'plane' || entry.start === 'base' ? 'unknown' : 'canopy');
}

export function filterLogbook(entries: readonly LogEntry[], filter: LogbookFilter): readonly LogEntry[] {
  return filter === 'all' ? entries : entries.filter((entry) => jumpDiscipline(entry) === filter);
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
  /** Best accuracy score, or null with none scored yet. */
  bestScore: number | null;
  /** Mean accuracy score over the last ten scored landings. */
  recentScore: number | null;
  /** Records only count jumps that ended without a crash or impact. */
  longestFlightSeconds: number | null;
  longestFlightDistance: number | null;
  longestFreefallSeconds: number | null;
  fastestVerticalSpeed: number | null;
  fastestHorizontalSpeed: number | null;
  longestSwoopDistance: number | null;
  longestSwoopSeconds: number | null;
  fastestSwoopSpeed: number | null;
  bestStreak: number;
  currentStreak: number;
  /** Lowest pull by hand on a survived jump, m (AAD excluded). */
  lowestPull: number | null;
  aadFires: number;
}

export function logStats(entries: readonly LogEntry[]): LogStats {
  const groups = OUTCOME_GROUPS.map((g) => entries.filter((e) => (g.outcomes as readonly Outcome[]).includes(e.outcome)).length);
  const landed = entries.filter((e) => e.outcome !== 'impact' && e.distance !== undefined);
  const distances = landed.map((e) => e.distance!);
  const recent = distances.slice(-10);
  const scores = entries.flatMap((e) => (e.accuracy !== undefined ? [e.accuracy] : []));
  const recentScores = scores.slice(-10);
  const survived = entries.filter((e) => e.outcome !== 'crash' && e.outcome !== 'impact');
  const pulls = survived.flatMap((e) => (!e.freefall?.aad && e.freefall?.pullHeight != null ? [e.freefall.pullHeight] : []));
  const maximum = (values: number[]): number | null => values.length ? Math.max(...values) : null;
  let bestStreak = 0;
  let currentStreak = 0;
  for (const entry of entries) {
    currentStreak = entry.outcome === 'crash' || entry.outcome === 'impact' ? 0 : currentStreak + 1;
    bestStreak = Math.max(bestStreak, currentStreak);
  }
  return {
    jumps: entries.length,
    planeJumps: entries.filter((e) => e.start === 'plane').length,
    freefallSeconds: entries.reduce((sum, e) => sum + (e.freefall?.seconds ?? 0), 0),
    canopySeconds: entries.reduce((sum, e) => sum + e.canopySeconds, 0),
    groups,
    landings: landed.length,
    bestDistance: distances.length ? Math.min(...distances) : null,
    recentDistance: recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    recentScore: recentScores.length ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length : null,
    longestFlightSeconds: maximum(survived.flatMap((e) => e.flight ? [e.flight.seconds] : [])),
    longestFlightDistance: maximum(survived.flatMap((e) => e.flight ? [e.flight.horizontalDistance] : [])),
    longestFreefallSeconds: maximum(survived.flatMap((e) => e.freefall ? [e.freefall.seconds] : [])),
    fastestVerticalSpeed: maximum(survived.flatMap((e) => e.freefall ? [e.freefall.topSpeed] : [])),
    fastestHorizontalSpeed: maximum(survived.flatMap((e) => e.freefall?.topHorizontalSpeed !== undefined ? [e.freefall.topHorizontalSpeed] : [])),
    longestSwoopDistance: maximum(survived.flatMap((e) => e.swoop ? [e.swoop.distance] : [])),
    longestSwoopSeconds: maximum(survived.flatMap((e) => e.swoop ? [e.swoop.seconds] : [])),
    fastestSwoopSpeed: maximum(survived.flatMap((e) => e.swoop ? [e.swoop.topSpeed] : [])),
    bestStreak,
    currentStreak,
    lowestPull: pulls.length ? Math.min(...pulls) : null,
    aadFires: entries.filter((e) => e.freefall?.aad).length,
  };
}
