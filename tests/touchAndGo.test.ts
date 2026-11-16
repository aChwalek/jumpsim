// Touch and go: the feet brush the ground (a slope of snow, the swoop pond)
// and the canopy flies on.

import { describe, expect, test } from 'vitest';
import { FlightModel, calmAir, neutralControls, type Controls } from '../src/sim/flightModel';
import { SLIDE_FROM, detectTouchdown, feetHeight, type Touchdown } from '../src/sim/landing';
import { deriveRig, rigConfig } from '../src/sim/rig';
import { PLANE_FROM, SKIM_SINK, Skim, planing, slidesOn, type SkimEnd } from '../src/sim/skim';
import { groundNormal, type GroundAt } from '../src/sim/slope';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';

const env = calmAir();
const DEG = Math.PI / 180;
const touch = (sink: number, kmh: number): Touchdown => ({ sink, groundSpeed: kmh / 3.6, bankDeg: 0, rating: 'slide' });

/** Ground falling away to the north (-Z) at `deg` degrees. */
const fallingNorth =
  (deg: number): GroundAt =>
  (_x, z) =>
    z * Math.tan(deg * DEG);

/** A tri-cell 120 at 75 kg in full flight north, its feet `over` metres above `ground` square to it. */
function flying(ground: GroundAt, over: number): FlightModel {
  const model = new FlightModel(deriveRig(rigConfig('triCell', 120, 75)));
  initTrimmed(model, vec3(0, 0, 0), 0, env);
  model.state.pos.y += over - feetHeight(model, ground);
  return model;
}

/** Flies with `controls` until the feet touch, or `seconds` are up. */
function untilTouch(model: FlightModel, ground: GroundAt, controls: Controls = neutralControls(), seconds = 10): Touchdown | null {
  for (let t = 0; t < seconds; t += SIM_DT) {
    model.step(SIM_DT, controls, env);
    const touched = detectTouchdown(model, ground);
    if (touched) return touched;
  }
  return null;
}

/** Slides with `controls(t)` until it ends one way or another, or `seconds` are up. */
function slide(model: FlightModel, ground: GroundAt, controls: (t: number) => Controls, wet = false, seconds = 10) {
  const skim = new Skim(model, ground, () => wet);
  let end: SkimEnd | null = null;
  let t = 0;
  for (; t < seconds && !end; t += SIM_DT) {
    skim.pushOn();
    model.step(SIM_DT, controls(t), env);
    end = skim.after(SIM_DT);
  }
  return { skim, end, t };
}

const flare = (brake: number): Controls => ({ ...neutralControls(), brakeL: brake, brakeR: brake });

describe('on a slope, the feet are judged against it', () => {
  test('flying down along a face and brushing it is a touch, not a fall from the height of the drop', () => {
    const model = flying(fallingNorth(0), 1);
    const glide = Math.atan2(-model.state.vel.y, -model.state.vel.z) / DEG;
    // A face a little gentler than the glide: the canopy closes on it slowly.
    const face = fallingNorth(glide - 4);
    const m = flying(face, 0.5);
    const touchdown = untilTouch(m, face);
    expect(touchdown).not.toBeNull();
    // Coming down far faster than the sink allows a slide, straight down; but not into the face.
    expect(-m.state.vel.y).toBeGreaterThan(SKIM_SINK);
    expect(touchdown!.sink).toBeLessThan(1.5);
    expect(touchdown!.groundSpeed).toBeGreaterThan(SLIDE_FROM);
    expect(slidesOn(touchdown!)).toBe(true);
  });

  test('flying into a slope that rises is hitting it', () => {
    const rising = fallingNorth(-25);
    const m = flying(rising, 2);
    const touchdown = untilTouch(m, rising);
    expect(touchdown).not.toBeNull();
    expect(touchdown!.sink).toBeGreaterThan(5);
    expect(slidesOn(touchdown!)).toBe(false);
    expect(['hard', 'crash']).toContain(touchdown!.rating);
  });

  test('the ground pushes square to the slope', () => {
    const face = fallingNorth(35);
    const n = groundNormal(vec3(), face, 3, -40);
    expect(n.y).toBeCloseTo(Math.cos(35 * DEG), 6);
    expect(n.z).toBeCloseTo(-Math.sin(35 * DEG), 6);
    const m = flying(face, 2);
    m.state.vel.x = m.state.vel.y = m.state.vel.z = 0;
    const skim = new Skim(m, face);
    // The shoes pressed 10 cm into the snow: pushed out of it, back along the slope.
    const shoes = m.pilotPoint(vec3(), skim.contact);
    m.state.pos.y += face(shoes.x, shoes.z) - shoes.y - 0.1;
    skim.pushOn();
    const f = m.footForce;
    const along = Math.hypot(f.x, f.y, f.z);
    expect(along).toBeGreaterThan(0);
    // Mostly square to the slope, with the rub back up it.
    expect((f.x * n.x + f.y * n.y + f.z * n.z) / along).toBeGreaterThan(0.9);
    expect(f.z).toBeGreaterThan(-f.y * Math.tan(35 * DEG));
  });

  test('brushing a face of snow and pulling the toggles: the feet come off it, a touch and go', () => {
    const level = flying(fallingNorth(0), 1);
    const glide = Math.atan2(-level.state.vel.y, -level.state.vel.z) / DEG;
    const face = fallingNorth(glide - 4);
    const m = flying(face, 0.5);
    expect(untilTouch(m, face)).not.toBeNull();
    // A moment on the feet, then half brakes: the canopy lifts away from the face.
    const { skim, end } = slide(m, face, (t) => flare(t < 0.4 ? 0 : 0.6));
    expect(end).toBe('up');
    expect(skim.crouch).toBeLessThan(0.32);
    expect(m.footForce).toEqual(vec3(0, 0, 0));
    // Still flying fast along the face.
    expect(skim.speed).toBeGreaterThan(SLIDE_FROM);
  });

  test('the same touch left alone runs on along the face, on the feet', () => {
    const level = flying(fallingNorth(0), 1);
    const glide = Math.atan2(-level.state.vel.y, -level.state.vel.z) / DEG;
    const face = fallingNorth(glide - 4);
    const m = flying(face, 0.5);
    untilTouch(m, face);
    const { skim, t } = slide(m, face, () => neutralControls());
    // Not thrown down at the first touch.
    expect(t).toBeGreaterThan(0.5);
    expect(skim.distance).toBeGreaterThan(5);
  });
});

