// Sliding on the feet after a fast touchdown: the swoop goes on along the grass.
//
// Above what anyone runs off, the feet touch and slide on their soles while
// the canopy still flies and carries most of the pilot. Flight does not stop
// there: the flight model goes on, toggles and all, with the ground pushing
// up on the feet. The legs are a spring (the knees bending) and the shoes rub
// on the grass. The weight on the legs decides how it ends: as the canopy
// slows it carries less of the pilot and the legs more. Slow enough to run,
// the pilot runs it off; still fast with too much on the legs, they go down.

import type { FlightModel } from './flightModel';
import { SLIDE_FROM as RUN_OFF, type Touchdown } from './landing';
import { HIP_BACK, HIP_DROP, THIGH } from './rig';
import { clamp, rotate, rotateInv, set, vec3, type Vec3 } from './vec';

/** The knees bent this far carry the pilot's whole weight, m. */
const SAG = 0.15;
/** Of the critical damping: the knees soak up the touchdown without bouncing. */
const DAMPING = 0.7;
/** Shoe soles sliding on grass. */
const FRICTION = 0.35;
/** The feet planted ahead of the hips, rad from straight down, the legs not quite straight. */
const PLANT = 0.35;
const REACH = 0.97;
/** The legs feel the weight over this long, s. */
const FEEL = 0.15;
/**
 * Touching down faster than this, m/s, is a blow the knees do not take while
 * sliding: the pilot goes down whatever the canopy still holds.
 */
export const SKIM_SINK = 2.5;
/** The knees bent this far, m, the legs fold. */
const FOLD = 0.32;
/** The feet this high above the ground again, m, the pilot is flying. */
const UP = 0.3;
/** Banked this far, rad, with weight on the feet, they are swept from under the pilot. */
const SWEPT = 30 * (Math.PI / 180);

/** Above this ground speed the legs hold the least, m/s. */
const FAST = 9;
/** What they hold then, of the weight. */
const FAST_LOAD = 0.45;
/** What they hold at a run, where the pilot is on their feet anyway. */
const RUN_LOAD = 1;

/**
 * How much of the weight the legs hold, sliding on the soles at this ground
 * speed (m/s), before the pilot goes down. The faster, the less: the
 * shoes rub harder with more weight on them, and pull the feet from under the
 * pilot. Near a run the legs can take it all, and they start running.
 */
export function bearable(groundSpeed: number): number {
  const k = clamp((groundSpeed - RUN_OFF) / (FAST - RUN_OFF), 0, 1);
  return RUN_LOAD + (FAST_LOAD - RUN_LOAD) * k;
}

/** Banked this far at the touchdown, degrees, the feet do not slide: they trip. */
const LEVEL = 20;

/**
 * A touchdown that goes on as a slide on the feet instead of ending there:
 * too fast over the ground to run, but gently down and level.
 */
export const slidesOn = (t: Touchdown): boolean =>
  t.groundSpeed >= RUN_OFF && t.sink < SKIM_SINK && Math.abs(t.bankDeg) < LEVEL;

/** How a slide on the feet ends: run off, gone down, or flying again. */
export type SkimEnd = 'run' | 'fall' | 'up';

export interface LegAngles {
  /** Thighs forward from hanging straight, rad. */
  hip: number;
  /** Knees bent, rad. */
  knee: number;
}

const WORLD_UP = vec3(0, 1, 0);
const RIGHT = vec3(1, 0, 0);

export class Skim {
  /**
   * Weight on the legs, of the whole: what the canopy no longer holds up.
   * Not the push of the ground, which is that and the blow of the touchdown
   * on top: the blow is the knees' to soak up, and is judged on the sink.
   */
  load = 0;
  /** The most the legs have felt. */
  peak = 0;
  /** The ground's push on the feet right now, of the pilot's weight. */
  push = 0;
  /** How far the knees are bent by the load, m. */
  crouch = 0;
  /** Slid on the feet so far, m, and for how long, s. */
  distance = 0;
  seconds = 0;
  /** Speed of the feet over the ground, m/s. */
  speed = 0;
  /** Where the shoes touch, pilot frame: planted ahead, the knees soft. */
  readonly contact: Vec3;
  /** How it ended, once it has. */
  end: SkimEnd | null = null;

