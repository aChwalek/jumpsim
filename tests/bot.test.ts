// The jumpers the sim flies for company: out after us, into their slots, away
// at the break-off, a canopy each and down near the target.

import { describe, expect, test } from 'vitest';
import { airDensityAt } from '../src/sim/atmosphere';
import { Bot, SLOT_SPACING, botHeights, botSpot, roundRadius, type BotMode, type Lead } from '../src/sim/bot';
import { FlightModel, neutralControls, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { validSetup } from '../src/setup';
import type { Suit } from '../src/sim/suit';
import { vec3 } from '../src/sim/vec';

const flat = () => 0;
const rig = deriveRig(DEFAULT_RIG);
const reserve = deriveRig(reserveConfig(DEFAULT_RIG.exitWeightKg));
const run = { x: 0, z: 0, height: 4000, headingDeg: 0, indicatedAirspeed: 40 };
const FRAME = 1 / 60;

/** A jump with `n` bots, we with `input` held all the way and pulling at 900 m; `each` is called every frame. */
function fly(mode: BotMode, n: number, each: (t: number, us: FlightModel, bots: Bot[]) => void, input: BodyInputs = noBodyInputs(), windX = 0, suit?: Suit) {
  const env: Environment = { wind: vec3(windX, 0, 0), airDensity: airDensityAt(4000) };
  const model = new FlightModel(rig);
  const jump = new Jump(model, run, env, flat, () => 0.5, { suit });
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const landing = { x: 0, z: 0, headingDeg: 270 };
  const bots = Array.from({ length: n }, (_, index) => new Bot(rig, env, { index, of: n, mode, run, spot: 'low', landing, groundAt: flat, options: { reserve, rsl: true, suit }, random }));
  const air: Environment = { wind: env.wind, airDensity: env.airDensity };
  let down = false;
  for (let i = 0; i < 600 / FRAME && !bots.every((b) => b.touchdown); i++) {
    const us: Lead = { pos: model.state.pos, vel: model.state.vel, out: jump.phase !== 'plane', falling: jump.phase === 'freefall', headingDeg: jump.headingDeg() };
    const leader = bots.find((b) => b.leads) ?? null;
    for (const b of bots) {
      air.airDensity = airDensityAt(b.model.state.pos.y);
      b.step(FRAME, air, us, leader && b !== leader ? leader.lead : null);
    }
    if (i === 60) jump.act();
    if (jump.phase === 'freefall' && jump.height() < 900) jump.act();
    for (let k = 0; k < FRAME / SIM_DT && !down; k++) {
      env.airDensity = airDensityAt(model.state.pos.y);
      jump.step(SIM_DT, input, env);
      if (jump.phase === 'canopy') {
        model.step(SIM_DT, neutralControls(), env);
        down = model.state.pos.y < 2;
      }
    }
    each(i * FRAME, model, bots);
  }
  return bots;
}

const apart = (a: FlightModel, b: FlightModel) => Math.hypot(a.state.pos.x - b.state.pos.x, a.state.pos.z - b.state.pos.z);

describe('bots', () => {
  test('a formation: a round with us within half a minute, level with us, and held', () => {
    let worst = 0;
    let level = 0;
    // Four on a circle: the next ones a slot away, the one opposite across it.
    const across = 2 * roundRadius(4);
    const bots = fly('formation', 3, (t, us, all) => {
      if (t < 26 || us.state.pos.y < 1600) return;
      for (const [i, b] of all.entries()) {
        worst = Math.max(worst, Math.abs(apart(us, b.model) - (i === 1 ? across : SLOT_SPACING)));
        level = Math.max(level, Math.abs(b.model.state.pos.y - us.state.pos.y));
      }
      // Nobody on top of anybody.
      for (const a of all) for (const b of all) if (a !== b) expect(apart(a.model, b.model)).toBeGreaterThan(SLOT_SPACING - 0.9);
    });
    expect(worst).toBeLessThan(0.8);
    expect(level).toBeLessThan(0.5);
    for (const b of bots) expect(b.jump.log.aad).toBe(false);
  });

  test('they follow us across the sky and down a faster fall', () => {
    let worst = 0;
    fly(
      'formation',
      2,
      (t, us, all) => {
        if (t < 30 || us.state.pos.y < 1600) return;
        for (const b of all) worst = Math.max(worst, Math.hypot(apart(us, b.model), b.model.state.pos.y - us.state.pos.y));
      },
      { turn: 0, forward: 0.5, slide: 0, fall: 0.4 },
    );
    expect(worst).toBeLessThan(5);
  });

  test('away at the break-off: well apart at the pull, each a little higher than the last, nobody on the AAD', () => {
    const { pull } = botHeights(run.height);
    const bots = fly('formation', 4, () => {});
    const pulls = bots.map((b) => b.jump.log.pullHeight!);
    for (const [i, b] of bots.entries()) {
      expect(b.jump.log.aad).toBe(false);
      expect(pulls[i]).toBeGreaterThan(pull - 60);
      expect(pulls[i]).toBeLessThan(pull + 60 * i + 60);
    }
  });

  test('they land on their feet near the target, in calm air and in wind', () => {
    for (const wind of [0, 7]) {
      const bots = fly('formation', 3, () => {}, noBodyInputs(), wind);
      for (const b of bots) {
        expect(b.touchdown).not.toBeNull();
        expect(['hard', 'crash']).not.toContain(b.touchdown!.rating);
        expect(Math.hypot(b.model.state.pos.x, b.model.state.pos.z)).toBeLessThan(120);
      }
    }
  });

  /** How far off its place in the V each follower gets, at worst, once formed and until the break-off; and how far out the leader goes. */
  function vee(mode: BotMode, n: number, suit: Suit, from: number) {
    let worst = 0;
    let far = 0;
    const bots = fly(
      mode,
      n,
      (t, _us, all) => {
        const lead = all[0]!.model.state;
        if (t < from || lead.pos.y < 1700) return;
        far = Math.max(far, Math.hypot(lead.pos.x, lead.pos.z));
        // Along where the leader goes, and to its right.
        const speed = Math.hypot(lead.vel.x, lead.vel.z);
        const [ax, az] = [lead.vel.x / speed, lead.vel.z / speed];
        for (const [i, b] of all.entries()) {
          if (i === 0) continue;
          const p = b.model.state.pos;
          const row = Math.ceil(i / 2);
          const behind = (lead.pos.x - p.x) * ax + (lead.pos.z - p.z) * az;
          const right = -(p.x - lead.pos.x) * az + (p.z - lead.pos.z) * ax;
          worst = Math.max(worst, Math.abs(behind - 5 * row), Math.abs(right - (i % 2 ? -5 : 5) * row), Math.abs(p.y - lead.pos.y - 1.5 * row));
        }
      },
      noBodyInputs(),
      0,
      suit,
    );
    return { worst, far, bots };
  }

  test('a track: the leader goes off jump run and round the landing area, the others hold a V behind it', () => {
    const { worst, far, bots } = vee('track', 3, { kind: 'jumpsuit', level: 1 }, 35);
    expect(bots[0]!.leads).toBe(true);
    expect(far).toBeGreaterThan(500);
    expect(far).toBeLessThan(1500);
    expect(worst).toBeLessThan(2.5);
  });

  test('in wings there is always a leader: the V holds behind it, and they all get home', () => {
    for (const level of [1, 3] as const) {
      const { worst, far, bots } = vee('formation', 3, { kind: 'wingsuit', level }, 110);
      expect(bots[0]!.leads).toBe(true);
      expect(far).toBeLessThan(1500);
      expect(worst).toBeLessThan(2.5);
      for (const b of bots) {
        expect(b.jump.log.aad).toBe(false);
        expect(['hard', 'crash']).not.toContain(b.touchdown!.rating);
        expect(Math.hypot(b.model.state.pos.x, b.model.state.pos.z)).toBeLessThan(150);
      }
    }
  });

  test('in the plane they take the places at the door we left free, and past those the cabin', () => {
    expect([0, 1, 2, 3].map((i) => botSpot(i, 'low'))).toEqual(['high', 'step', 'inside', 'inside']);
    expect([0, 1, 2, 3].map((i) => botSpot(i, 'inside'))).toEqual(['high', 'low', 'step', 'inside']);
  });

  test('how many and what they fly are kept with the setup, within bounds', () => {
    expect(validSetup({}).bots).toEqual({ count: 0, mode: 'formation' });
    expect(validSetup({ bots: { count: 3, mode: 'track' } }).bots).toEqual({ count: 3, mode: 'track' });
    expect(validSetup({ bots: { count: 99, mode: 'swarm' } }).bots).toEqual({ count: 4, mode: 'formation' });
  });
});
