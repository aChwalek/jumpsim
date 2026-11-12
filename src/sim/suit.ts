// What the jumper wears: a plain jumpsuit, a tracking suit or a wingsuit,
// the last two in three levels, from the first one bought to the one only
// the experienced fly.
//
// A tracking suit is a jumpsuit of stiff, air-filled fabric, with little
// wings under the arms on the bigger ones: the track becomes a better wing,
// from about a metre forward for a metre down in a plain jumpsuit to nearly
// two. Everything else (belly, back, sitting, head down) flies about as before.
//
// A wingsuit has wings between the arms and the body and one between the
// legs: once they fill, a few seconds out of the door, the body is a wing,
// flown belly down or on the back and nothing else. About two metres forward
// for a metre down on a first wingsuit, three on a big one, the fall down to
// some 50 to 70 km/h. To pull, the wings are let go of: the body falls flat
// for a moment, and the pilot chute goes.
//
// Numbers checked against what wingsuit and tracking pilots log (see
// tests/suit.test.ts).

import { airDensityAt } from './atmosphere';
import { Freefall, JUMPSUIT_FIT, TRACK_SHAPES, freefallParams, noBodyInputs, tiltFor, type BodyPosition, type SuitFit, type TrackShape } from './freefall';
import { SIM_DT } from './telemetry';
import { DEG, set, vec3 } from './vec';

export type SuitKind = 'jumpsuit' | 'track' | 'wingsuit';
export const SUIT_KINDS: readonly SuitKind[] = ['jumpsuit', 'track', 'wingsuit'];

/** 1: a first one; 2: for those who have flown a few; 3: for the experienced. */
export type SuitLevel = 1 | 2 | 3;
export const SUIT_LEVELS: readonly SuitLevel[] = [1, 2, 3];

export interface Suit {
  kind: SuitKind;
  /** Irrelevant for a plain jumpsuit. */
  level: SuitLevel;
}

export const JUMPSUIT: Suit = { kind: 'jumpsuit', level: 1 };

export const isSuitKind = (v: unknown): v is SuitKind => SUIT_KINDS.includes(v as SuitKind);
export const isSuitLevel = (v: unknown): v is SuitLevel => SUIT_LEVELS.includes(v as SuitLevel);

/** Flown as a wing from the door to the pull, belly down or on the back. */
export const hasWings = (suit: Suit | undefined): boolean => suit?.kind === 'wingsuit';

/** Flat on the air, in the track: the arms back along the body, the wings or the fabric spread. */
interface Wing {
  /** Drag areas against the suit's own belly, flat on the air. */
  area: [number, number, number];
  /** Where the body settles off the airflow, deg: nothing asked, pushed (dive) and held back (ease). */
  settled: number;
  dive: number;
  ease: number;
}

const flat = (w: Wing, dir: 1 | -1): TrackShape => ({
  area: vec3(...w.area),
  tilt: tiltFor(w.settled * DEG),
  dive: tiltFor(w.dive * DEG),
  ease: tiltFor(w.ease * DEG),
  dir,
});

/** On the back a little less well than on the belly: the wings are cut for the belly. */
const onBack = (w: Wing): Wing => ({ ...w, area: [w.area[0], w.area[1] * 1.12, w.area[2] * 0.97] });

/** The track (flat) and the angle (upright) in a suit flown flat this way. */
function tracks(w: Wing): Record<BodyPosition, TrackShape> {
  return { ...TRACK_SHAPES, belly: flat(w, 1), back: flat(onBack(w), -1) };
}

interface Cut {
  size: number;
  wing: Wing;
  trackIn: number;
  trackTurn: number;
}

/**
 * Each level, from what a body that size shows the air. The wing: the more
 * its area flat on the air outweighs what it shows along it, the better it
 * glides. It settles near its best glide, a little faster.
 */
const CUTS: Record<Exclude<SuitKind, 'jumpsuit'>, Record<SuitLevel, Cut>> = {
  track: {
    1: { size: 1.08, wing: { area: [0.6, 0.23, 2], settled: 70, dive: 75, ease: 45 }, trackIn: 0.7, trackTurn: 0.9 },
    2: { size: 1.18, wing: { area: [0.6, 0.18, 2.1], settled: 72, dive: 77, ease: 48 }, trackIn: 0.8, trackTurn: 0.8 },
    3: { size: 1.3, wing: { area: [0.6, 0.135, 2.2], settled: 74, dive: 79, ease: 50 }, trackIn: 0.9, trackTurn: 0.7 },
  },
  wingsuit: {
    1: { size: 2, wing: { area: [0.5, 0.21, 3.7], settled: 76, dive: 81, ease: 62 }, trackIn: 1.5, trackTurn: 0.45 },
    2: { size: 2.4, wing: { area: [0.45, 0.14, 3.8], settled: 79, dive: 83, ease: 66 }, trackIn: 1.8, trackTurn: 0.35 },
    3: { size: 2.8, wing: { area: [0.4, 0.093, 3.5], settled: 80.5, dive: 84, ease: 68 }, trackIn: 2.2, trackTurn: 0.28 },
  },
};

/** How a suit flies. */
export function suitFit(suit: Suit | undefined): SuitFit {
  if (!suit || suit.kind === 'jumpsuit') return JUMPSUIT_FIT;
  const cut = CUTS[suit.kind][suit.level];
  return { size: cut.size, tracks: tracks(cut.wing), trackIn: cut.trackIn, trackTurn: cut.trackTurn };
}

/** How a suit glides, steady in the track (or the wings) with nothing asked: km/h forward and down. */
export interface Glide {
  glide: number;
  across: number;
  down: number;
}

const glides = new Map<string, Glide>();

/**
 * Flown belly down, nothing asked, at 1500 m. A wing takes a while to settle
 * into its glide, swinging a little faster and slower about it on the way:
 * averaged once that has died down.
 */
export function suitGlide(suit: Suit, exitWeightKg: number): Glide {
  const key = `${suit.kind}${suit.level}:${exitWeightKg}`;
  const known = glides.get(key);
  if (known) return known;
  const body = new Freefall(freefallParams(exitWeightKg, suitFit(suit)));
  const air = { wind: vec3(), airDensity: airDensityAt(1500) };
  set(body.state.vel, 0, -50, 0);
  // Belly down on the air.
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  body.tracking = true;
  const calm = noBodyInputs();
  for (let t = 0; t < 60; t += SIM_DT) body.step(SIM_DT, calm, air);
  let across = 0;
  let down = 0;
  for (let t = 0; t < 30; t += SIM_DT) {
    body.step(SIM_DT, calm, air);
    const v = body.state.vel;
    across += Math.hypot(v.x, v.z);
    down -= v.y;
  }
  const glide = { glide: across / down, across: (across * 3.6 * SIM_DT) / 30, down: (down * 3.6 * SIM_DT) / 30 };
  glides.set(key, glide);
  return glide;
}
