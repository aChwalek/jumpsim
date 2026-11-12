// BASE off a 300 m tower: the run-up on the roof, the exit, a short delay,
// the opening, and what goes wrong close to the wall.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump, type JumpOptions } from '../src/sim/jump';
import { RUN_SPEED, RunUp } from '../src/sim/runUp';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { createTowerZone, TOWER_HEIGHT } from '../src/world/tower';

const HEIGHT = 300;
/** A tower 30 m by 40 m, its north edge 25 m ahead of the start. */
const ground = () => 0;
const solid = (x: number, z: number) => (Math.abs(x) <= 15 && Math.abs(z) <= 20 ? HEIGHT : 0);
const ledge = { kind: 'ledge', x: 0, z: 5, headingDeg: 0 } as const;
const run: BodyInputs = { ...noBodyInputs(), forward: 1 };

function baseJump(options: JumpOptions = {}) {
  const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
  const env: Environment = { wind: vec3(), airDensity: airDensityAt(HEIGHT) };
  const reserve = deriveRig(reserveConfig(90));
  const jump = new Jump(model, ledge, env, ground, () => 0.5, { solidAt: solid, container: 'base', reserve, ...options });
  const step = (input = noBodyInputs()) => {
    env.airDensity = airDensityAt(model.state.pos.y);
    jump.step(SIM_DT, input, env);
  };
  /** Steps until the condition holds, or the time runs out; returns the time taken. */
  const until = (done: () => boolean, seconds: number, input = noBodyInputs()) => {
    let t = 0;
    while (!done() && t < seconds) {
      step(input);
      t += SIM_DT;
    }
    return t;
  };
  return { model, jump, step, until };
}

describe('the run-up', () => {
  test('flat out in about two seconds, along the heading', () => {
    const r = new RunUp(() => 0, 0, 0, 90);
    for (let i = 0; i < 2.5 / SIM_DT; i++) r.step(SIM_DT, run);
    expect(r.forward).toBeCloseTo(RUN_SPEED, 1);
    expect(r.vel.x).toBeCloseTo(RUN_SPEED, 1);
    expect(Math.abs(r.vel.z)).toBeLessThan(0.01);
    expect(r.x).toBeGreaterThan(9);
  });

  test('runs backwards and sideways too, diagonally no faster than ahead', () => {
    const back = new RunUp(() => 0, 0, 0, 90);
    const side = new RunUp(() => 0, 0, 0, 90);
    const slant = new RunUp(() => 0, 0, 0, 90);
    for (let i = 0; i < 3 / SIM_DT; i++) {
      back.step(SIM_DT, { ...run, forward: -1 });
      side.step(SIM_DT, { ...run, forward: 0, slide: 1 });
      slant.step(SIM_DT, { ...run, forward: 1, slide: 1 });
    }
    expect(back.vel.x).toBeLessThan(-3.5);
    expect(side.vel.z).toBeGreaterThan(4.5);
    expect(Math.hypot(slant.vel.x, slant.vel.z)).toBeCloseTo(RUN_SPEED, 1);
  });

  test('stands on the roof and leaves it over the edge', () => {
    const { jump, until, model } = baseJump();
    expect(jump.phase).toBe('standing');
    expect(jump.log.exitHeight).toBeCloseTo(HEIGHT, 0);
    expect(jump.clearance()).toBeCloseTo(0, 1);
    const t = until(() => jump.phase !== 'standing', 10, run);
    // 25 m from a standing start.
    expect(t).toBeGreaterThan(4);
    expect(t).toBeLessThan(6);
    expect(jump.phase).toBe('freefall');
    expect(-model.state.vel.z).toBeGreaterThan(6);
  });

  test('a hop in the middle of the roof comes back down on it', () => {
    const { jump, until } = baseJump();
    jump.act();
    expect(jump.phase).toBe('freefall');
    until(() => jump.phase === 'standing' || jump.impact, 2);
    expect(jump.phase).toBe('standing');
    expect(jump.impact).toBe(false);
  });
});

describe('off the tower', () => {
  test('a running exit, a three second delay: open well clear of the wall', () => {
    const { jump, until, model } = baseJump();
    until(() => (jump.runUp?.z ?? 0) < -19, 10, run);
    jump.act();
    until(() => false, 3);
    expect(jump.phase).toBe('freefall');
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    // A BASE canopy is quick: flying with a good margin above the ground.
    expect(jump.log.openHeight).toBeGreaterThan(80);
    expect(jump.log.openHeight).toBeLessThan(220);
    expect(-model.state.pos.z - 20).toBeGreaterThan(10);
  });

  test('a BASE container: no reserve, no AAD, a pull that never comes is the ground', () => {
    const { jump, until } = baseJump();
    until(() => jump.phase !== 'standing', 10, run);
    until(() => jump.impact, 15);
    expect(jump.impact).toBe(true);
    expect(jump.struck).toBe(false);
    expect(jump.log.aad).toBe(false);
    expect(jump.canopy).toBe('main');
    jump.cutaway();
    expect(jump.cutawayAt).toBeNull();
  });

  test('a skydiving container: the main can be cut away, and the reserve comes out', () => {
    const { jump, until } = baseJump({ container: 'sport' });
    expect(jump.single).toBe(false);
    until(() => jump.phase !== 'standing', 10, run);
    until(() => false, 1);
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    expect(jump.phase).toBe('canopy');
    jump.cutaway();
    expect(jump.cutawayAt).not.toBeNull();
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    expect(jump.canopy).toBe('reserve');
    expect(jump.log.reserveBy).toBe('hand');
  });

  test('the AAD is off for BASE, even on a skydiving container', () => {
    const { jump, until } = baseJump({ container: 'sport' });
    until(() => jump.phase !== 'standing', 10, run);
    until(() => jump.impact || jump.phase !== 'freefall', 15);
    expect(jump.log.aad).toBe(false);
    expect(jump.impact).toBe(true);
  });

  test('a canopy opening the other way, off a step-off, flies into the wall', () => {
    const { jump, until } = baseJump({ malfunction: 'offHeading' });
    // Walk to the edge and step off.
    until(() => jump.phase !== 'standing', 30, { ...noBodyInputs(), forward: 0.15 });
    until(() => false, 1.5);
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    if (!jump.impact) until(() => jump.impact, 5);
    expect(jump.log.malfunction).toBe('offHeading');
    expect(jump.impact).toBe(true);
    expect(jump.struck).toBe(true);
  });
});

describe('the training tower', () => {
  test('its roof is where the run starts, 300 m up', () => {
    const dz = createTowerZone();
    const b = dz.base!;
    expect(dz.topAt!(b.x, b.z)).toBe(TOWER_HEIGHT);
    expect(dz.groundAt(b.x, b.z)).toBe(0);
    // The edge is a run-up ahead, along the heading (north).
    expect(dz.topAt!(b.x, b.z - b.runUp + 1)).toBe(TOWER_HEIGHT);
    expect(dz.topAt!(b.x, b.z - b.runUp - 1)).toBe(0);
  });

  test('a BASE start only where there is something to jump from', () => {
    expect(validSetup({ dz: 'tower', jump: { start: 'base' } }).jump.start).toBe('base');
    expect(validSetup({ dz: 'valbrise', jump: { start: 'base' } }).jump.start).toBe('plane');
  });
});
