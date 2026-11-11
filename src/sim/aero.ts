import type { AeroParams } from './rig';

export interface SectionCoeffs {
  cl: number;
  cd: number;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Lift and drag coefficients of a canopy section.
 *
 * Below the stall the section behaves like a flapped wing: lift is linear in
 * angle of attack, brakes add some lift and a lot of drag. Past the stall
 * (either sign) it blends smoothly into a separated-flow model.
 */
export function sectionCoeffs(
  alpha: number,
  brake: number,
  p: AeroParams,
  out: SectionCoeffs,
): SectionCoeffs {
  const clLinear = p.clAlpha * (alpha - p.alpha0) + p.clBrake * brake;
  const cdProfile = p.cd0 + p.cdBrake * brake;
  const cdLinear = cdProfile + p.kInduced * clLinear * clLinear;

  const sin = Math.sin(alpha);
  const cos = Math.cos(alpha);
  // Low aspect ratio wings stall gently: lift sags to a plateau instead of
  // collapsing, while drag keeps climbing.
  const sin2 = 2 * sin * cos;
  const clPlate = Math.sign(sin2) * Math.sqrt(Math.abs(sin2)) * p.clPlateau;
  const cdPlate = cdProfile + p.cdPlate * sin * sin;

  const stallAngle = p.alphaStall0 - p.alphaStallBrake * brake;
  const stalled =
    sigmoid((alpha - stallAngle) / p.stallWidth) +
    sigmoid((p.alphaStallNeg - alpha) / p.stallWidth);
  const s = stalled > 1 ? 1 : stalled;

  out.cl = (1 - s) * clLinear + s * clPlate;
  out.cd = (1 - s) * cdLinear + s * cdPlate;
  return out;
}
