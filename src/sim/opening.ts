// From the pull to a flying canopy.
//
// The pilot chute goes out first and drags the bag off the back; the lines
// pay out until they are stretched, which pulls the pilot round from belly to
// earth to hanging feet first. Then the canopy fills, held back by the slider
// coming down the lines, which is what keeps the opening to a few g. Last, it
// starts to fly, on its stowed brakes.
//
// Inflation is beyond the panel model of the canopy (cells filling one by
// one, the slider, the fabric's own speed), so it is done here as a body
// whose drag area grows on a schedule: drag and gravity set the deceleration,
// the schedule is tuned so that it peaks at the few g of a sport main, and
// the last part blends into the steady flight the flight model takes over.

import type { Environment, FlightModel } from './flightModel';
import { type Freefall, noBodyInputs } from './freefall';
import { GRAVITY } from './rig';
import { initTrimmed, trimmedFlight, type Trimmed } from './telemetry';
import { DEG, quat, quatFromYaw, quatSlerp, set, vec3, type Quat, type Vec3 } from './vec';

export interface OpeningTiming {
  /** From the pull until the pilot chute is thrown into the air, s. */
  throwOut: number;
  /** From the pull until the lines are stretched, s. */
  lineStretch: number;
  /** For the pilot to swing from belly to earth to hanging, from line stretch, s. */
  swing: number;
  /** From line stretch until the canopy flies, s. */
  inflation: number;
}

/** A hand-deployed main: reach, throw, about two seconds to line stretch. */
export const MAIN_OPENING: OpeningTiming = { throwOut: 0.6, lineStretch: 1.9, swing: 0.8, inflation: 2.6 };
/**
 * A reserve, fired by the automatic activation device: a spring throws the
 * pilot chute at once, and reserves are built to open fast.
 */
export const RESERVE_OPENING: OpeningTiming = { throwOut: 0, lineStretch: 0.8, swing: 0.6, inflation: 1.6 };

/** Drag area of a pilot chute in tow, m²: a 36-inch one, partly in the wake of the back. */
const PILOT_CHUTE = 0.35;
/** Drag area added by the bag and the closed canopy at line stretch, m². */
const BAG = 0.3;
/** How sharply the drag area builds up once the slider starts to come down. */
const GROWTH = 2;
/** Fraction of the inflation after which the canopy starts flying forward. */
const SURGE = 0.45;
/** Rate at which the open canopy is drawn onto its steady glide, 1/s. */
const SETTLE = 4;
/**
 * Where the toggles are stowed when the canopy is packed: it opens with that
 * much brake, slow and on heading, until the pilot frees them.
 */
export const STOWED_BRAKE = 0.3;

export type OpeningStage = 'throw' | 'bag' | 'inflation' | 'open';

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Attitude whose Y axis is `up` and whose -Z axis is as near `ahead` as it can be. */
function attitudeFrom(out: Quat, up: Vec3, ahead: Vec3): Quat {
  // Back = -(ahead, made square to up).
  const d = ahead.x * up.x + ahead.y * up.y + ahead.z * up.z;
  let bx = -(ahead.x - d * up.x);
  let by = -(ahead.y - d * up.y);
  let bz = -(ahead.z - d * up.z);
  const n = Math.hypot(bx, by, bz) || 1;
  bx /= n;
  by /= n;
  bz /= n;
  // Right = up x back.
  const rx = up.y * bz - up.z * by;
  const ry = up.z * bx - up.x * bz;
  const rz = up.x * by - up.y * bx;
  // Rotation matrix with columns right, up, back, to a quaternion.
  const m00 = rx;
  const m11 = up.y;
  const m22 = bz;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.w = 0.25 / s;
    out.x = (up.z - by) * s;
    out.y = (bx - rz) * s;
    out.z = (ry - up.x) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.w = (up.z - by) / s;
    out.x = 0.25 * s;
    out.y = (up.x + ry) / s;
    out.z = (bx + rz) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.w = (bx - rz) / s;
    out.x = (up.x + ry) / s;
    out.y = 0.25 * s;
    out.z = (by + up.z) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.w = (ry - up.x) / s;
    out.x = (bx + rz) / s;
    out.y = (by + up.z) / s;
    out.z = 0.25 * s;
  }
  return out;
}

export class Opening {
  /** Seconds since the pull. */
  time = 0;
  stage: OpeningStage = 'throw';
  /** From 0 at line stretch to 1 once flying. */
  inflation = 0;
  /** How far the pilot has swung round to hanging under the canopy, 0 to 1. */
  hang = 0;
  /** Highest aerodynamic force over weight so far, g. */
  peakLoad = 0;
  /** Compass heading the canopy opens on, degrees. */
  headingDeg = 0;

  private readonly pilot0 = quat();
  private readonly canopy0 = quat();
  private readonly target: Trimmed = { vel: vec3(), att: quat(), pilotAtt: quat() };
  private readonly flow = vec3();
  private readonly ahead = vec3();
  private startArea = 0;

  /**
   * `offHeadingDeg`: canopies seldom open exactly where the pilot faced;
   * this is how far to the right of it this one goes.
   */
  constructor(
    private readonly body: Freefall,
    private readonly model: FlightModel,
    readonly timing: OpeningTiming,
    private readonly offHeadingDeg = 0,
  ) {}

  get done(): boolean {
    return this.stage === 'open';
  }

