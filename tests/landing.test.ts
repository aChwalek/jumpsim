import { expect, test } from 'vitest';
import { FlightModel, calmAir, neutralControls } from '../src/sim/flightModel';
import { detectTouchdown, feetHeight, rateLanding } from '../src/sim/landing';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';

const flat = () => 0;

test('ratings follow vertical speed, ground speed and bank', () => {
  expect(rateLanding(0.5, 1.5, 0)).toBe('standUp');
  expect(rateLanding(0.5, 3.5, 0)).toBe('run');
  expect(rateLanding(0.5, 5, 0)).toBe('slide');
  expect(rateLanding(0.5, 12, 0)).toBe('slide');
  expect(rateLanding(0.5, 15, 0)).toBe('hard');
  expect(rateLanding(3, 5, 0)).toBe('slide');
  expect(rateLanding(5, 12, 0)).toBe('hard');
  expect(rateLanding(7, 12, 0)).toBe('crash');
  expect(rateLanding(0.5, 1.5, 30)).toBe('hard');
  expect(rateLanding(0.5, 1.5, -50)).toBe('crash');
});

test('running is for ground speed: a firm landing with none is still a stand-up', () => {
  expect(rateLanding(1.8, 0.3, 0)).toBe('firm');
  expect(rateLanding(1.8, 3.5, 0)).toBe('run');
  expect(rateLanding(3, 0.3, 0)).toBe('heavy');
});

test('under 15 km/h over the ground nobody slides, whatever the sink that can be stood', () => {
  expect(rateLanding(3.3, 3 / 3.6, 0)).toBe('heavy');
  expect(rateLanding(3.3, 14 / 3.6, 0)).toBe('run');
  expect(rateLanding(3.3, 16 / 3.6, 0)).toBe('slide');
  expect(rateLanding(0.3, 14 / 3.6, 0)).toBe('run');
  expect(rateLanding(0.3, 16 / 3.6, 0)).toBe('slide');
});

test('a steep arrival is taken on the feet when slow over the ground, not with ground speed on top', () => {
  expect(rateLanding(4.9, 3.06, 0)).toBe('run');
  expect(rateLanding(4.9, 8, 0)).toBe('hard');
  expect(rateLanding(6, 2, 0)).toBe('hard');
  expect(rateLanding(6, 8, 0)).toBe('crash');
  expect(rateLanding(7.5, 2, 0)).toBe('crash');
});

/** Fly straight down to the ground, starting the flare at a given feet height. */
function land(flareHeight: number) {
  const env = calmAir();
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  initTrimmed(model, vec3(0, 40, 0), 0, env);
  const c = neutralControls();
  for (let i = 0; i < 60 / SIM_DT; i++) {
    if (feetHeight(model, flat) < flareHeight) {
      c.brakeL = c.brakeR = Math.min(1, c.brakeL + SIM_DT / 1.5);
    }
    model.step(SIM_DT, c, env);
    const touchdown = detectTouchdown(model, flat);
    if (touchdown) return touchdown;
  }
  throw new Error('never landed');
}

test('no flare is a hard landing at trim speed', () => {
  const t = land(-1);
  expect(t.sink).toBeGreaterThan(4);
  expect(t.groundSpeed).toBeGreaterThan(11);
  expect(['hard', 'crash']).toContain(t.rating);
});

test('a flare at the right height is a soft landing, too high is not', () => {
  const heights = [2, 3, 4, 5, 6, 8];
  const sinks = heights.map((h) => land(h).sink);
  const best = Math.min(...sinks);
  expect(best).toBeLessThan(1.5);
  expect(land(15).sink).toBeGreaterThan(best + 1.5);
  expect(land(0.5).sink).toBeGreaterThan(best + 1.5);
});
