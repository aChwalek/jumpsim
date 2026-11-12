// What the pilot does once the feet are on the ground: a few steps, a run, a
// slide or a tumble, and the canopy coming down behind.
//
// Flight ends at touchdown. From there this drives the pilot's body by hand
// (it writes the position and attitudes into the flight model's state), so
// the camera, the rig and its shadows follow it as they follow the flight.

import type { FlightModel } from './flightModel';
import type { BodyInputs } from './freefall';
import type { Touchdown } from './landing';
import { RunUp } from './runUp';
import {
  clamp,
  quat,
  quatFromAxisAngle,
  quatMultiply,
  quatSlerp,
  rotate,
  set,
  vec3,
  type Quat,
  type Vec3,
} from './vec';

export type ArrivalKind = 'steps' | 'run' | 'slide' | 'tumble' | 'splash';

export interface ArrivalSetting {
  /** Height of the ground under the pilot, m. */
  groundAt(x: number, z: number): number;
  /** The feet came down in water. */
  wet: boolean;
  /** Where the air is going, world frame, m/s: the canopy falls that way. */
  wind: Vec3;
}

/** How hard each way of arriving brakes, m/s². */
const BRAKING: Record<ArrivalKind, number> = { steps: 3.5, run: 2.6, slide: 4.5, tumble: 7, splash: 9 };
/** Hip angle of the legs hanging in the harness, rad forward. */
export const LEGS_HANGING = 0.21;
/** Seconds over which the body leaves the attitude it touched down in. */
const SETTLE = 0.3;
/** Hips above the ground when sitting, and the shoulders above the hips, m. */
const SEAT = 0.12;
const TORSO = 0.55;
/** How deep the pond is, m. */
const WADING = 0.65;

/** 0 before 0, 1 after 1, smooth in between. */
const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const AXIS_X = vec3(1, 0, 0);
const STAND_STILL: BodyInputs = { turn: 0, forward: 0, slide: 0, fall: 0 };
const AXIS_Y = vec3(0, 1, 0);
const AXIS_Z = vec3(0, 0, 1);

export function arrivalKind(t: Touchdown, wet: boolean): ArrivalKind {
  if (t.rating === 'hard' || t.rating === 'crash') return 'tumble';
  if (wet) return 'splash';
  if (t.rating === 'slide') return 'slide';
  return t.rating === 'run' ? 'run' : 'steps';
}

export class Arrival {
  readonly kind: ArrivalKind;
  /** Seconds since touchdown. */
  time = 0;
  /** Speed over the ground, m/s. */
  speed: number;
  /** Feet put down so far. */
  steps = 0;
  /** Hip angles of the legs, rad forward. */
  legL = LEGS_HANGING;
  legR = LEGS_HANGING;
  /** The pilot has come to rest and the result can be shown. */
  done = false;
  /** Once at rest, on their feet again and walking about; null until then. */
  walker: RunUp | null = null;
  /** Seconds since the pilot started walking. */
  private walked = 0;
  /** Shoulders above the ground when the walk started, m. */
  private walkFrom = 0;
  private lastSwing = 0;

  private readonly violent: boolean;
  private readonly sink: number;
  /** Side the pilot goes down on: 1 right, -1 left. */
  private readonly side: number;
  private readonly heading: number;
  private readonly travel = vec3();
  private readonly attitude0: Quat;
  private readonly canopy0: Quat;
  private readonly height0: number;
  /** Horizontal axis the canopy turns about as it falls. */
  private readonly fall = vec3();
  /** Level direction the canopy falls towards, world frame. */
  readonly fallTo = vec3();
  private readonly stand: number;
  private phase = 0;
  /** Seconds spent at rest. */
  private rest = 0;
  private readonly target = quat();
  private readonly turn = quat();
  private readonly tmp = vec3();

