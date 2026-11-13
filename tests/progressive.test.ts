// Positions flown progressively, on trial: ↑ ↓ ← → held swing the body round
// little by little, what was a position is a stretch of the way round, and the
// track and the angle are on the way from flat to head down.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { BODY_SHAPES, Freefall, freefallParams, noBodyInputs, type BodyInputs, type BodyPosition, type FlightZone } from '../src/sim/freefall';
import { STANCE_CODES } from '../src/net/snapshot';
import { jumpStance } from '../src/render/jumpPose';
import type { Stance } from '../src/render/posture';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { DEG, rotate, set, vec3 } from '../src/sim/vec';

const POSITIONS: BodyPosition[] = ['belly', 'back', 'sit', 'headDown'];

/** Belly to earth at terminal speed, head to the north, settled; then into a position. */
function flying(progressive: boolean, position: BodyPosition = 'belly'): { body: Freefall; env: Environment } {
  const body = new Freefall(freefallParams(90));
  body.progressive = progressive;
  const env: Environment = { wind: vec3(), airDensity: airDensityAt(1500) };
  set(body.state.vel, 0, -55, 0);
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  fly(body, env, 5);
  body.setPosition(position);
  fly(body, env, 15);
  return { body, env };
}

function fly(body: Freefall, env: Environment, seconds: number, input: Partial<BodyInputs> = {}): void {
  for (let i = 0; i < seconds / SIM_DT; i++) body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
}

/** Holds the arrows until the body is doing this. */
function swingTo(body: Freefall, env: Environment, zone: FlightZone, input: Partial<BodyInputs>, more = 0): number {
  let t = 0;
  while (body.zone !== zone && t < 6) {
    body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    t += SIM_DT;
  }
  fly(body, env, more, input);
  return t;
}

/** ↑ held from flat until the head is this far down, degrees: 60 is well into the track. */
function headLow(body: Freefall, env: Environment, deg: number): void {
  while (-body.aim.y < Math.sin(deg * DEG)) body.step(SIM_DT, { ...noBodyInputs(), flip: 1 }, env);
}

const kmh = (body: Freefall) => {
  const v = body.state.vel;
  return { north: -v.z * 3.6, east: v.x * 3.6, down: -v.y * 3.6, glide: Math.hypot(v.x, v.z) / -v.y };
};

