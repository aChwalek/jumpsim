// The replay of a crash, as sports television does it: the last seconds
// before the ground, the impact in slow motion, then the body coming to rest,
// with every thud, crack and cry where it happened.
//
// The jump is recorded frame by frame as drawn (the flight model's state,
// the pose, the canopy, the ragdoll's joints); only the last few seconds are
// kept until something goes wrong, then all of it until the body is still.

import type { DeployStage } from './render/deployment';
import { copyPose, makePose, blendPose, type Pose } from './render/body';
import type { Controls } from './sim/flightModel';
import { JOINT_COUNT } from './sim/ragdoll';
import { quat, quatSlerp, vec3, type Quat, type Vec3 } from './sim/vec';
import type { Ouch } from './audio/sound';

/** Everything needed to draw the jumper as they were at one moment. */
export interface ReplayFrame {
  /** Seconds on the recorder's clock. */
  t: number;
  pos: Vec3;
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
  deflationL: number;
  deflationR: number;
  controls: Controls;
  hands: Controls;
  pose: Pose;
  inflation: number | null;
  onRisers: boolean;
  deploy: DeployStage;
  deployTime: number;
  bagOut: number;
  /** How far the canopy has gone down in a heap, 0 to 1. */
  heap: number;
  /** The ragdoll's joints, world frame, x y z each, if `hasJoints`: otherwise the body is still the pilot's. */
  joints: Float32Array;
  hasJoints: boolean;
}

/** A sound of the crash and when it was heard. */
interface Heard {
  t: number;
  kind: Ouch;
  level: number;
}

const controls = (): Controls => ({ brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 });

export function makeFrame(): ReplayFrame {
  return {
    t: 0,
    pos: vec3(),
    vel: vec3(),
    att: quat(),
    pilotAtt: quat(),
    deflationL: 0,
    deflationR: 0,
    controls: controls(),
    hands: controls(),
    pose: makePose(),
    inflation: null,
    onRisers: false,
    deploy: 'stowed',
    deployTime: 0,
    bagOut: 0,
    heap: 0,
    joints: new Float32Array(3 * JOINT_COUNT),
    hasJoints: false,
  };
}

/** Seconds kept before a crash. */
const BEFORE = 4;

export class Recorder {
  private frames: ReplayFrame[] = [];
  private spare: ReplayFrame[] = [];
  private heard: Heard[] = [];
  private clock = 0;
  /** When the crash came, on the recorder's clock; null if none yet. */
  crashAt: number | null = null;

  clear(): void {
    this.spare.push(...this.frames);
    this.frames = [];
    this.heard = [];
    this.crashAt = null;
  }

  /** A frame to fill for the moment `dt` seconds after the last one. */
  next(dt: number): ReplayFrame {
    this.clock += dt;
    // Before a crash, only the last few seconds are kept.
    if (this.crashAt === null) {
      while (this.frames.length > 1 && this.frames[0]!.t < this.clock - BEFORE - 0.5) this.spare.push(this.frames.shift()!);
    }
    const f = this.spare.pop() ?? makeFrame();
    f.t = this.clock;
    this.frames.push(f);
    return f;
  }

  /** Something went wrong, now: keep it all from here. */
  crash(): void {
    if (this.crashAt === null) this.crashAt = this.clock;
  }

  hear(kind: Ouch, level: number): void {
    this.heard.push({ t: this.clock, kind, level });
  }

  /** The replay of the crash, or null if there was none. */
  replay(): Replay | null {
    if (this.crashAt === null || this.frames.length < 2) return null;
    return new Replay(this.frames, this.heard, this.crashAt);
  }
}

/** Playback speed around the impact, and over how long either side of it, s. */
const SLOW = 0.25;
const SLOW_BEFORE = 0.35;
const SLOW_AFTER = 1.4;
/** Time to slow down and to speed up again, s. */
const EASE = 0.3;

export class Replay {
  /** Where the replay is, on the recorder's clock. */
  time: number;
  readonly start: number;
  readonly end: number;
  /** The moment shown, in between two recorded frames. */
  readonly frame = makeFrame();
  private index = 0;
  private soundIndex = 0;
  private readonly scratch = makePose();

