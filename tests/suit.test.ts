// Tracking suits and wingsuits, three levels each. Numbers checked against
// what their pilots log: a plain jumpsuit tracks about a metre forward for a
// metre down, a tracking suit up to nearly two; a first wingsuit glides about
// 2, a big one about 3, falling 50 to 70 km/h.

import { describe, expect, test } from 'vitest';
import { readHello } from '../src/net/multiplayer';
import { defaultSetup, sameSuit, validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { Freefall, freefallParams, noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { JUMPSUIT, suitFit, suitGlide, type Suit, type SuitLevel } from '../src/sim/suit';
import { SIM_DT } from '../src/sim/telemetry';
import { set, vec3 } from '../src/sim/vec';

const LEVELS: SuitLevel[] = [1, 2, 3];

/** Belly to earth at 1500 m in this suit, then stretched out (or the wings flown) for a while. */
function flown(suit: Suit, input: Partial<BodyInputs> = {}, position: 'belly' | 'back' = 'belly', seconds = 70) {
  const body = new Freefall(freefallParams(90, suitFit(suit)));
  const env: Environment = { wind: vec3(), airDensity: airDensityAt(1500) };
  set(body.state.pos, 0, 1500, 0);
  set(body.state.vel, 0, -50, 0);
  const a = -Math.PI / 4;
  Object.assign(body.state.att, { x: Math.sin(a), y: 0, z: 0, w: Math.cos(a) });
  body.setPosition(position);
  for (let i = 0; i < 8 / SIM_DT; i++) {
    body.state.pos.y = 1500;
    body.step(SIM_DT, noBodyInputs(), env);
  }
  const flatKmh = -body.state.vel.y * 3.6;
  body.tracking = true;
  let turned = 0;
  for (let i = 0; i < seconds / SIM_DT; i++) {
    body.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    body.state.pos.y = 1500;
    turned += body.state.yawRate * SIM_DT;
  }
  const v = body.state.vel;
  const across = Math.hypot(v.x, v.z);
  return { flat: flatKmh, glide: across / -v.y, across: across * 3.6, down: -v.y * 3.6, turnSeconds: seconds / (Math.abs(turned) / (2 * Math.PI)) };
}

describe('tracking suits', () => {
  test('each level tracks further than the one before, and falls slower', () => {
    const plain = flown(JUMPSUIT);
    const levels = LEVELS.map((level) => flown({ kind: 'track', level }));
    let before = plain;
    for (const t of levels) {
      expect(t.glide).toBeGreaterThan(before.glide + 0.15);
      expect(t.down).toBeLessThan(before.down);
      before = t;
    }
    expect(levels[0]!.glide).toBeGreaterThan(1.2);
    expect(levels[2]!.glide).toBeGreaterThan(1.7);
    expect(levels[2]!.glide).toBeLessThan(2.1);
    // Fast across the sky, as tracking suits are.
    expect(levels[2]!.across).toBeGreaterThan(170);
    expect(levels[2]!.across).toBeLessThan(230);
    expect(levels[2]!.down).toBeGreaterThan(90);
    expect(levels[2]!.down).toBeLessThan(130);
  });

  test('belly to earth, about as a jumpsuit: a little slower in a bigger one', () => {
    const plain = flown(JUMPSUIT).flat;
    const big = flown({ kind: 'track', level: 3 }).flat;
    expect(big).toBeLessThan(plain);
    expect(big).toBeGreaterThan(plain * 0.85);
  });
});

describe('wingsuits', () => {
  test('glide about 2 on a first one, 3 on a big one, falling 50 to 70 km/h', () => {
    const [w1, w2, w3] = LEVELS.map((level) => flown({ kind: 'wingsuit', level }));
    expect(w1!.glide).toBeGreaterThan(1.8);
    expect(w1!.glide).toBeLessThan(2.3);
    expect(w2!.glide).toBeGreaterThan(w1!.glide + 0.25);
    expect(w3!.glide).toBeGreaterThan(w2!.glide + 0.25);
    expect(w3!.glide).toBeLessThan(3.4);
    for (const w of [w1!, w2!, w3!]) {
      expect(w.down).toBeGreaterThan(45);
      expect(w.down).toBeLessThan(75);
      expect(w.across).toBeGreaterThan(120);
      expect(w.across).toBeLessThan(175);
    }
    expect(w3!.down).toBeLessThan(w1!.down);
  });

  test('pushed it dives, held back it slows; wings tight go faster, wide slower', () => {
    const suit: Suit = { kind: 'wingsuit', level: 2 };
    const neutral = flown(suit);
    const dive = flown(suit, { forward: 1 });
    const flare = flown(suit, { forward: -1 });
    expect(dive.across).toBeGreaterThan(neutral.across + 15);
    expect(dive.down).toBeGreaterThan(neutral.down);
    expect(flare.across).toBeLessThan(neutral.across - 20);
    expect(flare.glide).toBeLessThan(neutral.glide);
    const tight = flown(suit, { fall: 1 });
    const wide = flown(suit, { fall: -1 });
    expect(tight.down).toBeGreaterThan(neutral.down + 5);
    expect(wide.down).toBeLessThan(neutral.down - 5);
    // The same wing: about the same glide either way.
    expect(Math.abs(tight.glide - neutral.glide)).toBeLessThan(0.2);
    expect(Math.abs(wide.glide - neutral.glide)).toBeLessThan(0.2);
  });

  test('on the back, a little less well; turns are slow, slower on a bigger one', () => {
    const suit: Suit = { kind: 'wingsuit', level: 1 };
    const belly = flown(suit);
    const back = flown(suit, {}, 'back');
    expect(back.glide).toBeGreaterThan(1.5);
    expect(back.glide).toBeLessThan(belly.glide);
    const plain = flown(JUMPSUIT, { turn: 1 }, 'belly', 20).turnSeconds;
    const w1 = flown(suit, { turn: 1 }, 'belly', 20).turnSeconds;
    const w3 = flown({ kind: 'wingsuit', level: 3 }, { turn: 1 }, 'belly', 20).turnSeconds;
    expect(w1).toBeGreaterThan(2 * plain);
    expect(w1).toBeGreaterThan(6);
    expect(w3).toBeGreaterThan(w1);
    expect(w3).toBeLessThan(15);
  });

  test('the menu reads the same glide', () => {
    const g = suitGlide({ kind: 'wingsuit', level: 3 }, 90);
    const f = flown({ kind: 'wingsuit', level: 3 });
    expect(g.glide).toBeCloseTo(f.glide, 1);
    expect(suitGlide({ kind: 'wingsuit', level: 3 }, 90)).toBe(g);
  });
});

describe('a wingsuit jump', () => {
  function outOfThePlane(suit: Suit) {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(4000) };
    const jump = new Jump(model, { x: 0, z: 0, height: 4000, headingDeg: 270, indicatedAirspeed: 40 }, env, () => 0, () => 0.5, { suit });
    const step = (input: Partial<BodyInputs> = {}) => {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, { ...noBodyInputs(), ...input }, env);
    };
    return { jump, step };
  }

  test('the wings fill by themselves out of the door and fly, Shift or not', () => {
    const { jump, step } = outOfThePlane({ kind: 'wingsuit', level: 2 });
    expect(jump.wings).toBe(true);
    jump.act();
    for (let i = 0; i < 20 / SIM_DT; i++) {
      jump.trackIt(false);
      step();
    }
    const v = jump.body.state.vel;
    expect(jump.body.track).toBeGreaterThan(0.99);
    expect(Math.hypot(v.x, v.z) / -v.y).toBeGreaterThan(2);
    expect(-v.y * 3.6).toBeLessThan(80);
  });

  test('belly or back only: no sitting, no head down, no somersault', () => {
    const { jump, step } = outOfThePlane({ kind: 'wingsuit', level: 1 });
    jump.fly('headDown');
    expect(jump.body.position).toBe('belly');
    jump.act();
    for (let i = 0; i < 5 / SIM_DT; i++) step();
    jump.fly('sit');
    jump.flip(1);
    expect(jump.body.position).toBe('belly');
    jump.roll(1);
    expect(jump.body.position).toBe('back');
  });

  test('Space lets go of the wings: flat for a moment, then the pull, the canopy out well over the ground', () => {
    const { jump, step } = outOfThePlane({ kind: 'wingsuit', level: 3 });
    jump.act();
    for (let i = 0; i < 30 / SIM_DT; i++) step();
    jump.act();
    expect(jump.pullWhenFlat).toBe(true);
    expect(jump.body.tracking).toBe(false);
    let t = 0;
    while (jump.phase === 'freefall' && t < 10) {
      step();
      t += SIM_DT;
    }
    expect(jump.phase).toBe('opening');
    expect(t).toBeLessThan(4);
    for (let i = 0; i < 20 / SIM_DT && jump.phase !== 'canopy'; i++) step();
    expect(jump.phase).toBe('canopy');
    expect(jump.impact).toBe(false);
  });

  test('a long way from the plane: twice and more what a jumpsuit tracks from the same height', () => {
    const across = (suit: Suit) => {
      const { jump, step } = outOfThePlane(suit);
      jump.act();
      for (let i = 0; i < 300 / SIM_DT && jump.height() > 1200; i++) {
        jump.trackIt(true);
        step();
      }
      return Math.hypot(jump.body.state.pos.x, jump.body.state.pos.z);
    };
    const plain = across(JUMPSUIT);
    const wings = across({ kind: 'wingsuit', level: 2 });
    expect(wings).toBeGreaterThan(2 * plain);
    // 2800 m down at a glide of about 2.5, through air thinning less as it goes.
    expect(wings).toBeGreaterThan(5500);
    expect(wings).toBeLessThan(9000);
  });

  test('a plain jumpsuit still tracks only on Shift', () => {
    const { jump, step } = outOfThePlane(JUMPSUIT);
    expect(jump.wings).toBe(false);
    jump.act();
    for (let i = 0; i < 5 / SIM_DT; i++) {
      jump.trackIt(false);
      step();
    }
    expect(jump.body.tracking).toBe(false);
    expect(jump.body.track).toBeLessThan(0.01);
  });
});

