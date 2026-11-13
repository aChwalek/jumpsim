// Bodies meeting in the air: a push from a gentle contact, a limp tumble from
// a hard one, the dark from a harder one still.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import type { Environment } from '../src/sim/flightModel';
import { Freefall, freefallParams, noBodyInputs } from '../src/sim/freefall';
import { BODY_RADIUS, COLD_FROM, DARK_FROM, DIM_FROM, LONGEST_STUN, STUN_FROM, blowAt, contact, newContact, rebound, tumbleAxis } from '../src/sim/midair';
import { SIM_DT } from '../src/sim/telemetry';
import { dot, rotate, set, vec3 } from '../src/sim/vec';

describe('contact', () => {
  test('none out of reach', () => {
    expect(contact(newContact(), vec3(0, 0, 0), vec3(), vec3(1, 0, 0), vec3())).toBeNull();
  });

  test('normal from them to us, depth, and closing speed', () => {
    const c = contact(newContact(), vec3(0.5, 0, 0), vec3(-2, -50, 0), vec3(0, 0, 0), vec3(3, -50, 0))!;
    expect(c.normal).toEqual(vec3(1, 0, 0));
    expect(c.shift.x).toBeCloseTo(2 * BODY_RADIUS - 0.5);
    expect(c.closing).toBeCloseTo(5);
  });

  test('at speed, one that went right through the other between two frames is caught where they met', () => {
    // 40 m/s past each other: 4 m in a tenth of a second, from one side to the other.
    const c = contact(newContact(), vec3(-2, 0, 0), vec3(-40, -50, 0), vec3(0, 0, 0), vec3(0, -50, 0), 0.1)!;
    expect(c.normal.x).toBeCloseTo(1);
    expect(c.closing).toBeCloseTo(40);
    // Back to the side we came from, touching.
    expect(-2 + c.shift.x).toBeCloseTo(2 * BODY_RADIUS);
    // Passing wide of it is no contact, however fast.
    expect(contact(newContact(), vec3(-2, 1, 0), vec3(-40, 0, 0), vec3(), vec3(), 0.1)).toBeNull();
    // Nor is having gone by before the frame began.
    expect(contact(newContact(), vec3(-6, 0, 0), vec3(-40, 0, 0), vec3(), vec3(), 0.1)).toBeNull();
  });

  test('going apart: closing is negative, and nothing is given back', () => {
    const c = contact(newContact(), vec3(0.5, 0, 0), vec3(2, 0, 0), vec3(), vec3())!;
    expect(c.closing).toBeLessThan(0);
    expect(rebound(vec3(), c, 0.5)).toEqual(vec3(0, 0, 0));
  });

  test('two alike go apart after the blow; one that does not give way sends us all the way back', () => {
    const c = contact(newContact(), vec3(0.5, 0, 0), vec3(-4, 0, 0), vec3(), vec3())!;
    const dv = rebound(vec3(), c, 0.5);
    // Ours and, mirrored, theirs.
    expect(-4 + dv.x - -dv.x).toBeGreaterThan(0);
    expect(-4 + rebound(vec3(), c, 1).x).toBeGreaterThan(0);
  });

  test('the tumble is about an axis across the blow', () => {
    const us = vec3(0, -50, 0);
    const them = vec3(6, -70, 0);
    const c = contact(newContact(), vec3(0, 0, 0), us, vec3(-0.2, 0.5, 0), them)!;
    const axis = tumbleAxis(vec3(), c, us, them);
    expect(Math.hypot(axis.x, axis.y, axis.z)).toBeCloseTo(1);
    expect(dot(axis, c.normal)).toBeCloseTo(0);
  });
});

describe('blow', () => {
  test('gentle: a push and no more', () => {
    expect(blowAt(STUN_FROM - 0.1)).toEqual({ stun: 0, spin: 0, dark: 0, cold: false });
  });

  test('the harder, the longer limp, the darker', () => {
    let last = blowAt(STUN_FROM);
    expect(last.stun).toBeGreaterThan(0);
    expect(last.dark).toBe(0);
    for (let v = STUN_FROM + 1; v <= 40; v++) {
      const b = blowAt(v);
      expect(b.stun).toBeGreaterThanOrEqual(last.stun);
      expect(b.dark).toBeGreaterThanOrEqual(last.dark);
      expect(b.stun).toBeLessThanOrEqual(LONGEST_STUN);
      last = b;
    }
    expect(blowAt(DIM_FROM).dark).toBeGreaterThan(0);
    expect(blowAt(DIM_FROM).dark).toBeLessThan(1);
    expect(blowAt(DARK_FROM).dark).toBe(1);
    expect(blowAt(DARK_FROM).cold).toBe(false);
    expect(blowAt(COLD_FROM).cold).toBe(true);
  });
});

describe('tumble', () => {
  const settled = () => {
    const body = new Freefall(freefallParams(90));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(1500) };
    set(body.state.vel, 0, -55, 0);
    const a = -Math.PI / 4;
    Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
    for (let i = 0; i < 10 / SIM_DT; i++) body.step(SIM_DT, noBodyInputs(), env);
    return { body, env };
  };
  /** How far the belly is from facing the ground, rad. */
  const off = (body: Freefall) => Math.acos(Math.min(1, -rotate(vec3(), body.state.att, vec3(0, 0, -1)).y));

  test('knocked, the body turns over, ignores what it is asked, then comes back belly to earth', () => {
    const { body, env } = settled();
    expect(off(body)).toBeLessThan(0.1);
    body.knock(vec3(1, 0, 0), 6, 3);
    expect(body.stunned).toBe(3);
    let most = 0;
    const turning = { ...noBodyInputs(), turn: 1 };
    for (let i = 0; i < 2 / SIM_DT; i++) {
      body.step(SIM_DT, turning, env);
      most = Math.max(most, off(body));
    }
    expect(most).toBeGreaterThan(1.5);
    expect(body.state.yawRate).toBeCloseTo(0);
    for (let i = 0; i < 4 / SIM_DT; i++) body.step(SIM_DT, noBodyInputs(), env);
    expect(body.stunned).toBe(0);
    expect(off(body)).toBeLessThan(0.1);
  });

  test('a lighter blow does not cut a tumble short', () => {
    const { body } = settled();
    body.knock(vec3(1, 0, 0), 6, 5);
    body.knock(vec3(0, 0, 1), 2, 1);
    expect(body.stunned).toBe(5);
  });
});
