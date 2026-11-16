import { blendPose } from '../render/body';
import type { Quat } from '../sim/vec';
import { copySnapshot, emptySnapshot, type Snapshot } from './snapshot';

/**
 * How far behind the sender the others draw a jumper, ms: two snapshots'
 * worth at 15 a second, so that one lost or late still leaves two to go between.
 */
export const INTERP_DELAY_MS = 120;
/** Past the last snapshot, the jumper carries on along their velocity this long, ms, then stops. */
const MAX_EXTRAPOLATION_MS = 250;
/** How fast the clock offset creeps back up, ms per ms: lets it follow a sender's clock drifting. */
const OFFSET_CREEP = 0.0005;
const KEEP = 32;
/**
 * A snapshot this much older than the last one is not late: the sender's
 * clock was set back. Kept as it is, the jumper would wait for it to catch up.
 */
const SET_BACK_MS = 1000;

/**
 * The last snapshots of one jumper, in the order they were taken, and where
 * the jumper is between them a little in the past.
 */
export class SnapshotBuffer {
  private readonly items: Snapshot[] = [];
  /**
   * Local clock minus the sender's, ms, from the quickest snapshot to come
   * through: the sender's clock never needs to agree with ours.
   */
  private offset = Number.POSITIVE_INFINITY;
  private heardAt = Number.NEGATIVE_INFINITY;

  get size(): number {
    return this.items.length;
  }

  /** When the last snapshot came in, local ms. */
  get lastHeard(): number {
    return this.heardAt;
  }

  /** When the newest snapshot was true, the sender's clock, ms; NaN while nothing has come. */
  get newest(): number {
    return this.items[this.items.length - 1]?.t ?? Number.NaN;
  }

  push(s: Snapshot, localNow: number): void {
    const newest = this.items[this.items.length - 1];
    if (newest && s.t < newest.t - SET_BACK_MS) {
      this.items.length = 0;
      this.offset = Number.POSITIVE_INFINITY;
    }
    if (Number.isFinite(this.offset)) this.offset += OFFSET_CREEP * Math.max(0, localNow - this.heardAt);
    this.offset = Math.min(this.offset, localNow - s.t);
    this.heardAt = localNow;
    const items = this.items;
    // Out of order (unordered channel): slot it in. A duplicate is dropped.
    let i = items.length;
    while (i > 0 && (items[i - 1] as Snapshot).t > s.t) i--;
    if (i > 0 && (items[i - 1] as Snapshot).t === s.t) return;
    items.splice(i, 0, copySnapshot(emptySnapshot(), s));
    if (items.length > KEEP) items.shift();
  }

  /**
   * The jumper as they were INTERP_DELAY_MS ago, into `out`; never later than
   * `notAfter` (the sender's clock, ms). False while nothing has come.
   */
  sample(localNow: number, out: Snapshot, notAfter = Number.POSITIVE_INFINITY): boolean {
    const items = this.items;
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return false;
    const target = Math.min(localNow - this.offset - INTERP_DELAY_MS, notAfter);
    if (target <= first.t) {
      copySnapshot(out, first);
      return true;
    }
    if (target >= last.t) {
      copySnapshot(out, last);
      const ahead = Math.min(target - last.t, MAX_EXTRAPOLATION_MS) / 1000;
      out.pos.x += out.vel.x * ahead;
      out.pos.y += out.vel.y * ahead;
      out.pos.z += out.vel.z * ahead;
      // Their plane with them: where they are in it stays put.
      if (out.hasPlane) {
        out.plane.pos.x += out.vel.x * ahead;
        out.plane.pos.y += out.vel.y * ahead;
        out.plane.pos.z += out.vel.z * ahead;
      }
      out.t = last.t + ahead * 1000;
      return true;
    }
    let i = 1;
    while ((items[i] as Snapshot).t < target) i++;
    const a = items[i - 1] as Snapshot;
    const b = items[i] as Snapshot;
    lerpSnapshot(out, a, b, (target - a.t) / (b.t - a.t));
    // What is before `a` will not be needed again.
    if (i > 1) items.splice(0, i - 1);
    return true;
  }
}

/**
 * Between two snapshots: what changes in steps (phase, stance, flags, the
 * slider, where the heap started) is taken from the first; the ragdoll, the
 * cut-away main and the plane go between the two only if both have them.
 */
export function lerpSnapshot(out: Snapshot, a: Snapshot, b: Snapshot, k: number): Snapshot {
  copySnapshot(out, a);
  const mix = (x: number, y: number) => x + (y - x) * k;
  out.t = mix(a.t, b.t);
  out.pos.x = mix(a.pos.x, b.pos.x);
  out.pos.y = mix(a.pos.y, b.pos.y);
  out.pos.z = mix(a.pos.z, b.pos.z);
  out.vel.x = mix(a.vel.x, b.vel.x);
  out.vel.y = mix(a.vel.y, b.vel.y);
  out.vel.z = mix(a.vel.z, b.vel.z);
  nlerp(out.att, a.att, b.att, k);
  nlerp(out.pilotAtt, a.pilotAtt, b.pilotAtt, k);
  for (const key of ['brakeL', 'brakeR', 'frontL', 'frontR'] as const) {
    out.controls[key] = mix(a.controls[key], b.controls[key]);
    out.hands[key] = mix(a.hands[key], b.hands[key]);
  }
  out.twist = mix(a.twist, b.twist);
  if (a.posed && b.posed) blendPose(out.pose, b.pose, k);
  out.heap = mix(a.heap, b.heap);
  out.gather = mix(a.gather, b.gather);
  if (a.hasJoints && b.hasJoints) for (let i = 0; i < out.joints.length; i++) out.joints[i] = mix(a.joints[i]!, b.joints[i]!);
  if (a.hasReleased && b.hasReleased) {
    const [r, ra, rb] = [out.released, a.released, b.released];
    r.pos.x = mix(ra.pos.x, rb.pos.x);
    r.pos.y = mix(ra.pos.y, rb.pos.y);
    r.pos.z = mix(ra.pos.z, rb.pos.z);
    r.vel.x = mix(ra.vel.x, rb.vel.x);
    r.vel.y = mix(ra.vel.y, rb.vel.y);
    r.vel.z = mix(ra.vel.z, rb.vel.z);
    nlerp(r.att, ra.att, rb.att, k);
    r.crumple = mix(ra.crumple, rb.crumple);
    r.heap = mix(ra.heap, rb.heap);
  }
  if (a.hasPlane && b.hasPlane) {
    const [p, pa, pb] = [out.plane.pos, a.plane.pos, b.plane.pos];
    p.x = mix(pa.x, pb.x);
    p.y = mix(pa.y, pb.y);
    p.z = mix(pa.z, pb.z);
  }
  if (a.inflation !== null && b.inflation !== null) out.inflation = mix(a.inflation, b.inflation);
  if (a.deploy === b.deploy) out.deployTime = mix(a.deployTime, b.deployTime);
  out.bagOut = mix(a.bagOut, b.bagOut);
  out.deflationL = mix(a.deflationL, b.deflationL);
  out.deflationR = mix(a.deflationR, b.deflationR);
  return out;
}

/** Between two attitudes, the short way round. Close enough to a slerp 70 ms apart. */
export function nlerp(out: Quat, a: Quat, b: Quat, k: number): Quat {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = a.x + (sign * b.x - a.x) * k;
  const y = a.y + (sign * b.y - a.y) * k;
  const z = a.z + (sign * b.z - a.z) * k;
  const w = a.w + (sign * b.w - a.w) * k;
  const n = Math.hypot(x, y, z, w) || 1;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  out.w = w / n;
  return out;
}
