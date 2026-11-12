// A botched landing, played out by the body itself: fifteen joints held
// together by their bones, thrown at the ground with the speed the pilot had,
// and left to tumble, bounce and flop until they come to rest.
//
// Verlet particles with distance constraints (Jakobsen's method): each joint
// is a point, each bone keeps two of them apart, the trunk is braced into a
// block. The knees only bend one way, until they break.

import { vec3, type Vec3 } from './vec';

export const JOINTS = [
  'head',
  'neck',
  'pelvis',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'handL',
  'handR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'footL',
  'footR',
] as const;
export type Joint = (typeof JOINTS)[number];
export const J: Record<Joint, number> = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<Joint, number>;
export const JOINT_COUNT = JOINTS.length;

/** Radius of each joint against the ground, m. */
const RADIUS: Record<Joint, number> = {
  head: 0.12,
  neck: 0.1,
  pelvis: 0.11,
  shoulderL: 0.08,
  shoulderR: 0.08,
  elbowL: 0.05,
  elbowR: 0.05,
  handL: 0.045,
  handR: 0.045,
  hipL: 0.09,
  hipR: 0.09,
  kneeL: 0.065,
  kneeR: 0.065,
  footL: 0.06,
  footR: 0.06,
};

/** What a body part is, as far as hurting it goes. */
export type Part = 'head' | 'trunk' | 'arm' | 'leg';
export const PART: Record<Joint, Part> = {
  head: 'head',
  neck: 'trunk',
  pelvis: 'trunk',
  shoulderL: 'trunk',
  shoulderR: 'trunk',
  elbowL: 'arm',
  elbowR: 'arm',
  handL: 'arm',
  handR: 'arm',
  hipL: 'trunk',
  hipR: 'trunk',
  kneeL: 'leg',
  kneeR: 'leg',
  footL: 'leg',
  footR: 'leg',
};

/** A joint hitting the ground. */
export interface Hit {
  /** Seconds since the ragdoll started. */
  time: number;
  joint: Joint;
  /** Speed into the ground, m/s. */
  speed: number;
  /** A bone went with it. */
  broke: boolean;
}

interface Link {
  a: number;
  b: number;
  min: number;
  max: number;
}

const GRAVITY = 9.81;
const STEP = 1 / 240;
const ITERATIONS = 8;
/** Bounce off the ground, and the most it ever gives back, m/s. */
const RESTITUTION = 0.25;
const MAX_BOUNCE = 3.5;
/** Grip of the grass: share of the sliding speed kept at each step in contact. */
const GRIP = 0.9;
/** The air, and a little give in the joints, per step. */
const DAMPING = 0.9985;
/** Speed into the ground from which a hit is heard, m/s, and a joint is heard again, s. */
const HEARD_FROM = 1.2;
const HEARD_AGAIN = 0.12;
/** Speed into the ground that breaks a limb, m/s. */
const BREAKS_AT = 6.5;
/** Average speed under which the body is at rest, m/s, and for how long, s. */
const STILL = 0.12;
const STILL_FOR = 0.8;
/** It stops being simulated after this long anyway, s. */
const GIVE_UP = 9;

const sub = (out: Vec3, a: Vec3, b: Vec3): Vec3 => {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
};
const len = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);

export class Ragdoll {
  readonly pos: Vec3[];
  private readonly prev: Vec3[];
  private readonly radius: number[];
  private readonly links: Link[] = [];
  /** The ground hits so far, oldest first. */
  readonly hits: Hit[] = [];
  /** Limbs broken so far: a broken knee bends either way. */
  readonly broken = new Set<'kneeL' | 'kneeR' | 'elbowL' | 'elbowR'>();
  time = 0;
  /** Come to rest: nothing moves any more. */
  settled = false;

  private readonly lastHeard: number[];
  private left = 0;
  private still = 0;
  private readonly t1 = vec3();
  private readonly t2 = vec3();
  private readonly t3 = vec3();
  private readonly t4 = vec3();