  constructor(
    private readonly frames: ReplayFrame[],
    private readonly heard: Heard[],
    readonly crashAt: number,
  ) {
    this.start = Math.max(frames[0]!.t, crashAt - BEFORE + 0.5);
    this.end = frames[frames.length - 1]!.t;
    this.time = this.start;
    while (this.soundIndex < heard.length && heard[this.soundIndex]!.t < this.start) this.soundIndex++;
    this.seek();
  }

  get done(): boolean {
    return this.time >= this.end;
  }

  /** How fast the replay plays at this moment, 1 being real time. */
  speed(): number {
    const t = this.time - this.crashAt;
    const into = (-SLOW_BEFORE - t) / EASE;
    const out = (t - SLOW_AFTER) / EASE;
    const k = Math.max(0, Math.min(1, Math.max(into, out)));
    return SLOW + (1 - SLOW) * k * k * (3 - 2 * k);
  }

  /**
   * Plays on by `dt` seconds of real time; `hear` is called with each sound
   * reached, and the speed it is played back at.
   */
  advance(dt: number, hear: (kind: Ouch, level: number, rate: number) => void): void {
    const speed = this.speed();
    this.time = Math.min(this.end, this.time + dt * speed);
    while (this.soundIndex < this.heard.length && this.heard[this.soundIndex]!.t <= this.time) {
      const h = this.heard[this.soundIndex++]!;
      hear(h.kind, h.level, Math.sqrt(speed));
    }
    this.seek();
  }

  /** Puts the frame shown at the current time, between the two recorded around it. */
  private seek(): void {
    const frames = this.frames;
    while (this.index < frames.length - 2 && frames[this.index + 1]!.t <= this.time) this.index++;
    const a = frames[this.index]!;
    const b = frames[this.index + 1]!;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (this.time - a.t) / (b.t - a.t))) : 1;
    const f = this.frame;
    f.t = this.time;
    lerp3(f.pos, a.pos, b.pos, k);
    lerp3(f.vel, a.vel, b.vel, k);
    quatSlerp(f.att, a.att, b.att, k);
    quatSlerp(f.pilotAtt, a.pilotAtt, b.pilotAtt, k);
    f.deflationL = a.deflationL + (b.deflationL - a.deflationL) * k;
    f.deflationR = a.deflationR + (b.deflationR - a.deflationR) * k;
    lerpControls(f.controls, a.controls, b.controls, k);
    lerpControls(f.hands, a.hands, b.hands, k);
    copyPose(f.pose, a.pose);
    blendPose(f.pose, copyPose(this.scratch, b.pose), k);
    f.inflation = a.inflation === null || b.inflation === null ? (k < 0.5 ? a.inflation : b.inflation) : a.inflation + (b.inflation - a.inflation) * k;
    const near = k < 0.5 ? a : b;
    f.onRisers = near.onRisers;
    f.deploy = near.deploy;
    f.deployTime = a.deployTime + (b.deployTime - a.deployTime) * k;
    f.bagOut = a.bagOut + (b.bagOut - a.bagOut) * k;
    f.heap = a.heap + (b.heap - a.heap) * k;
    f.hasJoints = a.hasJoints && b.hasJoints ? true : near.hasJoints;
    if (a.hasJoints && b.hasJoints) {
      for (let i = 0; i < f.joints.length; i++) f.joints[i] = a.joints[i]! + (b.joints[i]! - a.joints[i]!) * k;
    } else if (near.hasJoints) f.joints.set(near.joints);
  }
}

function lerp3(out: Vec3, a: Vec3, b: Vec3, k: number): void {
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  out.z = a.z + (b.z - a.z) * k;
}

function lerpControls(out: Controls, a: Controls, b: Controls, k: number): void {
  out.brakeL = a.brakeL + (b.brakeL - a.brakeL) * k;
  out.brakeR = a.brakeR + (b.brakeR - a.brakeR) * k;
  out.frontL = a.frontL + (b.frontL - a.frontL) * k;
  out.frontR = a.frontR + (b.frontR - a.frontR) * k;
}
