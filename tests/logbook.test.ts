import { expect, test } from 'vitest';
import { JUMP_DISCIPLINES, filterLogbook, jumpDiscipline, logStats, type LogEntry } from '../src/logbook';
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

test('flight records and manual low pulls exclude crashes, impacts and automatic pulls', () => {
  const freefall = { exitHeight: 4000, seconds: 55, topSpeed: 55, aad: false, pullHeight: 900 };
  const stats = logStats([
    entry(1, { start: 'base', freefall, flight: { seconds: 100, horizontalDistance: 500 } }),
    entry(2, { outcome: 'hard', freefall: { ...freefall, pullHeight: 200, seconds: 60 }, flight: { seconds: 80, horizontalDistance: 800 } }),
    entry(3, { outcome: 'crash', freefall: { ...freefall, pullHeight: 50, seconds: 90 }, flight: { seconds: 200, horizontalDistance: 2000 } }),
    entry(4, { outcome: 'impact', freefall: { ...freefall, pullHeight: 10, seconds: 100 }, flight: { seconds: 300, horizontalDistance: 3000 } }),
    entry(5, { freefall: { ...freefall, aad: true, pullHeight: 100 } }),
  ]);
  expect(stats).toMatchObject({
    lowestPull: 200,
    longestFlightSeconds: 100,
    longestFlightDistance: 800,
    longestFreefallSeconds: 60,
    bestStreak: 2,
    currentStreak: 1,
  });
});

test('older jumps retain their freefall records without inventing flight measurements', () => {
  expect(logStats([entry(1, {
    freefall: { exitHeight: 4000, seconds: 55, topSpeed: 55, aad: false, pullHeight: 900 },
  })])).toMatchObject({
    longestFlightSeconds: null,
    longestFlightDistance: null,
    longestFreefallSeconds: 55,
    lowestPull: 900,
    bestStreak: 1,
    currentStreak: 1,
  });
});

test('records start empty and a crash ends the current streak', () => {
  expect(logStats([])).toMatchObject({
    longestFlightSeconds: null,
    longestFlightDistance: null,
    longestFreefallSeconds: null,
    bestStreak: 0,
    currentStreak: 0,
  });
  expect(logStats([entry(1, {}), entry(2, {}), entry(3, { outcome: 'crash' })])).toMatchObject({
    bestStreak: 2,
    currentStreak: 0,
    lowestPull: null,
  });
});

test('speed records use survived freefalls and preserve missing historical horizontal data', () => {
  const ff = { exitHeight: 4000, seconds: 55, topSpeed: 55, aad: false, pullHeight: 900 };
  const old = entry(1, { freefall: ff });
  expect(logStats([old])).toMatchObject({ fastestVerticalSpeed: 55, fastestHorizontalSpeed: null });
  expect(logStats([])).toMatchObject({ fastestVerticalSpeed: null, fastestHorizontalSpeed: null });
  expect(logStats([
    old,
    entry(2, { freefall: { ...ff, topSpeed: 60, topHorizontalSpeed: 80 } }),
    entry(3, { freefall: { ...ff, topSpeed: 70, topHorizontalSpeed: 50 } }),
    entry(4, { outcome: 'crash', freefall: { ...ff, topSpeed: 100, topHorizontalSpeed: 120 } }),
    entry(5, { outcome: 'impact', freefall: { ...ff, topSpeed: 110, topHorizontalSpeed: 130 } }),
  ])).toMatchObject({ fastestVerticalSpeed: 70, fastestHorizontalSpeed: 80 });
});

test('each discipline filters all statistics and history without guessing older suits', () => {
  const entries = JUMP_DISCIPLINES.filter((d) => d !== 'unknown').map((discipline, i) => entry(i + 1, {
    discipline,
    start: discipline === 'base' || discipline === 'wingbase' ? 'base' : discipline === 'canopy' ? 'pattern' : 'plane',
    canopySeconds: 100 + i,
    distance: 10 + i,
    accuracy: 500 + i,
    flight: { seconds: 150 + i, horizontalDistance: 800 + i },
    freefall: { exitHeight: 4000, seconds: 50 + i, topSpeed: 60 + i, topHorizontalSpeed: 70 + i, aad: false, pullHeight: 900 - i },
  }));
  const old = entry(10, { start: 'base' });
  entries.push(old);
  expect(jumpDiscipline(old)).toBe('unknown');
  expect(jumpDiscipline(entry(11, { start: 'plane' }))).toBe('unknown');
  expect(jumpDiscipline(entry(12, {}))).toBe('canopy');
  expect(filterLogbook(entries, 'all')).toBe(entries);
  for (const [i, discipline] of JUMP_DISCIPLINES.entries()) {
    const filtered = filterLogbook(entries, discipline);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toBe(entries[i]);
    const stats = logStats(filtered);
    expect(stats.jumps).toBe(1);
    expect(stats.bestStreak).toBe(1);
    if (discipline === 'unknown') continue;
    expect(stats).toMatchObject({
      canopySeconds: 100 + i,
      bestDistance: 10 + i,
      bestScore: 500 + i,
      longestFlightSeconds: 150 + i,
      longestFlightDistance: 800 + i,
      longestFreefallSeconds: 50 + i,
      fastestVerticalSpeed: 60 + i,
      fastestHorizontalSpeed: 70 + i,
      lowestPull: 900 - i,
    });
  }
});

test('swoop records count small survived passes and respect discipline filters', () => {
  expect(logStats([entry(1, {})])).toMatchObject({ longestSwoopDistance: null, longestSwoopSeconds: null, fastestSwoopSpeed: null });
  const pass = { distance: 0.5, seconds: 0.1, entrySpeed: 5, topSpeed: 6 };
  const entries = [
    entry(1, { discipline: 'normal', swoop: pass }),
    entry(2, { discipline: 'wingbase', swoop: { ...pass, distance: 10, seconds: 3, topSpeed: 20 } }),
    entry(3, { outcome: 'crash', swoop: { ...pass, distance: 100, seconds: 10, topSpeed: 50 } }),
    entry(4, { outcome: 'impact', swoop: { ...pass, distance: 200, seconds: 20, topSpeed: 60 } }),
  ];
  expect(logStats(entries)).toMatchObject({ longestSwoopDistance: 10, longestSwoopSeconds: 3, fastestSwoopSpeed: 20 });
  expect(logStats(filterLogbook(entries, 'normal'))).toMatchObject({ longestSwoopDistance: 0.5, longestSwoopSeconds: 0.1, fastestSwoopSpeed: 6 });
});

test('the slide on the feet is a record of its own, only when it ended standing', () => {
  const entries = [
    entry(1, { outcome: 'run', slid: 6, swoop: { distance: 40, seconds: 3, entrySpeed: 20, topSpeed: 25 } }),
    entry(2, { outcome: 'slide', slid: 12 }),
    entry(3, { outcome: 'hard', slid: 15 }),
    entry(4, { outcome: 'standUp' }),
  ];
  // The swoop still ends at the first touch.
  expect(logStats(entries)).toMatchObject({ longestSlide: 6, longestSwoopDistance: 40 });
  expect(logStats([entry(1, { outcome: 'slide', slid: 9 })]).longestSlide).toBeNull();
});
