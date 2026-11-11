import { expect, test } from 'vitest';
import { logStats, type LogEntry } from '../src/logbook';
import { defaultSettings, validSettings } from '../src/settings';

const entry = (n: number, change: Partial<LogEntry>): LogEntry => ({
  n,
  time: 0,
  dz: 'valbrise',
  dzName: 'Valbrise',
  start: 'pattern',
  hour: 10,
  weather: { sky: 'clear', windFromDeg: 270, windKmh: 10, gusts: 'none' },
  canopy: { kind: 'classic', areaFt2: 170, exitWeightKg: 85, wingLoading: 1.1 },
  canopySeconds: 60,
  outcome: 'standUp',
  sink: 1.5,
  groundSpeed: 2,
  distance: 20,
  ...change,
});

test('the logbook adds up the jumps', () => {
  expect(logStats([])).toMatchObject({ jumps: 0, bestDistance: null, recentDistance: null, lowestPull: null });
  const ff = { exitHeight: 4000, seconds: 55, topSpeed: 55, aad: false };
  const stats = logStats([
    entry(1, { start: 'plane', freefall: { ...ff, pullHeight: 1100 }, distance: 40 }),
    entry(2, { outcome: 'run', distance: 8 }),
    entry(3, { start: 'plane', freefall: { ...ff, pullHeight: null, aad: true }, outcome: 'hard', distance: 300 }),
    entry(4, { start: 'plane', freefall: { ...ff, pullHeight: null, seconds: 70 }, outcome: 'impact', distance: undefined }),
  ]);
  expect(stats.jumps).toBe(4);
  expect(stats.planeJumps).toBe(3);
  expect(stats.freefallSeconds).toBe(55 + 55 + 70);
  expect(stats.canopySeconds).toBe(240);
  // Debout, couru, glissé, dur, crash (the impact among the crashes).
  expect(stats.groups).toEqual([1, 1, 0, 1, 1]);
  expect(stats.landings).toBe(3);
  expect(stats.bestDistance).toBe(8);
  expect(stats.recentDistance).toBeCloseTo((40 + 8 + 300) / 3, 6);
  expect(stats.lowestPull).toBe(1100);
  expect(stats.aadFires).toBe(1);
});

test('saved settings are checked', () => {
  expect(validSettings({ quality: 9, volume: 2, mouseSensitivity: 0, showFps: 'yes' })).toEqual({
    ...defaultSettings(),
    quality: 3,
    volume: 1,
    mouseSensitivity: 0.3,
  });
});
