import { copyPose, makePose, type Pose } from '../render/body';
import type { SliderState } from '../render/canopyView';
import type { DeployStage } from '../render/deployment';
import type { Stance } from '../render/posture';
import type { Controls } from '../sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../sim/freefall';
import type { JumpPhase } from '../sim/jump';
import type { AircraftId } from '../sim/plane';
import { JOINT_COUNT } from '../sim/ragdoll';
import { quat, vec3, type Quat, type Vec3 } from '../sim/vec';

/** No jump: started under canopy, or landed and waiting. */
export type Phase = JumpPhase | 'none';

/** The main once cut away, flying on its own. */
export interface ReleasedFrame {
  pos: Vec3;
  vel: Vec3;
  att: Quat;
  /** How far it has lost its shape, 0 to 1. */
  crumple: number;
  /** How far it has gone down in a heap, 0 to 1; and the way, level. */
  heap: number;
  fallTo: Vec3;
}

/**
 * The plane a jumper is in, while in it. Each machine flies the load's plane
 * by the room's clock, the same for all to a metre or so; but what comes
 * from the others is a moment old, the plane a few metres back by then: they
 * are drawn in ours where they are in theirs.
 */
export interface PlaneFrame {
  /** Origin of the plane's frame, world, m. */
  pos: Vec3;
  /** Compass heading of its run, degrees. */
  headingDeg: number;
  aircraft: AircraftId;
}

export const makeReleased = (): ReleasedFrame => ({ pos: vec3(), vel: vec3(), att: quat(), crumple: 0, heap: 0, fallTo: vec3(0, 0, 1) });

export function copyReleased(out: ReleasedFrame, r: ReleasedFrame): ReleasedFrame {
  Object.assign(out.pos, r.pos);
  Object.assign(out.vel, r.vel);
  Object.assign(out.att, r.att);
  out.crumple = r.crumple;
  out.heap = r.heap;
  Object.assign(out.fallTo, r.fallTo);
  return out;
}

/**
 * What the others need to draw a jumper at an instant, all of it as its
 * owner draws it: where the body and the canopy are, how the body is held,
 * how far the canopy is out, the slider, the twists, the heap on the ground,
 * the body thrown about by a crash, the main cut away. Each player's sim
 * stays their own; only this goes out, 15 times a second.
 */
export interface Snapshot {
  /** The sender's clock (performance.now), ms. */
  t: number;
  phase: Phase;
  stance: Stance;
  deploy: DeployStage;
  /** Flying the reserve. */
  reserve: boolean;
  /** The main has been cut away. */
  cutaway: boolean;
  /** The hands are on the toggles. */
  onRisers: boolean;
  /** Which handles are still on the harness. */
  mainHandle: boolean;
  reserveHandle: boolean;
  /** On the ground. */
  landed: boolean;
  /** Null while packed, then 0 at line stretch to 1 open. */
  inflation: number | null;
  deployTime: number;
  bagOut: number;
  /** Pressure lost by each half of the canopy in a stall, 0 to 1. */
  deflationL: number;
  deflationR: number;
  /**
   * Steering the body in freefall: what the arms and legs are drawn from
   * when not `posed` (a bot drawn on this machine).
   */
  body: BodyInputs;
  controls: Controls;
  hands: Controls;
  pos: Vec3;
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
  slider: SliderState;
  /** Line twists, rad: past half a turn either way, the lines are wound. */
  twist: number;
  /**
   * `pose` is the body as its owner drew it: their keys, the landing, the
   * walk, a blow that knocked them out, the canopy in their arms. False for
   * a bot, an older sender or an older track: drawn from `stance` and `body`.
   */
  posed: boolean;
  pose: Pose;
  /** On the ground: how far the canopy has gone down in a heap, 0 to 1; from where, and the way (level). */
  heap: number;
  heapFrom: Vec3;
  fallTo: Vec3;
  /** Walking off, the heap dragged along behind. */
  walker: boolean;
  /** How far the canopy has been gathered up into the arms, 0 to 1. */
  gather: number;
  /** Thrown about by a crash: the ragdoll's joints, world frame, x y z each; the body is not drawn. */
  hasJoints: boolean;
  joints: Float32Array;
  /** The main, once cut away. */
  hasReleased: boolean;
  released: ReleasedFrame;
  /**
   * In the plane, and a moment after leaving it: the plane they are in, or
   * have just left (to go between the last snapshot in it and the first out).
   */
  hasPlane: boolean;
  plane: PlaneFrame;
}

