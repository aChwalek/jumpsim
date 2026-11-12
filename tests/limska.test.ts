// Limska Draga: the A9 viaduct over the valley, drawn from OSM and the
// published figures, and a jump off its lip down to the field under it.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, calmAir, neutralControls, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { detectTouchdown, feetHeight } from '../src/sim/landing';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { RunUp, STAND_OUT } from '../src/sim/runUp';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { PARAPET_HEIGHT } from '../src/world/bridge';
import { DATA } from '../src/world/data/limska';
import { inRect, solidOf, spawnsFor } from '../src/world/dz';
import { dzInfo } from '../src/world/dzs';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';
import { createTowerZone } from '../src/world/tower';

const dz = createRealDz(DATA, LOOKS.limska);
const solid = solidOf(dz);
const b = dz.base!;
const deck = dz.bridges![0]!;
const DEG = Math.PI / 180;
const jumpKey: BodyInputs = { ...noBodyInputs(), forward: 1 };
/** A point on the first deck: `s` metres along it from its west end, `u` to its right (south). */
function onDeck(s: number, u: number) {
  const [ax, az] = deck.a;
  const len = Math.hypot(deck.b[0] - ax, deck.b[1] - az);
  const ux = (deck.b[0] - ax) / len;
  const uz = (deck.b[1] - az) / len;
  return { x: ax + ux * s - uz * u, z: az + uz * s + ux * u };
}
/** Metres out from the exit, along its heading. */
const out = (x: number, z: number) => (x - b.x) * Math.sin(b.headingDeg * DEG) - (z - b.z) * Math.cos(b.headingDeg * DEG);

describe('the viaduct', () => {
  test('the field is flat, at the level of the plain', () => {
    expect(dz.groundAt(dz.target.x, dz.target.z)).toBe(0);
    expect(Math.abs(dz.groundAt(dz.target.x + 10, dz.target.z + 30))).toBeLessThan(1);
    // Nothing over it.
    expect(solid(dz.target.x, dz.target.z)).toBe(dz.groundAt(dz.target.x, dz.target.z));
  });

  test('two decks, 552 m long, the road some 115 m over the field', () => {
    expect(dz.bridges).toHaveLength(2);
    for (const d of dz.bridges!) {
      expect(Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])).toBeGreaterThan(540);
      expect(Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])).toBeLessThan(565);
      // The published spans: 80, 100, 160, 100, 80.
      expect(d.piers[2]! - d.piers[1]!).toBe(160);
    }
    expect(b.height).toBeGreaterThan(105);
    expect(b.height).toBeLessThan(125);
    expect(deck.top).toBe(b.height);
  });

  test('the exit: on the lip of the deck, outside the parapet, square to the road and over the void', () => {
    expect(b.runUp).toBe(0);
    expect(solid(b.x, b.z)).toBeCloseTo(deck.top, 6);
    // Square to the deck's axis (110°), out to the south.
    expect(b.headingDeg).toBeCloseTo(200.5, 0);
    // The parapet is behind the jumper, the void ahead.
    const back = { x: b.x - Math.sin(b.headingDeg * DEG) * 0.5, z: b.z + Math.cos(b.headingDeg * DEG) * 0.5 };
    expect(solid(back.x, back.z)).toBeCloseTo(deck.top + PARAPET_HEIGHT, 6);
    const ahead = { x: b.x + Math.sin(b.headingDeg * DEG) * 1, z: b.z - Math.cos(b.headingDeg * DEG) * 1 };
    expect(solid(ahead.x, ahead.z)).toBeLessThan(deck.top - 100);
    // Over the middle of the main span, where the drop is greatest.
    for (const s of [100, 200, 450]) {
      const p = onDeck(s, 0);
      expect(dz.groundAt(p.x, p.z)).toBeGreaterThan(dz.groundAt(b.x, b.z));
    }
    // The field is ahead and below, some 70 m out.
    expect(Math.hypot(dz.target.x - b.x, dz.target.z - b.z)).toBeGreaterThan(50);
    expect(Math.hypot(dz.target.x - b.x, dz.target.z - b.z)).toBeLessThan(90);
    expect(out(dz.target.x, dz.target.z)).toBeGreaterThan(50);
  });

  test('a BASE start, from the lip of the deck', () => {
    expect(validSetup({ dz: 'limska', jump: { start: 'base' } }).jump.start).toBe('base');
    expect(dzInfo('limska').base).toEqual({ height: Math.round(b.height), standing: true });
  });
});

