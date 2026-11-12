// A main canopy cut away: free of the pilot, with nothing to hold its lines
// tight, it stops flying at once. It sheds its shape and drifts down with the
// wind, the risers trailing under it, turning slowly, until it lies on the
// ground somewhere downwind of where it was let go.
//
// Only its fall matters here, and how it looks doing it: a point at the end
// of the risers with the drag of a crumpled canopy above it, and an attitude
// that wanders round upright.

import type { Environment } from './flightModel';
import { GRAVITY } from './rig';
import { clamp, quat, quatFromAxisAngle, quatMultiply, quatSlerp, rotate, set, vec3, type Quat, type Vec3 } from './vec';

/** Drag area of the canopy as it lets go of its shape, per m² of canopy: from flying to crumpled. */
const AREA_OPEN = 0.45;
const AREA_CRUMPLED = 0.1;
/** How fast it loses its shape, s. */
const CRUMPLE = 1.4;
/** How long the canopy takes to tip over once the risers are on the ground, s. */
const TIP_OVER = 1.6;

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export interface ReleasedStart {
  /** Where the risers end, world frame. */
  pos: Vec3;
  vel: Vec3;
  /** The canopy's attitude when let go. */
  att: Quat;
}

export class ReleasedCanopy {
  readonly pos = vec3();
  readonly vel = vec3();
  readonly att = quat();
  /** Seconds since the cutaway. */
  time = 0;
  /** Seconds since the risers touched the ground, or null while falling. */
  landedFor: number | null = null;

  private readonly start = quat();
  private readonly target = quat();
  private readonly lean = quat();
  private readonly fall = vec3();
  /** Level direction it fell over towards on the ground, world frame. */
  readonly fallTo = vec3(0, 0, 1);
  private readonly flat = quat();
  private readonly tmp = vec3();

  constructor(
    from: ReleasedStart,
    /** Canopy area, m², and the mass of fabric, lines and risers, kg. */
    private readonly area: number,
    private readonly mass: number,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    set(this.pos, from.pos.x, from.pos.y, from.pos.z);
    set(this.vel, from.vel.x, from.vel.y, from.vel.z);
    Object.assign(this.att, from.att);
    Object.assign(this.start, from.att);
  }

  /** How far the canopy has lost its shape, 0 flying to 1 crumpled. */
  get crumple(): number {
    return 1 - Math.exp(-this.time / CRUMPLE);
  }

  step(dt: number, env: Environment): void {
    this.time += dt;
    if (this.landedFor !== null) {
      this.landedFor += dt;
      // The canopy lies down over the riser ends, downwind.
      quatSlerp(this.att, this.start, this.flat, ease(this.landedFor / TIP_OVER));
      return;
    }
    const area = this.area * (AREA_CRUMPLED + (AREA_OPEN - AREA_CRUMPLED) * (1 - this.crumple));
    const ux = env.wind.x - this.vel.x;
    const uy = env.wind.y - this.vel.y;
    const uz = env.wind.z - this.vel.z;
    const k = (0.5 * env.airDensity * area * Math.hypot(ux, uy, uz)) / this.mass;
    this.vel.x += k * ux * dt;
    this.vel.y += (k * uy - GRAVITY) * dt;
    this.vel.z += k * uz * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // Turning slowly, and leaning one way then another round upright.
    const t = this.time;
    const up = set(this.tmp, 0.35 * Math.sin(0.9 * t + 0.4), 0, 0.3 * Math.cos(0.7 * t));
    const angle = Math.hypot(up.x, up.z);
    quatFromAxisAngle(this.lean, set(up, up.x / (angle || 1), 0, up.z / (angle || 1)), angle);
    quatFromAxisAngle(this.target, set(this.tmp, 0, 1, 0), 0.6 * t);
    quatMultiply(this.target, this.lean, this.target);
    quatSlerp(this.att, this.att, this.target, clamp(dt / 0.8, 0, 1));

    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      set(this.vel, 0, 0, 0);
      this.landedFor = 0;
      Object.assign(this.start, this.att);
      // Tipped a quarter turn over, about a level axis across the wind.
      const wind = Math.hypot(env.wind.x, env.wind.z);
      const ahead = rotate(this.tmp, this.att, set(this.tmp, 0, 0, -1));
      const to = wind > 0.5 ? set(this.fall, env.wind.x / wind, 0, env.wind.z / wind) : set(this.fall, ahead.x, 0, ahead.z);
      const n = Math.hypot(to.x, to.z) || 1;
      set(this.fallTo, to.x / n, 0, to.z / n);
      set(this.fall, to.z / n, 0, -to.x / n);
      quatFromAxisAngle(this.flat, this.fall, Math.PI / 2);
      quatMultiply(this.flat, this.flat, this.att);
    }
  }
}
