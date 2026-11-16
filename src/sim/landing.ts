// Touchdown detection and a verdict on how it went.

import type { FlightModel } from './flightModel';
import { againstGround, groundNormal, type GroundAt } from './slope';
import { emptyTelemetry, readTelemetry } from './telemetry';
import { calmAir } from './flightModel';
import { vec3 } from './vec';

/**
 * From best to worst. Each says what happens. Ground speed decides what the
 * legs do: stood up, `run` off, or above what anyone runs, slid on the feet
 * while the canopy holds the pilot up (skim.ts), and sat down and slid off
 * when it does not. Sink decides how it feels on the feet: `firm`, then
 * `heavy`, but still standing.
 */
export type LandingRating = 'standUp' | 'firm' | 'heavy' | 'run' | 'slide' | 'hard' | 'crash';

const ORDER: LandingRating[] = ['standUp', 'firm', 'heavy', 'run', 'slide', 'hard', 'crash'];

/** Ground speed above which a landing is run off rather than stood up, m/s. */
const RUN_FROM = 2;
/** Ground speed nobody runs off: 15 km/h, by a skydiver's judgement. */
export const SLIDE_FROM = 15 / 3.6;

export interface Touchdown {
  /** Speed of the feet into the ground at contact, m/s: straight down on the flat, square to a slope. */
  sink: number;
  /** Speed of the feet along the ground at contact, m/s: over it on the flat, along a slope. */
  groundSpeed: number;
  /** Bank angle at contact, degrees. */
  bankDeg: number;
  rating: LandingRating;
}

/** The worse of two. */
export const worst = (a: LandingRating, b: LandingRating): LandingRating =>
  ORDER.indexOf(a) > ORDER.indexOf(b) ? a : b;

export function rateLanding(sink: number, groundSpeed: number, bankDeg: number): LandingRating {
  // Coming down at 2 m/s is stepping off a 20 cm kerb: nobody runs that off.
  // At 5 m/s it is a jump from 1.3 m, the arrival of a round canopy: taken
  // on bent legs when slow over the ground, but an injury with ground speed
  // on top, which is what an unflared landing has.
  const slow = groundSpeed < 6;
  const taken = slow ? 5.5 : 3.5;
  const survived = slow ? 7 : 5.5;
  const vertical: LandingRating =
    sink < 1.5 ? 'standUp' : sink < 2.5 ? 'firm' : sink < taken ? 'heavy' : sink < survived ? 'hard' : 'crash';
  // Ground speed is for the legs: walked off, run off, then slid off, which
  // is how the small canopies come in even when flared well.
  const horizontal: LandingRating =
    groundSpeed < RUN_FROM ? 'standUp' : groundSpeed < SLIDE_FROM ? 'run' : groundSpeed < 14 ? 'slide' : 'hard';
  const bank = Math.abs(bankDeg);
  const banked: LandingRating = bank < 20 ? 'standUp' : bank < 35 ? 'hard' : 'crash';
  return worst(worst(vertical, horizontal), banked);
}

const feet = vec3();
const feetVel = vec3();
const up = vec3();
const tel = emptyTelemetry();
const still = calmAir();

/**
 * Height of the pilot's feet above the ground, m, or above whatever they are
 * over: `groundAt` is told how high they are, for a bridge's deck.
 */
export function feetHeight(model: FlightModel, groundAt: (x: number, z: number, y?: number) => number): number {
  model.pilotPoint(feet, model.rig.feetPos);
  return feet.y - groundAt(feet.x, feet.z, feet.y);
}

/**
 * Returns the touchdown if the feet have reached the ground, otherwise null.
 * On a slope the feet are judged against it: flying down along a steep face
 * and brushing it is a touch, not coming down onto it from the height of the
 * fall.
 */
export function detectTouchdown(model: FlightModel, groundAt: GroundAt): Touchdown | null {
  if (feetHeight(model, groundAt) > 0) return null;
  model.pilotPointVelocity(feetVel, model.rig.feetPos);
  readTelemetry(model, still, tel);
  const { into, along } = againstGround(feetVel, groundNormal(up, groundAt, feet.x, feet.z, feet.y));
  const sink = Math.max(0, into);
  return { sink, groundSpeed: along, bankDeg: tel.bankDeg, rating: rateLanding(sink, along, tel.bankDeg) };
}
