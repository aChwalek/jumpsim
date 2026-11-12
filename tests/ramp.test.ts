import { expect, test } from 'vitest';
import { DEFAULT_RATES, WRAP_STOP, noPulls, noWraps, rampControls, wrapTravel } from '../src/input/ramp';
import { BRAKE_DEEP, neutralControls } from '../src/sim/flightModel';

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

test('kept fully pulled, a toggle goes on into wraps after a stop, up to the limit', () => {
  const w = noWraps();
  const step = (atFull: boolean, hold: boolean, seconds: number) => {
    let travel = 0;
    for (let i = 0; i < Math.round(seconds * 100); i++) travel = wrapTravel(w, 'brakeL', atFull, hold, 0.01);
    return travel;
  };
  expect(step(true, false, WRAP_STOP - 0.1)).toBe(0);
  expect(step(true, false, 1)).toBeGreaterThan(0.1);
  expect(w.brakeR).toBe(0);
  expect(step(true, false, 30)).toBeCloseTo(BRAKE_DEEP - 1, 5);
  // Hold keeps the wraps, letting go drops them.
  expect(step(false, true, 2)).toBeCloseTo(BRAKE_DEEP - 1, 5);
  expect(step(false, false, 0.01)).toBe(0);
});
