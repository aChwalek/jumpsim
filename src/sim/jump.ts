// A whole jump from the plane: in the door, freefall, the opening, then the
// canopy, whose flight the flight model takes over. Or a BASE jump, from the
// top of an object: the run-up, a short delay, the pull. On a BASE container
// there is one canopy and nothing else: no reserve, no AAD, no cutaway.
//
// Until the canopy flies, this drives the flight model's state by hand (as
// the arrival does on the ground), so the camera, the rig and the HUD follow
// without knowing where the pilot is in the jump.

import type { Controls, Environment, FlightModel } from './flightModel';
import { Freefall, freefallParams, type BodyInputs, type BodyPosition } from './freefall';
import { BASE_OPENING, MAIN_OPENING, Opening, RESERVE_HANDLE_OPENING, RESERVE_OPENING, STOWED_BRAKE, type Malfunction } from './opening';
import { Plane, type JumpRun } from './plane';
import { ReleasedCanopy } from './released';
import type { RigParams } from './rig';
import { RunUp } from './runUp';
import { DEG, quatFromYaw, rotate, set, vec3 } from './vec';

/** `standing`: on top of a BASE object, before the exit. */
export type JumpPhase = 'standing' | 'plane' | 'freefall' | 'opening' | 'canopy';
/** The canopy out, or coming out. */
export type CanopyId = 'main' | 'reserve';
/** What pulled the reserve: the pilot's hand, the static line from the main risers, or the AAD. */
export type ReserveBy = 'hand' | 'rsl' | 'aad';

/** Where a BASE jump starts: standing on top of an object, facing the edge some way ahead. */
export interface Ledge {
  kind: 'ledge';
  x: number;
  z: number;
  /** Compass heading towards the edge, degrees. */
  headingDeg: number;
  /**
   * How high the exit is, m, where the ground under the edge does not say:
   * down to the landing area from a cliff, whose foot is a slope.
   */
  height?: number;
}

const isLedge = (from: JumpRun | Ledge): from is Ledge => (from as Ledge).kind === 'ledge';

/**
 * The container on the back: a skydiving one (a main, a reserve, an AAD) or
 * a BASE one (one canopy packed to open fast, a big pilot chute in the hand).
 */
export type Container = 'sport' | 'base';

export interface JumpOptions {
  /**
   * What the jumper can stand on or run into: the ground, and the roofs and
   * walls of what stands on it. The ground alone if not given.
   */
  solidAt?: (x: number, z: number) => number;
  /** A skydiving container if not given. */
  container?: Container;
  /** The reserve, flown once out. Without it the reserve flies as the main does. */
  reserve?: RigParams;
  /** A reserve static line: cutting the main away pulls the reserve. */
  rsl?: boolean;
  /** What goes wrong with the main as it opens, if anything. */
  malfunction?: Malfunction | null;
}

/**
 * The automatic activation device fires the reserve below this height when
 * still falling fast (a Cypres in its expert mode).
 */
export const AAD_HEIGHT = 225;
export const AAD_SPEED = 35;
/** The pull is not taken in the first moments out of the door: no pilot chute over the tail. */
const CLEAR_OF_THE_PLANE = 1.5;
/** How hard the jumper pushes off out of the door, m/s. */
const PUSH_OFF = 1.5;
/** How far off the pilot's heading a canopy may open, degrees either way. */
const OFF_HEADING = 25;
/** How far past its stow a toggle has to come to free it. */
const UNSTOW = 0.08;
/** Near enough belly to earth to pull, rad. */
const FLAT_ENOUGH = 25 * DEG;
/** From the cutaway until the static line has the reserve pin out, s. */
const RSL_DELAY = 0.2;
/** Time to fall away from hanging under a canopy to flat on the air, for the eyes, s. */
const FALL_AWAY = 0.8;
/** Off a BASE object the pilot chute is in the hand: it can go almost at once, s. */
const BASE_PULL_FROM = 0.3;
/** How far off the pilot's heading a BASE canopy may open, degrees either way. */
const BASE_OFF_HEADING = 30;
/** Feet that come in this far below a top have hit its side, m. */
const SIDE_HIT = 0.5;
/** Coming back down on top slower than this is a hop, not a fall, m/s. */
const HOP_SINK = 6;

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export interface JumpLog {
  /** Above the ground, m. */
  exitHeight: number;
  /** Where the pilot pulled, or null if the AAD did. */
  pullHeight: number | null;
  /** Where the canopy was flying, m. */
  openHeight: number;
  /** From the door to the pull, s. */
  freefallSeconds: number;
  /** Fastest fall, m/s. */
  topSpeed: number;
  /** Highest load of the opening, g. */
  openingLoad: number;
  aad: boolean;
  /** Where the main was cut away, m, or null if it was not. */
  cutawayHeight: number | null;
  /** Where the reserve was pulled, m, and what pulled it; null if it stayed in. */
  reserveHeight: number | null;
  reserveBy: ReserveBy | null;
  /** The main that came out went wrong this way. */
  malfunction: Malfunction | null;
}

