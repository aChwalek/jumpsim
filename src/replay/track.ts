// The whole jump, kept to be watched again from the logbook: from a few
// seconds in the door (or on the edge of the object) to the pilot at rest on
// the ground, as it was drawn.
//
// Twenty moments a second are kept (every frame while the body is thrown
// about), each one the numbers the views need: where the pilot and the
// canopy are, how the body is held, how far the canopy is out, what the
// outside camera framed. Between two of them the replay interpolates.
//
// Stored, each number is a whole number of some unit (mm, mrad...), one
// column per number, each written as the change from the moment before in
// as few bytes as it takes: most do not change, or by little, and the
// columns of zeros compress to almost nothing (see store.ts).

import type { Ouch } from '../audio/sound';
import { STANCE_CODES, emptySnapshot, type Phase, type Snapshot } from '../net/snapshot';
import { makePose, type Pose } from '../render/body';
import type { SliderState } from '../render/canopyView';
import type { DeployStage } from '../render/deployment';
import type { Gear, Setup, Start } from '../setup';
import type { Controls } from '../sim/flightModel';
import type { AircraftId } from '../sim/plane';
import { JOINT_COUNT } from '../sim/ragdoll';
import { quat, vec3, type Quat, type Vec3 } from '../sim/vec';

/** Everything needed to draw the jumper as they were at one moment. */
export interface TrackFrame {
  /** Seconds since the recording started. */
  t: number;
  phase: Phase;
  deploy: DeployStage;
  slider: SliderState;
  /** The hands are on the toggles. */
  onRisers: boolean;
  /** Under the reserve, or about to be. */
  reserve: boolean;
  /** Which handles are still on the harness. */
  mainHandle: boolean;
  reserveHandle: boolean;
  /** On the ground. */
  landed: boolean;
  pos: Vec3;
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
  deflationL: number;
  deflationR: number;
  controls: Controls;
  hands: Controls;
  /** Null while packed, then 0 at line stretch to 1 open. */
  inflation: number | null;
  deployTime: number;
  bagOut: number;
  /** How far the canopy has gone down in a heap on the ground, 0 to 1. */
  heap: number;
  pose: Pose;
  /** What the outside camera framed: its focus, from `pos`; the heading behind, rad; how far, m; how far above, rad. */
  focus: Vec3;
  heading: number;
  distance: number;
  above: number;
  /** The ragdoll's joints, world frame, x y z each, if `hasJoints`: otherwise the body is the pilot's. */
  hasJoints: boolean;
  joints: Float32Array;
  /** The main once cut away, if `hasReleased`. */
  hasReleased: boolean;
  released: ReleasedFrame;
}

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

const noControls = (): Controls => ({ brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 });

export function makeTrackFrame(): TrackFrame {
  return {
    t: 0,
    phase: 'none',
    deploy: 'canopy',
    slider: 'open',
    onRisers: true,
    reserve: false,
    mainHandle: true,
    reserveHandle: true,
    landed: false,
    pos: vec3(),
    vel: vec3(),
    att: quat(),
    pilotAtt: quat(),
    deflationL: 0,
    deflationR: 0,
    controls: noControls(),
    hands: noControls(),
    inflation: 1,
    deployTime: 0,
    bagOut: 1,
    heap: 0,
    pose: makePose(),
    focus: vec3(),
    heading: 0,
    distance: 10,
    above: 0.2,
    hasJoints: false,
    joints: new Float32Array(3 * JOINT_COUNT),
    hasReleased: false,
    released: { pos: vec3(), vel: vec3(), att: quat(), crumple: 0, heap: 0, fallTo: vec3(0, 0, 1) },
  };
}

/** A sound of the jump and when it was heard. */
export type TrackEvent =
  | { t: number; kind: 'ouch'; ouch: Ouch; level: number }
  | { t: number; kind: 'land'; sink: number; groundSpeed: number; wet: boolean }
  | { t: number; kind: 'step'; speed: number }
  | { t: number; kind: 'beep'; count: number; seconds: number; gap: number };

/** What the samples are not: the jump's setup, the plane, the sounds. */
export interface TrackMeta {
  /** The jump's number in the logbook, and when it was logged there (ms since 1970). */
  n: number;
  time: number;
  setup: Setup;
  start: Start;
  /** The plane, which flies straight on: where it was at `t`, and how it goes. */
  plane: { aircraft: AircraftId; t: number; pos: number[]; vel: number[]; att: number[] } | null;
  /** Where the canopy went down in a heap from, and the way it fell, once landed. */
  landing: { from: number[]; fallTo: number[] } | null;
  events: TrackEvent[];
  /** The others on the jump, bots or players, in the order first seen; absent from older tracks. */
  others?: TrackMember[];
}

/** Another jumper on the jump: who, and what they flew. */
export interface TrackMember {
  name: string;
  gear: Gear;
}

/** Another jumper as drawn at the moment a sample is kept. */
export interface OtherJumper {
  /** Theirs for the jump: the same one from sample to sample. */
  id: string;
  name: string;
  gear: Gear;
  snap: Snapshot;
}

/** Another jumper as the replay has them at the moment shown. */
export interface OtherShown extends TrackMember {
  /** Drawn at that moment. */
  shown: boolean;
  snap: Snapshot;
}

// ------------------------------------------------------------ channels

/** Between two samples: in a straight line, the first one's until the next, or round the circle. */
type Mode = 'lerp' | 'step' | 'angle';