export const emptySnapshot = (): Snapshot => ({
  t: 0,
  phase: 'none',
  stance: 'hanging',
  deploy: 'canopy',
  reserve: false,
  cutaway: false,
  onRisers: true,
  mainHandle: true,
  reserveHandle: true,
  landed: false,
  inflation: 1,
  deployTime: 0,
  bagOut: 1,
  deflationL: 0,
  deflationR: 0,
  body: noBodyInputs(),
  controls: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
  hands: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
  pos: vec3(),
  vel: vec3(),
  att: quat(),
  pilotAtt: quat(),
  slider: 'open',
  twist: 0,
  posed: false,
  pose: makePose(),
  heap: 0,
  heapFrom: vec3(),
  fallTo: vec3(0, 0, 1),
  walker: false,
  gather: 0,
  hasJoints: false,
  joints: new Float32Array(3 * JOINT_COUNT),
  hasReleased: false,
  released: makeReleased(),
  hasPlane: false,
  plane: { pos: vec3(), headingDeg: 0, aircraft: 'pc6' },
});

/**
 * The code each value goes as, one byte. A Record, so that a phase, stance
 * or stage added elsewhere does not compile until it has a code here.
 */
const PHASE_CODES: Record<Phase, number> = { none: 0, plane: 1, freefall: 2, opening: 3, canopy: 4, standing: 5 };
export const STANCE_CODES: Record<Stance, number> = {
  door: 0,
  belly: 1,
  back: 2,
  sit: 3,
  headDown: 4,
  throw: 5,
  hanging: 6,
  ground: 7,
  cutaway: 8,
  reserve: 9,
  doorRight: 10,
  track: 11,
  doorHigh: 12,
  doorHighRight: 13,
  step: 14,
  stepRight: 15,
  inside: 16,
  insideRight: 17,
  angle: 18,
  backAngle: 19,
  sitAngle: 20,
  sideRight: 21,
  sideLeft: 22,
  sitBackAngle: 23,
};
const DEPLOY_CODES: Record<DeployStage, number> = { stowed: 0, hand: 1, tow: 2, bag: 3, canopy: 4, free: 5 };
const SLIDER_CODES: Record<SliderState, number> = { open: 0, collapsed: 1, stowed: 2 };
const AIRCRAFT_CODES: Record<AircraftId, number> = { pc6: 0, do28: 1, c130: 2, as350: 3 };

/** Code to value, for reading. */
function byCode<T extends string>(codes: Record<T, number>): (T | undefined)[] {
  const out: (T | undefined)[] = [];
  for (const [value, code] of Object.entries(codes) as [T, number][]) out[code] = value;
  return out;
}
const PHASES = byCode(PHASE_CODES);
const STANCES = byCode(STANCE_CODES);
const DEPLOYS = byCode(DEPLOY_CODES);
const SLIDERS = byCode(SLIDER_CODES);
const AIRCRAFT = byCode(AIRCRAFT_CODES);
const CONTROLS = ['brakeL', 'brakeR', 'frontL', 'frontR'] as const;

/** 2: everything as drawn. 1 (the place, the canopy and the stance only) is still read. */
const VERSION = 2;
/** Version 1, all of it: a header of enums, flags and controls, the time, then 18 floats. */
const V1_BYTES = 16 + 8 + 18 * 4;
/** Then the twists, the heap's start and way, and the pose: 8 numbers, then 4 points, two bytes each. */
const POSE_VALUES = 8 + 4 * 3;
export const SNAPSHOT_BYTES = V1_BYTES + 4 + 5 * 4 + POSE_VALUES * 2;
/** And only when there is one: the ragdoll's joints, mm from `pos`, two bytes each; the cut-away main. */
const JOINTS_BYTES = 3 * JOINT_COUNT * 2;
const RELEASED_BYTES = 10 * 4 + 2 + 2 * 2;
/**
 * And while in the plane, the plane: where it is, its heading, which one.
 * Still version 2: a reader without it turns these away, and would not have
 * drawn someone in their plane anyway (but for half a second after the exit).
 */