  step(dt: number, env: Environment): void {
    if (this.stage === 'open') return;
    const t = (this.time += dt);
    const timing = this.timing;
    const body = this.body;
    const s = this.model.state;

    if (t < timing.lineStretch) {
      // Still falling on the belly, with the pilot chute dragging behind once out.
      this.stage = t < timing.throwOut ? 'throw' : 'bag';
      const drogue = PILOT_CHUTE * ease((t - timing.throwOut) / 0.3);
      body.step(dt, noBodyInputs(), env, this.stage === 'bag' ? drogue : 0);
      this.peakLoad = Math.max(this.peakLoad, body.loadFactor);
      const b = body.state;
      set(s.pos, b.pos.x, b.pos.y, b.pos.z);
      set(s.vel, b.vel.x, b.vel.y, b.vel.z);
      Object.assign(s.pilotAtt, b.att);
      quatFromYaw(s.att, -body.headingDeg() * DEG);
      set(s.omega, 0, 0, 0);
      set(s.pilotOmega, 0, 0, 0);
      return;
    }

    if (this.stage !== 'inflation') this.lineStretch(env);
    const since = t - timing.lineStretch;
    const tau = Math.min(1, since / timing.inflation);
    const rig = this.model.rig;
    const mass = rig.gravMass;
    const target = trimmedFlight(rig, this.headingDeg, env, STOWED_BRAKE, this.target);

    // The force the canopy ends with carries the weight at its flying speed,
    // tilted forward off the airflow by its glide angle.
    const ax = target.vel.x - env.wind.x;
    const ay = target.vel.y - env.wind.y;
    const az = target.vel.z - env.wind.z;
    const openArea = (2 * mass * GRAVITY) / (env.airDensity * (ax * ax + ay * ay + az * az));
    const glide = Math.atan2(-ay, Math.hypot(ax, az));
    const area = this.startArea + (openArea - this.startArea) * tau ** GROWTH;
    // Through the air: flow is where the air goes past the pilot.
    const ux = env.wind.x - s.vel.x;
    const uy = env.wind.y - s.vel.y;
    const uz = env.wind.z - s.vel.z;
    const speed = Math.hypot(ux, uy, uz) || 1;
    // Lift is square to the flow, on the side of the heading: falling
    // straight down it pulls forward, which is the canopy's surge.
    const ahead = this.ahead;
    const along = -(ahead.x * ux + ahead.y * uy + ahead.z * uz) / speed;
    let lx = ahead.x + (along * ux) / speed;
    let ly = ahead.y + (along * uy) / speed;
    let lz = ahead.z + (along * uz) / speed;
    const ln = Math.hypot(lx, ly, lz) || 1;
    lx /= ln;
    ly /= ln;
    lz /= ln;
    // From pure drag at line stretch to the trim's lift over drag once flying.
    const turn = (Math.PI / 2 - glide) * ease((tau - SURGE) / (1 - SURGE));
    const q = 0.5 * env.airDensity * speed * speed * area;
    const drag = (q * Math.cos(turn)) / (mass * speed);
    const lift = (q * Math.sin(turn)) / mass;
    const fx = drag * ux + lift * lx;
    const fy = drag * uy + lift * ly;
    const fz = drag * uz + lift * lz;
    this.peakLoad = Math.max(this.peakLoad, Math.hypot(fx, fy, fz) / GRAVITY);
    s.vel.x += fx * dt;
    s.vel.y += (fy - GRAVITY) * dt;
    s.vel.z += fz * dt;
    // Once fully open it settles onto the steady glide by itself; a gentle
    // pull keeps the small difference between this and the flight model
    // from lasting.
    const blend = 1 - Math.exp(-SETTLE * ease((since / timing.inflation - 1) / 0.3) * dt);
    s.vel.x += (target.vel.x - s.vel.x) * blend;
    s.vel.y += (target.vel.y - s.vel.y) * blend;
    s.vel.z += (target.vel.z - s.vel.z) * blend;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    this.hang = ease(since / timing.swing);
    quatSlerp(s.pilotAtt, this.pilot0, target.pilotAtt, this.hang);
    quatSlerp(s.att, this.canopy0, target.att, ease(tau ** 0.7));
    this.inflation = tau;

    // The flight model takes over once flying steadily enough not to notice.
    const off = Math.hypot(s.vel.x - target.vel.x, s.vel.y - target.vel.y, s.vel.z - target.vel.z);
    if ((tau >= 1 && off < 0.5) || since > 2 * timing.inflation) {
      initTrimmed(this.model, s.pos, this.headingDeg, env, STOWED_BRAKE);
      this.stage = 'open';
      this.hang = 1;
    }
  }

  /** The lines come tight: the canopy is out of its bag, above the pilot along the airflow. */
  private lineStretch(env: Environment): void {
    const s = this.model.state;
    const b = this.body.state;
    this.stage = 'inflation';
    const heading = this.body.headingDeg() + this.offHeadingDeg;
    this.headingDeg = ((heading % 360) + 360) % 360;
    Object.assign(this.pilot0, b.att);
    const ux = env.wind.x - b.vel.x;
    const uy = env.wind.y - b.vel.y;
    const uz = env.wind.z - b.vel.z;
    const speed = Math.hypot(ux, uy, uz) || 1;
    set(this.flow, ux / speed, uy / speed, uz / speed);
    const h = this.headingDeg * DEG;
    set(this.ahead, Math.sin(h), 0, -Math.cos(h));
    attitudeFrom(this.canopy0, this.flow, this.ahead);
    this.startArea = this.body.params.bellyArea + PILOT_CHUTE + BAG;
    set(s.vel, b.vel.x, b.vel.y, b.vel.z);
  }
}
