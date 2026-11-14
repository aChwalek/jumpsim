// On top of a BASE object, before the exit: walking about, then the run-up
// to the edge. A running exit carries the jumper away from the wall, which
// is the whole point of it: a step off the edge falls straight down along it.
// Off a bridge there is no wall to clear and no room to run: the jumper
// stands on the lip of the deck, outside the parapet, and jumps out.
//
// Feet on the top, no physics beyond speeds that build up and come off at a
// runner's rate. Over the edge, or on the jump key, the jumper leaves with
// the speed they had.

import type { BodyInputs } from './freefall';
import { DEG, set, vec3 } from './vec';

/** Flat out with a rig on the back, m/s. */
export const RUN_SPEED = 7;
/**
 * Running backwards, or sideways, m/s: slower than straight ahead, and
 * diagonally no faster than that either.
 */
const BACK_SPEED = 4;
const SIDE_SPEED = 5;
/** Building up speed, m/s²: flat out in about two seconds, seven metres. */
const ACCEL = 3.5;
/** Slowing down, m/s². */
const BRAKE = 6;
/** Turning on the spot, rad/s; slower the faster the run. */
const TURN_RATE = 2.2;
/** Up off the last step, m/s, and the extra push along the run. */
export const LEAP_UP = 2.8;
const LEAP_AHEAD = 0.8;
/** Out from a standing start, a push off the lip: m/s outwards and up. */
export const STAND_OUT = 2;
const STAND_UP = 1.8;
/** The top falls away this much under the feet: over the edge, m. */
const EDGE = 0.5;
/**
 * Or falls away steeper than this, drop over distance: nobody runs down a
 * slope of more than 60°. The edge of a cliff known every few metres is
 * never sheer.
 */
const TOO_STEEP = Math.tan(60 * DEG);
/** Stepping up more than this is a wall, m. */
const STEP_UP = 0.4;

/** Moves `v` towards `to` at `rate` units a second. */
function approach(v: number, to: number, rate: number, dt: number): number {
  const d = to - v;
  const most = rate * dt;
  return Math.abs(d) <= most ? to : v + Math.sign(d) * most;
}

/**
 * The legs of someone on foot, from how fast they go alone: strides longer and
 * quicker with the speed, none standing still. What we see of a run whose
 * keys are not ours, a bot's or another player's, as well as of our own.
 */
export class Stride {
  /** Swing of each leg forward, rad. */
  legL = 0;
  legR = 0;
  private phase = 0;

  /** On by `dt` at `speed` over the ground, m/s. */
  step(dt: number, speed: number): void {
    const drive = Math.min(1, speed / RUN_SPEED);
    if (speed > 0.25) this.phase += Math.PI * Math.min(3.4, 1.6 + 0.3 * speed) * dt;
    const swing = (0.25 + 0.45 * drive) * Math.min(1, speed / 0.8) * Math.sin(this.phase);
    this.legL = swing;
    this.legR = -swing;
  }
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
  /** The legs, swung by the speed. */
  private readonly stride = new Stride();
  /** Swing of each leg forward, rad. */
  get legL(): number {
    return this.stride.legL;
  }
  get legR(): number {
    return this.stride.legR;
  }

  /**
   * `y`: about where the feet are, which says what they stand on where a
   * bridge passes over the ground; the top of what is there if not given.
   * `standing`: on the lip of a bridge, where nobody walks: forward jumps out.
   */
  constructor(
    private readonly solidAt: (x: number, z: number, y?: number) => number,
    x: number,
    z: number,
    headingDeg: number,
    y?: number,
    readonly standing = false,
  ) {
    this.x = x;
    this.z = z;
    this.y = solidAt(x, z, y);
    this.headingDeg = headingDeg;
  }

  /** Puts the feet down here again, standing still: after a hop that came back down on top. */
  place(x: number, z: number, y?: number): void {
    this.x = x;
    this.z = z;
    this.y = this.solidAt(x, z, y);
    this.forward = this.side = 0;
    set(this.vel, 0, 0, 0);
  }

  /** Returns true once the feet have gone over the edge. */
  step(dt: number, input: BodyInputs): boolean {
    if (this.standing) {
      // Nothing but the jump out.
      if (input.forward < 0.5) return false;
      this.leap();
      return true;
    }
    const f = Math.max(-1, Math.min(1, input.forward));
    let wanted = f >= 0 ? f * RUN_SPEED : f * BACK_SPEED;
    let sideways = Math.max(-1, Math.min(1, input.slide)) * SIDE_SPEED;
    const all = Math.hypot(wanted, sideways);
    if (all > RUN_SPEED) {
      wanted *= RUN_SPEED / all;
      sideways *= RUN_SPEED / all;
    }
    const faster = (to: number, v: number): boolean => Math.abs(to) > Math.abs(v) && to * v >= 0;
    this.forward = approach(this.forward, wanted, faster(wanted, this.forward) ? ACCEL : BRAKE, dt);
    this.side = approach(this.side, sideways, faster(sideways, this.side) ? ACCEL : BRAKE, dt);
    const turn = (Math.max(-1, Math.min(1, input.turn)) * TURN_RATE) / (1 + Math.abs(this.forward) / 2.5);
    this.headingDeg = (((this.headingDeg + (turn * dt) / DEG) % 360) + 360) % 360;

    const h = this.headingDeg * DEG;
    const ax = Math.sin(h);
    const az = -Math.cos(h);
    set(this.vel, ax * this.forward - az * this.side, 0, az * this.forward + ax * this.side);
    const x = this.x + this.vel.x * dt;
    const z = this.z + this.vel.z * dt;
    const top = this.solidAt(x, z, this.y);
    if (top > this.y + STEP_UP) {
      // Into a wall: stopped dead.
      this.forward = this.side = 0;
      set(this.vel, 0, 0, 0);
    } else {
      const drop = this.y - top;
      const step = Math.hypot(x - this.x, z - this.z);
      this.x = x;
      this.z = z;
      if (drop > EDGE || (step > 0 && drop > step * TOO_STEEP)) return true;
      this.y = top;
    }

    this.stride.step(dt, Math.hypot(this.forward, this.side));
    return false;
  }

  /** Turned by the mouse, as in any first-person game: `rad` to the right, at once. */
  turnBy(rad: number): void {
    this.headingDeg = (((this.headingDeg + rad / DEG) % 360) + 360) % 360;
  }

  /** Off the last step: up and on along the run; or from a standing start, out and up off the lip. */
  leap(): void {
    const h = this.headingDeg * DEG;
    const push = this.standing ? STAND_OUT : this.forward > 0.5 ? LEAP_AHEAD : 0;
    this.vel.x += Math.sin(h) * push;
    this.vel.z -= Math.cos(h) * push;
    this.vel.y = this.standing ? STAND_UP : LEAP_UP;
  }
}