describe('what is solid', () => {
  test('the deck to whoever is level with it or above it, the ground to whoever is under it', () => {
    const p = onDeck(270, 0);
    const ground = dz.groundAt(p.x, p.z);
    expect(solid(p.x, p.z)).toBeCloseTo(deck.top, 6);
    expect(solid(p.x, p.z, deck.top + 20)).toBeCloseTo(deck.top, 6);
    // In the slab, just under the road: it is the deck.
    expect(solid(p.x, p.z, deck.top - 0.2)).toBeCloseTo(deck.top, 6);
    // Under the girder, at half height: the ground.
    expect(solid(p.x, p.z, ground + 50)).toBe(ground);
  });

  test('the parapets stand on both edges of the road', () => {
    for (const u of [-5.4, 5.4]) {
      const p = onDeck(270, u);
      expect(solid(p.x, p.z, deck.top)).toBeCloseTo(deck.top + PARAPET_HEIGHT, 6);
    }
  });

  test('a pier is solid from the ground up to the deck', () => {
    for (const s of deck.piers) {
      const p = onDeck(s, 0);
      expect(solid(p.x, p.z, dz.groundAt(p.x, p.z) + 5)).toBeCloseTo(deck.top, 6);
    }
    // Between two piers, under the deck, the ground.
    const gap = onDeck((deck.piers[1]! + deck.piers[2]!) / 2, 0);
    expect(solid(gap.x, gap.z, dz.groundAt(gap.x, gap.z) + 5)).toBe(dz.groundAt(gap.x, gap.z));
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
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(205) };
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg, height: b.height, standing: true } as const;
    const jump = new Jump(model, ledge, env, dz.groundAt, () => 0.5, {
      solidAt: solid,
      container: 'base',
      reserve: deriveRig(reserveConfig(90)),
    });
    const until = (done: () => boolean, seconds: number, input = noBodyInputs()) => {
      for (let t = 0; t < seconds && !done(); t += SIM_DT) {
        env.airDensity = airDensityAt(90 + model.state.pos.y);
        jump.step(SIM_DT, input, env);
      }
    };
    return { jump, model, until };
  }

  test('standing on the lip: no run, the jump key sends the jumper out at once', () => {
    const { jump, until } = jumpOff();
    expect(jump.phase).toBe('standing');
    expect(jump.log.exitHeight).toBe(b.height);
    expect(jump.clearance()).toBeCloseTo(0, 1);
    // Nothing moves the feet on the lip.
    until(() => false, 1, { ...noBodyInputs(), slide: 1, forward: 0.3 });
    expect(jump.phase).toBe('standing');
    expect(Math.hypot(jump.runUp!.x - b.x, jump.runUp!.z - b.z)).toBe(0);
    until(() => jump.phase !== 'standing', 1, jumpKey);
    expect(jump.phase).toBe('freefall');
    // Out, square to the deck, at a standing jump's speed.
    const v = jump.body.state.vel;
    expect(out(b.x + v.x, b.z + v.z)).toBeCloseTo(STAND_OUT, 1);
    expect(v.y).toBeGreaterThan(0);
  });

  test('a one second delay: open clear of the deck, well above the field', () => {
    const { jump, model, until } = jumpOff();
    until(() => jump.phase !== 'standing', 1, jumpKey);
    until(() => false, 1);
    jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.exitHeight).toBe(b.height);
    expect(out(model.state.pos.x, model.state.pos.z)).toBeGreaterThan(3);
    expect(jump.height()).toBeGreaterThan(40);
  });

  test('a pull that never comes: the valley floor, not the deck', () => {
    const { jump, model, until } = jumpOff();
    until(() => jump.phase !== 'standing', 1, jumpKey);
    until(() => jump.impact, 15);
    expect(jump.impact).toBe(true);
    expect(jump.struck).toBe(false);
    expect(model.state.pos.y).toBeLessThan(10);
  });

  test('turned to face the road, the jump goes into the parapet', () => {
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
    for (let t = 0; t < 60; t += SIM_DT) {
      const before = model.state.pos.y;
      model.step(SIM_DT, c, env);
      const touchdown = detectTouchdown(model, solid);
      if (touchdown) return { model, touchdown, before };
    }
    throw new Error('never came down');
  }

  test('from the final start, under the deck and down onto the field', () => {
    const start = spawnsFor(dz, 225).final;
    // The final starts on the far side of the bridge, under it.
    expect(out(start.x, start.z)).toBeLessThan(0);
    const y = dz.groundAt(start.x, start.z) + start.height;
    expect(y).toBeLessThan(deck.top - 40);
    const { model } = fly(start.x, y, start.z, start.headingDeg);
    const s = model.state.pos;
    expect(feetHeight(model, dz.groundAt)).toBeLessThan(0.1);
    expect(inRect(dz.grass.mown, s.x, s.z) || Math.hypot(s.x - dz.target.x, s.z - dz.target.z) < 30).toBe(true);
  });

  test('flown at a pier, the canopy stops against its side', () => {
    const p = onDeck(deck.piers[1]!, 0);
    const ground = dz.groundAt(p.x, p.z);
    // 60 m short of it along the deck, 40 m up.
    const from = onDeck(deck.piers[1]! - 60, 0);
    const { model, touchdown } = fly(from.x, ground + 40 + 1.5, from.z, 110.5);
    expect(touchdown).not.toBeNull();
    const feet = model.state.pos;
    expect(Math.hypot(feet.x - p.x, feet.z - p.z)).toBeLessThan(8);
    // Far below its top: the side, as main.ts reads it.
    expect(solid(feet.x, feet.z, feet.y) - feet.y).toBeGreaterThan(30);
  });
});

test('the tower still has its run-up', () => {
  const tower = createTowerZone();
  expect(tower.base!.runUp).toBe(25);
  const r = new RunUp(tower.topAt!, tower.base!.x, tower.base!.z, 0);
  expect(r.standing).toBe(false);
  expect(r.step(SIM_DT, jumpKey)).toBe(false);
});
