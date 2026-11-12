// Millau: the A75 viaduct over the Tarn, curved, climbing to the south,
// cable-stayed, drawn from OSM and the published figures, and a jump off its
// lip down to the meadow on the river bank under it.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, calmAir, neutralControls, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { detectTouchdown, feetHeight } from '../src/sim/landing';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { STAND_OUT } from '../src/sim/runUp';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { frameOf } from '../src/world/bridge';
import { DATA } from '../src/world/data/millau';
import { inRect, solidOf, spawnsFor } from '../src/world/dz';
import { dzInfo } from '../src/world/dzs';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';

const dz = createRealDz(DATA, LOOKS.millau);
const solid = solidOf(dz);
const b = dz.base!;
const deck = dz.bridges![0]!;
const f = frameOf(deck);
const DEG = Math.PI / 180;
const jumpKey: BodyInputs = { ...noBodyInputs(), forward: 1 };
/** A point on the deck: `s` metres along it from its north end, `u` to its right (west). */
const onDeck = (s: number, u: number) => {
  const [x, z] = f.world(s, u);
  return { x, z };
};
/** Metres out from the exit, along its heading. */
const out = (x: number, z: number) => (x - b.x) * Math.sin(b.headingDeg * DEG) - (z - b.z) * Math.cos(b.headingDeg * DEG);
const EXIT = 712;

describe('the viaduct', () => {
  test('the meadow is flat, at the level of the plain, with nothing over it', () => {
    expect(dz.groundAt(dz.target.x, dz.target.z)).toBe(0);
    expect(Math.abs(dz.groundAt(dz.target.x - 30, dz.target.z + 20))).toBeLessThan(1);
    expect(solid(dz.target.x, dz.target.z)).toBe(dz.groundAt(dz.target.x, dz.target.z));
  });

  test('2460 m on a 20 km curve, eight spans on seven piers', () => {
    expect(f.length).toBeGreaterThan(2455);
    expect(f.length).toBeLessThan(2480);
    expect(deck.piers).toHaveLength(7);
    for (let i = 1; i < 7; i++) expect(deck.piers[i]! - deck.piers[i - 1]!).toBe(342);
    // The middle of the deck lies some 38 m west of the straight line between its ends.
    const mid = onDeck(f.length / 2, 0);
    const chord = { x: (deck.a[0] + deck.b[0]) / 2, z: (deck.a[1] + deck.b[1]) / 2 };
    expect(chord.x - mid.x).toBeGreaterThan(30);
    expect(chord.x - mid.x).toBeLessThan(45);
    // The frame turns both ways.
    const back = f.local(mid.x, mid.z);
    expect(back.s).toBeCloseTo(f.length / 2, 6);
    expect(back.u).toBeCloseTo(0, 6);
  });

  test('the road climbs 3 % to the south: 74 m over the whole', () => {
    const north = onDeck(20, 5);
    const south = onDeck(f.length - 20, 5);
    expect(solid(south.x, south.z) - solid(north.x, north.z)).toBeCloseTo(0.03025 * (f.length - 40), 3);
  });

  test('some 270 m over the Tarn, the main span between P2 and P3', () => {
    const lowest = Math.min(...Array.from({ length: 100 }, (_, k) => dz.groundAt(...f.world(deck.piers[1]! + (342 * k) / 100, 0))));
    const road = f.road(EXIT);
    expect(road - lowest).toBeGreaterThan(270);
    expect(road - lowest).toBeLessThan(290);
    // P2 stands some 245 m tall, its foot on the slope.
    const p2 = onDeck(deck.piers[1]!, 0);
    expect(f.road(deck.piers[1]!) - 4.2 - dz.groundAt(p2.x, p2.z)).toBeGreaterThan(225);
    expect(f.road(deck.piers[1]!) - 4.2 - dz.groundAt(p2.x, p2.z)).toBeLessThan(260);
  });

  test('the exit: on the lip, outside the wind screen, square to the road, over the void', () => {
    expect(b.runUp).toBe(0);
    expect(b.height).toBeCloseTo(f.road(EXIT), 0);
    expect(solid(b.x, b.z)).toBeCloseTo(f.road(EXIT), 1);
    // West, square to the deck, which runs a little east of south there.
    expect(b.headingDeg).toBeGreaterThan(255);
    expect(b.headingDeg).toBeLessThan(275);
    const back = { x: b.x - Math.sin(b.headingDeg * DEG) * 0.4, z: b.z + Math.cos(b.headingDeg * DEG) * 0.4 };
    expect(solid(back.x, back.z) - f.road(EXIT)).toBeCloseTo(3, 1);
    const ahead = { x: b.x + Math.sin(b.headingDeg * DEG), z: b.z - Math.cos(b.headingDeg * DEG) };
    expect(solid(ahead.x, ahead.z)).toBeLessThan(10);
    // The meadow ahead and below, a hundred metres or two out.
    expect(out(dz.target.x, dz.target.z)).toBeGreaterThan(60);
    expect(Math.hypot(dz.target.x - b.x, dz.target.z - b.z)).toBeLessThan(250);
  });

  test('a BASE start, from the lip of the deck', () => {
    expect(validSetup({ dz: 'millau', jump: { start: 'base' } }).jump.start).toBe('base');
    expect(dzInfo('millau').base).toEqual({ height: Math.round(b.height), standing: true });
  });
});

