// Freefly: on the back, sitting and head down as well as belly to earth.
// Numbers checked against what freeflyers know: about 200 km/h flat, a little
// more on the back, 250 sitting, 280 head down; a few metres a second of drive
// in every position, and a second or so to go from one position to the next.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { BODY_SHAPES, Freefall, freefallParams, noBodyInputs, stepPosition, type BodyInputs, type BodyPosition } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { rotate, set, vec3 } from '../src/sim/vec';

const POSITIONS: BodyPosition[] = ['belly', 'back', 'sit', 'headDown'];

/** Belly to earth at terminal speed at this height, facing north, then into the position given and settled there. */
function flying(position: BodyPosition, height = 1500, weight = 90): { body: Freefall; env: Environment } {
  const body = new Freefall(freefallParams(weight));
  const env: Environment = { wind: vec3(), airDensity: airDensityAt(height) };
  set(body.state.pos, 0, height, 0);
  set(body.state.vel, 0, -55, 0);
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  body.setPosition(position);
  for (let i = 0; i < 15 / SIM_DT; i++) {
    body.state.pos.y = height;
    body.step(SIM_DT, noBodyInputs(), env);
  }
  return { body, env };
}

/** Where the eyes look (flat) and the right hand, world frame. */
function axes(body: Freefall) {
  const ahead = rotate(vec3(), body.state.att, BODY_SHAPES[body.position].forward);
  const right = rotate(vec3(), body.state.att, vec3(1, 0, 0));
  const flat = Math.hypot(ahead.x, ahead.z);
  const side = Math.hypot(right.x, right.z);
  return { ahead: vec3(ahead.x / flat, 0, ahead.z / flat), right: vec3(right.x / side, 0, right.z / side) };
}

/** Holds an input in a position at a fixed height; speeds along where the eyes looked at the start. */
function hold(position: BodyPosition, input: Partial<BodyInputs>, seconds = 12) {
  const { body, env } = flying(position);
  // Upside down, the right hand is on the left of an upright onlooker.
  const { ahead, right } = axes(body);
  let turned = 0;
  let full = 0;
  for (let i = 0; i < seconds / SIM_DT; i++) {
    body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    body.state.pos.y = 1500;
    turned += body.state.yawRate * SIM_DT;
    if (!full && Math.abs(turned) >= 2 * Math.PI) full = (i + 1) * SIM_DT;
  }
  const v = body.state.vel;
  return {
    forward: v.x * ahead.x + v.z * ahead.z,
    right: v.x * right.x + v.z * right.z,
    fall: -v.y * 3.6,
    fullTurn: full,
    body,
  };
}

describe('the four positions', () => {
  test('each falls at its own speed: flat slowest, head down fastest', () => {
    const kmh = Object.fromEntries(POSITIONS.map((p) => [p, -flying(p, 1000).body.state.vel.y * 3.6]));
    expect(kmh.belly).toBeGreaterThan(190);
    expect(kmh.belly).toBeLessThan(215);
    expect(kmh.back).toBeGreaterThan(kmh.belly! + 5);
    expect(kmh.back).toBeLessThan(230);
    expect(kmh.sit).toBeGreaterThan(235);
    expect(kmh.sit).toBeLessThan(265);
    expect(kmh.headDown).toBeGreaterThan(265);
    expect(kmh.headDown).toBeLessThan(300);
  });

  test('settles into its position: back up, belly up, head up, head down', () => {
    const up = (p: BodyPosition, axis: [number, number, number]) =>
      rotate(vec3(), flying(p).body.state.att, vec3(...axis)).y;
    expect(up('belly', [0, 0, 1])).toBeGreaterThan(0.99);
    expect(up('back', [0, 0, -1])).toBeGreaterThan(0.99);
    expect(up('sit', [0, 1, 0])).toBeGreaterThan(0.99);
    expect(up('headDown', [0, -1, 0])).toBeGreaterThan(0.99);
  });

  test('every position goes up and down: slower spread out, faster tucked in', () => {
    for (const p of POSITIONS) {
      const neutral = hold(p, {}).fall;
      const up = hold(p, { fall: -1 }).fall;
      const down = hold(p, { fall: 1 }).fall;
      expect(neutral / up, p).toBeGreaterThan(1.12);
      expect(neutral / up, p).toBeLessThan(1.25);
      expect(down / neutral, p).toBeGreaterThan(1.12);
      expect(down / neutral, p).toBeLessThan(1.25);
    }
  });

  test('every position goes forward and back where the eyes look, and slides to the right hand', () => {
    for (const p of POSITIONS) {
      const forward = hold(p, { forward: 1 });
      const back = hold(p, { forward: -1 });
      const right = hold(p, { slide: 1 });
      expect(forward.forward, p).toBeGreaterThan(5);
      expect(forward.forward, p).toBeLessThan(11);
      expect(-back.forward, p).toBeGreaterThan(3);
      expect(-back.forward, p).toBeLessThan(8);
      expect(right.right, p).toBeGreaterThan(3);
      expect(right.right, p).toBeLessThan(8);
      expect(Math.abs(forward.right) + Math.abs(right.forward), p).toBeLessThan(0.2);
    }
  });

  test('a turn to the right swings the eyes to the right in every position, upside down too', () => {
    for (const p of POSITIONS) {
      const { body, env } = flying(p);
      const before = axes(body);
      for (let i = 0; i < 0.6 / SIM_DT; i++) body.step(SIM_DT, { ...noBodyInputs(), turn: 1 }, env);
      const after = axes(body).ahead;
      // Towards the right hand of where they looked.
      expect(after.x * before.right.x + after.z * before.right.z, p).toBeGreaterThan(0.25);
      expect(hold(p, { turn: 1 }).fullTurn, p).toBeGreaterThan(2);
      expect(hold(p, { turn: 1 }).fullTurn, p).toBeLessThan(5.5);
    }
  });
});

