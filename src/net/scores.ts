// The accuracy leaderboard, as the game and the Worker both see it: what a
// browser sends after a scored landing, what comes back, and how both check
// it. Nothing to import but the points: the Worker builds this file too.

import { ACCURACY_MAX, accuracyPoints } from '../accuracy';

/** The drop zones with a board: those of src/world/dzs.ts, in its order (a test keeps them the same). */
export const BOARD_DZS = [
  'valbrise',
  'tower',
  'pujaut',
  'chambery',
  'empuriabrava',
  'guadeloupe',
  'deland',
  'lauterbrunnen',
  'limska',
  'millau',
  'brento',
] as const;
export type BoardDz = (typeof BOARD_DZS)[number];

/** How many are shown at the top of a board. */
export const BOARD_TOP = 10;
/** The longest a name is shown, in a room or on a board. */
export const NAME_MAX = 20;
/** The starts a score can come from: see Start in src/setup.ts. */
export const BOARD_STARTS = ['plane', 'pattern', 'final', 'base'] as const;
const CANOPY_KINDS = ['classic', 'triCell'] as const;

/** A name as shown: one line, no control characters, not too long. */
export const cleanName = (name: string): string =>
  name
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);

/**
 * A name the game made up ("Parachutiste 42": T.menu.room.defaultName and two
 * digits, in either language), not one the player chose.
 */
export const madeUpName = (name: string): boolean => /^(Parachutiste|Skydiver) \d{2}$/.test(name);

/**
 * One scored landing, as sent. Who sent it is the session's account, and the
 * points are counted where it is received, from the distance.
 */
export interface ScoreSubmission {
  dz: BoardDz;
  /** From the target's centre to where the feet first touched, m. */
  distance: number;
  start: (typeof BOARD_STARTS)[number];
  canopy: { kind: (typeof CANOPY_KINDS)[number]; areaFt2: number };
  windKmh: number;
}

/** A player's best at a drop zone, as a board shows it. */
export interface BoardRow {
  /** Equal points, equal rank. */
  rank: number;
  name: string;
  points: number;
  distance: number;
  start: ScoreSubmission['start'];
  canopy: ScoreSubmission['canopy'];
  windKmh: number;
  /** When it was jumped, ms since 1970. */
  time: number;
  /** The one asking. */
  you: boolean;
}

export interface Board {
  dz: BoardDz;
  /** How many have a score there. */
  players: number;
  top: BoardRow[];
  /** The one asking, when they have a score there and are not in the top. */
  you: BoardRow | null;
}

/** Where a landing just sent leaves its player on that drop zone's board. */
export interface Standing {
  rank: number;
  players: number;
  /** Their best there, this landing or one before. */
  points: number;
  /** This landing is their new best there. */
  improved: boolean;
}

/** A player's place at one drop zone, for their profile. */
export interface Place {
  dz: BoardDz;
  rank: number;
  players: number;
  points: number;
}

const isFinite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** A submission as received, checked; null if anything in it is not right. Only landings that score are taken. */
export function parseSubmission(body: unknown): ScoreSubmission | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const canopy = (typeof b.canopy === 'object' && b.canopy !== null ? b.canopy : {}) as Record<string, unknown>;
  if (!oneOf(BOARD_DZS, b.dz) || !oneOf(BOARD_STARTS, b.start) || !oneOf(CANOPY_KINDS, canopy.kind)) return null;
  if (!isFinite(b.distance) || b.distance < 0 || accuracyPoints(b.distance) <= 0) return null;
  if (!isFinite(canopy.areaFt2) || canopy.areaFt2 < 30 || canopy.areaFt2 > 400) return null;
  if (!isFinite(b.windKmh) || b.windKmh < 0 || b.windKmh > 150) return null;
  return {
    dz: b.dz,
    // To the centimetre: nothing finer is shown or scored differently.
    distance: Math.round(b.distance * 100) / 100,
    start: b.start,
    canopy: { kind: canopy.kind, areaFt2: Math.round(canopy.areaFt2) },
    windKmh: Math.round(b.windKmh),
  };
}

/** The points of a submission, counted where it is received. */
export const submissionPoints = (s: ScoreSubmission): number => accuracyPoints(Math.min(s.distance, ACCURACY_MAX));
