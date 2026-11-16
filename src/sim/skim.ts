// Sliding on the feet after a fast touchdown: the swoop goes on along the
// grass, across the pond, or down a slope of snow.
//
// Above what anyone runs off, the feet touch and slide on their soles while
// the canopy still flies and carries most of the pilot. Flight does not stop
// there: the flight model goes on, toggles and all, with the ground pushing
// on the feet, square to it on a slope. The legs are a spring (the knees
// bending) and the shoes rub along the ground. The weight on the legs decides
// how it ends: as the canopy slows it carries less of the pilot and the legs
// more. Slow enough to run, the pilot runs it off; still fast with too much on
// the legs, they go down. Taken back up off the ground, the canopy flies on:
// a touch and go.
//
// Water holds the feet up only as long as they plane over it, as a barefoot
// water-skier's do: fast enough, it takes some of the weight; slower, or with
// more weight on them, they go in.

import type { FlightModel } from './flightModel';
import { SLIDE_FROM as RUN_OFF, type Touchdown } from './landing';
import { HIP_BACK, HIP_DROP, THIGH } from './rig';
import { groundNormal, type GroundAt } from './slope';
import { clamp, dot, rotate, rotateInv, set, vec3, type Vec3 } from './vec';

/** The knees bent this far carry the pilot's whole weight, m. */
const SAG = 0.15;
/** Of the critical damping: the knees soak up the touchdown without bouncing. */
const DAMPING = 0.7;
/** Shoe soles sliding on grass. */
const FRICTION = 0.35;
/** Shoes planing over water: the spray and the wake, for the weight they hold. */
const WATER_DRAG = 0.5;
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

/** Under this speed over water, m/s, shoes do not plane at all: they go in. */
export const PLANE_FROM = 25 / 3.6;
/** At this speed over water, m/s, they hold the whole weight up, as a barefoot skier's do. */
const PLANE_FULL = 60 / 3.6;

/**
 * How much of the weight water holds up under feet planing over it at this
 * speed, m/s: as the square of the speed, as any lift does.
 */
export function planing(speed: number): number {
  return speed < PLANE_FROM ? 0 : Math.min(1, (speed / PLANE_FULL) ** 2);
}

/** Banked this far at the touchdown, degrees, the feet do not slide: they trip. */
const LEVEL = 20;

/**
 * A touchdown that goes on as a slide on the feet instead of ending there:
 * too fast over the ground to run, but gently down and level. On water
 * (`wet`), fast enough for the shoes to plane.
 */
export const slidesOn = (t: Touchdown, wet = false): boolean =>
  t.groundSpeed >= (wet ? PLANE_FROM : RUN_OFF) && t.sink < SKIM_SINK && Math.abs(t.bankDeg) < LEVEL;

/** How a slide on the feet ends: run off, gone down (into the water, on water), or flying again. */
export type SkimEnd = 'run' | 'fall' | 'up';

export interface LegAngles {
  /** Thighs forward from hanging straight, rad. */
  hip: number;
  /** Knees bent, rad. */
  knee: number;
}

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
  /** Speed of the feet along the ground, m/s. */
  speed = 0;
  /** The shoes are on water. */
  wet = false;
  /** The ground's up under the shoes. */
  readonly normal = vec3(0, 1, 0);
  /** Where the shoes touch, pilot frame: planted ahead, the knees soft. */
  readonly contact: Vec3;
  /** How it ended, once it has. */
  end: SkimEnd | null = null;

  private readonly hip: Vec3;
  private readonly leg: number;
  private readonly at = vec3();
  private readonly vel = vec3();
  /** The feet's velocity along the ground. */
  private readonly along = vec3();
  private readonly tmp = vec3();
  /** The feet's speed into the ground, m/s, negative coming off it. */
  private into = 0;
  private height = 0;

  constructor(
    private readonly model: FlightModel,
    private readonly groundAt: GroundAt,
    /** Whether there is water at (x, z). */
    private readonly wetAt: (x: number, z: number) => boolean = () => false,
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
    const weight = m.rig.pilot.weight;
    const k = weight / SAG;
    const c = 2 * DAMPING * Math.sqrt(k * m.rig.inertMass);
    // The ground pushes, square to it, and never pulls: legs coming off it
    // faster than the knees straighten leave it.
    const up = depth > 0 ? Math.max(0, k * depth + c * this.into) : 0;
    // The shoes rub back along it.
    const rub = ((this.wet ? WATER_DRAG : FRICTION) * up) / Math.max(this.speed, 0.3);
    const n = this.normal;
    const a = this.along;
    set(m.footForce, up * n.x - rub * a.x, up * n.y - rub * a.y, up * n.z - rub * a.z);
    this.push = up / weight;
  }

  /** After the step: how the slide ends, or null while it goes on. */
  after(dt: number): SkimEnd | null {
    if (this.end) return this.end;
    const m = this.model;
    const weight = m.rig.canopy.weight + m.rig.pilot.weight;
    // What pushes the pilot into the ground that the canopy does not hold
    // off: the weight, square to the slope, less the canopy's pull away from it.
    const held = this.push > 0 ? clamp((weight * this.normal.y - dot(m.aeroForce, this.normal)) / weight, 0, 2) : 0;
    this.load += (held - this.load) * Math.min(1, dt / FEEL);
    this.peak = Math.max(this.peak, this.load);
    this.measure();
    this.seconds += dt;
    if (this.push > 0) this.distance += this.speed * dt;
    const bank = Math.abs(Math.asin(clamp(rotate(this.tmp, m.state.pilotAtt, RIGHT).y, -1, 1)));
    // On water, the legs hold no more than the water does.
    const holds = this.wet ? Math.min(bearable(this.speed), planing(this.speed)) : bearable(this.speed);
    if (this.height > UP) this.end = 'up';
    else if (this.crouch > FOLD || (this.push > 0 && this.load > holds) || (this.push > 0.1 && bank > SWEPT)) this.end = 'fall';
    else if (this.speed < (this.wet ? PLANE_FROM : RUN_OFF) && this.push > 0) this.end = this.wet ? 'fall' : 'run';
    if (this.end) set(m.footForce, 0, 0, 0);
    return this.end;
  }

  /** The hips and knees that put the shoes on the ground with the knees bent by the load. */
  legs(out: LegAngles): LegAngles {
    // The knees give the way the ground pushes: square to it.
    const lift = rotateInv(this.tmp, this.model.state.pilotAtt, this.normal);
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

  /**
   * Where the shoes are against the ground: the knees' bend, the speed along
   * it, whether it is water. Returns how deep, square to the ground.
   */
  private measure(): number {
    const m = this.model;
    const at = m.pilotPoint(this.at, this.contact);
    const n = groundNormal(this.normal, this.groundAt, at.x, at.z, at.y);
    const depth = (this.groundAt(at.x, at.z, at.y) - at.y) * n.y;
    const v = m.pilotPointVelocity(this.vel, this.contact);
    const vn = dot(v, n);
    set(this.along, v.x - vn * n.x, v.y - vn * n.y, v.z - vn * n.z);
    this.into = -vn;
    this.speed = Math.hypot(this.along.x, this.along.y, this.along.z);
    this.crouch = Math.max(0, depth);
    this.height = -depth;
    this.wet = this.wetAt(at.x, at.z);
    return depth;
  }
}
