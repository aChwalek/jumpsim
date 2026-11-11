import { expect, test } from 'vitest';
import { DEFAULT_RATES, noPulls, rampControls } from '../src/input/ramp';
import { neutralControls } from '../src/sim/flightModel';

const run = (c: ReturnType<typeof neutralControls>, pulls: ReturnType<typeof noPulls>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 100); i++) rampControls(c, pulls, 0.01);
};

test('holding a key pulls the control progressively, up to full travel', () => {
  const c = neutralControls();
  const pulls = { ...noPulls(), brakeR: true };
  run(c, pulls, 0.5);
  expect(c.brakeR).toBeCloseTo(0.5 * DEFAULT_RATES.brakePull, 5);
  expect(c.brakeL).toBe(0);
  run(c, pulls, 5);
  expect(c.brakeR).toBe(1);
});

test('releasing lets the control back up, down to zero', () => {
  const c = { ...neutralControls(), brakeL: 1, frontR: 1 };
  run(c, noPulls(), 0.2);
  expect(c.brakeL).toBeCloseTo(1 - 0.2 * DEFAULT_RATES.brakeRelease, 5);
  expect(c.frontR).toBeCloseTo(1 - 0.2 * DEFAULT_RATES.frontRelease, 5);
  run(c, noPulls(), 5);
  expect(c.brakeL).toBe(0);
  expect(c.frontR).toBe(0);
});

test('hold keeps released controls in place but still lets them be pulled further', () => {
  const c = { ...neutralControls(), brakeL: 0.5, brakeR: 0.5 };
  run(c, { ...noPulls(), hold: true }, 2);
  expect(c.brakeL).toBe(0.5);
  run(c, { ...noPulls(), hold: true, brakeL: true }, 0.2);
  expect(c.brakeL).toBeCloseTo(0.7, 5);
  expect(c.brakeR).toBe(0.5);
});
