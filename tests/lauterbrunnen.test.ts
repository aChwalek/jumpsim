// Lauterbrunnen: High Nose on the Mürrenfluh, the cliff drawn from the Swiss
// survey, and a jump off it down to the meadow on the valley floor.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { RunUp } from '../src/sim/runUp';
import { SIM_DT } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { DATA } from '../src/world/data/lauterbrunnen';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';
import { FINE_BLEND, gridOf, reliefFrom } from '../src/world/terrain';

const dz = createRealDz(DATA, LOOKS.lauterbrunnen);
const b = dz.base!;
const DEG = Math.PI / 180;
/** A point `ahead` metres from the start along the run. */
const along = (ahead: number) => ({ x: b.x + Math.sin(b.headingDeg * DEG) * ahead, z: b.z - Math.cos(b.headingDeg * DEG) * ahead });
const run: BodyInputs = { ...noBodyInputs(), forward: 1 };

describe('the cliff', () => {
  test('the meadow is flat, at the level of the plain', () => {
    expect(dz.groundAt(dz.target.x, dz.target.z)).toBe(0);
    expect(Math.abs(dz.groundAt(dz.target.x + 50, dz.target.z + 30))).toBeLessThan(1);
  });

  test('High Nose stands some 550 m above the meadow, a run-up back from a sheer drop', () => {
    const top = dz.groundAt(b.x, b.z);
    expect(top).toBeGreaterThan(530);
    expect(top).toBeLessThan(580);
    // The top slopes gently down to the edge, less than 45° up to the lip,
    // which the relief, known every 6 m, rounds off...
    const edge = along(b.runUp - 3);
    expect(top - dz.groundAt(edge.x, edge.z)).toBeLessThan(20);
    for (let s = 0; s < b.runUp - 8; s += 2) {
      const p = along(s);
      const q = along(s + 2);
      expect(dz.groundAt(p.x, p.z) - dz.groundAt(q.x, q.z)).toBeLessThan(2 * Math.tan(45 * DEG));
    }
    // ...then drops away: more than 150 m within 15 m.
    const below = along(b.runUp + 15);
    expect(dz.groundAt(edge.x, edge.z) - dz.groundAt(below.x, below.z)).toBeGreaterThan(150);
    // The meadow is ahead of it, some 470 m out.
    expect(Math.hypot(dz.target.x - b.x, dz.target.z - b.z)).toBeGreaterThan(400);
    expect(Math.hypot(dz.target.x - b.x, dz.target.z - b.z)).toBeLessThan(600);
  });

  test('a BASE start, from where it was chosen', () => {
    expect(validSetup({ dz: 'lauterbrunnen', jump: { start: 'base' } }).jump.start).toBe('base');
  });
});

describe('off High Nose', () => {
  function jumpOff(delay: number) {
    const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(1360) };
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg: b.headingDeg, height: b.height } as const;
    const jump = new Jump(model, ledge, env, dz.groundAt, () => 0.5, {
      solidAt: dz.groundAt,
      container: 'base',
      reserve: deriveRig(reserveConfig(90)),
    });
    const until = (done: () => boolean, seconds: number, input = noBodyInputs()) => {
      for (let t = 0; t < seconds && !done(); t += SIM_DT) {
        env.airDensity = airDensityAt(807 + model.state.pos.y);
        jump.step(SIM_DT, input, env);
      }
    };
    expect(jump.log.exitHeight).toBe(b.height);
    until(() => jump.phase !== 'standing', 10, run);
    expect(jump.phase).toBe('freefall');
    until(() => false, delay);
    if (jump.phase === 'freefall') jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    return { jump, model };
  }

  test('a running exit and a five second delay: open clear of the wall, high above the scree', () => {
    const { jump, model } = jumpOff(5);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.exitHeight).toBe(b.height);
    // Out from the edge, over the slope below it.
    const out = (model.state.pos.x - b.x) * Math.sin(b.headingDeg * DEG) - (model.state.pos.z - b.z) * Math.cos(b.headingDeg * DEG);
    expect(out - b.runUp).toBeGreaterThan(15);
    expect(jump.height()).toBeGreaterThan(100);
  });

  test('a pull that never comes: the scree', () => {
    const { jump } = jumpOff(30);
    expect(jump.impact).toBe(true);
  });
});

describe('the run-up on a slope', () => {
  test('down a gentle slope it runs on; where the ground falls away steeper than 60° it leaves', () => {
    // Downhill at 20° for 20 m, then 75°.
    const slope = (x: number) => (x < 20 ? -x * Math.tan(20 * DEG) : -20 * Math.tan(20 * DEG) - (x - 20) * Math.tan(75 * DEG));
    const r = new RunUp((x) => slope(x), 0, 0, 90);
    let t = 0;
    let off = false;
    while (!off && t < 10) {
      off = r.step(SIM_DT, run);
      t += SIM_DT;
    }
    expect(off).toBe(true);
    expect(r.x).toBeGreaterThan(19.5);
    expect(r.x).toBeLessThan(20.5);
  });
});

test('the fine relief takes over inside its square, blending in at its edge', () => {
  const near = gridOf(3, 1000, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const fine = { ...gridOf(3, 500, [100, 100, 100, 100, 100, 100, 100, 100, 100]), x: 0, z: 0 };
  const ground = reliefFrom(near, { plain: 0, flatBelow: 2, blend: 8, fine });
  expect(ground(0, 0)).toBeCloseTo(100, 6);
  expect(ground(500 - FINE_BLEND - 1, 0)).toBeCloseTo(100, 6);
  expect(ground(400, 400 + 60)).toBeGreaterThan(0);
  expect(ground(400, 400 + 60)).toBeLessThan(100);
  expect(ground(600, 0)).toBe(0);
});