describe('going from one position to another', () => {
  /** Seconds from one position to within 15 degrees of the next. */
  function swing(from: BodyPosition, to: BodyPosition): number {
    const { body, env } = flying(from);
    body.setPosition(to);
    for (let i = 1; i < 5 / SIM_DT; i++) {
      body.step(SIM_DT, noBodyInputs(), env);
      if (body.offPosition() < (15 * Math.PI) / 180) return i * SIM_DT;
    }
    return Infinity;
  }

  test('a quarter turn takes under a second, a half turn under two', () => {
    for (const [from, to] of [
      ['belly', 'sit'],
      ['belly', 'headDown'],
      ['sit', 'back'],
      ['back', 'headDown'],
      ['headDown', 'belly'],
    ] as const) {
      const t = swing(from, to);
      expect(t, `${from} to ${to}`).toBeGreaterThan(0.4);
      expect(t, `${from} to ${to}`).toBeLessThan(1);
    }
    for (const [from, to] of [
      ['belly', 'back'],
      ['back', 'belly'],
      ['sit', 'headDown'],
      ['headDown', 'sit'],
    ] as const) {
      const t = swing(from, to);
      expect(t, `${from} to ${to}`).toBeGreaterThan(0.8);
      expect(t, `${from} to ${to}`).toBeLessThan(2);
    }
  });

  test('belly to back is a roll about the head, to the right unless asked otherwise', () => {
    for (const roll of [1, -1]) {
      const { body, env } = flying('belly');
      const head = rotate(vec3(), body.state.att, vec3(0, 1, 0));
      body.setPosition('back', roll);
      for (let i = 0; i < 0.3 / SIM_DT; i++) body.step(SIM_DT, noBodyInputs(), env);
      const right = rotate(vec3(), body.state.att, vec3(1, 0, 0));
      const after = rotate(vec3(), body.state.att, vec3(0, 1, 0));
      // The right shoulder drops on a roll to the right; the head stays put.
      expect(Math.sign(right.y)).toBe(-roll);
      expect(after.x * head.x + after.y * head.y + after.z * head.z).toBeGreaterThan(0.95);
    }
  });

  test('sitting to head down tips over the front: the head goes where the face looked', () => {
    const { body, env } = flying('sit');
    const face = rotate(vec3(), body.state.att, vec3(0, 0, -1));
    body.setPosition('headDown');
    for (let i = 0; i < 0.4 / SIM_DT; i++) body.step(SIM_DT, noBodyInputs(), env);
    const head = rotate(vec3(), body.state.att, vec3(0, 1, 0));
    expect(head.x * face.x + head.z * face.z).toBeGreaterThan(0.5);
  });
});

