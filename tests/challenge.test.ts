import { expect, test } from 'vitest';
import { ACCURACY_MAX, ACCURACY_RINGS, accuracyPoints, bestScore, scoreAccuracy } from '../src/challenge';
import { logStats, type LogEntry } from '../src/logbook';

test('accuracy points fall off fast near the centre and slowly far from it', () => {
  expect(accuracyPoints(0)).toBe(1000);
  // Out of a thousand, a few centimetres count.
  expect(accuracyPoints(0.05)).toBe(988);
  expect(accuracyPoints(0.1)).toBe(970);
  expect(accuracyPoints(0.5)).toBe(825);
  expect(accuracyPoints(1)).toBe(730);
  expect(accuracyPoints(2)).toBe(646);
  expect(accuracyPoints(5)).toBe(535);
  expect(accuracyPoints(10)).toBe(434);
  expect(accuracyPoints(20)).toBe(316);
  expect(accuracyPoints(50)).toBe(141);
  // Far from linear: the first metre is worth more than the next four, the tenth over three times the fiftieth.
  expect(accuracyPoints(0) - accuracyPoints(1)).toBeGreaterThan(accuracyPoints(1) - accuracyPoints(5));
  expect(accuracyPoints(9) - accuracyPoints(10)).toBeGreaterThan(3 * (accuracyPoints(49) - accuracyPoints(50)));
  // Points all the way out, and down to none at 100 m without a step.
  expect(accuracyPoints(75)).toBe(59);
  expect(accuracyPoints(ACCURACY_MAX - 0.01)).toBe(0);
  expect(accuracyPoints(ACCURACY_MAX)).toBe(0);
  expect(accuracyPoints(500)).toBe(0);
  expect(accuracyPoints(Number.NaN)).toBe(0);
  // Each ring painted scores less than the one inside it.
  const atRings = ACCURACY_RINGS.map(accuracyPoints);
  for (let i = 1; i < atRings.length; i++) expect(atRings[i]).toBeLessThan(atRings[i - 1]!);
  // Never more as the distance grows.
  for (let d = 0; d < 110; d += 0.1) expect(accuracyPoints(d + 0.1)).toBeLessThanOrEqual(accuracyPoints(d));
});

test('a landing scores on its distance alone, unless hurt, in the water or in the vines', () => {
  expect(scoreAccuracy(1, 'standUp', false, false)).toEqual({ points: 730, distance: 1, spoilt: null });
  // Run off or slid off: it is where the feet first touched that counts.
  expect(scoreAccuracy(1, 'run', false, false).points).toBe(730);
  expect(scoreAccuracy(1, 'slide', false, false).points).toBe(730);
  expect(scoreAccuracy(1, 'heavy', false, false).points).toBe(730);
  expect(scoreAccuracy(1, 'hard', false, false)).toEqual({ points: 0, distance: 1, spoilt: 'hard' });
  expect(scoreAccuracy(0, 'crash', false, false).spoilt).toBe('crash');
  expect(scoreAccuracy(0, 'standUp', true, false).spoilt).toBe('wet');
  // The vines make it hard too: they are named, not the hard landing.
  expect(scoreAccuracy(0, 'hard', false, true).spoilt).toBe('vines');
});

const entry = (n: number, dz: string, accuracy?: number, distance = 3): LogEntry => ({
  n,
  time: n,
  dz,
  dzName: dz,
  start: 'final',
  hour: 10,
  weather: { sky: 'clear', windFromDeg: 270, windKmh: 10, gusts: 'none' },
  canopy: { kind: 'classic', areaFt2: 190, exitWeightKg: 80, wingLoading: 0.93 },
  canopySeconds: 60,
  outcome: 'standUp',
  sink: 1,
  groundSpeed: 1,
  distance,
  accuracy,
});

test('the record is the best score at that drop zone, from jumps scored there only', () => {
  const entries = [entry(1, 'pujaut', 40), entry(2, 'pujaut'), entry(3, 'valbrise', 95), entry(4, 'pujaut', 71), entry(5, 'pujaut', 0)];
  expect(bestScore(entries, 'pujaut')).toBe(71);
  expect(bestScore(entries, 'valbrise')).toBe(95);
  expect(bestScore(entries, 'chambery')).toBeNull();
  expect(bestScore([entry(1, 'pujaut', 0)], 'pujaut')).toBe(0);
  // A score out of 100 kept by the first version is not one out of 1000.
  const old = { ...entry(6, 'chambery'), score: 83 } as LogEntry;
  expect(bestScore([old], 'chambery')).toBeNull();
  expect(logStats([old]).bestScore).toBeNull();
});

test('the logbook adds up the scores: the best, and the mean of the last ten', () => {
  expect(logStats([entry(1, 'pujaut')]).bestScore).toBeNull();
  const entries = [entry(1, 'pujaut', 10), ...Array.from({ length: 10 }, (_, i) => entry(i + 2, 'pujaut', 50)), entry(12, 'pujaut')];
  const stats = logStats(entries);
  expect(stats.bestScore).toBe(50);
  expect(stats.recentScore).toBe(50);
});
