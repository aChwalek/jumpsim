// Bots off a BASE object: beside us on top, one at a time in turn, a delay
// on heading or a track away from a cliff, a canopy each and down on the
// landing area.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { Bot, baseDelay, botLedge, type BotLead, type Lead, type ObjectTop } from '../src/sim/bot';
import { FlightModel, neutralControls, type Environment } from '../src/sim/flightModel';
import { noBodyInputs } from '../src/sim/freefall';
import { Jump, type Ledge } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import type { Suit } from '../src/sim/suit';
import { vec3 } from '../src/sim/vec';
import { DATA as BRENTO } from '../src/world/data/brento';
import { DATA as CHAMONIX } from '../src/world/data/chamonix';
import { DATA as LAUTERBRUNNEN } from '../src/world/data/lauterbrunnen';
import { DATA as LIMSKA } from '../src/world/data/limska';
import { DATA as MILLAU } from '../src/world/data/millau';
import { landingHeading, solidOf, type DzPack } from '../src/world/dz';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';
import { createTowerZone } from '../src/world/tower';

const rig = deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 });
const FRAME = 1 / 60;
const DEG = Math.PI / 180;

interface Flown {
  bot: Bot;
  /** When it left the top, s from the start; where its canopy came out, m over what is under it, and how far out from the exit, m. */
  exitAt: number | null;
  openHeight: number | null;
  openOut: number | null;
  /** It hit the side of the object. */
  struck: boolean;
}

/**
 * Off `dz`'s object with `n` bots. `lead` us: we go at `ourGo` s and pull
 * after `ourDelay`; bots: we stay on top. Flies until the bots are all down or
 * `seconds` are up.
 */
function flyOff(dz: DzPack, n: number, lead: BotLead, opts: { elevation?: number; suit?: Suit; ourGo?: number; ourDelay?: number; seconds?: number; windX?: number } = {}) {
  const b = dz.base!;
  const solid = solidOf(dz);
  const elevation = opts.elevation ?? 0;
  const top: ObjectTop = { x: b.x, z: b.z, headingDeg: b.headingDeg, runUp: b.runUp, height: b.height };
  const env: Environment = { wind: vec3(opts.windX ?? 0, 0, 0), airDensity: airDensityAt(elevation + b.height) };
  const model = new FlightModel(rig);
  const ours: Ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg: b.headingDeg, height: b.height, standing: b.runUp === 0 };
  const jump = new Jump(model, ours, env, dz.groundAt, () => 0.5, { solidAt: solid, container: 'base', suit: opts.suit });
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const landing = { x: dz.target.x, z: dz.target.z, headingDeg: landingHeading(dz, 0) };
  const flown: Flown[] = Array.from({ length: n }, (_, index) => ({
    bot: new Bot(rig, env, {
      index,
      of: n,
      mode: 'formation',
      lead,
      run: botLedge(index, top),
      spot: 'low',
      landing,
      groundAt: dz.groundAt,
      options: { solidAt: solid, container: 'base', suit: opts.suit },
      random,
    }),
    exitAt: null,
    openHeight: null,
    openOut: null,
    struck: false,
  }));
  const air: Environment = { wind: env.wind, airDensity: env.airDensity };
  const ourGo = opts.ourGo ?? 1;
  const out = (x: number, z: number) => (x - b.x) * Math.sin(b.headingDeg * DEG) - (z - b.z) * Math.cos(b.headingDeg * DEG);
  let t = 0;
  let ourExit: number | null = null;
  for (; t < (opts.seconds ?? 300) && !flown.every((f) => f.bot.touchdown || f.bot.jump.impact); t += FRAME) {
    const us: Lead = { pos: model.state.pos, vel: model.state.vel, out: jump.phase !== 'standing', falling: jump.phase === 'freefall', headingDeg: jump.headingDeg() };
    for (const [i, f] of flown.entries()) {
      air.airDensity = airDensityAt(elevation + f.bot.model.state.pos.y);
      f.bot.step(FRAME, air, us, i > 0 ? flown[i - 1]!.bot.lead : null);
      const j = f.bot.jump;
      if (f.exitAt === null && j.phase === 'freefall') f.exitAt = t;
      if (f.openHeight === null && j.phase === 'canopy') {
        f.openHeight = j.height();
        f.openOut = out(f.bot.model.state.pos.x, f.bot.model.state.pos.z);
      }
      f.struck ||= j.struck;
    }
    // Us: on the run, or off the lip, at `ourGo`, the pull after `ourDelay`, then hands off.
    const input = lead === 'us' && t > ourGo ? { ...noBodyInputs(), forward: 1 } : noBodyInputs();
    if (ourExit === null && jump.phase === 'freefall') ourExit = t;
    if (jump.phase === 'freefall' && jump.time > (opts.ourDelay ?? 3)) jump.act();
    for (let k = 0; k < FRAME / SIM_DT; k++) {
      env.airDensity = airDensityAt(elevation + model.state.pos.y);
      if (jump.phase === 'canopy') {
        if (model.state.pos.y - dz.groundAt(model.state.pos.x, model.state.pos.z) > 3) model.step(SIM_DT, neutralControls(), env);
      } else if (!jump.impact) jump.step(SIM_DT, input, env);
    }
  }
  return { flown, jump, model, t, top, ourExit };
}