describe('pulling out of freefly', () => {
  /** Out of the door, into a position, and down to 1500 m. */
  function freeflyTo(position: BodyPosition) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(4000) };
    const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, () => 0, () => 0.5);
    const step = () => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, noBodyInputs(), env);
    };
    jump.act();
    jump.fly(position);
    for (let i = 0; i < 120 / SIM_DT && jump.height() > 1500; i++) step();
    return { jump, step };
  }

  test('Space head down brings the body back to belly to earth first, then pulls', () => {
    const { jump, step } = freeflyTo('headDown');
    expect(jump.body.position).toBe('headDown');
    jump.act();
    expect(jump.phase).toBe('freefall');
    expect(jump.body.position).toBe('belly');
    // Positions wait until the pull.
    jump.fly('sit');
    expect(jump.body.position).toBe('belly');
    let t = 0;
    while (jump.phase === 'freefall' && t < 30) {
      step();
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(1.2);
    expect(jump.body.offPosition()).toBeLessThan((25 * Math.PI) / 180);
    expect(jump.log.pullHeight).toBeLessThan(1500);
    expect(jump.log.pullHeight).toBeGreaterThan(1400);
  });

  test('the AAD fires the reserve head down too, and it opens in time', () => {
    const { jump, step } = freeflyTo('headDown');
    for (let i = 0; i < 120 / SIM_DT && jump.phase !== 'canopy' && !jump.impact; i++) step();
    expect(jump.log.aad).toBe(true);
    expect(jump.impact).toBe(false);
    expect(jump.log.openHeight).toBeGreaterThan(40);
  });

  test('out of the door head down: a dive, and a faster fall than flat', () => {
    const { jump } = freeflyTo('headDown');
    const feet = rotate(vec3(), jump.body.state.att, vec3(0, -1, 0));
    expect(feet.y).toBeGreaterThan(0.95);
    expect(jump.log.topSpeed * 3.6).toBeGreaterThan(270);
  });
});

describe('stepPosition', () => {
  test('walks the head up and down from where the body is', () => {
    expect(stepPosition('sit', 'down')).toBe('back');
    expect(stepPosition('back', 'down')).toBe('headDown');
    expect(stepPosition('headDown', 'down')).toBe('headDown');
    expect(stepPosition('headDown', 'up')).toBe('back');
    expect(stepPosition('back', 'up')).toBe('sit');
    expect(stepPosition('sit', 'up')).toBe('sit');
    expect(stepPosition('belly', 'up')).toBe('sit');
    expect(stepPosition('belly', 'down')).toBe('headDown');
  });
});

describe('rolls and half turns', () => {
  function settledIn(position: BodyPosition) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(4000) };
    const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, () => 0, () => 0.5);
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += SIM_DT) {
        env.airDensity = airDensityAt(model.state.pos.y);
        jump.step(SIM_DT, noBodyInputs(), env);
      }
    };
    jump.act();
    jump.fly(position);
    run(15);
    return { jump, run };
  }
  const rightHand = (jump: Jump) => rotate(vec3(), jump.body.state.att, vec3(1, 0, 0));

  test('→ on the belly rolls to the right onto the back', () => {
    const { jump, run } = settledIn('belly');
    jump.roll(1);
    expect(jump.body.position).toBe('back');
    run(0.3);
    expect(rightHand(jump).y).toBeLessThan(-0.8);
    run(2);
    expect(jump.body.offPosition()).toBeLessThan(0.2);
  });

  test('←← on the belly is a barrel roll', () => {
    const { jump, run } = settledIn('belly');
    const heading = jump.body.headingDeg();
    jump.roll(-1);
    jump.roll(-1);
    expect(jump.body.position).toBe('belly');
    run(0.6);
    // Halfway: on the back.
    expect(jump.body.offPosition()).toBeGreaterThan(2.5);
    run(2);
    expect(jump.body.maneuvering).toBe(false);
    expect(jump.body.offPosition()).toBeLessThan(0.2);
    expect(Math.abs(((jump.body.headingDeg() - heading + 540) % 360) - 180)).toBeLessThan(20);
  });

  test('← / → upright turns round to face the other way, still upright', () => {
    for (const position of ['sit', 'headDown'] as const) {
      const { jump, run } = settledIn(position);
      const heading = jump.body.headingDeg();
      jump.roll(1);
      run(2);
      expect(jump.body.position).toBe(position);
      expect(jump.body.offPosition()).toBeLessThan(0.3);
      expect(Math.abs(((jump.body.headingDeg() - heading + 540) % 360) - 180)).toBeGreaterThan(160);
    }
  });
});