  private readonly hip: Vec3;
  private readonly leg: number;
  private readonly at = vec3();
  private readonly vel = vec3();
  private readonly tmp = vec3();
  private height = 0;

  constructor(
    private readonly model: FlightModel,
    private readonly groundAt: (x: number, z: number, y?: number) => number,
  ) {
    const rig = model.rig;
    this.hip = vec3(0, rig.pilotPos.y - HIP_DROP, HIP_BACK);
    this.leg = rig.pilotPos.y - rig.feetPos.y - HIP_DROP;
    const reach = REACH * this.leg;
    this.contact = vec3(0, this.hip.y - reach * Math.cos(PLANT), this.hip.z - reach * Math.sin(PLANT));
    this.measure();
  }

  /** Before a flight step: the ground's push on the feet goes into the model. */
  pushOn(): void {
    const m = this.model;
    const depth = this.measure();
    const v = this.vel;
    const weight = m.rig.pilot.weight;
    const k = weight / SAG;
    const c = 2 * DAMPING * Math.sqrt(k * m.rig.inertMass);
    // The ground pushes, it never pulls: legs coming up faster than the knees
    // straighten leave it.
    const up = depth > 0 ? Math.max(0, k * depth - c * v.y) : 0;
    const rub = (FRICTION * up) / Math.max(this.speed, 0.3);
    set(m.footForce, -rub * v.x, up, -rub * v.z);
    this.push = up / weight;
  }

  /** After the step: how the slide ends, or null while it goes on. */
  after(dt: number): SkimEnd | null {
    if (this.end) return this.end;
    const m = this.model;
    const weight = m.rig.canopy.weight + m.rig.pilot.weight;
    const held = this.push > 0 ? clamp(1 - m.aeroForce.y / weight, 0, 2) : 0;
    this.load += (held - this.load) * Math.min(1, dt / FEEL);
    this.peak = Math.max(this.peak, this.load);
    this.measure();
    this.seconds += dt;
    if (this.push > 0) this.distance += this.speed * dt;
    const bank = Math.abs(Math.asin(clamp(rotate(this.tmp, m.state.pilotAtt, RIGHT).y, -1, 1)));
    if (this.height > UP) this.end = 'up';
    else if (this.crouch > FOLD || this.load > bearable(this.speed) || (this.push > 0.1 && bank > SWEPT)) this.end = 'fall';
    else if (this.speed < RUN_OFF && this.push > 0) this.end = 'run';
    if (this.end) set(m.footForce, 0, 0, 0);
    return this.end;
  }

  /** The hips and knees that put the shoes on the ground with the knees bent by the load. */
  legs(out: LegAngles): LegAngles {
    // The knees give straight up, as the ground pushes.
    const lift = rotateInv(this.tmp, this.model.state.pilotAtt, WORLD_UP);
    const ty = this.contact.y + this.crouch * lift.y - this.hip.y;
    const tz = this.contact.z + this.crouch * lift.z - this.hip.z;
    const shin = this.leg - THIGH;
    const reach = clamp(Math.hypot(ty, tz), Math.abs(THIGH - shin) + 0.05, this.leg * 0.999);
    // Forward of straight down (forward is -z), then the thigh further out still, the knee ahead.
    const ahead = Math.atan2(-tz, -ty);
    const thigh = Math.acos(clamp((THIGH * THIGH + reach * reach - shin * shin) / (2 * THIGH * reach), -1, 1));
    const inside = Math.acos(clamp((THIGH * THIGH + shin * shin - reach * reach) / (2 * THIGH * shin), -1, 1));
    out.hip = ahead + thigh;
    out.knee = Math.PI - inside;
    return out;
  }

  /** Where the shoes are against the ground: the knees' bend, the speed. Returns how deep. */
  private measure(): number {
    const m = this.model;
    const at = m.pilotPoint(this.at, this.contact);
    const depth = this.groundAt(at.x, at.z, at.y) - at.y;
    m.pilotPointVelocity(this.vel, this.contact);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.crouch = Math.max(0, depth);
    this.height = -depth;
    return depth;
  }
}
