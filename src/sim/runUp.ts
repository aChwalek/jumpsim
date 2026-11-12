// On top of a BASE object, before the exit: walking about, then the run-up
// to the edge. A running exit carries the jumper away from the wall, which
// is the whole point of it: a step off the edge falls straight down along it.
//
// Feet on the top, no physics beyond speeds that build up and come off at a
// runner's rate. Over the edge, or on the jump key, the jumper leaves with
// the speed they had.

import type { BodyInputs } from './freefall';
import { DEG, set, vec3 } from './vec';

/** Flat out with a rig on the back, m/s. */
export const RUN_SPEED = 7;
/** Backing up, or stepping sideways, m/s. */
const BACK_SPEED = 1.4;
const SIDE_SPEED = 1.4;
/** Building up speed, m/s²: flat out in about two seconds, seven metres. */
const ACCEL = 3.5;
/** Slowing down, m/s². */
const BRAKE = 6;
/** Turning on the spot, rad/s; slower the faster the run. */
const TURN_RATE = 2.2;
/** Up off the last step, m/s, and the extra push along the run. */
export const LEAP_UP = 2.8;
const LEAP_AHEAD = 0.8;
/** The top falls away this much under the feet: over the edge, m. */
const EDGE = 0.5;
/** Stepping up more than this is a wall, m. */
const STEP_UP = 0.4;

/** Moves `v` towards `to` at `rate` units a second. */
function approach(v: number, to: number, rate: number, dt: number): number {
  const d = to - v;
  const most = rate * dt;
  return Math.abs(d) <= most ? to : v + Math.sign(d) * most;
}

export class RunUp {
  /** Where the feet are, world frame, m. */
  x: number;
  z: number;
  y: number;
  /** Compass heading the jumper faces, degrees. */
  headingDeg: number;
  /** Speed along the heading and to the right of it, m/s. */
  forward = 0;
  side = 0;
  /** Velocity of the feet, world frame, m/s: the speed the jumper leaves with. */
  readonly vel = vec3();
  /** Swing of the legs forward, rad, and how far into the stride. */
  legL = 0;
  legR = 0;
  private stride = 0;

  constructor(
    private readonly solidAt: (x: number, z: number) => number,
    x: number,
    z: number,
    headingDeg: number,
  ) {
    this.x = x;
    this.z = z;
    this.y = solidAt(x, z);
    this.headingDeg = headingDeg;
  }

  /** Puts the feet down here again, standing still: after a hop that came back down on top. */
  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.y = this.solidAt(x, z);
    this.forward = this.side = 0;
    set(this.vel, 0, 0, 0);
  }

  /** Returns true once the feet have gone over the edge. */
  step(dt: number, input: BodyInputs): boolean {
    const f = Math.max(-1, Math.min(1, input.forward));
    const wanted = f >= 0 ? f * RUN_SPEED : f * BACK_SPEED;
    const faster = (to: number, v: number): boolean => Math.abs(to) > Math.abs(v) && to * v >= 0;
    this.forward = approach(this.forward, wanted, faster(wanted, this.forward) ? ACCEL : BRAKE, dt);
    const sideways = Math.max(-1, Math.min(1, input.slide)) * SIDE_SPEED;
    this.side = approach(this.side, sideways, faster(sideways, this.side) ? ACCEL : BRAKE, dt);
    const turn = (Math.max(-1, Math.min(1, input.turn)) * TURN_RATE) / (1 + Math.abs(this.forward) / 2.5);
    this.headingDeg = (((this.headingDeg + (turn * dt) / DEG) % 360) + 360) % 360;

    const h = this.headingDeg * DEG;
    const ax = Math.sin(h);
    const az = -Math.cos(h);
    set(this.vel, ax * this.forward - az * this.side, 0, az * this.forward + ax * this.side);
    const x = this.x + this.vel.x * dt;
    const z = this.z + this.vel.z * dt;
    const top = this.solidAt(x, z);
    if (top > this.y + STEP_UP) {
      // Into a wall: stopped dead.
      this.forward = this.side = 0;
      set(this.vel, 0, 0, 0);
    } else {
      this.x = x;
      this.z = z;
      if (top < this.y - EDGE) return true;
      this.y = top;
    }

    // Strides longer and quicker with the speed.
    const speed = Math.hypot(this.forward, this.side);
    const drive = Math.min(1, speed / RUN_SPEED);
    if (speed > 0.25) this.stride += Math.PI * Math.min(3.4, 1.6 + 0.3 * speed) * dt;
    const swing = (0.25 + 0.45 * drive) * Math.min(1, speed / 0.8) * Math.sin(this.stride);
    this.legL = swing;
    this.legR = -swing;
    return false;
  }

  /** Off the last step: up and on along the run. */
  leap(): void {
    const h = this.headingDeg * DEG;
    const push = this.forward > 0.5 ? LEAP_AHEAD : 0;
    this.vel.x += Math.sin(h) * push;
    this.vel.z -= Math.cos(h) * push;
    this.vel.y = LEAP_UP;
  }
}
