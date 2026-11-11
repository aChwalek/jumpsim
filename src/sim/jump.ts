// A whole jump from the plane: in the door, freefall, the opening, then the
// canopy, whose flight the flight model takes over.
//
// Until the canopy flies, this drives the flight model's state by hand (as
// the arrival does on the ground), so the camera, the rig and the HUD follow
// without knowing where the pilot is in the jump.

import type { Controls, Environment, FlightModel } from './flightModel';
import { Freefall, freefallParams, type BodyInputs } from './freefall';
import { MAIN_OPENING, Opening, RESERVE_OPENING, STOWED_BRAKE } from './opening';
import { DOOR_EYE, Plane, type JumpRun } from './plane';
import { DEG, quatFromYaw, rotate, set, vec3 } from './vec';

export type JumpPhase = 'plane' | 'freefall' | 'opening' | 'canopy';

/**
 * The automatic activation device fires the reserve below this height when
 * still falling fast (a Cypres in its expert mode).
 */
export const AAD_HEIGHT = 225;
const AAD_SPEED = 35;
/** The pull is not taken in the first moments out of the door: no pilot chute over the tail. */
const CLEAR_OF_THE_PLANE = 1.5;
/** How hard the jumper pushes off out of the door, m/s. */
const PUSH_OFF = 1.5;
/** How far off the pilot's heading a canopy may open, degrees either way. */
const OFF_HEADING = 25;
/** How far past its stow a toggle has to come to free it. */
const UNSTOW = 0.08;

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

  private readonly tmp = vec3();
  private readonly eye = vec3();

  constructor(
    private readonly model: FlightModel,
    run: JumpRun,
    env: Environment,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly random: () => number = Math.random,
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
    };
    this.ride();
  }

  /** Space bar: out of the door, then the pull. */
  act(): void {
    if (this.phase === 'plane') this.exit();
    else if (this.phase === 'freefall' && this.time > CLEAR_OF_THE_PLANE) this.pull(false);
  }

  /** Feet above the ground, m. */
  height(): number {
    const m = this.model;
    m.pilotPoint(this.tmp, m.rig.feetPos);
    return this.tmp.y - this.groundAt(this.tmp.x, this.tmp.z);
  }

  /** Advances whatever is under way before the canopy flies. */
  step(dt: number, input: BodyInputs, env: Environment): void {
    this.plane.step(dt);
    if (this.phase === 'plane') {
      this.ride();
      return;
    }
    if (this.impact) return;
    this.time += dt;
    if (this.phase === 'canopy') return;
    if (this.phase === 'freefall') {
      this.body.step(dt, input, env);
      this.follow();
      const b = this.body.state;
      this.log.topSpeed = Math.max(this.log.topSpeed, -b.vel.y);
      if (this.height() < AAD_HEIGHT && -b.vel.y > AAD_SPEED) this.pull(true);
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
    return this.phase === 'opening' && this.opening ? this.opening.hang : 0;
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

  private pull(aad: boolean): void {
    if (this.phase !== 'freefall') return;
    this.log.pullHeight = aad ? null : this.height();
    this.log.freefallSeconds = this.time;
    this.log.aad = aad;
    // Triangular spread: most canopies open near the heading.
    const off = (this.random() + this.random() - 1) * OFF_HEADING;
    this.opening = new Opening(this.body, this.model, aad ? RESERVE_OPENING : MAIN_OPENING, off);
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