interface Channels<N extends string> {
  readonly count: number;
  readonly index: Record<N, number>;
  /** Whole units per unit: 1000 keeps mm of m. */
  readonly scale: readonly number[];
  readonly mode: readonly Mode[];
  /** Where each quaternion starts: interpolated the short way round, and kept unit. */
  readonly quats: readonly number[];
}

function channels<const N extends string>(list: readonly (readonly [N, number, Mode?])[], quats: N[] = []): Channels<N> {
  const index = Object.fromEntries(list.map(([name], i) => [name, i])) as Record<N, number>;
  return {
    count: list.length,
    index,
    scale: list.map(([, scale]) => scale),
    mode: list.map(([, , mode]) => mode ?? 'lerp'),
    quats: quats.map((name) => index[name]),
  };
}

const MM = 1000;
const UNIT = 1000;
const QUAT = 10000;

const BASE = channels(
  [
    ['t', 1000],
    ['phase', 1, 'step'],
    ['deploy', 1, 'step'],
    ['slider', 1, 'step'],
    ['flags', 1, 'step'],
    ['posX', MM],
    ['posY', MM],
    ['posZ', MM],
    ['velX', 100],
    ['velY', 100],
    ['velZ', 100],
    ['attX', QUAT],
    ['attY', QUAT],
    ['attZ', QUAT],
    ['attW', QUAT],
    ['pilotX', QUAT],
    ['pilotY', QUAT],
    ['pilotZ', QUAT],
    ['pilotW', QUAT],
    ['deflationL', UNIT],
    ['deflationR', UNIT],
    ['brakeL', UNIT],
    ['brakeR', UNIT],
    ['frontL', UNIT],
    ['frontR', UNIT],
    ['handBrakeL', UNIT],
    ['handBrakeR', UNIT],
    ['handFrontL', UNIT],
    ['handFrontR', UNIT],
    ['inflation', UNIT],
    ['deployTime', 1000],
    ['bagOut', UNIT],
    ['heap', UNIT],
    ['hipL', UNIT],
    ['hipR', UNIT],
    ['kneeL', UNIT],
    ['kneeR', UNIT],
    ['spread', UNIT],
    ['sway', UNIT],
    ['lean', UNIT],
    ['bow', UNIT],
    ['handLX', MM],
    ['handLY', MM],
    ['handLZ', MM],
    ['handRX', MM],
    ['handRY', MM],
    ['handRZ', MM],
    ['elbowLX', UNIT],
    ['elbowLY', UNIT],
    ['elbowLZ', UNIT],
    ['elbowRX', UNIT],
    ['elbowRY', UNIT],
    ['elbowRZ', UNIT],
    ['heading', UNIT, 'angle'],
    ['distance', 100],
    ['above', UNIT],
    ['focusX', MM],
    ['focusY', MM],
    ['focusZ', MM],
  ],
  ['attX', 'pilotX'],
);

const JOINTS = channels(Array.from({ length: 3 * JOINT_COUNT }, (_, i) => [`j${i}`, MM] as const));

const RELEASED = channels(
  [
    ['posX', MM],
    ['posY', MM],
    ['posZ', MM],
    ['velX', 100],
    ['velY', 100],
    ['velZ', 100],
    ['attX', QUAT],
    ['attY', QUAT],
    ['attZ', QUAT],
    ['attW', QUAT],
    ['crumple', UNIT],
    ['heap', UNIT],
    ['fallToX', UNIT],
    ['fallToZ', UNIT],
  ],
  ['attX'],
);

/** Another jumper, as they are sent (see net/snapshot.ts); `sample`: the row of the base it goes with. */
const OTHER = channels(
  [
    ['sample', 1, 'step'],
    ['phase', 1, 'step'],
    ['stance', 1, 'step'],
    ['deploy', 1, 'step'],
    ['flags', 1, 'step'],
    ['posX', MM],
    ['posY', MM],
    ['posZ', MM],
    ['velX', 100],
    ['velY', 100],
    ['velZ', 100],
    ['attX', QUAT],
    ['attY', QUAT],
    ['attZ', QUAT],
    ['attW', QUAT],
    ['pilotX', QUAT],
    ['pilotY', QUAT],
    ['pilotZ', QUAT],
    ['pilotW', QUAT],
    ['inflation', UNIT],
    ['deployTime', 1000],
    ['bagOut', UNIT],
    ['deflationL', UNIT],
    ['deflationR', UNIT],
    ['brakeL', UNIT],
    ['brakeR', UNIT],
    ['frontL', UNIT],
    ['frontR', UNIT],
    ['handBrakeL', UNIT],
    ['handBrakeR', UNIT],
    ['handFrontL', UNIT],
    ['handFrontR', UNIT],
  ],
  ['attX', 'pilotX'],
);

const B = BASE.index;
const R = RELEASED.index;
const O = OTHER.index;

/**
 * The code each value goes as. A Record, so that a phase, stage or slider
 * state added elsewhere does not compile until it has a code here.
 */
const PHASE_CODES: Record<Phase, number> = { none: 0, plane: 1, freefall: 2, opening: 3, canopy: 4, standing: 5 };
const DEPLOY_CODES: Record<DeployStage, number> = { stowed: 0, hand: 1, tow: 2, bag: 3, canopy: 4, free: 5 };
const SLIDER_CODES: Record<SliderState, number> = { open: 0, collapsed: 1, stowed: 2 };