describe('positions flown progressively', () => {
  test('↑ held goes round: flat, track, angle, head down, back angle, back track, back, head-up angle, sit', () => {
    const { body, env } = flying(true);
    const seen: FlightZone[] = [body.zone];
    const stayed: number[] = [0];
    for (let t = 0; t < 3.4; t += SIM_DT) {
      body.step(SIM_DT, { ...noBodyInputs(), flip: 1 }, env);
      if (body.zone !== seen.at(-1)) {
        seen.push(body.zone);
        stayed.push(0);
      }
      stayed[stayed.length - 1]! += SIM_DT;
    }
    expect(seen).toEqual(['belly', 'track', 'angle', 'headDown', 'backAngle', 'backTrack', 'back', 'sitAngle', 'sit']);
    // None of them gone through in a blink.
    for (const [i, s] of stayed.slice(1, -1).entries()) expect(s, seen[i + 1]).toBeGreaterThan(0.12);
    // And ↓ comes back the same way.
    swingTo(body, env, 'belly', { flip: -1 });
    fly(body, env, 10);
    expect(body.position).toBe('belly');
    expect(kmh(body).down).toBeGreaterThan(195);
    expect(kmh(body).down).toBeLessThan(215);
    expect(kmh(body).glide).toBeLessThan(0.02);
  });

  test('a tap is a small step: it does not leave the position', () => {
    const { body, env } = flying(true);
    fly(body, env, 0.1, { flip: 1 });
    expect(body.zone).toBe('belly');
    fly(body, env, 3);
    expect(body.aim.z).toBe(1);
  });

  test('let go in the track, it stays there: a wing going where the head points', () => {
    const { body, env } = flying(true);
    headLow(body, env, 60);
    fly(body, env, 25);
    expect(body.zone).toBe('track');
    expect(body.track).toBeGreaterThan(0.9);
    const v = kmh(body);
    expect(v.glide).toBeGreaterThan(0.85);
    expect(v.north).toBeGreaterThan(130);
    expect(Math.abs(v.east)).toBeLessThan(1);
    expect(v.down).toBeLessThan(175);
  });

  test('steeper, the angle: faster down, less far', () => {
    const { body, env } = flying(true);
    swingTo(body, env, 'angle', { flip: 1 }, 0.1);
    fly(body, env, 25);
    expect(body.zone).toBe('angle');
    const v = kmh(body);
    expect(v.glide).toBeGreaterThan(0.25);
    expect(v.glide).toBeLessThan(0.8);
    expect(v.north).toBeGreaterThan(60);
    expect(v.down).toBeGreaterThan(210);
  });

  test('let go close to a position, the body settles into it and flies as it always did', () => {
    const classic = Object.fromEntries(POSITIONS.map((p) => [p, kmh(flying(false, p).body).down]));
    const { body, env } = flying(true);
    const fallsLike = (position: BodyPosition) => {
      fly(body, env, 15);
      expect(body.position).toBe(position);
      expect(Math.abs(kmh(body).down - classic[position]!), position).toBeLessThan(1);
      expect(kmh(body).glide, position).toBeLessThan(0.01);
      const d = BODY_SHAPES[position].downstream;
      expect(rotate(vec3(), body.state.att, d).y, position).toBeGreaterThan(0.999);
    };
    swingTo(body, env, 'headDown', { flip: 1 });
    fallsLike('headDown');
    swingTo(body, env, 'back', { flip: 1 });
    fallsLike('back');
    swingTo(body, env, 'sit', { flip: 1 });
    fallsLike('sit');
  });

  test('in each position the drive, the slide and the turn go the way they always did', () => {
    for (const p of POSITIONS) {
      for (const input of [{ forward: 1 }, { forward: -1 }, { slide: 1 }, { turn: 1 }] as Partial<BodyInputs>[]) {
        const was = flying(false, p);
        const now = flying(true, p);
        fly(was.body, was.env, input.turn ? 1 : 12, input);
        fly(now.body, now.env, input.turn ? 1 : 12, input);
        const what = `${p} ${JSON.stringify(input)}`;
        const a = was.body.state.vel;
        const b = now.body.state.vel;
        expect(Math.hypot(a.x - b.x, a.z - b.z), what).toBeLessThan(0.6);
        expect(now.body.state.yawRate, what).toBeCloseTo(was.body.state.yawRate, 3);
        expect(now.body.headingDeg(), what).toBeCloseTo(was.body.headingDeg(), 0);
      }
    }
  });

  test('← / → rolls a track onto its side, then onto the back, still going the same way', () => {
    const { body, env } = flying(true);
    headLow(body, env, 60);
    fly(body, env, 20);
    swingTo(body, env, 'sideTrack', { roll: 1 }, 0.3);
    fly(body, env, 20);
    expect(body.zone).toBe('sideTrack');
    const side = kmh(body);
    expect(side.north).toBeGreaterThan(80);
    expect(Math.abs(side.east)).toBeLessThan(15);
    // On edge it is less of a wing: steeper and faster.
    expect(side.down).toBeGreaterThan(220);
    // The right hand went down.
    expect(rotate(vec3(), body.state.att, vec3(1, 0, 0)).y).toBeLessThan(-0.5);
    swingTo(body, env, 'backTrack', { roll: 1 }, 0.5);
    fly(body, env, 25);
    expect(body.zone).toBe('backTrack');
    expect(body.position).toBe('back');
    expect(Math.abs(body.aim.x)).toBeLessThan(1e-6);
    const back = kmh(body);
    expect(back.north).toBeGreaterThan(120);
    expect(back.glide).toBeGreaterThan(0.8);
    // Belly to the sky.
    expect(rotate(vec3(), body.state.att, vec3(0, 0, -1)).y).toBeGreaterThan(0.2);
  });

  test('flat, ← / → rolls slowly onto the back; upright, it is a cartwheel from sitting to head down', () => {
    const flat = flying(true);
    const t = swingTo(flat.body, flat.env, 'back', { roll: -1 });
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(2.5);
    fly(flat.body, flat.env, 10);
    expect(flat.body.position).toBe('back');
    expect(rotate(vec3(), flat.body.state.att, vec3(0, 0, -1)).y).toBeGreaterThan(0.999);

    const up = flying(true, 'sit');
    swingTo(up.body, up.env, 'side', { roll: 1 }, 0.6);
    // Sitting, the head goes over to the right.
    const head = rotate(vec3(), up.body.state.att, vec3(0, 1, 0));
    const right = rotate(vec3(), up.body.state.att, vec3(1, 0, 0));
    expect(right.y).toBeLessThan(-0.5);
    expect(head.y).toBeGreaterThan(0);
    swingTo(up.body, up.env, 'headDown', { roll: 1 });
    fly(up.body, up.env, 10);
    expect(up.body.position).toBe('headDown');
    expect(rotate(vec3(), up.body.state.att, vec3(0, -1, 0)).y).toBeGreaterThan(0.999);
  });

  test('the pilot sets how fast the arrows swing the body', () => {
    const toHeadDown = (sweep: number) => {
      const { body, env } = flying(true);
      body.sweep = sweep;
      return swingTo(body, env, 'headDown', { flip: 1 });
    };
    const usual = toHeadDown(1);
    expect(usual).toBeGreaterThan(0.8);
    expect(usual).toBeLessThan(1.4);
    expect(toHeadDown(0.5)).toBeGreaterThan(1.5 * usual);
    expect(toHeadDown(2)).toBeLessThan(0.7 * usual);
  });

  test('flown the usual way again, the body is in the position it was closest to', () => {
    const { body, env } = flying(true);
    swingTo(body, env, 'headDown', { flip: 1 });
    body.progressive = false;
    fly(body, env, 10);
    expect(body.position).toBe('headDown');
    expect(kmh(body).down).toBeGreaterThan(265);
    body.flip(1);
    fly(body, env, 5);
    expect(body.position).toBe('back');
  });
});