const PLANE_BYTES = 3 * 4 + 2 + 1;

/** The bytes it goes in. */
export const snapshotBytes = (s: Snapshot): number => SNAPSHOT_BYTES + extraBytes(s.hasJoints, s.hasReleased, s.hasPlane);

const extraBytes = (joints: boolean, released: boolean, plane: boolean): number =>
  (joints ? JOINTS_BYTES : 0) + (released ? RELEASED_BYTES : 0) + (plane ? PLANE_BYTES : 0);

const enum Flag {
  Reserve = 1,
  Cutaway = 2,
  OnRisers = 4,
  MainHandle = 8,
  ReserveHandle = 16,
  Landed = 32,
  Packed = 64,
}

/** The second byte of flags; the slider's code in its top half. */
const enum More {
  Posed = 1,
  Walker = 2,
  Joints = 4,
  Released = 8,
  // The slider's code takes 16 and 32.
  Plane = 64,
}

const byte = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 255);
/** Angles in rad and points in m up to 8, to a 4096th. */
const POSE_SCALE = 4096;
const short = (x: number, scale: number): number => Math.max(-32767, Math.min(32767, Math.round((Number.isFinite(x) ? x : 0) * scale)));

function poseValues(p: Pose): number[] {
  return [p.hipL, p.hipR, p.kneeL, p.kneeR, p.spread, p.sway, p.lean, p.bow, ...p.handL.toArray(), ...p.handR.toArray(), ...p.elbowL.toArray(), ...p.elbowR.toArray()];
}

function setPose(p: Pose, v: readonly number[]): void {
  [p.hipL, p.hipR, p.kneeL, p.kneeR, p.spread, p.sway, p.lean, p.bow] = v as [number, number, number, number, number, number, number, number];
  p.handL.fromArray(v, 8);
  p.handR.fromArray(v, 11);
  p.elbowL.fromArray(v, 14);
  p.elbowR.fromArray(v, 17);
}

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const buffer = new ArrayBuffer(snapshotBytes(s));
  const v = new DataView(buffer);
  v.setUint8(0, VERSION);
  v.setUint8(1, PHASE_CODES[s.phase]);
  v.setUint8(2, STANCE_CODES[s.stance]);
  v.setUint8(3, DEPLOY_CODES[s.deploy]);
  v.setUint8(
    4,
    (s.reserve ? Flag.Reserve : 0) |
      (s.cutaway ? Flag.Cutaway : 0) |
      (s.onRisers ? Flag.OnRisers : 0) |
      (s.mainHandle ? Flag.MainHandle : 0) |
      (s.reserveHandle ? Flag.ReserveHandle : 0) |
      (s.landed ? Flag.Landed : 0) |
      (s.inflation === null ? Flag.Packed : 0),
  );
  CONTROLS.forEach((k, i) => {
    v.setUint8(5 + i, byte(s.controls[k]));
    v.setUint8(9 + i, byte(s.hands[k]));
  });
  v.setUint8(
    13,
    (s.posed ? More.Posed : 0) |
      (s.walker ? More.Walker : 0) |
      (s.hasJoints ? More.Joints : 0) |
      (s.hasReleased ? More.Released : 0) |
      (s.hasPlane ? More.Plane : 0) |
      (SLIDER_CODES[s.slider] << 4),
  );
  v.setUint8(14, byte(s.heap));
  v.setUint8(15, byte(s.gather));
  v.setFloat64(16, s.t, true);
  let o = 24;
  const f = (x: number) => {
    v.setFloat32(o, x, true);
    o += 4;
  };
  const h = (x: number, scale: number) => {
    v.setInt16(o, short(x, scale), true);
    o += 2;
  };
  f(s.pos.x), f(s.pos.y), f(s.pos.z);
  f(s.vel.x), f(s.vel.y), f(s.vel.z);
  f(s.att.x), f(s.att.y), f(s.att.z), f(s.att.w);
  f(s.pilotAtt.x), f(s.pilotAtt.y), f(s.pilotAtt.z), f(s.pilotAtt.w);
  f(s.inflation ?? 0), f(s.deployTime), f(s.bagOut);
  // Both halves in the last float, a byte each: whole numbers that small are exact.
  f(byte(s.deflationL) + 256 * byte(s.deflationR));
  f(s.twist);
  f(s.heapFrom.x), f(s.heapFrom.y), f(s.heapFrom.z);
  f(s.fallTo.x), f(s.fallTo.z);
  for (const x of poseValues(s.pose)) h(x, POSE_SCALE);
  if (s.hasJoints) {
    const j = s.joints;
    for (let i = 0; i < j.length; i += 3) h(j[i]! - s.pos.x, 1000), h(j[i + 1]! - s.pos.y, 1000), h(j[i + 2]! - s.pos.z, 1000);
  }
  if (s.hasReleased) {
    const r = s.released;
    f(r.pos.x), f(r.pos.y), f(r.pos.z);
    f(r.vel.x), f(r.vel.y), f(r.vel.z);
    f(r.att.x), f(r.att.y), f(r.att.z), f(r.att.w);
    v.setUint8(o++, byte(r.crumple));
    v.setUint8(o++, byte(r.heap));
    h(r.fallTo.x, 32767), h(r.fallTo.z, 32767);
  }
  if (s.hasPlane) {
    const p = s.plane;
    f(p.pos.x), f(p.pos.y), f(p.pos.z);
    v.setUint16(o, Math.round((((p.headingDeg % 360) + 360) % 360) * 100) % 36000, true);
    o += 2;
    v.setUint8(o++, AIRCRAFT_CODES[p.aircraft]);
  }
  return buffer;
}