function byCode<T extends string>(codes: Record<T, number>): T[] {
  const out: T[] = [];
  for (const [value, code] of Object.entries(codes) as [T, number][]) out[code] = value;
  return out;
}
const PHASES = byCode(PHASE_CODES);
const DEPLOYS = byCode(DEPLOY_CODES);
const SLIDERS = byCode(SLIDER_CODES);
const STANCES = byCode(STANCE_CODES);

const enum Flag {
  OnRisers = 1,
  Reserve = 2,
  MainHandle = 4,
  ReserveHandle = 8,
  Landed = 16,
  Packed = 32,
  Joints = 64,
  Released = 128,
}

const enum OtherFlag {
  Reserve = 1,
  Cutaway = 2,
  OnRisers = 4,
  MainHandle = 8,
  ReserveHandle = 16,
  Landed = 32,
  Packed = 64,
}

/** Another jumper as the numbers of each channel, `sample` the row of the base. */
function otherValues(s: Snapshot, sample: number, v: Float64Array): void {
  v[O.sample] = sample;
  v[O.phase] = PHASE_CODES[s.phase];
  v[O.stance] = STANCE_CODES[s.stance];
  v[O.deploy] = DEPLOY_CODES[s.deploy];
  v[O.flags] =
    (s.reserve ? OtherFlag.Reserve : 0) |
    (s.cutaway ? OtherFlag.Cutaway : 0) |
    (s.onRisers ? OtherFlag.OnRisers : 0) |
    (s.mainHandle ? OtherFlag.MainHandle : 0) |
    (s.reserveHandle ? OtherFlag.ReserveHandle : 0) |
    (s.landed ? OtherFlag.Landed : 0) |
    (s.inflation === null ? OtherFlag.Packed : 0);
  put3(v, O.posX, s.pos);
  put3(v, O.velX, s.vel);
  put4(v, O.attX, s.att);
  put4(v, O.pilotX, s.pilotAtt);
  v[O.inflation] = s.inflation ?? 0;
  v[O.deployTime] = s.deployTime;
  v[O.bagOut] = s.bagOut;
  v[O.deflationL] = s.deflationL;
  v[O.deflationR] = s.deflationR;
  v[O.brakeL] = s.controls.brakeL;
  v[O.brakeR] = s.controls.brakeR;
  v[O.frontL] = s.controls.frontL;
  v[O.frontR] = s.controls.frontR;
  v[O.handBrakeL] = s.hands.brakeL;
  v[O.handBrakeR] = s.hands.brakeR;
  v[O.handFrontL] = s.hands.frontL;
  v[O.handFrontR] = s.hands.frontR;
}

function valuesOther(v: ArrayLike<number>, s: Snapshot): void {
  s.phase = PHASES[v[O.phase]!] ?? 'none';
  s.stance = STANCES[v[O.stance]!] ?? 'hanging';
  s.deploy = DEPLOYS[v[O.deploy]!] ?? 'canopy';
  const flags = v[O.flags]!;
  s.reserve = (flags & OtherFlag.Reserve) !== 0;
  s.cutaway = (flags & OtherFlag.Cutaway) !== 0;
  s.onRisers = (flags & OtherFlag.OnRisers) !== 0;
  s.mainHandle = (flags & OtherFlag.MainHandle) !== 0;
  s.reserveHandle = (flags & OtherFlag.ReserveHandle) !== 0;
  s.landed = (flags & OtherFlag.Landed) !== 0;
  s.inflation = flags & OtherFlag.Packed ? null : v[O.inflation]!;
  get3(v, O.posX, s.pos);
  get3(v, O.velX, s.vel);
  get4(v, O.attX, s.att);
  get4(v, O.pilotX, s.pilotAtt);
  s.deployTime = v[O.deployTime]!;
  s.bagOut = v[O.bagOut]!;
  s.deflationL = v[O.deflationL]!;
  s.deflationR = v[O.deflationR]!;
  s.controls.brakeL = v[O.brakeL]!;
  s.controls.brakeR = v[O.brakeR]!;
  s.controls.frontL = v[O.frontL]!;
  s.controls.frontR = v[O.frontR]!;
  s.hands.brakeL = v[O.handBrakeL]!;
  s.hands.brakeR = v[O.handBrakeR]!;
  s.hands.frontL = v[O.handFrontL]!;
  s.hands.frontR = v[O.handFrontR]!;
}

