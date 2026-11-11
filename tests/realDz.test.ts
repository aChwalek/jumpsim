import { expect, test } from 'vitest';
import { sunPosition } from '../src/render/daylight';
import { createValbrise, inArea, landingHeading, spawnsFor } from '../src/world/dz';
import { gridOf, reliefFrom } from '../src/world/terrain';

test('a narrow landing area is landed along its axis, whichever way is nearer into the wind', () => {
  const dz = { ...createValbrise(), landingAxisDeg: 163.4 };
  // Sea breeze from 120: finals heading 163, a crosswind from the left.
  expect(landingHeading(dz, 120)).toBeCloseTo(163.4, 6);
  // Tramontana from 340: finals heading 343.
  expect(landingHeading(dz, 340)).toBeCloseTo(343.4, 6);
  // Without an axis, straight into the wind.
  expect(landingHeading(createValbrise(), 120)).toBe(120);
  const final = spawnsFor(dz, 120).final;
  expect(final.headingDeg).toBeCloseTo(163.4, 6);
  // It starts upwind along the axis, north of the target.
  expect(final.z).toBeLessThan(-200);
});

test('a pattern kept on one side of the landing area turns left or right with the wind', () => {
  // Pattern always east of a north-south landing area.
  const dz = { ...createValbrise(), landingAxisDeg: 0, patternSideDeg: 90 };
  // Landing south: downwind leg flown north on the east side, a left-hand circuit.
  const south = spawnsFor(dz, 180).pattern;
  expect(south.headingDeg).toBeCloseTo(0, 6);
  expect(south.x).toBeGreaterThan(100);
  // Landing north: downwind flown south, still on the east side, right-hand.
  const north = spawnsFor(dz, 0).pattern;
  expect(north.headingDeg).toBeCloseTo(180, 6);
  expect(north.x).toBeGreaterThan(100);
  // The plane still runs in straight into the wind.
  expect(spawnsFor(dz, 120).plane.headingDeg).toBe(120);
});

test('the far grid takes over from the near one, and both lay the plain flat', () => {
  // Near: flat plain with a 50 m bump in the middle. Far: a 1000 m ridge 10 km east.
  const near = gridOf(3, 1000, [0, 0, 0, 0, 50, 0, 0, 0, 0]);
  const farHeights = Array.from({ length: 41 * 41 }, (_, i) => ((i % 41) - 20) * 500 === 10000 ? 1000 : 0);
  const far = gridOf(41, 500, farHeights);
  const ground = reliefFrom(near, { plain: 0, flatBelow: 12, blend: 20, far });
  expect(ground(0, 0)).toBeCloseTo(50, 6);
  expect(ground(800, 0)).toBe(0);
  expect(ground(10000, 0)).toBeCloseTo(1000, 3);
  expect(ground(10000, 3000)).toBeCloseTo(1000, 3);
  // Low ground is laid flat, and so is ground below the plain (the sea).
  expect(ground(7000, 0)).toBe(0);
});

test('an island in a lake is dry', () => {
  const lake = { points: [-100, -100, 100, -100, 100, 100, -100, 100], holes: [[-10, -10, 10, -10, 10, 10, -10, 10]], color: 0, layer: 0 };
  expect(inArea(lake, 50, 50)).toBe(true);
  expect(inArea(lake, 0, 0)).toBe(false);
});

test('the sun keeps local time where the clock is not French', () => {
  // Saint-François, Guadeloupe, UTC-4: the sun is highest near half past twelve local time.
  const noon = sunPosition(16.26, -61.27, 12.5, -4);
  expect(noon.elevationDeg).toBeGreaterThan(80);
  const morning = sunPosition(16.26, -61.27, 8, -4);
  expect(morning.elevationDeg).toBeGreaterThan(20);
  expect(morning.elevationDeg).toBeLessThan(40);
  expect(morning.azimuthDeg).toBeGreaterThan(60);
  expect(morning.azimuthDeg).toBeLessThan(80);
});
