// What the grass reads of the ground under it: the colour of the surface
// lying there, and the height of the terrain as its triangles draw it.

import { describe, expect, test } from 'vitest';
import { facetedHeight, surfaceColorAt } from '../src/world/cover';
import type { Area, Rect } from '../src/world/dz';

const rect = (x: number, z: number, length: number, width: number, headingDeg: number, color: number, layer: number): Rect => ({ x, z, length, width, headingDeg, color, layer });

describe('the colour of the ground', () => {
  const field = rect(0, 0, 200, 100, 90, 0x00ff00, 1);
  const road = rect(0, 0, 400, 6, 0, 0x808080, 2);
  const pond: Area = { points: [300, 300, 340, 300, 340, 340, 300, 340], holes: [[315, 315, 325, 315, 325, 325, 315, 325]], color: 0x0000ff, layer: 2 };
  const colorAt = surfaceColorAt(() => 0x111111, [road, field], [pond]);

  test('the topmost surface shows, whatever the order they come in', () => {
    expect(colorAt(50, 20)).toBe(0x00ff00);
    expect(colorAt(1, 20)).toBe(0x808080);
    // The road runs north, beyond the field, which lies east-west.
    expect(colorAt(1, -150)).toBe(0x808080);
    expect(colorAt(50, -150)).toBe(0x111111);
  });

  test('a polygon far from the origin, less its hole', () => {
    expect(colorAt(305, 305)).toBe(0x0000ff);
    expect(colorAt(320, 320)).toBe(0x111111);
    expect(colorAt(-3000, 5000)).toBe(0x111111);
  });
});

describe('the height of the terrain as drawn', () => {
  // A dome: the triangles cut under it between their corners.
  const dome = (x: number, z: number): number => 50 - (x * x + z * z) / 1000;
  const drawn = facetedHeight(dome, 100);

  test('the corners are where the ground is, the faces flat between them', () => {
    expect(drawn(100, -200)).toBeCloseTo(dome(100, -200), 9);
    expect(drawn(150, 100)).toBeCloseTo((dome(100, 100) + dome(200, 100)) / 2, 9);
    // The diagonal runs from the north-east corner to the south-west one.
    expect(drawn(50, 50)).toBeCloseTo((dome(100, 0) + dome(0, 100)) / 2, 9);
    expect(drawn(50, 50)).toBeLessThan(dome(50, 50));
  });

  test('no step from one face to the next', () => {
    for (const [x, z] of [[100, 37], [37, 100], [60, 40]] as const) {
      expect(Math.abs(drawn(x - 1e-6, z - 1e-6) - drawn(x + 1e-6, z + 1e-6))).toBeLessThan(1e-4);
    }
  });

  test('a finer square is drawn finer', () => {
    const fine = facetedHeight(dome, 100, { x: 0, z: 0, size: 400, spacing: 10 });
    expect(fine(5, 0)).toBeCloseTo((dome(0, 0) + dome(10, 0)) / 2, 9);
    expect(fine(350, 50)).toBe(drawn(350, 50));
  });
});
