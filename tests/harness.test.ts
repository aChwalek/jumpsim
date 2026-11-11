// The joint between the two bodies of the model: the canopy with its lines,
// and the pilot hanging from the risers.

import { describe, expect, test } from 'vitest';
import { FlightModel, calmAir, neutralControls, type Controls } from '../src/sim/flightModel';
import { DEFAULT_RIG, deriveRig, type BodyParams } from '../src/sim/rig';
import { SIM_DT, initTrimmed } from '../src/sim/telemetry';
import { DEG, clamp, dot, quat, rotate, rotateInv, set, vec3, type Quat, type Vec3 } from '../src/sim/vec';

const env = calmAir();
const TURN = 2 * Math.PI;

/** Where the pilot is relative to the lines, degrees. */
function hang(model: FlightModel) {
  const s = model.state;
  const shoulders = rotateInv(vec3(), s.att, rotate(vec3(), s.pilotAtt, vec3(1, 0, 0)));
  const down = rotateInv(vec3(), s.att, rotate(vec3(), s.pilotAtt, vec3(0, -1, 0)));
  return {
    /** Feet ahead of the lines. */
    swing: Math.atan2(-down.z, -down.y) / DEG,
    /** One shoulder higher than the other. */
    roll: Math.asin(clamp(shoulders.y, -1, 1)) / DEG,
    /** Turned to the right under the canopy. */
    twist: s.twist / DEG,
  };
}

/** Fly from full flight and report the pilot's largest excursions, degrees. */
function flown(c: Partial<Controls>, seconds: number, prepare?: (model: FlightModel) => void) {
  const model = new FlightModel(deriveRig(DEFAULT_RIG));
  initTrimmed(model, vec3(0, 3000, 0), 0, env);
  prepare?.(model);
  const controls = { ...neutralControls(), ...c };
  const max = { swing: -Infinity, roll: 0, twist: 0 };
  for (let i = 0; i < seconds / SIM_DT; i++) {
    model.step(SIM_DT, controls, env);
    const h = hang(model);
    max.swing = Math.max(max.swing, h.swing);
    max.roll = Math.max(max.roll, Math.abs(h.roll));
    max.twist = Math.max(max.twist, Math.abs(h.twist));
  }
  return { max, end: hang(model), model };
}

const multiply = (a: Quat, b: Quat): Quat =>
  quat(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );

/** Turns the pilot to the right under a canopy that keeps its heading. */
const turnPilot = (deg: number) => (model: FlightModel) => {
  const half = (-deg * DEG) / 2;
  const s = model.state;
  Object.assign(s.pilotAtt, multiply(quat(0, Math.sin(half), 0, Math.cos(half)), s.pilotAtt));
};

describe('the two bodies obey mechanics', () => {
  /** Energy and momentum of the two bodies, from their centres of mass. */
  function account(model: FlightModel) {
    const { canopy, pilot, joint } = model.rig;
    const s = model.state;
    const momentum = vec3();
    let kinetic = 0;
    let potential = 0;
    const add = (b: BodyParams, w: Vec3, centre: Vec3, v: Vec3): void => {
      const offset = b.mass * b.cgY * b.cgY;
      kinetic += 0.5 * b.mass * dot(v, v);
      kinetic += 0.5 * ((b.inertia.x - offset) * w.x * w.x + b.inertia.y * w.y * w.y + (b.inertia.z - offset) * w.z * w.z);
      potential += b.weight * centre.y;
      momentum.x += b.mass * v.x;
      momentum.y += b.mass * v.y;
      momentum.z += b.mass * v.z;
    };
    const c = vec3(0, canopy.cgY, 0);
    const p = vec3(0, pilot.cgY, 0);
    add(canopy, s.omega, model.worldPoint(vec3(), c), model.worldPointVelocity(vec3(), c));
    add(pilot, s.pilotOmega, model.pilotPoint(vec3(), p), model.pilotPointVelocity(vec3(), p));
    const roll = hang(model).roll * DEG;
    potential += 0.5 * joint.rollStiffness * roll * roll;
    return { energy: kinetic + potential, kinetic, momentum };
  }

  /** Thrown tumbling where there is no air, with a harness that has no friction. */
  function tumble(dt: number) {
    const seconds = 3;
    const rig = deriveRig(DEFAULT_RIG);
    const model = new FlightModel({ ...rig, joint: { ...rig.joint, rollDamping: 0, yawDamping: 0, pitchDamping: 0 } });
    const vacuum = { ...env, airDensity: 0 };
    initTrimmed(model, vec3(), 0, vacuum);
    set(model.state.vel, 4, 2, -3);
    set(model.state.omega, 0.5, 0.3, -0.4);
    set(model.state.pilotOmega, -0.8, 0.5, 0.6);
    model.loadFactor = 0;
    const before = account(model);
    const still = neutralControls();
    for (let i = 0; i < Math.round(seconds / dt); i++) model.step(dt, still, vacuum);
    const after = account(model);
    const fallen = (rig.canopy.weight + rig.pilot.weight) * seconds;
    return {
      energy: Math.abs(after.energy - before.energy) / before.kinetic,
      momentum:
        Math.hypot(
          after.momentum.x - before.momentum.x,
          after.momentum.y - before.momentum.y + fallen,
          after.momentum.z - before.momentum.z,
        ) / Math.hypot(before.momentum.x, before.momentum.y, before.momentum.z),
      swing: Math.abs(hang(model).swing),
    };
  }

  test('with no air and no friction, energy is kept, the better the smaller the step', () => {
    const coarse = tumble(SIM_DT);
    const fine = tumble(SIM_DT / 4);
    expect(coarse.swing).toBeGreaterThan(20); // the joint really was worked
    expect(coarse.energy).toBeLessThan(0.06);
    expect(fine.energy).toBeLessThan(coarse.energy / 3);
  });

  test('only weight changes the momentum of the pair', () => {
    expect(tumble(SIM_DT).momentum).toBeLessThan(1e-3);
  });
});

