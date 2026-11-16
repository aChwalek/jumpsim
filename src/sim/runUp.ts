// On top of a BASE object, before the exit: walking about, then the run-up
// to the edge. A running exit carries the jumper away from the wall, which
// is the whole point of it: a step off the edge falls straight down along it.
// Off a bridge there is no wall to clear and no room to run: the jumper
// stands on the lip of the deck, outside the parapet, and jumps out. Holding
// the rail, they can shuffle along the lip to another spot, and turn round
// to go off backwards, facing the deck.
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
/**
 * On the lip, side on along the edge, a hand on the rail: a shuffle, m/s.
 * Picking up that pace and losing it, m/s².
 */
const SHUFFLE_SPEED = 1;
const SHUFFLE_ACCEL = 3;
/**
 * On the lip, the keys asking at least this much of a way out over the edge,
 * and more than of a way along it, step off: a stick held a little off the
 * side does not.
 */
const STEP_OFF = 0.5;
/** Less than this of the keys along the lip, as when facing a little off the parapet, shuffles nowhere. */
const SHUFFLE_FROM = 0.15;

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

/**
 * The lip of a bridge's deck, outside the parapet: a strip a hand's width
 * wider than the feet, the parapet on one side, the void on the other.
 */
export interface Lip {
  /**
   * The point `d` m along the lip from where the jumper started, to the
   * right facing out; and the heading out over the edge there, degrees.
   */
  at(d: number): { x: number; z: number; outDeg: number };
  /** How far along the lip a point is, m. */
  along(x: number, z: number): number;
  /** As far as it goes each way, m. */
  min: number;
  max: number;
}

/** A straight lip through a point, square to the heading out: as far as the feet find it. */
export function straightLip(x: number, z: number, outDeg: number): Lip {
  const o = outDeg * DEG;
  // To the right facing out.
  const rx = Math.cos(o);
  const rz = Math.sin(o);
  return {
    at: (d) => ({ x: x + rx * d, z: z + rz * d, outDeg }),
    along: (px, pz) => (px - x) * rx + (pz - z) * rz,
    min: -Infinity,
    max: Infinity,
  };
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360;

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
  /** On a lip: how far along it from the start, m, and how fast, m/s, to the right facing out. */
  along = 0;
  shuffle = 0;
  /** On a lip: the heading out over the edge where the feet are, degrees. */
  outDeg: number;
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
   * `lip`: on the lip of a bridge, where nobody runs: the jumper shuffles
   * along it, turns round, and a step out over the edge, whichever way they
   * face, jumps out.
   */
  constructor(
    private readonly solidAt: (x: number, z: number, y?: number) => number,
    x: number,
    z: number,
    headingDeg: number,
    y?: number,
    readonly lip: Lip | null = null,
  ) {
    this.x = x;
    this.z = z;
    this.y = solidAt(x, z, y);
    this.headingDeg = headingDeg;
    this.outDeg = lip ? lip.at(0).outDeg : headingDeg;
  }

  /** On the lip of a bridge, rather than on a run. */
  get standing(): boolean {
    return this.lip !== null;
  }

  /** On a lip, the void ahead rather than behind: facing out. */
  get facingOut(): boolean {
    return Math.cos((this.headingDeg - this.outDeg) * DEG) >= 0;
  }

  /** Puts the feet down here again, standing still: after a hop that came back down on top. */
  place(x: number, z: number, y?: number): void {
    this.x = x;
    this.z = z;
    this.y = this.solidAt(x, z, y);
    this.forward = this.side = this.shuffle = 0;
    if (this.lip) {
      this.along = this.lip.along(x, z);
      this.outDeg = this.lip.at(this.along).outDeg;
    }
    set(this.vel, 0, 0, 0);
  }

  /** Returns true once the feet have gone over the edge. */
  step(dt: number, input: BodyInputs): boolean {
    if (this.lip) return this.stepOnLip(dt, input, this.lip);
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

  /**
   * On the lip: turning on the spot, shuffling along it, or a step out over
   * the edge, which jumps. A step the other way meets the parapet.
   */
  private stepOnLip(dt: number, input: BodyInputs, lip: Lip): boolean {
    this.headingDeg = wrapDeg(this.headingDeg + (clamp1(input.turn) * TURN_RATE * dt) / DEG);
    // Where the keys ask to go, in the world, then out over the edge and along it.
    const h = this.headingDeg * DEG;
    const o = this.outDeg * DEG;
    const f = clamp1(input.forward);
    const r = clamp1(input.slide);
    const wx = Math.sin(h) * f + Math.cos(h) * r;
    const wz = -Math.cos(h) * f + Math.sin(h) * r;
    const out = wx * Math.sin(o) - wz * Math.cos(o);
    const along = wx * Math.cos(o) + wz * Math.sin(o);
    if (out >= STEP_OFF && out > Math.abs(along)) {
      this.leap();
      return true;
    }
    const wanted = Math.abs(along) < SHUFFLE_FROM ? 0 : clamp1(along) * SHUFFLE_SPEED;
    const faster = Math.abs(wanted) > Math.abs(this.shuffle) && wanted * this.shuffle >= 0;
    this.shuffle = approach(this.shuffle, wanted, faster ? SHUFFLE_ACCEL : BRAKE, dt);
    if (this.shuffle !== 0) {
      const d = Math.max(lip.min, Math.min(lip.max, this.along + this.shuffle * dt));
      const p = lip.at(d);
      const top = this.solidAt(p.x, p.z, this.y);
      // The end of the lip, something in the way, or the deck gone from under the feet: no further.
      if (d === this.along || top > this.y + STEP_UP || top < this.y - EDGE) this.shuffle = 0;
      else {
        this.x = p.x;
        this.z = p.z;
        this.y = top;
        this.along = d;
        // Round a bend, the jumper turns with the deck.
        this.headingDeg = wrapDeg(this.headingDeg + p.outDeg - this.outDeg);
        this.outDeg = p.outDeg;
      }
    }
    const o2 = this.outDeg * DEG;
    set(this.vel, Math.cos(o2) * this.shuffle, 0, Math.sin(o2) * this.shuffle);
    this.stride.step(dt, Math.abs(this.shuffle));
    return false;
  }

  /** Turned by the mouse, as in any first-person game: `rad` to the right, at once. */
  turnBy(rad: number): void {
    this.headingDeg = (((this.headingDeg + rad / DEG) % 360) + 360) % 360;
  }

  /**
   * Off the last step: up and on along the run; or from a standing start, out
   * and up off the lip, away from the deck whichever way the jumper faces.
   */
  leap(): void {
    const h = (this.lip ? this.outDeg : this.headingDeg) * DEG;
    const push = this.lip ? STAND_OUT : this.forward > 0.5 ? LEAP_AHEAD : 0;
    this.vel.x += Math.sin(h) * push;
    this.vel.z -= Math.cos(h) * push;
    this.vel.y = this.lip ? STAND_UP : LEAP_UP;
  }
}
