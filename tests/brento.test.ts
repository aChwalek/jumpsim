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
import { RunUp } from '../src/sim/runUp';
import { vec3 } from '../src/sim/vec';
import { lipAlong, onPad } from '../src/world/cliffTop';
import { DATA } from '../src/world/data/brento';
import { solidOf } from '../src/world/dz';
import { dzInfo } from '../src/world/dzs';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';

const dz = createRealDz(DATA, LOOKS.brento);
const b = dz.base!;
const solid = solidOf(dz);
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

  test('the Becco stands some 1230 m above the field, a short run down a slab to a sheer drop', () => {
    const top = dz.groundAt(b.x, b.z);
    expect(top).toBeGreaterThan(1215);
    expect(top).toBeLessThan(1250);
    expect(dzInfo('brento').base).toEqual({ height: b.height });
    expect(Math.abs(top - b.height)).toBeLessThan(10);
    // The slab, known every metre, runs down to the lip some four metres
    // below the start, never steeper than 45 degrees nor rising more than a step...
    const lip = lipAlong(b, dz.groundAt);
    expect(Math.abs(lip - b.runUp)).toBeLessThan(0.5);
    const rim = along(lip);
    expect(top - dz.groundAt(rim.x, rim.z)).toBeGreaterThan(2);
    expect(top - dz.groundAt(rim.x, rim.z)).toBeLessThan(8);
    for (let s = 0; s < lip - 1.5; s += 1) {
      const p = along(s);
      const q = along(s + 1);
      const drop = dz.groundAt(p.x, p.z) - dz.groundAt(q.x, q.z);
      expect(drop).toBeLessThan(1);
      expect(drop).toBeGreaterThan(-0.4);
    }
    // ...then the wall: more than 350 m within 3 m of the lip, 400 within 10.
    const below = along(lip + 3);
    expect(dz.groundAt(rim.x, rim.z) - dz.groundAt(below.x, below.z)).toBeGreaterThan(350);
    const foot = along(lip + 10);
    expect(dz.groundAt(rim.x, rim.z) - dz.groundAt(foot.x, foot.z)).toBeGreaterThan(400);
    // The field is ahead of it, some 1.7 km out.
    const far = Math.hypot(dz.target.x - b.x, dz.target.z - b.z);
    expect(far).toBeGreaterThan(1600);
    expect(far).toBeLessThan(1800);
    expect(out(dz.target.x, dz.target.z)).toBeGreaterThan(far * Math.cos(30 * DEG));
  });

  test('a steel step on the lip, level, to run onto and jump from', () => {
    const pad = b.pad!;
    expect(pad).toBeDefined();
    // Its front edge just over the lip; its top flush with the rock behind it.
    const front = out(pad.x, pad.z) + pad.length / 2;
    expect(Math.abs(front - lipAlong(b, dz.groundAt) - 0.1)).toBeLessThan(0.05);
    const back = along(front - pad.length - 0.2);
    expect(Math.abs(dz.groundAt(back.x, back.z) - pad.top)).toBeLessThan(0.5);
    expect(solid(pad.x, pad.z)).toBe(pad.top);
    expect(onPad(pad, pad.x, pad.z)).toBe(true);
    // Running, the feet come down the slab onto it and leave off its front edge.
    const r = new RunUp(solid, b.x, b.z, b.headingDeg);
    let gone = false;
    let onStep = false;
    for (let t = 0; t < 10 && !gone; t += SIM_DT) {
      gone = r.step(SIM_DT, run);
      if (!gone && onPad(pad, r.x, r.z)) onStep = true;
    }
    expect(gone).toBe(true);
    expect(onStep).toBe(true);
    expect(Math.abs(out(r.x, r.z) - front)).toBeLessThan(0.3);
  });

  test('bare limestone round the exit, tussocks of grass on it, none on the run', () => {
    const top = dz.cliffTop!;
    expect(top).toBeDefined();
    const { rock } = top;
    const bareAt = (x: number, z: number) => rock.values[Math.round((z - rock.z0) / rock.spacing) * rock.n + Math.round((x - rock.x0) / rock.spacing)]! / 255;
    // The slab is bare all along the run.
    for (let s = 0; s < b.runUp; s += 2) {
      const p = along(s);
      expect(bareAt(p.x, p.z)).toBeGreaterThan(0.8);
    }
    // The scrub 60 m back from the rim is left to the photos.
    const back = along(-60);
    expect(bareAt(back.x, back.z)).toBeLessThan(0.2);
    expect(top.tufts.length).toBeGreaterThan(1500);
    expect(top.stones.length).toBeGreaterThan(50);
    const lip = lipAlong(b, dz.groundAt);
    for (const t of top.tufts) {
      const ahead = out(t.x, t.z);
      const side = Math.abs((t.x - b.x) * Math.cos(b.headingDeg * DEG) + (t.z - b.z) * Math.sin(b.headingDeg * DEG));
      if (ahead > -1.5 && ahead < lip + 0.5) expect(side).toBeGreaterThan(0.7);
    }
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
      solidAt: solid,
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

  test('a running exit and a five second delay: open clear of the wall, high above the slope below it', () => {
    const { jump, model } = jumpOff(5);
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
