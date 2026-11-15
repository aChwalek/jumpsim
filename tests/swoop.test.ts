import { expect, test } from 'vitest';
import { SwoopTracker } from '../src/sim/swoop';

test('starts at 3 m with no minimum speed, including a 50 cm swoop', () => {
  const tracker = new SwoopTracker();
  tracker.step(1, 0.5, 10, 4, 0.5, 0.5);
  expect(tracker.result).toBeNull();
  tracker.step(1, 0.5, 4, 2, 0.5, 0.5);
  tracker.step(0.5, 0.25, 2, 0, 0.5, 0.5);
  expect(tracker.result).toEqual({ distance: 0.5, seconds: 1, entrySpeed: 0.5, topSpeed: 0.5 });
});

test('clips a single step crossing both 3 m and the ground', () => {
  const tracker = new SwoopTracker();
  tracker.step(1, 12, 4, -2, 10, 16);
  expect(tracker.result).toEqual({ distance: 6, seconds: 0.5, entrySpeed: 11, topSpeed: 14 });
});

test('a climb above 3 m does not stop or restart the swoop', () => {
  const tracker = new SwoopTracker();
  tracker.step(1, 5, 3, 2, 5, 5);
  tracker.step(1, 10, 2, 5, 5, 15);
  tracker.step(1, 20, 5, 0, 15, 25);
  expect(tracker.result).toEqual({ distance: 35, seconds: 3, entrySpeed: 5, topSpeed: 25 });
  // Neither a slide on the ground nor a bounce adds to the measurement.
  tracker.step(1, 20, 0, 2, 25, 25);
  tracker.step(1, 20, 2, 0, 25, 25);
  expect(tracker.result?.distance).toBe(35);
});

test('starting under 3 m counts, reset forgets the previous jump, ground movement does not count', () => {
  const tracker = new SwoopTracker();
  tracker.step(0.5, 0, 1, 0, 0, 0);
  expect(tracker.result).toEqual({ distance: 0, seconds: 0.5, entrySpeed: 0, topSpeed: 0 });
  tracker.reset();
  expect(tracker.result).toBeNull();
  tracker.step(1, 10, 0, 0, 10, 10);
  expect(tracker.result).toBeNull();
  tracker.reset();
  tracker.step(1, 10, 2, 0, 10, 10);
  expect(tracker.result?.distance).toBe(10);
});