  constructor(
    private readonly model: FlightModel,
    touchdown: Touchdown,
    private readonly setting: ArrivalSetting,
  ) {
    const s = model.state;
    this.kind = arrivalKind(touchdown, setting.wet);
    this.violent = touchdown.rating === 'crash';
    this.sink = touchdown.sink;
    this.side = touchdown.bankDeg < 0 ? -1 : 1;
    this.speed = touchdown.groundSpeed;
    this.stand = -model.rig.feetPos.y;
    this.attitude0 = { ...s.pilotAtt };
    this.canopy0 = { ...s.att };
    this.height0 = s.pos.y - setting.groundAt(s.pos.x, s.pos.z);

    // The pilot keeps facing where they were facing, and keeps going where
    // the feet were going.
    const ahead = rotate(this.tmp, s.pilotAtt, set(this.tmp, 0, 0, -1));
    this.heading = Math.atan2(ahead.x, -ahead.z);
    const feet = model.pilotPointVelocity(vec3(), model.rig.feetPos);
    const over = Math.hypot(feet.x, feet.z);
    if (over > 0.05) set(this.travel, feet.x / over, 0, feet.z / over);
    else set(this.travel, Math.sin(this.heading), 0, -Math.cos(this.heading));

    // The canopy goes down with the wind, or straight on if there is none.
    const wind = Math.hypot(setting.wind.x, setting.wind.z);
    const to = wind > 1 ? set(this.tmp, setting.wind.x / wind, 0, setting.wind.z / wind) : this.travel;
    set(this.fall, to.z, 0, -to.x); // up x to
    set(this.fallTo, to.x, 0, to.z);
  }

  /** Can get up and walk once at rest: not after a crash. */
  get canWalk(): boolean {
    return this.done && this.kind !== 'tumble';
  }

  /**
   * Moves the pilot and the canopy on by `dt` seconds. `feet`: once at rest,
   * what the pilot's feet are asked to do (walk, back up, turn, step aside).
   */
  update(dt: number, feet: BodyInputs | null = null): void {
    const s = this.model.state;
    this.time += dt;
    const t = this.time;
    if (this.walker || (feet && this.canWalk && (feet.forward !== 0 || feet.turn !== 0 || feet.slide !== 0))) {
      this.walk(dt, feet);
      this.dropCanopy();
      return;
    }

    this.speed = Math.max(0, this.speed - BRAKING[this.kind] * dt);
    s.pos.x += this.travel.x * this.speed * dt;
    s.pos.z += this.travel.z * this.speed * dt;
    set(s.vel, this.travel.x * this.speed, 0, this.travel.z * this.speed);
    set(s.omega, 0, 0, 0);
    set(s.pilotOmega, 0, 0, 0);
    const stopped = this.speed === 0;

    // Where the body is heading for: shoulders above the ground, pitch (feet
    // forward), roll (right side down) and the two hips.
    let height = this.stand;
    let pitch = 0;
    let roll = 0;
    let legL = 0;
    let legR = 0;
    let after = 0;
    // The knees take the landing, the deeper the harder it is, going down
    // at first as fast as the pilot was sinking.
    const depth = clamp(0.04 + 0.07 * this.sink, 0.04, 0.42);
    const bend = clamp((depth * Math.E) / Math.max(this.sink, 0.5), 0.1, 0.25);
    const give = depth * (t / bend) * Math.exp(1 - t / bend);

    switch (this.kind) {
      case 'steps':
      case 'run': {
        const running = this.kind === 'run';
        // Strides shorten and slow as the speed comes off.
        const drive = clamp(this.speed / (running ? 4 : 1.5), 0, 1);
        if (this.speed > 0.25) this.phase += Math.PI * Math.min(3.4, 1.8 + 0.35 * this.speed) * dt;
        this.steps = Math.floor(this.phase / Math.PI);
        const swing = (running ? 0.55 : 0.3) * drive * Math.sin(this.phase);
        legL = swing;
        legR = -swing;
        // Lowest as each foot comes down, highest in between.
        height -= give + (running ? 0.05 : 0.025) * drive * (1 - Math.abs(Math.sin(this.phase)));
        pitch = running ? -0.14 * clamp(this.speed / 5, 0, 1) : -0.03 * drive;
        roll = 0.015 * drive * Math.sin(this.phase);
        after = running ? 0.35 : 0.7;
        break;
      }
      case 'slide': {
        // Down on the seat, legs out in front, leaning back, further for a
        // moment when coming down hard.
        const thud = clamp(this.sink / 5, 0, 1) * (t / 0.25) * Math.exp(1 - t / 0.25);
        pitch = 0.38 + 0.22 * thud;
        height = SEAT + TORSO * Math.cos(pitch);
        legL = legR = 1.15;
        const rough = clamp(this.speed / 6, 0, 1);
        height += rough * (0.012 * Math.sin(37 * t) + 0.008 * Math.sin(53 * t));
        roll = 0.03 * rough * Math.sin(5 * t);
        after = 0.4;
        break;
      }
      case 'tumble': {
        // Thrown down and over, and staying there.
        const down = ease(t / 0.45);
        const rest = ease((t - 0.45) / 0.6);
        height += (0.3 - this.stand) * down + 0.03 * Math.sin(40 * t) * Math.exp(-t / 0.4);
        roll = this.side * ((this.violent ? 2.6 : 1.9) * down - (this.violent ? 1.1 : 0.45) * rest);
        pitch = -(this.violent ? 0.9 : 0.5) * down + (this.violent ? 0.75 : 0.4) * rest;
        legL = legR = 0.5 * down;
        after = Math.max(0.3, 1.7 - this.time);
        break;
      }
      case 'splash': {
        // Standing in the pond, which stops the feet short.
        height -= give + WADING * ease(t / 0.5) + 0.015 * Math.sin(2.2 * t) * ease(t - 0.5);
        after = Math.max(0.3, 1.2 - this.time);
        break;
      }
    }
    if (stopped && (this.rest += dt) >= after) this.done = true;

    // Out of the attitude of the touchdown, into that.
    const k = ease(t / SETTLE);
    const ground = this.setting.groundAt(s.pos.x, s.pos.z);
    const above = Math.max(0.25, this.height0 + (height - this.height0) * k);
    s.pos.y = ground + above;
    quatFromAxisAngle(this.target, AXIS_Y, -this.heading);
    quatMultiply(this.target, this.target, quatFromAxisAngle(this.turn, AXIS_X, pitch));
    quatMultiply(this.target, this.target, quatFromAxisAngle(this.turn, AXIS_Z, -roll));
    quatSlerp(s.pilotAtt, this.attitude0, this.target, k);
    this.legL = LEGS_HANGING + (legL - LEGS_HANGING) * k;
    this.legR = LEGS_HANGING + (legR - LEGS_HANGING) * k;

    this.dropCanopy();
  }