export class Jump {
  phase: JumpPhase;
  /** The plane, on a jump from one. */
  readonly plane: Plane | null;
  /** On a BASE jump, the jumper on top of the object until the exit. */
  readonly runUp: RunUp | null;
  /** A BASE jump, off an object: the AAD is off, as for any BASE jump. */
  readonly base: boolean;
  /** The ledge's own height, when it has one. */
  private readonly exitHeight: number | undefined;
  /** One canopy and nothing else: a BASE container. */
  readonly single: boolean;
  readonly body: Freefall;
  opening: Opening | null = null;
  /** Seconds since leaving the door. */
  time = 0;
  /** The toggles are still stowed, each side. */
  stowedL = true;
  stowedR = true;
  /** Hit the ground before the canopy flew. */
  impact = false;
  /** And it was the side of the object, not the ground under the feet. */
  struck = false;
  readonly log: JumpLog;
  /** When the canopy started flying, s after the exit. */
  private openedAt = 0;
  /** Asked to pull out of another position: back to belly to earth first. */
  pullWhenFlat = false;
  /** The canopy out or coming out: the main, then after a cutaway or the AAD, the reserve. */
  canopy: CanopyId = 'main';
  /** When the main was cut away, s after the exit, or null. */
  cutawayAt: number | null = null;
  /** The main once cut away, drifting down on its own. */
  released: ReleasedCanopy | null = null;
  /** When the static line pulls the reserve, s after the exit. */
  private rslAt: number | null = null;

  private readonly tmp = vec3();
  private readonly eye = vec3();
  /** Where the pilot was before the last step. */
  private readonly prev = vec3();
  private readonly solidAt: (x: number, z: number) => number;

  /**
   * `groundAt`: the ground, which the heights are taken from (a BASE object's
   * is its height above its foot).
   */
  constructor(
    private readonly model: FlightModel,
    from: JumpRun | Ledge,
    env: Environment,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly random: () => number = Math.random,
    private readonly options: JumpOptions = {},
  ) {
    this.solidAt = options.solidAt ?? groundAt;
    this.body = new Freefall(freefallParams(model.rig.gravMass));
    this.base = isLedge(from);
    this.exitHeight = isLedge(from) ? from.height : undefined;
    this.single = options.container === 'base';
    if (isLedge(from)) {
      this.phase = 'standing';
      this.plane = null;
      this.runUp = new RunUp(this.solidAt, from.x, from.z, from.headingDeg);
    } else {
      this.phase = 'plane';
      this.plane = new Plane(from, env.wind, groundAt(from.x, from.z));
      this.runUp = null;
    }
    this.log = {
      exitHeight: isLedge(from) ? (from.height ?? this.solidAt(from.x, from.z) - groundAt(from.x, from.z)) : from.height,
      pullHeight: null,
      openHeight: 0,
      freefallSeconds: 0,
      topSpeed: 0,
      openingLoad: 0,
      aad: false,
      cutawayHeight: null,
      reserveHeight: null,
      reserveBy: null,
      malfunction: null,
    };
    if (this.runUp) this.stand();
    else this.ride();
  }

