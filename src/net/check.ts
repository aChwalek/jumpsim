import { vec3, type Vec3 } from '../sim/vec';

/**
 * Checking that everyone sees the same thing: now and then each player tells
 * the others where, at a moment of the room's clock, they drew them. Each
 * compares that with where they really were at that moment, and with where
 * they drew the teller then. Shown with `?net` in the address, and sent with
 * the reports of how the picture runs.
 */

/** Kept this long, ms: what the others say comes a moment late. */
const KEEP_MS = 3000;
/** Faster than this, m/s (and a few metres more), it is not a move but a new start: what was kept goes. */
const TELEPORT_SPEED = 150;

/** Where something was over the last few seconds, by the room's clock: where it was at a moment, between two. */
export class TimeTrack {
  private readonly t: number[] = [];
  private readonly p: number[] = [];

  push(t: number, x: number, y: number, z: number): void {
    const n = this.t.length;
    if (n > 0 && t <= this.t[n - 1]!) return;
    if (n > 0) {
      const p = this.p;
      const moved = Math.hypot(x - p[3 * n - 3]!, y - p[3 * n - 2]!, z - p[3 * n - 1]!);
      if (moved > 5 + (TELEPORT_SPEED * (t - this.t[n - 1]!)) / 1000) this.clear();
    }
    this.t.push(t);
    this.p.push(x, y, z);
    let old = 0;
    while (old < this.t.length - 2 && this.t[old]! < t - KEEP_MS) old++;
    if (old > 64) {
      this.t.splice(0, old);
      this.p.splice(0, 3 * old);
    }
  }

  /** Where it was at `t`, into `out`; null if not kept then. */
  at(t: number, out: Vec3): Vec3 | null {
    const ts = this.t;
    const n = ts.length;
    if (n === 0 || t < ts[0]! || t > ts[n - 1]!) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const k = hi === lo ? 0 : (t - ts[lo]!) / (ts[hi]! - ts[lo]!);
    const p = this.p;
    out.x = p[3 * lo]! + (p[3 * hi]! - p[3 * lo]!) * k;
    out.y = p[3 * lo + 1]! + (p[3 * hi + 1]! - p[3 * lo + 1]!) * k;
    out.z = p[3 * lo + 2]! + (p[3 * hi + 2]! - p[3 * lo + 2]!) * k;
    return out;
  }

  clear(): void {
    this.t.length = 0;
    this.p.length = 0;
  }

  /** The last moment kept, or -Infinity. */
  get newest(): number {
    return this.t[this.t.length - 1] ?? Number.NEGATIVE_INFINITY;
  }
}

/** What a player tells another: at `at` (room clock, ms) they were at `self`, and drew the other at `seen`. */
export interface Seen {
  type: 'seen';
  at: number;
  self: [number, number, number];
  seen: [number, number, number];
}

export function readSeen(m: unknown): Seen | null {
  if (typeof m !== 'object' || m === null) return null;
  const s = m as Partial<Seen>;
  const point = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (s.type !== 'seen' || typeof s.at !== 'number' || !Number.isFinite(s.at) || !point(s.self) || !point(s.seen)) return null;
  return { type: 'seen', at: s.at, self: s.self, seen: s.seen };
}

/**
 * How far off they draw us, m: where they drew us against where we were then.
 * And how far apart the two views are, m: where they see us from them, and
 * where we see them from us, should be the same way round. A clock off on one
 * side moves both views alike: it shows in the first, not in the second.
 */
export function compareSeen(told: Seen, us: Vec3, them: Vec3 | null): { off: number; apart: number | null } {
  const [sx, sy, sz] = told.seen;
  const off = vec3(sx - us.x, sy - us.y, sz - us.z);
  if (!them) return { off: Math.hypot(off.x, off.y, off.z), apart: null };
  const [tx, ty, tz] = told.self;
  return {
    off: Math.hypot(off.x, off.y, off.z),
    apart: Math.hypot(off.x + them.x - tx, off.y + them.y - ty, off.z + them.z - tz),
  };
}

/**
 * Two clocks compared directly, peer to peer: one asks with the time on its
 * own (`a`), the other answers with the time on its (`b`), the answer is back
 * at `back` on the first. Both are the room's clock as each reckons it: how
 * far apart they reckon it, ms, the second's minus the first's. Off by no more
 * than half the trip, which between two players is short.
 */
export interface Tick {
  type: 'tick';
  a: number;
}
export interface Tock {
  type: 'tock';
  a: number;
  b: number;
}

export function readTick(m: unknown): Tick | Tock | null {
  if (typeof m !== 'object' || m === null) return null;
  const r = m as Record<string, unknown>;
  const n = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (r.type === 'tick' && n(r.a)) return { type: 'tick', a: r.a };
  if (r.type === 'tock' && n(r.a) && n(r.b)) return { type: 'tock', a: r.a, b: r.b };
  return null;
}

export const clockApart = (tock: Tock, back: number): { trip: number; apart: number } => ({ trip: back - tock.a, apart: tock.b - (tock.a + back) / 2 });

/** Middle and worst of what was measured. */
export function spread(xs: readonly number[]): { mid: number; worst: number } {
  if (xs.length === 0) return { mid: 0, worst: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  return { mid: sorted[Math.floor(sorted.length / 2)]!, worst: sorted[sorted.length - 1]! };
}