describe('the suit in the setup', () => {
  test('a jumpsuit by default; a saved suit comes back, a bad one does not', () => {
    expect(defaultSetup().gear.suit).toBe('jumpsuit');
    const saved = validSetup({ gear: { suit: 'wingsuit', suitLevel: 3 } });
    expect(saved.gear.suit).toBe('wingsuit');
    expect(saved.gear.suitLevel).toBe(3);
    const bad = validSetup({ gear: { suit: 'cape', suitLevel: 7 } });
    expect(bad.gear.suit).toBe('jumpsuit');
    expect(bad.gear.suitLevel).toBe(1);
  });

  test('a plain jumpsuit has no level to tell two apart', () => {
    const a = defaultSetup().gear;
    expect(sameSuit(a, { ...a, suitLevel: 3 })).toBe(true);
    expect(sameSuit({ ...a, suit: 'track' }, { ...a, suit: 'track', suitLevel: 2 })).toBe(false);
    expect(sameSuit(a, { ...a, suit: 'wingsuit' })).toBe(false);
  });

  test('someone on an older version, with no suit, jumps in a plain jumpsuit', () => {
    const { suit: _suit, suitLevel: _level, ...old } = defaultSetup().gear;
    const hello = readHello({ type: 'hello', dz: 'valbrise', gear: old });
    expect(hello?.gear.suit).toBe('jumpsuit');
    expect(hello?.gear.suitLevel).toBe(1);
    const winged = readHello({ type: 'hello', dz: 'valbrise', gear: { ...old, suit: 'wingsuit', suitLevel: 2 } });
    expect(winged?.gear.suit).toBe('wingsuit');
    expect(winged?.gear.suitLevel).toBe(2);
  });
});