/** Where it came down, m from the target. */
const fromTarget = (f: Flown, dz: DzPack) => Math.hypot(f.bot.model.state.pos.x - dz.target.x, f.bot.model.state.pos.z - dz.target.z);

/** Each one off clean, open, and down on its feet on the ground, not on the object, near the target. */
function allDown(r: ReturnType<typeof flyOff>, dz: DzPack, near: number) {
  for (const f of r.flown) {
    expect(f.exitAt).not.toBeNull();
    expect(f.struck).toBe(false);
    expect(f.bot.jump.impact).toBe(false);
    expect(f.openHeight).not.toBeNull();
    expect(f.bot.touchdown).not.toBeNull();
    expect(['hard', 'crash']).not.toContain(f.bot.touchdown!.rating);
    const p = f.bot.model.state.pos;
    expect(p.y - dz.groundAt(p.x, p.z)).toBeLessThan(5);
    expect(fromTarget(f, dz)).toBeLessThan(near);
  }
}

describe('where the bots wait on top', () => {
  test('on a run: beside us inside its lane, two level with us, two a little behind', () => {
    const top: ObjectTop = { x: 0, z: 0, headingDeg: 90, runUp: 20, height: 300 };
    const places = [0, 1, 2, 3].map((i) => botLedge(i, top));
    // Heading east: across is north-south, behind is west.
    expect(places.map((p) => Math.sign(p.z))).toEqual([1, -1, 1, -1]);
    for (const p of places) {
      expect(Math.abs(p.z)).toBeGreaterThan(1);
      expect(Math.abs(p.z)).toBeLessThan(2);
      expect(p.headingDeg).toBe(90);
      expect(p.standing).toBe(false);
    }
    expect(places[0]!.x).toBeCloseTo(0, 6);
    expect(places[2]!.x).toBeLessThan(-2);
  });

  test('off a bridge: on the lip, side by side with us, right then left and further out', () => {
    const top: ObjectTop = { x: 0, z: 0, headingDeg: 0, runUp: 0, height: 200 };
    const places = [0, 1, 2, 3].map((i) => botLedge(i, top));
    expect(places.map((p) => Math.round(p.x * 10) / 10)).toEqual([1.2, -1.2, 2.4, -2.4]);
    for (const p of places) {
      expect(p.z).toBeCloseTo(0, 6);
      expect(p.standing).toBe(true);
    }
  });

  test('the delay off something too low to track from: a second off 115 m, three off 300 m', () => {
    expect(baseDelay(115)).toBe(1);
    expect(baseDelay(300)).toBeCloseTo(3, 0);
    expect(baseDelay(2000)).toBe(4);
  });
});

