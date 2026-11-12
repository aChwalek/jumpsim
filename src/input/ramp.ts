// Turns on/off keys into progressive control travel: holding a key pulls the
// control down steadily, letting go lets it ride back up, and "hold" keeps it
// where it is so a brake setting can be kept without holding the key.

import { BRAKE_DEEP, type Controls } from '../sim/flightModel';

export interface Pulls {
  brakeL: boolean;
  brakeR: boolean;
  frontL: boolean;
  frontR: boolean;
  /** Keep released controls where they are instead of letting them up. */
  hold: boolean;
}

export const noPulls = (): Pulls => ({
  brakeL: false,
  brakeR: false,
  frontL: false,
  frontR: false,
  hold: false,
});

/** Travel per second, where 1 is the full range of the control. */
export interface RampRates {
  brakePull: number;
  brakeRelease: number;
  frontPull: number;
  frontRelease: number;
}

export const DEFAULT_RATES: RampRates = {
  brakePull: 1,
  brakeRelease: 2,
  frontPull: 1.6,
  frontRelease: 3,
};

function ramp(value: number, pulled: boolean, hold: boolean, pull: number, release: number, dt: number): number {
  if (pulled) return Math.min(1, value + pull * dt);
  if (hold) return value;
  return Math.max(0, value - release * dt);
}

export function rampControls(c: Controls, pulls: Pulls, dt: number, rates: RampRates = DEFAULT_RATES): void {
  c.brakeL = ramp(c.brakeL, pulls.brakeL, pulls.hold, rates.brakePull, rates.brakeRelease, dt);
  c.brakeR = ramp(c.brakeR, pulls.brakeR, pulls.hold, rates.brakePull, rates.brakeRelease, dt);
  c.frontL = ramp(c.frontL, pulls.frontL, pulls.hold, rates.frontPull, rates.frontRelease, dt);
  c.frontR = ramp(c.frontR, pulls.frontR, pulls.hold, rates.frontPull, rates.frontRelease, dt);
}

/** Seconds each toggle has been kept at full travel, which is where wraps start. */
export interface Wraps {
  brakeL: number;
  brakeR: number;
}

export const noWraps = (): Wraps => ({ brakeL: 0, brakeR: 0 });

/** Seconds at full travel, arms straight, before the toggle goes on into wraps. */
export const WRAP_STOP = 1;
/** Travel per second past full once taking wraps. */
export const WRAP_RATE = 0.15;

/**
 * Travel past full brakes for one toggle. Kept pulled at full, after a stop it
 * goes on slowly into wraps, up to BRAKE_DEEP; hold keeps the wraps, letting
 * go of the toggle drops them. The caller counts a toggle at full only while
 * the other one is too: wraps are for stalling, not for turning.
 */
export function wrapTravel(w: Wraps, side: keyof Wraps, atFull: boolean, hold: boolean, dt: number): number {
  if (atFull) w[side] += dt;
  else if (!hold) w[side] = 0;
  return Math.min(Math.max(0, (w[side] - WRAP_STOP) * WRAP_RATE), BRAKE_DEEP - 1);
}