  /**
   * Space bar: out of the door, then the pull. Nobody pulls head down or on
   * the back: out of any other position the pilot comes back to belly to
   * earth first, and pulls once there.
   */
  act(): void {
    if (this.phase === 'plane') this.exit();
    else if (this.phase === 'standing') {
      this.runUp!.leap();
      this.exit();
    } else if (this.phase === 'freefall' && this.cutawayAt !== null) {
      // The reserve handle, right after the cutaway, whatever the position.
      this.pull(false);
    } else if (this.phase === 'freefall' && this.time > (this.base ? BASE_PULL_FROM : CLEAR_OF_THE_PLANE)) {
      this.body.tracking = false;
      if (this.body.position === 'belly' && this.body.offPosition() < FLAT_ENOUGH) this.pull(false);
      else {
        this.body.setPosition('belly');
        this.pullWhenFlat = true;
      }
    }
  }

  /**
   * Into another position in freefall, or out of the door in it. `roll`: which
   * way a half turn goes (-1 to the left or backwards, 1 to the right or forwards).
   */
  fly(position: BodyPosition, roll = 1): void {
    if (this.pullWhenFlat) return;
    if (this.phase === 'plane' || this.phase === 'standing' || this.phase === 'freefall') this.body.setPosition(position, roll);
  }

  /**
   * Stretched out into a track, an angle upright, or out of it: asked every
   * step. Only in freefall, and not on the way to the pull.
   */
  trackIt(on: boolean): void {
    this.body.tracking = on && this.phase === 'freefall' && !this.pullWhenFlat;
  }

  /**
   * ← / → (`dir` -1 / 1). In the door: belly or back exit. In freefall: a half
   * roll flat (twice is a barrel roll), a half turn upright.
   */
  roll(dir: -1 | 1): void {
    if (this.pullWhenFlat) return;
    if (this.phase === 'plane' || this.phase === 'standing') this.body.setPosition(dir < 0 ? 'belly' : 'back');
    else if (this.phase === 'freefall') this.body.rollOver(dir);
  }

  /** Feet above the ground, m. */
  height(): number {
    const m = this.model;
    m.pilotPoint(this.tmp, m.rig.feetPos);
    return this.tmp.y - this.groundAt(this.tmp.x, this.tmp.z);
  }

  /** Feet above whatever is under them, the ground or a roof, m. */
  clearance(): number {
    const m = this.model;
    m.pilotPoint(this.tmp, m.rig.feetPos);
    return this.tmp.y - this.solidAt(this.tmp.x, this.tmp.z);
  }

  /** Compass heading the jumper faces, degrees. */
  headingDeg(): number {
    if (this.runUp && this.phase === 'standing') return this.runUp.headingDeg;
    return this.body.headingDeg();
  }

  /**
   * The cutaway handle: the main and its risers go, and the pilot falls
   * free again, to pull the reserve (or have the static line pull it).
   * Only once the main is out of its bag.
   */
  cutaway(): void {
    if (this.single) return;
    const o = this.opening;
    const out = this.phase === 'canopy' || (this.phase === 'opening' && o !== null && o.stage === 'inflation');
    if (this.canopy !== 'main' || !out || this.impact) return;
    const s = this.model.state;
    const rig = this.model.rig;
    this.released = new ReleasedCanopy(
      { pos: s.pos, vel: s.vel, att: s.att },
      rig.area,
      rig.canopy.weight / 9.80665 + 1.2,
      this.groundAt,
    );
    this.cutawayAt = this.time;
    this.log.cutawayHeight = this.height();
    // Falling free from hanging upright: the body goes back to the arch.
    const b = this.body.state;
    set(b.pos, s.pos.x, s.pos.y, s.pos.z);
    set(b.vel, s.vel.x, s.vel.y, s.vel.z);
    Object.assign(b.att, s.pilotAtt);
    b.yawRate = 0;
    this.body.setPosition('belly');
    this.pullWhenFlat = false;
    this.opening = null;
    this.phase = 'freefall';
    if (this.options.rsl) this.rslAt = this.time + RSL_DELAY;
  }