describe('bots off the tower', () => {
  const dz = createTowerZone();

  test('we go first: each goes once the one before is off and open, and all come down near the target', () => {
    const r = flyOff(dz, 4, 'us');
    expect(r.ourExit).not.toBeNull();
    for (const [i, f] of r.flown.entries()) {
      // Its run starts the gap after the one before is off: it leaves later still.
      expect(f.exitAt!).toBeGreaterThan((i === 0 ? r.ourExit! : r.flown[i - 1]!.exitAt!) + 7);
      // A delay of about three seconds off 300 m: open well clear of the tower, high over the ground.
      expect(f.bot.jump.log.freefallSeconds).toBeGreaterThan(2.5);
      expect(f.bot.jump.log.freefallSeconds).toBeLessThan(3.5);
      expect(f.openOut!).toBeGreaterThan(40);
      expect(f.openHeight!).toBeGreaterThan(140);
    }
    allDown(r, dz, 80);
  });

  test('they go first: the first a few seconds after the start, all of them before us, who stay on top', () => {
    const r = flyOff(dz, 4, 'bot', { seconds: 60 });
    expect(r.flown[0]!.exitAt!).toBeGreaterThan(5);
    expect(r.flown[0]!.exitAt!).toBeLessThan(12);
    for (const f of r.flown) expect(f.exitAt).not.toBeNull();
    expect(r.jump.phase).toBe('standing');
  });
});

describe('bots off the real objects', () => {
  const site = (name: 'millau' | 'limska' | 'lauterbrunnen' | 'brento', data: typeof MILLAU) => ({ dz: createRealDz(data, LOOKS[name]), elevation: data.origin.elevation });

  test('Millau: on the lip of the deck with us, a short delay each, open far above the meadow', () => {
    const { dz, elevation } = site('millau', MILLAU);
    const r = flyOff(dz, 4, 'us', { elevation });
    const deck = solidOf(dz)(dz.base!.x, dz.base!.z);
    for (const [i, f] of r.flown.entries()) {
      const p = botLedge(i, r.top);
      expect(solidOf(dz)(p.x, p.z)).toBeCloseTo(deck, 0);
      expect(f.openHeight!).toBeGreaterThan(120);
    }
    allDown(r, dz, 150);
  }, 30_000);

  test('Limska: about a second of delay off 115 m, open high enough to land', () => {
    const { dz, elevation } = site('limska', LIMSKA);
    const r = flyOff(dz, 4, 'us', { elevation });
    for (const f of r.flown) {
      expect(f.bot.jump.log.freefallSeconds).toBeLessThan(1.6);
      expect(f.openHeight!).toBeGreaterThan(35);
    }
    allDown(r, dz, 100);
  }, 30_000);

  test('High Nose: a run, a few seconds, the pull over the scree, clear of the wall', () => {
    const { dz, elevation } = site('lauterbrunnen', LAUTERBRUNNEN);
    const r = flyOff(dz, 4, 'us', { elevation });
    for (const f of r.flown) {
      expect(f.openOut!).toBeGreaterThan(50);
      expect(f.openHeight!).toBeGreaterThan(150);
    }
    allDown(r, dz, 120);
  }, 30_000);

  test('Brento: a track away from the wall, the pull high over the slope, down on the field', () => {
    const { dz, elevation } = site('brento', BRENTO);
    const r = flyOff(dz, 4, 'us', { elevation });
    for (const f of r.flown) {
      expect(f.bot.jump.log.freefallSeconds).toBeGreaterThan(6);
      expect(f.openOut!).toBeGreaterThan(100);
      expect(f.openHeight!).toBeGreaterThan(150);
    }
    allDown(r, dz, 120);
  }, 30_000);

  test('Brento in wingsuits: half a minute of flight before the pull, and down on the field', () => {
    const { dz, elevation } = site('brento', BRENTO);
    const r = flyOff(dz, 2, 'us', { elevation, suit: { kind: 'wingsuit', level: 2 } });
    for (const f of r.flown) {
      expect(f.bot.jump.log.freefallSeconds).toBeGreaterThan(20);
      expect(f.openOut!).toBeGreaterThan(600);
    }
    allDown(r, dz, 150);
  }, 30_000);

  test.each([
    ['chamonix', 20, 600],
    ['chamonix-durier', 60, 2500],
  ] as const)('%s in wingsuits: the line flown straight out, the pull well over the face with the landing in reach, down on it', (id, seconds, out) => {
    const dz = createRealDz(CHAMONIX, LOOKS[id]);
    const r = flyOff(dz, 2, 'us', { elevation: CHAMONIX.origin.elevation, suit: { kind: 'wingsuit', level: 2 }, seconds: 900 });
    for (const f of r.flown) {
      expect(f.bot.jump.log.freefallSeconds).toBeGreaterThan(seconds);
      expect(f.openOut!).toBeGreaterThan(out);
      expect(f.openHeight!).toBeGreaterThan(250);
    }
    allDown(r, dz, 300);
  }, 60_000);
});
