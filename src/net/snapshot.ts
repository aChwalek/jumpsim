import type { DeployStage } from '../render/deployment';
import type { Stance } from '../render/posture';
import type { Controls } from '../sim/flightModel';
import type { JumpPhase } from '../sim/jump';
import { quat, vec3, type Quat, type Vec3 } from '../sim/vec';

/** No jump: started under canopy, or landed and waiting. */
export type Phase = JumpPhase | 'none';

/**
 * What the others need to draw a jumper at an instant: where the body and
 * the canopy are, how the body is held, how far the canopy is out. Each
 * player's sim stays their own; only this goes out, 15 times a second.
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
  controls: Controls;
  hands: Controls;
  pos: Vec3;
  vel: Vec3;
  att: Quat;
  pilotAtt: Quat;
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
  controls: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
  hands: { brakeL: 0, brakeR: 0, frontL: 0, frontR: 0 },
  pos: vec3(),
  vel: vec3(),
  att: quat(),
  pilotAtt: quat(),
});

// New phases go at the end: the index is what travels.
const PHASES: readonly Phase[] = ['none', 'plane', 'freefall', 'opening', 'canopy', 'standing'];
const STANCES: readonly Stance[] = ['door', 'belly', 'back', 'sit', 'headDown', 'throw', 'hanging', 'ground', 'cutaway', 'reserve'];
const DEPLOYS: readonly DeployStage[] = ['stowed', 'hand', 'tow', 'bag', 'canopy', 'free'];
const CONTROLS = ['brakeL', 'brakeR', 'frontL', 'frontR'] as const;

const VERSION = 1;
/** Bytes: a header of enums, flags and controls, the time, then 18 floats. */
export const SNAPSHOT_BYTES = 16 + 8 + 18 * 4;

const enum Flag {
  Reserve = 1,
  Cutaway = 2,
  OnRisers = 4,
  MainHandle = 8,
  ReserveHandle = 16,
  Landed = 32,
  Packed = 64,
}

const byte = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 255);

export function encodeSnapshot(s: Snapshot, buffer = new ArrayBuffer(SNAPSHOT_BYTES)): ArrayBuffer {
  const v = new DataView(buffer);
  v.setUint8(0, VERSION);
  v.setUint8(1, PHASES.indexOf(s.phase));
  v.setUint8(2, STANCES.indexOf(s.stance));
  v.setUint8(3, DEPLOYS.indexOf(s.deploy));
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
  v.setFloat64(16, s.t, true);
  let o = 24;
  const f = (x: number) => {
    v.setFloat32(o, x, true);
    o += 4;
  };
  f(s.pos.x), f(s.pos.y), f(s.pos.z);
  f(s.vel.x), f(s.vel.y), f(s.vel.z);
  f(s.att.x), f(s.att.y), f(s.att.z), f(s.att.w);
  f(s.pilotAtt.x), f(s.pilotAtt.y), f(s.pilotAtt.z), f(s.pilotAtt.w);
  f(s.inflation ?? 0), f(s.deployTime), f(s.bagOut);
  f(0);
  return buffer;
}

/** Null when it is not a snapshot this version reads. */
export function decodeSnapshot(buffer: ArrayBuffer, out = emptySnapshot()): Snapshot | null {
  if (buffer.byteLength !== SNAPSHOT_BYTES) return null;
  const v = new DataView(buffer);
  if (v.getUint8(0) !== VERSION) return null;
  const phase = PHASES[v.getUint8(1)];
  const stance = STANCES[v.getUint8(2)];
  const deploy = DEPLOYS[v.getUint8(3)];
  if (phase === undefined || stance === undefined || deploy === undefined) return null;
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
  out.t = v.getFloat64(16, true);
  let o = 24;
  const f = (): number => {
    const x = v.getFloat32(o, true);
    o += 4;
    return Number.isFinite(x) ? x : 0;
  };
  out.pos.x = f(), out.pos.y = f(), out.pos.z = f();
  out.vel.x = f(), out.vel.y = f(), out.vel.z = f();
  out.att.x = f(), out.att.y = f(), out.att.z = f(), out.att.w = f();
  out.pilotAtt.x = f(), out.pilotAtt.y = f(), out.pilotAtt.z = f(), out.pilotAtt.w = f();
  const inflation = f();
  out.inflation = flags & Flag.Packed ? null : inflation;
  out.deployTime = f();
  out.bagOut = f();
  return out;
}

export function copySnapshot(out: Snapshot, s: Snapshot): Snapshot {
  const { controls, hands, pos, vel, att, pilotAtt } = out;
  Object.assign(out, s, { controls, hands, pos, vel, att, pilotAtt });
  Object.assign(controls, s.controls);
  Object.assign(hands, s.hands);
  Object.assign(pos, s.pos);
  Object.assign(vel, s.vel);
  Object.assign(att, s.att);
  Object.assign(pilotAtt, s.pilotAtt);
  return out;
}
