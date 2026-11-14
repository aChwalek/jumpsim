// Chamonix: one valley, two wingsuit exits of the town's arrêté, each with its
// own landing, drawn from the IGN's LiDAR HD. The Aiguille des Deux Aigles
// down to the Planards; the Pointe Durier, over the Bossons glacier, down to
// the basin of the Taconnaz avalanche defences.

import { describe, expect, test } from 'vitest';
import { validSetup } from '../src/setup';
import { airDensityAt } from '../src/sim/atmosphere';
import { FlightModel, type Environment } from '../src/sim/flightModel';
import { noBodyInputs, type BodyInputs } from '../src/sim/freefall';
import { Jump } from '../src/sim/jump';
import { DEFAULT_RIG, deriveRig, reserveConfig } from '../src/sim/rig';
import { SIM_DT } from '../src/sim/telemetry';
import { vec3 } from '../src/sim/vec';
import { DATA } from '../src/world/data/chamonix';
import { inArea, solidOf, type DzPack } from '../src/world/dz';
import { dzInfo, type DzId } from '../src/world/dzs';
import { createRealDz } from '../src/world/real';
import { LOOKS } from '../src/world/realDzs';

const DEG = Math.PI / 180;
const run: BodyInputs = { ...noBodyInputs(), forward: 1 };

const exits: { id: DzId; dz: DzPack; landing: number; drop20: number }[] = [
  { id: 'chamonix', dz: createRealDz(DATA, LOOKS.chamonix), landing: 0, drop20: 50 },
  { id: 'chamonix-durier', dz: createRealDz(DATA, LOOKS['chamonix-durier']), landing: 1, drop20: 100 },
];

describe.each(exits)('$id', ({ id, dz, landing, drop20 }) => {
  const b = dz.base!;
  const along = (ahead: number) => ({ x: b.x + Math.sin(b.headingDeg * DEG) * ahead, z: b.z - Math.cos(b.headingDeg * DEG) * ahead });

  test('the exit stands as high above its own landing as the menu says', () => {
    expect(dzInfo(id).base).toEqual({ height: b.height });
    const top = dz.groundAt(b.x, b.z);
    expect(Math.abs(top - (dz.groundAt(dz.target.x, dz.target.z) + b.height))).toBeLessThan(2);
  });

  test('a short run, trodden even, then the face: steep below the lip', () => {
    const top = dz.groundAt(b.x, b.z);
    const lip = along(b.runUp);
    // The run neither climbs nor drops away, and has no knob to trip on.
    expect(Math.abs(top - dz.groundAt(lip.x, lip.z))).toBeLessThan(b.runUp / 2);
    for (let s = 0; s < b.runUp - 0.5; s += 0.5) {
      const p = along(s);
      const q = along(s + 0.5);
      expect(Math.abs(dz.groundAt(p.x, p.z) - dz.groundAt(q.x, q.z))).toBeLessThan(0.3);
    }
    const below = along(b.runUp + 20);
    expect(dz.groundAt(lip.x, lip.z) - dz.groundAt(below.x, below.z)).toBeGreaterThan(drop20);
    const far = along(b.runUp + 80);
    expect(dz.groundAt(lip.x, lip.z) - dz.groundAt(far.x, far.z)).toBeGreaterThan(150);
  });

  test('its target lies on its own landing area, with grass round it and its windsock by it', () => {
    const area = DATA.dz.landing[landing]!;
    expect(inArea({ points: area.points, color: 0, layer: 0 }, dz.target.x, dz.target.z)).toBe(true);
    expect(Math.hypot(dz.windsock.x - dz.target.x, dz.windsock.z - dz.target.z)).toBeLessThan(300);
    expect(Math.hypot(dz.grass.mown.x - dz.target.x, dz.grass.mown.z - dz.target.z)).toBeLessThan(300);
  });

  test('a BASE start, from where it was chosen', () => {
    expect(validSetup({ dz: id, jump: { start: 'base' } }).jump.start).toBe('base');
  });
});

describe('the valley', () => {
  const planards = exits[0]!.dz;
  test('the valley floor goes on down below the Planards, not laid flat at their level', () => {
    // The Arve at Les Bossons, some 3 km west, is lower than the landing.
    expect(planards.groundAt(-3000, 1500)).toBeLessThan(-20);
  });

  test('Mont Blanc stands about 3725 m above the Planards', () => {
    // 45.8326 N, 6.8652 E, 4806 m: the summit, some 10 km out, on the 100 m grid.
    const x = (6.8652 - 6.8815) * 111320 * Math.cos(45.9249 * DEG);
    const z = -(45.8326 - 45.9249) * 110540;
    let top = -Infinity;
    for (let dx = -300; dx <= 300; dx += 50) for (let dz = -300; dz <= 300; dz += 50) top = Math.max(top, planards.groundAt(x + dx, z + dz));
    expect(top).toBeGreaterThan(3550);
    expect(top).toBeLessThan(3800);
  });

  test('both lines lie in the fine relief, and the photos cover both exits and both landings at a metre', () => {
    const spots = DATA.imagerySpots!;
    expect(spots.centres.length).toBe(4);
    for (const { dz } of exits) {
      const near = (x: number, z: number) => spots.centres.some(([cx, cz]) => Math.abs(x - cx) < spots.size / 2 - 50 && Math.abs(z - cz) < spots.size / 2 - 50);
      expect(near(dz.base!.x, dz.base!.z)).toBe(true);
      expect(near(dz.target.x, dz.target.z)).toBe(true);
    }
  });
});

describe.each(exits)('off the exit, $id', ({ dz }) => {
  const b = dz.base!;
  const solid = solidOf(dz);
  const out = (x: number, z: number) => (x - b.x) * Math.sin(b.headingDeg * DEG) - (z - b.z) * Math.cos(b.headingDeg * DEG);

  test('in a wingsuit, a running exit flown hands off for twenty seconds: clear of the face all the way, far out', () => {
    const model = new FlightModel(deriveRig({ ...DEFAULT_RIG, canopyAreaFt2: 230 }));
    const env: Environment = { wind: vec3(), airDensity: airDensityAt(DATA.origin.elevation + b.height) };
    const ledge = { kind: 'ledge', x: b.x, z: b.z, headingDeg: b.headingDeg, height: b.height } as const;
    const jump = new Jump(model, ledge, env, dz.groundAt, () => 0.5, {
      solidAt: solid,
      container: 'base',
      reserve: deriveRig(reserveConfig(90)),
      suit: { kind: 'wingsuit', level: 2 },
    });
    for (let t = 0; t < 10 && jump.phase === 'standing'; t += SIM_DT) jump.step(SIM_DT, run, env);
    expect(jump.phase).toBe('freefall');
    // Off the lip, not off a knob of snow on the way to it.
    expect(out(model.state.pos.x, model.state.pos.z)).toBeGreaterThan(b.runUp - 0.5);
    let lowest = Infinity;
    for (let t = 0; t < 20 && !jump.impact; t += SIM_DT) {
      env.airDensity = airDensityAt(DATA.origin.elevation + model.state.pos.y);
      jump.step(SIM_DT, noBodyInputs(), env);
      if (t > 1) lowest = Math.min(lowest, jump.height());
    }
    expect(jump.impact).toBe(false);
    // The face goes by close in the first seconds, before the suit flies.
    expect(lowest).toBeGreaterThan(5);
    expect(out(model.state.pos.x, model.state.pos.z)).toBeGreaterThan(500);
  });
});