describe('what is solid', () => {
  test('the deck to whoever is on it, the ground to whoever flies under it', () => {
    const p = onDeck(EXIT, 0);
    const ground = dz.groundAt(p.x, p.z);
    const lane = onDeck(EXIT, 8);
    expect(solid(lane.x, lane.z)).toBeCloseTo(f.road(EXIT), 6);
    expect(solid(lane.x, lane.z, f.road(EXIT) - 1)).toBeCloseTo(f.road(EXIT), 6);
    expect(solid(p.x, p.z, ground + 100)).toBe(ground);
  });

  test('a pylon over each pier, its mast up to 89 m over the road', () => {
    for (const s of deck.piers) {
      const p = onDeck(s, 0);
      expect(solid(p.x, p.z)).toBeCloseTo(f.road(s) + 88.9, 1);
      // Between its legs, low down, the road.
      expect(solid(p.x, p.z, f.road(s) + 1)).toBeCloseTo(f.road(s), 6);
      // On a leg, low down.
      const leg = onDeck(s + 6.2, 0);
      expect(solid(leg.x, leg.z, f.road(s) + 1)).toBeCloseTo(f.road(s) + 88.9, 1);
    }
  });

  test('a pier is solid from the ground up; under the deck, its two shafts have air between them', () => {
    for (const s of deck.piers) {
      const p = onDeck(s, 0);
      const road = f.road(s);
      // Under the deck, between the shafts.
      expect(solid(p.x, p.z, road - 30)).toBe(dz.groundAt(p.x, p.z));
      // In a shaft.
      const shaft = onDeck(s + 5.5, 0);
      expect(solid(shaft.x, shaft.z, road - 30)).toBeCloseTo(f.road(s + 5.5), 6);
    }
    // Low down on P2, one trunk.
    const p2 = onDeck(deck.piers[1]!, 0);
    expect(solid(p2.x, p2.z, dz.groundAt(p2.x, p2.z) + 20)).toBeCloseTo(f.road(deck.piers[1]!), 6);
  });

  test('nothing grows into the deck or a pier, and no building stands under it', () => {
    for (const t of dz.trees) {
      const top = dz.groundAt(t.x, t.z) + t.height;
      expect(solid(t.x, t.z, top)).toBeLessThan(top);
    }
    for (const h of dz.buildings) expect(solid(h.x, h.z, dz.groundAt(h.x, h.z) + 1)).toBe(dz.groundAt(h.x, h.z));
  });
});

describe('off the viaduct', () => {
  function jumpOff(headingDeg = b.headingDeg) {
    const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(620) };
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg, height: b.height, standing: true } as const;
    const jump = new Jump(model, ledge, env, dz.groundAt, () => 0.5, {
      solidAt: solid,
      container: 'base',
      reserve: deriveRig(reserveConfig(90)),
    });
    const until = (done: () => boolean, seconds: number, input = noBodyInputs()) => {
      for (let t = 0; t < seconds && !done(); t += SIM_DT) {
        env.airDensity = airDensityAt(347 + model.state.pos.y);
        jump.step(SIM_DT, input, env);
      }
    };
    return { jump, model, until };
  }

  test('standing on the lip, the jump key sends the jumper out square to the deck', () => {
    const { jump, until } = jumpOff();
    expect(jump.phase).toBe('standing');
    expect(jump.log.exitHeight).toBe(b.height);
    until(() => jump.phase !== 'standing', 1, jumpKey);
    expect(jump.phase).toBe('freefall');
    const v = jump.body.state.vel;
    expect(out(b.x + v.x, b.z + v.z)).toBeCloseTo(STAND_OUT, 1);
  });

  test('a three second delay: open clear of the deck, far above the meadow', () => {
    const { jump, model, until } = jumpOff();
    until(() => jump.phase !== 'standing', 1, jumpKey);
    until(() => false, 3);
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(out(model.state.pos.x, model.state.pos.z)).toBeGreaterThan(5);
    expect(jump.height()).toBeGreaterThan(150);
  });

  test('turned to face the road, the jump goes into the wind screen', () => {
    const { jump, until } = jumpOff((b.headingDeg + 180) % 360);
    until(() => jump.phase !== 'standing', 1, jumpKey);
    until(() => jump.impact || jump.phase === 'standing', 2);
    expect(jump.impact).toBe(true);
    expect(jump.struck).toBe(true);
  });
});

describe('under canopy', () => {
  /** Flies a canopy straight on with hands up from a point, until it touches something. */
  function fly(x: number, y: number, z: number, headingDeg: number) {
    const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
    const env = calmAir();
    initTrimmed(model, vec3(x, y, z), headingDeg, env);
    const c = neutralControls();
    for (let t = 0; t < 90; t += SIM_DT) {
      model.step(SIM_DT, c, env);
      const touchdown = detectTouchdown(model, solid);
      if (touchdown) return { model, touchdown };
    }
    throw new Error('never came down');
  }

  test('from the final start, down onto the meadow', () => {
    const start = spawnsFor(dz, 240).final;
    const { model } = fly(start.x, dz.groundAt(start.x, start.z) + start.height, start.z, start.headingDeg);
    const s = model.state.pos;
    expect(feetHeight(model, dz.groundAt)).toBeLessThan(0.1);
    expect(inRect(dz.grass.mown, s.x, s.z) || Math.hypot(s.x - dz.target.x, s.z - dz.target.z) < 40).toBe(true);
  });

  test('flown at a pier low down, the canopy stops against it', () => {
    const s = deck.piers[3]!;
    const p = onDeck(s, 0);
    const ground = dz.groundAt(p.x, p.z);
    const from = onDeck(s - 60, 0);
    const heading = Math.atan2(p.x - from.x, -(p.z - from.z)) / DEG;
    const { model, touchdown } = fly(from.x, ground + 40 + 1.5, from.z, heading);
    expect(touchdown).not.toBeNull();
    const feet = model.state.pos;
    expect(Math.hypot(feet.x - p.x, feet.z - p.z)).toBeLessThan(12);
    expect(solid(feet.x, feet.z, feet.y) - feet.y).toBeGreaterThan(30);
  });
});