describe('a jump flown progressively', () => {
  function inFreefall(): { jump: Jump; env: Environment; step: (seconds: number, input?: Partial<BodyInputs>) => void } {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(4000) };
    const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, () => 0, () => 0.5);
    jump.body.progressive = true;
    const step = (seconds: number, input: Partial<BodyInputs> = {}) => {
      for (let i = 0; i < seconds / SIM_DT; i++) jump.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    };
    jump.act();
    step(12);
    return { jump, env, step };
  }

  test('the arrows pressed do nothing by themselves: only held', () => {
    const { jump, step } = inFreefall();
    jump.flip(1);
    jump.roll(1);
    step(1);
    expect(jump.body.position).toBe('belly');
    expect(jump.body.maneuvering).toBe(false);
  });

  test('each stretch of the way round is held its own way', () => {
    const { jump, step } = inFreefall();
    const held: Stance[] = [];
    for (let t = 0; t < 3.4 && jump.body.zone !== 'sit'; t += SIM_DT) {
      step(SIM_DT, { flip: 1 });
      const stance = jumpStance(jump);
      if (stance !== held.at(-1)) held.push(stance);
    }
    expect(held).toEqual(['belly', 'track', 'angle', 'headDown', 'backAngle', 'track', 'back', 'sitAngle', 'sit']);
    // Every one of them goes to the others in the room and into the replay.
    for (const stance of held) expect(STANCE_CODES[stance], stance).toBeTypeOf('number');
    expect(new Set(Object.values(STANCE_CODES)).size).toBe(Object.keys(STANCE_CODES).length);
  });

  test('space in a track: back flat first, then the pull, whatever the arrows do', () => {
    const { jump, step } = inFreefall();
    step(0.7, { flip: 1 });
    step(5);
    expect(jump.body.zone).toBe('track');
    jump.act();
    expect(jump.phase).toBe('freefall');
    step(3, { flip: 1 });
    expect(jump.phase).not.toBe('freefall');
  });
});