describe('the pilot under the lines', () => {
  test('hangs still in steady flight, held a little back by drag', () => {
    const { max, end } = flown({}, 10);
    expect(end.swing).toBeGreaterThan(0);
    expect(max.swing).toBeLessThan(2);
    expect(max.roll).toBeLessThan(0.01);
    expect(max.twist).toBeLessThan(0.01);
  });

  test('swings ahead of the lines when the canopy is braked', () => {
    const { max } = flown({ brakeL: 1, brakeR: 1 }, 3);
    expect(max.swing).toBeGreaterThan(5);
    expect(max.swing).toBeLessThan(12);
    expect(max.twist).toBeLessThan(0.01);
  });

  test('stays square under a snapped full toggle', () => {
    const { max } = flown({ brakeR: 1 }, 8);
    expect(max.swing).toBeLessThan(10);
    expect(max.roll).toBeLessThan(3);
    expect(max.twist).toBeLessThan(3);
  });

  test('is turned back square by the risers, the same on both sides', () => {
    const right = flown({}, 4, turnPilot(30));
    const left = flown({}, 4, turnPilot(-30));
    expect(right.max.twist).toBeGreaterThan(29);
    expect(Math.abs(right.end.twist)).toBeLessThan(0.5);
    expect(left.max.twist).toBeCloseTo(right.max.twist, 6);
    expect(left.end.twist).toBeCloseTo(-right.end.twist, 6);
  });

  test('line twists are counted in whole turns and unwind', () => {
    const twisted = (model: FlightModel) => void (model.state.twist = 2 * TURN);
    expect(flown({}, 0.5, twisted).end.twist).toBeGreaterThan(540);
    const { end, model } = flown({}, 12, twisted);
    expect(Math.abs(end.twist)).toBeLessThan(1);
    const { vel } = model.state;
    expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(12); // and it flies on
  });

  test('wild inputs neither twist the lines nor break the harness', () => {
    const model = new FlightModel(deriveRig(DEFAULT_RIG));
    initTrimmed(model, vec3(0, 3000, 0), 0, env);
    const c = neutralControls();
    let seed = 2024;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const max = { swing: 0, roll: 0, twist: 0 };
    for (let i = 0; i < 120 / SIM_DT; i++) {
      if (i % 120 === 0) {
        c.brakeL = random();
        c.brakeR = random();
        c.frontL = random() < 0.3 ? random() : 0;
        c.frontR = random() < 0.3 ? random() : 0;
      }
      model.step(SIM_DT, c, env);
      const h = hang(model);
      max.swing = Math.max(max.swing, Math.abs(h.swing));
      max.roll = Math.max(max.roll, Math.abs(h.roll));
      max.twist = Math.max(max.twist, Math.abs(h.twist));
    }
    const { pilotAtt: q, pilotOmega: w } = model.state;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(8);
    expect(max.swing).toBeLessThan(20);
    expect(max.roll).toBeLessThan(5);
    expect(max.twist).toBeLessThan(5);
  });
});