/** The frame as the numbers of each channel, in their own units. */
function frameValues(f: TrackFrame, v: Float64Array, joints: Float64Array, released: Float64Array): void {
  v[B.t] = f.t;
  v[B.phase] = PHASE_CODES[f.phase];
  v[B.deploy] = DEPLOY_CODES[f.deploy];
  v[B.slider] = SLIDER_CODES[f.slider];
  v[B.flags] =
    (f.onRisers ? Flag.OnRisers : 0) |
    (f.reserve ? Flag.Reserve : 0) |
    (f.mainHandle ? Flag.MainHandle : 0) |
    (f.reserveHandle ? Flag.ReserveHandle : 0) |
    (f.landed ? Flag.Landed : 0) |
    (f.inflation === null ? Flag.Packed : 0) |
    (f.hasJoints ? Flag.Joints : 0) |
    (f.hasReleased ? Flag.Released : 0);
  put3(v, B.posX, f.pos);
  put3(v, B.velX, f.vel);
  put4(v, B.attX, f.att);
  put4(v, B.pilotX, f.pilotAtt);
  v[B.deflationL] = f.deflationL;
  v[B.deflationR] = f.deflationR;
  v[B.brakeL] = f.controls.brakeL;
  v[B.brakeR] = f.controls.brakeR;
  v[B.frontL] = f.controls.frontL;
  v[B.frontR] = f.controls.frontR;
  v[B.handBrakeL] = f.hands.brakeL;
  v[B.handBrakeR] = f.hands.brakeR;
  v[B.handFrontL] = f.hands.frontL;
  v[B.handFrontR] = f.hands.frontR;
  v[B.inflation] = f.inflation ?? 0;
  v[B.deployTime] = f.deployTime;
  v[B.bagOut] = f.bagOut;
  v[B.heap] = f.heap;
  const p = f.pose;
  v[B.hipL] = p.hipL;
  v[B.hipR] = p.hipR;
  v[B.kneeL] = p.kneeL;
  v[B.kneeR] = p.kneeR;
  v[B.spread] = p.spread;
  v[B.sway] = p.sway;
  v[B.lean] = p.lean;
  v[B.bow] = p.bow;
  put3(v, B.handLX, p.handL);
  put3(v, B.handRX, p.handR);
  put3(v, B.elbowLX, p.elbowL);
  put3(v, B.elbowRX, p.elbowR);
  v[B.heading] = f.heading;
  v[B.distance] = f.distance;
  v[B.above] = f.above;
  put3(v, B.focusX, f.focus);
  if (f.hasJoints) joints.set(f.joints);
  if (f.hasReleased) {
    const r = f.released;
    put3(released, R.posX, r.pos);
    put3(released, R.velX, r.vel);
    put4(released, R.attX, r.att);
    released[R.crumple] = r.crumple;
    released[R.heap] = r.heap;
    released[R.fallToX] = r.fallTo.x;
    released[R.fallToZ] = r.fallTo.z;
  }
}

/** The frame from the numbers of each channel; `joints` and `released` only read if the flags say so. */
function valuesFrame(v: ArrayLike<number>, joints: ArrayLike<number>, released: ArrayLike<number>, f: TrackFrame): void {
  f.t = v[B.t]!;
  f.phase = PHASES[v[B.phase]!] ?? 'none';
  f.deploy = DEPLOYS[v[B.deploy]!] ?? 'canopy';
  f.slider = SLIDERS[v[B.slider]!] ?? 'open';
  const flags = v[B.flags]!;
  f.onRisers = (flags & Flag.OnRisers) !== 0;
  f.reserve = (flags & Flag.Reserve) !== 0;
  f.mainHandle = (flags & Flag.MainHandle) !== 0;
  f.reserveHandle = (flags & Flag.ReserveHandle) !== 0;
  f.landed = (flags & Flag.Landed) !== 0;
  f.hasJoints = (flags & Flag.Joints) !== 0;
  f.hasReleased = (flags & Flag.Released) !== 0;
  get3(v, B.posX, f.pos);
  get3(v, B.velX, f.vel);
  get4(v, B.attX, f.att);
  get4(v, B.pilotX, f.pilotAtt);
  f.deflationL = v[B.deflationL]!;
  f.deflationR = v[B.deflationR]!;
  f.controls.brakeL = v[B.brakeL]!;
  f.controls.brakeR = v[B.brakeR]!;
  f.controls.frontL = v[B.frontL]!;
  f.controls.frontR = v[B.frontR]!;
  f.hands.brakeL = v[B.handBrakeL]!;
  f.hands.brakeR = v[B.handBrakeR]!;
  f.hands.frontL = v[B.handFrontL]!;
  f.hands.frontR = v[B.handFrontR]!;
  f.inflation = flags & Flag.Packed ? null : v[B.inflation]!;
  f.deployTime = v[B.deployTime]!;
  f.bagOut = v[B.bagOut]!;
  f.heap = v[B.heap]!;
  const p = f.pose;
  p.hipL = v[B.hipL]!;
  p.hipR = v[B.hipR]!;
  p.kneeL = v[B.kneeL]!;
  p.kneeR = v[B.kneeR]!;
  p.spread = v[B.spread]!;
  p.sway = v[B.sway]!;
  p.lean = v[B.lean]!;
  p.bow = v[B.bow]!;
  get3(v, B.handLX, p.handL);
  get3(v, B.handRX, p.handR);
  get3(v, B.elbowLX, p.elbowL);
  get3(v, B.elbowRX, p.elbowR);
  f.heading = v[B.heading]!;
  f.distance = v[B.distance]!;
  f.above = v[B.above]!;
  get3(v, B.focusX, f.focus);
  if (f.hasJoints) for (let i = 0; i < f.joints.length; i++) f.joints[i] = joints[i]!;
  if (f.hasReleased) {
    const r = f.released;
    get3(released, R.posX, r.pos);
    get3(released, R.velX, r.vel);
    get4(released, R.attX, r.att);
    r.crumple = released[R.crumple]!;
    r.heap = released[R.heap]!;
    r.fallTo.x = released[R.fallToX]!;
    r.fallTo.y = 0;
    r.fallTo.z = released[R.fallToZ]!;
  }
}

function put3(out: Float64Array, at: number, p: { x: number; y: number; z: number }): void {
  out[at] = p.x;
  out[at + 1] = p.y;
  out[at + 2] = p.z;
}
function put4(out: Float64Array, at: number, q: Quat): void {
  out[at] = q.x;
  out[at + 1] = q.y;
  out[at + 2] = q.z;
  out[at + 3] = q.w;
}
function get3(v: ArrayLike<number>, at: number, out: { x: number; y: number; z: number }): void {
  out.x = v[at]!;
  out.y = v[at + 1]!;
  out.z = v[at + 2]!;
}
function get4(v: ArrayLike<number>, at: number, out: Quat): void {
  out.x = v[at]!;
  out.y = v[at + 1]!;
  out.z = v[at + 2]!;
  out.w = v[at + 3]!;
}

