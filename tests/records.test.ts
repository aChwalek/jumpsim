import { expect, test } from 'vitest';
import { brokenRecords } from '../src/records';
import type { LogEntry } from '../src/logbook';

const entry = (changes: Partial<LogEntry> = {}): LogEntry => ({
  n: 1, time: 0, dz: 'valbrise', dzName: 'Valbrise', start: 'plane', discipline: 'normal', hour: 10,
  weather: { sky: 'clear', windFromDeg: 0, windKmh: 0, gusts: 'none' },
  canopy: { kind: 'classic', areaFt2: 170, exitWeightKg: 85, wingLoading: 1.1 },
  canopySeconds: 60, outcome: 'standUp', sink: 1, groundSpeed: 2,
  ...changes,
});
const freefall = { exitHeight: 4000, pullHeight: 900, seconds: 55, topSpeed: 55, topHorizontalSpeed: 30, aad: false };

test('first measurements establish records, missing metrics and zero accuracy do not', () => {
  const records = brokenRecords([], entry({ accuracy: 0, distance: 0, swoop: { distance: 0.5, seconds: 0.2, entrySpeed: 2, topSpeed: 3 } }));
  expect(records.map((r) => r.kind)).toEqual(['bestDistance', 'longestSwoopDistance', 'longestSwoopSeconds', 'fastestSwoopSpeed', 'bestStreak']);
  expect(records.find((r) => r.kind === 'longestSwoopDistance')).toMatchObject({ value: 0.5, previous: null, global: true, discipline: 'normal' });
});

test('strict improvements respect minimum and maximum records, with deduplicated scopes', () => {
  const previous = [entry({ freefall, distance: 20, accuracy: 500, flight: { seconds: 100, horizontalDistance: 800 } })];
  const current = entry({ freefall: { ...freefall, pullHeight: 800, topHorizontalSpeed: 40 }, distance: 10, accuracy: 600, flight: { seconds: 110, horizontalDistance: 700 } });
  const records = brokenRecords(previous, current);
  expect(records.map((r) => r.kind)).toEqual(['lowestPull', 'bestDistance', 'bestScore', 'longestFlightSeconds', 'fastestHorizontalSpeed', 'bestStreak']);
  expect(records.find((r) => r.kind === 'lowestPull')).toEqual({ kind: 'lowestPull', value: 800, previous: 900, global: true, discipline: 'normal' });
  expect(previous).toHaveLength(1);
  expect(previous[0]?.freefall?.pullHeight).toBe(900);
});

test('equalled metrics and cumulative totals are not awards', () => {
  const old = entry({ freefall, canopySeconds: 100, distance: 20 });
  const records = brokenRecords([old], entry({ freefall, canopySeconds: 500, distance: 20 }));
  expect(records.map((r) => r.kind)).toEqual(['bestStreak']);
});

test('a discipline record can improve without beating the global best', () => {
  const previous = [
    entry({ discipline: 'normal', flight: { seconds: 200, horizontalDistance: 1000 } }),
    entry({ discipline: 'wingbase', start: 'base', flight: { seconds: 60, horizontalDistance: 200 } }),
  ];
  const records = brokenRecords(previous, entry({ discipline: 'wingbase', start: 'base', flight: { seconds: 100, horizontalDistance: 500 } }));
  expect(records.find((r) => r.kind === 'longestFlightDistance')).toEqual({ kind: 'longestFlightDistance', value: 500, previous: 200, global: false, discipline: 'wingbase' });
});

test('crashes and impacts never celebrate records, and automatic pulls do not count', () => {
  for (const outcome of ['crash', 'impact'] as const) expect(brokenRecords([], entry({ outcome, freefall }))).toEqual([]);
  expect(brokenRecords([], entry({ freefall: { ...freefall, aad: true } })).some((r) => r.kind === 'lowestPull')).toBe(false);
});

test('a slide on the feet ending standing is celebrated, one ending on the backside is not', () => {
  const previous = [entry({ outcome: 'run', slid: 5 })];
  expect(brokenRecords(previous, entry({ outcome: 'run', slid: 8 })).find((r) => r.kind === 'longestSlide')).toMatchObject({ value: 8, previous: 5, global: true });
  expect(brokenRecords(previous, entry({ outcome: 'slide', slid: 20 })).some((r) => r.kind === 'longestSlide')).toBe(false);
});

test('different global and discipline streak lengths get their correct separate values', () => {
  const previous = [entry({ discipline: 'wingbase' }), entry(), entry()];
  const records = brokenRecords(previous, entry({ discipline: 'wingbase' })).filter((r) => r.kind === 'bestStreak');
  expect(records).toEqual([
    { kind: 'bestStreak', value: 4, previous: 3, global: true, discipline: null },
    { kind: 'bestStreak', value: 2, previous: 1, global: false, discipline: 'wingbase' },
  ]);
});
