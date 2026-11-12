import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_MS, SnapshotBuffer, nlerp } from '../src/net/interp';
import { readHello } from '../src/net/multiplayer';
import { SNAPSHOT_BYTES, decodeSnapshot, emptySnapshot, encodeSnapshot, type Snapshot } from '../src/net/snapshot';
import { quat } from '../src/sim/vec';

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
