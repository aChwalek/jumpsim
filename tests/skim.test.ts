import { describe, expect, test } from 'vitest';
import { FlightModel, calmAir, neutralControls } from '../src/sim/flightModel';
import { SLIDE_FROM, detectTouchdown, feetHeight, type Touchdown } from '../src/sim/landing';
import { deriveRig, rigConfig } from '../src/sim/rig';
import { SKIM_SINK, Skim, bearable, slidesOn, type LegAngles, type SkimEnd } from '../src/sim/skim';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';

const flat = () => 0;
const env = calmAir();
const touch = (sink: number, kmh: number, bankDeg = 0): Touchdown => ({ sink, groundSpeed: kmh / 3.6, bankDeg, rating: 'slide' });

describe('when the feet slide on', () => {
  test('too fast to run, gently down and level', () => {
    expect(slidesOn(touch(0.5, 30))).toBe(true);
    expect(slidesOn(touch(SKIM_SINK - 0.1, 60))).toBe(true);
  });

  test('not slow enough to run off, not too hard, not banked', () => {
    expect(slidesOn(touch(0.5, 14))).toBe(false);
    expect(slidesOn(touch(SKIM_SINK + 0.1, 30))).toBe(false);
    expect(slidesOn(touch(0.5, 30, 25))).toBe(false);
    expect(slidesOn(touch(0.5, 30, -25))).toBe(false);
  });
});

test('the legs hold less of the weight the faster they slide, all of it at a run', () => {
  expect(bearable(SLIDE_FROM)).toBe(1);
  expect(bearable(2)).toBe(1);
  expect(bearable(20)).toBeCloseTo(0.45);
  for (let v = SLIDE_FROM; v < 12; v += 0.5) expect(bearable(v + 0.5)).toBeLessThanOrEqual(bearable(v));
});

/**
 * A swoop on a 107 at 90 kg: a dive on both front risers from 50 m, planed
 * out by a pilot who brakes to come down gently, until the feet touch. Then
 * `after` says what the toggles do while the feet slide.
 */
function swoop(after: (brake: number) => number) {
  const model = new FlightModel(deriveRig(rigConfig('classic', 107, 90)));
  initTrimmed(model, vec3(0, 50, 0), 0, env);
  const c = neutralControls();
  let base = 0;
  let touchdown: Touchdown | null = null;
  for (let t = 0; t < 30 && !touchdown; t += SIM_DT) {
    const h = feetHeight(model, flat);
    c.frontL = c.frontR = t < 2.5 ? 1 : 0;
    if (t > 2.5 && h < 15) {
      const err = -Math.max(0.3, 1.2 * (h - 0.3)) - model.state.vel.y;
      base = Math.min(1, Math.max(0, base + SIM_DT * 0.8 * err));
      c.brakeL = c.brakeR = Math.min(1, Math.max(0, base + 0.35 * err));
    }
    model.step(SIM_DT, c, env);
    touchdown = detectTouchdown(model, flat);
  }
  if (!touchdown) throw new Error('never touched down');
  const skim = new Skim(model, flat);
  const held = c.brakeL;
  let end: SkimEnd | null = null;
  let lowest = Infinity;
  for (let t = 0; t < 10 && !end; t += SIM_DT) {
    c.brakeL = c.brakeR = after(held);
    skim.pushOn();
    model.step(SIM_DT, c, env);
    end = skim.after(SIM_DT);
    lowest = Math.min(lowest, model.state.pos.y);
  }
  return { touchdown, skim, end, model, lowest };
}

describe('a swoop that touches down fast', () => {
  test('it comes in too fast to run and gently enough to slide', () => {
    const { touchdown } = swoop((b) => b);
    expect(slidesOn(touchdown)).toBe(true);
  });

  test('toggles kept down, the canopy carries the pilot along: slid on the feet, then run off', () => {
    const { skim, end } = swoop((b) => b);
    expect(end).toBe('run');
    expect(skim.distance).toBeGreaterThan(3);
    expect(skim.speed).toBeLessThan(SLIDE_FROM);
    // Weight came onto the legs as the canopy slowed, never too much of it.
    expect(skim.peak).toBeGreaterThan(0.5);
  });

  test('finishing the flare on the ground slides on too', () => {
    expect(swoop(() => 1).end).toBe('run');
  });

  test('hands up on the ground, the canopy dives away and the weight lands on the legs: down', () => {
    const { skim, end } = swoop(() => 0);
    expect(end).toBe('fall');
    expect(skim.speed).toBeGreaterThan(SLIDE_FROM);
    expect(skim.distance).toBeLessThan(3);
  });

  test('the ground holds the pilot up: the feet never go through it', () => {
    const { skim, model } = swoop((b) => b);
    expect(skim.crouch).toBeLessThan(0.32);
    // Nothing of the push is left on the model once it is over.
    expect(model.footForce).toEqual(vec3(0, 0, 0));
  });
});

test('the feet coming up off the ground again is flying again', () => {
  const model = new FlightModel(deriveRig(rigConfig('classic', 170, 90)));
  initTrimmed(model, vec3(0, 0, 0), 0, env);
  const skim = new Skim(model, flat);
  // The shoes just on the grass at full flight speed, the canopy climbing as
  // it does for a moment out of a flare.
  model.state.pos.y -= feetHeight(model, flat) + skim.contact.y - model.rig.feetPos.y;
  model.state.vel.y = 4;
  let end: SkimEnd | null = null;
  for (let t = 0; t < 3 && !end; t += SIM_DT) {
    skim.pushOn();
    model.step(SIM_DT, neutralControls(), env);
    end = skim.after(SIM_DT);
  }
  expect(end).toBe('up');
  expect(skim.distance).toBe(0);
});

test('the legs reach the ground ahead, and bend at the knee under the weight', () => {
  const model = new FlightModel(deriveRig(rigConfig('classic', 170, 90)));
  initTrimmed(model, vec3(0, 50, 0), 0, env);
  const skim = new Skim(model, flat);
  const light: LegAngles = skim.legs({ hip: 0, knee: 0 });
  expect(light.hip).toBeGreaterThan(0.3);
  expect(light.knee).toBeGreaterThan(0);
  expect(light.knee).toBeLessThan(0.6);
  skim.crouch = 0.15;
  const loaded = skim.legs({ hip: 0, knee: 0 });
  expect(loaded.knee).toBeGreaterThan(light.knee + 0.3);
  expect(loaded.hip).toBeGreaterThan(light.hip);
});
