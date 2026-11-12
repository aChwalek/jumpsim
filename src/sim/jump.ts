// A whole jump from the plane: in the door, freefall, the opening, then the
// canopy, whose flight the flight model takes over.
//
// Until the canopy flies, this drives the flight model's state by hand (as
// the arrival does on the ground), so the camera, the rig and the HUD follow
// without knowing where the pilot is in the jump.

import type { Controls, Environment, FlightModel } from './flightModel';
import { Freefall, freefallParams, type BodyInputs, type BodyPosition } from './freefall';
import { MAIN_OPENING, Opening, RESERVE_HANDLE_OPENING, RESERVE_OPENING, STOWED_BRAKE, type Malfunction } from './opening';
import { DOOR_EYE, Plane, type JumpRun } from './plane';
import { ReleasedCanopy } from './released';
import type { RigParams } from './rig';
import { DEG, quatFromYaw, rotate, set, vec3 } from './vec';

export type JumpPhase = 'plane' | 'freefall' | 'opening' | 'canopy';
/** The canopy out, or coming out. */
export type CanopyId = 'main' | 'reserve';
/** What pulled the reserve: the pilot's hand, the static line from the main risers, or the AAD. */
export type ReserveBy = 'hand' | 'rsl' | 'aad';

export interface JumpOptions {
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
  phase: JumpPhase = 'plane';
  readonly plane: Plane;
  readonly body: Freefall;
  opening: Opening | null = null;
  /** Seconds since leaving the door. */
  time = 0;
  /** The toggles are still stowed, each side. */
  stowedL = true;
  stowedR = true;
  /** Hit the ground before the canopy flew. */
  impact = false;
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

  constructor(
    private readonly model: FlightModel,
    run: JumpRun,
    env: Environment,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly random: () => number = Math.random,
    private readonly options: JumpOptions = {},
  ) {
    this.plane = new Plane(run, env.wind, groundAt(run.x, run.z));
    this.body = new Freefall(freefallParams(model.rig.gravMass));
    this.log = {
      exitHeight: run.height,
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
    this.ride();
  }

  /**
   * Space bar: out of the door, then the pull. Nobody pulls head down or on
   * the back: out of any other position the pilot comes back to belly to
   * earth first, and pulls once there.
   */
  act(): void {
    if (this.phase === 'plane') this.exit();
    else if (this.phase === 'freefall' && this.cutawayAt !== null) {
      // The reserve handle, right after the cutaway, whatever the position.
      this.pull(false);
    } else if (this.phase === 'freefall' && this.time > CLEAR_OF_THE_PLANE) {
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
    if (this.phase === 'plane' || this.phase === 'freefall') this.body.setPosition(position, roll);
  }

  /** Feet above the ground, m. */
  height(): number {
    const m = this.model;
    m.pilotPoint(this.tmp, m.rig.feetPos);
    return this.tmp.y - this.groundAt(this.tmp.x, this.tmp.z);
  }

  /**
   * The cutaway handle: the main and its risers go, and the pilot falls
   * free again, to pull the reserve (or have the static line pull it).
   * Only once the main is out of its bag.
   */
  cutaway(): void {
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
    this.plane.step(dt);
    if (this.phase === 'plane') {
      this.ride();
      return;
    }
    this.released?.step(dt, env);
    if (this.impact) return;
    this.time += dt;
    if (this.phase === 'canopy') return;
    if (this.phase === 'freefall') {
      this.body.step(dt, input, env);
      this.follow();
      const b = this.body.state;
      this.log.topSpeed = Math.max(this.log.topSpeed, -b.vel.y);
      if (this.height() < AAD_HEIGHT && -b.vel.y > AAD_SPEED) this.pull(true);
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
    if (this.phase !== 'canopy' && this.height() <= 0) this.impact = true;
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
    const plane = this.plane;
    Object.assign(s.pilotAtt, plane.level);
    Object.assign(s.att, plane.level);
    plane.point(this.eye, DOOR_EYE);
    rotate(this.tmp, s.pilotAtt, this.model.rig.eyePos);
    set(s.pos, this.eye.x - this.tmp.x, this.eye.y - this.tmp.y, this.eye.z - this.tmp.z);
    set(s.vel, plane.vel.x, plane.vel.y, plane.vel.z);
    set(s.omega, 0, 0, 0);
    set(s.pilotOmega, 0, 0, 0);
  }

  private exit(): void {
    const s = this.model.state;
    const b = this.body.state;
    set(b.pos, s.pos.x, s.pos.y, s.pos.z);
    // Off the sill to the left, out of the plane's way.
    const left = rotate(this.tmp, this.plane.level, set(this.tmp, -1, 0, 0));
    set(b.vel, s.vel.x + left.x * PUSH_OFF, s.vel.y - 0.5, s.vel.z + left.z * PUSH_OFF);
    Object.assign(b.att, s.pilotAtt);
    b.yawRate = 0;
    this.phase = 'freefall';
    this.time = 0;
    this.log.exitHeight = this.height();
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
    const off = (this.random() + this.random() - 1) * OFF_HEADING;
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
      this.opening = new Opening(this.body, this.model, MAIN_OPENING, off, malfunction);
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