  /** The canopy stays up a moment, then tips over until it lies on the ground. */
  private dropCanopy(): void {
    const s = this.model.state;
    const above = s.pos.y - this.setting.groundAt(s.pos.x, s.pos.z);
    const canopy = this.model.rig.canopyPos.y;
    const flat = Math.PI / 2 + Math.asin(clamp((above - 0.3) / canopy, -1, 1));
    quatFromAxisAngle(this.turn, this.fall, flat * ease((this.time - 0.25) / 1.9));
    quatMultiply(s.att, this.turn, this.canopy0);
  }

  /** Up on the feet if sitting, and walking where the keys say. */
  private walk(dt: number, feet: BodyInputs | null): void {
    const s = this.model.state;
    if (!this.walker) {
      const ahead = rotate(this.tmp, s.pilotAtt, set(this.tmp, 0, 0, -1));
      const heading = Math.atan2(ahead.x, -ahead.z) / (Math.PI / 180);
      this.walker = new RunUp(this.setting.groundAt, s.pos.x, s.pos.z, heading);
      this.walkFrom = s.pos.y - this.setting.groundAt(s.pos.x, s.pos.z);
      this.attitude0.x = s.pilotAtt.x;
      this.attitude0.y = s.pilotAtt.y;
      this.attitude0.z = s.pilotAtt.z;
      this.attitude0.w = s.pilotAtt.w;
      this.walked = 0;
    }
    const w = this.walker;
    this.walked += dt;
    // Getting up takes a moment, and nobody walks meanwhile.
    const up = ease(this.walked / (this.kind === 'slide' ? 0.8 : 0.25));
    if (up >= 1) {
      // Down a step, a kerb, the side of a dyke: walked down, not fallen off.
      // With nothing asked (hands full), the feet come to a stop.
      if (w.step(dt, feet ?? STAND_STILL)) w.y = this.setting.groundAt(w.x, w.z);
    }
    // Wading, the pond stops the feet short.
    const stand = this.stand - (this.kind === 'splash' ? WADING : 0);
    s.pos.x = w.x;
    s.pos.z = w.z;
    s.pos.y = this.setting.groundAt(w.x, w.z) + this.walkFrom + (stand - this.walkFrom) * up;
    set(s.vel, w.vel.x, 0, w.vel.z);
    this.speed = Math.hypot(w.vel.x, w.vel.z);
    const lean = -0.03 * clamp(w.forward / 3, -1, 1);
    quatFromAxisAngle(this.target, AXIS_Y, -w.headingDeg * (Math.PI / 180));
    quatMultiply(this.target, this.target, quatFromAxisAngle(this.turn, AXIS_X, lean));
    quatSlerp(s.pilotAtt, this.attitude0, this.target, up);
    this.legL = this.legL + (w.legL - this.legL) * up;
    this.legR = this.legR + (w.legR - this.legR) * up;
    // A foot put down at each swing through the middle.
    if (Math.sign(w.legL) !== Math.sign(this.lastSwing) && this.speed > 0.3) this.steps++;
    this.lastSwing = w.legL;
  }
}