/** The numbers in whole units, as they are kept. */
function quantize(set: Channels<string>, v: Float64Array, out: Int32Array, at = 0): void {
  for (let c = 0; c < set.count; c++) {
    const x = Math.round(v[c]! * set.scale[c]!);
    out[at + c] = Number.isFinite(x) ? Math.max(-0x7fffffff, Math.min(0x7fffffff, x)) : 0;
  }
}

/** Between two moments, `k` of the way, channel by channel. */
function interpolate(set: Channels<string>, out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, k: number): void {
  for (let c = 0; c < set.count; c++) {
    const x = a[c]!;
    const mode = set.mode[c];
    if (mode === 'step') out[c] = x;
    else if (mode === 'angle') out[c] = x + Math.atan2(Math.sin(b[c]! - x), Math.cos(b[c]! - x)) * k;
    else out[c] = x + (b[c]! - x) * k;
  }
  for (const q of set.quats) {
    const sign = a[q]! * b[q]! + a[q + 1]! * b[q + 1]! + a[q + 2]! * b[q + 2]! + a[q + 3]! * b[q + 3]! < 0 ? -1 : 1;
    let n = 0;
    for (let i = q; i < q + 4; i++) {
      out[i] = a[i]! + (sign * b[i]! - a[i]!) * k;
      n += out[i]! * out[i]!;
    }
    n = Math.sqrt(n) || 1;
    for (let i = q; i < q + 4; i++) out[i] = out[i]! / n;
  }
}

// ------------------------------------------------------------ the track

/**
 * A recorded jump. The samples in whole units, row after row: every one has
 * the base channels; those with the ragdoll or the cut-away main have theirs
 * too, in rows of their own, in the same order.
 */
export interface Track {
  meta: TrackMeta;
  count: number;
  base: Int32Array;
  joints: Int32Array;
  released: Int32Array;
  /** Each other jumper's rows, as `meta.others`: every one names the row of the base it goes with. */
  others: Int32Array[];
}

/** Twenty samples a second; every frame while the body is thrown about. */
export const SAMPLE_EVERY = 1 / 20;
/** Seconds kept of the wait in the door or on the edge. */
export const BEFORE_EXIT = 8;
/** Nothing more is kept after this long, s. */
export const MAX_SECONDS = 30 * 60;

/** Records a jump as it is flown. */
export class TrackRecorder {
  private meta: TrackMeta | null = null;
  private base: Int32Array[] = [];
  private joints: (Int32Array | null)[] = [];
  private released: (Int32Array | null)[] = [];
  /** Each other jumper's rows, and their index in `meta.others` by id. */
  private others: Int32Array[][] = [];
  private readonly otherIndex = new Map<string, number>();
  private clock = 0;
  private last = Number.NEGATIVE_INFINITY;
  private readonly values = new Float64Array(BASE.count);
  private readonly jointValues = new Float64Array(JOINTS.count);
  private readonly releasedValues = new Float64Array(RELEASED.count);
  private readonly otherValues = new Float64Array(OTHER.count);

  /** Recording, since `begin`, until `finish` or `drop`. */
  get recording(): boolean {
    return this.meta !== null;
  }

  /** Seconds since the recording started. */
  get time(): number {
    return this.clock;
  }

  /** A new jump: whatever was kept of the one before goes. */
  begin(setup: Setup, start: Start): void {
    this.drop();
    this.meta = { n: 0, time: 0, setup, start, plane: null, landing: null, events: [] };
  }

  drop(): void {
    this.meta = null;
    this.base = [];
    this.joints = [];
    this.released = [];
    this.others = [];
    this.otherIndex.clear();
    this.clock = 0;
    this.last = Number.NEGATIVE_INFINITY;
  }

  /** Moves the clock on by `dt`, s; true if a sample is wanted now. `dense`: every frame. */
  tick(dt: number, dense: boolean): boolean {
    this.clock += dt;
    if (!this.meta || this.clock > MAX_SECONDS) return false;
    return dense || this.clock - this.last >= SAMPLE_EVERY - 1e-6;
  }

  /** Keeps the frame as it is now, and the others as drawn; its time is the recorder's. */
  push(f: TrackFrame, others: readonly OtherJumper[] = []): void {
    if (!this.meta) return;
    f.t = this.clock;
    this.last = this.clock;
    const sample = this.base.length;
    for (const o of others) {
      let i = this.otherIndex.get(o.id);
      if (i === undefined) {
        i = this.others.length;
        this.otherIndex.set(o.id, i);
        this.others.push([]);
        (this.meta.others ??= []).push({ name: o.name, gear: { ...o.gear } });
      }
      otherValues(o.snap, sample, this.otherValues);
      this.others[i]!.push(quantizeNew(OTHER, this.otherValues));
    }
    frameValues(f, this.values, this.jointValues, this.releasedValues);
    const row = new Int32Array(BASE.count);
    quantize(BASE, this.values, row);
    this.base.push(row);
    this.joints.push(f.hasJoints ? quantizeNew(JOINTS, this.jointValues) : null);
    this.released.push(f.hasReleased ? quantizeNew(RELEASED, this.releasedValues) : null);
    // Waiting in the door: only the last seconds of it are kept.
    if (f.phase === 'plane' || f.phase === 'standing') this.forgetBefore(this.clock - BEFORE_EXIT);
  }