describe('on water, the feet plane while fast enough', () => {
  test('too slow to plane is going in', () => {
    expect(slidesOn(touch(0.5, 22), true)).toBe(false);
    expect(slidesOn(touch(0.5, 40), true)).toBe(true);
    // The same on grass is a slide on the feet.
    expect(slidesOn(touch(0.5, 22))).toBe(true);
  });

  test('water holds more of the weight the faster the feet go over it', () => {
    expect(planing(PLANE_FROM - 0.1)).toBe(0);
    expect(planing(PLANE_FROM)).toBeLessThan(0.2);
    expect(planing(42 / 3.6)).toBeCloseTo(0.49, 2);
    expect(planing(60 / 3.6)).toBe(1);
    expect(planing(80 / 3.6)).toBe(1);
    for (let v = PLANE_FROM; v < 17; v += 0.5) expect(planing(v + 0.5)).toBeGreaterThanOrEqual(planing(v));
  });

  /** A classic 107 at 90 kg skimming the pond at full speed out of a dive: the feet on the water. */
  function skimming(): FlightModel {
    const m = new FlightModel(deriveRig(rigConfig('classic', 107, 90)));
    initTrimmed(m, vec3(0, 0, 0), 0, env);
    // Level and fast, as at the bottom of a plane-out.
    m.state.vel.x = 0;
    m.state.vel.y = 0;
    m.state.vel.z = -20;
    m.state.pos.y -= feetHeight(m, flat);
    return m;
  }
  const flat: GroundAt = () => 0;

  test('skimming the pond and pulling up: off the water again, dry', () => {
    const m = skimming();
    const { skim, end } = slide(m, flat, (t) => flare(t < 0.3 ? 0.2 : 0.8), true);
    expect(skim.wet).toBe(true);
    expect(end).toBe('up');
  });

  /**
   * A swoop on a 107 at 90 kg, as on the grass in skim.test.ts: a dive on both
   * front risers from 50 m, planed out by a pilot braking to come down gently,
   * onto the pond, toggles held where they were.
   */
  function swoopOnto(wet: boolean) {
    const m = new FlightModel(deriveRig(rigConfig('classic', 107, 90)));
    initTrimmed(m, vec3(0, 50, 0), 0, env);
    const c = neutralControls();
    let base = 0;
    let touchdown: Touchdown | null = null;
    for (let t = 0; t < 30 && !touchdown; t += SIM_DT) {
      const h = feetHeight(m, flat);
      c.frontL = c.frontR = t < 2.5 ? 1 : 0;
      if (t > 2.5 && h < 15) {
        const err = -Math.max(0.3, 1.2 * (h - 0.3)) - m.state.vel.y;
        base = Math.min(1, Math.max(0, base + SIM_DT * 0.8 * err));
        c.brakeL = c.brakeR = Math.min(1, Math.max(0, base + 0.35 * err));
      }
      m.step(SIM_DT, c, env);
      touchdown = detectTouchdown(m, flat);
    }
    if (!touchdown) throw new Error('never touched down');
    const held = flare(c.brakeL);
    return { touchdown, ...slide(m, flat, () => held, wet) };
  }

  test('the swoop that is run off on the grass goes into the pond at the end of its slide', () => {
    const dry = swoopOnto(false);
    const wet = swoopOnto(true);
    expect(slidesOn(wet.touchdown, true)).toBe(true);
    expect(dry.end).toBe('run');
    expect(wet.end).toBe('fall');
    expect(wet.skim.wet).toBe(true);
    // Touched as slowly as a swoop run off on grass, about 32 km/h: a metre over the water, then in, still going.
    expect(wet.skim.distance).toBeGreaterThan(0.5);
    expect(wet.skim.distance).toBeLessThan(dry.skim.distance);
    expect(wet.skim.speed).toBeGreaterThan(SLIDE_FROM);
  });

  test('the water slows the feet more than the grass does', () => {
    const wet = slide(skimming(), flat, () => flare(0.3), true, 0.5);
    const dry = slide(skimming(), flat, () => flare(0.3), false, 0.5);
    expect(wet.end).toBeNull();
    expect(dry.end).toBeNull();
    expect(wet.skim.speed).toBeLessThan(dry.skim.speed);
  });
});