  /**
   * `pos`: where each joint is at the start, world frame, in the order of
   * JOINTS; `vel`: how fast each goes, m/s; `groundAt`: height of the ground.
   */
  constructor(
    pos: Vec3[],
    vel: Vec3[],
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    this.pos = pos.map((p) => vec3(p.x, p.y, p.z));
    this.radius = JOINTS.map((n) => RADIUS[n]);
    // Nothing starts in the ground: what is in it comes up out of it, without
    // being thrown up by the correction.
    let lift = 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = this.pos[i]!;
      lift = Math.max(lift, this.groundAt(p.x, p.z) + this.radius[i]! - p.y);
    }
    for (const p of this.pos) p.y += lift;
    this.prev = this.pos.map((p, i) => {
      const v = vel[i]!;
      return vec3(p.x - v.x * STEP, p.y - v.y * STEP, p.z - v.z * STEP);
    });
    this.lastHeard = JOINTS.map(() => -1);

    const rigid = (a: Joint, b: Joint) => this.link(a, b, 1, 1);
    // The trunk, a block: neck, shoulders, pelvis and hips all braced together.
    const trunk: Joint[] = ['neck', 'shoulderL', 'shoulderR', 'pelvis', 'hipL', 'hipR'];
    for (let i = 0; i < trunk.length; i++) for (let k = i + 1; k < trunk.length; k++) rigid(trunk[i]!, trunk[k]!);
    // The head nods and turns on the neck, but does not go into the chest.
    rigid('head', 'neck');
    this.link('head', 'shoulderL', 0.8, 1.15);
    this.link('head', 'shoulderR', 0.8, 1.15);
    this.link('head', 'pelvis', 0.9, 1.05);
    // Arms and legs: bones of fixed length, elbows and knees that fold so far.
    for (const s of ['L', 'R'] as const) {
      rigid(`shoulder${s}`, `elbow${s}`);
      rigid(`elbow${s}`, `hand${s}`);
      this.link(`shoulder${s}`, `hand${s}`, 0.3, 1);
      rigid(`hip${s}`, `knee${s}`);
      rigid(`knee${s}`, `foot${s}`);
      this.link(`hip${s}`, `foot${s}`, 0.35, 1);
      // The thigh comes up to the chest, not through it.
      this.link(`knee${s}`, 'neck', 0.45, 10);
      this.link(`knee${s}`, `shoulder${s}`, 0.4, 10);
    }
  }

  private link(a: Joint, b: Joint, minShare: number, maxShare: number): void {
    const d = len(sub(this.t1, this.pos[J[a]]!, this.pos[J[b]]!));
    this.links.push({ a: J[a], b: J[b], min: d * minShare, max: d * maxShare });
  }

  /** Moves the body on by `dt` seconds. */
  update(dt: number): void {
    if (this.settled) return;
    this.left += dt;
    while (this.left >= STEP) {
      this.left -= STEP;
      this.step();
    }
  }

  /** Where the joints are going, world frame, m/s. */
  velocity(out: Vec3, i: number): Vec3 {
    sub(out, this.pos[i]!, this.prev[i]!);
    out.x /= STEP;
    out.y /= STEP;
    out.z /= STEP;
    return out;
  }

  private step(): void {
    this.time += STEP;
    const g = GRAVITY * STEP * STEP;
    let moving = 0;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = this.pos[i]!;
      const q = this.prev[i]!;
      const vx = (p.x - q.x) * DAMPING;
      const vy = (p.y - q.y) * DAMPING;
      const vz = (p.z - q.z) * DAMPING;
      q.x = p.x;
      q.y = p.y;
      q.z = p.z;
      p.x += vx;
      p.y += vy - g;
      p.z += vz;
      moving += Math.hypot(vx, vy, vz) / STEP;
    }
    for (let k = 0; k < ITERATIONS; k++) {
      for (const l of this.links) this.solve(l);
      this.bendKnees();
      this.collide(k === 0);
    }
    if (moving / JOINT_COUNT < STILL) this.still += STEP;
    else this.still = 0;
    if (this.still >= STILL_FOR || this.time >= GIVE_UP) this.settled = true;
  }

  private solve(l: Link): void {
    const a = this.pos[l.a]!;
    const b = this.pos[l.b]!;
    const d = sub(this.t1, b, a);
    const length = len(d);
    if (length < 1e-6) return;
    const target = length < l.min ? l.min : length > l.max ? l.max : length;
    if (target === length) return;
    const k = (0.5 * (length - target)) / length;
    a.x += d.x * k;
    a.y += d.y * k;
    a.z += d.z * k;
    b.x -= d.x * k;
    b.y -= d.y * k;
    b.z -= d.z * k;
  }

  /**
   * A knee is in front of the line from hip to foot, the way the belly faces,
   * or on it: one bent backwards is folded back the right way. A broken one
   * goes where it is thrown.
   */
  private bendKnees(): void {
    const up = sub(this.t2, this.pos[J.neck]!, this.pos[J.pelvis]!);
    const right = sub(this.t3, this.pos[J.shoulderR]!, this.pos[J.shoulderL]!);
    // The belly faces up x right.
    const front = this.t4;
    front.x = up.y * right.z - up.z * right.y;
    front.y = up.z * right.x - up.x * right.z;
    front.z = up.x * right.y - up.y * right.x;
    const n = len(front);
    if (n < 1e-6) return;
    front.x /= n;
    front.y /= n;
    front.z /= n;
    for (const s of ['L', 'R'] as const) {
      if (this.broken.has(`knee${s}`)) continue;
      const hip = this.pos[J[`hip${s}`]]!;
      const foot = this.pos[J[`foot${s}`]]!;
      const knee = this.pos[J[`knee${s}`]]!;
      const along = sub(this.t1, foot, hip);
      const l2 = along.x * along.x + along.y * along.y + along.z * along.z;
      if (l2 < 1e-6) continue;
      const t = ((knee.x - hip.x) * along.x + (knee.y - hip.y) * along.y + (knee.z - hip.z) * along.z) / l2;
      // Off the hip-foot line, and how far of that is towards the front.
      const ox = knee.x - (hip.x + along.x * t);
      const oy = knee.y - (hip.y + along.y * t);
      const oz = knee.z - (hip.z + along.z * t);
      // The front, square to the leg.
      const fa = (front.x * along.x + front.y * along.y + front.z * along.z) / l2;
      const fx = front.x - along.x * fa;
      const fy = front.y - along.y * fa;
      const fz = front.z - along.z * fa;
      const forward = ox * fx + oy * fy + oz * fz;
      if (forward >= 0) continue;
      const f2 = fx * fx + fy * fy + fz * fz;
      if (f2 < 1e-6) continue;
      const k = (-2 * forward) / f2;
      knee.x += fx * k;
      knee.y += fy * k;
      knee.z += fz * k;
    }
  }

  private collide(first: boolean): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      const p = this.pos[i]!;
      const q = this.prev[i]!;
      const floor = this.groundAt(p.x, p.z) + this.radius[i]!;
      if (p.y >= floor) continue;
      if (first) {
        // Speed into the ground, before it is taken away.
        const into = (q.y - p.y) / STEP;
        this.hit(i, into);
        // Back up, a little; and the grass holds what slides along it.
        const bounce = Math.min(MAX_BOUNCE, into * RESTITUTION) * STEP;
        p.y = floor;
        q.y = floor - bounce;
        q.x = p.x - (p.x - q.x) * GRIP;
        q.z = p.z - (p.z - q.z) * GRIP;
      } else {
        p.y = floor;
        if (q.y > p.y) q.y = p.y;
      }
    }
  }

  private hit(i: number, speed: number): void {
    if (speed < HEARD_FROM || this.time - this.lastHeard[i]! < HEARD_AGAIN) return;
    this.lastHeard[i] = this.time;
    const joint = JOINTS[i]!;
    let broke = false;
    if (speed >= BREAKS_AT) {
      const limb =
        joint === 'footL' || joint === 'kneeL' ? 'kneeL'
        : joint === 'footR' || joint === 'kneeR' ? 'kneeR'
        : joint === 'handL' || joint === 'elbowL' ? 'elbowL'
        : joint === 'handR' || joint === 'elbowR' ? 'elbowR'
        : null;
      if (limb && !this.broken.has(limb)) {
        this.broken.add(limb);
        broke = true;
      }
    }
    this.hits.push({ time: this.time, joint, speed, broke });
  }
}
