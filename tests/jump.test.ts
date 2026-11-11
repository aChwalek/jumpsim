// The jump from the plane: freefall belly to earth, the opening, the stowed
// brakes. Numbers checked against what skydivers know: about 200 km/h belly
// to earth, a minute from 4000 m to 1000 m, around 200 m and 3 g to open.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, neutralControls, type Environment } from '../src/sim/flightModel';
import { Freefall, freefallParams, noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { AAD_HEIGHT, Jump } from '../src/sim/jump';
import { MAIN_OPENING, Opening, STOWED_BRAKE } from '../src/sim/opening';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { rotate, set, vec3 } from '../src/sim/vec';

const flat = () => 0;
const calm = (): Environment => ({ wind: vec3(), airDensity: airDensityAt(4000) });

/** At the given height, belly to earth, at terminal speed, facing north. */
function bellyAt(height: number, weight = 90): { body: Freefall; env: Environment } {
  const body = new Freefall(freefallParams(weight));
  const env = calm();
  set(body.state.pos, 0, height, 0);
  set(body.state.vel, 0, -55, 0);
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  // Settle at this height.
  for (let i = 0; i < 6 / SIM_DT; i++) {
    body.state.pos.y = height;
    env.airDensity = airDensityAt(height);
    body.step(SIM_DT, noBodyInputs(), env);
  }
  return { body, env };
}

/** Holds an input at a fixed height and returns the speeds reached. */
function hold(input: Partial<BodyInputs>, seconds = 12) {
  const { body, env } = bellyAt(2000);
  let turned = 0;
  let full = 0;
  for (let i = 0; i < seconds / SIM_DT; i++) {
    body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    body.state.pos.y = 2000;
    turned += body.state.yawRate * SIM_DT;
    if (!full && Math.abs(turned) >= 2 * Math.PI) full = (i + 1) * SIM_DT;
  }
  const v = body.state.vel;
  return { forward: -v.z, right: v.x, fall: -v.y, fullTurn: full };
}

function jumpFromPlane(pullAt: number | null) {
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  const env = calm();
  const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, flat, () => 0.5);
  const step = () => {
    env.airDensity = airDensityAt(model.state.pos.y);
    jump.step(SIM_DT, noBodyInputs(), env);
  };
  for (let i = 0; i < 2 / SIM_DT; i++) step();
  const doorX = model.state.pos.x;
  jump.act();
  let hill = 0;
  let to1000 = 0;
  while (jump.phase === 'freefall' && !jump.impact) {
    step();
    const v = model.state.vel;
    if (!hill && Math.hypot(v.x, v.z) < Math.tan((15 * Math.PI) / 180) * -v.y) hill = jump.time;
    if (!to1000 && jump.height() < 1000) to1000 = jump.time;
    if (pullAt !== null && jump.height() < pullAt) jump.act();
  }
  const throwForward = doorX - model.state.pos.x;
  while (jump.phase === 'opening' && !jump.impact) step();
  return { jump, model, env, hill, to1000, throwForward };
}

describe('freefall belly to earth', () => {
  test('falls at about 200 km/h low down and faster up high', () => {
    const low = bellyAt(1000).body.state.vel.y * -3.6;
    const high = bellyAt(3500).body.state.vel.y * -3.6;
    expect(low).toBeGreaterThan(190);
    expect(low).toBeLessThan(215);
    expect(high).toBeGreaterThan(low + 15);
    expect(high).toBeLessThan(245);
  });

  test('heavier jumpers fall a little faster', () => {
    const light = -bellyAt(1500, 60).body.state.vel.y;
    const heavy = -bellyAt(1500, 120).body.state.vel.y;
    expect(heavy / light).toBeGreaterThan(1.05);
    expect(heavy / light).toBeLessThan(1.2);
  });

  test('moves forward, back and sideways at a few metres a second', () => {
    const forward = hold({ forward: 1 });
    const back = hold({ forward: -1 });
    const right = hold({ slide: 1 });
    expect(forward.forward).toBeGreaterThan(5);
    expect(forward.forward).toBeLessThan(10);
    expect(-back.forward).toBeGreaterThan(3);
    expect(-back.forward).toBeLessThan(7);
    expect(right.right).toBeGreaterThan(3);
    expect(right.right).toBeLessThan(7);
    expect(Math.abs(forward.right) + Math.abs(right.forward)).toBeLessThan(0.1);
  });

  test('turns a 360 in about four seconds, either way', () => {
    const right = hold({ turn: 1 });
    const left = hold({ turn: -1 });
    expect(right.fullTurn).toBeGreaterThan(3);
    expect(right.fullTurn).toBeLessThan(5.5);
    expect(left.fullTurn).toBeCloseTo(right.fullTurn, 1);
  });

  test('a turn to the right turns the head to the right', () => {
    const { body, env } = bellyAt(2000);
    for (let i = 0; i < 1 / SIM_DT; i++) body.step(SIM_DT, { ...noBodyInputs(), turn: 1 }, env);
    const head = rotate(vec3(), body.state.att, vec3(0, 1, 0));
    // Facing north at first: a right turn swings the head east.
    expect(head.x).toBeGreaterThan(0.3);
  });
});

