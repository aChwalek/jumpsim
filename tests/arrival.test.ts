import { describe, expect, test } from 'vitest';
import { Arrival, LEGS_HANGING, arrivalKind, type ArrivalKind } from '../src/sim/arrival';
import { FlightModel, calmAir, neutralControls } from '../src/sim/flightModel';
import { detectTouchdown, feetHeight, rateLanding, type Touchdown } from '../src/sim/landing';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { DEG, rotate, vec3, type Quat } from '../src/sim/vec';

const flat = () => 0;
const FRAME = 1 / 60;

/** Fly down to the ground, flaring from a given height, with a wind from behind or ahead. */
function landed(flareHeight: number, tailwind = 0) {
  const env = { ...calmAir(), wind: vec3(0, 0, -tailwind) };
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  initTrimmed(model, vec3(0, 40, 0), 0, env);
  const c = neutralControls();
  for (let i = 0; i < 60 / SIM_DT; i++) {
    if (feetHeight(model, flat) < flareHeight) c.brakeL = c.brakeR = Math.min(1, c.brakeL + SIM_DT / 1.5);
    model.step(SIM_DT, c, env);
    const touchdown = detectTouchdown(model, flat);
    if (touchdown) return { model, touchdown, env };
  }
  throw new Error('never landed');
}

const lean = (q: Quat): number => Math.acos(Math.min(1, rotate(vec3(), q, vec3(0, 1, 0)).y)) / DEG;

/** Plays an arrival to its end and reports what happened on the way. */
function played(arrival: Arrival, model: FlightModel) {
  const s = model.state;
  const start = { x: s.pos.x, z: s.pos.z };
  let lowest = Infinity;
  let jump = 0;
  let seconds = 0;
  while (!arrival.done && seconds < 20) {
    const before = { ...s.pos };
    arrival.update(FRAME);
    seconds += FRAME;
    jump = Math.max(jump, Math.hypot(s.pos.x - before.x, s.pos.y - before.y, s.pos.z - before.z));
    lowest = Math.min(lowest, s.pos.y);
    for (const q of [s.att, s.pilotAtt]) expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
  }
  // The canopy takes a little longer than the pilot to come down.
  for (let i = 0; i < 3 / FRAME; i++) arrival.update(FRAME);
  return {
    seconds,
    distance: Math.hypot(s.pos.x - start.x, s.pos.z - start.z),
    lowest,
    jump,
    shoulders: s.pos.y,
    lean: lean(s.pilotAtt),
    canopy: model.worldPoint(vec3(), model.rig.canopyPos),
  };
}

/** An arrival made up from a touchdown speed rather than flown. */
function staged(sink: number, groundSpeed: number, wet = false) {
  const { model, env } = landed(4);
  const touchdown: Touchdown = { sink, groundSpeed, bankDeg: 0, rating: rateLanding(sink, groundSpeed, 0) };
  return { model, arrival: new Arrival(model, touchdown, { groundAt: flat, wet, wind: env.wind }) };
}

test('each verdict gets its own way of arriving', () => {
  const kind = (sink: number, speed: number, wet = false): ArrivalKind =>
    arrivalKind({ sink, groundSpeed: speed, bankDeg: 0, rating: rateLanding(sink, speed, 0) }, wet);
  expect(kind(0.5, 1)).toBe('steps');
  expect(kind(1.8, 0.3)).toBe('steps');
  expect(kind(0.5, 3.5)).toBe('run');
  expect(kind(0.5, 10)).toBe('slide');
  expect(kind(3.3, 0.8)).toBe('steps');
  expect(kind(4.9, 3)).toBe('run');
  expect(kind(5, 12)).toBe('tumble');
  expect(kind(8, 12)).toBe('tumble');
  expect(kind(0.5, 10, true)).toBe('splash');
  expect(kind(8, 12, true)).toBe('tumble');
});