  /** A sound heard now. */
  hear(event: DistributiveOmit<TrackEvent, 't'>): void {
    this.meta?.events.push({ ...event, t: this.clock } as TrackEvent);
  }

  /** The plane: where it is now, and how it goes. */
  setPlane(aircraft: AircraftId, pos: Vec3, vel: Vec3, att: Quat): void {
    if (!this.meta) return;
    this.meta.plane = { aircraft, t: this.clock, pos: [pos.x, pos.y, pos.z], vel: [vel.x, vel.y, vel.z], att: [att.x, att.y, att.z, att.w] };
  }

  /** Down: where the canopy goes down in a heap from, and the way. The first one stays. */
  setLanding(from: Vec3, fallTo: Vec3): void {
    if (this.meta && !this.meta.landing) this.meta.landing = { from: [from.x, from.y, from.z], fallTo: [fallTo.x, fallTo.y, fallTo.z] };
  }

  /** The jump has gone in the logbook under this number, at this time. */
  logged(n: number, time: number): void {
    if (!this.meta) return;
    this.meta.n = n;
    this.meta.time = time;
  }

  /** Whether the jump has gone in the logbook. */
  get isLogged(): boolean {
    return (this.meta?.n ?? 0) > 0;
  }

  /** The end: the track, if the jump went in the logbook and there is anything to see. Recording stops. */
  finish(): Track | null {
    const meta = this.meta;
    const count = this.base.length;
    let track: Track | null = null;
    if (meta && meta.n > 0 && count >= 2) {
      const base = new Int32Array(count * BASE.count);
      this.base.forEach((row, i) => base.set(row, i * BASE.count));
      // Only those seen in what is kept of the jump.
      const kept = (meta.others ?? []).map((m, i) => ({ m, rows: this.others[i] ?? [] })).filter((o) => o.rows.length > 0);
      if (meta.others) meta.others = kept.map((o) => o.m);
      const others = kept.map((o) => concat(o.rows, OTHER.count));
      track = { meta, count, base, joints: concat(this.joints, JOINTS.count), released: concat(this.released, RELEASED.count), others };
    }
    this.drop();
    return track;
  }