describe('out of the plane', () => {
  test('lies on the air chest first, then faces the ground once the fall builds up', () => {
    const { hill, to1000, throwForward } = jumpFromPlane(null);
    expect(hill).toBeGreaterThan(6);
    expect(hill).toBeLessThan(14);
    // About a minute to 1000 m from 4000 m.
    expect(to1000).toBeGreaterThan(48);
    expect(to1000).toBeLessThan(62);
    // Carried on along the run by the plane's speed for a few hundred metres.
    expect(throwForward).toBeGreaterThan(250);
    expect(throwForward).toBeLessThan(500);
  });

  test('a pull at 1000 m flies about 200 m lower, after a firm but comfortable opening', () => {
    const { jump } = jumpFromPlane(1000);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.pullHeight).toBeCloseTo(1000, -1);
    const lost = jump.log.pullHeight! - jump.log.openHeight;
    expect(lost).toBeGreaterThan(150);
    expect(lost).toBeLessThan(250);
    expect(jump.log.openingLoad).toBeGreaterThan(2.5);
    expect(jump.log.openingLoad).toBeLessThan(4);
    expect(jump.log.aad).toBe(false);
  });

  test('without a pull the AAD fires the reserve low, and it is open before the ground', () => {
    const { jump } = jumpFromPlane(null);
    expect(jump.log.aad).toBe(true);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.openHeight).toBeLessThan(AAD_HEIGHT);
    expect(jump.log.openHeight).toBeGreaterThan(60);
  });
});

describe('the opening', () => {
  test('stretches the lines after about two seconds and flies after five', () => {
    const { body, env } = bellyAt(1000);
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const opening = new Opening(body, model, MAIN_OPENING);
    let stretched = 0;
    let t = 0;
    while (!opening.done && t < 10) {
      opening.step(SIM_DT, env);
      t += SIM_DT;
      if (!stretched && opening.stage === 'inflation') stretched = t;
    }
    expect(stretched).toBeGreaterThan(1.5);
    expect(stretched).toBeLessThan(2.3);
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(6.5);
  });

  test('ends in steady flight on stowed brakes, which the toggles free one side at a time', () => {
    const { jump, model, env } = jumpFromPlane(1200);
    expect(jump.stowedL && jump.stowedR).toBe(true);
    // Hands up: the canopy still flies on its stowed brakes, straight on.
    const c = neutralControls();
    const flown = { ...c };
    let worst = 0;
    const startVel = { ...model.state.vel };
    for (let i = 0; i < 5 / SIM_DT; i++) {
      Object.assign(flown, c);
      jump.holdStows(flown);
      model.step(SIM_DT, flown, env);
      const v = model.state.vel;
      worst = Math.max(worst, Math.hypot(v.x - startVel.x, v.y - startVel.y, v.z - startVel.z));
    }
    expect(flown.brakeL).toBe(STOWED_BRAKE);
    expect(worst).toBeLessThan(1);
    // A toggle pulled past its stow frees that side only.
    jump.holdStows({ ...c, brakeL: STOWED_BRAKE + 0.1 });
    expect(jump.stowedL).toBe(false);
    expect(jump.stowedR).toBe(true);
    const after = { ...c };
    jump.holdStows(after);
    expect(after.brakeL).toBe(0);
    expect(after.brakeR).toBe(STOWED_BRAKE);
  });
});
