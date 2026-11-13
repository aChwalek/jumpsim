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
import { DEG, quat, quatFromYaw, quatMultiply, quatSlerp, set, vec3, type Quat, type Vec3 } from './vec';

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
/** A reserve pulled by hand: the time to peel the handle out, then the same spring. */
export const RESERVE_HANDLE_OPENING: OpeningTiming = { throwOut: 0.25, lineStretch: 1.05, swing: 0.6, inflation: 1.6 };
/**
 * A BASE canopy: the pilot chute held in the hand and thrown at once, a big
 * one; a canopy packed to open fast and the bag on a short bridle.
 */
export const BASE_OPENING: OpeningTiming = { throwOut: 0.3, lineStretch: 1.2, swing: 0.6, inflation: 1.7 };

/**
 * What can go wrong with a main as it comes out.
 *
 * A streamer ("torche"): the canopy leaves the bag but never fills, and
 * trails overhead flapping. It slows the fall to some 90 km/h, too slow for
 * the AAD and far too fast to land: the only way out is to cut it away and
 * pull the reserve.
 *
 * Line twists ("torsades"): the canopy opens, but its lines are wound round
 * each other over the risers. The pilot spins back round under it until they
 * are out, and cannot get at the toggles meanwhile.
 *
 * A lineover ("coiffante"): a line has gone over the top of the canopy and
 * pinches one half in. It opens into a spiral that the other toggle barely
 * holds, coming down far too fast: cut it away.
 *
 * A slider hang-up ("glisseur haut"): the slider stays up against the
 * canopy, which never spreads out underneath it. Pumping both toggles may
 * bring it down; if it does not, cut it away.
 *
 * No opening ("pas d'ouverture"), here a pilot chute in tow: it is out and
 * towing, but the bag stays shut in the container. The fall barely slows:
 * straight to the reserve.
 *
 * An off-heading opening: the canopy flies, but facing nearly the other way,
 * which off a BASE object is back towards the wall.
 */
export type Malfunction = 'streamer' | 'lineTwists' | 'lineover' | 'sliderHang' | 'noOpening' | 'offHeading';
/** What a main out of a skydiving container can do. */
export const MAIN_MALFUNCTIONS: readonly Malfunction[] = ['streamer', 'lineTwists', 'lineover', 'sliderHang', 'noOpening'];

/** How a malfunction goes this time. */
export interface MalfunctionDetail {
  /** Line twists: how far the lines are wound, rad, positive with the pilot turned to the right. */
  twist: number;
  /** A slider hang-up that no pumping brings down. */
  stuck: boolean;
}

