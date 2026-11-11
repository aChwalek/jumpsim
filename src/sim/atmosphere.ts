// The standard atmosphere (ISA), troposphere only: density falls by a third
// between the ground and 4000 m. That is why freefall is faster up high and
// slows down on its own on the way down.

import { AIR_DENSITY_SEA_LEVEL } from './rig';

/** Temperature lapse rate over sea-level temperature, per metre. */
const LAPSE = 0.0065 / 288.15;
/** g M / (R L) - 1 for density, from the hydrostatic equation. */
const EXPONENT = 4.2559;

/** Air density at a height above sea level, kg/m³. */
export function airDensityAt(heightM: number): number {
  const h = Math.min(Math.max(heightM, -500), 11000);
  return AIR_DENSITY_SEA_LEVEL * (1 - LAPSE * h) ** EXPONENT;
}

/** True airspeed that gives the same dynamic pressure as an indicated airspeed. */
export function trueAirspeed(indicated: number, heightM: number): number {
  return indicated * Math.sqrt(AIR_DENSITY_SEA_LEVEL / airDensityAt(heightM));
}
