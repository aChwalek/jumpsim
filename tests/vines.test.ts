// Vineyards planted in rows, and who lands on one.

import { describe, expect, test } from 'vitest';
import type { Area } from '../src/world/dz';
import { dzInfo } from '../src/world/dzs';
import { VINE_SPACING, onVineRow, vineRows, vineyardOf } from '../src/world/vines';

/** 100 m east-west by 40 m, with a 10 m hut in the middle. */
const plot: Area = { points: [0, 0, 100, 0, 100, 40, 0, 40], holes: [[45, 15, 55, 15, 55, 25, 45, 25]], color: 0, layer: 0 };

describe('a vineyard', () => {
  const vineyard = vineyardOf(plot);
  const rows = vineRows(vineyard);

  test('the rows run along its longest side, a tractor apart', () => {
    expect(Math.abs(vineyard.along[0])).toBeCloseTo(1, 9);
    for (const [, az, , bz] of rows) expect(az).toBeCloseTo(bz, 9);
    const lines = [...new Set(rows.map((r) => Math.round(r[1] * 100) / 100))].sort((a, b) => a - b);
    expect(lines.length).toBeGreaterThan(12);
    for (let i = 1; i < lines.length; i++) expect(lines[i]! - lines[i - 1]!).toBeCloseTo(VINE_SPACING, 2);
  });

  test('they stay inside it, short of its edge, and stop at the hole', () => {
    for (const [ax, az, bx, bz] of rows) {
      for (const [x, z] of [[ax, az], [bx, bz]] as const) {
        expect(x).toBeGreaterThan(1);
        expect(x).toBeLessThan(99);
        expect(z).toBeGreaterThan(1);
        expect(z).toBeLessThan(39);
        expect(x > 45 && x < 55 && z > 15 && z < 25).toBe(false);
      }
    }
    // A row through the hole comes in two lengths.
    expect(rows.filter((r) => r[1] > 15 && r[1] < 25).length).toBeGreaterThan(rows.filter((r) => r[1] < 15).length);
  });

  test('landing on a row, or between two', () => {
    const z = rows[0]![1];
    expect(onVineRow([vineyard], 20, z)).toBe(true);
    expect(onVineRow([vineyard], 20, z + VINE_SPACING / 2)).toBe(false);
    expect(onVineRow([vineyard], 200, z)).toBe(false);
  });
});

describe('the vineyards of Pujaut', () => {
  test('rows all round the airfield, none on it, short enough to draw', async () => {
    const dz = await dzInfo('pujaut').load();
    const rows = dz.vineRows!;
    expect(rows.length / 4).toBeGreaterThan(5000);
    expect(rows.length / 4).toBeLessThan(120000);
    expect(dz.onVines!(dz.target.x, dz.target.z)).toBe(false);
    const k = 4 * 1000;
    expect(dz.onVines!((rows[k]! + rows[k + 2]!) / 2, (rows[k + 1]! + rows[k + 3]!) / 2)).toBe(true);
  });
});