/** Null when it is not a snapshot this version reads. */
export function decodeSnapshot(buffer: ArrayBuffer, out = emptySnapshot()): Snapshot | null {
  if (buffer.byteLength < V1_BYTES) return null;
  const v = new DataView(buffer);
  const version = v.getUint8(0);
  const more = version === VERSION ? v.getUint8(13) : 0;
  const size = version === 1 ? V1_BYTES : SNAPSHOT_BYTES + extraBytes(!!(more & More.Joints), !!(more & More.Released), !!(more & More.Plane));
  if ((version !== 1 && version !== VERSION) || buffer.byteLength !== size) return null;
  const phase = PHASES[v.getUint8(1)];
  const stance = STANCES[v.getUint8(2)];
  const deploy = DEPLOYS[v.getUint8(3)];
  const slider = SLIDERS[(more >> 4) & 3];
  if (phase === undefined || stance === undefined || deploy === undefined || slider === undefined) return null;
  const flags = v.getUint8(4);
  out.phase = phase;
  out.stance = stance;
  out.deploy = deploy;
  out.reserve = (flags & Flag.Reserve) !== 0;
  out.cutaway = (flags & Flag.Cutaway) !== 0;
  out.onRisers = (flags & Flag.OnRisers) !== 0;
  out.mainHandle = (flags & Flag.MainHandle) !== 0;
  out.reserveHandle = (flags & Flag.ReserveHandle) !== 0;
  out.landed = (flags & Flag.Landed) !== 0;
  CONTROLS.forEach((k, i) => {
    out.controls[k] = v.getUint8(5 + i) / 255;
    out.hands[k] = v.getUint8(9 + i) / 255;
  });
  Object.assign(out.body, noBodyInputs());
  out.slider = slider;
  out.posed = (more & More.Posed) !== 0;
  out.walker = (more & More.Walker) !== 0;
  out.hasJoints = (more & More.Joints) !== 0;
  out.hasReleased = (more & More.Released) !== 0;
  out.hasPlane = (more & More.Plane) !== 0;
  out.heap = version === 1 ? 0 : v.getUint8(14) / 255;
  out.gather = version === 1 ? 0 : v.getUint8(15) / 255;
  out.t = v.getFloat64(16, true);
  let o = 24;
  const f = (): number => {
    const x = v.getFloat32(o, true);
    o += 4;
    return Number.isFinite(x) ? x : 0;
  };
  const h = (scale: number): number => {
    const x = v.getInt16(o, true) / scale;
    o += 2;
    return x;
  };
  out.pos.x = f(), out.pos.y = f(), out.pos.z = f();
  out.vel.x = f(), out.vel.y = f(), out.vel.z = f();
  out.att.x = f(), out.att.y = f(), out.att.z = f(), out.att.w = f();
  out.pilotAtt.x = f(), out.pilotAtt.y = f(), out.pilotAtt.z = f(), out.pilotAtt.w = f();
  const inflation = f();
  out.inflation = flags & Flag.Packed ? null : inflation;
  out.deployTime = f();
  out.bagOut = f();
  const deflation = Math.max(0, Math.round(f()));
  out.deflationL = (deflation % 256) / 255;
  out.deflationR = Math.min(255, Math.floor(deflation / 256)) / 255;
  if (version === 1) {
    out.twist = 0;
    Object.assign(out.heapFrom, out.pos);
    Object.assign(out.fallTo, { x: 0, y: 0, z: 1 });
    return out;
  }
  out.twist = f();
  out.heapFrom.x = f(), out.heapFrom.y = f(), out.heapFrom.z = f();
  out.fallTo.x = f(), out.fallTo.y = 0, out.fallTo.z = f();
  const pose: number[] = [];
  for (let i = 0; i < POSE_VALUES; i++) pose.push(h(POSE_SCALE));
  setPose(out.pose, pose);
  if (out.hasJoints) {
    const j = out.joints;
    for (let i = 0; i < j.length; i += 3) (j[i] = out.pos.x + h(1000)), (j[i + 1] = out.pos.y + h(1000)), (j[i + 2] = out.pos.z + h(1000));
  }
  if (out.hasReleased) {
    const r = out.released;
    r.pos.x = f(), r.pos.y = f(), r.pos.z = f();
    r.vel.x = f(), r.vel.y = f(), r.vel.z = f();
    r.att.x = f(), r.att.y = f(), r.att.z = f(), r.att.w = f();
    r.crumple = v.getUint8(o++) / 255;
    r.heap = v.getUint8(o++) / 255;
    r.fallTo.x = h(32767), r.fallTo.y = 0, r.fallTo.z = h(32767);
  }
  if (out.hasPlane) {
    const p = out.plane;
    p.pos.x = f(), p.pos.y = f(), p.pos.z = f();
    p.headingDeg = v.getUint16(o, true) / 100;
    o += 2;
    const aircraft = AIRCRAFT[v.getUint8(o++)];
    // A plane this version does not know: not one of ours, so not drawn in it.
    if (aircraft === undefined) out.hasPlane = false;
    else p.aircraft = aircraft;
  }
  return out;
}

export function copySnapshot(out: Snapshot, s: Snapshot): Snapshot {
  const { body, controls, hands, pos, vel, att, pilotAtt, pose, heapFrom, fallTo, joints, released, plane } = out;
  Object.assign(out, s, { body, controls, hands, pos, vel, att, pilotAtt, pose, heapFrom, fallTo, joints, released, plane });
  Object.assign(plane.pos, s.plane.pos);
  plane.headingDeg = s.plane.headingDeg;
  plane.aircraft = s.plane.aircraft;
  copyPose(pose, s.pose);
  Object.assign(heapFrom, s.heapFrom);
  Object.assign(fallTo, s.fallTo);
  joints.set(s.joints);
  copyReleased(released, s.released);
  Object.assign(body, s.body);
  Object.assign(controls, s.controls);
  Object.assign(hands, s.hands);
  Object.assign(pos, s.pos);
  Object.assign(vel, s.vel);
  Object.assign(att, s.att);
  Object.assign(pilotAtt, s.pilotAtt);
  return out;
}