  /** Advances whatever is under way before the canopy flies. */
  step(dt: number, input: BodyInputs, env: Environment): void {
    this.plane?.step(dt);
    if (this.phase === 'plane') {
      this.ride();
      return;
    }
    if (this.phase === 'standing') {
      if (this.runUp!.step(dt, input)) this.exit();
      else this.stand();
      return;
    }
    this.released?.step(dt, env);
    if (this.impact) return;
    this.time += dt;
    if (this.phase === 'canopy') return;
    const s = this.model.state;
    set(this.prev, s.pos.x, s.pos.y, s.pos.z);
    if (this.phase === 'freefall') {
      this.body.step(dt, input, env);
      this.follow();
      const b = this.body.state;
      this.log.topSpeed = Math.max(this.log.topSpeed, -b.vel.y);
      if (!this.base && !this.single && this.height() < AAD_HEIGHT && -b.vel.y > AAD_SPEED) this.pull(true);
      else if (this.rslAt !== null && this.time >= this.rslAt) this.pull(false, 'rsl');
      else if (this.pullWhenFlat && this.body.offPosition() < FLAT_ENOUGH) this.pull(false);
    } else if (this.opening) {
      this.opening.step(dt, env);
      if (this.opening.done) {
        this.phase = 'canopy';
        this.openedAt = this.time;
        this.log.openHeight = this.height();
        this.log.openingLoad = this.opening.peakLoad;
      }
    }
    if (this.phase !== 'canopy' && this.clearance() <= 0) this.touch();
  }

  /** The feet have met something solid before the canopy flew. */
  private touch(): void {
    const s = this.model.state;
    const feet = this.model.pilotPoint(this.tmp, this.model.rig.feetPos);
    const top = this.solidAt(feet.x, feet.z);
    // Where the feet were a step ago, height for height: well under this top, they came in through its side.
    if (top - (feet.y - (s.pos.y - this.prev.y)) > SIDE_HIT) {
      this.struck = true;
      this.impact = true;
      // Against the wall, not in it.
      s.pos.x = this.prev.x;
      s.pos.z = this.prev.z;
      return;
    }
    if (this.runUp && this.phase === 'freefall' && -s.vel.y < HOP_SINK) {
      // A hop that came back down on top: on the feet again.
      this.runUp.place(feet.x, feet.z);
      this.body.setPosition('belly');
      this.pullWhenFlat = false;
      this.phase = 'standing';
      this.time = 0;
      this.stand();
      return;
    }
    this.impact = true;
  }

  /**
   * The canopy sees its stowed brakes whatever the hands do, until a toggle
   * is pulled past its stow: from then on that side is the hand's.
   */
  holdStows(c: Controls): void {
    if (this.stowedL) {
      if (c.brakeL > STOWED_BRAKE + UNSTOW) this.stowedL = false;
      else c.brakeL = STOWED_BRAKE;
    }
    if (this.stowedR) {
      if (c.brakeR > STOWED_BRAKE + UNSTOW) this.stowedR = false;
      else c.brakeR = STOWED_BRAKE;
    }
  }

  /** How far the pilot has swung from flat on the air to hanging under the canopy, 0 to 1. */
  get hang(): number {
    if (this.phase === 'canopy') return 1;
    if (this.phase === 'opening' && this.opening) return this.opening.hang;
    // Just cut away: the eyes leave the hanging view over a moment.
    if (this.phase === 'freefall' && this.cutawayAt !== null) return 1 - ease((this.time - this.cutawayAt) / FALL_AWAY);
    return 0;
  }

  /**
   * Looking up at the canopy as it opens, as every skydiver does, 0 to 1:
   * from just after line stretch until a moment after it flies.
   */
  get glance(): number {
    const o = this.opening;
    if (this.phase === 'opening' && o && o.stage === 'inflation') {
      return ease((o.time - o.timing.lineStretch - 0.2) / 0.8);
    }
    if (this.phase === 'canopy') return 1 - ease((this.time - this.openedAt - 1.2) / 1.5);
    return 0;
  }

  /** How far the canopy is out: null while packed, 0 at line stretch, 1 open. */
  get inflation(): number | null {
    if (this.phase === 'canopy') return 1;
    const o = this.opening;
    return this.phase === 'opening' && o && o.stage === 'inflation' ? o.inflation : null;
  }

  get stowed(): boolean {
    return this.phase === 'canopy' && (this.stowedL || this.stowedR);
  }

