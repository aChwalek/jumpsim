// Monte Brento: the Becco dell'Aquila on the rim of the wall, drawn from the
// Province of Trento's LiDAR, and a jump off it down to the campo Gaggiolo.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { DATA } from '../src/world/data/brento';
import { dzInfo } from '../src/world/dzs';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';

const dz = createRealDz(DATA, LOOKS.brento);
const b = dz.base!;
const DEG = Math.PI / 180;
/** A point `ahead` metres from the start along the run. */
const along = (ahead: number) => ({ x: b.x + Math.sin(b.headingDeg * DEG) * ahead, z: b.z - Math.cos(b.headingDeg * DEG) * ahead });
/** Metres out from the start, along the run. */
const out = (x: number, z: number) => (x - b.x) * Math.sin(b.headingDeg * DEG) - (z - b.z) * Math.cos(b.headingDeg * DEG);
const run: BodyInputs = { ...noBodyInputs(), forward: 1 };

describe('the wall', () => {
  test('the field is flat, at the level of the plain', () => {
    expect(dz.groundAt(dz.target.x, dz.target.z)).toBe(0);
    expect(Math.abs(dz.groundAt(dz.target.x - 40, dz.target.z + 20))).toBeLessThan(1);
  });

  test("the Becco stands some 1175 m above the field, a short run back from a sheer drop", () => {
    const top = dz.groundAt(b.x, b.z);
    expect(top).toBeGreaterThan(1150);
    expect(top).toBeLessThan(1200);
    expect(dzInfo('brento').base).toEqual({ height: b.height });
    expect(Math.abs(top - b.height)).toBeLessThan(10);
    // The platform slopes gently down to the rim, which the relief, known
    // every 6 m, rounds off...
    const edge = along(b.runUp - 3);
    expect(top - dz.groundAt(edge.x, edge.z)).toBeLessThan(15);
    for (let s = 0; s < b.runUp - 4; s += 2) {
      const p = along(s);
      const q = along(s + 2);
      expect(dz.groundAt(p.x, p.z) - dz.groundAt(q.x, q.z)).toBeLessThan(2 * Math.tan(45 * DEG));
    }
    // ...then the wall: more than 250 m within 15 m, more than 400 within 35.
    const below = along(b.runUp + 15);
    expect(dz.groundAt(edge.x, edge.z) - dz.groundAt(below.x, below.z)).toBeGreaterThan(250);
    const foot = along(b.runUp + 35);
    expect(dz.groundAt(edge.x, edge.z) - dz.groundAt(foot.x, foot.z)).toBeGreaterThan(400);
    // The field is ahead of it, some 1.7 km out.
    const far = Math.hypot(dz.target.x - b.x, dz.target.z - b.z);
    expect(far).toBeGreaterThan(1600);
    expect(far).toBeLessThan(1800);
    expect(out(dz.target.x, dz.target.z)).toBeGreaterThan(1600);
  });

  test('a BASE start, from where it was chosen', () => {
    expect(validSetup({ dz: 'brento', jump: { start: 'base' } }).jump.start).toBe('base');
  });
});

describe("off the Becco dell'Aquila", () => {
  function jumpOff(delay: number) {
    const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(DATA.origin.elevation + b.height) };
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg: b.headingDeg, height: b.height } as const;
    const jump = new Jump(model, ledge, env, dz.groundAt, () => 0.5, {
      solidAt: dz.groundAt,
      container: 'base',
      reserve: deriveRig(reserveConfig(90)),
    });
    const until = (done: () => boolean, seconds: number, input = noBodyInputs()) => {
      for (let t = 0; t < seconds && !done(); t += SIM_DT) {
        env.airDensity = airDensityAt(DATA.origin.elevation + model.state.pos.y);
        jump.step(SIM_DT, input, env);
      }
    };
    expect(jump.log.exitHeight).toBe(b.height);
    until(() => jump.phase !== 'standing', 10, run);
    expect(jump.phase).toBe('freefall');
    until(() => false, delay);
    if (jump.phase === 'freefall') jump.act();
    until(() => jump.phase === 'canopy' || jump.impact, 10);
    return { jump, model };
  }

  test('a running exit and a six second delay: open clear of the wall, high above the slope below it', () => {
    const { jump, model } = jumpOff(6);
    expect(jump.impact).toBe(false);
    expect(jump.phase).toBe('canopy');
    expect(jump.log.exitHeight).toBe(b.height);
    // Out from the rim, over the slope below the wall.
    expect(out(model.state.pos.x, model.state.pos.z) - b.runUp).toBeGreaterThan(15);
    expect(jump.height()).toBeGreaterThan(200);
  });

  test('a pull that never comes: the foot of the wall', () => {
    const { jump } = jumpOff(30);
    expect(jump.impact).toBe(true);
  });
});