describe('on the ground', () => {
  test('it takes over from the flight without a jump', () => {
    const { model, touchdown, env } = landed(4);
    const s = model.state;
    const before = { pos: { ...s.pos }, tilt: lean(s.pilotAtt), canopy: lean(s.att) };
    const arrival = new Arrival(model, touchdown, { groundAt: flat, wet: false, wind: env.wind });
    arrival.update(1 / 240);
    expect(Math.hypot(s.pos.x - before.pos.x, s.pos.y - before.pos.y, s.pos.z - before.pos.z)).toBeLessThan(0.05);
    expect(Math.abs(lean(s.pilotAtt) - before.tilt)).toBeLessThan(0.5);
    expect(Math.abs(lean(s.att) - before.canopy)).toBeLessThan(0.5);
    expect(arrival.legL).toBeCloseTo(LEGS_HANGING, 2);
  });

  test('a good flare into wind is walked off in a few steps, standing', () => {
    const { model, arrival } = staged(0.8, 1.5);
    const end = played(arrival, model);
    expect(arrival.kind).toBe('steps');
    expect(arrival.steps).toBeLessThan(5);
    expect(end.distance).toBeLessThan(2);
    expect(end.shoulders).toBeCloseTo(1.4, 1);
    expect(end.lean).toBeLessThan(3);
    expect(end.seconds).toBeLessThan(2.5);
  });

  test('ground speed is run off over several strides', () => {
    const { model, arrival } = staged(0.5, 4);
    const end = played(arrival, model);
    expect(arrival.kind).toBe('run');
    expect(arrival.steps).toBeGreaterThanOrEqual(3);
    expect(arrival.steps).toBeLessThan(12);
    expect(end.distance).toBeGreaterThan(2.2);
    expect(end.distance).toBeLessThan(4.5);
    expect(end.shoulders).toBeCloseTo(1.4, 1);
    expect(arrival.speed).toBe(0);
  });

  test('more is slid off sitting down, further the faster', () => {
    const slow = staged(0.5, 8);
    const fast = staged(0.5, 13);
    const [a, b] = [played(slow.arrival, slow.model), played(fast.arrival, fast.model)];
    expect(fast.arrival.kind).toBe('slide');
    expect(a.shoulders).toBeLessThan(0.8);
    expect(a.shoulders).toBeGreaterThan(0.5);
    expect(a.distance).toBeGreaterThan(5);
    expect(b.distance).toBeGreaterThan(a.distance * 2);
    expect(b.distance).toBeLessThan(25);
    expect(fast.arrival.legL).toBeGreaterThan(1);
  });

  test('a steep arrival with little ground speed is taken on deeply bent legs, and stood up', () => {
    const { model, arrival } = staged(4.9, 1);
    const end = played(arrival, model);
    expect(arrival.kind).toBe('steps');
    expect(end.lowest).toBeLessThan(1.15);
    expect(end.lowest).toBeGreaterThan(0.9);
    expect(end.shoulders).toBeCloseTo(1.4, 1);
    expect(end.lean).toBeLessThan(3);
  });

  test('a hard landing ends on the ground and stays there', () => {
    const { model, arrival } = staged(6, 12);
    const end = played(arrival, model);
    expect(arrival.kind).toBe('tumble');
    expect(end.shoulders).toBeLessThan(0.4);
    expect(end.lean).toBeGreaterThan(60);
  });

  test('the pond stops the feet short and comes up to the thighs', () => {
    const { model, arrival } = staged(0.5, 10, true);
    const end = played(arrival, model);
    expect(arrival.kind).toBe('splash');
    expect(end.distance).toBeLessThan(7);
    expect(end.shoulders).toBeCloseTo(0.75, 1);
  });

  test('nothing ever jumps from one frame to the next, and the canopy ends up on the ground downwind', () => {
    for (const [sink, speed] of [[0.5, 1], [0.5, 5], [0.5, 12], [4.9, 3], [6, 12], [9, 14]] as const) {
      const { model, arrival } = staged(sink, speed);
      const from = { ...model.state.pos };
      const end = played(arrival, model);
      expect(end.jump).toBeLessThan(0.35);
      expect(end.canopy.y).toBeLessThan(1);
      // The staged landings have no wind: the canopy carries on ahead (north, -Z).
      expect(end.canopy.z).toBeLessThan(model.state.pos.z - 2);
      expect(model.state.pos.z).toBeLessThanOrEqual(from.z);
    }
    const { model, touchdown, env } = landed(4, -3);
    const arrival = new Arrival(model, touchdown, { groundAt: flat, wet: false, wind: env.wind });
    const end = played(arrival, model);
    expect(end.canopy.z).toBeGreaterThan(model.state.pos.z + 2); // blown back by the headwind
  });
});

describe('walking off once down', () => {
  const walkAfter = (sink: number, groundSpeed: number) => {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    initTrimmed(model, vec3(0, 0, 0), 0, calmAir());
    const s = model.state;
    s.pos.y = -model.rig.feetPos.y;
    const touchdown: Touchdown = { sink, groundSpeed, bankDeg: 0, rating: rateLanding(sink, groundSpeed, 0) };
    const arrival = new Arrival(model, touchdown, { groundAt: flat, wet: false, wind: vec3() });
    const still = { forward: 0, turn: 0, slide: 0, fall: 0 };
    for (let i = 0; i < 20 / FRAME && !arrival.done; i++) arrival.update(FRAME, still);
    return { model, arrival };
  };

  test('a stand-up landing can walk off once at rest, on its feet, a step at a time', () => {
    const { model, arrival } = walkAfter(1, 1);
    expect(arrival.canWalk).toBe(true);
    const s = model.state;
    const from = { x: s.pos.x, z: s.pos.z };
    const steps = arrival.steps;
    for (let i = 0; i < 4 / FRAME; i++) arrival.update(FRAME, { forward: 1, turn: 0, slide: 0, fall: 0 });
    expect(arrival.walker).not.toBeNull();
    expect(Math.hypot(s.pos.x - from.x, s.pos.z - from.z)).toBeGreaterThan(5);
    expect(arrival.steps - steps).toBeGreaterThan(4);
    // Upright, standing on the feet.
    expect(feetHeight(model, flat)).toBeCloseTo(0, 1);
    expect(lean(s.pilotAtt)).toBeLessThan(5);
  });

  test('nobody walks off a crash', () => {
    const { arrival } = walkAfter(8, 6);
    expect(arrival.canWalk).toBe(false);
    arrival.update(FRAME, { forward: 1, turn: 0, slide: 0, fall: 0 });
    expect(arrival.walker).toBeNull();
    expect(arrival.getUp()).toBeNull();
  });

  test('turned by the mouse at rest, before walking: up on the feet and facing that way', () => {
    const { model, arrival } = walkAfter(1, 1);
    const ahead = () => {
      const a = rotate(vec3(), model.state.pilotAtt, vec3(0, 0, -1));
      return Math.atan2(a.x, -a.z) / DEG;
    };
    const before = ahead();
    arrival.getUp()!.turnBy(90 * DEG);
    const still = { forward: 0, turn: 0, slide: 0, fall: 0 };
    for (let i = 0; i < 1 / FRAME; i++) arrival.update(FRAME, still);
    expect((((ahead() - before) % 360) + 360) % 360).toBeCloseTo(90, 0);
  });
});