  /** Crouched in the door, eyes out in the air, facing the nose. */
  private ride(): void {
    const s = this.model.state;
    const plane = this.plane!;
    Object.assign(s.pilotAtt, plane.level);
    Object.assign(s.att, plane.level);
    plane.point(this.eye, plane.type.doorEye);
    rotate(this.tmp, s.pilotAtt, this.model.rig.eyePos);
    set(s.pos, this.eye.x - this.tmp.x, this.eye.y - this.tmp.y, this.eye.z - this.tmp.z);
    set(s.vel, plane.vel.x, plane.vel.y, plane.vel.z);
    set(s.omega, 0, 0, 0);
    set(s.pilotOmega, 0, 0, 0);
  }

  /** On the feet on top of the object, facing where the run goes. */
  private stand(): void {
    const r = this.runUp!;
    const s = this.model.state;
    quatFromYaw(s.pilotAtt, -r.headingDeg * DEG);
    Object.assign(s.att, s.pilotAtt);
    rotate(this.tmp, s.pilotAtt, this.model.rig.feetPos);
    set(s.pos, r.x - this.tmp.x, r.y - this.tmp.y, r.z - this.tmp.z);
    set(s.vel, r.vel.x, r.vel.y, r.vel.z);
    set(s.omega, 0, 0, 0);
    set(s.pilotOmega, 0, 0, 0);
  }

  private exit(): void {
    const s = this.model.state;
    const b = this.body.state;
    set(b.pos, s.pos.x, s.pos.y, s.pos.z);
    if (this.plane) {
      // Off the sill, out of the plane's way.
      const out = rotate(this.tmp, this.plane.level, set(this.tmp, this.plane.type.doorSide, 0, 0));
      set(b.vel, s.vel.x + out.x * PUSH_OFF, s.vel.y - 0.5, s.vel.z + out.z * PUSH_OFF);
    } else {
      const v = this.runUp!.vel;
      set(b.vel, v.x, v.y, v.z);
    }
    Object.assign(b.att, s.pilotAtt);
    b.yawRate = 0;
    this.phase = 'freefall';
    this.time = 0;
    this.log.exitHeight = this.exitHeight ?? this.height();
  }

  /**
   * The main's pilot chute, or the reserve once the main is gone or when the
   * AAD fires. `by`: what pulled a reserve, when not the AAD.
   */
  private pull(aad: boolean, by: ReserveBy = 'hand'): void {
    if (this.phase !== 'freefall') return;
    const reserve = aad || this.cutawayAt !== null;
    if (reserve && this.canopy === 'reserve') return;
    this.rslAt = null;
    this.pullWhenFlat = false;
    if (this.cutawayAt === null) {
      this.log.pullHeight = aad ? null : this.height();
      this.log.freefallSeconds = this.time;
    }
    this.log.aad = aad;
    // The AAD fires whatever the position: the body goes flat as the bag leaves.
    this.body.setPosition('belly');
    // Triangular spread: most canopies open near the heading.
    let off = (this.random() + this.random() - 1) * (this.base ? BASE_OFF_HEADING : OFF_HEADING);
    if (reserve) {
      this.canopy = 'reserve';
      this.log.reserveHeight = this.height();
      this.log.reserveBy = aad ? 'aad' : by;
      if (this.options.reserve) this.model.rig = this.options.reserve;
      this.stowedL = this.stowedR = true;
      const timing = aad || by === 'rsl' ? RESERVE_OPENING : RESERVE_HANDLE_OPENING;
      this.opening = new Opening(this.body, this.model, timing, off);
    } else {
      const malfunction = this.options.malfunction ?? null;
      this.log.malfunction = malfunction;
      // Nearly the other way round, to one side or the other.
      if (malfunction === 'offHeading') off = (this.random() < 0.5 ? -1 : 1) * (150 + 30 * this.random());
      this.opening = new Opening(this.body, this.model, this.single ? BASE_OPENING : MAIN_OPENING, off, malfunction);
    }
    this.phase = 'opening';
  }

  /** The flight model's state follows the body in freefall. */
  private follow(): void {
    const s = this.model.state;
    const b = this.body.state;
    set(s.pos, b.pos.x, b.pos.y, b.pos.z);
    set(s.vel, b.vel.x, b.vel.y, b.vel.z);
    Object.assign(s.pilotAtt, b.att);
    quatFromYaw(s.att, -this.body.headingDeg() * DEG);
    set(s.omega, 0, 0, 0);
    set(s.pilotOmega, 0, 0, 0);
  }
}
