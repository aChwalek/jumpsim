import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_MS, SnapshotBuffer, lerpSnapshot, nlerp } from '../src/net/interp';
import { readHello } from '../src/net/multiplayer';
import { planeGap, type OurPlane } from '../src/net/remote';
import { SNAPSHOT_BYTES, copySnapshot, decodeSnapshot, emptySnapshot, encodeSnapshot, type Snapshot } from '../src/net/snapshot';
import { quat, vec3 } from '../src/sim/vec';

const at = (t: number, x: number): Snapshot => {
  const s = emptySnapshot();
  s.t = t;
  s.pos.x = x;
  s.vel.x = 10;
  return s;
};

describe('snapshot', () => {
  it('comes back as it went', () => {
    const s = emptySnapshot();
    Object.assign(s, { t: 123456.789, phase: 'opening', stance: 'throw', deploy: 'bag', reserve: true, cutaway: true });
    Object.assign(s, { onRisers: false, mainHandle: false, landed: true, inflation: 0.4, deployTime: 1.25, bagOut: 0.5 });
    Object.assign(s.pos, { x: 1234.5, y: 3999.25, z: -812.75 });
    Object.assign(s.vel, { x: 1, y: -52, z: 3 });
    Object.assign(s.pilotAtt, { x: 0.5, y: 0.5, z: 0.5, w: 0.5 });
    s.controls.brakeL = 1;
    s.hands.frontR = 0.5;
    s.deflationL = 0.8;
    s.deflationR = 1;
    const buffer = encodeSnapshot(s);
    expect(buffer.byteLength).toBe(SNAPSHOT_BYTES);
    const back = decodeSnapshot(buffer);
    expect(back).not.toBeNull();
    const b = back as Snapshot;
    expect(b.t).toBe(s.t);
    expect([b.phase, b.stance, b.deploy]).toEqual(['opening', 'throw', 'bag']);
    expect([b.reserve, b.cutaway, b.onRisers, b.mainHandle, b.reserveHandle, b.landed]).toEqual([true, true, false, false, true, true]);
    expect(b.pos).toEqual(s.pos);
    expect(b.vel).toEqual(s.vel);
    expect(b.pilotAtt).toEqual(s.pilotAtt);
    expect(b.inflation).toBeCloseTo(0.4, 6);
    expect(b.controls.brakeL).toBe(1);
    expect(b.hands.frontR).toBeCloseTo(0.5, 2);
    expect(b.deflationL).toBeCloseTo(0.8, 2);
    expect(b.deflationR).toBe(1);
  });

  it('carries the body as drawn, the slider, the twists and the heap', () => {
    const s = emptySnapshot();
    Object.assign(s, { slider: 'collapsed', twist: -7.25, posed: true, heap: 0.6, walker: true, gather: 0.3 });
    Object.assign(s.heapFrom, { x: 812.5, y: 3.25, z: -41 });
    Object.assign(s.fallTo, { x: 0.6, y: 0, z: -0.8 });
    const p = s.pose;
    Object.assign(p, { hipL: 1.8, hipR: -0.35, kneeL: 2.4, kneeR: 0.05, spread: 0.3, sway: -0.2, lean: 0.1, bow: 0.35 });
    p.handL.set(-0.5, 0.05, 0.25);
    p.handR.set(0.17, -0.5, -0.3);
    p.elbowL.set(-1, 0, 0.6);
    p.elbowR.set(1, 0.2, 0.6);
    const buffer = encodeSnapshot(s);
    expect(buffer.byteLength).toBe(SNAPSHOT_BYTES);
    const b = decodeSnapshot(buffer)!;
    expect([b.slider, b.posed, b.walker]).toEqual(['collapsed', true, true]);
    expect(b.twist).toBeCloseTo(-7.25, 5);
    expect(b.heap).toBeCloseTo(0.6, 2);
    expect(b.gather).toBeCloseTo(0.3, 2);
    expect(b.heapFrom).toEqual(s.heapFrom);
    expect(b.fallTo.x).toBeCloseTo(0.6, 6);
    expect(b.fallTo.z).toBeCloseTo(-0.8, 6);
    for (const key of ['hipL', 'hipR', 'kneeL', 'kneeR', 'spread', 'sway', 'lean', 'bow'] as const) expect(b.pose[key]).toBeCloseTo(p[key], 3);
    for (const key of ['handL', 'handR', 'elbowL', 'elbowR'] as const) {
      expect(b.pose[key].distanceTo(p[key])).toBeLessThan(1e-3);
    }
    expect([b.hasJoints, b.hasReleased]).toEqual([false, false]);
  });

  it('carries the body thrown about by a crash and the main cut away, only while there are some', () => {
    const s = emptySnapshot();
    Object.assign(s.pos, { x: 1000, y: 12, z: -300 });
    s.hasJoints = true;
    for (let i = 0; i < s.joints.length; i += 3) s.joints.set([1000 + i * 0.01, 12 - i * 0.02, -300 + 0.5], i);
    s.hasReleased = true;
    const r = s.released;
    Object.assign(r.pos, { x: 1100, y: 640, z: -250 });
    Object.assign(r.vel, { x: 2, y: -9, z: 1 });
    Object.assign(r.att, { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 });
    Object.assign(r, { crumple: 0.7, heap: 0.2 });
    Object.assign(r.fallTo, { x: -1, y: 0, z: 0 });
    const buffer = encodeSnapshot(s);
    expect(buffer.byteLength).toBeGreaterThan(SNAPSHOT_BYTES);
    // Into one that had neither: both come.
    const b = decodeSnapshot(buffer, emptySnapshot())!;
    expect([b.hasJoints, b.hasReleased]).toEqual([true, true]);
    for (let i = 0; i < s.joints.length; i++) expect(Math.abs(b.joints[i]! - s.joints[i]!)).toBeLessThanOrEqual(0.0006);
    expect(b.released.pos).toEqual(r.pos);
    expect(b.released.vel).toEqual(r.vel);
    expect(b.released.att.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(b.released.crumple).toBeCloseTo(0.7, 2);
    expect(b.released.heap).toBeCloseTo(0.2, 2);
    expect(b.released.fallTo.x).toBeCloseTo(-1, 4);
    // Gone again: the packet shrinks back, and a snapshot reused forgets them.
    s.hasJoints = s.hasReleased = false;
    const after = encodeSnapshot(s);
    expect(after.byteLength).toBe(SNAPSHOT_BYTES);
    expect([decodeSnapshot(after, b)!.hasJoints, b.hasReleased]).toEqual([false, false]);
  });

  it('still reads a sender of the first version, drawn from their stance', () => {
    const s = emptySnapshot();
    Object.assign(s, { posed: true, slider: 'stowed', heap: 0.5, twist: 3 });
    Object.assign(s.pos, { x: 5, y: 900, z: 7 });
    s.stance = 'headDown';
    const v1 = encodeSnapshot(s).slice(0, 96);
    new DataView(v1).setUint8(0, 1);
    new Uint8Array(v1).fill(0, 13, 16);
    const b = decodeSnapshot(v1, s)!;
    expect(b).not.toBeNull();
    expect([b.stance, b.posed, b.slider, b.heap, b.twist, b.hasJoints, b.hasReleased]).toEqual(['headDown', false, 'open', 0, 0, false, false]);
    expect(b.pos).toEqual({ x: 5, y: 900, z: 7 });
  });

  it('copies all of it, and goes between two of them', () => {
    const a = emptySnapshot();
    const b = emptySnapshot();
    for (const s of [a, b]) Object.assign(s, { posed: true, hasJoints: true, hasReleased: true });
    Object.assign(b, { twist: 2, heap: 1, gather: 0.5 });
    b.pose.hipL = 1;
    b.pose.handL.set(0, 0, 1);
    b.joints.fill(2);
    Object.assign(b.released.pos, { x: 10, y: 20, z: 30 });
    b.released.crumple = 1;
    const copy = copySnapshot(emptySnapshot(), b);
    b.pose.hipL = 9;
    b.joints[0] = 9;
    b.released.pos.x = 9;
    expect([copy.pose.hipL, copy.joints[0], copy.released.pos.x]).toEqual([1, 2, 10]);
    const out = lerpSnapshot(emptySnapshot(), a, copy, 0.5);
    expect([out.twist, out.heap, out.gather, out.pose.hipL, out.pose.handL.z, out.joints[3]]).toEqual([1, 0.5, 0.25, 0.5, 0.5, 1]);
    expect([out.released.pos.x, out.released.crumple]).toEqual([5, 0.5]);
    expect(a.pose.hipL).toBe(0);
    // A crash in only one of the two: the first one's, not halfway to nothing.
    const crashed = copySnapshot(emptySnapshot(), copy);
    const before = emptySnapshot();
    Object.assign(before, { posed: true, hasJoints: false });
    expect(lerpSnapshot(emptySnapshot(), crashed, before, 0.5).joints[0]).toBe(2);
  });

  it('carries the plane they are in only while in it', () => {
    const s = emptySnapshot();
    Object.assign(s, { phase: 'plane', hasPlane: true, slider: 'stowed' });
    Object.assign(s.plane.pos, { x: -4123.5, y: 4012.25, z: 2250.75 });
    Object.assign(s.plane, { headingDeg: 271.3, aircraft: 'c130' });
    const buffer = encodeSnapshot(s);
    expect(buffer.byteLength).toBe(SNAPSHOT_BYTES + 15);
    const b = decodeSnapshot(buffer)!;
    expect([b.hasPlane, b.plane.aircraft, b.slider]).toEqual([true, 'c130', 'stowed']);
    expect(b.plane.pos).toEqual(s.plane.pos);
    expect(b.plane.headingDeg).toBeCloseTo(271.3, 6);
    // Copied whole, and between two snapshots, the plane goes along.
    const copy = copySnapshot(emptySnapshot(), b);
    b.plane.pos.x = 0;
    expect(copy.plane.pos.x).toBe(-4123.5);
    const later = copySnapshot(emptySnapshot(), copy);
    later.plane.pos.x += 10;
    expect(lerpSnapshot(emptySnapshot(), copy, later, 0.5).plane.pos.x).toBeCloseTo(-4118.5, 6);
    // Out of it: the packet shrinks back.
    s.hasPlane = false;
    expect(encodeSnapshot(s).byteLength).toBe(SNAPSHOT_BYTES);
    expect(decodeSnapshot(encodeSnapshot(s), copy)!.hasPlane).toBe(false);
  });

  it('keeps a packed canopy packed', () => {
    const s = emptySnapshot();
    s.inflation = null;
    expect(decodeSnapshot(encodeSnapshot(s))?.inflation).toBeNull();
  });

  it('turns away what it cannot read', () => {
    expect(decodeSnapshot(new ArrayBuffer(10))).toBeNull();
    const buffer = encodeSnapshot(emptySnapshot());
    new DataView(buffer).setUint8(0, 99);
    expect(decodeSnapshot(buffer)).toBeNull();
    const bad = encodeSnapshot(emptySnapshot());
    new DataView(bad).setUint8(2, 200);
    expect(decodeSnapshot(bad)).toBeNull();
  });
});

describe('snapshot buffer', () => {
  // The sender's clock runs 5 s behind ours, and the network takes 30 ms.
  const local = (senderT: number) => senderT + 5000 + 30;

  it('draws the jumper a little in the past, between two snapshots', () => {
    const b = new SnapshotBuffer();
    for (let t = 0; t <= 1000; t += 100) b.push(at(t, t / 10), local(t));
    const out = emptySnapshot();
    // At sender time 1000 the jumper is at x = 100; drawn INTERP_DELAY_MS before.
    expect(b.sample(local(1000), out)).toBe(true);
    expect(out.pos.x).toBeCloseTo((1000 - INTERP_DELAY_MS) / 10, 6);
  });

  it('puts snapshots that arrive out of order back in order', () => {
    const b = new SnapshotBuffer();
    for (const t of [0, 200, 100, 400, 300, 300]) b.push(at(t, t / 10), local(t) + (t === 100 ? 150 : 0));
    expect(b.size).toBe(5);
    const out = emptySnapshot();
    b.sample(local(250 + INTERP_DELAY_MS), out);
    expect(out.pos.x).toBeCloseTo(25, 6);
  });

  it('carries their plane on with them past the last snapshot: where they are in it stays put', () => {
    const buffer = new SnapshotBuffer();
    const s = at(0, 100);
    s.hasPlane = true;
    s.plane.pos.x = 90;
    buffer.push(s, 1000);
    const out = emptySnapshot();
    buffer.sample(1000 + INTERP_DELAY_MS + 100, out);
    expect(out.pos.x).toBeCloseTo(101, 6);
    expect(out.pos.x - out.plane.pos.x).toBeCloseTo(10, 6);
  });

  it('carries on along the velocity for a while when snapshots stop, then holds', () => {
    const b = new SnapshotBuffer();
    b.push(at(0, 0), local(0));
    b.push(at(100, 1), local(100));
    const out = emptySnapshot();
    b.sample(local(100 + INTERP_DELAY_MS + 100), out);
    expect(out.pos.x).toBeCloseTo(1 + 10 * 0.1, 6);
    b.sample(local(100 + INTERP_DELAY_MS + 5000), out);
    expect(out.pos.x).toBeCloseTo(1 + 10 * 0.25, 6);
  });

  it('has nothing to draw before anything came', () => {
    expect(new SnapshotBuffer().sample(0, emptySnapshot())).toBe(false);
  });
});

describe('their plane and ours', () => {
  const ours: OurPlane = { pos: vec3(1000, 4000, -500), headingDeg: 270, type: { id: 'c130' } };
  const theirs = (x: number, y = 4000, headingDeg = 270, aircraft: 'c130' | 'pc6' = 'c130') => ({ pos: vec3(x, y, -500), headingDeg, aircraft });

  it('are the same load a moment apart: the gap from theirs to ours', () => {
    expect(planeGap(ours, theirs(1030), vec3())).toEqual({ x: -30, y: 0, z: 0 });
    // Headings either side of north are near each other.
    const north = { ...ours, headingDeg: 359.5 };
    expect(planeGap(north, theirs(1000, 4000, 0.5), vec3())).not.toBeNull();
  });

  it('are not when another aircraft, another height or another run, or the next load', () => {
    expect(planeGap(ours, theirs(1000, 4000, 270, 'pc6'), vec3())).toBeNull();
    expect(planeGap(ours, theirs(1000, 3500), vec3())).toBeNull();
    expect(planeGap(ours, theirs(1000, 4000, 90), vec3())).toBeNull();
    // 30 s behind at jump run speed.
    expect(planeGap(ours, theirs(1000 + 30 * 60), vec3())).toBeNull();
  });
});

describe('nlerp', () => {
  it('goes the short way round', () => {
    const a = quat(0, 0, 0, 1);
    // The same attitude, written the other way.
    const b = quat(0, 0, 0, -1);
    expect(nlerp(quat(), a, b, 0.5)).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('hello', () => {
  const gear = { kind: 'classic', canopyAreaFt2: 171, exitWeightKg: 500, color: 'red', rsl: true };

  it('snaps what it is told to a rig that exists', () => {
    const h = readHello({ type: 'hello', dz: 'pujaut', gear });
    expect(h?.gear.canopyAreaFt2).toBe(170);
    expect(h?.gear.exitWeightKg).toBeLessThan(500);
  });

  it('turns away a canopy or a colour it does not know', () => {
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, kind: 'wingsuit' } })).toBeNull();
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, color: 'toString' } })).toBeNull();
    expect(readHello('hello')).toBeNull();
  });

  it('keeps the helmet and jumpsuit colours it knows, and the old ones from an older version or unknown ones', () => {
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, helmetColor: 'red', suitColor: 'yellow' } })?.gear).toMatchObject({ helmetColor: 'red', suitColor: 'yellow' });
    expect(readHello({ type: 'hello', dz: 'pujaut', gear })?.gear).toMatchObject({ helmetColor: 'white', suitColor: 'navy' });
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, helmetColor: 'constructor', suitColor: 7 } })?.gear).toMatchObject({ helmetColor: 'white', suitColor: 'navy' });
  });

  it('keeps the glow sticks colour it knows, and green from an older version or an unknown one', () => {
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, glowColor: 'blue' } })?.gear.glowColor).toBe('blue');
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, glowColor: 'plaid' } })?.gear.glowColor).toBe('green');
  });

  it('shares independent outfit colours and optional visor eyes with peers', () => {
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, pantsColor: 'purple', shoesColor: 'orange', face: true } })?.gear).toMatchObject({
      pantsColor: 'purple', shoesColor: 'orange', face: true,
    });
  });

  it('shares helmet type, visor, face and cloth motifs with peers', () => {
    const custom = { helmetKind: 'open', visorRaised: true, goggles: false, skinColor: 'brown', pattern: 'stripes', accentColor: 'red' };
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, ...custom } })?.gear).toMatchObject(custom);
  });

  it('keeps a smoke it knows, and has none from an older version or an unknown one', () => {
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, smoke: 'green' } })?.gear.smoke).toBe('green');
    expect(readHello({ type: 'hello', dz: 'pujaut', gear })?.gear.smoke).toBe('none');
    expect(readHello({ type: 'hello', dz: 'pujaut', gear: { ...gear, smoke: 'plaid' } })?.gear.smoke).toBe('none');
  });
});

describe('snapshot codes', () => {
  it('carries every stance, phase and stage there is', async () => {
    const stances = [
      ...(['door', 'doorHigh', 'step', 'inside'] as const).flatMap((d) => [d, `${d}Right` as const]),
      ...(['belly', 'back', 'sit', 'headDown', 'track', 'throw', 'hanging', 'ground', 'cutaway', 'reserve'] as const),
    ];
    const phases = ['none', 'plane', 'freefall', 'opening', 'canopy'] as const;
    const deploys = ['stowed', 'hand', 'tow', 'bag', 'canopy', 'free'] as const;
    for (const stance of stances) {
      for (const phase of phases) {
        for (const deploy of deploys) {
          const s = emptySnapshot();
          Object.assign(s, { stance, phase, deploy });
          const back = decodeSnapshot(encodeSnapshot(s));
          expect([back?.stance, back?.phase, back?.deploy]).toEqual([stance, phase, deploy]);
        }
      }
    }
  });
});
