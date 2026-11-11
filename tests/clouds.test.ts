import * as THREE from 'three';
import { expect, test } from 'vitest';
import { CLOUD_BASE, CLOUD_DEPTH, Clouds } from '../src/render/clouds';
import { daylight, sunPosition, sunVector } from '../src/render/daylight';
import { validSetup } from '../src/setup';

const light = { sun: new THREE.Color(), shade: new THREE.Color(), haze: new THREE.Color(), fog: { value: 0 } };

/** Clouds under a sun at this hour in Provence. */
function cumulus(hour = 11): Clouds {
  const clouds = new Clouds(sunVector(sunPosition(44, 4.8, hour)), light);
  clouds.show(true);
  return clouds;
}

/** Share of a 20 km square, sampled every 100 m, for which `f` holds. */
function share(f: (x: number, z: number) => boolean): number {
  let n = 0;
  let all = 0;
  for (let x = -10000; x < 10000; x += 100) {
    for (let z = -10000; z < 10000; z += 100) {
      all++;
      if (f(x, z)) n++;
    }
  }
  return n / all;
}

test('cumulus cover about a third of the sky, and their shadows as much of the ground', () => {
  const clouds = cumulus();
  const covered = share((x, z) => clouds.column(x, z) > 0);
  expect(covered).toBeGreaterThan(0.2);
  expect(covered).toBeLessThan(0.4);
  const shaded = share((x, z) => clouds.sunThrough(x, 0, z) < 0.5);
  expect(shaded).toBeGreaterThan(0.15);
  expect(shaded).toBeLessThan(0.45);
  // Under the thickest cloud a little sunlight is left; between them all of it.
  const through = [-3000, -1000, 1000, 3000].flatMap((x) => [-2000, 0, 2000].map((z) => clouds.sunThrough(x, 0, z)));
  for (const t of through) {
    expect(t).toBeGreaterThanOrEqual(0.1);
    expect(t).toBeLessThanOrEqual(1);
  }
  expect(share((x, z) => clouds.sunThrough(x, 0, z) === 1)).toBeGreaterThan(0.4);
});

test('above the clouds it is all sun, and with a clear sky there are no cloud shadows', () => {
  const clouds = cumulus();
  expect(share((x, z) => clouds.sunThrough(x, CLOUD_BASE + CLOUD_DEPTH + 1, z) < 1)).toBe(0);
  clouds.show(false);
  expect(share((x, z) => clouds.sunThrough(x, 0, z) < 1)).toBe(0);
});

test('the clouds and their shadows drift with the wind', () => {
  const clouds = cumulus();
  const before = [0, 500, 1000, 1500].map((x) => clouds.sunThrough(x, 0, 0));
  // 10 m/s eastwards for 50 s: everything 500 m further east.
  clouds.drift(10, 0, 50);
  const after = [500, 1000, 1500, 2000].map((x) => clouds.sunThrough(x, 0, 0));
  after.forEach((t, i) => expect(t).toBeCloseTo(before[i]!, 2));
});

test('the cumulus sky is sunny, and the menu choice is kept', () => {
  const d = daylight(sunPosition(44, 4.8, 11), 'cumulus');
  expect(d.clouds).toBe(true);
  expect(d.shadow).toBeCloseTo(1, 6);
  // In a cloud's shadow there is only the skylight.
  expect(d.groundShade.g).toBeLessThan(d.ground.g * 0.6);
  expect(d.fabricShade.g).toBeLessThan(d.fabric.g);
  expect(daylight(sunPosition(44, 4.8, 11), 'clear').clouds).toBe(false);
  expect(validSetup({ weather: { sky: 'cumulus' } }).weather.sky).toBe('cumulus');
});