  private forgetBefore(t: number): void {
    let n = 0;
    while (n < this.base.length - 1 && this.base[n]![B.t]! / BASE.scale[B.t]! < t) n++;
    if (!n) return;
    this.base.splice(0, n);
    this.joints.splice(0, n);
    this.released.splice(0, n);
    for (const rows of this.others) {
      let gone = 0;
      while (gone < rows.length && rows[gone]![O.sample]! < n) gone++;
      rows.splice(0, gone);
      for (const row of rows) row[O.sample]! -= n;
    }
    if (this.meta) this.meta.events = this.meta.events.filter((e) => e.t >= t);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function quantizeNew(set: Channels<string>, v: Float64Array): Int32Array {
  const row = new Int32Array(set.count);
  quantize(set, v, row);
  return row;
}

function concat(rows: (Int32Array | null)[], width: number): Int32Array {
  const kept = rows.filter((r): r is Int32Array => r !== null);
  const out = new Int32Array(kept.length * width);
  kept.forEach((row, i) => out.set(row, i * width));
  return out;
}

// ------------------------------------------------------------ bytes

const MAGIC = [0x4a, 0x53, 0x54, 0x4b]; // JSTK
/** 2: the others on the jump. 1 is still read, with none. */
const VERSION = 2;

class Writer {
  private bytes = new Uint8Array(1 << 16);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    bigger.set(this.bytes.subarray(0, this.length));
    this.bytes = bigger;
  }

  u8(x: number): void {
    this.room(1);
    this.bytes[this.length++] = x;
  }

  u32(x: number): void {
    this.room(4);
    new DataView(this.bytes.buffer).setUint32(this.length, x, true);
    this.length += 4;
  }

  raw(b: Uint8Array): void {
    this.room(b.length);
    this.bytes.set(b, this.length);
    this.length += b.length;
  }

  /** A signed whole number in as few bytes as it takes: zigzag, then seven bits a byte. */
  varint(x: number): void {
    let z = x >= 0 ? 2 * x : -2 * x - 1;
    this.room(8);
    while (z >= 0x80) {
      this.bytes[this.length++] = (z % 0x80) | 0x80;
      z = Math.floor(z / 0x80);
    }
    this.bytes[this.length++] = z;
  }

  done(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

class Reader {
  at = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    if (this.at >= this.bytes.length) throw new RangeError('short');
    return this.bytes[this.at++]!;
  }

  u32(): number {
    if (this.at + 4 > this.bytes.length) throw new RangeError('short');
    const x = this.view.getUint32(this.at, true);
    this.at += 4;
    return x;
  }

  raw(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new RangeError('short');
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  varint(): number {
    let z = 0;
    let scale = 1;
    for (;;) {
      const b = this.u8();
      z += (b & 0x7f) * scale;
      if (b < 0x80) break;
      scale *= 0x80;
      if (scale > 2 ** 49) throw new RangeError('varint');
    }
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
}

/** Column after column, each value as its change from the row before. */
function writeColumns(w: Writer, rows: Int32Array, width: number): void {
  const count = rows.length / width;
  for (let c = 0; c < width; c++) {
    let before = 0;
    for (let i = 0; i < count; i++) {
      const x = rows[i * width + c]!;
      w.varint(x - before);
      before = x;
    }
  }
}

function readColumns(r: Reader, count: number, width: number): Int32Array {
  const rows = new Int32Array(count * width);
  for (let c = 0; c < width; c++) {
    let x = 0;
    for (let i = 0; i < count; i++) {
      x += r.varint();
      rows[i * width + c] = x;
    }
  }
  return rows;
}

export function encodeTrack(track: Track): Uint8Array {
  const w = new Writer();
  for (const b of MAGIC) w.u8(b);
  w.u8(VERSION);
  const meta = new TextEncoder().encode(JSON.stringify(track.meta));
  w.u32(meta.length);
  w.raw(meta);
  w.u32(track.count);
  w.u32(track.joints.length / JOINTS.count);
  w.u32(track.released.length / RELEASED.count);
  w.u8(BASE.count);
  w.u8(JOINTS.count);
  w.u8(RELEASED.count);
  writeColumns(w, track.base, BASE.count);
  writeColumns(w, track.joints, JOINTS.count);
  writeColumns(w, track.released, RELEASED.count);
  w.u8(OTHER.count);
  w.u32(track.others.length);
  for (const rows of track.others) {
    w.u32(rows.length / OTHER.count);
    writeColumns(w, rows, OTHER.count);
  }
  return w.done();
}

/** Null when it is not a track this version reads. */
export function decodeTrack(bytes: Uint8Array): Track | null {
  try {
    const r = new Reader(bytes);
    for (const b of MAGIC) if (r.u8() !== b) return null;
    const version = r.u8();
    if (version !== 1 && version !== VERSION) return null;
    const meta = JSON.parse(new TextDecoder().decode(r.raw(r.u32()))) as TrackMeta;
    if (typeof meta?.n !== 'number' || !Array.isArray(meta.events) || !meta.setup) return null;
    const count = r.u32();
    const jointRows = r.u32();
    const releasedRows = r.u32();
    if (r.u8() !== BASE.count || r.u8() !== JOINTS.count || r.u8() !== RELEASED.count) return null;
    // Each value takes a byte at least: more rows than bytes left is not a track.
    if ((count + jointRows + releasedRows) > bytes.length - r.at) return null;
    const base = readColumns(r, count, BASE.count);
    const joints = readColumns(r, jointRows, JOINTS.count);
    const released = readColumns(r, releasedRows, RELEASED.count);
    if (count < 2) return null;
    const others: Int32Array[] = [];
    if (version >= 2) {
      if (r.u8() !== OTHER.count) return null;
      const members = r.u32();
      if (members !== (meta.others?.length ?? 0) || members > bytes.length - r.at) return null;
      for (let m = 0; m < members; m++) {
        const rows = r.u32();
        if (rows > bytes.length - r.at) return null;
        others.push(readColumns(r, rows, OTHER.count));
      }
    } else delete meta.others;
    return { meta, count, base, joints, released, others };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ playback

/** Speeds the replay goes through, 1 being real time. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

/** Moments worth jumping to: out of the door, the canopy open, down. */
export interface TrackMarks {
  exit: number | null;
  open: number | null;
  landing: number | null;
}

/** Plays a track back: where it is, how fast, and the jumper as they were there. */
export class TrackPlayer {
  readonly start: number;
  readonly end: number;
  /** Where the replay is, s, on the recording's clock. */
  time: number;
  speed = 1;
  paused = false;
  readonly marks: TrackMarks;
  /** The moment shown, in between two samples. */
  readonly frame = makeTrackFrame();
  /** The samples in their own units. */
  private readonly base: Float32Array;
  private readonly joints: Float32Array;
  private readonly released: Float32Array;
  /** Each sample's row of joints and of the cut-away main, or -1. */
  private readonly jointRow: Int32Array;
  private readonly releasedRow: Int32Array;
  private readonly events: TrackEvent[];
  private eventIndex = 0;
  private readonly mixed = new Float64Array(BASE.count);
  private readonly mixedJoints = new Float64Array(JOINTS.count);
  private readonly mixedReleased = new Float64Array(RELEASED.count);
  /** The others on the jump, as they are at the moment shown. */
  readonly others: OtherShown[];
  /** Each other's samples in their own units, and their row at each sample of the base, or -1. */
  private readonly otherData: { rows: Float32Array; at: Int32Array }[];
  private readonly mixedOther = new Float64Array(OTHER.count);

  constructor(readonly track: Track) {
    const n = track.count;
    this.base = dequantize(BASE, track.base);
    this.joints = dequantize(JOINTS, track.joints);
    this.released = dequantize(RELEASED, track.released);
    this.jointRow = new Int32Array(n);
    this.releasedRow = new Int32Array(n);
    let j = 0;
    let r = 0;
    const jointRows = this.joints.length / JOINTS.count;
    const releasedRows = this.released.length / RELEASED.count;
    for (let i = 0; i < n; i++) {
      const flags = this.at(i, B.flags);
      this.jointRow[i] = flags & Flag.Joints && j < jointRows ? j++ : -1;
      this.releasedRow[i] = flags & Flag.Released && r < releasedRows ? r++ : -1;
    }
    const members = track.meta.others ?? [];
    this.others = members.map((m) => ({ name: m.name, gear: m.gear, shown: false, snap: emptySnapshot() }));
    this.otherData = members.map((_, m) => {
      const rows = dequantize(OTHER, track.others[m] ?? new Int32Array(0));
      const at = new Int32Array(n).fill(-1);
      for (let r = 0; r < rows.length / OTHER.count; r++) {
        const i = rows[r * OTHER.count + O.sample]!;
        if (i >= 0 && i < n) at[i] = r;
      }
      return { rows, at };
    });
    this.start = this.at(0, B.t);
    this.end = this.at(n - 1, B.t);
    this.events = [...track.meta.events].sort((a, b) => a.t - b.t);
    this.marks = this.findMarks();
    this.time = this.start;
    this.seek(this.start);
  }

  get done(): boolean {
    return this.time >= this.end;
  }

  /** Straight to a moment; no sound on the way. */
  seek(t: number): void {
    this.time = Math.max(this.start, Math.min(this.end, t));
    this.eventIndex = 0;
    while (this.eventIndex < this.events.length && this.events[this.eventIndex]!.t <= this.time) this.eventIndex++;
    this.sample();
  }

  /** One step faster (`step` 1) or slower (-1). */
  faster(step: 1 | -1): void {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + step))]!;
  }

  /**
   * Plays on by `dt` seconds of real time. `hear` gets each sound reached
   * and the speed it plays at; none when going too fast to make sense of them.
   */
  advance(dt: number, hear?: (e: TrackEvent, rate: number) => void): void {
    if (this.paused) return;
    this.time = Math.min(this.end, this.time + dt * this.speed);
    while (this.eventIndex < this.events.length && this.events[this.eventIndex]!.t <= this.time) {
      const e = this.events[this.eventIndex++]!;
      if (hear && this.speed <= 2) hear(e, Math.sqrt(this.speed));
    }
    this.sample();
  }

  private at(i: number, c: number): number {
    return this.base[i * BASE.count + c]!;
  }

  /** The sample at or before `t`. */
  private indexAt(t: number): number {
    let lo = 0;
    let hi = this.track.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.at(mid, B.t) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Puts the moment shown at the current time, between the two samples around it. */
  private sample(): void {
    const i = Math.min(this.indexAt(this.time), this.track.count - 2);
    const ta = this.at(i, B.t);
    const tb = this.at(i + 1, B.t);
    const k = tb > ta ? Math.max(0, Math.min(1, (this.time - ta) / (tb - ta))) : 1;
    const row = (data: Float32Array, width: number, r: number) => data.subarray(r * width, (r + 1) * width);
    const a = row(this.base, BASE.count, i);
    const b = row(this.base, BASE.count, i + 1);
    interpolate(BASE, this.mixed, a, b, k);
    const m = this.mixed;
    // Packed: no inflation to go between; another stage: its own clock.
    if ((a[B.flags]! | b[B.flags]!) & Flag.Packed) m[B.inflation] = a[B.inflation]!;
    if (a[B.deploy] !== b[B.deploy]) m[B.deployTime] = a[B.deployTime]!;
    const ja = this.jointRow[i]!;
    const jb = this.jointRow[i + 1]!;
    if (ja >= 0 && jb >= 0) interpolate(JOINTS, this.mixedJoints, row(this.joints, JOINTS.count, ja), row(this.joints, JOINTS.count, jb), k);
    else if (ja >= 0) this.mixedJoints.set(row(this.joints, JOINTS.count, ja));
    const ra = this.releasedRow[i]!;
    const rb = this.releasedRow[i + 1]!;
    if (ra >= 0 && rb >= 0) {
      interpolate(RELEASED, this.mixedReleased, row(this.released, RELEASED.count, ra), row(this.released, RELEASED.count, rb), k);
    } else if (ra >= 0) this.mixedReleased.set(row(this.released, RELEASED.count, ra));
    valuesFrame(m, this.mixedJoints, this.mixedReleased, this.frame);
    // Flags from the sample before; the ragdoll and the cut-away main only where it has them.
    this.frame.hasJoints = ja >= 0;
    this.frame.hasReleased = ra >= 0;
    // The others where they were drawn, between two samples only if drawn at both.
    this.otherData.forEach(({ rows, at }, m) => {
      const o = this.others[m]!;
      const oa = at[i]!;
      const ob = at[i + 1]!;
      o.shown = oa >= 0;
      if (oa < 0) return;
      const ra = row(rows, OTHER.count, oa);
      if (ob >= 0) {
        const rb = row(rows, OTHER.count, ob);
        interpolate(OTHER, this.mixedOther, ra, rb, k);
        if ((ra[O.flags]! | rb[O.flags]!) & OtherFlag.Packed) this.mixedOther[O.inflation] = ra[O.inflation]!;
        if (ra[O.deploy] !== rb[O.deploy]) this.mixedOther[O.deployTime] = ra[O.deployTime]!;
        valuesOther(this.mixedOther, o.snap);
      } else valuesOther(ra, o.snap);
    });
  }

  private findMarks(): TrackMarks {
    const marks: TrackMarks = { exit: null, open: null, landing: null };
    let before = PHASES[this.at(0, B.phase)];
    for (let i = 0; i < this.track.count; i++) {
      const t = this.at(i, B.t);
      const phase = PHASES[this.at(i, B.phase)];
      const flags = this.at(i, B.flags);
      if (marks.exit === null && phase === 'freefall' && (before === 'plane' || before === 'standing')) marks.exit = t;
      if (marks.open === null && phase === 'canopy' && before !== 'canopy') marks.open = t;
      if (marks.landing === null && flags & Flag.Landed) marks.landing = t;
      before = phase;
    }
    return marks;
  }
}

function dequantize(set: Channels<string>, rows: Int32Array): Float32Array {
  const out = new Float32Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = rows[i]! / set.scale[i % set.count]!;
  return out;
}