/** How far a streamer gets, as a fraction of the inflation. */
const STREAMER_INFLATION = 0.16;
/** Drag area of a streamer, per m² of canopy. */
const STREAMER_AREA = 0.16;
/** A streamer turns slowly about the airflow, rad/s. */
const STREAMER_SPIN = 0.9;
/** How far a canopy held in by its slider gets, as a fraction of the inflation: the middle cells full, not the tips. */
const SLIDER_HANG_INFLATION = 0.3;
/** Drag area of a canopy held in by its slider, per m² of canopy. */
const SLIDER_HANG_AREA = 0.25;
/** Full pumps of both toggles that bring a hung slider down, when it will come. */
export const SLIDER_PUMPS = 2;
/** Both toggles count as down past this, and as back up below that, of their travel. */
const PUMP_DOWN = 0.75;
const PUMP_UP = 0.3;

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
  private readonly spin = quat();
  private startArea = 0;
  /** How long the canopy has had to fill since line stretch, s: no longer than its slider lets it. */
  private filled = 0;
  /** Line twists: how far the lines are wound, rad; and the pilot turned that far under the canopy, short of whole turns. */
  private readonly twist: number;
  private readonly twistTurn = quat();
  private readonly twisted = quat();
  /** A hung slider: brought down at last, or not; pumps of the toggles so far, and whether they are down now. */
  private sliderDown = false;
  pumps = 0;
  private pumpedDown = false;
  private readonly stuck: boolean;

  /**
   * `offHeadingDeg`: canopies seldom open exactly where the pilot faced;
   * this is how far to the right of it this one goes.
   */
  constructor(
    private readonly body: Freefall,
    private readonly model: FlightModel,
    readonly timing: OpeningTiming,
    private readonly offHeadingDeg = 0,
    /** Goes wrong this way, or opens. */
    readonly malfunction: Malfunction | null = null,
    detail: Partial<MalfunctionDetail> = {},
  ) {
    this.twist = malfunction === 'lineTwists' ? (detail.twist ?? 2 * 2 * Math.PI) : 0;
    this.stuck = detail.stuck ?? false;
    // Under whole turns of twists the pilot faces the canopy's way; the rest of a turn shows.
    const shown = this.twist - 2 * Math.PI * Math.round(this.twist / (2 * Math.PI));
    quatFromYaw(this.twistTurn, -shown);
  }

  get done(): boolean {
    return this.stage === 'open';
  }

  /** The slider is stuck up against the canopy, holding it in. */
  get hung(): boolean {
    return this.malfunction === 'sliderHang' && !this.sliderDown;
  }

  /** The pilot chute is out and towing, and the bag will never leave the container. */
  get towing(): boolean {
    return this.malfunction === 'noOpening';
  }

  /**
   * Both toggles, from 0 (hands up) to 1 (all the way down), every step:
   * pumped down and up again, they may bring a hung slider down the lines.
   */
  pump(both: number): void {
    if (!this.hung || this.stage !== 'inflation') return;
    if (!this.pumpedDown && both > PUMP_DOWN) this.pumpedDown = true;
    else if (this.pumpedDown && both < PUMP_UP) {
      this.pumpedDown = false;
      this.pumps++;
      if (!this.stuck && this.pumps >= SLIDER_PUMPS) this.sliderDown = true;
    }
  }

  step(dt: number, env: Environment): void {
    if (this.stage === 'open') return;
    const t = (this.time += dt);
    const timing = this.timing;
    const body = this.body;
    const s = this.model.state;

    if (t < timing.lineStretch || this.towing) {
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
    // A slider stuck up holds the canopy in: it fills no further until it comes down.
    this.filled = Math.min(this.filled + dt, this.hung ? SLIDER_HANG_INFLATION * timing.inflation : Infinity);
    const streamer = this.malfunction === 'streamer';
    const tau = Math.min(streamer ? STREAMER_INFLATION : 1, this.filled / timing.inflation);
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
    const fill = this.startArea + (openArea - this.startArea) * tau ** GROWTH;
    const area = streamer
      ? this.startArea + (STREAMER_AREA * rig.area - this.startArea) * ease(since / 1.2)
      : this.malfunction === 'sliderHang'
        ? // Held in, it drags like a canopy a quarter its size, until it fills past that once the slider is down.
          Math.max(fill, this.startArea + (SLIDER_HANG_AREA * rig.area - this.startArea) * ease(since / 1.2))
        : fill;
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
    const turn = streamer ? 0 : (Math.PI / 2 - glide) * ease((tau - SURGE) / (1 - SURGE));
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
    const blend = streamer ? 0 : 1 - Math.exp(-SETTLE * ease((this.filled / timing.inflation - 1) / 0.3) * dt);
    s.vel.x += (target.vel.x - s.vel.x) * blend;
    s.vel.y += (target.vel.y - s.vel.y) * blend;
    s.vel.z += (target.vel.z - s.vel.z) * blend;
    s.pos.x += s.vel.x * dt;
    s.pos.y += s.vel.y * dt;
    s.pos.z += s.vel.z * dt;

    this.hang = ease(since / timing.swing);
    // Twisted lines turn the pilot round as they come tight.
    const hanging = this.twist !== 0 ? quatMultiply(this.twisted, this.twistTurn, target.pilotAtt) : target.pilotAtt;
    quatSlerp(s.pilotAtt, this.pilot0, hanging, this.hang);
    quatSlerp(s.att, this.canopy0, target.att, ease(tau ** 0.7));
    this.inflation = tau;
    if (streamer) {
      // Canopy and pilot turn slowly together under the streamer.
      quatFromYaw(this.spin, -STREAMER_SPIN * since);
      quatMultiply(s.att, this.spin, s.att);
      quatMultiply(s.pilotAtt, this.spin, s.pilotAtt);
      return;
    }

    // The flight model takes over once flying steadily enough not to notice.
    const off = Math.hypot(s.vel.x - target.vel.x, s.vel.y - target.vel.y, s.vel.z - target.vel.z);
    if ((tau >= 1 && off < 0.5) || this.filled > 2 * timing.inflation) {
      initTrimmed(this.model, s.pos, this.headingDeg, env, STOWED_BRAKE);
      if (this.twist !== 0) {
        // Still wound up: the flight model turns the pilot back out of it.
        quatMultiply(s.pilotAtt, this.twistTurn, s.pilotAtt);
        s.twist = this.twist;
      }
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
    this.filled = 0;
    // For the lines as drawn: wound up from the start.
    s.twist = this.twist;
  }
}
